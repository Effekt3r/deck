import { open } from 'node:fs/promises'
import { nativeImage } from 'electron'
import { fitInto, GONE, NO_PREVIEW, TOO_LARGE, UNDECODABLE, UNREADABLE } from '@shared/claude-images'
import type { ClaudeImageData, ClaudeImageFormat } from '@shared/types'
import { findImageData, imageSize, type ImageSize, jpegOrientation, sniffFormat } from './images'

/** Where an image's line is (the followed log, and the line's place in it), and the image's size as
 *  it was listed: the image is looked for in that line by its id and that size. */
export interface ImageSource {
  path: string
  offset: number
  length: number
  /** The image's size decoded, as the feed lists it (ClaudeImage.bytes). */
  bytes: number
}

/** A line longer than this isn't read again (the longest measured was 2.2 MB). */
export const MAX_LINE = 64 * 1024 * 1024
/** Thumbnails fit 480×360: twice the panel's 240×180 box, for Retina screens. */
export const THUMB = { width: 480, height: 360 }
/** A request still unanswered this long after its turn came (its read hung: a network volume under
 *  CLAUDE_CONFIG_DIR, say) answers UNREADABLE, and the next one starts; whatever it gets later is
 *  dropped. Reading a line again took 0.1–0.9 ms (measured). */
export const JOB_TIMEOUT_MS = 15_000
/** Larger than this, by the header (which is what a decoder goes by), isn't decoded or shown: the
 *  largest measured was 3.4 MP. */
const MAX_SIDE = 16_384
const MAX_PIXELS = 40_000_000
/** A thumbnail that is the image itself is at most this size. GIF and WebP can't be decoded here
 *  (nativeImage reads neither), and a JPEG turned by its EXIF orientation would come out turned back,
 *  so beyond it they have none (NO_PREVIEW); a PNG or JPEG within 480×360 is made again instead. */
const MAX_PASSTHROUGH = 1024 * 1024
/** JPEG thumbnails' quality: 9–27 KB at 480×360 (measured). */
const JPEG_QUALITY = 85

interface Loaded {
  bytes: Buffer
  format: ClaudeImageFormat
  size: ImageSize
}

type Job = () => Promise<void>

const nextTurn = () => new Promise<void>((resolve) => setImmediate(resolve))
// A view of the bytes, not a copy: they can be megabytes, and the URL is another copy already.
const dataUrl = (format: ClaudeImageFormat, bytes: Uint8Array) =>
  `data:image/${format};base64,${Buffer.from(bytes.buffer, bytes.byteOffset, bytes.byteLength).toString('base64')}`
const tooLarge = (size: ImageSize) => size.width > MAX_SIDE || size.height > MAX_SIDE || size.width * size.height > MAX_PIXELS

/** The line's bytes, read again: fewer when the file has shrunk since. */
async function readLine(source: ImageSource): Promise<Buffer> {
  const fh = await open(source.path, 'r')
  try {
    const buffer = Buffer.allocUnsafe(source.length)
    let got = 0
    while (got < source.length) {
      const { bytesRead } = await fh.read(buffer, got, source.length - got, source.offset + got)
      if (bytesRead === 0) break
      got += bytesRead
    }
    return buffer.subarray(0, got)
  } finally {
    await fh.close()
  }
}

/**
 * Images' pixels, read again from their lines in the session log when the panel shows them: main
 * keeps none. One request at a time, a full image (or an Open) ahead of thumbnails, with a turn of
 * the event loop between two, so terminal output and other IPC go on (the longest step measured was
 * 16 ms). Nothing here throws: every request answers, with { error } when it must, within
 * JOB_TIMEOUT_MS of starting.
 */
export class ImagePixels {
  private readonly first: Job[] = []
  private readonly thumbs: Job[] = []
  private running = false

  constructor(private readonly read: (source: ImageSource) => Promise<Buffer> = readLine) {}

  /** 'thumb': fits 480×360 (PNG or JPEG as its source; GIF, WebP or a turned JPEG itself); 'full':
   *  the image itself. */
  get(source: ImageSource, id: string, size: 'thumb' | 'full'): Promise<ClaudeImageData> {
    return this.queue(size === 'full' ? this.first : this.thumbs, async () => {
      const loaded = await this.load(source, id)
      if ('error' in loaded) return loaded
      return size === 'full' ? this.full(loaded) : this.thumb(loaded)
    }, { error: UNDECODABLE })
  }

