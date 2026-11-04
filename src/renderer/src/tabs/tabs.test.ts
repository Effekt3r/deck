import { describe, expect, it } from 'vitest'
import { initialTabs, PROJECTS_ID, tabsReducer, type TabsState } from './tabs'

const open = (s: TabsState, id: string) => tabsReducer(s, { type: 'open', id, cwd: `/w/${id}` })

describe('tabsReducer', () => {
  it('starts with the Projects tab and opens new tabs at the end, focused', () => {
    const s = open(open(initialTabs, 'a'), 'b')
    expect(s.tabs.map((t) => t.id)).toEqual([PROJECTS_ID, 'a', 'b'])
    expect(s.active).toBe('b')
    expect(s.tabs[2]).toMatchObject({ kind: 'terminal', cwd: '/w/b', title: '', vars: {}, process: '' })
  })
  it('never closes the Projects tab', () => {
    expect(tabsReducer(initialTabs, { type: 'close', id: PROJECTS_ID })).toBe(initialTabs)
  })
  it('closing the active tab focuses its right neighbour, else the left one', () => {
    let s = open(open(open(initialTabs, 'a'), 'b'), 'c')
    s = tabsReducer({ ...s, active: 'b' }, { type: 'close', id: 'b' })
    expect(s.active).toBe('c')
    s = tabsReducer(s, { type: 'close', id: 'c' })
    expect(s.active).toBe('a')
  })
  it('closing another tab keeps the focus', () => {
    const s = tabsReducer(open(open(initialTabs, 'a'), 'b'), { type: 'close', id: 'a' })
    expect(s.active).toBe('b')
  })
  it('next/prev wrap, select is 1-based and 9 is the last tab', () => {
    const s = open(open(initialTabs, 'a'), 'b')
    expect(tabsReducer(s, { type: 'next' }).active).toBe(PROJECTS_ID)
    expect(tabsReducer({ ...s, active: PROJECTS_ID }, { type: 'prev' }).active).toBe('b')
    expect(tabsReducer(s, { type: 'select', index: 1 }).active).toBe(PROJECTS_ID)
    expect(tabsReducer(s, { type: 'select', index: 9 }).active).toBe('b')
    expect(tabsReducer(s, { type: 'select', index: 5 })).toBe(s)
  })
  it('updates terminal tabs only', () => {
    const s = tabsReducer(open(initialTabs, 'a'), { type: 'update', id: 'a', patch: { title: '✳ Claude Code' } })
    expect(s.tabs[1]).toMatchObject({ title: '✳ Claude Code' })
    expect(tabsReducer(s, { type: 'update', id: PROJECTS_ID, patch: { title: 'x' } })).toBe(s)
  })
  it('keeps the state when an update changes nothing (every prompt repeats cwd and vars)', () => {
    const s = tabsReducer(open(initialTabs, 'a'), { type: 'update', id: 'a', patch: { vars: { GIT_REPO: '/r' } } })
    expect(tabsReducer(s, { type: 'update', id: 'a', patch: { cwd: '/w/a', vars: { GIT_REPO: '/r' } } })).toBe(s)
    expect(tabsReducer(s, { type: 'update', id: 'a', patch: { vars: { GIT_REPO: '/r', GIT_BRANCH: 'dev' } } })).not.toBe(s)
    expect(tabsReducer(s, { type: 'update', id: 'gone', patch: { title: 'x' } })).toBe(s)
  })
  it("keeps the Claude session a tab's panel showed: by content, as every snapshot repeats it; cleared when Claude starts", () => {
    const fresh = open(initialTabs, 'a')
    expect(fresh.tabs[1]).not.toHaveProperty('claudeSession') // a new tab follows the newest
    const s = tabsReducer(fresh, { type: 'update', id: 'a', patch: { claudeSession: { id: 's1', pinned: true } } })
    expect(s.tabs[1]).toMatchObject({ claudeSession: { id: 's1', pinned: true } })
    expect(tabsReducer(s, { type: 'update', id: 'a', patch: { claudeSession: { id: 's1', pinned: true } } })).toBe(s)
    expect(tabsReducer(s, { type: 'update', id: 'a', patch: { claudeSession: { id: 's1', pinned: false } } })).not.toBe(s)
    expect(tabsReducer(s, { type: 'update', id: 'a', patch: { claudeSession: { id: 's2', pinned: true } } })).not.toBe(s)
    const cleared = tabsReducer(s, { type: 'update', id: 'a', patch: { claudeSession: undefined } })
    expect(cleared.tabs[1]).toMatchObject({ claudeSession: undefined })
    expect(tabsReducer(cleared, { type: 'update', id: 'a', patch: { claudeSession: undefined } })).toBe(cleared)
    expect(tabsReducer(fresh, { type: 'update', id: 'a', patch: { claudeSession: undefined } })).toBe(fresh)
  })

  it("keeps a tab's device and its device panel choice until they're cleared", () => {
    let s = tabsReducer(open(initialTabs, 'a'), { type: 'update', id: 'a', patch: { device: 'android:8d2e61a', deviceHidden: false } })
    expect(s.tabs[1]).toMatchObject({ device: 'android:8d2e61a', deviceHidden: false })
    expect(tabsReducer(s, { type: 'update', id: 'a', patch: { device: 'android:8d2e61a' } })).toBe(s)
    s = tabsReducer(s, { type: 'update', id: 'a', patch: { device: undefined, deviceHidden: undefined } })
    expect(s.tabs[1]).toMatchObject({ device: undefined, deviceHidden: undefined })
  })

  it('activates known tabs only', () => {
    const s = open(open(initialTabs, 'a'), 'b')
    expect(tabsReducer(s, { type: 'activate', id: 'a' }).active).toBe('a')
    expect(tabsReducer(s, { type: 'activate', id: 'nope' })).toBe(s)
  })
})
