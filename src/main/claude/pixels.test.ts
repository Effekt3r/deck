import { writeFileSync } from 'node:fs'
import { join } from 'node:path'
import { afterAll, beforeEach, describe, expect, it, vi } from 'vitest'
import { GONE, NO_PREVIEW, TOO_LARGE, UNDECODABLE, UNREADABLE } from '@shared/claude-images'
import { imageId } from './images'
import { type ImageSource, ImagePixels, JOB_TIMEOUT_MS, MAX_LINE, THUMB } from './pixels'
import { gifBytes, imageBlock, jpegBytes, makeFolder, pngBytes, pngHeaderBytes, removeClaudeHomes, webpBytes } from './test-log'

/** A stand-in for Electron's nativeImage: it "decodes" an image to its header's size; its PNG and JPEG
 *  are text naming their size, so a test can read what was made. `fail` makes every decode empty, and
 *  `throws` makes it throw. */
const native = vi.hoisted(() => ({ fail: false, throws: false, decoded: 0 }))
vi.mock('electron', async () => {
  const { imageSize, sniffFormat } = await import('./images')
  interface Fake {
    isEmpty(): boolean
    getSize(): { width: number; height: number }
    resize(o: { width: number; height: number; quality?: string }): Fake
    toPNG(): Buffer
    toJPEG(quality: number): Buffer
  }
  const fake = (width: number, height: number): Fake => ({
    isEmpty: () => width === 0 || height === 0,
    getSize: () => ({ width, height }),
    resize: (o) => fake(o.width, o.height),
    toPNG: () => Buffer.from(`png ${width}x${height}`),
    toJPEG: (quality) => Buffer.from(`jpeg ${width}x${height} q${quality}`),
  })
  return {
    nativeImage: {
      createFromBuffer: (bytes: Buffer) => {
        native.decoded++
        if (native.throws) throw new Error('the decoder crashed')
        const format = sniffFormat(bytes)
        const size = format && !native.fail ? imageSize(format, bytes) : { width: 0, height: 0 }
        return fake(size.width, size.height)
      },
    },
  }
})

beforeEach(() => {
  native.fail = false
  native.throws = false
  native.decoded = 0
})
afterAll(removeClaudeHomes)

const b64 = (bytes: Uint8Array) => Buffer.from(bytes).toString('base64')
/** A one-line log holding `bytes` as a pasted image: the source pointing at that line (with the
 *  image's listed size), and its id. */
function logWith(bytes: Uint8Array, mediaType = 'image/png'): { source: ImageSource; id: string } {
  const path = join(makeFolder('deck-pixels-'), 'log.jsonl')
  const line = JSON.stringify({ type: 'user', message: { role: 'user', content: [imageBlock(bytes, mediaType), { type: 'text', text: 'see' }] } })
  writeFileSync(path, `${line}\n`)
  return { source: { path, offset: 0, length: Buffer.byteLength(line), bytes: bytes.length }, id: imageId(b64(bytes)) }
}
/** What a data: URL holds: its type and its bytes as text. */
const decode = (data: { url?: string; error?: string }) => {
  const m = /^data:image\/([a-z]+);base64,(.*)$/.exec(data.url ?? '')
  return m ? { type: m[1], text: Buffer.from(m[2], 'base64').toString('latin1') } : data
}
/** A JPEG turned by its EXIF orientation: an APP1 Exif segment (one IFD0 entry, tag 0x0112) right
 *  after its SOI, and `app1Bytes` of plain APP1 segments after that. */
function turnedJpeg(orientation: number, width: number, height: number, app1Bytes = 0): Buffer {
  const tiff = Buffer.alloc(26) // big-endian header, then the 0th IFD at 8: one entry, no next IFD
  tiff.write('MM', 0, 'latin1')
  tiff.writeUInt16BE(42, 2)
  tiff.writeUInt32BE(8, 4)
  tiff.writeUInt16BE(1, 8)
  tiff.writeUInt16BE(0x0112, 10)
  tiff.writeUInt16BE(3, 12) // SHORT
  tiff.writeUInt32BE(1, 14)
  tiff.writeUInt16BE(orientation, 18)
  const data = Buffer.concat([Buffer.from('Exif\0\0', 'latin1'), tiff])
  const head = Buffer.from([0xff, 0xe1, 0, 0])
  head.writeUInt16BE(data.length + 2, 2)
  const plain = jpegBytes(width, height, { app1Bytes })
  return Buffer.concat([plain.subarray(0, 2), head, data, plain.subarray(2)])
}

