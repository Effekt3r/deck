import type { ClaudeFeedItem, ClaudeTodo } from '@shared/types'
import { AGENT_TOOLS, asText, describeTool, firstLine, head, isRecord, own, tag, toolLabel } from './describe'

/** Feed items kept (oldest dropped), as the prototype's MAX_EVENTS. */
export const MAX_FEED = 600
// Longest text kept per item. The snapshot cuts shorter (prompts 2,000, replies 8,000), so this only
// bounds memory, and only because what is kept is copied (own()): a cut string would keep its whole
// original alive. 600 items of at most 10,000 characters.
const MAX_TEXT = 10_000

// User text that is never a prompt: command output and reminders.
const NOT_PROMPTS = ['<local-command-caveat>', '<local-command-stdout>', '<local-command-stderr>',
  '<system-reminder>', '<bash-stdout>', '<bash-stderr>']
const SYSTEM_NOTICES = new Set(['informational', 'model_refusal_fallback', 'scheduled_task_fire'])
const USAGE_KEYS = ['input_tokens', 'cache_read_input_tokens', 'cache_creation_input_tokens']

export interface AgentInfo {
  type: string
  description: string
  /** agentId from the launch result: names its log and its task-notification. */
  id: string | null
  done: boolean
  failed: boolean
}

type ToolItem = Extract<ClaudeFeedItem, { kind: 'tool' }>

const str = (x: unknown): string => (typeof x === 'string' ? x : '')
const clip = (s: string) => own(head(s, MAX_TEXT))

/** Python's truthiness (the prototype tests `if e.get(k)`): empty lists and objects are false. */
function truthy(x: unknown): boolean {
  if (Array.isArray(x)) return x.length > 0
  if (isRecord(x)) return Object.keys(x).length > 0
  return Boolean(x)
}

/** `int(x or 0)`: a count from the log, 0 when it isn't one. */
function count(x: unknown): number {
  const n = typeof x === 'number' ? x : typeof x === 'string' ? Number(x) : 0
  return Number.isFinite(n) ? Math.trunc(n) : 0
}

/** origin.kind; a missing origin (older logs) counts as human. */
function originKind(origin: unknown): unknown {
  if (!isRecord(origin)) return 'human'
  return 'kind' in origin ? origin.kind : 'human'
}

/** `<pasted_content …>` wrappers removed (the paste itself stays). */
const cleanPrompt = (text: string) => text.replace(/<\/?pasted_content[^>]*>/g, '').trim()

/**
 * A Claude Code session log, parsed incrementally: entries go in through ingest() in log order.
 * Port of `Session` in claude_activity_pane.py (replayed over 145 real logs without a turn, agent or
 * background task left open in a finished session); CLAUDE.md documents the log format.
 */
export class SessionState {
  private items: ClaudeFeedItem[] = []
  /** Each tool call's feed item, by tool_use id, so its result updates it in place. */
  private readonly tools = new Map<string, ToolItem>()
  /** Sub-agents by the id of the Agent/Task tool call that started them. */
  readonly agents = new Map<string, AgentInfo>()
  /** Background shell tasks still running. */
  readonly background = new Set<string>()
  /** Tool calls without a result yet: tool_use id → tool name. */
  readonly pending = new Map<string, string>()
  private todoList: ClaudeTodo[] = []
  /** TaskCreate/TaskUpdate tasks, by the id Claude gives them (1, 2, …). */
  private readonly tasks = new Map<string, ClaudeTodo>()
  model = ''
  contextTokens = 0
  branch = ''
  /** Permission mode, e.g. 'bypassPermissions'. */
  mode = ''
  pr: string | null = null
  customTitle = ''
  aiTitle = ''
  /** First line of the first prompt, at most 80 characters. */
  firstPrompt = ''
  /** A prompt is being worked on. */
  inTurn = false
  /** The last API error (rate limit, overload, …), until the next prompt or reply. */
  error = ''
  /** Claude quit (until the session is resumed). */
  exited = false
  /** Bumped by every entry: a snapshot built at the same version is the same. */
  version = 0

