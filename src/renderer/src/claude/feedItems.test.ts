import { describe, expect, it } from 'vitest'
import type { ClaudeFeedItem, ClaudeImage } from '@shared/types'
import { feedKeys, NO_KEYS, sameEntry, sameItem, toolKind, toolLabel } from './feedItems'

const prompt = (text: string): ClaudeFeedItem => ({ kind: 'prompt', text })
const reply = (text: string): ClaudeFeedItem => ({ kind: 'reply', text })
const thinking = (text = ''): ClaudeFeedItem => ({ kind: 'thinking', text })
const tool = (id: string, state: 'running' | 'done' | 'error' = 'running', error?: string): ClaudeFeedItem =>
  ({ kind: 'tool', id, name: 'Bash', summary: 'npm test', state, ...(error ? { error } : {}) })
/** As a new snapshot delivers them: equal content, new objects. */
const copy = (items: ClaudeFeedItem[]) => items.map((i) => ({ ...i }))

describe('feedKeys', () => {
  it('numbers a first feed', () => {
    const items = [prompt('a'), thinking(), reply('b')]
    expect(feedKeys(NO_KEYS, items).keys).toEqual([0, 1, 2])
  })

  it('keeps keys for items still there and numbers new ones on', () => {
    const one = feedKeys(NO_KEYS, [prompt('a'), tool('t1'), reply('b')])
    const two = feedKeys(one, [...copy(one.items as ClaudeFeedItem[]), tool('t2'), thinking()])
    expect(two.keys).toEqual([0, 1, 2, 3, 4])
  })

  it('follows a tool updated in place', () => {
    const one = feedKeys(NO_KEYS, [prompt('a'), tool('t1', 'running')])
    const two = feedKeys(one, [prompt('a'), tool('t1', 'error', 'exit 1'), reply('failed')])
    expect(two.keys).toEqual([0, 1, 2])
  })

  it('keeps keys when the oldest items drop off the front', () => {
    const one = feedKeys(NO_KEYS, [thinking(), thinking(), prompt('a'), thinking(), reply('b')])
    const two = feedKeys(one, [thinking(), reply('b'), prompt('c')]) // the first three dropped
    expect(two.keys).toEqual([3, 4, 5])
  })

  it('starts over when nothing lines up', () => {
    const one = feedKeys(NO_KEYS, [prompt('a'), reply('b')])
    const two = feedKeys(one, [prompt('x'), reply('y')])
    expect(two.keys).toEqual([2, 3])
  })

  it('returns the same state for the same array (StrictMode renders twice)', () => {
    const items = [prompt('a')]
    const one = feedKeys(NO_KEYS, items)
    expect(feedKeys(one, items)).toBe(one)
  })

  it('is quick for a full feed with a few items dropped', () => {
    const big: ClaudeFeedItem[] = Array.from({ length: 300 }, (_, i) => (i % 3 ? reply(`r${i} ${'x'.repeat(2000)}`) : tool(`t${i}`)))
    const one = feedKeys(NO_KEYS, big)
    const next = [...copy(big.slice(5)), prompt('new'), thinking(), tool('t-new')]
    const t0 = performance.now()
    const two = feedKeys(one, next)
    expect(performance.now() - t0).toBeLessThan(10)
    expect(two.keys.slice(0, 2)).toEqual([5, 6])
    expect(two.keys.slice(-3)).toEqual([300, 301, 302])
  })
})

describe('sameItem', () => {
  it('compares every field by value', () => {
    expect(sameItem(reply('a'), reply('a'))).toBe(true)
    expect(sameItem(reply('a'), reply('b'))).toBe(false)
    expect(sameItem(reply('a'), prompt('a'))).toBe(false)
    expect(sameItem(tool('t'), tool('t'))).toBe(true)
    expect(sameItem(tool('t', 'running'), tool('t', 'done'))).toBe(false)
    expect(sameItem(tool('t', 'error', 'x'), tool('t', 'error', 'y'))).toBe(false)
    expect(sameItem({ kind: 'notice', text: 'n', tone: 'info' }, { kind: 'notice', text: 'n', tone: 'error' })).toBe(false)
  })
})

describe('items with images', () => {
  type Prompt = Extract<ClaudeFeedItem, { kind: 'prompt' }>
  type Tool = Extract<ClaudeFeedItem, { kind: 'tool' }>
  const image = (id: string): ClaudeImage => ({ id, format: 'png', width: 10, height: 10, bytes: 100 })
  const shot = (...ids: string[]): Prompt => ({ kind: 'prompt', text: '[image]', images: ids.map(image) })

  it("two image-only prompts are the same entry only with the same images", () => {
    expect(sameEntry(shot('a'), shot('a'))).toBe(true)
    expect(sameEntry(shot('a'), shot('b'))).toBe(false)
    expect(sameEntry(shot('a'), prompt('[image]'))).toBe(false)
    expect(sameEntry(shot('a', 'b'), shot('a'))).toBe(false)
    expect(sameEntry({ ...shot('a'), moreImages: 2 }, shot('a'))).toBe(false)
  })

  it('so the keys of two image-only prompts in a row follow the right one', () => {
    const one = feedKeys(NO_KEYS, [shot('a'), shot('b')])
    expect(feedKeys(one, [shot('b'), shot('c')]).keys).toEqual([1, 2])
  })

  it("a tool renders again when its result brings images; its key stays", () => {
    const running: Tool = { kind: 'tool', id: 't1', name: 'Read', summary: 'a.png', state: 'running' }
    const done: Tool = { ...running, state: 'done', images: [image('a')] }
    expect(sameItem(done, { ...running, state: 'done' })).toBe(false)
    expect(sameItem(done, { ...done, images: [image('a')] })).toBe(true)
    expect(sameItem(done, { ...done, moreImages: 1 })).toBe(false)
    const one = feedKeys(NO_KEYS, [prompt('go'), running])
    expect(feedKeys(one, [prompt('go'), done]).keys).toEqual([0, 1])
  })
})

describe('tools', () => {
  it('have an icon kind', () => {
    expect(toolKind('Bash')).toBe('terminal')
    expect(['Edit', 'Write', 'MultiEdit', 'NotebookEdit'].map(toolKind)).toEqual(['edit', 'edit', 'edit', 'edit'])
    expect(toolKind('Read')).toBe('read')
    expect(['Grep', 'Glob', 'WebSearch'].map(toolKind)).toEqual(['search', 'search', 'search'])
    expect(toolKind('WebFetch')).toBe('web')
    expect([toolKind('Agent'), toolKind('Task')]).toEqual(['agent', 'agent'])
    expect([toolKind('AskUserQuestion'), toolKind('ExitPlanMode')]).toEqual(['question', 'question'])
    expect([toolKind('mcp__github__get_pr'), toolKind('github:get_pr')]).toEqual(['mcp', 'mcp'])
    expect([toolKind('TodoWrite'), toolKind('')]).toEqual(['other', 'other'])
  })
  it('show MCP names as server:tool', () => {
    expect(toolLabel('mcp__claude-in-chrome__navigate')).toBe('claude-in-chrome:navigate')
    expect(toolLabel('github:get_pr')).toBe('github:get_pr')
    expect(toolLabel('Bash')).toBe('Bash')
  })
})