describe('ImagePixels: thumbnails and full images', () => {
  it('a PNG or JPEG within 480×360 is its own thumbnail, and nothing is decoded', async () => {
    const pixels = new ImagePixels()
    for (const [bytes, type] of [[pngBytes(320, 200), 'png'], [jpegBytes(480, 360), 'jpeg']] as const) {
      const { source, id } = logWith(bytes)
      expect(await pixels.get(source, id, 'thumb')).toEqual({ url: `data:image/${type};base64,${b64(bytes)}` })
      expect(await pixels.get(source, id, 'full')).toEqual({ url: `data:image/${type};base64,${b64(bytes)}` })
    }
    expect(native.decoded).toBe(0)
  })

  it('a larger one is fitted into 480×360, never enlarged: a PNG as PNG, a JPEG as JPEG at 85', async () => {
    const pixels = new ImagePixels()
    const cases = [
      [pngBytes(1440, 900), { type: 'png', text: 'png 480x300' }],
      [pngHeaderBytes(1080, 2340), { type: 'png', text: 'png 166x360' }],
      [jpegBytes(1600, 1200), { type: 'jpeg', text: 'jpeg 480x360 q85' }],
      [jpegBytes(4000, 300), { type: 'jpeg', text: 'jpeg 480x36 q85' }],
    ] as const
    for (const [bytes, made] of cases) {
      const { source, id } = logWith(bytes)
      expect(decode(await pixels.get(source, id, 'thumb'))).toEqual(made)
    }
    expect(THUMB).toEqual({ width: 480, height: 360 })
  })

  it('the full image is the bytes themselves, re-encoded, under the type sniffed from them', async () => {
    const jpeg = jpegBytes(1600, 1200)
    const { source, id } = logWith(jpeg, 'image/png')
    expect(await new ImagePixels().get(source, id, 'full')).toEqual({ url: `data:image/jpeg;base64,${b64(jpeg)}` })
    expect(native.decoded).toBe(0)
  })

  it("GIF and WebP: the image itself up to 1 MiB, else No preview; their full image either way", async () => {
    const pixels = new ImagePixels()
    const gif = logWith(gifBytes(100, 50))
    expect(await pixels.get(gif.source, gif.id, 'thumb')).toEqual({ url: `data:image/gif;base64,${b64(gifBytes(100, 50))}` })
    const big = Buffer.concat([webpBytes(800, 600, 'VP8X'), Buffer.alloc(1024 * 1024)])
    const webp = logWith(big)
    expect(await pixels.get(webp.source, webp.id, 'thumb')).toEqual({ error: NO_PREVIEW })
    expect(await pixels.get(webp.source, webp.id, 'full')).toEqual({ url: `data:image/webp;base64,${b64(big)}` })
    expect(native.decoded).toBe(0)
  })

  it('a JPEG turned by its EXIF orientation is its own thumbnail up to 1 MiB, else No preview; its full image either way', async () => {
    const pixels = new ImagePixels()
    // nativeImage ignores the orientation, so a thumbnail made from it would come out turned back.
    for (const orientation of [6, 3]) {
      const turned = turnedJpeg(orientation, 1600, 1200)
      const { source, id } = logWith(turned, 'image/jpeg')
      expect(await pixels.get(source, id, 'thumb')).toEqual({ url: `data:image/jpeg;base64,${b64(turned)}` })
    }
    const big = turnedJpeg(6, 1600, 1200, 1024 * 1024)
    const large = logWith(big, 'image/jpeg')
    expect(await pixels.get(large.source, large.id, 'thumb')).toEqual({ error: NO_PREVIEW }) // it still opens upright
    expect(await pixels.get(large.source, large.id, 'full')).toEqual({ url: `data:image/jpeg;base64,${b64(big)}` })
    expect(native.decoded).toBe(0)
    // Orientation 1 is the picture as stored: fitted as any other JPEG.
    const upright = logWith(turnedJpeg(1, 1600, 1200), 'image/jpeg')
    expect(decode(await pixels.get(upright.source, upright.id, 'thumb'))).toEqual({ type: 'jpeg', text: 'jpeg 480x360 q85' })
  })

  it('a PNG or JPEG within 480×360 whose bytes are over 1 MiB is made again, at its own size', async () => {
    const pixels = new ImagePixels()
    const cases = [
      [Buffer.concat([pngBytes(320, 200), Buffer.alloc(1024 * 1024)]), { type: 'png', text: 'png 320x200' }],
      [jpegBytes(400, 300, { app1Bytes: 1024 * 1024 }), { type: 'jpeg', text: 'jpeg 400x300 q85' }],
    ] as const
    for (const [bytes, made] of cases) {
      const { source, id } = logWith(bytes)
      expect(decode(await pixels.get(source, id, 'thumb'))).toEqual(made)
    }
    expect(native.decoded).toBe(2)
  })

  it('more than 16,384 px a side or 40 MP is Too large to show, before anything is decoded', async () => {
    const pixels = new ImagePixels()
    for (const bytes of [pngHeaderBytes(16_385, 10), pngHeaderBytes(10, 20_000), pngHeaderBytes(8000, 6000), gifBytes(16_000, 16_000)]) {
      const { source, id } = logWith(bytes)
      expect(await pixels.get(source, id, 'thumb')).toEqual({ error: TOO_LARGE })
      expect(await pixels.get(source, id, 'full')).toEqual({ error: TOO_LARGE })
    }
    expect(native.decoded).toBe(0)
  })

  it("a decode that fails, or a header that gives no size, is Couldn't decode this image", async () => {
    const pixels = new ImagePixels()
    native.fail = true
    const png = logWith(pngBytes(1440, 900))
    expect(await pixels.get(png.source, png.id, 'thumb')).toEqual({ error: UNDECODABLE })
    const broken = logWith(Buffer.from([0xff, 0xd8, 0xff, 0xda, 0, 8, 1, 2, 3, 4, 5, 6]))
    expect(await pixels.get(broken.source, broken.id, 'thumb')).toEqual({ error: UNDECODABLE })
    expect(await pixels.get(broken.source, broken.id, 'full')).toEqual({ error: UNDECODABLE })
  })

  it("a decoder that throws is Couldn't decode this image, and the next request still runs", async () => {
    const pixels = new ImagePixels()
    const png = logWith(pngBytes(1440, 900))
    native.throws = true
    expect(await pixels.get(png.source, png.id, 'thumb')).toEqual({ error: UNDECODABLE })
    native.throws = false
    expect(decode(await pixels.get(png.source, png.id, 'thumb'))).toEqual({ type: 'png', text: 'png 480x300' })
  })

  it('a line that no longer holds the image, a missing log or a line cut short is No longer in the session log', async () => {
    const pixels = new ImagePixels()
    const { source, id } = logWith(pngBytes(8, 8))
    const other = logWith(pngBytes(9, 8))
    expect(await pixels.get(other.source, id, 'thumb')).toEqual({ error: GONE })
    expect(await pixels.get({ ...source, path: `${source.path}.gone` }, id, 'thumb')).toEqual({ error: GONE })
    expect(await pixels.get({ ...source, length: source.length - 5 }, id, 'thumb')).toEqual({ error: GONE })
    expect(await pixels.get({ ...source, offset: source.offset + 3 }, id, 'full')).toEqual({ error: GONE })
    // The image is looked for with the size it was listed with.
    expect(await pixels.get({ ...source, bytes: source.bytes + 1 }, id, 'thumb')).toEqual({ error: GONE })
    expect(await pixels.get(source, id, 'thumb')).toHaveProperty('url')
  })

  it('a line too long to read again is refused before it is read', async () => {
    const read = vi.fn(async () => Buffer.alloc(0))
    const pixels = new ImagePixels(read)
    for (const length of [MAX_LINE + 1, 0, -1, Number.NaN]) {
      expect(await pixels.get({ path: 'x', offset: 0, length, bytes: 1 }, '0123456789abcdef', 'thumb')).toEqual({ error: TOO_LARGE })
    }
    expect(read).not.toHaveBeenCalled()
  })
})

