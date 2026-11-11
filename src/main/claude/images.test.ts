import { createHash } from 'node:crypto'
import { describe, expect, it } from 'vitest'
import { findImageData, IMAGE_EXT, imageId, imageRef, imageSize, imagesOf, jpegOrientation, MAX_BASE64, sniffFormat } from './images'
import { gifBytes, imageBlock, jpegBytes, pngBytes, pngHeaderBytes, webpBytes } from './test-log'

const b64 = (bytes: Uint8Array) => Buffer.from(bytes).toString('base64')
const block = (data: string) => ({ type: 'image', source: { type: 'base64', media_type: 'image/png', data } })

describe('sniffFormat', () => {
  it('tells PNG, JPEG, GIF and WebP from their first bytes', () => {
    expect(sniffFormat(pngBytes(2, 2))).toBe('png')
    expect(sniffFormat(jpegBytes(2, 2))).toBe('jpeg')
    expect(sniffFormat(gifBytes(2, 2))).toBe('gif')
    expect(sniffFormat(Buffer.from('GIF87a....'))).toBe('gif')
    expect(sniffFormat(webpBytes(2, 2))).toBe('webp')
  })

  it('anything else, or too few bytes, is no format', () => {
    for (const bytes of [Buffer.from('%PDF-1.7'), Buffer.from('BM6\x00'), Buffer.from([0x89, 0x50]), Buffer.from('RIFF\x00\x00\x00\x00WAVE'), Buffer.alloc(0)]) {
      expect(sniffFormat(bytes)).toBeNull()
    }
  })
})

describe('imageSize', () => {
  it("PNG: IHDR's width and height", () => {
    expect(imageSize('png', pngBytes(1440, 900))).toEqual({ width: 1440, height: 900 })
    expect(imageSize('png', pngHeaderBytes(20_000, 10))).toEqual({ width: 20_000, height: 10 })
  })

  it('JPEG: the first SOF, baseline or progressive, behind a large APP1 segment', () => {
    expect(imageSize('jpeg', jpegBytes(923, 2000))).toEqual({ width: 923, height: 2000 })
    expect(imageSize('jpeg', jpegBytes(1600, 1200, { progressive: true, app1Bytes: 60_000 }))).toEqual({ width: 1600, height: 1200 })
  })

  it('GIF and WebP in its three forms', () => {
    expect(imageSize('gif', gifBytes(100, 50))).toEqual({ width: 100, height: 50 })
    expect(imageSize('webp', webpBytes(640, 480, 'VP8'))).toEqual({ width: 640, height: 480 })
    expect(imageSize('webp', webpBytes(641, 481, 'VP8L'))).toEqual({ width: 641, height: 481 })
    expect(imageSize('webp', webpBytes(5000, 3000, 'VP8X'))).toEqual({ width: 5000, height: 3000 })
  })

  it('0×0 when the header is cut short or makes no sense', () => {
    const none = { width: 0, height: 0 }
    expect(imageSize('png', pngBytes(10, 10).subarray(0, 20))).toEqual(none)
    expect(imageSize('jpeg', jpegBytes(800, 600).subarray(0, 8))).toEqual(none)
    expect(imageSize('jpeg', jpegBytes(800, 600, { app1Bytes: 1000 }).subarray(0, 500))).toEqual(none)
    expect(imageSize('jpeg', Buffer.from([0xff, 0xd8, 0xff, 0xe0, 0x00, 0x01, 0x00]))).toEqual(none) // length < 2
    expect(imageSize('jpeg', Buffer.from([0xff, 0xd8, 0x12, 0x34, 0x56]))).toEqual(none) // lost sync
    expect(imageSize('jpeg', Buffer.from([0xff, 0xd8, 0xff, 0xda, 0x00, 0x08, 0, 0, 0, 0, 0, 0]))).toEqual(none) // the scan before any SOF
    expect(imageSize('gif', gifBytes(1, 1).subarray(0, 8))).toEqual(none)
    expect(imageSize('webp', webpBytes(10, 10).subarray(0, 24))).toEqual(none)
    expect(imageSize('webp', Buffer.from('RIFF\x10\x00\x00\x00WEBPABCD\x00\x00\x00\x00......'))).toEqual(none)
  })

  it('a PNG width of 0xFFFFFFFF stays unsigned', () => {
    expect(imageSize('png', pngHeaderBytes(0xffffffff, 1))).toEqual({ width: 0xffffffff, height: 1 })
  })
})

