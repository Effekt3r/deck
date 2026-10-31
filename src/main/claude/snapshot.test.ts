import { resolve, sep } from 'node:path'
import { afterAll, beforeAll, describe, expect, it } from 'vitest'
import type { ClaudeSessionSummary } from '@shared/types'
import { SessionState } from './session'
import { buildSnapshot, sessionTitle } from './snapshot'
import { type LogWriter, makeClaudeHome, readEntries, removeClaudeHomes, sessionLog } from './test-log'

const FOLDER = resolve(sep, 'Users', 'me', 'app')
let home = ''
beforeAll(() => {
  home = makeClaudeHome()
})
afterAll(removeClaudeHomes)

function parse(log: LogWriter): SessionState {
  const s = new SessionState(FOLDER)
  for (const e of readEntries(log.path)) s.ingest(e)
  return s
}
const summary = (log: LogWriter, title = ''): ClaudeSessionSummary => ({ id: log.sessionId, path: log.path, title, modified: 1234 })

describe('buildSnapshot', () => {
  it('session fields, status, to-dos, agents with the steps of running ones, following', () => {
    const log = sessionLog(home, FOLDER)
    log.branch = 'dev'
    log.permissionMode('plan').prLink(7).aiTitle('Fix login').prompt('Fix the login bug')
      .reply('Looking', { model: 'claude-opus-5-5', stopReason: 'tool_use' })
      .toolUse('t0', 'TodoWrite', { todos: [{ content: 'Reproduce', status: 'in_progress' }] })
      .toolUse('t1', 'Agent', { subagent_type: 'Explore', description: 'Find auth code' })
      .toolResult('t1', { toolUseResult: { status: 'async_launched', agentId: 'ag1' } })
      .toolUse('t2', 'Agent', { subagent_type: 'Plan', description: 'Plan it' }, {
        usage: { input_tokens: 1, cache_read_input_tokens: 80_000, cache_creation_input_tokens: 3_999 }, // the latest line's
      })
      .toolResult('t2', { toolUseResult: { status: 'completed', agentId: 'ag2' } })
    const s = parse(log)
    const steps = new Map([['t1', 'Grep: login'], ['t2', 'stale']])
    expect(buildSnapshot(summary(log), s, 0, steps, 'pinned')).toEqual({
      session: {
        id: log.sessionId, path: log.path, title: 'Fix login', modified: 1234,
        model: 'claude-opus-5-5', contextTokens: 84_000, branch: 'dev', mode: 'plan', pr: 'PR #7',
      },
      status: { state: 'tool', detail: 'TodoWrite', agents: 1, background: 0 },
      todos: [{ status: 'in_progress', text: 'Reproduce' }],
      agents: [
        { toolUseId: 't1', type: 'Explore', description: 'Find auth code', done: false, failed: false, step: 'Grep: login' },
        { toolUseId: 't2', type: 'Plan', description: 'Plan it', done: true, failed: false },
      ],
      feed: s.feed,
      following: 'pinned',
    })
  })

  it('an empty session: no model, no title, idle', () => {
    const log = sessionLog(home, FOLDER).permissionMode('bypassPermissions')
    const snap = buildSnapshot(summary(log), parse(log), 0, new Map(), 'newest')
    expect(snap.session).toMatchObject({ title: '', model: '', contextTokens: 0, branch: '', mode: 'bypassPermissions', pr: null })
    expect(snap.status).toEqual({ state: 'idle', agents: 0, background: 0 })
    expect(snap.feed).toEqual([])
  })

  it('caps: the last 300 items; long texts cut with …', () => {
    const log = sessionLog(home, FOLDER)
    for (let i = 0; i < 350; i++) log.reply(`r${i}`, { stopReason: 'tool_use' })
    log.prompt('p'.repeat(3000)).thinking('t'.repeat(3000)).reply('r'.repeat(9000), { stopReason: 'tool_use' })
      .toolUse('x1', 'Bash', { description: 'd'.repeat(400) })
      .toolResult('x1', { isError: true, content: 'e'.repeat(400) })
      .system('informational', { content: 'n'.repeat(400) })
    const feed = buildSnapshot(summary(log), parse(log), 0, new Map(), 'newest').feed
    expect(feed).toHaveLength(300)
    const [prompt, thinking, reply, tool, notice] = feed.slice(-5)
    expect(prompt).toEqual({ kind: 'prompt', text: `${'p'.repeat(1999)}…` })
    expect(thinking).toEqual({ kind: 'thinking', text: `${'t'.repeat(1999)}…` })
    expect(reply).toEqual({ kind: 'reply', text: `${'r'.repeat(7999)}…` })
    expect(tool).toMatchObject({ summary: `${'d'.repeat(299)}…`, error: 'e'.repeat(300) }) // an error is a first line of ≤ 300 already
    expect(notice).toEqual({ kind: 'notice', text: 'n'.repeat(200), tone: 'info' })
    expect(feed[0]).toEqual({ kind: 'reply', text: 'r55' })
  })

  it('cuts at a character, never between the halves of an emoji', () => {
    const log = sessionLog(home, FOLDER).prompt(`${'p'.repeat(1998)}😀😀`)
    const [item] = buildSnapshot(summary(log), parse(log), 0, new Map(), 'newest').feed
    expect(item).toEqual({ kind: 'prompt', text: `${'p'.repeat(1998)}…` })
  })

  it('shares nothing with the state: a later tool result does not change an earlier snapshot', () => {
    const log = sessionLog(home, FOLDER).prompt('go').toolUse('t1', 'Bash', { command: 'ls' })
    const s = parse(log)
    const before = buildSnapshot(summary(log), s, 0, new Map(), 'newest')
    s.ingest(readEntries(log.toolResult('t1').path).at(-1))
    expect(before.feed.at(-1)).toMatchObject({ state: 'running' })
    expect(buildSnapshot(summary(log), s, 0, new Map(), 'newest').feed.at(-1)).toMatchObject({ state: 'done' })
  })
})

describe('sessionTitle', () => {
  it('custom title, else AI title, else the first prompt, else the summary’s title', () => {
    const s = new SessionState(FOLDER)
    expect(sessionTitle(s, 'from the picker')).toBe('from the picker')
    s.firstPrompt = 'first prompt'
    expect(sessionTitle(s, 'x')).toBe('first prompt')
    s.aiTitle = 'AI'
    expect(sessionTitle(s, 'x')).toBe('AI')
    s.customTitle = 'Custom'
    expect(sessionTitle(s, 'x')).toBe('Custom')
  })
})
