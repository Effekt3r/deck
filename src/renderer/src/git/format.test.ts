import { describe, expect, it } from 'vitest'
import { baseName, displayPath, errorText } from './format'

describe('errorText', () => {
  it("drops Electron's IPC wrapper", () => {
    expect(errorText(new Error("Error invoking remote method 'git:subscribe': Error: No handler registered for 'git:subscribe'")))
      .toBe("No handler registered for 'git:subscribe'")
    expect(errorText(new Error("Error invoking remote method 'git:details': GitError: fatal: bad object")))
      .toBe('fatal: bad object')
  })
  it('keeps other messages', () => {
    expect(errorText(new Error('timed out'))).toBe('timed out')
    expect(errorText('plain')).toBe('plain')
  })
})

describe('baseName', () => {
  it('handles both separators and trailing ones', () => {
    expect(baseName('/Users/f/Development/deck')).toBe('deck')
    expect(baseName('C:/Users/f/deck/')).toBe('deck')
    expect(baseName('C:\\Users\\f\\deck')).toBe('deck')
  })
})

describe('displayPath', () => {
  it('shortens paths under home', () => {
    expect(displayPath('/Users/f/Development/deck', '/Users/f', 'darwin')).toBe('~/Development/deck')
    expect(displayPath('/Users/f', '/Users/f/', 'darwin')).toBe('~')
    expect(displayPath('/Users/fx/deck', '/Users/f', 'darwin')).toBe('/Users/fx/deck')
    expect(displayPath('/Volumes/wyobi/x', '/Users/f', 'darwin')).toBe('/Volumes/wyobi/x')
  })
  it("matches git's C:/ paths against a C:\\ home on Windows, ignoring case", () => {
    expect(displayPath('C:/Users/Franco/Development/deck', 'c:\\users\\franco', 'win32')).toBe('~/Development/deck')
    expect(displayPath('D:/work/deck', 'C:\\Users\\Franco', 'win32')).toBe('D:/work/deck')
  })
  it('leaves paths alone without a home folder', () => {
    expect(displayPath('/x/y', '', 'linux')).toBe('/x/y')
  })
})
