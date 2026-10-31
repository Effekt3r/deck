import { randomUUID } from 'node:crypto'
import type { ClipboardPreview, InsertResult } from '@shared/types'
import { type ClipboardContent, fingerprintOf, type ImageInfo, previewOf } from './item'

export interface WatchDeps {
  /** The clipboard now; null when it's empty or holds nothing Deck pastes. */
  read(): Promise<ClipboardContent | null>
  /** Size and thumbnail of a new image item. */
  imageInfo(png: Uint8Array): ImageInfo
  /** What inserts `content` into a terminal (insertFor). */
  insert(content: ClipboardContent, claude: boolean): Promise<InsertResult | null>
  /** The card's item changed. */
  publish(item: ClipboardPreview | null): void
  /** How often to look while the window is in front; 1000 ms by default. */
  pollMs?: number
}

interface Item {
  preview: ClipboardPreview
  fingerprint: string
  content: ClipboardContent
}

/** Decides what the clipboard card offers.
 *  - Deck looks when its window comes to the front, about once a second while it's there, and
 *    once more as it leaves (one last look at a copy made just before); nothing while it's
 *    actually in the background — blur() only looks if Deck was in front, so a lock or sleep that
 *    hits it while it's already behind reads nothing. A slow read backs the polling rate off, so
 *    a large image on the clipboard doesn't cost much, for at most 15 s.
 *  - Coming to the front, anything copied since Deck last looked is new: it came from another app.
 *  - While Deck is in front, or on its way out, only images and files are new (a screenshot to
 *    the clipboard): text that changes then is Deck's own copy (a terminal selection, Copy hash,
 *    Copy path).
 *  - Any change clears the old item, so the card shows what Cmd/Ctrl+V would paste. Concealed
 *    text (a password manager's copy) never shows.
 *  Looks, adds and pastes run one at a time. */
export class ClipboardWatch {
  private seen: string | null = null
  private item: Item | null = null
  private timer: ReturnType<typeof setInterval> | null = null
  private chain: Promise<unknown> = Promise.resolve()
  /** A poll's look is queued or running: further polls are skipped rather than piling up. */
  private looking = false
  /** No polls before this: a slow read (a large image) spaces the next ones out. */
  private quietUntil = 0

  constructor(private readonly deps: WatchDeps) {}

  current(): ClipboardPreview | null {
    return this.item?.preview ?? null
  }

  /** What the clipboard holds when Deck starts is not new. */
  baseline(): Promise<void> {
    return this.serial(async () => {
      try {
        this.seen = fingerprintOf(await this.deps.read())
      } catch {
        // unreadable: the first look that reads becomes the baseline instead
      }
    })
  }

  /** The window came to the front. */
  focus(): void {
    if (this.timer) return // already in front: a repeated event, not a fresh arrival
    void this.look('arrived')
    this.timer = setInterval(() => {
      if (performance.now() >= this.quietUntil) void this.look('poll')
    }, this.deps.pollMs ?? 1000)
  }

  /** The window went to the background: one last look (a copy made just before) and no more. */
  blur(): void {
    if (!this.timer) return // not in front: a lock or sleep while Deck is behind, or a repeated event
    this.stop()
    void this.look('leaving')
  }

  stop(): void {
    if (this.timer) clearInterval(this.timer)
    this.timer = null
  }

  /** The text for the card's item `id` (its snapshot), which is then used up. */
  add(id: string): Promise<InsertResult> {
    return this.serial(async () => {
      const item = this.item
      if (!item || item.preview.id !== id) return { error: 'That clipboard item is gone. Copy it again.' }
      const result = (await this.deps.insert(item.content, true)) ?? { error: 'There is nothing to add.' }
      // dismiss() isn't serialised against add(): a × pressed during a slow read or image save
      // must still win, not be overwritten by an insert that lands after it.
      if (this.item !== item) return { error: 'That clipboard item is gone. Copy it again.' }
      if ('text' in result) this.set(null)
      return result
    })
  }

  /** What Cmd/Ctrl+V pastes now. Pasting the card's item uses it up, and what is pasted never shows later. */
  paste(claude: boolean): Promise<InsertResult | null> {
    return this.serial(async () => {
      let content: ClipboardContent | null
      try {
        content = await this.deps.read()
      } catch (err) {
        return { error: `Couldn't read the clipboard: ${err instanceof Error ? err.message : String(err)}` }
      }
      const fingerprint = fingerprintOf(content)
      // The card shows what Cmd/Ctrl+V pastes: a clipboard that moved on before a look saw it
      // retires it, as a look would have.
      if (this.item && this.item.fingerprint !== fingerprint) this.set(null)
      if (!content) return null
      const result = await this.deps.insert(content, claude)
      if (result && 'text' in result) {
        this.seen = fingerprint // what was pasted never shows later; what pasted nothing still can
        if (this.item?.fingerprint === fingerprint) this.set(null)
      }
      return result
    })
  }

  dismiss(id: string): void {
    if (this.item?.preview.id === id) this.set(null)
  }

  /** `reason`: why this look is happening. A poll is deduped against one already pending, so a
   *  slow read never queues more behind it; a leaving look always runs regardless (a pending poll
   *  may have sampled before the last copy). Only an arrival look treats a text change as new; a
   *  poll or a leaving look takes it as Deck's own copy. */
  private look(reason: 'arrived' | 'poll' | 'leaving'): Promise<void> {
    const poll = reason === 'poll'
    if (poll) {
      if (this.looking) return Promise.resolve()
      this.looking = true
    }
    return this.serial(async () => {
      try {
        let content: ClipboardContent | null
        const started = performance.now()
        try {
          content = await this.deps.read()
        } catch {
          return // unreadable just now: the next look tries again
        } finally {
          // Reading is what polling costs (an image is read whole): keep it to about 5% of the
          // time, but never stop polling for more than 15 s because one read was slow.
          const now = performance.now()
          this.quietUntil = now + Math.min((now - started) * 19, 15_000)
        }
        const fingerprint = fingerprintOf(content)
        if (fingerprint === this.seen) return
        const first = this.seen === null
        this.seen = fingerprint
        if (first) return // no baseline yet: what's there is what Deck started with
        if (!content || (content.kind === 'text' && (content.concealed || reason !== 'arrived'))) return this.set(null)
        let image: ImageInfo | undefined
        if (content.kind === 'image') {
          try {
            image = this.deps.imageInfo(content.png)
          } catch {
            // undecodable: the card says "Image", without size or thumbnail
          }
        }
        this.set({ preview: previewOf(content, randomUUID(), image), fingerprint, content })
      } finally {
        if (poll) this.looking = false
      }
    })
  }

  private set(item: Item | null): void {
    if (item === null && this.item === null) return
    this.item = item
    this.deps.publish(item?.preview ?? null)
  }

  private serial<T>(task: () => Promise<T>): Promise<T> {
    const run = this.chain.then(task, task)
    this.chain = run.catch(() => undefined)
    return run
  }
}
