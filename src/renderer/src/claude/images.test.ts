import { describe, expect, it, vi } from 'vitest'
import { NO_PREVIEW, TOO_LARGE } from '@shared/claude-images'
import type { ClaudeFeedItem, ClaudeImage } from '@shared/types'
import { COULD_NOT_LOAD, feedImages, formatBytes, imageCaption, imageCount, isImageData, itemImages, stepImage, ThumbCache, thumbSize, viewerSize } from './images'

const image = (over: Partial<ClaudeImage> = {}): ClaudeImage => ({ id: 'a1b2c3d4e5f60718', format: 'png', width: 1440, height: 900, bytes: 212_000, ...over })

describe('sizes', () => {
  it('a thumbnail fits 240×180, keeps its shape and is never enlarged; no size gives a 120 px square', () => {
    expect(thumbSize({ width: 1440, height: 900 })).toEqual({ width: 240, height: 150 })
    expect(thumbSize({ width: 1080, height: 2340 })).toEqual({ width: 83, height: 180 })
    expect(thumbSize({ width: 32, height: 32 })).toEqual({ width: 32, height: 32 })
    expect(thumbSize({ width: 5000, height: 1 })).toEqual({ width: 240, height: 1 })
    expect(thumbSize({ width: 0, height: 0 })).toEqual({ width: 120, height: 120 })
  })

  it('the viewer: as large as fits with 24 px around it, never above one image pixel per CSS pixel', () => {
    expect(viewerSize({ width: 2880, height: 1800 }, { width: 1048, height: 748 })).toEqual({ width: 1000, height: 625 })
    expect(viewerSize({ width: 1080, height: 2340 }, { width: 1048, height: 748 })).toEqual({ width: 323, height: 700 })
    expect(viewerSize({ width: 300, height: 200 }, { width: 1048, height: 748 })).toEqual({ width: 300, height: 200 })
    expect(viewerSize({ width: 0, height: 0 }, { width: 1048, height: 748 })).toBeNull()
    expect(viewerSize({ width: 100, height: 100 }, { width: 0, height: 0 })).toEqual({ width: 1, height: 1 })
  })
})

describe('captions', () => {
  it('a pasted image by its number; a tool image by its tool and summary; then size, format and bytes', () => {
    expect(imageCaption(image({ paste: 3 }), { kind: 'prompt', text: 'see' })).toBe('Image #3 · 1440 × 900 · PNG · 212 KB')
    expect(imageCaption(image({ width: 923, height: 2000, bytes: 284_312 }), { kind: 'tool', id: 't1', name: 'Read', summary: 'docs/shot.png', state: 'done' }))
      .toBe('Read · docs/shot.png · 923 × 2000 · PNG · 284 KB')
    expect(imageCaption(image({ format: 'jpeg', width: 0, height: 0, bytes: 512 }), { kind: 'prompt', text: '[image]' })).toBe('Image · JPEG · 512 B')
    expect(imageCaption(image({ format: 'webp' }), { kind: 'tool', id: 't2', name: 'browser:shot', summary: '', state: 'done' })).toBe('browser:shot · 1440 × 900 · WebP · 212 KB')
  })

  it('bytes in B, KB and MB, powers of 1,000', () => {
    expect([999, 1000, 212_499, 999_499, 999_500, 2_400_000].map(formatBytes)).toEqual(['999 B', '1 KB', '212 KB', '999 KB', '1.0 MB', '2.4 MB'])
  })
})

