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

  it('reads a VideoToolbox header byte (0x27) the same way', () => {
    expect(avcCodec(new Uint8Array([0, 0, 0, 1, 0x27, 0x64, 0x00, 0x20]))).toBe('avc1.640020')
  })

  it('renders hex with letters, lowercase', () => {
    expect(avcCodec(new Uint8Array([0, 0, 0, 1, 0x67, 0x42, 0xc0, 0x1f]))).toBe('avc1.42c01f')
  })

  it("masks the constraint byte's two reserved bits, which some encoders set", () => {
    expect(avcCodec(new Uint8Array([0, 0, 0, 1, 0x67, 0x64, 0x03, 0x28]))).toBe('avc1.640028')
  })

  it('a truncated SPS (no level byte) is ignored', () => {
    expect(avcCodec(new Uint8Array([0, 0, 0, 1, 0x67, 0x42]))).toBeNull()
  })
})

describe('joined', () => {
  it('puts the config in front of the key frame', () => {
    expect([...joined(new Uint8Array([1, 2]), new Uint8Array([3]))]).toEqual([1, 2, 3])
  })
})
