import { describe, expect, it } from 'vitest'
import { CODEC_H264, FINGER, keycodeMessage, resetVideoMessage, scrollMessage, setClipboardMessage, textMessage, textPieces, touchMessage, VideoEvent, VideoReader } from './protocol'

// The expected bytes are scrcpy 5.0.1's own: app/tests/test_control_msg_serialize.c.
describe('control messages', () => {
  it('inject keycode', () => {
    expect([...keycodeMessage('up', 66, 5, 0x41)]).toEqual([0x00, 0x01, 0x00, 0x00, 0x00, 0x42, 0x00, 0x00, 0x00, 0x05, 0x00, 0x00, 0x00, 0x41])
  })

  it('inject text', () => {
    expect([...textMessage('hello, world!')]).toEqual([0x01, 0x00, 0x00, 0x00, 0x0d, ...Buffer.from('hello, world!')])
  })

  it('inject touch', () => {
    const message = touchMessage({ action: 'down', pointerId: 0x1234567887654321n, x: 100, y: 200, width: 1080, height: 1920, pressure: 1, actionButton: 1, buttons: 1 })
    expect([...message]).toEqual([
      0x02, 0x00, 0x12, 0x34, 0x56, 0x78, 0x87, 0x65, 0x43, 0x21, 0x00, 0x00, 0x00, 0x64, 0x00, 0x00, 0x00, 0xc8,
      0x04, 0x38, 0x07, 0x80, 0xff, 0xff, 0x00, 0x00, 0x00, 0x01, 0x00, 0x00, 0x00, 0x01,
    ])
  })

  it('a finger unless told otherwise: no buttons, pressed down and moving, let go up', () => {
    const down = touchMessage({ action: 'down', x: 10.4, y: 20.6, width: 720, height: 1440 })
    expect(down.readBigUInt64BE(2)).toBe(FINGER)
    expect([down.readInt32BE(10), down.readInt32BE(14)]).toEqual([10, 21])
    expect(down.readUInt16BE(22)).toBe(0xffff)
    expect([down.readUInt32BE(24), down.readUInt32BE(28)]).toEqual([0, 0])
    expect(touchMessage({ action: 'up', x: 0, y: 0, width: 720, height: 1440 }).readUInt16BE(22)).toBe(0)
  })

  it('inject scroll', () => {
    expect([...scrollMessage({ x: 260, y: 1026, width: 1080, height: 1920, hscroll: 16, vscroll: -16, buttons: 1 })]).toEqual([
      0x03, 0x00, 0x00, 0x01, 0x04, 0x00, 0x00, 0x04, 0x02, 0x04, 0x38, 0x07, 0x80, 0x7f, 0xff, 0x80, 0x00, 0x00, 0x00, 0x00, 0x01,
    ])
  })

  it('set clipboard', () => {
    expect([...setClipboardMessage('hello, world!', true, 0x0102030405060708n)]).toEqual([
      0x09, 0x01, 0x02, 0x03, 0x04, 0x05, 0x06, 0x07, 0x08, 0x01, 0x00, 0x00, 0x00, 0x0d, ...Buffer.from('hello, world!'),
    ])
  })

  it('reset video', () => {
    expect([...resetVideoMessage()]).toEqual([0x11])
  })

  it('cuts text into pieces scrcpy takes, never inside a character', () => {
    expect(textPieces('a'.repeat(301))).toEqual(['a'.repeat(300), 'a'])
    expect(textPieces('é'.repeat(200)).map((piece) => Buffer.byteLength(piece))).toEqual([300, 100])
    expect(textPieces('')).toEqual([])
    // Both fixtures above divide evenly into 300 bytes; a boundary that lands mid-character
    // (an odd split) needs its own check.
    const mixed = textPieces('a' + 'é'.repeat(150))
    expect(mixed.map((piece) => Buffer.byteLength(piece))).toEqual([299, 2])
    expect(mixed.join('')).toEqual('a' + 'é'.repeat(150))
  })
})

/** A video socket's bytes as scrcpy's server writes them. */
function stream(): Buffer {
  const name = Buffer.alloc(64)
  name.write('C66')
  const codec = Buffer.alloc(4)
  codec.writeUInt32BE(CODEC_H264)
  const session = Buffer.alloc(12)
  session.writeUInt32BE(0x80000000, 0)
  session.writeUInt32BE(720, 4)
  session.writeUInt32BE(1440, 8)
  const packet = (flags: bigint, data: number[]) => {
    const head = Buffer.alloc(12)
    head.writeBigUInt64BE(flags, 0)
    head.writeUInt32BE(data.length, 8)
    return Buffer.concat([head, Buffer.from(data)])
  }
  return Buffer.concat([
    Buffer.from([0]), name, codec, session,
    packet(1n << 62n, [0, 0, 0, 1, 0x67, 0x64, 0x00, 0x28]), // config: the SPS
    packet((1n << 61n) | 16_666n, [0, 0, 0, 1, 0x65, 0xaa]), // a key frame
    packet(33_333n, [0, 0, 0, 1, 0x41, 0xbb]), // a delta frame
  ])
}

