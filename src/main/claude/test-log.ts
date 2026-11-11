// Test helper: Claude Code session logs written by hand in the shapes CLAUDE.md documents
// ("Claude Code session logs"), into throwaway homes passed as CLAUDE_CONFIG_DIR. Real logs hold
// client code and prompts: never copy one here. Not used by the app.
import { randomUUID } from 'node:crypto'
import { appendFileSync, mkdirSync, mkdtempSync, readFileSync, realpathSync, rmSync, utimesSync, writeFileSync } from 'node:fs'
import { tmpdir } from 'node:os'
import { dirname, join } from 'node:path'
import { crc32, deflateSync } from 'node:zlib'
import { encodeFolder } from './locator'
import type { LinePlace } from './tail'

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

/** A log line that is JSON, and where it is in the file: bytes, without its newline. */
export interface LogLine extends LinePlace {
  entry: unknown
}

/** The log's whole lines (ended by a newline) that are JSON, with their places, as JsonlTail reads them. */
export function readLines(path: string): LogLine[] {
  const bytes = readFileSync(path)
  const lines: LogLine[] = []
  for (let start = 0, end = bytes.indexOf(0x0a); end >= 0; start = end + 1, end = bytes.indexOf(0x0a, start)) {
    const text = bytes.toString('utf8', start, end)
    if (!text.trim()) continue
    try {
      lines.push({ entry: JSON.parse(text), offset: start, length: end - start })
    } catch {
      // a deliberately broken line
    }
  }
  return lines
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
  /** Pasted images before the text: each image's bytes, or a count of blocks with empty data (which
   *  the panel doesn't show). */
  images?: number | Uint8Array[]
  /** The entry's imagePasteIds: Claude Code's [Image #N] numbers, one per image block. */
  pasteIds?: unknown
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
    const { origin = 'human', isMeta, images = 0, pasteIds } = opts
    const blocks = typeof images === 'number'
      ? Array.from({ length: images }, () => ({ type: 'image', source: { type: 'base64', media_type: 'image/png', data: '' } }))
      : images.map((bytes) => imageBlock(bytes))
    const content = blocks.length ? [...blocks, ...(text ? [{ type: 'text', text }] : [])] : text
    return this.line('user', {
      promptId: randomUUID(),
      message: { role: 'user', content },
      ...(pasteIds === undefined ? {} : { imagePasteIds: pasteIds }),
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

  /** Claude reading an image file: a Read call whose result holds the image, which the line's
   *  toolUseResult repeats (file.base64), as Claude Code writes it. */
  readImage(id: string, filePath: string, bytes: Uint8Array, mediaType = 'image/png'): this {
    const block = imageBlock(bytes, mediaType)
    return this.toolUse(id, 'Read', { file_path: filePath }).toolResult(id, {
      content: [block],
      toolUseResult: { type: 'image', file: { base64: block.source.data, type: mediaType, originalSize: bytes.length } },
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

  /** A prompt with content blocks (text, pasted images) typed while Claude was busy. */
  queuedBlocks(content: unknown[], opts: { pasteIds?: unknown; origin?: string | null } = {}): this {
    const { pasteIds, origin = 'human' } = opts
    return this.attachment({
      type: 'queued_command',
      prompt: content,
      commandMode: 'prompt',
      ...(pasteIds === undefined ? {} : { imagePasteIds: pasteIds }),
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

// Images, as Claude Code logs them: base64 in the line. The PNGs are whole (any decoder reads them);
// the JPEG, GIF and WebP builders write headers only, enough to tell the format and size.

/** An image content block holding `bytes`. The panel goes by the bytes, so `mediaType` may lie. */
export function imageBlock(bytes: Uint8Array, mediaType = 'image/png') {
  return { type: 'image', source: { type: 'base64', media_type: mediaType, data: Buffer.from(bytes).toString('base64') } }
}

const PNG_SIGNATURE = Buffer.from([0x89, 0x50, 0x4e, 0x47, 0x0d, 0x0a, 0x1a, 0x0a])

function pngChunk(type: string, data: Buffer): Buffer {
  const head = Buffer.alloc(8)
  head.writeUInt32BE(data.length, 0)
  head.write(type, 4, 'latin1')
  const crc = Buffer.alloc(4)
  crc.writeUInt32BE(crc32(Buffer.concat([head.subarray(4), data])) >>> 0, 0)
  return Buffer.concat([head, data, crc])
}

function ihdr(width: number, height: number, alpha: boolean): Buffer {
  const data = Buffer.alloc(13)
  data.writeUInt32BE(width, 0)
  data.writeUInt32BE(height, 4)
  data[8] = 8 // bits per channel
  data[9] = alpha ? 6 : 2 // RGBA or RGB
  return pngChunk('IHDR', data)
}

/** A whole PNG: a gradient, and with `alpha` its right half see-through. Different sizes make
 *  different images (different ids). */
export function pngBytes(width: number, height: number, opts: { alpha?: boolean } = {}): Buffer {
  const alpha = Boolean(opts.alpha)
  const channels = alpha ? 4 : 3
  const stride = 1 + width * channels // each row starts with its filter byte (0: none)
  const raw = Buffer.alloc(stride * height)
  for (let y = 0; y < height; y++) {
    for (let x = 0; x < width; x++) {
      const at = y * stride + 1 + x * channels
      raw[at] = Math.round((x * 255) / Math.max(1, width - 1))
      raw[at + 1] = Math.round((y * 255) / Math.max(1, height - 1))
      raw[at + 2] = 160
      if (alpha) raw[at + 3] = x < width / 2 ? 255 : 96
    }
  }
  return Buffer.concat([PNG_SIGNATURE, ihdr(width, height, alpha), pngChunk('IDAT', deflateSync(raw)), pngChunk('IEND', Buffer.alloc(0))])
}

/** A PNG's signature and header with no pixels: any size, for checks that never decode. */
export function pngHeaderBytes(width: number, height: number): Buffer {
  return Buffer.concat([PNG_SIGNATURE, ihdr(width, height, false), pngChunk('IEND', Buffer.alloc(0))])
}

/** A JPEG's markers without its picture: SOI, `app1Bytes` of APP1 (EXIF) segments before the size
 *  marker, SOF0 (baseline) or SOF2 (progressive), EOI. */
export function jpegBytes(width: number, height: number, opts: { progressive?: boolean; app1Bytes?: number } = {}): Buffer {
  const parts: Buffer[] = [Buffer.from([0xff, 0xd8])]
  for (let left = opts.app1Bytes ?? 0; left > 0; left -= 65_533) {
    const n = Math.min(left, 65_533) // a segment's length field counts itself: at most 65,535
    const segment = Buffer.alloc(4 + n)
    segment[0] = 0xff
    segment[1] = 0xe1
    segment.writeUInt16BE(n + 2, 2)
    parts.push(segment)
  }
  const sof = Buffer.alloc(19)
  sof[0] = 0xff
  sof[1] = opts.progressive ? 0xc2 : 0xc0
  sof.writeUInt16BE(17, 2)
  sof[4] = 8
  sof.writeUInt16BE(height, 5)
  sof.writeUInt16BE(width, 7)
  sof[9] = 3
  parts.push(sof, Buffer.from([0xff, 0xd9]))
  return Buffer.concat(parts)
}

/** A GIF's header and logical screen, then its trailer. */
export function gifBytes(width: number, height: number): Buffer {
  const head = Buffer.alloc(13)
  head.write('GIF89a', 0, 'latin1')
  head.writeUInt16LE(width, 6)
  head.writeUInt16LE(height, 8)
  return Buffer.concat([head, Buffer.from([0x3b])])
}

/** A WebP's RIFF header and first chunk, in each of its three forms: lossy (VP8), lossless (VP8L) and
 *  extended (VP8X). */
export function webpBytes(width: number, height: number, kind: 'VP8' | 'VP8L' | 'VP8X' = 'VP8'): Buffer {
  let body: Buffer
  if (kind === 'VP8') {
    body = Buffer.alloc(10) // frame tag, start code, 14-bit width and height
    body[3] = 0x9d
    body[4] = 0x01
    body[5] = 0x2a
    body.writeUInt16LE(width & 0x3fff, 6)
    body.writeUInt16LE(height & 0x3fff, 8)
  } else if (kind === 'VP8L') {
    body = Buffer.alloc(5) // signature, then width-1 and height-1 in 14 bits each
    body[0] = 0x2f
    body.writeUInt32LE((((width - 1) & 0x3fff) | (((height - 1) & 0x3fff) << 14)) >>> 0, 1)
  } else {
    body = Buffer.alloc(10) // flags, reserved, then canvas width-1 and height-1 in 24 bits each
    body.writeUIntLE(width - 1, 4, 3)
    body.writeUIntLE(height - 1, 7, 3)
  }
  const head = Buffer.alloc(20)
  head.write('RIFF', 0, 'latin1')
  head.writeUInt32LE(12 + body.length, 4)
  head.write('WEBP', 8, 'latin1')
  head.write(kind === 'VP8' ? 'VP8 ' : kind, 12, 'latin1')
  head.writeUInt32LE(body.length, 16)
  return Buffer.concat([head, body])
}

/** A session log of `folder` (as Claude spells its cwd) in `home`: `projects/<encoded>/<id>.jsonl`. */
export function sessionLog(home: string, folder: string, id: string = randomUUID()): LogWriter {
  return new LogWriter(join(home, 'projects', encodeFolder(folder), `${id}.jsonl`), id, folder)
}
