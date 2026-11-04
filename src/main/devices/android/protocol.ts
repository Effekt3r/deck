// scrcpy 5.0.1's wire format, as its server reads and writes it. The protocol is internal to
// scrcpy and changes between versions: it must match resources/scrcpy-server.json's version.

/** The video codec id for H.264 ("h264"). scrcpy writes 0 or 1 on its *audio* socket when audio
 *  is disabled or its capture fails; on the video socket a failing encoder closes the socket
 *  instead, so this reader never needs to treat 0 or 1 as a valid video codec. */
export const CODEC_H264 = 0x68323634
/** The device's name, NUL-padded, on the first socket. */
const NAME_LENGTH = 64
const FLAG_SESSION = 0x80
const FLAG_CONFIG = 1n << 62n
const FLAG_KEY = 1n << 61n
/** Far above any frame at scrcpy's max_size=1600 (a raw 1600×720 frame is 1.7 MB): a bigger
 *  declared size is a corrupt stream, not a real packet. */
const MAX_PACKET = 16 * 1024 * 1024

export type VideoEvent =
  | { type: 'name'; name: string }
  | { type: 'codec'; codec: number }
  | { type: 'size'; width: number; height: number }
  | { type: 'packet'; config: boolean; key: boolean; data: Uint8Array }
  /** The stream makes no sense; this reader is done, and feed() now only ever returns []. */
  | { type: 'error'; message: string }

/** Reads scrcpy's video socket as it arrives, in chunks cut anywhere: the forward tunnel's dummy
 *  byte, the device's name (64 bytes), the codec id (4), then 12-byte headers: a capture session's
 *  (first bit set; width and height follow) or a packet's (flags and PTS, its size, then it).
 *
 *  Chunks are kept as a list, not concatenated: a corrupt or absurd declared size must never cost
 *  a reallocation (and recopy) of everything received so far, and a bad size is caught from the
 *  12-byte header alone, without first waiting for that many bytes to arrive. Once broken, feed()
 *  never throws and only ever returns []: a confused or hostile server can't wedge main. */
export class VideoReader {
  private chunks: Buffer[] = []
  private len = 0
  private stage: 'dummy' | 'name' | 'codec' | 'packets' = 'dummy'
  /** A packet whose header is read (so its size is already validated) and is collecting its
   *  payload as chunks arrive; `data` is allocated once, up front, and never grows. */
  private filling: { data: Uint8Array; filled: number; config: boolean; key: boolean } | null = null
  private sawSize = false
  private broken = false

  feed(chunk: Buffer): VideoEvent[] {
    if (this.broken) return []
    if (chunk.length) {
      this.chunks.push(chunk)
      this.len += chunk.length
    }
    const events: VideoEvent[] = []
    for (;;) {
      if (this.stage === 'dummy') {
        if (this.len < 1) break
        this.take(1)
        this.stage = 'name'
      } else if (this.stage === 'name') {
        if (this.len < NAME_LENGTH) break
        const raw = this.take(NAME_LENGTH)
        const end = raw.indexOf(0)
        events.push({ type: 'name', name: raw.toString('utf8', 0, end < 0 ? NAME_LENGTH : end) })
        this.stage = 'codec'
      } else if (this.stage === 'codec') {
        if (this.len < 4) break
        events.push({ type: 'codec', codec: this.take(4).readUInt32BE(0) })
        this.stage = 'packets'
      } else if (this.filling) {
        const f = this.filling
        this.fill(f)
        if (f.filled < f.data.length) break // chunks is now empty too
        this.filling = null
        events.push({ type: 'packet', config: f.config, key: f.key, data: f.data })
      } else {
        if (this.len < 12) break
        const head = this.take(12)
        if (head[0] & FLAG_SESSION) {
          const width = head.readUInt32BE(4)
          const height = head.readUInt32BE(8)
          if (width === 0 || width > 0xffff || height === 0 || height > 0xffff) {
            this.fail(events, `scrcpy sent a ${width}×${height} screen.`)
            break
          }
          this.sawSize = true
          events.push({ type: 'size', width, height })
          continue
        }
        const size = head.readUInt32BE(8)
        if (size === 0 || size > MAX_PACKET) {
          this.fail(events, `scrcpy sent a ${size}-byte packet.`)
          break
        }
        if (!this.sawSize) {
          this.fail(events, "scrcpy sent a frame before the screen's size.")
          break
        }
        const flags = head.readBigUInt64BE(0)
        // Allocated now, filled as bytes arrive: a slow, tiny-chunked packet never has to sit
        // fully buffered as a list, which is what made shift()ing it off, chunk by chunk, an
        // O(chunk count²) stall once that count ran into the tens of thousands.
        this.filling = { data: new Uint8Array(size), filled: 0, config: (flags & FLAG_CONFIG) !== 0n, key: (flags & FLAG_KEY) !== 0n }
      }
    }
    return events
  }

