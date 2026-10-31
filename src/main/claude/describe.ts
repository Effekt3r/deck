import { realpathSync } from 'node:fs'
import { homedir } from 'node:os'

export const AGENT_TOOLS = new Set(['Task', 'Agent'])
/** Pending, these mean Claude is waiting on you. */
export const ASK_TOOLS = new Set(['AskUserQuestion', 'ExitPlanMode'])
const FILE_TOOLS = new Set(['Read', 'Write', 'Edit', 'MultiEdit', 'NotebookEdit'])
// The fields tried, in order, for tools without a rule of their own.
const SUMMARY_KEYS = ['description', 'subject', 'summary', 'skill', 'prompt', 'query', 'path', 'file_path',
  'url', 'command', 'reason', 'task_id', 'plan']
// Python's str.splitlines() boundaries.
const LINE_BREAK = /\r\n|[\n\r\v\f\x1c-\x1e\x85\u2028\u2029]/

export const isRecord = (x: unknown): x is Record<string, unknown> => typeof x === 'object' && x !== null && !Array.isArray(x)

/** Python's truthiness, which the prototype's `if inp.get(k)` relies on: empty lists and objects are false. */
function truthy(x: unknown): boolean {
  if (Array.isArray(x)) return x.length > 0
  if (isRecord(x)) return Object.keys(x).length > 0
  return Boolean(x)
}

/** A log value as text: strings as they are, numbers and booleans printed, anything else ''. */
export function asText(x: unknown): string {
  if (typeof x === 'string') return x
  if (typeof x === 'number' || typeof x === 'boolean') return String(x)
  if (typeof x === 'object' && x !== null) {
    try {
      return JSON.stringify(x)
    } catch {
      return ''
    }
  }
  return ''
}

/** The first `n` characters (UTF-16 units), without splitting an emoji's surrogate pair. */
export function head(s: string, n: number): string {
  if (s.length <= n) return s
  const code = s.charCodeAt(n - 1)
  return s.slice(0, code >= 0xd800 && code <= 0xdbff ? n - 1 : n)
}

/** At most `n` characters, cut ones ending with '…'. */
export function cut(s: string, n: number): string {
  return s.length <= n ? s : `${head(s, n - 1)}…`
}

/** The first line of the trimmed text, at most n characters (prototype: first_line). */
export function firstLine(s: unknown, n = 200): string {
  const line = asText(s).trim().split(LINE_BREAK, 1)[0] ?? ''
  return head(line, n)
}

/** The text of the first <name>…</name>, trimmed; '' when there is none. */
export function tag(text: string, name: string): string {
  const open = `<${name}>`
  const start = text.indexOf(open)
  if (start < 0) return ''
  const end = text.indexOf(`</${name}>`, start + open.length)
  return end < 0 ? '' : text.slice(start + open.length, end).trim()
}

/** MCP tools (`mcp__server__tool`) as `server:tool`. */
export function toolLabel(name: string): string {
  return name.startsWith('mcp__') ? name.slice(5).replace('__', ':') : name
}

// The project's real path, looked up once per project (paths in the log are under Claude's cwd,
// which is the real path when the folder was reached through a symlink).
const realPaths = new Map<string, string>()
function realPathOf(project: string): string {
  let real = realPaths.get(project)
  if (real === undefined) {
    try {
      real = realpathSync.native(project)
    } catch {
      real = project
    }
    if (realPaths.size > 100) realPaths.clear()
    realPaths.set(project, real)
  }
  return real
}

/** A path relative to the project when inside it (any case, either separator), else with ~ for home. */
export function shortPath(p: unknown, project: string): string {
  if (typeof p !== 'string') return asText(p)
  const low = p.toLowerCase()
  for (const base of new Set([realPathOf(project), project])) {
    const b = base.replace(/[/\\]+$/, '')
    const lb = b.toLowerCase()
    if (low.startsWith(`${lb}/`) || low.startsWith(`${lb}\\`)) return p.slice(b.length + 1)
  }
  const home = homedir()
  if (home && (p === home || p.startsWith(`${home}/`) || p.startsWith(`${home}\\`))) return `~${p.slice(home.length)}`
  return p
}

/** One-line summary of a tool call (prototype: describe_tool). */
export function describeTool(name: string, input: unknown, project: string): string {
  const inp = isRecord(input) ? input : {}
  const path = (k: string) => shortPath(inp[k] ?? '', project)
  if (name === 'Bash') return asText(inp.description) || firstLine(inp.command)
  if (FILE_TOOLS.has(name)) return path('file_path') || path('notebook_path')
  if (name === 'Grep' || name === 'Glob') return asText(inp.pattern) + (truthy(inp.path) ? `  in ${path('path')}` : '')
  if (AGENT_TOOLS.has(name)) return `${asText(inp.subagent_type) || 'agent'}: ${asText(inp.description)}`
  if (name === 'WebFetch') return asText(inp.url)
  if (name === 'WebSearch') return asText(inp.query)
  if (name === 'TodoWrite') return `${Array.isArray(inp.todos) ? inp.todos.length : 0} items`
  if (name === 'AskUserQuestion') {
    const questions = Array.isArray(inp.questions) ? inp.questions.filter(isRecord).map((q) => q.question) : []
    return questions.length ? firstLine(questions[0]) : ''
  }
  for (const k of SUMMARY_KEYS) if (truthy(inp[k])) return firstLine(inp[k])
  return ''
}
