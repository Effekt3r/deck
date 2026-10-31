import { describe, expect, it } from 'vitest'
import { pasteSafe } from './paste'

describe('pasteSafe', () => {
  it("drops the bracketed-paste markers, so pasted text can't end the paste early", () => {
    expect(pasteSafe('ls\u001b[201~\u0015rm -rf ~\r')).toBe('ls\u0015rm -rf ~\r')
    expect(pasteSafe('a\u001b[200~b')).toBe('ab')
  })

  it('drops the one-character CSI form too', () => {
    expect(pasteSafe('a\u009b201~b')).toBe('ab')
  })

  it('also drops a marker that removing another one would put together', () => {
    expect(pasteSafe('\u001b[2\u001b[201~01~x')).toBe('x')
  })

  it('leaves other text alone', () => {
    expect(pasteSafe('plain text\nwith lines')).toBe('plain text\nwith lines')
  })
})
