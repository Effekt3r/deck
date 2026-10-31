import type { ClaudeAgent, ClaudeStatus, ClaudeTodo } from '@shared/types'
import { toolLabel } from './feedItems'

export type Tone = 'violet' | 'amber' | 'teal' | 'dim' | 'red'

export interface StatusView {
  glyph: string
  label: string
  tone: Tone
  /** Tooltip. */
  title: string
  /** The glyph turns (working). */
  spin?: boolean
}

/** Text presentation: Windows draws ⏺ ⏹ ⚠ as colour emoji without it. */
const TEXT = '︎'

/** The status chip, as the prototype shows it. `modified` is the log's last write
 *  (the quiet minutes count from it), `now` the clock. */
export function statusView(status: ClaudeStatus, modified: number, now: number): StatusView {
  const detail = status.detail ?? ''
  switch (status.state) {
    case 'working':
      return { glyph: '✻', label: 'working', tone: 'violet', title: 'Claude is working', spin: true }
    case 'tool': {
      const name = toolLabel(detail)
      return { glyph: `⏺${TEXT}`, label: name || 'running a tool', tone: 'amber', title: name ? `Running ${name}` : 'Running a tool' }
    }
    case 'waiting':
      return { glyph: '◐', label: 'waiting on you', tone: 'amber', title: detail ? `${toolLabel(detail)} is waiting for your answer` : 'Waiting for your answer' }
    case 'maybe-waiting':
      return {
        glyph: '◐',
        label: 'waiting on you?',
        tone: 'amber',
        title: `${detail ? toolLabel(detail) : 'A tool'} has been pending for a while: maybe a permission prompt (they aren't logged)`,
      }
    case 'idle':
      return { glyph: '✓', label: 'idle', tone: 'teal', title: 'The turn ended' }
    case 'quiet': {
      const minutes = Math.max(0, Math.floor((now - modified) / 60_000))
      return {
        glyph: '?',
        label: `quiet for ${minutes}m`,
        tone: 'dim',
        title: `A turn is open, but the log hasn't changed since ${new Date(modified).toLocaleTimeString()}: stopped or stuck?`,
      }
    }
    case 'exited':
      return { glyph: `⏹${TEXT}`, label: 'exited', tone: 'dim', title: 'Claude quit' }
    case 'error':
      return { glyph: `⚠${TEXT}`, label: detail || 'API error', tone: 'red', title: detail || 'API error' }
    default:
      return { glyph: '·', label: String(status.state), tone: 'dim', title: String(status.state) }
  }
}

/** "2 agents running", "1 background", shown after the chip. */
export function statusExtras(status: ClaudeStatus): string[] {
  const out: string[] = []
  if (status.agents > 0) out.push(`${status.agents} ${status.agents === 1 ? 'agent' : 'agents'} running`)
  if (status.background > 0) out.push(`${status.background} background`)
  return out
}

/** 84k, 1.2M. */
export function formatTokens(n: number): string {
  if (n < 1000) return String(n)
  const k = Math.round(n / 1000)
  return k < 1000 ? `${k}k` : `${(n / 1_000_000).toFixed(1)}M`
}

/** claude-opus-5-5 → opus-5-5; a dated snapshot loses its date. */
export function modelLabel(model: string): string {
  return model.replace(/^claude-/, '').replace(/-\d{8}$/, '')
}

const MODES: Record<string, string> = {
  bypassPermissions: 'bypass',
  acceptEdits: 'accept edits',
  plan: 'plan mode',
  auto: 'auto mode',
}

export function modeLabel(mode: string): string {
  return Object.hasOwn(MODES, mode) ? MODES[mode] : ''
}

export interface TodoView {
  done: number
  total: number
  /** Unfinished first (list order), then the last few completed. */
  shown: ClaudeTodo[]
  /** Items left out. */
  hidden: number
}

export function todoView(todos: ClaudeTodo[], maxOpen = 6, maxDone = 3): TodoView {
  const live = todos.filter((t) => t.status !== 'deleted')
  const open = live.filter((t) => t.status !== 'completed')
  const done = live.filter((t) => t.status === 'completed')
  const shown = [...open.slice(0, maxOpen), ...done.slice(-maxDone)]
  return { done: done.length, total: live.length, shown, hidden: live.length - shown.length }
}

export interface AgentsView {
  running: ClaudeAgent[]
  /** The last few finished. */
  finished: ClaudeAgent[]
  runningCount: number
  doneCount: number
  /** Running ones left out. */
  hidden: number
}

export function agentsView(agents: ClaudeAgent[], maxRunning = 5, maxFinished = 3): AgentsView {
  const running = agents.filter((a) => !a.done)
  const finished = agents.filter((a) => a.done)
  return {
    running: running.slice(0, maxRunning),
    finished: finished.slice(-maxFinished),
    runningCount: running.length,
    doneCount: finished.length,
    hidden: Math.max(0, running.length - maxRunning),
  }
}
