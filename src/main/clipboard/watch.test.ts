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

  it('a failed baseline read: the first look becomes the baseline', async () => {
    const { clip, watch, published } = setup()
    clip.fail = true
    await watch.baseline()
    clip.fail = false
    watch.focus()
    await tick()
    expect(published).toEqual([]) // the existing clipboard, unseen by baseline, is not offered as new
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
