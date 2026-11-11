import { createHash } from 'node:crypto'
import { describe, expect, it } from 'vitest'
import { findImageData, IMAGE_EXT, imageId, imageRef, imageSize, imagesOf, MAX_BASE64, sniffFormat } from './images'
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

  it("finds the image in a prompt's content, a tool result's content or a queued prompt's blocks", () => {
    expect(findImageData({ type: 'user', message: { content: [block(other), block(png), { type: 'text', text: 'x' }] } }, id)).toBe(png)
    expect(findImageData({ type: 'user', message: { content: [{ type: 'tool_result', tool_use_id: 't1', content: [{ type: 'text', text: 'ok' }, block(png)] }] } }, id)).toBe(png)
    expect(findImageData({ type: 'attachment', attachment: { type: 'queued_command', prompt: [block(png)] } }, id)).toBe(png)
  })

  it("never looks in toolUseResult, and answers null for an id the entry doesn't hold", () => {
    expect(findImageData({ type: 'user', message: { content: [{ type: 'tool_result', content: [block(other)] }] }, toolUseResult: { file: { base64: png } } }, id)).toBeNull()
    expect(findImageData({ type: 'user', message: { content: [block(other)] } }, id)).toBeNull()
    for (const bad of [null, 42, {}, { message: { content: 'text' } }, { attachment: { prompt: 'text' } }]) expect(findImageData(bad, id)).toBeNull()
  })
})

describe('IMAGE_EXT', () => {
  it('names the file Open writes', () => {
    expect(IMAGE_EXT).toEqual({ png: 'png', jpeg: 'jpg', gif: 'gif', webp: 'webp' })
  })
})