describe('VideoReader', () => {
  const expected = [
    { type: 'name', name: 'C66' },
    { type: 'codec', codec: CODEC_H264 },
    { type: 'size', width: 720, height: 1440 },
    { type: 'packet', config: true, key: false, data: new Uint8Array([0, 0, 0, 1, 0x67, 0x64, 0x00, 0x28]) },
    { type: 'packet', config: false, key: true, data: new Uint8Array([0, 0, 0, 1, 0x65, 0xaa]) },
    { type: 'packet', config: false, key: false, data: new Uint8Array([0, 0, 0, 1, 0x41, 0xbb]) },
  ]

  it('reads the stream in one chunk', () => {
    expect(new VideoReader().feed(stream())).toEqual(expected)
  })

  it('reads it one byte at a time', () => {
    const reader = new VideoReader()
    const all = stream()
    const events: unknown[] = []
    for (let i = 0; i < all.length; i++) events.push(...reader.feed(all.subarray(i, i + 1)))
    expect(events).toEqual(expected)
  })

  // --- A corrupt stream must break cleanly: one error, nothing more, never a throw. ---

  const DUMMY = Buffer.from([0])
  function nameBuf(s: string): Buffer {
    const b = Buffer.alloc(64)
    b.write(s)
    return b
  }
  function codecBuf(id: number): Buffer {
    const b = Buffer.alloc(4)
    b.writeUInt32BE(id)
    return b
  }
  function sessionBuf(width: number, height: number): Buffer {
    const b = Buffer.alloc(12)
    b.writeUInt32BE(0x80000000, 0)
    b.writeUInt32BE(width, 4)
    b.writeUInt32BE(height, 8)
    return b
  }
  function packetBuf(flags: bigint, data: number[] | Buffer): Buffer {
    const payload = Buffer.isBuffer(data) ? data : Buffer.from(data)
    const head = Buffer.alloc(12)
    head.writeBigUInt64BE(flags, 0)
    head.writeUInt32BE(payload.length, 8)
    return Buffer.concat([head, payload])
  }
  /** A packet header whose declared size needn't match any bytes that follow: for provoking the
   *  size check without having to supply (or wait for) that many bytes. */
  function packetHeader(flags: bigint, size: number): Buffer {
    const head = Buffer.alloc(12)
    head.writeBigUInt64BE(flags, 0)
    head.writeUInt32BE(size, 8)
    return head
  }
  const prefix = Buffer.concat([DUMMY, nameBuf('C66'), codecBuf(CODEC_H264), sessionBuf(720, 1440)])

  it('a bad packet size (zero, or far too large) breaks the stream: one error, nothing after it, even when more valid bytes follow', () => {
    const trailing = packetBuf(33_333n, [0, 0, 0, 1, 0x41, 0xbb])

    const huge = new VideoReader()
    expect(huge.feed(Buffer.concat([prefix, packetHeader(0n, 100 * 1024 * 1024), trailing]))).toEqual([
      { type: 'name', name: 'C66' },
      { type: 'codec', codec: CODEC_H264 },
      { type: 'size', width: 720, height: 1440 },
      { type: 'error', message: 'scrcpy sent a 104857600-byte packet.' },
    ])
    expect(huge.feed(trailing)).toEqual([]) // a later, perfectly valid chunk: still ignored

    const zero = new VideoReader()
    expect(zero.feed(Buffer.concat([prefix, packetHeader(0n, 0), trailing]))).toEqual([
      { type: 'name', name: 'C66' },
      { type: 'codec', codec: CODEC_H264 },
      { type: 'size', width: 720, height: 1440 },
      { type: 'error', message: 'scrcpy sent a 0-byte packet.' },
    ])
  })

  it('a packet before any session header breaks the stream', () => {
    const reader = new VideoReader()
    const bytes = Buffer.concat([DUMMY, nameBuf('C66'), codecBuf(CODEC_H264), packetBuf(33_333n, [0, 0, 0, 1, 0x41, 0xbb])])
    expect(reader.feed(bytes)).toEqual([
      { type: 'name', name: 'C66' },
      { type: 'codec', codec: CODEC_H264 },
      { type: 'error', message: "scrcpy sent a frame before the screen's size." },
    ])
    expect(reader.feed(sessionBuf(720, 1440))).toEqual([])
  })

  it('an invalid screen size (zero, or over 0xffff) breaks the stream', () => {
    const zero = new VideoReader()
    expect(zero.feed(Buffer.concat([DUMMY, nameBuf('C66'), codecBuf(CODEC_H264), sessionBuf(0, 1440)]))).toEqual([
      { type: 'name', name: 'C66' },
      { type: 'codec', codec: CODEC_H264 },
      { type: 'error', message: 'scrcpy sent a 0×1440 screen.' },
    ])

    const tooWide = new VideoReader()
    expect(tooWide.feed(Buffer.concat([DUMMY, nameBuf('C66'), codecBuf(CODEC_H264), sessionBuf(70_000, 1440)]))).toEqual([
      { type: 'name', name: 'C66' },
      { type: 'codec', codec: CODEC_H264 },
      { type: 'error', message: 'scrcpy sent a 70000×1440 screen.' },
    ])
  })

  it('a 2 MiB key frame fed in 1448-byte chunks parses into one packet with the right bytes', () => {
    const reader = new VideoReader()
    const payload = Buffer.alloc(2 * 1024 * 1024)
    for (let i = 0; i < payload.length; i++) payload[i] = i % 256
    const bytes = Buffer.concat([prefix, packetBuf((1n << 61n) | 16_666n, payload)])

    const events: VideoEvent[] = []
    for (let i = 0; i < bytes.length; i += 1448) events.push(...reader.feed(bytes.subarray(i, i + 1448)))

    expect(events).toHaveLength(4)
    const last = events.at(-1)
    if (last?.type !== 'packet') throw new Error('expected a packet event')
    expect(last.config).toBe(false)
    expect(last.key).toBe(true)
    // toEqual on a 2 MiB array is slow (seconds): compare bytes with Buffer.equals instead.
    expect(Buffer.from(last.data).equals(payload)).toBe(true)
  })

  it('a 2 MiB packet fed in 13-byte chunks fills as bytes arrive: correct, and fast', () => {
    const reader = new VideoReader()
    const payload = Buffer.alloc(2 * 1024 * 1024)
    for (let i = 0; i < payload.length; i++) payload[i] = i % 256
    const bytes = Buffer.concat([prefix, packetBuf((1n << 61n) | 16_666n, payload)])

    const start = performance.now()
    const events: VideoEvent[] = []
    for (let i = 0; i < bytes.length; i += 13) events.push(...reader.feed(bytes.subarray(i, i + 13)))
    const ms = performance.now() - start

    expect(events).toHaveLength(4)
    const last = events.at(-1)
    if (last?.type !== 'packet') throw new Error('expected a packet event')
    expect(last.config).toBe(false)
    expect(last.key).toBe(true)
    expect(Buffer.from(last.data).equals(payload)).toBe(true)
    // Before filling the packet as bytes arrive, every one of these ~161,300 tiny chunks sat in a
    // list until the packet completed, then got shift()ed off one at a time in a single batched
    // copy: O(chunk count²); measured at ~14.6 s on the old code, against tens of milliseconds now.
    expect(ms).toBeLessThan(1000)
  })

  it('a second session header after packets gives a second size event (a rotation, or after reset video)', () => {
    const reader = new VideoReader()
    const bytes = Buffer.concat([
      prefix,
      packetBuf(1n << 62n, [0, 0, 0, 1, 0x67, 0x64, 0x00, 0x28]),
      packetBuf((1n << 61n) | 16_666n, [0, 0, 0, 1, 0x65, 0xaa]),
      sessionBuf(1440, 720), // a rotation
      packetBuf(1n << 62n, [0, 0, 0, 1, 0x67, 0x64, 0x00, 0x28]),
    ])
    expect(reader.feed(bytes)).toEqual([
      { type: 'name', name: 'C66' },
      { type: 'codec', codec: CODEC_H264 },
      { type: 'size', width: 720, height: 1440 },
      { type: 'packet', config: true, key: false, data: new Uint8Array([0, 0, 0, 1, 0x67, 0x64, 0x00, 0x28]) },
      { type: 'packet', config: false, key: true, data: new Uint8Array([0, 0, 0, 1, 0x65, 0xaa]) },
      { type: 'size', width: 1440, height: 720 },
      { type: 'packet', config: true, key: false, data: new Uint8Array([0, 0, 0, 1, 0x67, 0x64, 0x00, 0x28]) },
    ])
  })

  it('a 64-byte name with no NUL keeps all 64 characters', () => {
    const reader = new VideoReader()
    const name = Buffer.alloc(64, 'A'.charCodeAt(0))
    expect(reader.feed(Buffer.concat([DUMMY, name]))).toEqual([{ type: 'name', name: 'A'.repeat(64) }])
  })

  it("each packet's data has its own buffer, independent of the chunk it arrived in", () => {
    const reader = new VideoReader()
    const chunk = Buffer.concat([prefix, packetBuf((1n << 61n) | 16_666n, [0, 0, 0, 1, 0x65, 0xaa])])
    const events = reader.feed(chunk)
    const last = events.at(-1)
    if (last?.type !== 'packet') throw new Error('expected a packet event')
    expect(last.data.byteOffset).toBe(0)
    expect(last.data.buffer.byteLength).toBe(last.data.length)

    const before = Buffer.from(last.data)
    chunk.fill(0xff) // mutate the fed chunk after feed() returned
    expect(Buffer.from(last.data)).toEqual(before)
  })
})
