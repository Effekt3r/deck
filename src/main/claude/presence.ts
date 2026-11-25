import { execFile } from 'node:child_process'
import { lstat, readdir, readFile } from 'node:fs/promises'
import type { Stats } from 'node:fs'
import { join } from 'node:path'
import type { ClaudeActivity, ClaudePresence } from '@shared/types'
import { watchDirs } from './watch'

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
  // A terminal's Claude is interactive. Background and print sessions run elsewhere (under Claude Code's
  // daemon, or inside a tab's own Claude) and would only make a folder ambiguous. No kind: an older file.
  if (d.kind !== undefined && d.kind !== 'interactive') return null
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
 * pid → the pty's id) is Claude's process itself (a tab whose command was `exec claude`) or one of
 * its ancestors. Entries whose process isn't in `table` (gone), or started at another time than
 * their file says (a pid reused after a Claude was killed), are dropped. A pty gets only the Claude
 * nearest its shell (a `claude -p` that Claude's own Bash tool runs descends from the same shell),
 * and none when two are as near (one suspended with Ctrl+Z, and a new one started).
 */
export function matchProcesses(entries: readonly PresenceEntry[], shells: ReadonlyMap<number, string>, table: ReadonlyMap<number, ProcessRow>): ClaudePresence[] {
  const out: ClaudePresence[] = []
  // Per pty: the Claude nearest its shell; null while two are as near.
  const nearest = new Map<string, { depth: number; presence: ClaudePresence | null }>()
  for (const entry of entries) {
    const row = table.get(entry.pid)
    if (!row || (entry.procStart !== undefined && entry.procStart !== row.started)) continue
    const presence = publicPresence(entry)
    let pid = entry.pid
    for (let depth = 0; depth <= MAX_DEPTH && pid > 1; depth++) {
      const ptyId = shells.get(pid)
      if (ptyId !== undefined) {
        const best = nearest.get(ptyId)
        if (!best || depth < best.depth) {
          if (best?.presence) delete best.presence.ptyId
          presence.ptyId = ptyId
          nearest.set(ptyId, { depth, presence })
        } else if (depth === best.depth) {
          if (best.presence) delete best.presence.ptyId
          nearest.set(ptyId, { depth, presence: null })
        }
        break
      }
      pid = table.get(pid)?.ppid ?? 0
    }
    out.push(presence)
  }
  return out
}

/** A presence file as last read: re-read only when its size or time changes. */
interface Seen {
  size: number
  mtimeMs: number
  entry: PresenceEntry
}

/** A presence file caught mid-write: empty, or not JSON yet. A whole file that fails the checks
 *  (no status yet, or one Deck doesn't know) isn't one. */
function halfWritten(text: string): boolean {
  if (text.trim() === '') return true
  try {
    JSON.parse(text)
    return false
  } catch {
    return true
  }
}

/** The presence files in `dir` (`<claude home>/sessions`), re-reading only those whose size or
 *  time changed since `cache`. A missing folder has none; any other failure to list it throws, so
 *  that look publishes nothing rather than a list with every Claude gone. */
async function readPresence(dir: string, cache: Map<string, Seen>): Promise<PresenceEntry[]> {
  let all: string[]
  try {
    all = await readdir(dir)
  } catch (err) {
    if ((err as NodeJS.ErrnoException).code === 'ENOENT') return []
    throw err
  }
  const names = all.filter((n) => PRESENCE_FILE.test(n)).sort()
  const present = new Set(names)
  for (const name of cache.keys()) if (!present.has(name)) cache.delete(name)
  const entries: PresenceEntry[] = []
  for (const name of names) {
    const path = join(dir, name)
    let seen = cache.get(name)
    let st: Stats
    try {
      // Not followed: a link named like a presence file could lead to a .key file. Only a regular
      // file (isFile below) is believed.
      st = await lstat(path)
    } catch (err) {
      if ((err as NodeJS.ErrnoException).code === 'ENOENT') {
        cache.delete(name) // removed meanwhile
        continue
      }
      // Unreadable for now, not gone: it keeps its last state, if it had one, and doesn't hold up
      // the other Claudes.
      if (seen && `${seen.entry.pid}.json` === name) entries.push(seen.entry)
      continue
    }
    if (!st.isFile() || st.size > MAX_PRESENCE_BYTES) {
      cache.delete(name)
      continue
    }
    if (!seen || seen.size !== st.size || seen.mtimeMs !== st.mtimeMs) {
      const text = await readFile(path, 'utf8').catch(() => '')
      const entry = parsePresence(text)
      if (entry) {
        seen = { size: st.size, mtimeMs: st.mtimeMs, entry }
        cache.set(name, seen)
      } else if (seen && halfWritten(text)) {
        // Claude Code rewrites its file in place, so a look can catch it half-written: keep the last
        // whole read, and read it again next look.
        seen.mtimeMs = Number.NaN
      } else {
        // Never read whole yet, or whole but failing the checks: no status for it.
        cache.delete(name)
        continue
      }
    }
    // A file is named after its pid: one that says otherwise isn't believed.
    if (`${seen.entry.pid}.json` === name) entries.push(seen.entry)
  }
  return entries
}

/** Whether a process exists, without signalling it (EPERM: it exists, but isn't ours to signal). */
export function alive(pid: number): boolean {
  try {
    process.kill(pid, 0)
    return true
  } catch (err) {
    return (err as NodeJS.ErrnoException).code === 'EPERM'
  }
}

/** An absolute path, as Deck finds adb: never a `ps` that PATH or the current folder supplies. */
const PS = '/bin/ps'

/** The process table (macOS, Linux), with start times in UTC as Claude Code writes them. */
export function psTable(): Promise<Map<number, ProcessRow>> {
  return new Promise((resolve, reject) => {
    execFile(PS, ['-A', '-o', 'pid=,ppid=,lstart='], { env: { ...process.env, TZ: 'UTC', LC_ALL: 'C' }, timeout: 5000, maxBuffer: 8 * 1024 * 1024 },
      (err, stdout) => (err ? reject(err) : resolve(parseProcessTable(stdout))))
  })
}

export interface PresenceWatchDeps {
  /** `<claude home>/sessions`. */
  dir: string
  /** Each tab's shell pid → its pty id (PtyManager.shells), read at every look. */
  shells(): ReadonlyMap<number, string>
  /** The process table (`psTable`), or null where there's none (Windows: tabs then match by folder). */
  processes: (() => Promise<Map<number, ProcessRow>>) | null
  alive(pid: number): boolean
  /** The list changed. */
  publish(list: ClaudePresence[]): void
  /** Tests pass their own. */
  watch?: (dirs: string[], onChange: () => void) => (() => void) | null
  pollMs?: number
}

/**
 * Follows the running Claude Codes: watches their presence folder and looks every 2 s too (a
 * watch can miss events, or fail). The process table is read again only when a Claude appears that
 * it hasn't looked up; a Claude whose process has gone drops out at the next look.
 */
export class PresenceWatch {
  private readonly cache = new Map<string, Seen>()
  private table = new Map<number, ProcessRow>()
  /** Each looked-up Claude's pid → its start time then. */
  private known = new Map<number, string | undefined>()
  /** The shell pids when `table` was read. */
  private shellsAtPs = new Set<number>()
  private psFailing = false
  private lookFailing = false
  private list: ClaudePresence[] = []
  private last = '[]'
  private timer: ReturnType<typeof setInterval> | null = null
  private unwatch: (() => void) | null = null
  private running: Promise<void> | null = null
  private again = false
  private stopped = false

  constructor(private readonly deps: PresenceWatchDeps) {}

  /** Starts watching (once; nothing after stop()). */
  start(): void {
    if (this.timer || this.stopped) return
    this.timer = setInterval(() => void this.refresh(), this.deps.pollMs ?? 2000)
    void this.refresh()
  }

  stop(): void {
    this.stopped = true
    if (this.timer) clearInterval(this.timer)
    this.timer = null
    this.unwatch?.()
    this.unwatch = null
  }

  current(): ClaudePresence[] {
    return this.list
  }

  /** Looks again. A call while a look runs makes it look once more after; never rejects. */
  refresh(): Promise<void> {
    if (this.running) {
      this.again = true
      return this.running
    }
    this.running = (async () => {
      do {
        this.again = false
        try {
          await this.look()
          this.lookFailing = false
        } catch (err) {
          // Once per run of failures, as for ps: the poll would otherwise repeat it every 2 s.
          if (!this.lookFailing) console.warn("presence: reading Claude Code's sessions failed; trying again at each look", err)
          this.lookFailing = true
        }
      } while (this.again && !this.stopped)
    })().finally(() => {
      this.running = null
    })
    return this.running
  }

  private async look(): Promise<void> {
    // Watched from the first look that finds the folder: one missing at start gets its watch once
    // Claude Code makes it (the poll covers the time between).
    if (this.timer && !this.unwatch) this.unwatch = (this.deps.watch ?? watchDirs)([this.deps.dir], () => void this.refresh())
    const entries = (await readPresence(this.deps.dir, this.cache)).filter((e) => this.deps.alive(e.pid))
    let list: ClaudePresence[]
    if (this.deps.processes) {
      const shells = this.deps.shells()
      const fresh = entries.some((e) => !this.known.has(e.pid) || this.known.get(e.pid) !== e.procStart)
      // A tab's shell whose pid the table gives another process: the table is older than the shell.
      const reused = [...shells.keys()].some((pid) => !this.shellsAtPs.has(pid) && this.table.has(pid))
      if (fresh || reused) {
        try {
          this.table = await this.deps.processes()
          this.known = new Map(entries.map((e) => [e.pid, e.procStart]))
          this.shellsAtPs = new Set(shells.keys())
          this.psFailing = false
        } catch (err) {
          // Matched with the last table meanwhile (a Claude it lacks stays out); tried again next look.
          if (!this.psFailing) console.warn('presence: ps failed; trying again at each look', err)
          this.psFailing = true
        }
      }
      list = matchProcesses(entries, shells, this.table)
    } else {
      list = entries.map(publicPresence)
    }
    if (this.stopped) return
    const key = JSON.stringify(list)
    if (key === this.last) return
    this.last = key
    this.list = list
    this.deps.publish(list)
  }
}
