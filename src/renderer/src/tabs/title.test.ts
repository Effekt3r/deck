import { describe, expect, it } from 'vitest'
import type { TerminalTab } from './tabs'
import { runsClaude, tabTitle, withoutGlyph } from './title'

const tab = (p: Partial<TerminalTab>): TerminalTab =>
  ({ id: 't', kind: 'terminal', cwd: '/Users/f', title: '', vars: {}, process: 'zsh', ...p })

describe('runsClaude', () => {
  it('knows Claude by process name or by its status title', () => {
    expect(runsClaude('claude', '')).toBe(true)
    expect(runsClaude('claude.exe', '')).toBe(true)
    expect(runsClaude('zsh', '✳ Reply with OK')).toBe(true)
    expect(runsClaude('zsh', '◐ Working on it')).toBe(true)
    expect(runsClaude('zsh', '⠂ Thinking')).toBe(true)
    expect(runsClaude('zsh', '~/Development/deck')).toBe(false)
  })
  it('needs the glyph to be followed by a space', () => {
    expect(runsClaude('zsh', '✳Claude')).toBe(false)
    expect(runsClaude('zsh', '⠀ blank braille')).toBe(false) // U+2800 is not a spinner frame
    expect(runsClaude('Claude', '')).toBe(true)
  })
})

describe('tabTitle', () => {
  const repo = { GIT_REPO: '/Volumes/Wyobi/AccessControl_Guard', GIT_BRANCH: 'dev' }
  it('repo and branch at a shell prompt', () =>
    expect(tabTitle(tab({ vars: repo }), 'darwin')).toBe('AccessControl_Guard ⎇ dev'))
  it("repo and Claude's own title while Claude runs", () => {
    expect(tabTitle(tab({ vars: repo, process: 'claude', title: '◑ Reply with OK' }), 'darwin'))
      .toBe('AccessControl_Guard · ◑ Reply with OK')
    expect(tabTitle(tab({ vars: repo, title: '✳ Claude Code' }), 'darwin')).toBe('AccessControl_Guard · ✳ Claude Code')
  })
  it('outside a repo: the terminal title, else the folder name', () => {
    expect(tabTitle(tab({ title: 'vim notes.md' }), 'darwin')).toBe('vim notes.md')
    expect(tabTitle(tab({ cwd: '/Users/f/Downloads' }), 'darwin')).toBe('Downloads')
    expect(tabTitle(tab({ cwd: 'C:\\Users\\f\\Work', process: 'pwsh.exe' }), 'win32')).toBe('Work')
  })
  it('handles repos without a branch, trailing separators and roots', () => {
    expect(tabTitle(tab({ vars: { GIT_REPO: 'C:/src/deck/', GIT_BRANCH: '' } }), 'win32')).toBe('deck')
    expect(tabTitle(tab({ vars: { GIT_REPO: '' }, cwd: 'C:\\' }), 'win32')).toBe('C:\\')
    expect(tabTitle(tab({ cwd: 'C:/' }), 'win32')).toBe('C:\\') // OSC 7 from PowerShell uses '/'
    expect(tabTitle(tab({ cwd: '/' }), 'darwin')).toBe('/')
    expect(tabTitle(tab({ cwd: '' }), 'darwin')).toBe('Terminal')
  })
  it("doesn't show Claude's title while Claude runs but has not set one yet", () =>
    expect(tabTitle(tab({ vars: repo, process: 'claude' }), 'darwin')).toBe('AccessControl_Guard ⎇ dev'))
})

describe('withoutGlyph', () => {
  it("drops Claude's status glyph and its space, nothing else", () => {
    expect(withoutGlyph('◐ Fix the login')).toBe('Fix the login')
    expect(withoutGlyph('⠂ Thinking')).toBe('Thinking')
    expect(withoutGlyph('vim notes.md')).toBe('vim notes.md')
    expect(withoutGlyph('✳Claude')).toBe('✳Claude')
  })
})

describe('tabTitle without the glyph', () => {
  const deck = { GIT_REPO: '/Users/f/deck', GIT_BRANCH: 'main' }
  it("drops Claude's glyph when Deck draws its own mark", () => {
    expect(tabTitle(tab({ vars: deck, process: 'claude', title: '◐ Fix the login' }), 'darwin', { glyph: false })).toBe('deck · Fix the login')
    expect(tabTitle(tab({ process: 'claude', title: '✳ Claude Code' }), 'darwin', { glyph: false })).toBe('Claude Code')
    expect(tabTitle(tab({ vars: deck, process: 'claude', title: '◐ Fix the login' }), 'darwin')).toBe('deck · ◐ Fix the login')
  })
  it('leaves other titles alone', () => {
    expect(tabTitle(tab({ title: 'vim notes.md' }), 'darwin', { glyph: false })).toBe('vim notes.md')
    expect(tabTitle(tab({ vars: deck }), 'darwin', { glyph: false })).toBe('deck ⎇ main')
  })
})
