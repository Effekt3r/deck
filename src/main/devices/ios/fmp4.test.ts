import { describe, expect, it } from 'vitest'
import { Fmp4Reader, MAX_BOX } from './fmp4'
import { box, fragment, initSegment, nal, PPS, SPS, u32 } from './test-fixtures'

const START = Buffer.from([0, 0, 0, 1])
const stream = () => Buffer.concat([initSegment(), fragment([nal(0x65)]), fragment([nal(0x41)])])
const expected = [
  { type: 'config', width: 604, height: 1312, data: Buffer.concat([START, SPS, START, PPS]) },
  { type: 'frame', key: true, data: Buffer.concat([START, nal(0x65)]) },
  { type: 'frame', key: false, data: Buffer.concat([START, nal(0x41)]) },
]

describe('Fmp4Reader', () => {
  it('turns the init segment into a config packet and each fragment into a picture', () => {
    expect(new Fmp4Reader().push(stream())).toEqual(expected)
  })

  it('reads the same from chunks split anywhere', () => {
    const bytes = stream()
    for (const size of [1, 3, 7, 50]) {
      const reader = new Fmp4Reader()
      const events = []
      for (let at = 0; at < bytes.length; at += size) events.push(...reader.push(bytes.subarray(at, at + size)))
      expect(events).toEqual(expected)
    }
  })

  it('takes 2-byte NAL lengths, several NALs per picture, and a second init segment', () => {
    const reader = new Fmp4Reader()
    const events = reader.push(Buffer.concat([initSegment(604, 1312, 2), fragment([nal(0x06, 3), nal(0x65)], 2), initSegment(1312, 604)]))
    expect(events[1]).toEqual({ type: 'frame', key: true, data: Buffer.concat([START, nal(0x06, 3), START, nal(0x65)]) })
    expect(events[2]).toMatchObject({ type: 'config', width: 1312, height: 604 })
  })

  it('refuses a picture before the init segment, a box out of bounds, and broken pictures', () => {
    expect(() => new Fmp4Reader().push(fragment([nal(0x65)]))).toThrow('before its configuration')
    expect(() => new Fmp4Reader().push(Buffer.concat([u32(4), Buffer.from('mdat')]))).toThrow('of 4 bytes')
    expect(() => new Fmp4Reader().push(Buffer.concat([u32(MAX_BOX + 1), Buffer.from('mdat')]))).toThrow('bytes')
    const bad = Buffer.concat([initSegment(), box('mdat', u32(50), nal(0x65))]) // a length past the end
    expect(() => new Fmp4Reader().push(bad)).toThrow('broken picture')
    expect(() => new Fmp4Reader().push(Buffer.concat([initSegment(), box('mdat')]))).toThrow('empty picture')
  })

  it('refuses an init segment without H.264', () => {
    expect(() => new Fmp4Reader().push(box('moov', box('mvhd', Buffer.alloc(100))))).toThrow('no H.264 track')
  })
})
