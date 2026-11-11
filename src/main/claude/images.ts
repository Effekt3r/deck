import { createHash } from 'node:crypto'
import type { ClaudeImage, ClaudeImageFormat } from '@shared/types'
import { isRecord } from './describe'

/** Base64 text longer than this (12 MiB decoded) isn't listed or read: the largest image in the
 *  measured logs was 512 KB. */
export const MAX_BASE64 = 16 * 1024 * 1024
/** A JPEG's size marker is looked for in its first 96 KiB: every one measured was within 39 KB. */
const JPEG_HEAD = 96 * 1024
/** Base64 characters decoded to tell the format and read a PNG, GIF or WebP header: 96 bytes. */
const HEAD_CHARS = 128

/** The files Open writes, by format. */
export const IMAGE_EXT: Record<ClaudeImageFormat, 'png' | 'jpg' | 'gif' | 'webp'> = { png: 'png', jpeg: 'jpg', gif: 'gif', webp: 'webp' }

export interface ImageSize {
  width: number
  height: number
}

const NONE: ImageSize = { width: 0, height: 0 }

const ascii = (b: Uint8Array, at: number, text: string): boolean => {
  for (let i = 0; i < text.length; i++) if (b[at + i] !== text.charCodeAt(i)) return false
  return true
}
const u16be = (b: Uint8Array, i: number) => (b[i] << 8) | b[i + 1]
const u16le = (b: Uint8Array, i: number) => b[i] | (b[i + 1] << 8)
const u24le = (b: Uint8Array, i: number) => b[i] | (b[i + 1] << 8) | (b[i + 2] << 16)
const u32be = (b: Uint8Array, i: number) => ((b[i] << 24) | (b[i + 1] << 16) | (b[i + 2] << 8) | b[i + 3]) >>> 0
const u32le = (b: Uint8Array, i: number) => (b[i] | (b[i + 1] << 8) | (b[i + 2] << 16) | (b[i + 3] << 24)) >>> 0

/** The format the bytes start with; null for anything else. */
export function sniffFormat(b: Uint8Array): ClaudeImageFormat | null {
  if (b.length >= 8 && b[0] === 0x89 && ascii(b, 1, 'PNG\r\n\x1a\n')) return 'png'
  if (b.length >= 3 && b[0] === 0xff && b[1] === 0xd8 && b[2] === 0xff) return 'jpeg'
  if (b.length >= 6 && (ascii(b, 0, 'GIF87a') || ascii(b, 0, 'GIF89a'))) return 'gif'
  if (b.length >= 12 && ascii(b, 0, 'RIFF') && ascii(b, 8, 'WEBP')) return 'webp'
  return null
}

/** IHDR, the first chunk: width and height at bytes 16 and 20. */
function pngSize(b: Uint8Array): ImageSize {
  return b.length >= 24 && ascii(b, 12, 'IHDR') ? { width: u32be(b, 16), height: u32be(b, 20) } : NONE
}

// SOF0–SOF15 carry the frame's size, except DHT (C4), JPG (C8) and DAC (CC).
const isSof = (marker: number) => marker >= 0xc0 && marker <= 0xcf && marker !== 0xc4 && marker !== 0xc8 && marker !== 0xcc

/** The first SOF marker's size, with markers read as libjpeg reads them (next_marker() in
 *  jdmarker.c): bytes that aren't 0xFF, fill bytes and FF 00 between segments are skipped. The size
 *  guard holds only if this is the SOF the decoder reads. None once the scan starts (the picture's
 *  data follows), or when the bytes run out. */
function jpegSize(b: Uint8Array): ImageSize {
  let i = 2
  for (;;) {
    while (i < b.length && b[i] !== 0xff) i++
    while (i < b.length && b[i] === 0xff) i++
    if (i >= b.length) return NONE
    const marker = b[i++]
    if (marker === 0x00 || marker === 0xd8 || marker === 0x01 || (marker >= 0xd0 && marker <= 0xd7)) continue // no length
    if (marker === 0xd9 || marker === 0xda || i + 1 >= b.length) return NONE
    const length = u16be(b, i)
    if (length < 2) return NONE
    if (isSof(marker)) return i + 6 < b.length ? { width: u16be(b, i + 5), height: u16be(b, i + 3) } : NONE
    i += length
  }
}

