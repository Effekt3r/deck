import { afterEach, beforeEach, describe, expect, it, vi } from 'vitest'
import type { ClipboardPreview, InsertResult } from '@shared/types'
import type { ClipboardContent } from './item'
import { ClipboardWatch, type WatchDeps } from './watch'

const text = (t: string, concealed = false): ClipboardContent => ({ kind: 'text', text: t, concealed })
const files = (...paths: string[]): ClipboardContent => ({ kind: 'files', paths })
const image = (b = 1): ClipboardContent => ({ kind: 'image', png: new Uint8Array([b, 2, 3]) })

/** A watch over a fake clipboard (`clip.now`), recording everything it published. Setting
 *  `clip.fail` makes every read throw, as a busy clipboard API would, until cleared. */
function setup(overrides: Partial<WatchDeps> = {}) {
  const clip: { now: ClipboardContent | null; fail: boolean } = { now: text('there at start'), fail: false }
  const published: (ClipboardPreview | null)[] = []
  const counts = { reads: 0 }
  const watch = new ClipboardWatch({
    read: async () => {
      counts.reads++
      if (clip.fail) throw new Error('busy')
      return clip.now
    },
    imageInfo: () => ({ width: 1440, height: 900, thumbnail: 'data:image/png;base64,AA==' }),
    insert: async (c, claude): Promise<InsertResult | null> => {
      if (c.kind === 'image') return claude ? { text: "'/tmp/clipboard-1.png'" } : null
      return { text: c.kind === 'files' ? c.paths.join(' ') : c.text }
    },
    publish: (item) => published.push(item),
    ...overrides,
  })
  return { clip, published, counts, watch, last: () => published.at(-1) }
}

/** Lets queued looks run, and polls given a time. */
const tick = (ms = 0) => vi.advanceTimersByTimeAsync(ms)

beforeEach(() => vi.useFakeTimers())
afterEach(() => vi.useRealTimers())

