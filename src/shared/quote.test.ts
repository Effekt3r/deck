import { describe, expect, it } from 'vitest'
import { quotePath, quotePaths } from './quote'

describe('quotePath', () => {
  it('wraps a path in single quotes for zsh', () => {
    expect(quotePath('/Users/franco/Desktop/shot one.png', 'darwin')).toBe("'/Users/franco/Desktop/shot one.png'")
  })

  it("writes a ' inside as '\\'' for zsh", () => {
    expect(quotePath("/tmp/it's here.txt", 'darwin')).toBe("'/tmp/it'\\''s here.txt'")
  })

  it('keeps accents and other non-ASCII as they are', () => {
    expect(quotePath('/tmp/café/résumé.pdf', 'darwin')).toBe("'/tmp/café/résumé.pdf'")
  })

  it('doubles quotes for PowerShell, the curly ones it also ends strings at included', () => {
    expect(quotePath("C:\\Users\\franco\\it's.png", 'win32')).toBe("'C:\\Users\\franco\\it''s.png'")
    expect(quotePath('C:\\tmp\\Franco’s file.txt', 'win32')).toBe("'C:\\tmp\\Franco’’s file.txt'")
  })
})

describe('quotePaths', () => {
  it('separates quoted paths with spaces', () => {
    expect(quotePaths(['/a b', '/c'], 'darwin')).toBe("'/a b' '/c'")
  })
})
