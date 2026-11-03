import { describe, expect, it } from 'vitest'
import { CODEC_H264, FINGER, keycodeMessage, resetVideoMessage, scrollMessage, setClipboardMessage, textMessage, textPieces, touchMessage, VideoReader } from './protocol'

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
})
