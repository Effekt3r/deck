// Test helper: Claude Code session logs written by hand in the shapes CLAUDE.md documents
// ("Claude Code session logs"), into throwaway homes passed as CLAUDE_CONFIG_DIR. Real logs hold
// client code and prompts: never copy one here. Not used by the app.
import { randomUUID } from 'node:crypto'
import { appendFileSync, mkdirSync, mkdtempSync, readFileSync, realpathSync, rmSync, utimesSync, writeFileSync } from 'node:fs'
import { tmpdir } from 'node:os'
import { dirname, join } from 'node:path'
import { encodeFolder } from './locator'

const made: string[] = []
// Entries get increasing, fixed timestamps.
let clock = Date.UTC(2026, 9, 30, 9, 0, 0)

/** An empty Claude home (with `projects/`) that removeClaudeHomes() deletes. */
export function makeClaudeHome(): string {
  const dir = realpathSync.native(mkdtempSync(join(tmpdir(), 'deck-claude-')))
  made.push(dir)
  mkdirSync(join(dir, 'projects'))
  return dir
}

/** A folder that removeClaudeHomes() deletes (e.g. a project folder that must exist). */
export function makeFolder(prefix = 'deck-folder-'): string {
  const dir = realpathSync.native(mkdtempSync(join(tmpdir(), prefix)))
  made.push(dir)
  return dir
}

export function removeClaudeHomes(): void {
  for (const dir of made.splice(0)) {
    try {
      rmSync(dir, { recursive: true, force: true, maxRetries: 3 })
    } catch {
      // A watcher still closing on Windows can hold a handle; the OS cleans tmp eventually.
    }
  }
}

/** The log's lines, parsed (lines that aren't JSON are left out). */
export function readEntries(path: string): unknown[] {
  const out: unknown[] = []
  for (const line of readFileSync(path, 'utf8').split('\n')) {
    try {
      if (line.trim()) out.push(JSON.parse(line))
    } catch {
      // a deliberately broken line
    }
  }
  return out
}

export interface Usage {
  input_tokens?: number
  cache_read_input_tokens?: number
  cache_creation_input_tokens?: number
  output_tokens?: number
}

export interface AssistantOptions {
  model?: string
  usage?: Usage
  /** `end_turn` on every block of a turn's last message, else `tool_use` (each block of a message carries it). */
  stopReason?: string | null
}

export interface PromptOptions {
  /** origin.kind; null leaves `origin` out, as older logs do. Default 'human'. */
  origin?: string | null
  isMeta?: boolean
  /** Pasted images before the text. */
  images?: number
}

export interface Notification {
  taskId: string
  toolUseId?: string
  status?: string
  summary?: string
}

/** Appends one JSONL line per call to a session (or sub-agent) log. */
export class LogWriter {
  /** gitBranch of the lines written from now on. */
  branch = 'main'
  model = 'claude-opus-5-5'
  private parent: string | null = null

  constructor(
    readonly path: string,
    readonly sessionId: string,
    readonly cwd: string,
    private readonly agentId: string | null = null,
  ) {
    mkdirSync(dirname(path), { recursive: true })
  }

  /** Appends `entry` as JSON, or a string as the line itself (e.g. broken JSON). */
  raw(entry: unknown): this {
    appendFileSync(this.path, `${typeof entry === 'string' ? entry : JSON.stringify(entry)}\n`)
    return this
  }

  /** Appends text without a newline (a line Claude is still writing). */
  partial(text: string): this {
    appendFileSync(this.path, text)
    return this
  }

  /** Sets the log's modification time (ms since epoch). */
  touch(ms: number): this {
    utimesSync(this.path, ms / 1000, ms / 1000)
    return this
  }

  /** The fields every user/assistant/system/attachment line carries. */
  private line(type: string, fields: Record<string, unknown>): this {
    const uuid = randomUUID()
    clock += 1000
    this.raw({
      parentUuid: this.parent,
      isSidechain: this.agentId !== null,
      ...(this.agentId ? { agentId: this.agentId } : {}),
      type,
      ...fields,
      uuid,
      timestamp: new Date(clock).toISOString(),
      userType: 'external',
      entrypoint: 'cli',
      cwd: this.cwd,
      sessionId: this.sessionId,
      version: '2.1.283',
      gitBranch: this.branch,
    })
    this.parent = uuid
    return this
  }

