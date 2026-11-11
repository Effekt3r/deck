import { readFileSync } from 'node:fs'
import { join, resolve, sep } from 'node:path'
import { afterAll, beforeAll, describe, expect, it } from 'vitest'
import type { ClaudeFeedItem, ClaudeImage } from '@shared/types'
import { imageId } from './images'
import { SessionState } from './session'
import { imageBlock, jpegBytes, type LogWriter, makeClaudeHome, pngBytes, readEntries, readLines, removeClaudeHomes, sessionLog } from './test-log'

const FOLDER = resolve(sep, 'Users', 'me', 'app')
let home = ''
beforeAll(() => {
  home = makeClaudeHome()
})
afterAll(removeClaudeHomes)

const newLog = () => sessionLog(home, FOLDER)

/** Feeds a log to one SessionState; update() ingests the lines written since the last call. */
function feeder(log: LogWriter) {
  const s = new SessionState(FOLDER)
  let seen = 0
  return {
    s,
    update(): SessionState {
      const all = readEntries(log.path)
      for (const e of all.slice(seen)) s.ingest(e)
      seen = all.length
      return s
    },
  }
}
const parse = (log: LogWriter) => feeder(log).update()
const texts = (feed: ClaudeFeedItem[], kind: ClaudeFeedItem['kind']) =>
  feed.filter((i) => i.kind === kind).map((i) => ('text' in i ? i.text : ''))

describe('SessionState: prompts', () => {
  it('a human prompt opens the turn; thinking and the reply follow; end_turn closes it', () => {
    const log = newLog().prompt('Fix the build')
    const f = feeder(log)
    expect(f.update().inTurn).toBe(true)
    log.thinking('Let me look').reply('Done.')
    expect(f.update().feed).toEqual([
      { kind: 'prompt', text: 'Fix the build' },
      { kind: 'thinking', text: 'Let me look' },
      { kind: 'reply', text: 'Done.' },
    ])
    expect(f.s.inTurn).toBe(false)
    expect(f.s.firstPrompt).toBe('Fix the build')
  })

  it('only human prompts count: older logs without origin do; other origins and meta entries do not', () => {
    const s = parse(newLog()
      .prompt('legacy prompt', { origin: null })
      .prompt('<user-prompt-submit-hook>hook output</user-prompt-submit-hook>', { origin: null })
      .prompt('from another session', { origin: 'peer' })
      .prompt('keep going', { origin: 'auto-continuation' })
      .prompt('do this', { origin: 'coordinator' })
      .prompt('skill text', { isMeta: true })
      .prompt('<pasted_content id="1">pasted</pasted_content> please', { origin: null })
      .prompt('<b>html</b> typed by a human'))
    expect(texts(s.feed, 'prompt')).toEqual(['legacy prompt', 'pasted please', '<b>html</b> typed by a human'])
  })

  it('pasted content tags are stripped; image-only prompts are [image]; ! commands and slash commands', () => {
    const s = parse(newLog()
      .prompt('<pasted_content source="clipboard">\nline\n</pasted_content>\nExplain this')
      .prompt('', { images: 2 })
      .prompt('what is this?', { images: 1 })
      .prompt('<bash-input>git status</bash-input>')
      .slashCommand('/clear'))
    expect(s.feed).toEqual([
      { kind: 'prompt', text: 'line\n\nExplain this' },
      { kind: 'prompt', text: '[image]' },
      { kind: 'prompt', text: 'what is this?' },
      { kind: 'prompt', text: '! git status' },
      { kind: 'notice', text: '/clear', tone: 'info' },
    ])
  })

  it('a ! command or a slash command does not open a turn', () => {
    expect(parse(newLog().prompt('<bash-input>ls</bash-input>')).inTurn).toBe(false)
    expect(parse(newLog().slashCommand('/model', 'opus')).inTurn).toBe(false)
  })

  it('local command output, reminders and shell output are not prompts', () => {
    const s = parse(newLog()
      .prompt('<local-command-caveat>Caveat</local-command-caveat>', { origin: null })
      .prompt('<local-command-stdout>output</local-command-stdout>', { origin: null })
      .prompt('<local-command-stderr>err</local-command-stderr>')
      .prompt('<system-reminder>x</system-reminder>')
      .prompt('<bash-stdout>out</bash-stdout><bash-stderr></bash-stderr>')
      .prompt('<bash-stderr>err</bash-stderr>')
      .prompt('   '))
    expect(s.feed).toEqual([])
    expect(s.inTurn).toBe(false)
  })

  it('prompts queued while Claude works are prompts too (not a peer message)', () => {
    const log = newLog()
      .prompt('first')
      .toolUse('t1', 'Bash', { command: 'sleep 5' })
      .queuedPrompt('also do this')
      .queuedPrompt('message from a peer', 'peer')
      .queuedPrompt('<pasted_content>x</pasted_content> pasted while busy')
      .attachment({ type: 'queued_command', commandMode: 'prompt', origin: { kind: 'human' },
        prompt: [{ type: 'text', text: 'look at this' }, { type: 'image', source: { type: 'base64', data: '' } }] })
      .attachment({ type: 'queued_command', commandMode: 'prompt', prompt: [{ type: 'image', source: {} }] })
      .attachment({ type: 'edited_text_file', filename: '/x' })
    expect(texts(parse(log).feed, 'prompt')).toEqual(['first', 'also do this', 'x pasted while busy', 'look at this', '[image]'])
  })
})