describe('ClipboardWatch', () => {
  it("doesn't offer what the clipboard held at start", async () => {
    const { watch, published } = setup()
    await watch.baseline()
    watch.focus()
    await tick()
    expect(published).toEqual([])
    watch.stop()
  })

  it('offers text copied in another app when Deck comes to the front', async () => {
    const { clip, watch, last } = setup()
    await watch.baseline()
    clip.now = text('copied elsewhere\nsecond line')
    watch.focus()
    await tick()
    expect(last()).toMatchObject({ kind: 'text', lines: ['copied elsewhere', 'second line'], lineCount: 2 })
    expect(watch.current()).toEqual(last())
    watch.stop()
  })

  it('offers a screenshot taken while Deck is in front at the next look', async () => {
    const { clip, watch, last } = setup()
    await watch.baseline()
    watch.focus()
    await tick()
    clip.now = image()
    await tick(1000)
    expect(last()).toMatchObject({ kind: 'image', width: 1440, height: 900 })
    watch.stop()
  })

  it('takes text that changes while Deck is in front as its own copy: no card, and the old one goes', async () => {
    const { clip, watch, last, published } = setup()
    await watch.baseline()
    watch.focus()
    clip.now = files('/a.pdf')
    await tick(1000)
    expect(last()).toMatchObject({ kind: 'files' })
    clip.now = text('selected in the terminal')
    await tick(1000)
    expect(last()).toBeNull()
    expect(published).toHaveLength(2)
    watch.stop()
  })

  it('never offers concealed text, and drops the card when it arrives', async () => {
    const { clip, watch, last } = setup()
    await watch.baseline()
    clip.now = image()
    watch.focus()
    await tick()
    expect(last()).toMatchObject({ kind: 'image' })
    watch.blur()
    await tick()
    clip.now = text('s3cret', true)
    watch.focus()
    await tick()
    expect(last()).toBeNull()
    watch.stop()
  })

  it('publishes nothing while nothing changes', async () => {
    const { clip, watch, published, counts } = setup()
    await watch.baseline()
    clip.now = image()
    watch.focus()
    await tick(5000)
    expect(published).toHaveLength(1)
    expect(counts.reads).toBeGreaterThanOrEqual(5)
    watch.stop()
  })

  it("doesn't look while Deck is in the background, after one last look on leaving", async () => {
    const { clip, watch, last, counts } = setup()
    await watch.baseline()
    watch.focus()
    await tick()
    clip.now = files('/copied/just/before/leaving.png')
    watch.blur()
    await tick()
    expect(last()).toMatchObject({ kind: 'files', names: ['leaving.png'] })
    const reads = counts.reads
    await tick(10_000)
    expect(counts.reads).toBe(reads)
  })

  it('a terminal copy just before leaving does not show when Deck comes back', async () => {
    const { clip, watch, published } = setup()
    await watch.baseline()
    watch.focus()
    await tick(300)
    clip.now = text('selected in the terminal')
    watch.blur()
    await tick()
    watch.focus()
    await tick()
    expect(published).toEqual([])
    watch.stop()
  })

  it("blur() while not in front takes no read, and foreign text then shows on return", async () => {
    const { clip, watch, published, counts } = setup()
    await watch.baseline()
    watch.focus()
    await tick()
    watch.blur()
    await tick()
    clip.now = text('copied in Safari')
    const reads = counts.reads
    watch.blur() // powerMonitor 'lock-screen' / 'suspend' firing while Deck is already behind
    await tick()
    expect(counts.reads).toBe(reads)
    watch.focus()
    await tick()
    expect(published.at(-1)).toMatchObject({ kind: 'text', lines: ['copied in Safari'] })
    watch.stop()
  })

  it('blur while a poll is still reading takes its own last look: a copy made during that read gets no card', async () => {
    const box: { now: ClipboardContent } = { now: text('there at start') }
    let slow = false
    const { watch, published } = setup({
      read: async () => {
        const sampled = box.now // sampled when the read starts ...
        if (slow) await new Promise((r) => setTimeout(r, 50)) // ... returned 50 ms later
        return sampled
      },
    })
    await watch.baseline()
    watch.focus()
    await tick()
    slow = true
    await tick(1000) // a poll starts a slow read
    box.now = text('selected in the terminal') // copied during that read ...
    watch.blur() // ... and Deck left at once
    await tick(50)
    slow = false
    await tick()
    watch.focus()
    await tick()
    expect(published).toEqual([])
    watch.stop()
  })

  it("add() gives the snapshot's text even if the clipboard changed since, and uses the item up", async () => {
    const { clip, watch, last } = setup()
    await watch.baseline()
    clip.now = files('/x/spec.pdf')
    watch.focus()
    await tick()
    const id = last()!.id
    watch.stop() // no look sees the next change
    clip.now = text('something else')
    expect(await watch.add(id)).toEqual({ text: '/x/spec.pdf' })
    expect(last()).toBeNull()
    expect(watch.current()).toBeNull()
  })

  it('add() with an item that is gone says so', async () => {
    const { watch } = setup()
    expect(await watch.add('nope')).toEqual({ error: 'That clipboard item is gone. Copy it again.' })
  })

  it('add() keeps the item when insert fails', async () => {
    const { clip, watch, last } = setup({ insert: async () => ({ error: 'disk full' }) })
    await watch.baseline()
    clip.now = image()
    watch.focus()
    await tick()
    const id = last()!.id
    expect(await watch.add(id)).toEqual({ error: 'disk full' })
    expect(watch.current()).toMatchObject({ kind: 'image' })
    watch.stop()
  })

  it('dismiss() during a slow add fails it instead of inserting, and the item stays dismissed', async () => {
    let finish: (result: InsertResult) => void = () => {}
    const { clip, watch, last, published } = setup({
      insert: () => new Promise((resolve) => { finish = resolve }),
    })
    await watch.baseline()
    clip.now = files('/a.pdf')
    watch.focus()
    await tick()
    const id = last()!.id
    const adding = watch.add(id)
    await tick() // add()'s task has started and is now awaiting insert()
    watch.dismiss(id)
    expect(last()).toBeNull()
    finish({ text: '/a.pdf' })
    expect(await adding).toEqual({ error: 'That clipboard item is gone. Copy it again.' })
    expect(watch.current()).toBeNull()
    expect(published.filter((p) => p === null)).toHaveLength(1) // dismiss()'s null, not a second one from add()
    watch.stop()
  })

  it("paste() uses up the card's item, and what was pasted never shows later", async () => {
    const { clip, watch, last, published } = setup()
    await watch.baseline()
    clip.now = image()
    watch.focus()
    await tick()
    expect(await watch.paste(true)).toEqual({ text: "'/tmp/clipboard-1.png'" })
    expect(last()).toBeNull()
    await tick(3000)
    expect(published).toHaveLength(2)
    watch.stop()
  })

  it('paste() of an image in a shell tab pastes nothing and keeps the card', async () => {
    const { clip, watch, last } = setup()
    await watch.baseline()
    clip.now = image()
    watch.focus()
    await tick()
    expect(await watch.paste(false)).toBeNull()
    expect(last()).toMatchObject({ kind: 'image' })
    watch.stop()
  })

  it('an image pasted in a shell tab before any look still shows as a card at the next arrival', async () => {
    const { clip, watch, last } = setup()
    await watch.baseline()
    clip.now = image()
    expect(await watch.paste(false)).toBeNull() // a shell tab: nothing pastes, nothing is consumed
    watch.focus()
    await tick()
    expect(last()).toMatchObject({ kind: 'image' })
    watch.stop()
  })

  it('a copy pasted before Deck looked never shows', async () => {
    const { clip, watch, published } = setup()
    await watch.baseline()
    clip.now = text('pasted at once')
    expect(await watch.paste(true)).toEqual({ text: 'pasted at once' })
    watch.focus()
    await tick()
    expect(published).toEqual([])
    watch.stop()
  })

  it('paste() after a change no look has seen retires the card', async () => {
    const { clip, watch, last } = setup()
    await watch.baseline()
    clip.now = image()
    watch.focus()
    await tick()
    expect(last()).toMatchObject({ kind: 'image' })
    clip.now = text('copied')
    expect(await watch.paste(true)).toEqual({ text: 'copied' })
    expect(last()).toBeNull()
    watch.stop()
  })

  it("paste() when the clipboard can't be read reports why", async () => {
    const { clip, watch } = setup()
    await watch.baseline()
    clip.fail = true
    expect(await watch.paste(true)).toEqual({ error: "Couldn't read the clipboard: busy" })
  })

  it('dismiss() hides the card', async () => {
    const { clip, watch, last } = setup()
    await watch.baseline()
    clip.now = files('/a')
    watch.focus()
    await tick()
    watch.dismiss(last()!.id)
    expect(last()).toBeNull()
    watch.stop()
  })

  it('a dismissed card stays dismissed across later polls and a blur/refocus with the same clipboard', async () => {
    const { clip, watch, last } = setup()
    await watch.baseline()
    clip.now = files('/a.pdf')
    watch.focus()
    await tick()
    watch.dismiss(last()!.id)
    expect(last()).toBeNull()
    await tick(3000) // the clipboard hasn't changed: later polls see the same fingerprint
    expect(watch.current()).toBeNull()
    watch.blur()
    await tick()
    watch.focus()
    await tick()
    expect(watch.current()).toBeNull()
    watch.stop()
  })

  it('polling restarts after blur then focus', async () => {
    const { clip, watch, last } = setup()
    await watch.baseline()
    watch.focus()
    await tick()
    watch.blur()
    await tick()
    watch.focus()
    await tick()
    clip.now = image()
    await tick(1000)
    expect(last()).toMatchObject({ kind: 'image' })
    watch.stop()
  })

  it('focus() twice without blur keeps one interval and ignores a text change between them', async () => {
    const { clip, watch, counts, published, last } = setup()
    await watch.baseline()
    watch.focus()
    await tick(200)
    const reads = counts.reads
    clip.now = text('own copy')
    watch.focus() // e.g. a platform emitting focus twice
    await tick()
    expect(counts.reads).toBe(reads) // the repeat focus did nothing: no extra read
    expect(published).toEqual([])
    clip.now = image()
    await tick(1000) // the one interval it armed still polls normally afterwards
    expect(last()).toMatchObject({ kind: 'image' })
    watch.stop()
  })

  it('read() throwing in a poll recovers on the next poll', async () => {
    const { clip, watch, last } = setup()
    await watch.baseline()
    watch.focus()
    await tick()
    clip.fail = true
    clip.now = image()
    await tick(1000)
    expect(last()).toBeUndefined() // the failed read published nothing
    clip.fail = false
    await tick(1000)
    expect(last()).toMatchObject({ kind: 'image' })
    watch.stop()
  })

  it('imageInfo throwing still offers the image, without size or thumbnail', async () => {
    const { clip, watch, last } = setup({
      imageInfo: () => {
        throw new Error('corrupt png')
      },
    })
    await watch.baseline()
    watch.focus()
    await tick()
    clip.now = image()
    await tick(1000)
    expect(last()).toMatchObject({ kind: 'image', width: 0, height: 0, thumbnail: '' })
    watch.stop()
  })

  it('a failed baseline read: the first look is the baseline, and later changes still show', async () => {
    const { clip, watch, published, last } = setup()
    clip.fail = true
    await watch.baseline()
    clip.fail = false
    watch.focus()
    await tick()
    expect(published).toEqual([]) // the existing clipboard, unseen by baseline, is not offered as new
    clip.now = image()
    await tick(1000)
    expect(last()).toMatchObject({ kind: 'image' }) // but a later change still shows
    watch.stop()
  })

  it('backs off polling after a slow read, but the arrival look still runs at once', async () => {
    let reads = 0
    const { watch } = setup({
      read: async () => {
        reads++
        await new Promise((r) => setTimeout(r, 200))
        return image()
      },
    })
    watch.focus()
    await tick(0)
    expect(reads).toBe(1) // the arrival look reads at once, backoff or not
    await tick(60_000)
    expect(reads).toBeLessThanOrEqual(20) // far below the ~60 a flat 1 s poll would have cost
    watch.stop()
  })

  // fingerprintOf isn't part of WatchDeps (it's a plain import), so a slow fingerprint can't be
  // faked here; this instead checks that quietUntil is set from a point in time after the read
  // finishes, which is also where fingerprinting now happens, so timing the look as a whole (not
  // just the read) backs off the very next poll rather than only some later one.
  it('one slow look (200 ms read) still backs off the very next scheduled poll', async () => {
    const { watch, counts } = setup({
      read: async () => {
        await new Promise((r) => setTimeout(r, 200))
        return image()
      },
    })
    watch.focus()
    await tick(200) // the arrival look's read finishes; quietUntil is set just after
    const reads = counts.reads
    await tick(1000) // the poll due at 1000 ms is still inside the backoff window
    expect(counts.reads).toBe(reads)
    watch.stop()
  })

  it('a backoff never delays the arrival look', async () => {
    let reads = 0
    let slow = false
    const { watch } = setup({
      read: async () => {
        reads++
        if (slow) await new Promise((r) => setTimeout(r, 500))
        return null
      },
    })
    await watch.baseline()
    watch.focus()
    await tick()
    slow = true
    await tick(1000) // a 500 ms poll read: polls back off
    await tick(500)
    slow = false
    watch.blur()
    const before = reads
    watch.focus() // back at once, while polls are still backed off
    await tick()
    expect(reads).toBe(before + 2) // the leaving look and the arrival look both read
    watch.stop()
  })

  it('one 3 s read backs polls off for at most 15 s', async () => {
    let slow = false
    const { clip, watch, last } = setup({
      read: async () => {
        if (slow) {
          slow = false
          await new Promise((r) => setTimeout(r, 3000))
        }
        return clip.now
      },
    })
    await watch.baseline()
    watch.focus()
    await tick()
    slow = true
    await tick(4000) // one 3 s read (a Universal Clipboard fetch)
    clip.now = image()
    await tick(16_000)
    expect(last()).toMatchObject({ kind: 'image' })
    watch.stop()
  })

  it('a read that takes 2 s and then throws still backs off, not retrying every second', async () => {
    let reads = 0
    let slow = false
    const { watch } = setup({
      read: async () => {
        reads++
        if (slow) {
          slow = false
          await new Promise((r) => setTimeout(r, 2000))
          throw new Error('busy')
        }
        return null
      },
    })
    watch.focus()
    await tick() // the arrival look: instant, not the slow one
    slow = true
    await tick(3100) // the poll due at 1000 ms starts a 2 s read that then throws, around 3000 ms
    const before = reads
    await tick(10_000) // without backing off on a thrown read, this would cost ~10 more reads
    expect(reads).toBe(before)
    watch.stop()
  })

  it('ticks while a poll is still reading are skipped, not queued', async () => {
    let reads = 0
    let slow = false
    const { watch } = setup({
      read: async () => {
        reads++
        if (slow) {
          slow = false
          await new Promise((r) => setTimeout(r, 2500))
        }
        return null
      },
    })
    await watch.baseline() // 1
    watch.focus()
    await tick() // arrival: 2
    slow = true
    await tick(1000) // a poll starts a 2.5 s read (3); the ticks at 2 s and 3 s come while it runs
    await tick(3000) // it ended at 3.5 s; polls back off after it
    expect(reads).toBe(3) // without the dedupe, those two ticks would queue two more reads
    watch.stop()
  })

  it("looks one at a time, and a slow clipboard doesn't pile up looks", async () => {
    let open = 0
    let most = 0
    let reads = 0
    const { watch } = setup({
      read: async () => {
        reads++
        open++
        most = Math.max(most, open)
        await new Promise((r) => setTimeout(r, 2500))
        open--
        return null
      },
    })
    watch.focus()
    await tick(10_000)
    expect(most).toBe(1)
    expect(reads).toBeLessThanOrEqual(5)
    watch.stop()
    const before = reads
    await tick(30_000)
    expect(reads - before).toBeLessThanOrEqual(1) // stop() leaves at most one look still queued
  })
})
