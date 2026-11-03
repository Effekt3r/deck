import { describe, expect, it } from 'vitest'
import { avcCodec, joined, nalUnits } from './codec'

describe('nalUnits', () => {
  it('splits on three- and four-byte start codes', () => {
    const data = new Uint8Array([0, 0, 0, 1, 0x67, 1, 2, 0, 0, 1, 0x68, 3, 0, 0, 0, 1, 0x65, 4])
    expect(nalUnits(data).map((nal) => [...nal])).toEqual([[0x67, 1, 2], [0x68, 3], [0x65, 4]])
  })
})

describe('avcCodec', () => {
  it("reads the profile, constraints and level from the SPS", () => {
    expect(avcCodec(new Uint8Array([0, 0, 0, 1, 0x67, 0x64, 0x00, 0x28, 0xac, 0, 0, 0, 1, 0x68, 0xee]))).toBe('avc1.640028')
    expect(avcCodec(new Uint8Array([0, 0, 0, 1, 0x68, 0xee]))).toBeNull()
  })
})

describe('joined', () => {
  it('puts the config in front of the key frame', () => {
    expect([...joined(new Uint8Array([1, 2]), new Uint8Array([3]))]).toEqual([1, 2, 3])
  })
})