describe('imageRef', () => {
  it("id, format, size, bytes and paste number; the id is the SHA-1 of the base64 text, cut to 16 hex digits", () => {
    const png = pngBytes(64, 48)
    const data = b64(png)
    expect(imageRef(block(data), 3)).toEqual({
      id: createHash('sha1').update(data).digest('hex').slice(0, 16), format: 'png', width: 64, height: 48, bytes: png.length, paste: 3,
    })
    expect(imageRef(block(data))).not.toHaveProperty('paste')
    expect(imageId(data)).toMatch(/^[0-9a-f]{16}$/)
  })

  it('the bytes decide the format, not media_type', () => {
    expect(imageRef(imageBlock(jpegBytes(320, 240), 'image/png'))).toMatchObject({ format: 'jpeg', width: 320, height: 240 })
    expect(imageRef(imageBlock(gifBytes(7, 9), 'image/jpeg'))).toMatchObject({ format: 'gif', width: 7, height: 9 })
    expect(imageRef(imageBlock(webpBytes(30, 20, 'VP8L'), 'image/png'))).toMatchObject({ format: 'webp', width: 30, height: 20 })
  })

  it("a JPEG whose size marker is past its first 96 KiB is listed without a size", () => {
    expect(imageRef(imageBlock(jpegBytes(1600, 1200, { app1Bytes: 120_000 }), 'image/jpeg'))).toMatchObject({ format: 'jpeg', width: 0, height: 0 })
  })

  it('a GIF with a global colour table whose first frame overhangs the screen lists the grown size', () => {
    const header = Buffer.from(gifBytes(100, 50).subarray(0, 13)) // a copy: it's mutated next
    header[10] = 0x80 | 7 // a global colour table follows: 256 entries, 768 bytes
    const globalColourTable = Buffer.alloc(3 * 256)
    const graphicControlExtension = Buffer.from([0x21, 0xf9, 4, 0, 0, 0, 0, 0])
    const imageDescriptor = Buffer.alloc(9)
    imageDescriptor[0] = 0x2c
    imageDescriptor.writeUInt16LE(300, 5) // width
    imageDescriptor.writeUInt16LE(200, 7) // height
    const gif = Buffer.concat([header, globalColourTable, graphicControlExtension, imageDescriptor])
    expect(imageRef(imageBlock(gif))).toMatchObject({ format: 'gif', width: 300, height: 200 })
  })

  it('skips URL and file sources, empty data, text over 16 MiB, other formats and non-blocks', () => {
    const png = b64(pngBytes(2, 2))
    for (const bad of [
      { type: 'image', source: { type: 'url', url: 'https://example.com/a.png' } },
      { type: 'image', source: { type: 'file', file_id: 'file_123' } },
      block(''),
      block(png + 'A'.repeat(MAX_BASE64)),
      block(b64(Buffer.from('%PDF-1.7 not an image'))),
      { type: 'image', source: { type: 'base64', data: 42 } },
      { type: 'image' },
      { type: 'text', text: png },
      null, 'image', 42,
    ]) {
      expect(imageRef(bad)).toBeNull()
    }
  })

  it('exactly MAX_BASE64 characters of base64 text is still listed', () => {
    const data = b64(pngBytes(2, 2)).padEnd(MAX_BASE64, 'A')
    expect(data.length).toBe(MAX_BASE64)
    expect(imageRef(block(data))).toMatchObject({ format: 'png', bytes: Buffer.byteLength(data, 'base64') })
  })
})

describe('imagesOf', () => {
  const a = imageBlock(pngBytes(4, 4))
  const b = imageBlock(pngBytes(5, 4))
  const url = { type: 'image', source: { type: 'url', url: 'https://example.com/x.png' } }

  it('the image blocks in order, numbered by imagePasteIds when it has one positive integer per image block', () => {
    const blocks = [a, { type: 'text', text: 'look' }, url, b]
    expect(imagesOf(blocks, [1, 2, 3]).map((r) => [r.width, r.paste])).toEqual([[4, 1], [5, 3]])
    for (const ids of [undefined, [1, 2], [1, 2, 3, 4], [1, 0, 3], [1, '2', 3], [1.5, 2, 3], 'x']) {
      expect(imagesOf(blocks, ids).map((r) => r.paste)).toEqual([undefined, undefined])
    }
  })

  it('the same image twice gets one id', () => {
    const [x, y] = imagesOf([a, imageBlock(pngBytes(4, 4))])
    expect(x.id).toBe(y.id)
  })
})

