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
 *  - Deck looks when its window comes to the front and about once a second while it's there,
 *    never in the background.
 *  - Coming to the front, anything copied since Deck last looked is new: it came from another app.
 *  - While Deck is in front, only images and files are new (a screenshot to the clipboard): text
 *    that changes then is Deck's own copy (a terminal selection, Copy hash, Copy path).
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

  constructor(private readonly deps: WatchDeps) {}

  current(): ClipboardPreview | null {
    return this.item?.preview ?? null
  }

  /** What the clipboard holds when Deck starts is not new. */
  baseline(): Promise<void> {
    return this.serial(async () => {
      this.seen = fingerprintOf(await this.deps.read().catch(() => null))
    })
  }

  /** The window came to the front. */
  focus(): void {
    void this.look(true)
    this.timer ??= setInterval(() => void this.look(false), this.deps.pollMs ?? 1000)
  }

  /** The window went to the background: one last look (a copy made just before) and no more. */
  blur(): void {
    this.stop()
    void this.look(false)
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
      this.seen = fingerprint
      if (!content) return null
      const result = await this.deps.insert(content, claude)
      if (result && 'text' in result && this.item?.fingerprint === fingerprint) this.set(null)
      return result
    })
  }

  dismiss(id: string): void {
    if (this.item?.preview.id === id) this.set(null)
  }

  /** `arrived`: the window just came to the front (else a poll, or leaving). */
  private look(arrived: boolean): Promise<void> {
    if (!arrived) {
      if (this.looking) return Promise.resolve()
      this.looking = true
    }
    return this.serial(async () => {
      try {
        let content: ClipboardContent | null
        try {
          content = await this.deps.read()
        } catch {
          return // unreadable just now: the next look tries again
        }
        const fingerprint = fingerprintOf(content)
        if (fingerprint === this.seen) return
        this.seen = fingerprint
        if (!content || (content.kind === 'text' && (content.concealed || !arrived))) return this.set(null)
        const image = content.kind === 'image' ? this.deps.imageInfo(content.png) : undefined
        this.set({ preview: previewOf(content, randomUUID(), image), fingerprint, content })
      } finally {
        if (!arrived) this.looking = false
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
