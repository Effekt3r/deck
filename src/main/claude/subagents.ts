import { open, readdir, readFile, stat } from 'node:fs/promises'
import { basename, dirname, join } from 'node:path'
import { asText, describeTool, firstLine, isRecord, toolLabel } from './describe'
import type { SessionState } from './session'

/** How much of the end of a sub-agent's log is read for its step. */
const TAIL_BYTES = 20_000
// An agent id from the log becomes part of a file name only when it is a plain id.
const SAFE_ID = /^[A-Za-z0-9_-]{1,128}$/
const CACHED = 200

/** Remembers what was read: meta.json files don't change, a log is read again only when it grew. */
export class StepCache {
  /** Sub-agent logs read (tests count them). */
  reads = 0
  readonly steps = new Map<string, { size: number; modified: number; step: string }>()
  /** meta.json path → the toolUseId it names. */
  readonly metas = new Map<string, string>()
}

const bound = <K, V>(map: Map<K, V>) => {
  if (map.size > CACHED) map.delete(map.keys().next().value as K)
}

/** `<session>/subagents` next to `<session>.jsonl`. */
export function subagentsDir(sessionPath: string): string {
  return join(dirname(sessionPath), basename(sessionPath, '.jsonl'), 'subagents')
}

/** The latest tool call or reply in a log's text, newest line first (prototype: last_step). */
function stepIn(text: string, project: string): string {
  const lines = text.split('\n')
  for (let i = lines.length - 1; i >= 0; i--) {
    let e: unknown
    try {
      e = JSON.parse(lines[i])
    } catch {
      continue // the first line, cut in half by the 20 KB window, or a broken one
    }
    const message = isRecord(e) && isRecord(e.message) ? e.message : {}
    const content = Array.isArray(message.content) ? message.content : []
    for (let j = content.length - 1; j >= 0; j--) {
      const b = content[j]
      if (!isRecord(b)) continue
      if (b.type === 'tool_use') {
        const name = asText(b.name)
        const summary = describeTool(name, b.input, project)
        return summary ? `${toolLabel(name)}: ${summary}` : toolLabel(name)
      }
      if (b.type === 'text' && typeof b.text === 'string' && b.text.trim()) return firstLine(b.text)
    }
  }
  return ''
}

/** The latest tool call or reply in a sub-agent's log; '' when there is none (yet). */
export async function lastStep(path: string, project: string, cache?: StepCache): Promise<string> {
  let size: number
  let modified: number
  try {
    const st = await stat(path)
    size = st.size
    modified = st.mtimeMs
  } catch {
    return ''
  }
  const hit = cache?.steps.get(path)
  if (hit && hit.size === size && hit.modified === modified) return hit.step
  let text: string
  try {
    const fh = await open(path, 'r')
    try {
      const start = Math.max(0, size - TAIL_BYTES)
      const buf = Buffer.alloc(size - start)
      const { bytesRead } = await fh.read(buf, 0, buf.length, start)
      text = buf.subarray(0, bytesRead).toString('utf8')
    } finally {
      await fh.close()
    }
  } catch {
    return ''
  }
  const step = stepIn(text, project)
  if (cache) {
    cache.reads++
    cache.steps.set(path, { size, modified, step })
    bound(cache.steps)
  }
  return step
}

/**
 * What each running sub-agent is doing now, by Agent tool_use id (prototype: subagent_steps). Its
 * log is <session>/subagents/agent-<agentId>.jsonl; agent-<agentId>.meta.json names the tool call
 * that started it (toolUseId). Agents without a step yet are left out.
 */
export async function agentSteps(sessionPath: string, s: SessionState, project: string, cache?: StepCache): Promise<Map<string, string>> {
  const out = new Map<string, string>()
  const running = [...s.agents].filter(([, a]) => !a.done)
  if (!running.length) return out
  const base = subagentsDir(sessionPath)
  const names = await readdir(base).catch(() => [] as string[])
  const logs = new Map<string, string>()
  await Promise.all(names.filter((n) => n.startsWith('agent-') && n.endsWith('.meta.json')).map(async (name) => {
    const meta = join(base, name)
    let toolUseId = cache?.metas.get(meta)
    if (toolUseId === undefined) {
      try {
        const parsed: unknown = JSON.parse(await readFile(meta, 'utf8'))
        if (isRecord(parsed) && typeof parsed.toolUseId === 'string') toolUseId = parsed.toolUseId
      } catch {
        // Being written, or not JSON: tried again next time.
      }
      if (toolUseId !== undefined && cache) {
        cache.metas.set(meta, toolUseId)
        bound(cache.metas)
      }
    }
    if (toolUseId) logs.set(toolUseId, `${meta.slice(0, -'.meta.json'.length)}.jsonl`)
  }))
  for (const [toolUseId, a] of running) {
    const log = logs.get(toolUseId) ?? (a.id && SAFE_ID.test(a.id) ? join(base, `agent-${a.id}.jsonl`) : null)
    if (!log) continue
    const step = await lastStep(log, project, cache)
    if (step) out.set(toolUseId, step)
  }
  return out
}