describe('SessionState: assistant output', () => {
  it('thinking keeps its text, or "" when only the signature was logged; empty text blocks are skipped', () => {
    const s = parse(newLog()
      .thinking('')
      .thinking('  Considering options  ')
      .assistantBlocks([{ type: 'redacted_thinking', data: 'xyz' }, { type: 'text', text: '   ' }, { type: 'text', text: ' Hello ' }]))
    expect(s.feed).toEqual([
      { kind: 'thinking', text: '' },
      { kind: 'thinking', text: 'Considering options' },
      { kind: 'thinking', text: '' },
      { kind: 'reply', text: 'Hello' },
    ])
  })

  it('a tool call runs with its summary and is updated in place when its result arrives', () => {
    const log = newLog().prompt('go')
      .toolUse('t1', 'Bash', { command: 'npm test', description: 'Run tests' })
      .toolUse('t2', 'Read', { file_path: join(FOLDER, 'src', 'a.ts') })
    const f = feeder(log)
    expect(f.update().feed.slice(1)).toEqual([
      { kind: 'tool', id: 't1', name: 'Bash', summary: 'Run tests', state: 'running' },
      { kind: 'tool', id: 't2', name: 'Read', summary: join('src', 'a.ts'), state: 'running' },
    ])
    expect([...f.s.pending]).toEqual([['t1', 'Bash'], ['t2', 'Read']])
    log.toolResult('t2').toolResult('t1', { isError: true, content: 'Exit code 1\nFAIL src/a.test.ts' })
    expect(f.update().feed.slice(1)).toEqual([
      { kind: 'tool', id: 't1', name: 'Bash', summary: 'Run tests', state: 'error', error: 'Exit code 1' },
      { kind: 'tool', id: 't2', name: 'Read', summary: join('src', 'a.ts'), state: 'done' },
    ])
    expect(f.s.pending.size).toBe(0)
    expect(f.s.inTurn).toBe(true)
  })

  it('tool errors: tool_use_error tags dropped, text blocks joined, first line only, at most 300 characters', () => {
    const s = parse(newLog().prompt('go')
      .toolUse('t1', 'Edit', { file_path: join(FOLDER, 'a.ts') })
      .toolResult('t1', { isError: true, content: '<tool_use_error>File has not been read yet. Read it first.</tool_use_error>' })
      .toolUse('t2', 'WebFetch', { url: 'https://x.test' })
      .toolResult('t2', { isError: true, content: [{ type: 'text', text: 'Request failed' }, { type: 'text', text: 'with 404' }] })
      .toolUse('t3', 'Bash', { command: 'x' })
      .toolResult('t3', { isError: true, content: 'e'.repeat(500) }))
    const errors = s.feed.flatMap((i) => (i.kind === 'tool' ? [i.error] : []))
    expect(errors).toEqual(['File has not been read yet. Read it first.', 'Request failed with 404', 'e'.repeat(300)])
  })

  it('MCP tool names are shown as server:tool', () => {
    const s = parse(newLog().toolUse('t1', 'mcp__github__get_issue', { summary: 'Issue 4' }))
    expect(s.feed).toEqual([{ kind: 'tool', id: 't1', name: 'github:get_issue', summary: 'Issue 4', state: 'running' }])
    expect(s.pending.get('t1')).toBe('mcp__github__get_issue')
  })

  it('an interrupt is an error notice and ends the turn; a tool still waiting for its result was interrupted', () => {
    const s = parse(newLog().prompt('go')
      .toolUse('t1', 'Bash', { command: 'sleep 100' })
      .toolResult('t1', { isError: true, content: '[Request interrupted by user for tool use]' })
      .toolUse('t2', 'Bash', { command: 'sleep 200' })
      .interrupt(true))
    expect(s.feed.slice(1)).toEqual([
      { kind: 'tool', id: 't1', name: 'Bash', summary: 'sleep 100', state: 'error', error: '[Request interrupted by user for tool use]' },
      { kind: 'tool', id: 't2', name: 'Bash', summary: 'sleep 200', state: 'error', error: 'interrupted' },
      { kind: 'notice', text: 'interrupted', tone: 'error' },
    ])
    expect(s.inTurn).toBe(false)
    expect(s.pending.size).toBe(0)
  })

  it('an API error ends the turn: a tool still waiting for its result was interrupted', () => {
    const s = parse(newLog().prompt('go').toolUse('t1', 'Read', { file_path: join(FOLDER, 'a.ts') }).apiError('API Error: Overloaded'))
    expect(s.feed.find((i) => i.kind === 'tool')).toMatchObject({ id: 't1', state: 'error', error: 'interrupted' })
  })

  it('a result that comes after the turn ended still sets its state', () => {
    const log = newLog().prompt('go').toolUse('t1', 'Bash', { command: 'make' }).interrupt()
    const f = feeder(log)
    expect(f.update().feed[1]).toMatchObject({ state: 'error', error: 'interrupted' })
    log.toolResult('t1')
    expect(f.update().feed[1]).toEqual({ kind: 'tool', id: 't1', name: 'Bash', summary: 'make', state: 'done' })
  })

  it('compaction: the summary it restarts from is skipped; the boundary is a notice', () => {
    const s = parse(newLog().prompt('go').compactBoundary().compactSummary())
    expect(s.feed).toEqual([
      { kind: 'prompt', text: 'go' },
      { kind: 'notice', text: 'conversation compacted', tone: 'info' },
    ])
  })

  it('informational, model refusal fallback and scheduled task notices; other system lines are not shown', () => {
    const s = parse(newLog()
      .system('informational', { content: 'You have used 90% of your limit\nmore' })
      .system('model_refusal_fallback', { content: 'Switched to the fallback model' })
      .system('scheduled_task_fire', { content: 'Running a scheduled task' })
      .system('informational', {})
      .system('stop_hook_summary', { hookCount: 0 })
      .system('away_summary', { content: 'While you were away' })
      .system('local_command', { content: '<local-command-stdout>x</local-command-stdout>' }))
    expect(s.feed).toEqual([
      { kind: 'notice', text: 'You have used 90% of your limit', tone: 'info' },
      { kind: 'notice', text: 'Switched to the fallback model', tone: 'info' },
      { kind: 'notice', text: 'Running a scheduled task', tone: 'info' },
    ])
  })

  it('API errors: an error notice and the error, the turn ends; the model and context are kept', () => {
    const log = newLog().prompt('go')
      .reply('partial', { model: 'claude-opus-5-5', stopReason: 'tool_use', usage: { input_tokens: 5, cache_read_input_tokens: 70_000, cache_creation_input_tokens: 2_000 } })
      .apiError('API Error: Rate limit reached\nRetry later')
    const f = feeder(log)
    const s = f.update()
    expect(s.feed.at(-1)).toEqual({ kind: 'notice', text: 'API Error: Rate limit reached', tone: 'error' })
    expect(s.error).toBe('API Error: Rate limit reached')
    expect(s.inTurn).toBe(false)
    expect(s.model).toBe('claude-opus-5-5')
    expect(s.contextTokens).toBe(72_005)
    log.prompt('again')
    expect(f.update().error).toBe('')
    log.apiError('', 'server_error')
    expect(f.update().error).toBe('server_error')
  })

  it('a <synthetic> reply that is not an error keeps the model', () => {
    const s = parse(newLog().reply('real', { model: 'claude-fable-5' }).reply('No response requested.', { model: '<synthetic>', usage: {} }))
    expect(s.model).toBe('claude-fable-5')
    expect(texts(s.feed, 'reply')).toEqual(['real', 'No response requested.'])
  })

  it('keeps the newest 600 items, and still updates tool items in place', () => {
    const log = newLog()
    for (let i = 0; i < 700; i++) log.reply(`r${i}`, { stopReason: 'tool_use' })
    log.toolUse('t1', 'Bash', { command: 'ls' })
    const f = feeder(log)
    f.update()
    log.toolResult('t1')
    const feed = f.update().feed
    expect(feed).toHaveLength(600)
    expect(feed[0]).toEqual({ kind: 'reply', text: 'r101' })
    expect(feed.at(-1)).toMatchObject({ kind: 'tool', id: 't1', state: 'done' })
  })
})