describe('findImageData', () => {
  const png = b64(pngBytes(8, 8))
  const other = b64(pngBytes(9, 8))
  const id = imageId(png)
  const bytes = Buffer.byteLength(png, 'base64')

  it("finds the image in a prompt's content, a tool result's content or a queued prompt's blocks", () => {
    expect(findImageData({ type: 'user', message: { content: [block(other), block(png), { type: 'text', text: 'x' }] } }, id, bytes)).toBe(png)
    expect(findImageData({ type: 'user', message: { content: [{ type: 'tool_result', tool_use_id: 't1', content: [{ type: 'text', text: 'ok' }, block(png)] }] } }, id, bytes)).toBe(png)
    expect(findImageData({ type: 'attachment', attachment: { type: 'queued_command', prompt: [block(png)] } }, id, bytes)).toBe(png)
  })

  it("never looks in toolUseResult, and answers null for an id the entry doesn't hold", () => {
    expect(findImageData({ type: 'user', message: { content: [{ type: 'tool_result', content: [block(other)] }] }, toolUseResult: { file: { base64: png } } }, id, bytes)).toBeNull()
    expect(findImageData({ type: 'user', message: { content: [block(other)] } }, id, bytes)).toBeNull()
    for (const bad of [null, 42, {}, { message: { content: 'text' } }, { attachment: { prompt: 'text' } }]) expect(findImageData(bad, id, bytes)).toBeNull()
  })

  it('skips a candidate whose decoded size misses the listed bytes, before it would be hashed', () => {
    expect(findImageData({ type: 'user', message: { content: [block(png)] } }, id, Buffer.byteLength(other, 'base64'))).toBeNull()
  })
})

describe('IMAGE_EXT', () => {
  it('names the file Open writes', () => {
    expect(IMAGE_EXT).toEqual({ png: 'png', jpeg: 'jpg', gif: 'gif', webp: 'webp' })
  })
})

describe('imageSize agrees with the decoders', () => {
  it('JPEG: FF 00 and junk between segments are skipped, as libjpeg does', () => {
    const real = jpegBytes(600, 400)
    const smallSof = Buffer.from([0xff, 0xc0, 0x00, 0x11, 0x08, 0x00, 0x10, 0x00, 0x10, 0x03, 1, 0x22, 0, 2, 0x11, 1, 3, 0x11, 1])
    const app1 = Buffer.alloc(34); app1[0] = 0xff; app1[1] = 0xe1; app1.writeUInt16BE(32, 2); smallSof.copy(app1, 14)
    expect(imageSize('jpeg', Buffer.concat([Buffer.from([0xff, 0xd8, 0xff, 0x00, 0x00, 0x10]), app1, real.subarray(2)]))).toEqual({ width: 600, height: 400 })
    expect(imageSize('jpeg', Buffer.concat([Buffer.from([0xff, 0xd8, 0, 0, 0]), real.subarray(2)]))).toEqual({ width: 600, height: 400 })
  })
  it("JPEG: a SOF inside an APP1 segment (an EXIF thumbnail's) isn't the image's", () => {
    const thumb = jpegBytes(160, 120)
    const app1 = Buffer.concat([Buffer.from([0xff, 0xe1, 0, thumb.length + 2]), thumb])
    expect(imageSize('jpeg', Buffer.concat([Buffer.from([0xff, 0xd8]), app1, jpegBytes(4000, 3000).subarray(2)]))).toEqual({ width: 4000, height: 3000 })
  })
  it('JPEG: fill bytes, and RSTn/TEM markers with no length field, are skipped before the SOF', () => {
    const real = jpegBytes(640, 480)
    const markers = Buffer.from([0xff, 0xff, 0xff, 0xd0, 0xff, 0xd7, 0xff, 0x01]) // fill bytes, then RST0, RST7, TEM
    expect(imageSize('jpeg', Buffer.concat([Buffer.from([0xff, 0xd8]), markers, real.subarray(2)]))).toEqual({ width: 640, height: 480 })
  })
  it('GIF: grown to cover the first frame; later frames and a cut-short head keep the screen', () => {
    const frame = (l: number, t: number, w: number, h: number) => { const d = Buffer.alloc(10); d[0] = 0x2c; d.writeUInt16LE(l, 1); d.writeUInt16LE(t, 3); d.writeUInt16LE(w, 5); d.writeUInt16LE(h, 7); return Buffer.concat([d, Buffer.from([2, 0])]) }
    const head = gifBytes(1, 1).subarray(0, 13)
    const ext = Buffer.from([0x21, 0xf9, 4, 0, 0, 0, 0, 0])
    expect(imageSize('gif', Buffer.concat([head, ext, frame(50, 50, 300, 200)]))).toEqual({ width: 350, height: 250 })
    expect(imageSize('gif', Buffer.concat([gifBytes(10, 10).subarray(0, 13), frame(0, 0, 10, 10), frame(0, 0, 300, 200)]))).toEqual({ width: 10, height: 10 })
    expect(imageSize('gif', head)).toEqual({ width: 1, height: 1 })
  })
})

