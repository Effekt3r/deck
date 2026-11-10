import { describe, expect, it } from 'vitest'
import { buttonEvent, grpcFrame, grpcMessages, HOME_BUTTON, keyEvent, parseDescribe, touchEvent } from './proto'
import { DESCRIBE_ANSWER } from './test-fixtures'

const hex = (b: Buffer) => b.toString('hex')

describe("idb's HID events", () => {
  // Every expected value is protobufjs's encoding of the same message (2026-11-10).
  it('touches, with both coordinates and the direction written out', () => {
    expect(hex(touchEvent(201.5, 437, false))).toBe('0a1a0a160a140a12090000000000306940110000000000507b401000')
    expect(hex(touchEvent(201.5, 437, true))).toBe('0a1a0a160a140a12090000000000306940110000000000507b401001')
    expect(hex(touchEvent(0, 12, false))).toBe('0a1a0a160a140a120900000000000000001100000000000028401000')
  })

  it('the Home button, and keys by HID usage', () => {
    expect(hex(buttonEvent(HOME_BUTTON, false))).toBe('0a080a04120208011000')
    expect(hex(buttonEvent(HOME_BUTTON, true))).toBe('0a080a04120208011001')
    expect(hex(keyEvent(4, false))).toBe('0a080a041a0208041000')
    expect(hex(keyEvent(225, true))).toBe('0a090a051a0308e1011001')
  })
})

describe('parseDescribe', () => {
  it("reads the screen's pixels and points", () => {
    expect(parseDescribe(DESCRIBE_ANSWER)).toEqual({ width: 1206, height: 2622, widthPoints: 402, heightPoints: 874 })
  })

  it('refuses an answer without a screen, or a broken one', () => {
    expect(() => parseDescribe(Buffer.from('0a040a025531', 'hex'))).toThrow("didn't say its screen size")
    expect(() => parseDescribe(Buffer.from('0a2e0a02', 'hex'))).toThrow('truncated')
    expect(() => parseDescribe(Buffer.from('0f', 'hex'))).toThrow("isn't protobuf's")
  })
})

describe('gRPC framing', () => {
  it('prefixes a message with no compression and its length, and reads them back', () => {
    const framed = Buffer.concat([grpcFrame(Buffer.from([1, 2, 3])), grpcFrame(Buffer.alloc(0))])
    expect(hex(framed)).toBe('0000000003010203' + '0000000000')
    expect(grpcMessages(framed).map(hex)).toEqual(['010203', ''])
  })

  it('refuses compressed or truncated messages', () => {
    expect(() => grpcMessages(Buffer.from('0100000000', 'hex'))).toThrow('compressed')
    expect(() => grpcMessages(Buffer.from('00000000050102', 'hex'))).toThrow('truncated')
    expect(() => grpcMessages(Buffer.from('0000', 'hex'))).toThrow('truncated')
  })
})