/** The EXIF orientation (1–8) an APP1 Exif segment gives: tag 0x0112 of the 0th IFD, found walking
 *  segments the same way jpegSize does. 1 (normal) when there's no Exif APP1, no such tag, or the
 *  bytes don't make sense (a bad TIFF header, or an IFD, entry or offset that runs past the segment
 *  or the buffer). */
export function jpegOrientation(b: Uint8Array): number {
  let i = 2
  for (;;) {
    while (i < b.length && b[i] !== 0xff) i++
    while (i < b.length && b[i] === 0xff) i++
    if (i >= b.length) return 1
    const marker = b[i++]
    if (marker === 0x00 || marker === 0xd8 || marker === 0x01 || (marker >= 0xd0 && marker <= 0xd7)) continue // no length
    if (marker === 0xd9 || marker === 0xda || i + 1 >= b.length) return 1
    const length = u16be(b, i)
    if (length < 2) return 1
    if (marker === 0xe1) {
      const orientation = exifOrientation(b, i + 2, i + length)
      if (orientation !== null) return orientation
    }
    i += length
  }
}

/** Tag 0x0112 (Orientation) of the 0th IFD in an Exif APP1's payload (`start` to `end`, the bytes
 *  after its length field): null when it doesn't start "Exif\0\0", its TIFF header's byte order mark
 *  or magic number isn't right, or the IFD, its entry or the offset to it runs past `end`. */
function exifOrientation(b: Uint8Array, start: number, end: number): number | null {
  if (end > b.length || end - start < 14 || !ascii(b, start, 'Exif\0\0')) return null
  const tiff = start + 6
  const little = b[tiff] === 0x49 && b[tiff + 1] === 0x49
  if (!little && !(b[tiff] === 0x4d && b[tiff + 1] === 0x4d)) return null
  const u16 = little ? u16le : u16be
  const u32 = little ? u32le : u32be
  if (u16(b, tiff + 2) !== 42) return null
  const ifd = tiff + u32(b, tiff + 4)
  if (ifd < tiff || ifd + 2 > end) return null
  const count = u16(b, ifd)
  for (let e = 0; e < count; e++) {
    const entry = ifd + 2 + e * 12
    if (entry + 12 > end) break
    if (u16(b, entry) === 0x0112 && u16(b, entry + 2) === 3) {
      const value = u16(b, entry + 8)
      return value >= 1 && value <= 8 ? value : null
    }
  }
  return null
}

/** The logical screen, grown to cover the first frame, as Chromium sizes a GIF; the screen alone
 *  when the bytes stop before that frame. */
function gifSize(b: Uint8Array): ImageSize {
  if (b.length < 10) return NONE
  const screen = { width: u16le(b, 6), height: u16le(b, 8) }
  let i = 13 + (b[10] & 0x80 ? 3 << ((b[10] & 7) + 1) : 0) // after the global colour table
  while (i < b.length) {
    if (b[i] === 0x2c) {
      if (i + 9 > b.length) return screen
      const right = u16le(b, i + 1) + u16le(b, i + 5)
      const bottom = u16le(b, i + 3) + u16le(b, i + 7)
      return { width: Math.max(screen.width, right), height: Math.max(screen.height, bottom) }
    }
    if (b[i] !== 0x21) return screen // the trailer, or bytes no decoder reads a frame from
    i += 2 // introducer and label, then sub-blocks up to an empty one
    while (i < b.length && b[i] !== 0) i += b[i] + 1
    i++
  }
  return screen
}

/** From the first chunk: lossy (VP8), lossless (VP8L) or extended (VP8X). */
function webpSize(b: Uint8Array): ImageSize {
  if (ascii(b, 12, 'VP8 ') && b.length >= 30 && b[23] === 0x9d && b[24] === 0x01 && b[25] === 0x2a) {
    return { width: u16le(b, 26) & 0x3fff, height: u16le(b, 28) & 0x3fff }
  }
  if (ascii(b, 12, 'VP8L') && b.length >= 25 && b[20] === 0x2f) {
    const bits = u32le(b, 21)
    return { width: (bits & 0x3fff) + 1, height: ((bits >>> 14) & 0x3fff) + 1 }
  }
  if (ascii(b, 12, 'VP8X') && b.length >= 30) return { width: u24le(b, 24) + 1, height: u24le(b, 27) + 1 }
  return NONE
}

