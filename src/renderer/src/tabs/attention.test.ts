import { describe, expect, it } from 'vitest'
import type { ClaudeActivity, ClaudePresence } from '@shared/types'
import { markOf, markText, nextAttention, presenceFor, sameAttention, type TabAttention } from './attention'
import type { TerminalTab } from './tabs'

const tab = (p: Partial<TerminalTab> = {}): TerminalTab =>
  ({ id: 't1', kind: 'terminal', cwd: '/w/a', title: '✳ Fix the login', vars: {}, process: 'claude', ptyId: 'p1', ...p })
const presence = (p: Partial<ClaudePresence> = {}): ClaudePresence => ({ pid: 100, sessionId: 's', cwd: '/w/a', state: 'working', ...p })

describe('presenceFor', () => {
  it("macOS and Linux: by the tab's pty", () => {
    const t = tab()
    expect(presenceFor(t, [t], [presence({ pid: 1, ptyId: 'p0' }), presence({ pid: 2, ptyId: 'p1' })], 'darwin')?.pid).toBe(2)
    expect(presenceFor(t, [t], [presence({ ptyId: 'p0' })], 'darwin')).toBeUndefined()
    expect(presenceFor(t, [t], [presence()], 'linux')).toBeUndefined() // no pty: not this tab's
  })
  it('only while the tab runs Claude (a file a killed Claude left behind holds nothing)', () => {
    const t = tab({ process: 'zsh', title: '' })
    expect(presenceFor(t, [t], [presence({ ptyId: 'p1' })], 'darwin')).toBeUndefined()
  })
  it('Windows: by folder, ignoring case and slashes, when the tab and the Claude are the only ones there', () => {
    const t = tab({ cwd: 'C:\\Work\\App\\', process: 'pwsh.exe' })
    expect(presenceFor(t, [t], [presence({ cwd: 'c:/work/app' })], 'win32')?.pid).toBe(100)
    expect(presenceFor(t, [t], [presence({ cwd: 'c:/work/app' }), presence({ pid: 101, cwd: 'C:\\Work\\App' })], 'win32')).toBeUndefined()
    const other = tab({ id: 't2', cwd: 'C:\\Work\\App', process: 'pwsh.exe', title: '◐ Something else' })
    expect(presenceFor(t, [t, other], [presence({ cwd: 'c:/work/app' })], 'win32')).toBeUndefined()
    expect(presenceFor(t, [t], [presence({ cwd: 'C:\\Work' })], 'win32')).toBeUndefined()
    // A tab whose shell has exited runs nothing, whatever its last title says.
    const exited = tab({ id: 't3', cwd: 'C:\\Work\\App', process: 'pwsh.exe', title: '◐ An old title', exited: 1 })
    expect(presenceFor(t, [t, exited], [presence({ cwd: 'c:/work/app' })], 'win32')?.pid).toBe(100)
    expect(presenceFor(exited, [t, exited], [presence({ cwd: 'c:/work/app' })], 'win32')).toBeUndefined()
  })
})

describe('nextAttention', () => {
  const states = (x: Record<string, ClaudeActivity | null>) => new Map(Object.entries(x))
  const step = (prev: Map<string, TabAttention>, now: Record<string, ClaudeActivity | null>, seen: string | null = null) => nextAttention(prev, states(now), seen)

  it('a turn that ends unseen stays unseen until the tab is seen', () => {
    let a = step(new Map(), { t1: 'working' })
    a = step(a, { t1: 'idle' })
    expect(a.get('t1')).toEqual({ state: 'idle', unseen: true })
    a = step(a, { t1: 'idle' })
    expect(a.get('t1')?.unseen).toBe(true)
    a = step(a, { t1: 'idle' }, 't1')
    expect(a.get('t1')?.unseen).toBe(false)
  })
  it('a turn that ends while seen, or the first look at an idle Claude, is not news', () => {
    expect(step(step(new Map(), { t1: 'working' }), { t1: 'idle' }, 't1').get('t1')?.unseen).toBe(false)
    expect(step(step(new Map(), { t1: 'waiting' }), { t1: 'idle' }, 't1').get('t1')?.unseen).toBe(false)
    expect(step(new Map(), { t1: 'idle' }).get('t1')?.unseen).toBe(false)
  })
  it('a wait that ends unseen counts too; a new turn or Claude going away clears it', () => {
    let a = step(step(new Map(), { t1: 'waiting' }), { t1: 'idle' })
    expect(a.get('t1')?.unseen).toBe(true)
    expect(step(a, { t1: 'working' }).get('t1')).toEqual({ state: 'working', unseen: false })
    expect(step(a, { t1: null }).get('t1')).toEqual({ state: null, unseen: false })
  })
  it('drops tabs that are gone', () => {
    const a = step(step(new Map(), { t1: 'working', t2: 'working' }), { t1: 'working' })
    expect([...a.keys()]).toEqual(['t1'])
  })
})

describe('sameAttention', () => {
  it('compares by content', () => {
    const a = new Map([['t1', { state: 'idle' as const, unseen: true }]])
    expect(sameAttention(a, new Map([['t1', { state: 'idle', unseen: true }]]))).toBe(true)
    expect(sameAttention(a, new Map([['t1', { state: 'idle', unseen: false }]]))).toBe(false)
    expect(sameAttention(a, new Map())).toBe(false)
  })
})

describe('markOf and markText', () => {
  it("shows waiting and working as they are, and an unseen idle as finished", () => {
    expect(markOf('waiting', false)).toBe('waiting')
    expect(markOf('working', true)).toBe('working')
    expect(markOf('idle', true)).toBe('done')
    expect(markOf('idle', false)).toBeNull()
    expect(markOf(null, true)).toBeNull()
  })
  it('words for the tooltip and the accessible name', () => {
    expect(markText('working')).toBe('Claude is working')
    expect(markText('waiting', 'dialog open')).toBe('Claude needs you (dialog open)')
    expect(markText('waiting')).toBe('Claude needs you')
    expect(markText('done')).toBe('Claude finished')
  })
})