describe('SessionState: turns and session fields', () => {
  it('a turn ends with end_turn, or with turn_duration', () => {
    const log = newLog().prompt('a').reply('x', { stopReason: 'end_turn' })
    const f = feeder(log)
    expect(f.update().inTurn).toBe(false)
    log.prompt('b').reply('y', { stopReason: 'stop_sequence' })
    expect(f.update().inTurn).toBe(true)
    log.turnDuration()
    expect(f.update().inTurn).toBe(false)
  })

  it('pending tools are cleared when the turn ends; after a normal end, one without a result is done', () => {
    const s = parse(newLog().prompt('a').toolUse('t1', 'Bash', { command: 'x' }).turnDuration()
      .prompt('b').toolUse('t2', 'Glob', { pattern: '*.md' }).reply('fine', { stopReason: 'end_turn' }))
    expect(s.pending.size).toBe(0)
    expect(s.feed.filter((i) => i.kind === 'tool')).toEqual([
      { kind: 'tool', id: 't1', name: 'Bash', summary: 'x', state: 'done' },
      { kind: 'tool', id: 't2', name: 'Glob', summary: '*.md', state: 'done' },
    ])
  })

  it('cost-state: exited, and background work ended with it; a resumed session is not exited', () => {
    const log = newLog().prompt('a')
      .toolUse('t1', 'Agent', { subagent_type: 'Explore', description: 'look' })
      .toolResult('t1', { toolUseResult: { status: 'async_launched', agentId: 'ag1' } })
      .toolUse('t2', 'Bash', { command: 'npm run dev', run_in_background: true })
      .toolResult('t2', { toolUseResult: { stdout: '', backgroundTaskId: 'bash1' } })
      .toolUse('t3', 'Bash', { command: 'sleep 9' })
      .costState()
    const f = feeder(log)
    const s = f.update()
    expect(s.exited).toBe(true)
    expect(s.inTurn).toBe(false)
    expect(s.pending.size).toBe(0)
    expect(s.feed.find((i) => i.kind === 'tool' && i.id === 't3')).toMatchObject({ state: 'error', error: 'interrupted' })
    expect(s.background.size).toBe(0)
    expect([...s.agents.values()].every((a) => a.done)).toBe(true)
    log.prompt('resumed')
    expect(f.update().exited).toBe(false)
  })

  it('model, context, branch, permission mode and PR', () => {
    const log = newLog()
    log.branch = 'feature/x'
    log.permissionMode('bypassPermissions').prLink(31)
      .reply('a', { model: 'claude-opus-5', usage: { input_tokens: 1, cache_read_input_tokens: 2, cache_creation_input_tokens: 3, output_tokens: 99 } })
      .reply('b', { model: 'claude-opus-5-5', usage: { input_tokens: 0, cache_read_input_tokens: 0, cache_creation_input_tokens: 0 } })
    const s = parse(log)
    expect(s.model).toBe('claude-opus-5-5')
    expect(s.contextTokens).toBe(6) // an entry without usage doesn't reset it
    expect(s.branch).toBe('feature/x')
    expect(s.mode).toBe('bypassPermissions')
    expect(s.pr).toBe('PR #31')
    log.permissionMode('default')
    expect(parse(log).mode).toBe('default')
  })

  it('sub-agent (sidechain) lines in the session log are not shown, but their branch counts', () => {
    const s = parse(newLog().raw({
      type: 'assistant', isSidechain: true, gitBranch: 'side', sessionId: 's',
      message: { model: 'claude-x', content: [{ type: 'text', text: 'agent reply' }], stop_reason: 'end_turn' },
    }))
    expect(s.feed).toEqual([])
    expect(s.branch).toBe('side')
    expect(s.model).toBe('')
  })

  it('ignores entries it does not understand, without throwing', () => {
    const s = new SessionState(FOLDER)
    for (const e of [null, 42, 'text', [], {}, { type: 'user' }, { type: 'user', message: { content: 42 } },
      { type: 'user', message: { content: [null, 1, { type: 'tool_result' }] } },
      { type: 'assistant', message: { content: 'string', usage: { input_tokens: 'many' } } },
      { type: 'assistant', message: { content: [{ type: 'tool_use' }, { type: 'tool_use', name: 'TodoWrite', input: { todos: 'x' } }] } },
      { type: 'attachment', attachment: null }, { type: 'system', subtype: 'informational', content: 7 },
      { type: 'pr-link' }, { type: 'custom-title', customTitle: 5 }, { type: 'last-prompt', lastPrompt: 'x' }]) {
      expect(() => s.ingest(e)).not.toThrow()
    }
    expect(s.customTitle).toBe('')
    expect(s.pr).toBeNull()
  })
})

