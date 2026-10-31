import { afterEach, beforeEach, describe, expect, it, vi } from 'vitest'
import type { ClipboardPreview, InsertResult } from '@shared/types'
import type { ClipboardContent } from './item'
import { ClipboardWatch, type WatchDeps } from './watch'

const text = (t: string, concealed = false): ClipboardContent => ({ kind: 'text', text: t, concealed })
const files = (...paths: string[]): ClipboardContent => ({ kind: 'files', paths })
const image = (b = 1): ClipboardContent => ({ kind: 'image', png: new Uint8Array([b, 2, 3]) })

/** A watch over a fake clipboard (`clip.now`), recording everything it published. */
function setup(overrides: Partial<WatchDeps> = {}) {
  const clip: { now: ClipboardContent | null } = { now: text('there at start') }
  const published: (ClipboardPreview | null)[] = []
  const counts = { reads: 0 }
  const watch = new ClipboardWatch({
    read: async () => {
      counts.reads++
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
  })
})
