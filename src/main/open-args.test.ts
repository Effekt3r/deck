import { describe, expect, it } from 'vitest'
import { folderFromArgv } from './open-args'

describe('folderFromArgv', () => {
  it('reads --open <folder> and --open=<folder>', () => {
    expect(folderFromArgv(['Deck.exe', '--open', 'C:\\Work\\X'])).toBe('C:\\Work\\X')
    expect(folderFromArgv(['/Applications/Deck.app/Contents/MacOS/Deck', '--open=/Users/f/x'])).toBe('/Users/f/x')
  })
  it('ignores everything else', () => {
    expect(folderFromArgv(['Deck.exe'])).toBeNull()
    expect(folderFromArgv(['Deck.exe', '--open'])).toBeNull()
    expect(folderFromArgv(['Deck.exe', '--inspect', '--open', ''])).toBeNull()
  })
})