describe("the feed's images", () => {
  const items: ClaudeFeedItem[] = [
    { kind: 'prompt', text: 'see', images: [image({ id: 'p0' }), image({ id: 'p1' })] },
    { kind: 'reply', text: 'ok' },
    { kind: 'tool', id: 't1', name: 'Read', summary: 'a.png', state: 'done', images: [image({ id: 'p0' })], moreImages: 2 },
    { kind: 'tool', id: 't2', name: 'Bash', summary: 'ls', state: 'done', images: 'nonsense' as never },
  ]

  it('are listed oldest to newest, keyed by row and place, the same picture twice too', () => {
    expect(feedImages(items, [7, 8, 9, 10]).map((e) => [e.key, e.image.id])).toEqual([['7:0', 'p0'], ['7:1', 'p1'], ['9:0', 'p0']])
    expect(feedImages(items, [7, 8, 9, 10])[2].caption).toBe('Read · a.png · 1440 × 900 · PNG · 212 KB')
  })

  it("count what an item lists and what it only counted; anything that isn't a list is none", () => {
    expect(items.map(imageCount)).toEqual([2, 0, 3, 0])
    expect(itemImages(items[3])).toEqual([])
  })

  it('step to the next and previous image, stopping at the ends; from one that has gone, forward to the oldest', () => {
    const list = feedImages(items, [7, 8, 9, 10])
    expect(stepImage(list, '7:1', 1)?.key).toBe('9:0')
    expect(stepImage(list, '7:1', -1)?.key).toBe('7:0')
    expect(stepImage(list, '7:0', -1)).toBeNull()
    expect(stepImage(list, '9:0', 1)).toBeNull()
    expect(stepImage(list, '3:0', 1)?.key).toBe('7:0')
    expect(stepImage(list, '3:0', -1)).toBeNull()
    expect(stepImage([], '3:0', 1)).toBeNull()
  })
})

describe('isImageData', () => {
  it('takes a data: URL of an image or a reason, nothing else', () => {
    expect(isImageData({ url: 'data:image/png;base64,AA==' })).toBe(true)
    expect(isImageData({ error: NO_PREVIEW })).toBe(true)
    for (const bad of [null, 'data:image/png;base64,AA==', { url: 'https://example.com/a.png' }, { url: 'data:text/html,<b>' }, { url: 42 }, {},
      { url: 'javascript:alert(1)', error: 'and a reason' }]) {
      expect(isImageData(bad)).toBe(false)
    }
  })
})

describe('ThumbCache', () => {
  const url = (n: number) => `data:image/png;base64,${'A'.repeat(n - 22)}`

  it('asks once for a thumbnail on its way, and keeps it', async () => {
    const cache = new ThumbCache()
    const load = vi.fn(async () => ({ url: url(100) }))
    const [a, b] = await Promise.all([cache.get('x', load), cache.get('x', load)])
    expect(a).toEqual({ url: url(100) })
    expect(b).toEqual(a)
    expect(await cache.get('x', load)).toEqual(a)
    expect(load).toHaveBeenCalledTimes(1)
    expect(cache.peek('x')).toBe(url(100))
  })

  it("doesn't keep a failure, a rejection or an answer that isn't image data", async () => {
    const cache = new ThumbCache()
    expect(await cache.get('x', async () => ({ error: TOO_LARGE }))).toEqual({ error: TOO_LARGE })
    expect(await cache.get('x', async () => {
      throw new Error('IPC closed')
    })).toEqual({ error: COULD_NOT_LOAD })
    expect(await cache.get('x', () => {
      throw new Error('synchronous')
    })).toEqual({ error: COULD_NOT_LOAD })
    expect(await cache.get('x', async () => ({ url: 'javascript:alert(1)' }))).toEqual({ error: COULD_NOT_LOAD })
    expect(cache.peek('x')).toBeUndefined()
    const load = vi.fn(async () => ({ url: url(50) }))
    expect(await cache.get('x', load)).toEqual({ url: url(50) })
    expect(load).toHaveBeenCalledTimes(1)
  })

  it('drops the least recently used past its limit, and never keeps one larger than the limit', async () => {
    const cache = new ThumbCache(300)
    for (const id of ['a', 'b', 'c']) await cache.get(id, async () => ({ url: url(100) }))
    cache.peek('a') // used: b is now the oldest
    await cache.get('d', async () => ({ url: url(100) }))
    expect(['a', 'b', 'c', 'd'].map((id) => cache.peek(id) !== undefined)).toEqual([true, false, true, true])
    expect(await cache.get('huge', async () => ({ url: url(301) }))).toEqual({ url: url(301) })
    expect(cache.peek('huge')).toBeUndefined()
  })
})