  private fail(events: VideoEvent[], message: string): void {
    events.push({ type: 'error', message })
    this.broken = true
    this.chunks = []
    this.len = 0
    this.filling = null
  }

  /** Copies as much of `f`'s remaining bytes as are currently buffered, consuming those chunks
   *  (so the chunk list never holds more than the latest feed() added). Leaves `f.filled` short
   *  of `f.data.length` when there still isn't enough: the chunk list is then empty too. */
  private fill(f: { data: Uint8Array; filled: number }): void {
    while (f.filled < f.data.length && this.chunks.length) {
      const next = this.chunks[0]
      const want = f.data.length - f.filled
      if (next.length <= want) {
        f.data.set(next, f.filled)
        f.filled += next.length
        this.len -= next.length
        this.chunks.shift()
      } else {
        f.data.set(next.subarray(0, want), f.filled)
        f.filled += want
        this.len -= want
        this.chunks[0] = next.subarray(want)
      }
    }
  }

  /** Consumes and returns the first `n` buffered bytes (already checked available): a view when
   *  the first chunk alone has enough, else a fresh buffer built from however many chunks it takes.
   *  Only for the small fixed-size fields (the dummy byte, the name, the codec id, a 12-byte
   *  header): a packet's payload is collected by fill() instead, directly into its own buffer. */
  private take(n: number): Buffer {
    const first = this.chunks[0]
    let out: Buffer
    if (first.length >= n) {
      out = first.subarray(0, n)
      if (first.length === n) this.chunks.shift()
      else this.chunks[0] = first.subarray(n)
    } else {
      out = Buffer.alloc(n)
      let offset = 0
      while (offset < n) {
        const next = this.chunks[0]
        const want = n - offset
        if (next.length <= want) {
          next.copy(out, offset)
          offset += next.length
          this.chunks.shift()
        } else {
          next.copy(out, offset, 0, want)
          this.chunks[0] = next.subarray(want)
          offset += want
        }
      }
    }
    this.len -= n
    return out
  }
}

const TYPE = { keycode: 0, text: 1, touch: 2, scroll: 3, setClipboard: 9, resetVideo: 17 } as const
/** Android's MotionEvent and KeyEvent actions. */
const ACTION = { down: 0, up: 1, move: 2 } as const
/** scrcpy's POINTER_ID_GENERIC_FINGER (-2): injected as a finger, not a mouse. */
export const FINGER = 0xfffffffffffffffen
/** scrcpy's own client never sends more than 300 bytes of text per message. */
export const TEXT_MAX_BYTES = 300

export function keycodeMessage(action: 'down' | 'up', keycode: number, repeat = 0, meta = 0): Buffer {
  const b = Buffer.alloc(14)
  b.writeUInt8(TYPE.keycode, 0)
  b.writeUInt8(ACTION[action], 1)
  b.writeInt32BE(keycode, 2)
  b.writeInt32BE(repeat, 6)
  b.writeInt32BE(meta, 10)
  return b
}

