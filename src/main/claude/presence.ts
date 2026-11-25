import type { ClaudeActivity, ClaudePresence } from '@shared/types'

/** One running Claude Code, as its presence file (`<claude home>/sessions/<pid>.json`) says. */
export interface PresenceEntry {
  pid: number
  sessionId: string
  cwd: string
  state: ClaudeActivity
  waitingFor?: string
  /** Its process's start time as `ps -o lstart` prints it in UTC, runs of spaces collapsed: Claude
   *  Code writes it so a pid that was reused can be told apart. */
  procStart?: string
}

/** Presence files are named after their pid. The `<pid>.<hash>.key` files beside them hold the keys
 *  for Claude's peer messaging: never read. */
export const PRESENCE_FILE = /^[1-9][0-9]{0,9}\.json$/
/** A presence file is a few hundred bytes; anything far larger isn't one. */
export const MAX_PRESENCE_BYTES = 64 * 1024
const MAX_TEXT = 4096
/** What a waiting Claude waits on is shown in a tooltip. */
const MAX_WAITING_FOR = 200

/** Claude Code's `status` in Deck's words. `shell` is idle with a background shell still running (a
 *  dev server), which would otherwise look busy for hours. Unknown: null (the file is skipped). */
export function activityOf(status: unknown): ClaudeActivity | null {
  switch (status) {
    case 'busy':
      return 'working'
    case 'waiting':
      return 'waiting'
    case 'idle':
    case 'shell':
      return 'idle'
    default:
      return null
  }
}

const text = (x: unknown): string | undefined => (typeof x === 'string' && x !== '' && x.length <= MAX_TEXT ? x : undefined)

/** A presence file's text, checked; null for anything else (a file caught mid-write included). */
export function parsePresence(json: string): PresenceEntry | null {
  let data: unknown
  try {
    data = JSON.parse(json)
  } catch {
    return null
  }
  if (typeof data !== 'object' || data === null || Array.isArray(data)) return null
  const d = data as Record<string, unknown>
  const { pid } = d
  const sessionId = text(d.sessionId)
  const cwd = text(d.cwd)
  const state = activityOf(d.status)
  if (typeof pid !== 'number' || !Number.isSafeInteger(pid) || pid <= 0 || !sessionId || !cwd || !state) return null
  const entry: PresenceEntry = { pid, sessionId, cwd, state }
  const waitingFor = text(d.waitingFor)
  if (state === 'waiting' && waitingFor) entry.waitingFor = waitingFor.slice(0, MAX_WAITING_FOR)
  const procStart = text(d.procStart)?.trim().replace(/\s+/g, ' ')
  if (procStart) entry.procStart = procStart
  return entry
}

/** What the renderer gets: no start time. */
export function publicPresence(e: PresenceEntry): ClaudePresence {
  const p: ClaudePresence = { pid: e.pid, sessionId: e.sessionId, cwd: e.cwd, state: e.state }
  if (e.waitingFor) p.waitingFor = e.waitingFor
  return p
}

/** A process as `ps -A -o pid=,ppid=,lstart=` lists it. */
export interface ProcessRow {
  ppid: number
  /** When it started, as `ps` printed it (UTC when run with TZ=UTC), runs of spaces collapsed. */
  started: string
}

/** `ps -A -o pid=,ppid=,lstart=`'s output: pid → its row. Lines it can't read are skipped. */
export function parseProcessTable(out: string): Map<number, ProcessRow> {
  const table = new Map<number, ProcessRow>()
  for (const line of out.split('\n')) {
    const m = /^\s*(\d+)\s+(\d+)\s+(\S.*?)\s*$/.exec(line)
    if (m) table.set(Number(m[1]), { ppid: Number(m[2]), started: m[3].replace(/\s+/g, ' ') })
  }
  return table
}

/** How far up from Claude's process to look for a tab's shell (a wrapper script or two between). */
const MAX_DEPTH = 8

/**
 * Which tab's pty each Claude belongs to, by process (macOS, Linux): a tab's shell (`shells`: its
 * pid → the pty's id) is an ancestor of Claude's process. Entries whose process isn't in `table`
 * (gone), or started at another time than their file says (a pid reused after a Claude was
 * killed), are dropped. A pty keeps only the Claude nearest its shell: a `claude -p` that Claude's
 * own Bash tool runs descends from the same shell.
 */
export function matchProcesses(entries: readonly PresenceEntry[], shells: ReadonlyMap<number, string>, table: ReadonlyMap<number, ProcessRow>): ClaudePresence[] {
  const out: ClaudePresence[] = []
  const nearest = new Map<string, { depth: number; presence: ClaudePresence }>()
  for (const entry of entries) {
    const row = table.get(entry.pid)
    if (!row || (entry.procStart !== undefined && entry.procStart !== row.started)) continue
    const presence = publicPresence(entry)
    let pid = row.ppid
    for (let depth = 1; depth <= MAX_DEPTH && pid > 1; depth++) {
      const ptyId = shells.get(pid)
      if (ptyId !== undefined) {
        const best = nearest.get(ptyId)
        if (!best || depth < best.depth) {
          if (best) delete best.presence.ptyId
          presence.ptyId = ptyId
          nearest.set(ptyId, { depth, presence })
        }
        break
      }
      pid = table.get(pid)?.ppid ?? 0
    }
    out.push(presence)
  }
  return out
}
