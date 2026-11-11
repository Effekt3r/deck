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

/** The first SOF marker's size, walking the segments from the start; none once the scan starts
 *  (the picture's data follows), or when the bytes stop making sense. */
function jpegSize(b: Uint8Array): ImageSize {
  let i = 2
  while (i + 1 < b.length) {
    if (b[i] !== 0xff) return NONE
    const marker = b[i + 1]
    if (marker === 0xff) {
      i++ // a fill byte
      continue
    }
    i += 2
    if (marker === 0xd8 || marker === 0x01 || (marker >= 0xd0 && marker <= 0xd7)) continue // no length
    if (marker === 0xd9 || marker === 0xda || i + 1 >= b.length) return NONE
    const length = u16be(b, i)
    if (length < 2) return NONE
    if (isSof(marker)) return i + 6 < b.length ? { width: u16be(b, i + 5), height: u16be(b, i + 3) } : NONE
    i += length
  }
  return NONE
}

/** The logical screen's size. */
function gifSize(b: Uint8Array): ImageSize {
  return b.length >= 10 ? { width: u16le(b, 6), height: u16le(b, 8) } : NONE
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

/** The size an image's header gives, which is what a decoder goes by; 0×0 when it doesn't say. */
export function imageSize(format: ClaudeImageFormat, b: Uint8Array): ImageSize {
  switch (format) {
    case 'png':
      return pngSize(b)
    case 'jpeg':
      return jpegSize(b)
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

/** The first 16 hex digits of the SHA-1 of an image's base64 text: a fresh string that keeps nothing
 *  of the line alive, and says nothing about the session. */
export const imageId = (base64: string): string => createHash('sha1').update(base64).digest('hex').slice(0, 16)

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

/** The base64 text of the image block in `entry` whose id is `id`: in a prompt's content, a
 *  tool_result's content or a queued prompt's blocks, never toolUseResult (which repeats Read's
 *  image). null when there's none, e.g. the log was rewritten since the id was listed. */
export function findImageData(entry: unknown, id: string): string | null {
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
      if (data !== null && imageId(data) === id) return data
    }
  }
  return null
}