  /** `realProject`: the project's real path, which tool paths in the log start with (describeTool). */
  constructor(readonly project: string, readonly realProject = project) {}

  /** Oldest first, at most MAX_FEED items. */
  get feed(): ClaudeFeedItem[] {
    this.trim()
    return this.items
  }

  /** The TodoWrite list, else the TaskCreate/TaskUpdate tasks. */
  todos(): ClaudeTodo[] {
    const list = this.todoList.length ? this.todoList : [...this.tasks.values()]
    return list.map((t) => ({ ...t }))
  }

  ingest(entry: unknown): void {
    if (!isRecord(entry)) return
    this.version++
    try {
      this.apply(entry)
    } catch {
      // A shape this parser doesn't know; the prototype skips such a line too.
    }
  }

  private apply(e: Record<string, unknown>): void {
    const t = e.type
    if (t === 'custom-title') {
      if (str(e.customTitle)) this.customTitle = str(e.customTitle)
    } else if (t === 'ai-title') {
      const title = str(e.aiTitle) || str(e.title)
      if (title) this.aiTitle = title
    } else if (t === 'summary') {
      if (str(e.summary)) this.aiTitle = str(e.summary) // Claude Code before 2.1
    } else if (t === 'permission-mode') {
      this.mode = str(e.permissionMode)
    } else if (t === 'pr-link') {
      if (truthy(e.prNumber) && (typeof e.prNumber === 'number' || typeof e.prNumber === 'string')) this.pr = `PR #${e.prNumber}`
    } else if (t === 'cost-state') {
      // Written as Claude exits; its background work dies with it.
      this.exited = true
      this.endTurn(true)
      this.background.clear()
      for (const a of this.agents.values()) a.done = true
    }
    if (t !== 'user' && t !== 'assistant' && t !== 'system' && t !== 'attachment') return
    this.exited = false
    if (str(e.gitBranch)) this.branch = str(e.gitBranch)
    if (e.isSidechain) return // sub-agent traffic is shown from its own log
    if (t === 'system') this.system(e)
    else if (t === 'attachment') this.attachment(e)
    else if (t === 'user') this.user(e)
    else this.assistant(e)
  }

  private add(item: ClaudeFeedItem): void {
    this.items.push(item)
    if (this.items.length >= 2 * MAX_FEED) this.trim()
  }

  private trim(): void {
    if (this.items.length <= MAX_FEED) return
    for (const item of this.items.splice(0, this.items.length - MAX_FEED)) {
      if (item.kind === 'tool' && this.tools.get(item.id) === item) this.tools.delete(item.id)
    }
  }

  private notice(text: string, tone: 'info' | 'error'): void {
    this.add({ kind: 'notice', text: clip(text), tone })
  }

  private system(e: Record<string, unknown>): void {
    const st = e.subtype
    if (st === 'turn_duration') this.endTurn() // written when a turn ends
    else if (st === 'compact_boundary') this.notice('conversation compacted', 'info')
    else if (typeof st === 'string' && SYSTEM_NOTICES.has(st) && truthy(e.content)) this.notice(firstLine(e.content), 'info')
  }

  /** Input that arrived while Claude was busy and was taken in mid-turn: prompts you typed, or
   *  notifications that a background task ended. */
  private attachment(e: Record<string, unknown>): void {
    const a = isRecord(e.attachment) ? e.attachment : {}
    if (a.type !== 'queued_command') return
    if (a.commandMode === 'task-notification') {
      if (typeof a.prompt === 'string') this.notification(a.prompt)
    } else if (originKind(a.origin) === 'human') {
      if (typeof a.prompt === 'string') {
        this.prompt(cleanPrompt(a.prompt))
      } else if (Array.isArray(a.prompt)) {
        // A prompt with a pasted image comes as content blocks.
        const blocks = a.prompt.filter(isRecord)
        const text = blocks.filter((b) => b.type === 'text').map((b) => str(b.text)).join('\n')
        this.prompt(cleanPrompt(text) || (blocks.some((b) => b.type === 'image') ? '[image]' : ''))
      }
    }
  }