/** At most TEXT_MAX_BYTES of UTF-8: see textPieces. */
export function textMessage(text: string): Buffer {
  const bytes = Buffer.from(text, 'utf8')
  const b = Buffer.alloc(5 + bytes.length)
  b.writeUInt8(TYPE.text, 0)
  b.writeUInt32BE(bytes.length, 1)
  bytes.copy(b, 5)
  return b
}

export interface Touch {
  action: 'down' | 'move' | 'up'
  /** In the frame's pixels; width and height are the frame's (the server ignores another size). */
  x: number
  y: number
  width: number
  height: number
  pointerId?: bigint
  /** 0 … 1; a finger presses with 1 and lets go with 0. */
  pressure?: number
  actionButton?: number
  buttons?: number
}

export function touchMessage(t: Touch): Buffer {
  const b = Buffer.alloc(32)
  b.writeUInt8(TYPE.touch, 0)
  b.writeUInt8(ACTION[t.action], 1)
  b.writeBigUInt64BE(t.pointerId ?? FINGER, 2)
  b.writeInt32BE(Math.round(t.x), 10)
  b.writeInt32BE(Math.round(t.y), 14)
  b.writeUInt16BE(t.width, 18)
  b.writeUInt16BE(t.height, 20)
  b.writeUInt16BE(u16fp(t.pressure ?? (t.action === 'up' ? 0 : 1)), 22)
  b.writeUInt32BE(t.actionButton ?? 0, 24)
  b.writeUInt32BE(t.buttons ?? 0, 28)
  return b
}

export interface Scroll {
  x: number
  y: number
  width: number
  height: number
  /** -16 … 16 steps; positive scrolls right and up. */
  hscroll: number
  vscroll: number
  buttons?: number
}

export function scrollMessage(s: Scroll): Buffer {
  const b = Buffer.alloc(21)
  b.writeUInt8(TYPE.scroll, 0)
  b.writeInt32BE(Math.round(s.x), 1)
  b.writeInt32BE(Math.round(s.y), 5)
  b.writeUInt16BE(s.width, 9)
  b.writeUInt16BE(s.height, 11)
  b.writeInt16BE(i16fp(s.hscroll / 16), 13)
  b.writeInt16BE(i16fp(s.vscroll / 16), 15)
  b.writeUInt32BE(s.buttons ?? 0, 17)
  return b
}

/** Sequence 0 asks for no acknowledgement. */
export function setClipboardMessage(text: string, paste: boolean, sequence = 0n): Buffer {
  const bytes = Buffer.from(text, 'utf8')
  const b = Buffer.alloc(14 + bytes.length)
  b.writeUInt8(TYPE.setClipboard, 0)
  b.writeBigUInt64BE(sequence, 1)
  b.writeUInt8(paste ? 1 : 0, 9)
  b.writeUInt32BE(bytes.length, 10)
  bytes.copy(b, 14)
  return b
}

/** The server restarts its capture: a new session (size), config and key frame follow. */
export const resetVideoMessage = (): Buffer => Buffer.from([TYPE.resetVideo])

/** scrcpy's u16 fixed point: 0 … 1 → 0 … 0xffff. */
const u16fp = (f: number) => Math.min(0xffff, Math.max(0, Math.trunc(f * 0x10000)))
/** scrcpy's i16 fixed point: -1 … 1 → -0x8000 … 0x7fff. */
const i16fp = (f: number) => Math.min(0x7fff, Math.max(-0x8000, Math.trunc(f * 0x8000)))

/** `text` in pieces of at most `max` bytes of UTF-8, never cutting a character in two. */
export function textPieces(text: string, max = TEXT_MAX_BYTES): string[] {
  const pieces: string[] = []
  let piece = ''
  let bytes = 0
  for (const ch of text) {
    const n = Buffer.byteLength(ch, 'utf8')
    if (bytes + n > max && piece) {
      pieces.push(piece)
      piece = ''
      bytes = 0
    }
    piece += ch
    bytes += n
  }
  if (piece) pieces.push(piece)
  return pieces
}