describe('SessionState: agents and background tasks', () => {
  const launch = (log: LogWriter, id: string, agentId: string) => log
    .toolUse(id, 'Agent', { subagent_type: 'Explore', description: `agent ${agentId}`, prompt: 'Find things', run_in_background: false })
    .toolResult(id, { content: 'Async agent launched', toolUseResult: { status: 'async_launched', agentId, isAsync: true, description: 'x' } })

  it('an async agent runs until its task-notification (a user entry)', () => {
    const log = launch(newLog().prompt('go'), 't1', 'ag1').reply('Waiting for the agent.')
    const f = feeder(log)
    expect([...f.update().agents]).toEqual([['t1', { type: 'Explore', description: 'agent ag1', id: 'ag1', done: false, failed: false }]])
    log.notification({ taskId: 'ag1', toolUseId: 't1', status: 'completed', summary: 'Agent "agent ag1" completed' })
    const s = f.update()
    expect(s.agents.get('t1')).toMatchObject({ done: true, failed: false })
    expect(s.feed.at(-1)).toEqual({ kind: 'notice', text: 'Agent "agent ag1" completed', tone: 'info' })
    expect(s.inTurn).toBe(false) // a notification is not a prompt
  })

  it('… or a queued attachment while Claude is busy, matched by agent id', () => {
    const log = launch(newLog().prompt('go'), 't1', 'ag1')
      .notification({ taskId: 'ag1', status: 'failed', summary: 'Agent failed' }, { queued: true })
    const s = parse(log)
    expect(s.agents.get('t1')).toMatchObject({ done: true, failed: true })
    expect(s.feed.at(-1)).toEqual({ kind: 'notice', text: 'Agent failed', tone: 'error' })
  })

  it('a notification without a summary adds no notice', () => {
    const s = parse(launch(newLog(), 't1', 'ag1').notification({ taskId: 'ag1', toolUseId: 't1', status: 'killed' }))
    expect(s.agents.get('t1')).toMatchObject({ done: true, failed: false })
    expect(s.feed.filter((i) => i.kind === 'notice')).toEqual([])
  })

  it('an agent that returns at once is done with its result; failed when the result is an error', () => {
    const s = parse(newLog()
      .toolUse('t1', 'Task', { description: 'sync one' })
      .toolResult('t1', { toolUseResult: { status: 'completed', agentId: 'ag1' } })
      .toolUse('t2', 'Agent', { prompt: 'Do the thing\nwith details' })
      .toolResult('t2', { isError: true, content: 'Agent crashed' }))
    expect([...s.agents.values()]).toEqual([
      { type: 'agent', description: 'sync one', id: 'ag1', done: true, failed: false },
      { type: 'agent', description: 'Do the thing', id: null, done: true, failed: true },
    ])
  })

  it('SendMessage reopens a finished agent; TaskStop ends it', () => {
    const log = launch(newLog(), 't1', 'ag1').notification({ taskId: 'ag1', toolUseId: 't1', status: 'completed', summary: 'done' })
      .toolUse('t2', 'SendMessage', { to: 'ag1', message: 'one more thing', summary: 'More' })
    const f = feeder(log)
    expect(f.update().agents.get('t1')?.done).toBe(false)
    log.toolUse('t3', 'TaskStop', { task_id: 'ag1' })
    expect(f.update().agents.get('t1')?.done).toBe(true)
  })

  it('a background shell task runs until its notification; TaskStop ends one too', () => {
    const log = newLog().prompt('go')
      .toolUse('t1', 'Bash', { command: 'npm run dev', run_in_background: true })
      .toolResult('t1', { toolUseResult: { stdout: '', stderr: '', backgroundTaskId: 'b1' } })
      .toolUse('t2', 'Bash', { command: 'npm run watch', run_in_background: true })
      .toolResult('t2', { toolUseResult: { stdout: '', stderr: '', backgroundTaskId: 'b2' } })
    const f = feeder(log)
    expect([...f.update().background]).toEqual(['b1', 'b2'])
    log.notification({ taskId: 'b1', toolUseId: 't1', status: 'completed', summary: 'Background command "npm run dev" completed (exit code 0)' })
    expect([...f.update().background]).toEqual(['b2'])
    log.toolUse('t3', 'TaskStop', { task_id: 'b2' })
    expect(f.update().background.size).toBe(0)
  })
})