  private user(e: Record<string, unknown>): void {
    if (e.isCompactSummary) return // the summary a compacted conversation restarts from
    const message = isRecord(e.message) ? e.message : {}
    const content = message.content
    const blocks = typeof content === 'string' ? [{ type: 'text', text: content }] : Array.isArray(content) ? content : []
    // origin.kind: human (absent in older logs), task-notification, peer, auto-continuation, …
    const human = originKind(e.origin) === 'human' && !e.isMeta
    const texts: string[] = []
    let images = 0
    for (const b of blocks) {
      if (!isRecord(b)) continue
      if (b.type === 'tool_result') {
        this.result(b, e.toolUseResult)
      } else if (b.type === 'text') {
        const text = str(b.text)
        if (text.slice(0, 40).includes('<task-notification>')) this.notification(text)
        else if (human) texts.push(text)
      } else if (b.type === 'image' && human) {
        images++
      }
    }
    const legacy = e.origin === undefined || e.origin === null
    for (const text of texts) this.userText(text, legacy)
    if (images && !texts.length) this.prompt('[image]')
  }

  private userText(raw: string, legacy: boolean): void {
    const text = raw.trim()
    if (!text || NOT_PROMPTS.some((p) => text.startsWith(p))) return
    if (text.startsWith('<command-name>')) {
      this.notice(tag(text, 'command-name') || head(text, 60), 'info')
    } else if (text.startsWith('<bash-input>')) {
      this.add({ kind: 'prompt', text: clip(`! ${tag(text, 'bash-input')}`) }) // runs in the shell, no turn
    } else if (text.startsWith('[Request interrupted')) {
      this.notice('interrupted', 'error')
      this.endTurn(true)
    } else if (legacy && text.startsWith('<') && text.slice(0, 40).includes('>') && !text.startsWith('<pasted')) {
      // Older logs: hook output and reminders arrived as user text.
    } else {
      this.prompt(cleanPrompt(text))
    }
  }

  private prompt(text: string): void {
    if (!text) return
    this.add({ kind: 'prompt', text: clip(text) })
    if (!this.firstPrompt && text !== '[image]') this.firstPrompt = own(firstLine(text, 80))
    this.inTurn = true
    this.error = ''
  }

  /**
   * Nothing is still running once a turn is over, so a tool still waiting for its result gets a final
   * state. `cutOff`: an interrupt, an API error or Claude quitting ended the turn, so the tool never
   * finished (error 'interrupted'); after a normal end (end_turn, turn_duration) it is done, its result
   * just wasn't logged. A result that comes after all still sets its state.
   */
  private endTurn(cutOff = false): void {
    this.inTurn = false
    for (const id of this.pending.keys()) {
      const item = this.tools.get(id)
      if (item?.state !== 'running') continue
      item.state = cutOff ? 'error' : 'done'
      if (cutOff) item.error = 'interrupted'
    }
    this.pending.clear()
  }

  private result(b: Record<string, unknown>, info: unknown): void {
    const id = str(b.tool_use_id)
    const name = this.pending.get(id) ?? ''
    this.pending.delete(id)
    const r = isRecord(info) ? info : {}
    const agent = this.agents.get(id)
    if (agent) {
      if (typeof r.agentId === 'string' && r.agentId) agent.id = r.agentId
      // Agents mostly start async: this result only says "launched" and a <task-notification>
      // reports the end.
      if (r.status !== 'async_launched') {
        agent.done = true
        agent.failed = Boolean(b.is_error)
      }
    }
    if (truthy(r.backgroundTaskId)) this.background.add(asText(r.backgroundTaskId))
    const item = this.tools.get(id)
    if (b.is_error) {
      let text = b.content
      if (Array.isArray(text)) text = text.filter(isRecord).map((x) => str(x.text)).join(' ')
      const error = own(firstLine(asText(text).replace(/<\/?tool_use_error>/g, ''), 300))
      if (item) {
        item.state = 'error'
        item.error = error
      } else {
        this.notice(name ? `${toolLabel(name)}: ${error}` : error, 'error')
      }
    } else if (item) {
      item.state = 'done'
      delete item.error // 'interrupted' by a turn end that came before this result
    }
  }