  /** A typed prompt: content string, or image blocks then a text block. */
  prompt(text: string, opts: PromptOptions = {}): this {
    const { origin = 'human', isMeta, images = 0 } = opts
    const content = images
      ? [
          ...Array.from({ length: images }, () => ({ type: 'image', source: { type: 'base64', media_type: 'image/png', data: '' } })),
          ...(text ? [{ type: 'text', text }] : []),
        ]
      : text
    return this.line('user', {
      promptId: randomUUID(),
      message: { role: 'user', content },
      ...(origin === null ? {} : { origin: { kind: origin } }),
      ...(isMeta ? { isMeta: true } : {}),
    })
  }

  /** User entry with arbitrary content blocks. */
  userBlocks(content: unknown[], fields: Record<string, unknown> = {}): this {
    return this.line('user', { message: { role: 'user', content }, ...fields })
  }

  /** Esc pressed: a text block without `origin`. */
  interrupt(forToolUse = false): this {
    return this.userBlocks([{ type: 'text', text: `[Request interrupted by user${forToolUse ? ' for tool use' : ''}]` }])
  }

  /** A slash command as the log records it (string content, no `origin`). */
  slashCommand(name: string, args = ''): this {
    return this.line('user', {
      message: {
        role: 'user',
        content: `<command-name>${name}</command-name>\n<command-message>${name.slice(1)}</command-message>\n<command-args>${args}</command-args>`,
      },
    })
  }

  /** An assistant line with these content blocks (the log writes one block per line). */
  assistantBlocks(content: unknown[], opts: AssistantOptions = {}, defaultStop = 'tool_use'): this {
    const usage = opts.usage ?? { input_tokens: 10, cache_read_input_tokens: 1000, cache_creation_input_tokens: 100, output_tokens: 50 }
    return this.line('assistant', {
      requestId: `req_${randomUUID()}`,
      message: {
        model: opts.model ?? this.model,
        id: `msg_${randomUUID()}`,
        type: 'message',
        role: 'assistant',
        content,
        stop_reason: opts.stopReason === undefined ? defaultStop : opts.stopReason,
        stop_sequence: null,
        usage: { input_tokens: 0, cache_read_input_tokens: 0, cache_creation_input_tokens: 0, output_tokens: 0, ...usage },
      },
    })
  }

  private assistant(block: Record<string, unknown>, opts: AssistantOptions, defaultStop: string): this {
    return this.assistantBlocks([block], opts, defaultStop)
  }

  /** A thinking block; '' is what the log keeps when only the signature was stored. */
  thinking(text = '', opts: AssistantOptions = {}): this {
    return this.assistant({ type: 'thinking', thinking: text, signature: 'c2lnbmF0dXJl' }, opts, 'tool_use')
  }

  /** A text block; by default the turn's last one (`end_turn`). */
  reply(text: string, opts: AssistantOptions = {}): this {
    return this.assistant({ type: 'text', text }, opts, 'end_turn')
  }

  toolUse(id: string, name: string, input: unknown, opts: AssistantOptions = {}): this {
    return this.assistant({ type: 'tool_use', id, name, input }, opts, 'tool_use')
  }

  toolResult(id: string, opts: { isError?: boolean; content?: unknown; toolUseResult?: unknown } = {}): this {
    const { isError = false, content = isError ? 'Exit code 1\nfailed' : 'ok' } = opts
    const toolUseResult = 'toolUseResult' in opts
      ? opts.toolUseResult
      : { stdout: typeof content === 'string' ? content : '', stderr: '', interrupted: false, isImage: false }
    return this.line('user', {
      message: { role: 'user', content: [{ tool_use_id: id, type: 'tool_result', content, is_error: isError }] },
      ...(toolUseResult === undefined ? {} : { toolUseResult }),
      sourceToolAssistantUUID: this.parent,
    })
  }

  system(subtype: string, fields: Record<string, unknown> = {}): this {
    return this.line('system', { subtype, isMeta: false, level: 'info', ...fields })
  }

  /** Written when a turn ends (after stop_hook_summary). */
  turnDuration(): this {
    return this.system('turn_duration', { durationMs: 1234, messageCount: 4, isMeta: true })
  }

  compactBoundary(): this {
    return this.system('compact_boundary', {
      content: 'Conversation compacted',
      compactMetadata: { trigger: 'auto', preTokens: 150000 },
      logicalParentUuid: this.parent,
    })
  }

  /** The summary a compacted conversation restarts from. */
  compactSummary(): this {
    return this.line('user', {
      message: { role: 'user', content: 'This session is being continued from a previous conversation that ran out of context.' },
      isCompactSummary: true,
      isVisibleInTranscriptOnly: true,
    })
  }

