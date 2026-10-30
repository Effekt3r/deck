import { describe, expect, it } from 'vitest'
import { folderFromArgv } from './open-args'

describe('folderFromArgv', () => {
  it('reads --open <folder> and --open=<folder>', () => {
    expect(folderFromArgv(['Deck.exe', '--open', 'C:\\Work\\X'])).toBe('C:\\Work\\X')
    expect(folderFromArgv(['/Applications/Deck.app/Contents/MacOS/Deck', '--open=/Users/f/x'])).toBe('/Users/f/x')
  })
  it('repairs a Windows drive root that lost its backslash to the quote ("C:\\" arrives as C:")', () => {
    expect(folderFromArgv(['Deck.exe', '--open', 'C:"'])).toBe('C:\\')
    expect(folderFromArgv(['Deck.exe', '--open=D:"'])).toBe('D:\\')
    expect(folderFromArgv(['Deck', '--open', '/Users/f/say "hi"'])).toBe('/Users/f/say "hi"') // a real name on macOS
  })
  it('ignores everything else', () => {
    expect(folderFromArgv(['Deck.exe'])).toBeNull()
    expect(folderFromArgv(['Deck.exe', '--open'])).toBeNull()
    expect(folderFromArgv(['Deck.exe', '--inspect', '--open', ''])).toBeNull()
  })
})
