import { appendFileSync, readFileSync, writeFileSync } from 'node:fs'
import { join } from 'node:path'
import { crc32, inflateSync } from 'node:zlib'
import { afterAll, describe, expect, it } from 'vitest'
import { gifBytes, imageBlock, jpegBytes, makeFolder, pngBytes, pngHeaderBytes, readLines, removeClaudeHomes, webpBytes } from './test-log'

afterAll(removeClaudeHomes)

/** The PNG's chunks: type, data, and whether its CRC is right. */
function chunks(png: Buffer) {
  const out: { type: string; data: Buffer; crcOk: boolean }[] = []
  for (let at = 8; at < png.length;) {
    const length = png.readUInt32BE(at)
    const type = png.toString('latin1', at + 4, at + 8)
    const data = png.subarray(at + 8, at + 8 + length)
    const crcOk = png.readUInt32BE(at + 8 + length) === crc32(png.subarray(at + 4, at + 8 + length)) >>> 0
    out.push({ type, data, crcOk })
    at += 12 + length
  }
  return out
}

describe('test-log image builders', () => {
  it('pngBytes is a whole PNG: signature, IHDR, pixel rows that inflate, IEND, every CRC right', () => {
    const png = pngBytes(30, 20, { alpha: true })
    expect([...png.subarray(0, 8)]).toEqual([0x89, 0x50, 0x4e, 0x47, 0x0d, 0x0a, 0x1a, 0x0a])
    const list = chunks(png)
    expect(list.map((c) => c.type)).toEqual(['IHDR', 'IDAT', 'IEND'])
    expect(list.every((c) => c.crcOk)).toBe(true)
    expect([list[0].data.readUInt32BE(0), list[0].data.readUInt32BE(4), list[0].data[9]]).toEqual([30, 20, 6])
    expect(inflateSync(list[1].data).length).toBe(20 * (1 + 30 * 4))
  })

  it('pngHeaderBytes has a header and no pixels; the others carry their sizes where decoders look', () => {
    expect(chunks(pngHeaderBytes(20_000, 10)).map((c) => c.type)).toEqual(['IHDR', 'IEND'])
    const jpeg = jpegBytes(923, 2000, { app1Bytes: 70_000 })
    const sof = jpeg.indexOf(Buffer.from([0xff, 0xc0]))
    expect(sof).toBeGreaterThan(70_000)
    expect([jpeg.readUInt16BE(sof + 5), jpeg.readUInt16BE(sof + 7)]).toEqual([2000, 923])
    expect(gifBytes(100, 50).toString('latin1', 0, 6)).toBe('GIF89a')
    expect(webpBytes(640, 480, 'VP8X').toString('latin1', 12, 16)).toBe('VP8X')
  })

  it('imageBlock is a base64 image block', () => {
    expect(imageBlock(Buffer.from([1, 2, 3]), 'image/jpeg')).toEqual({ type: 'image', source: { type: 'base64', media_type: 'image/jpeg', data: 'AQID' } })
  })
})

describe('readLines', () => {
  it("each whole line's entry and place in bytes; broken and blank lines skipped, a last line without its newline too", () => {
    const path = join(makeFolder('deck-lines-'), 'log.jsonl')
    writeFileSync(path, '{"a":"héllo ✻"}\n\nnot json\r\n{"b":2}\r\n')
    appendFileSync(path, '{"c":')
    const bytes = readFileSync(path)
    const lines = readLines(path)
    expect(lines.map((l) => l.entry)).toEqual([{ a: 'héllo ✻' }, { b: 2 }])
    for (const l of lines) expect(JSON.parse(bytes.toString('utf8', l.offset, l.offset + l.length))).toEqual(l.entry)
    expect(lines[0]).toMatchObject({ offset: 0, length: Buffer.byteLength('{"a":"héllo ✻"}') })
  })
})
