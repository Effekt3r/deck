import { join, resolve, sep } from 'node:path'
import { afterAll, beforeAll, describe, expect, it } from 'vitest'
import { SessionState } from './session'
import { agentSteps, lastStep, StepCache } from './subagents'
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

/** A session that launched async agents `t1` (agent ag1) and `t2` (agent ag2). */
function withAgents() {
  const log = sessionLog(home, FOLDER).prompt('go')
  for (const [tid, agentId] of [['t1', 'ag1'], ['t2', 'ag2']]) {
    log.toolUse(tid, 'Agent', { subagent_type: 'Explore', description: `agent ${agentId}` })
      .toolResult(tid, { toolUseResult: { status: 'async_launched', agentId } })
  }
  return log
}

describe('agentSteps', () => {
  it("is each running agent's latest tool call or reply, found through its meta.json", async () => {
    const log = withAgents()
    log.subagent('ag1', 't1').prompt('Find the parser', { origin: null })
      .toolUse('s1', 'Grep', { pattern: 'class Session', path: join(FOLDER, 'src') })
    log.subagent('ag2', 't2').prompt('Look around', { origin: null })
      .toolUse('s2', 'Read', { file_path: join(FOLDER, 'a.ts') }).toolResult('s2').reply('Found it.\nDetails follow')
    const steps = await agentSteps(log.path, parse(log))
    expect(steps).toEqual(new Map([['t1', `Grep: class Session  in src`], ['t2', 'Found it.']]))
  })

  it("paths are short against the session's project or its real path (a folder reached through a symlink)", async () => {
    const real = resolve(sep, 'Volumes', 'Disk', 'app')
    const log = withAgents()
    log.subagent('ag1', 't1').toolUse('s1', 'Read', { file_path: join(real, 'src', 'a.ts') })
    log.subagent('ag2', 't2').toolUse('s2', 'Edit', { file_path: join(FOLDER, 'b.ts') })
    const s = new SessionState(FOLDER, real)
    for (const e of readEntries(log.path)) s.ingest(e)
    expect(await agentSteps(log.path, s)).toEqual(new Map([['t1', `Read: ${join('src', 'a.ts')}`], ['t2', 'Edit: b.ts']]))
  })

  it("an agent's log is also found by its agent id when there is no meta.json", async () => {
    const log = withAgents()
    log.subagent('ag1', 'unused', { withMeta: false }).toolUse('s1', 'mcp__github__get_issue', { summary: 'Issue 7' })
    expect(await agentSteps(log.path, parse(log))).toEqual(new Map([['t1', 'github:get_issue: Issue 7']]))
  })

  it('an agent that has only its prompt has no step yet; a tool without a summary is just its name', async () => {
    const log = withAgents()
    log.subagent('ag1', 't1').prompt('Survey the code\nin detail', { origin: null })
    log.subagent('ag2', 't2').prompt('Look', { origin: null }).toolUse('s1', 'ListAgents', {})
    expect(await agentSteps(log.path, parse(log))).toEqual(new Map([['t2', 'ListAgents']]))
  })

  it('finished agents and agents without a log have no step', async () => {
    const log = withAgents().notification({ taskId: 'ag1', toolUseId: 't1', status: 'completed', summary: 'done' })
    log.subagent('ag1', 't1').reply('finished work')
    expect(await agentSteps(log.path, parse(log))).toEqual(new Map())
  })

  it('never builds a path from an agent id that could leave the folder', async () => {
    const log = sessionLog(home, FOLDER).toolUse('t1', 'Agent', { description: 'x' })
      .toolResult('t1', { toolUseResult: { status: 'async_launched', agentId: '../../escape' } })
    expect(await agentSteps(log.path, parse(log))).toEqual(new Map())
  })

  it('with a cache, an unchanged agent log is not read again', async () => {
    const log = withAgents()
    const sub = log.subagent('ag1', 't1').reply('first step', { stopReason: 'tool_use' })
    const cache = new StepCache()
    const s = parse(log)
    expect((await agentSteps(log.path, s, cache)).get('t1')).toBe('first step')
    expect(cache.reads).toBe(1)
    await agentSteps(log.path, s, cache)
    expect(cache.reads).toBe(1)
    sub.reply('second step', { stopReason: 'tool_use' })
    expect((await agentSteps(log.path, s, cache)).get('t1')).toBe('second step')
    expect(cache.reads).toBe(2)
  })
})

describe('lastStep', () => {
  it('only looks at the last 20 KB, skipping the line cut in half', async () => {
    const log = withAgents()
    const sub = log.subagent('ag1', 't1').reply('early step', { stopReason: 'tool_use' })
    sub.reply('x'.repeat(30_000), { stopReason: 'tool_use' }).toolResult('zz', { content: 'y'.repeat(25_000) })
    expect(await lastStep(sub.path, FOLDER)).toBe('')
    sub.toolUse('s9', 'Bash', { command: 'ls', description: 'List files' })
    expect(await lastStep(sub.path, FOLDER)).toBe('Bash: List files')
    expect(await lastStep(join(FOLDER, 'missing.jsonl'), FOLDER)).toBe('')
  })
})