  /** <task-notification>: a background agent or shell command finished. */
  private notification(text: string): void {
    const task = tag(text, 'task-id')
    const status = tag(text, 'status')
    let agent = this.agents.get(tag(text, 'tool-use-id'))
    if (!agent && task) for (const a of this.agents.values()) if (a.id === task) agent ??= a
    if (agent) {
      agent.done = true
      agent.failed = status === 'failed'
    }
    this.background.delete(task)
    const summary = tag(text, 'summary')
    if (summary) this.notice(firstLine(summary), status === 'failed' ? 'error' : 'info')
  }

  private assistant(e: Record<string, unknown>): void {
    const msg = isRecord(e.message) ? e.message : {}
    const content = Array.isArray(msg.content) ? msg.content : []
    if (e.isApiErrorMessage) {
      // A synthetic reply (model <synthetic>): rate limit, overload, …
      const text = content.filter(isRecord).map((b) => str(b.text)).join(' ')
      this.error = own(firstLine(text, 120)) || asText(e.error) || 'API error'
      this.notice(this.error, 'error')
      this.endTurn(true)
      return
    }
    this.inTurn = true
    this.error = ''
    if (str(msg.model) && msg.model !== '<synthetic>') this.model = str(msg.model)
    const usage = isRecord(msg.usage) ? msg.usage : {}
    const total = USAGE_KEYS.reduce((sum, k) => sum + count(usage[k]), 0)
    if (total) this.contextTokens = total
    for (const b of content) {
      if (!isRecord(b)) continue
      if (b.type === 'thinking') {
        this.add({ kind: 'thinking', text: clip(str(b.thinking).trim()) })
      } else if (b.type === 'redacted_thinking') {
        this.add({ kind: 'thinking', text: '' })
      } else if (b.type === 'text') {
        const text = str(b.text).trim()
        if (text) this.add({ kind: 'reply', text: clip(text) })
      } else if (b.type === 'tool_use') {
        this.toolUse(b)
      }
    }
    if (msg.stop_reason === 'end_turn') this.endTurn()
  }

  private toolUse(b: Record<string, unknown>): void {
    const name = str(b.name) || '?'
    const input = isRecord(b.input) ? b.input : {}
    const id = str(b.id)
    this.pending.set(id, name)
    const summary = clip(describeTool(name, input, this.project, this.realProject))
    const item: ToolItem = { kind: 'tool', id, name: toolLabel(name), summary, state: 'running' }
    this.add(item)
    this.tools.set(id, item)
    if (AGENT_TOOLS.has(name)) {
      this.agents.set(id, {
        type: str(input.subagent_type) || 'agent',
        description: str(input.description) || own(firstLine(input.prompt, 60)),
        id: null,
        done: false,
        failed: false,
      })
    } else if (name === 'SendMessage') {
      // Continues an agent that had finished.
      for (const a of this.agents.values()) if (a.id && a.id === input.to) a.done = false
    } else if (name === 'TaskStop') {
      const task = asText(input.task_id)
      this.background.delete(task)
      if (task) for (const a of this.agents.values()) if (a.id === task) a.done = true
    } else if (name === 'TodoWrite') {
      const todos = Array.isArray(input.todos) ? input.todos : []
      this.todoList = todos.filter(isRecord).map((td) => ({ status: str(td.status), text: str(td.content) || str(td.activeForm) }))
    } else if (name === 'TaskCreate') {
      this.tasks.set(String(this.tasks.size + 1), { status: 'pending', text: str(input.subject) || str(input.description) })
    } else if (name === 'TaskUpdate') {
      const task = this.tasks.get(asText(input.taskId) || asText(input.id))
      if (task && truthy(input.status)) task.status = asText(input.status)
    }
  }
}
