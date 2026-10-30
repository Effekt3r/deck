import { describe, expect, it } from 'vitest'
import type { ProjectItem } from '@shared/types'
import { ago, filterProjects, isInside, shortPath } from './filter'

const p = (path: string): ProjectItem => ({ path, name: path.split('/').pop()!, branch: null, pinned: false, activity: 0 })

describe('filterProjects', () => {
  const items = [p('/Volumes/wyobi/AccessControl_Guard'), p('/Users/f/Development/deck'), p('/Volumes/wyobi/FaceAPI')]
  it('matches every word against name and path, any case', () => {
    expect(filterProjects(items, 'access').map((i) => i.name)).toEqual(['AccessControl_Guard'])
    expect(filterProjects(items, 'WYOBI face').map((i) => i.name)).toEqual(['FaceAPI'])
    expect(filterProjects(items, '  ')).toEqual(items)
  })
})

describe('ago / shortPath', () => {
  const now = 1_800_000_000_000
  it('formats ages like the prototype', () => {
    expect(ago(now - 20_000, now)).toBe('<1m')
    expect(ago(now - 5 * 60_000, now)).toBe('5m')
    expect(ago(now - 3 * 3_600_000, now)).toBe('3h')
    expect(ago(now - 2 * 86_400_000, now)).toBe('2d')
    expect(ago(now - 120 * 86_400_000, now)).toBe('4mo')
    expect(ago(now - 800 * 86_400_000, now)).toBe('2y')
  })
  it('shortens the home folder', () => {
    expect(shortPath('/Users/f/Development/deck', '/Users/f')).toBe('~/Development/deck')
    expect(shortPath('/Volumes/wyobi/X', '/Users/f')).toBe('/Volumes/wyobi/X')
  })
  it('only at a folder boundary, with either separator', () => {
    expect(shortPath('/Users/fred/x', '/Users/f')).toBe('/Users/fred/x')
    expect(shortPath('/Users/f', '/Users/f')).toBe('~')
    expect(shortPath('C:\\Users\\f\\Work', 'C:\\Users\\f')).toBe('~\\Work')
    expect(shortPath('/Users/f/x', '')).toBe('/Users/f/x')
  })
})

describe('isInside', () => {
  it('is true for the folder itself and anything below it', () => {
    expect(isInside('/Users/f/deck', '/Users/f/deck', 'darwin')).toBe(true)
    expect(isInside('/Users/f/deck/src', '/Users/f/deck', 'darwin')).toBe(true)
    expect(isInside('/Users/f/deck2', '/Users/f/deck', 'darwin')).toBe(false)
    expect(isInside('/a/b', '/a/b/', 'linux')).toBe(true)
    expect(isInside('', '/a', 'darwin')).toBe(false)
  })
  it("treats '/' and '\\' alike and ignores case on macOS and Windows", () => {
    expect(isInside('C:/Work/X/sub', 'C:\\Work\\X', 'win32')).toBe(true) // OSC 7 vs a normalised path
    expect(isInside('c:/work/x', 'C:\\Work\\X', 'win32')).toBe(true)
    expect(isInside('/Volumes/wyobi/X', '/Volumes/Wyobi/X', 'darwin')).toBe(true)
    expect(isInside('/A/b', '/a/b', 'linux')).toBe(false)
  })
})