describe('SessionState: titles and to-dos', () => {
  it('custom title (/rename) wins over the AI title; the first prompt is kept for when there is neither', () => {
    const log = newLog().prompt('Make the header sticky\nand more')
    const f = feeder(log)
    expect(f.update()).toMatchObject({ customTitle: '', aiTitle: '', firstPrompt: 'Make the header sticky' })
    log.aiTitle('Sticky header').customTitle('My name').aiTitle('Sticky header v2')
    expect(f.update()).toMatchObject({ customTitle: 'My name', aiTitle: 'Sticky header v2' })
  })

  it('the first prompt is cut to 80 characters; [image] is not a title', () => {
    const s = parse(newLog().prompt('', { images: 1 }).prompt('y'.repeat(100)))
    expect(s.firstPrompt).toBe('y'.repeat(80))
  })

  it('older logs: the AI title in `title`, and `summary` entries', () => {
    expect(parse(newLog().raw({ type: 'ai-title', title: 'Old style' })).aiTitle).toBe('Old style')
    expect(parse(newLog().raw({ type: 'summary', summary: 'Before 2.1', leafUuid: 'x' })).aiTitle).toBe('Before 2.1')
  })

  it('TodoWrite: the latest list', () => {
    const s = parse(newLog()
      .toolUse('t1', 'TodoWrite', { todos: [{ content: 'old', status: 'pending', activeForm: 'Doing old' }] })
      .toolUse('t2', 'TodoWrite', { todos: [
        { content: 'Write tests', status: 'completed', activeForm: 'Writing tests' },
        { content: 'Implement', status: 'in_progress', activeForm: 'Implementing' },
        { status: 'pending', activeForm: 'Only an active form' },
        'not an object',
      ] }))
    expect(s.todos()).toEqual([
      { status: 'completed', text: 'Write tests' },
      { status: 'in_progress', text: 'Implement' },
      { status: 'pending', text: 'Only an active form' },
    ])
  })

  it('TaskCreate / TaskUpdate when there is no TodoWrite list', () => {
    const s = parse(newLog()
      .toolUse('t1', 'TaskCreate', { subject: 'First', description: 'd1' })
      .toolUse('t2', 'TaskCreate', { description: 'Second' })
      .toolUse('t3', 'TaskUpdate', { taskId: '2', status: 'in_progress' })
      .toolUse('t4', 'TaskUpdate', { taskId: '9', status: 'completed' }))
    expect(s.todos()).toEqual([
      { status: 'pending', text: 'First' },
      { status: 'in_progress', text: 'Second' },
    ])
  })
})

