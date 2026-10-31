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

  it("drops ^C, ^Z and ^\\, which the tty acts on even inside a paste", () => {
    expect(pasteSafe('echo hi\u0003rm -rf ~\r')).toBe('echo hirm -rf ~\r')
    expect(pasteSafe('a\u001ab\u001cc')).toBe('abc')
  })

  it('drops a marker that removing ^C puts together', () => {
    expect(pasteSafe('\u001b[20\u00031~x')).toBe('x')
  })

  it('handles deeply nested markers in linear time', () => {
    const s = '\u001b[2'.repeat(50_000) + '\u001b[201~' + '01~'.repeat(50_000) + 'x'
    const start = performance.now()
    expect(pasteSafe(s)).toBe('x')
    expect(performance.now() - start).toBeLessThan(500)
  })
})
