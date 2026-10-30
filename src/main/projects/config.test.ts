import { mkdtempSync, readFileSync, writeFileSync } from 'node:fs'
import { tmpdir } from 'node:os'
import { join, sep } from 'node:path'
import { describe, expect, it } from 'vitest'
import {
  DEFAULT_COMMAND, defaultConfig, expandHome, isPinned, loadConfig, normalizeConfig, saveConfig, togglePinned,
} from './config'

const tmp = () => mkdtempSync(join(tmpdir(), 'deck-cfg-'))

describe('projects config', () => {
  it('expands ~ only at the start', () => {
    expect(expandHome('~', '/Users/f')).toBe('/Users/f')
    expect(expandHome('~/Development', '/Users/f')).toBe(join('/Users/f', 'Development'))
    expect(expandHome('~\\Development', 'C:\\Users\\f')).toBe(join('C:\\Users\\f', 'Development'))
    expect(expandHome('/Volumes/wyobi', '/Users/f')).toBe('/Volumes/wyobi')
    expect(expandHome('a/~/b', '/Users/f')).toBe('a/~/b')
  })
  it('keeps valid fields and defaults the rest', () => {
    expect(normalizeConfig({ command: 'claude', pinned: ['/a', 3], scan: 'nope', depth: 99 }))
      .toEqual({ command: 'claude', pinned: ['/a'], scan: defaultConfig().scan, depth: 6 })
    expect(normalizeConfig(null)).toEqual(defaultConfig())
    expect(normalizeConfig({ command: '  ' }).command).toBe(DEFAULT_COMMAND)
  })
  it('creates the file with defaults on first load', async () => {
    const f = join(tmp(), 'projects.json')
    expect(await loadConfig(f)).toEqual(defaultConfig())
    expect(JSON.parse(readFileSync(f, 'utf8'))).toEqual(defaultConfig())
  })
  it('imports the WezTerm prototype config on first load', async () => {
    const d = tmp()
    const proto = join(d, 'wezterm-projects.json')
    writeFileSync(proto, JSON.stringify({ command: 'claude', pinned: ['/Volumes/wyobi/X'], scan: ['/Volumes/wyobi'], depth: 2 }))
    const cfg = await loadConfig(join(d, 'projects.json'), { importFrom: proto })
    expect(cfg).toEqual({ command: 'claude', pinned: ['/Volumes/wyobi/X'], scan: ['/Volumes/wyobi'], depth: 2 })
  })
  it('survives a broken file and round-trips saves', async () => {
    const f = join(tmp(), 'projects.json')
    writeFileSync(f, '{ not json')
    expect(await loadConfig(f)).toEqual(defaultConfig())
    expect(readFileSync(f, 'utf8')).toBe('{ not json') // hand edits are left alone
    const saved = await saveConfig(f, { ...defaultConfig(), pinned: ['/x'] })
    expect(await loadConfig(f)).toEqual(saved)
  })
  it('toggles a pin however the pinned path is written', () => {
    const config = { ...defaultConfig(), pinned: ['~/a', '/b'] }
    expect(isPinned(config, join('/h', 'a') + sep, '/h')).toBe(true)
    expect(togglePinned(config, join('/h', 'a'), '/h').pinned).toEqual(['/b'])
    expect(togglePinned(config, '/c', '/h').pinned).toEqual(['~/a', '/b', '/c'])
  })
})
