import { describe, expect, it } from 'vitest'
import type { ClaudeAgent, ClaudeStatus, ClaudeTodo } from '@shared/types'
import { agentsView, formatTokens, modeLabel, modelLabel, statusExtras, statusView, todoView } from './summary'

const status = (state: ClaudeStatus['state'], detail?: string, agents = 0, background = 0): ClaudeStatus =>
  ({ state, ...(detail ? { detail } : {}), agents, background })
const MIN = 60_000

describe('statusView', () => {
  const now = 1_000_000_000
  const view = (s: ClaudeStatus, modified = now) => {
    const v = statusView(s, modified, now)
    return `${v.glyph.replace('︎', '')} ${v.label} [${v.tone}]`
  }
  it('names each state like the prototype', () => {
    expect(view(status('working'))).toBe('✻ working [violet]')
    expect(view(status('tool', 'Bash'))).toBe('⏺ Bash [amber]')
    expect(view(status('tool', 'mcp__github__get_pr'))).toBe('⏺ github:get_pr [amber]')
    expect(view(status('waiting', 'AskUserQuestion'))).toBe('◐ waiting on you [amber]')
    expect(view(status('maybe-waiting', 'Bash'))).toBe('◐ waiting on you? [amber]')
    expect(view(status('idle'))).toBe('✓ idle [teal]')
    expect(view(status('exited'))).toBe('⏹ exited [dim]')
    expect(view(status('error', 'rate_limit: try again later'))).toBe('⚠ rate_limit: try again later [red]')
  })
  it('counts the quiet minutes from the log time', () => {
    expect(view(status('quiet'), now - 12 * MIN - 30_000)).toBe('? quiet for 12m [dim]')
    expect(view(status('quiet'), now + 5000)).toBe('? quiet for 0m [dim]') // clocks disagree
  })
  it('asks text presentation for glyphs Windows would draw as emoji', () => {
    expect(statusView(status('exited'), now, now).glyph).toBe('⏹︎')
  })
  it('puts the tool name in the tooltip of a maybe-waiting state', () => {
    expect(statusView(status('maybe-waiting', 'Bash'), now, now).title).toMatch(/Bash/)
  })
  it('extras: running agents and background tasks', () => {
    expect(statusExtras(status('idle'))).toEqual([])
    expect(statusExtras(status('idle', undefined, 1, 0))).toEqual(['1 agent running'])
    expect(statusExtras(status('working', undefined, 2, 3))).toEqual(['2 agents running', '3 background'])
  })
})

describe('header labels', () => {
  it('formats context sizes', () => {
    expect([0, 999, 1000, 84_412, 999_499, 999_600, 1_234_567].map(formatTokens))
      .toEqual(['0', '999', '1k', '84k', '999k', '1.0M', '1.2M'])
  })
  it('shortens model names', () => {
    expect(modelLabel('claude-opus-5-5')).toBe('opus-5-5')
    expect(modelLabel('claude-sonnet-4-5-20250929')).toBe('sonnet-4-5')
    expect(modelLabel('')).toBe('')
  })
  it('names permission modes, nothing for the default', () => {
    expect(['bypassPermissions', 'plan', 'acceptEdits', 'auto', 'default', ''].map(modeLabel))
      .toEqual(['bypass', 'plan mode', 'accept edits', 'auto mode', '', ''])
  })
})

describe('todoView', () => {
  const t = (status: string, text: string): ClaudeTodo => ({ status, text })
  it('lists unfinished items first, then the last few completed', () => {
    const todos = [t('completed', 'a'), t('completed', 'b'), t('completed', 'c'), t('completed', 'd'), t('in_progress', 'e'), t('pending', 'f')]
    const v = todoView(todos)
    expect(v.done).toBe(4)
    expect(v.total).toBe(6)
    expect(v.shown.map((x) => x.text)).toEqual(['e', 'f', 'b', 'c', 'd'])
    expect(v.hidden).toBe(1)
  })
  it('caps the unfinished ones and leaves out deleted tasks', () => {
    const todos = [...Array.from({ length: 9 }, (_, i) => t('pending', `p${i}`)), t('deleted', 'x')]
    const v = todoView(todos)
    expect(v.total).toBe(9)
    expect(v.shown).toHaveLength(6)
    expect(v.hidden).toBe(3)
  })
})

describe('agentsView', () => {
  const a = (id: string, done = false, failed = false): ClaudeAgent =>
    ({ toolUseId: id, type: 'Explore', description: id, done, failed })
  it('shows the running ones and the last three finished', () => {
    const v = agentsView([a('1', true), a('2', true, true), a('3'), a('4', true), a('5', true), a('6')])
    expect(v.running.map((x) => x.toolUseId)).toEqual(['3', '6'])
    expect(v.finished.map((x) => x.toolUseId)).toEqual(['2', '4', '5'])
    expect([v.runningCount, v.doneCount, v.hidden]).toEqual([2, 4, 0])
  })
  it('caps the running ones', () => {
    const v = agentsView(Array.from({ length: 8 }, (_, i) => a(String(i))))
    expect(v.running).toHaveLength(5)
    expect(v.hidden).toBe(3)
  })
})