  attachment(attachment: Record<string, unknown>): this {
    return this.line('attachment', { attachment })
  }

  /** A prompt typed while Claude was busy, taken in mid-turn. */
  queuedPrompt(text: string, origin: string | null = 'human'): this {
    return this.attachment({
      type: 'queued_command',
      prompt: text,
      commandMode: 'prompt',
      ...(origin === null ? {} : { origin: { kind: origin } }),
      source_uuid: randomUUID(),
      timestamp: new Date(clock).toISOString(),
    })
  }

  /** A background agent or shell task ended: a user entry, or (`queued`) an attachment while Claude was busy. */
  notification(n: Notification, opts: { queued?: boolean } = {}): this {
    const text = [
      '<task-notification>',
      `<task-id>${n.taskId}</task-id>`,
      ...(n.toolUseId ? [`<tool-use-id>${n.toolUseId}</tool-use-id>`] : []),
      `<output-file>/tmp/tasks/${n.taskId}.output</output-file>`,
      ...(n.status ? [`<status>${n.status}</status>`] : []),
      ...(n.summary !== undefined ? [`<summary>${n.summary}</summary>`] : []),
      '</task-notification>',
    ].join('\n')
    if (opts.queued) return this.attachment({ type: 'queued_command', prompt: text, commandMode: 'task-notification' })
    return this.line('user', { message: { role: 'user', content: text }, origin: { kind: 'task-notification' } })
  }

  /** A synthetic reply (model `<synthetic>`), e.g. a rate limit. */
  apiError(text: string, error = 'rate_limit'): this {
    return this.line('assistant', {
      message: {
        id: randomUUID(),
        model: '<synthetic>',
        role: 'assistant',
        type: 'message',
        stop_reason: 'stop_sequence',
        stop_sequence: '',
        content: [{ type: 'text', text }],
        usage: { input_tokens: 0, output_tokens: 0, cache_creation_input_tokens: 0, cache_read_input_tokens: 0 },
      },
      error,
      isApiErrorMessage: true,
    })
  }

  // Lines without the common fields.
  aiTitle(title: string): this {
    return this.raw({ type: 'ai-title', aiTitle: title, sessionId: this.sessionId })
  }

  customTitle(title: string): this {
    return this.raw({ type: 'custom-title', customTitle: title, sessionId: this.sessionId })
  }

  permissionMode(mode: string): this {
    return this.raw({ type: 'permission-mode', permissionMode: mode, sessionId: this.sessionId })
  }

  prLink(prNumber: number): this {
    return this.raw({
      type: 'pr-link', sessionId: this.sessionId, prNumber, prUrl: `https://github.com/acme/app/pull/${prNumber}`,
      prRepository: 'acme/app', timestamp: new Date(clock).toISOString(),
    })
  }

  /** Written as Claude exits. */
  costState(): this {
    return this.raw({
      type: 'cost-state', sessionId: this.sessionId, totalCostUSD: 1.5, totalAPIDuration: 1000,
      totalAPIDurationWithoutRetries: 1000, totalToolDuration: 10, totalLinesAdded: 1, totalLinesRemoved: 0,
      totalDuration: 5000, startTime: clock - 5000, modelUsage: {}, hasUnknownModelCost: false,
    })
  }

  /** A sub-agent of this session: writes `agent-<id>.meta.json` and returns a writer for `agent-<id>.jsonl`. */
  subagent(agentId: string, toolUseId: string, meta: { agentType?: string; description?: string; withMeta?: boolean } = {}): LogWriter {
    const base = join(dirname(this.path), this.sessionId, 'subagents')
    mkdirSync(base, { recursive: true })
    if (meta.withMeta !== false) {
      writeFileSync(join(base, `agent-${agentId}.meta.json`), JSON.stringify({
        agentType: meta.agentType ?? 'general-purpose', description: meta.description ?? 'a task', toolUseId,
        spawnDepth: 1, requestShape: 'agent', requestNonInteractive: true,
      }))
    }
    return new LogWriter(join(base, `agent-${agentId}.jsonl`), this.sessionId, this.cwd, agentId)
  }
}

/** A session log of `folder` (as Claude spells its cwd) in `home`: `projects/<encoded>/<id>.jsonl`. */
export function sessionLog(home: string, folder: string, id: string = randomUUID()): LogWriter {
  return new LogWriter(join(home, 'projects', encodeFolder(folder), `${id}.jsonl`), id, folder)
}
