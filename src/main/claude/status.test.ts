import { describe, expect, it } from 'vitest'
import { SessionState } from './session'
import { claudeStatus } from './status'

const S = 1000

function state(fill: (s: SessionState) => void = () => {}): SessionState {
  const s = new SessionState('/p')
  fill(s)
  return s
}

const agent = (done: boolean) => ({ type: 'Explore', description: 'x', id: null, done, failed: false })

describe('claudeStatus', () => {
  it('waiting: AskUserQuestion or ExitPlanMode pending, however recent', () => {
    for (const name of ['AskUserQuestion', 'ExitPlanMode']) {
      const s = state((s) => {
        s.inTurn = true
        s.pending.set('t1', name)
      })
      expect(claudeStatus(s, 0)).toEqual({ state: 'waiting', detail: name, agents: 0, background: 0 })
    }
  })

  it('tool: any other pending tool, until the log has been quiet for more than 8 s', () => {
    const s = state((s) => {
      s.inTurn = true
      s.pending.set('t1', 'Bash')
    })
    expect(claudeStatus(s, 8 * S)).toEqual({ state: 'tool', detail: 'Bash', agents: 0, background: 0 })
    expect(claudeStatus(s, 8 * S + 1)).toEqual({ state: 'maybe-waiting', detail: 'Bash', agents: 0, background: 0 })
  })

  it('never maybe-waiting for an agent tool, or in bypass mode', () => {
    const agentTool = state((s) => s.pending.set('t1', 'Agent'))
    expect(claudeStatus(agentTool, 60 * S).state).toBe('tool')
    expect(claudeStatus(state((s) => s.pending.set('t1', 'Task')), 60 * S).state).toBe('tool')
    const bypass = state((s) => {
      s.mode = 'bypassPermissions'
      s.pending.set('t1', 'Bash')
    })
    expect(claudeStatus(bypass, 60 * S)).toMatchObject({ state: 'tool', detail: 'Bash' })
    bypass.mode = 'acceptEdits'
    expect(claudeStatus(bypass, 60 * S).state).toBe('maybe-waiting')
  })

  it('the latest pending tool decides, and MCP names are shown as server:tool', () => {
    const s = state((s) => {
      s.pending.set('t1', 'AskUserQuestion')
      s.pending.set('t2', 'mcp__github__get_issue')
    })
    expect(claudeStatus(s, 0)).toMatchObject({ state: 'tool', detail: 'github:get_issue' })
  })

  it('working while a turn is open; quiet after more than 10 minutes of silence', () => {
    const s = state((s) => (s.inTurn = true))
    expect(claudeStatus(s, 600 * S)).toEqual({ state: 'working', agents: 0, background: 0 })
    expect(claudeStatus(s, 600 * S + 1)).toEqual({ state: 'quiet', agents: 0, background: 0 })
  })

  it('exited, then error, then idle', () => {
    expect(claudeStatus(state((s) => (s.exited = true)), 0).state).toBe('exited')
    const failed = state((s) => (s.error = 'rate limit reached'))
    expect(claudeStatus(failed, 0)).toEqual({ state: 'error', detail: 'rate limit reached', agents: 0, background: 0 })
    expect(claudeStatus(state(), 99_999 * S)).toEqual({ state: 'idle', agents: 0, background: 0 })
  })

  it('counts running agents and background tasks in every state', () => {
    const s = state((s) => {
      s.agents.set('a', agent(false))
      s.agents.set('b', agent(true))
      s.agents.set('c', agent(false))
      s.background.add('bash-1')
    })
    expect(claudeStatus(s, 0)).toEqual({ state: 'idle', agents: 2, background: 1 })
    s.inTurn = true
    expect(claudeStatus(s, 0)).toEqual({ state: 'working', agents: 2, background: 1 })
  })
})