describe('ImagePixels: Open', () => {
  it("bytes(): the image's own bytes and format, with no size limit", async () => {
    const bytes = pngHeaderBytes(20_000, 20_000)
    const { source, id } = logWith(bytes)
    const got = await new ImagePixels().bytes(source, id)
    expect(got).toMatchObject({ format: 'png' })
    expect('bytes' in got && Buffer.compare(got.bytes, bytes)).toBe(0)
    expect(await new ImagePixels().bytes(source, '0123456789abcdef')).toEqual({ error: GONE })
  })

  it('bytes(): a line too long to read again is refused before it is read', async () => {
    const read = vi.fn(async () => Buffer.alloc(0))
    const got = await new ImagePixels(read).bytes({ path: 'x', offset: 0, length: MAX_LINE + 1, bytes: 1 }, '0123456789abcdef')
    expect(got).toEqual({ error: TOO_LARGE })
    expect(read).not.toHaveBeenCalled()
  })
})

describe('ImagePixels: the queue', () => {
  it('runs one request at a time, full images and Open first, and a failure does not stop the next', async () => {
    const order: string[] = []
    let running = 0
    let most = 0
    const files = new Map<string, Buffer>()
    const pixels = new ImagePixels(async (source) => {
      running++
      most = Math.max(most, running)
      order.push(source.path)
      await new Promise((r) => setTimeout(r, 5))
      running--
      if (source.path === 'broken') throw new Error('EIO')
      return files.get(source.path)!
    })
    const add = (name: string, bytes: Uint8Array) => {
      const line = Buffer.from(JSON.stringify({ message: { content: [imageBlock(bytes)] } }))
      files.set(name, line)
      return { source: { path: name, offset: 0, length: line.length, bytes: bytes.length }, id: imageId(b64(bytes)) }
    }
    const a = add('thumb a', pngBytes(8, 8))
    const b = add('thumb b', pngBytes(9, 8))
    const c = add('full c', pngBytes(10, 8))
    const d = add('open d', pngBytes(11, 8))
    const answers = Promise.all([
      pixels.get(a.source, a.id, 'thumb'),
      pixels.get(b.source, b.id, 'thumb'),
      pixels.get({ ...c.source, path: 'broken' }, c.id, 'full'),
      pixels.bytes(d.source, d.id),
      pixels.get(c.source, c.id, 'full'),
    ])
    const [ta, tb, broken, opened, full] = await answers
    expect(order).toEqual(['thumb a', 'broken', 'open d', 'full c', 'thumb b'])
    expect(most).toBe(1)
    expect(ta).toHaveProperty('url')
    expect(tb).toHaveProperty('url')
    expect(broken).toEqual({ error: GONE })
    expect(opened).toMatchObject({ format: 'png' })
    expect(full).toHaveProperty('url')
  })

  it('a read that never finishes answers after JOB_TIMEOUT_MS, the next request runs, and the late result is dropped', async () => {
    vi.useFakeTimers({ toFake: ['setTimeout', 'clearTimeout'] }) // setImmediate, between two jobs, stays real
    try {
      const lines = new Map<string, Buffer>()
      let finish: (line: Buffer) => void = () => {}
      const pixels = new ImagePixels((source) => source.path === 'hung'
        ? new Promise<Buffer>((resolve) => { finish = resolve }) // a hung network volume
        : Promise.resolve(lines.get(source.path)!))
      const add = (name: string, bytes: Uint8Array) => {
        const line = Buffer.from(JSON.stringify({ message: { content: [imageBlock(bytes)] } }))
        lines.set(name, line)
        return { source: { path: name, offset: 0, length: line.length, bytes: bytes.length }, id: imageId(b64(bytes)) }
      }
      const a = add('a', pngBytes(8, 8))
      const b = add('b', pngBytes(9, 8))
      const answered: string[] = []
      const hung = pixels.bytes({ ...a.source, path: 'hung' }, a.id).then((r) => (answered.push('hung'), r))
      const next = pixels.get(b.source, b.id, 'thumb').then((r) => (answered.push('next'), r))
      await vi.advanceTimersByTimeAsync(JOB_TIMEOUT_MS - 1)
      expect(answered).toEqual([])
      await vi.advanceTimersByTimeAsync(1)
      expect(await hung).toEqual({ error: UNREADABLE })
      expect(await next).toHaveProperty('url')
      expect(answered).toEqual(['hung', 'next'])
      // The read comes back after all: its answer has gone already, so it is dropped.
      finish(lines.get('a')!)
      await vi.advanceTimersByTimeAsync(0)
      expect(await hung).toEqual({ error: UNREADABLE })
      expect(vi.getTimerCount()).toBe(0) // every job's timer is cleared or has run
    } finally {
      vi.useRealTimers()
    }
  })

  it('a request after the queue ran dry starts it again', async () => {
    const pixels = new ImagePixels()
    const one = logWith(pngBytes(8, 8))
    expect(await pixels.get(one.source, one.id, 'thumb')).toHaveProperty('url')
    await new Promise((r) => setImmediate(r))
    const two = logWith(pngBytes(9, 8))
    expect(await pixels.get(two.source, two.id, 'thumb')).toHaveProperty('url')
  })
})