/** A JPEG APP1 "Exif\0\0" segment with one IFD0 entry: tag 0x0112 (Orientation), as a SHORT. */
function exifApp1(orientation: number, big = true): Buffer {
  const u16 = (n: number) => { const buf = Buffer.alloc(2); if (big) buf.writeUInt16BE(n, 0); else buf.writeUInt16LE(n, 0); return buf }
  const u32 = (n: number) => { const buf = Buffer.alloc(4); if (big) buf.writeUInt32BE(n, 0); else buf.writeUInt32LE(n, 0); return buf }
  const entry = Buffer.concat([u16(0x0112), u16(3), u32(1), u16(orientation), Buffer.from([0, 0])])
  const tiff = Buffer.concat([Buffer.from(big ? 'MM' : 'II', 'latin1'), u16(42), u32(8), u16(1), entry, u32(0)])
  const data = Buffer.concat([Buffer.from('Exif\0\0', 'latin1'), tiff])
  const length = Buffer.alloc(2)
  length.writeUInt16BE(data.length + 2, 0)
  return Buffer.concat([Buffer.from([0xff, 0xe1]), length, data])
}

/** A real JPEG with an Exif APP1 (giving `orientation`) spliced in right after its SOI. */
function jpegWithExif(orientation: number, width: number, height: number, big = true): Buffer {
  const real = jpegBytes(width, height)
  return Buffer.concat([real.subarray(0, 2), exifApp1(orientation, big), real.subarray(2)])
}

describe('jpegOrientation', () => {
  it('reads tag 0x0112 from the APP1 Exif segment, in either byte order', () => {
    expect(jpegOrientation(jpegWithExif(6, 640, 480, true))).toBe(6)
    expect(jpegOrientation(jpegWithExif(6, 640, 480, false))).toBe(6)
  })

  it('is 1 for orientation 1, and when there is no Exif APP1 at all', () => {
    expect(jpegOrientation(jpegWithExif(1, 640, 480))).toBe(1)
    expect(jpegOrientation(jpegBytes(640, 480))).toBe(1)
  })

  it('is 1 for a broken Exif segment (the signature is not "Exif\\0\\0")', () => {
    const payload = Buffer.from('NotAnExifHere!', 'latin1') // 14 bytes: long enough, wrong signature
    const n = payload.length + 2
    const bogus = Buffer.concat([Buffer.from([0xff, 0xe1, n >> 8, n & 0xff]), payload])
    expect(jpegOrientation(Buffer.concat([Buffer.from([0xff, 0xd8]), bogus, jpegBytes(640, 480).subarray(2)]))).toBe(1)
  })
})

describe('imageSize: a rotated JPEG', () => {
  it('swaps width and height for an EXIF orientation of 5–8', () => {
    expect(imageSize('jpeg', jpegWithExif(6, 640, 480))).toEqual({ width: 480, height: 640 })
  })

  it('leaves width and height as the SOF gives them for orientation 1, or no Exif at all', () => {
    expect(imageSize('jpeg', jpegWithExif(1, 640, 480))).toEqual({ width: 640, height: 480 })
    expect(imageSize('jpeg', jpegBytes(640, 480))).toEqual({ width: 640, height: 480 })
  })
})