/** The size an image's header gives, which is what a decoder goes by; 0×0 when it doesn't say. A
 *  JPEG's width and height are swapped for an EXIF orientation of 5–8, so this is its displayed
 *  size (what Chromium shows it at when it draws the image), not necessarily what its SOF gives. */
export function imageSize(format: ClaudeImageFormat, b: Uint8Array): ImageSize {
  switch (format) {
    case 'png':
      return pngSize(b)
    case 'jpeg': {
      const size = jpegSize(b)
      const orientation = jpegOrientation(b)
      return orientation >= 5 && orientation <= 8 ? { width: size.height, height: size.width } : size
    }
    case 'gif':
      return gifSize(b)
    case 'webp':
      return webpSize(b)
  }
}

/** The base64 text of an image block with a base64 source: non-empty and at most MAX_BASE64. null
 *  for anything else: a URL or file source (Deck never fetches one), empty or oversized data. */
function base64Of(block: unknown): string | null {
  if (!isRecord(block) || block.type !== 'image' || !isRecord(block.source)) return null
  const { type, data } = block.source
  return type === 'base64' && typeof data === 'string' && data.length > 0 && data.length <= MAX_BASE64 ? data : null
}

/** The SHA-1 of an image's base64 text, as the first 8 bytes in hex (16 characters): a fresh string
 *  that keeps nothing of the line alive, and says nothing about the session. */
export const imageId = (base64: string): string => createHash('sha1').update(base64).digest().toString('hex', 0, 8)

/** What the panel lists for an image block: null when it isn't one it shows (see base64Of), or its
 *  bytes aren't PNG, JPEG, GIF or WebP. Only the start of the base64 is decoded; the hash reads it all. */
export function imageRef(block: unknown, paste?: number): ClaudeImage | null {
  const data = base64Of(block)
  if (data === null) return null
  const head = Buffer.from(data.slice(0, HEAD_CHARS), 'base64')
  const format = sniffFormat(head)
  if (!format) return null
  const size = imageSize(format, format === 'jpeg' ? Buffer.from(data.slice(0, (JPEG_HEAD / 3) * 4), 'base64') : head)
  return {
    id: imageId(data), format, width: size.width, height: size.height, bytes: Buffer.byteLength(data, 'base64'),
    ...(paste ? { paste } : {}),
  }
}

/** The images among `blocks` that the panel shows, in order. `pasteIds` (an entry's imagePasteIds)
 *  numbers them when it holds one positive integer per image block, skipped ones included. */
export function imagesOf(blocks: readonly unknown[], pasteIds?: unknown): ClaudeImage[] {
  const images = blocks.filter((b) => isRecord(b) && b.type === 'image')
  const numbers = Array.isArray(pasteIds) && pasteIds.length === images.length
    && pasteIds.every((n) => Number.isInteger(n) && (n as number) > 0) ? (pasteIds as number[]) : null
  const refs: ClaudeImage[] = []
  images.forEach((block, i) => {
    const ref = imageRef(block, numbers?.[i])
    if (ref) refs.push(ref)
  })
  return refs
}

/** The base64 text of the image block in `entry` whose id is `id` and decoded size is `bytes` (its
 *  listed size, checked before hashing a candidate: cheap, and it rules out most of them): in a
 *  prompt's content, a tool_result's content or a queued prompt's blocks, never toolUseResult (which
 *  repeats Read's image). null when there's none, e.g. the log was rewritten since the id was listed. */
export function findImageData(entry: unknown, id: string, bytes: number): string | null {
  if (!isRecord(entry)) return null
  const lists: unknown[][] = []
  const message = isRecord(entry.message) ? entry.message : null
  if (message && Array.isArray(message.content)) {
    lists.push(message.content)
    for (const b of message.content) if (isRecord(b) && b.type === 'tool_result' && Array.isArray(b.content)) lists.push(b.content)
  }
  const attachment = isRecord(entry.attachment) ? entry.attachment : null
  if (attachment && Array.isArray(attachment.prompt)) lists.push(attachment.prompt)
  for (const list of lists) {
    for (const block of list) {
      const data = base64Of(block)
      if (data !== null && Buffer.byteLength(data, 'base64') === bytes && imageId(data) === id) return data
    }
  }
  return null
}