  /** The image's own bytes and format, for Open. No size limit: Open is how a large one is seen. */
  bytes(source: ImageSource, id: string): Promise<{ bytes: Buffer; format: ClaudeImageFormat } | { error: string }> {
    return this.queue(this.first, async () => {
      const loaded = await this.load(source, id)
      return 'error' in loaded ? loaded : { bytes: loaded.bytes, format: loaded.format }
    }, { error: GONE })
  }

  /** Runs `work` in its turn: `failed` if it throws, UNREADABLE if it hasn't finished JOB_TIMEOUT_MS
   *  after it started (its late result is dropped: the request has its answer, the next has started). */
  private queue<T>(lane: Job[], work: () => Promise<T>, failed: T): Promise<T | { error: string }> {
    return new Promise((resolve) => {
      lane.push(async () => {
        let timer: NodeJS.Timeout | undefined
        const timedOut = new Promise<{ error: string }>((r) => {
          timer = setTimeout(() => r({ error: UNREADABLE }), JOB_TIMEOUT_MS)
        })
        try {
          resolve(await Promise.race([work(), timedOut]))
        } catch {
          resolve(failed)
        } finally {
          clearTimeout(timer)
        }
      })
      void this.pump()
    })
  }

  private async pump(): Promise<void> {
    if (this.running) return
    this.running = true
    try {
      for (;;) {
        const job = this.first.shift() ?? this.thumbs.shift()
        if (!job) break
        await job()
        await nextTurn()
      }
    } finally {
      // As the loop ends, synchronously: a job queued after the last shift() starts its own pump.
      this.running = false
    }
  }

  /** The line read again and the image in it whose id is `id` (and whose size is the one listed),
   *  decoded from base64 (its header read over all of its bytes). Bounded before each step: the
   *  line's length, then (findImageData) the base64's. */
  private async load(source: ImageSource, id: string): Promise<Loaded | { error: string }> {
    if (!(source.length > 0) || source.length > MAX_LINE) return { error: TOO_LARGE }
    let entry: unknown
    try {
      entry = JSON.parse((await this.read(source)).toString('utf8'))
    } catch {
      return { error: GONE } // deleted, cut short, or rewritten so the place holds something else
    }
    const data = findImageData(entry, id, source.bytes)
    if (data === null) return { error: GONE }
    const bytes = Buffer.from(data, 'base64')
    const format = sniffFormat(bytes)
    if (!format) return { error: UNDECODABLE }
    return { bytes, format, size: imageSize(format, bytes) }
  }

  private full({ bytes, format, size }: Loaded): ClaudeImageData {
    if (!size.width || !size.height) return { error: UNDECODABLE }
    if (tooLarge(size)) return { error: TOO_LARGE }
    // Encoded again from the decoded bytes: the URL holds only base64 and the type sniffed here.
    return { url: dataUrl(format, bytes) }
  }

  private thumb({ bytes, format, size }: Loaded): ClaudeImageData {
    if (!size.width || !size.height) return { error: UNDECODABLE }
    if (tooLarge(size)) return { error: TOO_LARGE }
    // nativeImage reads neither GIF nor WebP, and ignores a JPEG's EXIF orientation, which Chromium
    // honours: one made here would come out turned back (sideways, upside down or mirrored). So the
    // renderer gets the image itself, which the viewer and Open still show when it's too big for that.
    if (format === 'gif' || format === 'webp' || (format === 'jpeg' && jpegOrientation(bytes) !== 1)) {
      return bytes.length <= MAX_PASSTHROUGH ? { url: dataUrl(format, bytes) } : { error: NO_PREVIEW }
    }
    // Small enough to be its own thumbnail, unless its bytes aren't (metadata, no compression).
    if (size.width <= THUMB.width && size.height <= THUMB.height && bytes.length <= MAX_PASSTHROUGH) return { url: dataUrl(format, bytes) }
    const image = nativeImage.createFromBuffer(bytes)
    if (image.isEmpty()) return { error: UNDECODABLE }
    const fit = fitInto(image.getSize(), THUMB)
    const small = image.resize({ width: fit.width, height: fit.height, quality: 'good' })
    if (small.isEmpty()) return { error: UNDECODABLE }
    // PNG stays PNG (85% of them have alpha); a JPEG photo as JPEG is a third of the size and time.
    return format === 'png' ? { url: dataUrl('png', small.toPNG()) } : { url: dataUrl('jpeg', small.toJPEG(JPEG_QUALITY)) }
  }
}