/** Parses the log with each line's place, as the app's tail gives them. */
function parsePlaced(log: LogWriter, maxFeed?: number): SessionState {
  const s = new SessionState(FOLDER, FOLDER, maxFeed)
  for (const line of readLines(log.path)) s.ingest(line.entry, { offset: line.offset, length: line.length })
  return s
}
const id = (bytes: Uint8Array) => imageId(Buffer.from(bytes).toString('base64'))
const ref = (bytes: Uint8Array, width: number, height: number, paste?: number): ClaudeImage =>
  ({ id: id(bytes), format: 'png', width, height, bytes: bytes.length, ...(paste ? { paste } : {}) })
const imagesOn = (item: ClaudeFeedItem | undefined) => (item && 'images' in item ? item.images : undefined)

describe('SessionState: images', () => {
  const a = pngBytes(64, 48)
  const b = pngBytes(32, 32)

  it('a prompt with text and two pasted images: the images, numbered by imagePasteIds, in paste order', () => {
    const s = parsePlaced(newLog().prompt('what are these?', { images: [a, b], pasteIds: [3, 4] }))
    expect(s.feed).toEqual([{ kind: 'prompt', text: 'what are these?', images: [ref(a, 64, 48, 3), ref(b, 32, 32, 4)] }])
  })

  it('an image-only prompt is "[image]" with its images; without imagePasteIds they have no number', () => {
    const s = parsePlaced(newLog().prompt('', { images: [a] }))
    expect(s.feed).toEqual([{ kind: 'prompt', text: '[image]', images: [ref(a, 64, 48)] }])
    expect(s.firstPrompt).toBe('')
  })

  it('a prompt typed while Claude worked: its images and the numbers in its attachment', () => {
    const s = parsePlaced(newLog().prompt('go').queuedBlocks([{ type: 'text', text: 'and this' }, imageBlock(a)], { pasteIds: [2] })
      .queuedBlocks([imageBlock(b)]))
    expect(s.feed.slice(1)).toEqual([
      { kind: 'prompt', text: 'and this', images: [ref(a, 64, 48, 2)] },
      { kind: 'prompt', text: '[image]', images: [ref(b, 32, 32)] },
    ])
  })

  it("a Read result, an MCP result with text and an image, and an error result with an image go on their tool's item", () => {
    const jpeg = jpegBytes(923, 2000)
    const s = parsePlaced(newLog().prompt('go')
      .readImage('t1', join(FOLDER, 'docs', 'shot.png'), a)
      .toolUse('t2', 'mcp__claude-in-chrome__computer', { action: 'screenshot' })
      .toolResult('t2', { content: [{ type: 'text', text: 'Took a screenshot' }, imageBlock(jpeg, 'image/jpeg')] })
      .toolUse('t3', 'mcp__browser__shot', { url: 'https://example.com' })
      .toolResult('t3', { isError: true, content: [{ type: 'text', text: 'Page crashed' }, imageBlock(b)] }))
    expect(s.feed.slice(1)).toEqual([
      { kind: 'tool', id: 't1', name: 'Read', summary: join('docs', 'shot.png'), state: 'done', images: [ref(a, 64, 48)] },
      {
        kind: 'tool', id: 't2', name: 'claude-in-chrome:computer', summary: '', state: 'done',
        images: [{ id: id(jpeg), format: 'jpeg', width: 923, height: 2000, bytes: jpeg.length }],
      },
      { kind: 'tool', id: 't3', name: 'browser:shot', summary: 'https://example.com', state: 'error', error: 'Page crashed', images: [ref(b, 32, 32)] },
    ])
  })

  it("Read's toolUseResult, which repeats the image, isn't read", () => {
    const s = parsePlaced(newLog().toolUse('t1', 'Read', { file_path: join(FOLDER, 'a.png') })
      .toolResult('t1', { content: [imageBlock(a)], toolUseResult: { type: 'image', file: { base64: Buffer.from(b).toString('base64') } } }))
    expect(imagesOn(s.feed[0])).toEqual([ref(a, 64, 48)])
  })

  it("an image pasted into an answer (AskUserQuestion) goes on the question's item, with no [image] prompt", () => {
    const s = parsePlaced(newLog().prompt('go')
      .toolUse('t1', 'AskUserQuestion', { questions: [{ question: 'Which layout?' }] })
      .userBlocks([{ type: 'tool_result', tool_use_id: 't1', content: 'User answered: like this' }, imageBlock(a)], { imagePasteIds: [1] }))
    expect(s.feed).toEqual([
      { kind: 'prompt', text: 'go' },
      { kind: 'tool', id: 't1', name: 'AskUserQuestion', summary: 'Which layout?', state: 'done', images: [ref(a, 64, 48, 1)] },
    ])
  })

  it('a result for an item that has left the feed adds nothing', () => {
    const log = newLog().toolUse('t1', 'Read', { file_path: join(FOLDER, 'a.png') })
    for (let i = 0; i < 4; i++) log.reply(`r${i}`, { stopReason: 'tool_use' })
    log.toolResult('t1', { content: [imageBlock(a)] })
    const s = parsePlaced(log, 2)
    expect(s.feed.some((item) => 'images' in item)).toBe(false)
    expect(s.imagePlace(id(a))).toBeNull()
  })

  it('12 images in one item: 10 listed, 2 more counted', () => {
    const many = Array.from({ length: 12 }, (_, i) => pngBytes(10 + i, 10))
    const [item] = parsePlaced(newLog().prompt('all of them', { images: many })).feed
    expect(item).toMatchObject({ kind: 'prompt', moreImages: 2 })
    expect(imagesOn(item)?.map((im) => im.width)).toEqual([10, 11, 12, 13, 14, 15, 16, 17, 18, 19])
  })

  it("images from other origins, meta entries, the compact summary and sub-agents' lines aren't listed", () => {
    const s = parsePlaced(newLog()
      .prompt('from a peer', { origin: 'peer', images: [a] })
      .prompt('skill text', { isMeta: true, images: [a] })
      .userBlocks([{ type: 'text', text: 'summary' }, imageBlock(a)], { isCompactSummary: true })
      .raw({ type: 'user', isSidechain: true, sessionId: 's', message: { role: 'user', content: [imageBlock(a)] } })
      .prompt('mine', { images: [b] }))
    expect(s.feed).toEqual([{ kind: 'prompt', text: 'mine', images: [ref(b, 32, 32)] }])
  })

  it('a slash command with an image drops it; skipped sources still make "[image]"', () => {
    const s = parsePlaced(newLog()
      .userBlocks([imageBlock(a), { type: 'text', text: '<command-name>/clear</command-name>' }])
      .userBlocks([{ type: 'image', source: { type: 'url', url: 'https://example.com/a.png' } }]))
    expect(s.feed).toEqual([{ kind: 'notice', text: '/clear', tone: 'info' }, { kind: 'prompt', text: '[image]' }])
  })

  it('the same image twice gets one id', () => {
    const s = parsePlaced(newLog().prompt('one', { images: [a] }).prompt('again', { images: [pngBytes(64, 48)] }))
    expect(imagesOn(s.feed[0])?.[0].id).toBe(imagesOn(s.feed[1])?.[0].id)
  })

  it("imagePlace: the line holding an image, found by id; null for an id no item lists, or a place that wasn't given", () => {
    const log = newLog().prompt('first', { images: [a] }).readImage('t1', join(FOLDER, 'b.png'), b)
    const s = parsePlaced(log)
    const bytes = readFileSync(log.path)
    for (const image of [a, b]) {
      const place = s.imagePlace(id(image))
      expect(place).not.toBeNull()
      const line = bytes.toString('utf8', place!.offset, place!.offset + place!.length)
      expect(line).toContain(Buffer.from(image).toString('base64'))
    }
    expect(s.imagePlace('0123456789abcdef')).toBeNull()
    expect(parse(log).imagePlace(id(a))).toBeNull() // ingested without places
  })

  it('a place goes with its item when the item leaves the feed', () => {
    const log = newLog().prompt('old', { images: [a] })
    const s = new SessionState(FOLDER, FOLDER, 2)
    const lines = () => readLines(log.path)
    for (const line of lines()) s.ingest(line.entry, { offset: line.offset, length: line.length })
    expect(s.imagePlace(id(a))).not.toBeNull()
    log.reply('x', { stopReason: 'tool_use' }).reply('y', { stopReason: 'tool_use' })
    for (const line of lines().slice(1)) s.ingest(line.entry, { offset: line.offset, length: line.length })
    expect(s.imagePlace(id(a))).toBeNull()
  })

  it('an image beside several tool_results in one entry goes with the last of them', () => {
    const s = parsePlaced(newLog()
      .toolUse('t1', 'Bash', { command: 'one' })
      .toolUse('t2', 'Bash', { command: 'two' })
      .userBlocks([
        { type: 'tool_result', tool_use_id: 't1', content: 'first done' },
        { type: 'tool_result', tool_use_id: 't2', content: 'second done' },
        imageBlock(a),
      ]))
    expect(s.feed).toEqual([
      { kind: 'tool', id: 't1', name: 'Bash', summary: 'one', state: 'done' },
      { kind: 'tool', id: 't2', name: 'Bash', summary: 'two', state: 'done', images: [ref(a, 64, 48)] },
    ])
  })

  it("an answer's image is dropped once its AskUserQuestion has left the feed: no stray [image] prompt", () => {
    const log = newLog().toolUse('t1', 'AskUserQuestion', { questions: [{ question: 'Which?' }] })
    for (let i = 0; i < 4; i++) log.reply(`r${i}`, { stopReason: 'tool_use' })
    log.userBlocks([{ type: 'tool_result', tool_use_id: 't1', content: 'like this' }, imageBlock(a)], { imagePasteIds: [1] })
    const s = parsePlaced(log, 2)
    expect(s.feed).toEqual([{ kind: 'reply', text: 'r2' }, { kind: 'reply', text: 'r3' }])
  })

  it("a queued prompt with images from another origin (a peer) isn't shown", () => {
    const s = parsePlaced(newLog().queuedBlocks([{ type: 'text', text: 'from elsewhere' }, imageBlock(a)], { origin: 'peer' }))
    expect(s.feed).toEqual([])
  })

  it("an entry with a tool_result, prompt text and an image puts the image on the tool (today's rule, pinned)", () => {
    const s = parsePlaced(newLog().toolUse('t1', 'Bash', { command: 'ls' })
      .userBlocks([
        { type: 'tool_result', tool_use_id: 't1', content: 'ok' },
        { type: 'text', text: 'here is a screenshot' },
        imageBlock(a),
      ]))
    expect(s.feed).toEqual([
      { kind: 'tool', id: 't1', name: 'Bash', summary: 'ls', state: 'done', images: [ref(a, 64, 48)] },
      { kind: 'prompt', text: 'here is a screenshot' },
    ])
  })
})
