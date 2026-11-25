import { execFile } from 'node:child_process'
import { readdir, readFile, stat } from 'node:fs/promises'
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

/** A presence file as last read: re-read only when its size or time changes. */
interface Seen {
  size: number
  mtimeMs: number
  entry: PresenceEntry
}

/** The presence files in `dir` (`<claude home>/sessions`), re-reading only those whose size or
 *  time changed since `cache`. A missing folder has none. */
async function readPresence(dir: string, cache: Map<string, Seen>): Promise<PresenceEntry[]> {
  const names = (await readdir(dir).catch(() => [] as string[])).filter((n) => PRESENCE_FILE.test(n)).sort()
  const present = new Set(names)
  for (const name of cache.keys()) if (!present.has(name)) cache.delete(name)
  const entries: PresenceEntry[] = []
  for (const name of names) {
    const path = join(dir, name)
    const st = await stat(path).catch(() => null) // removed meanwhile: null
    if (!st || !st.isFile() || st.size > MAX_PRESENCE_BYTES) {
      cache.delete(name)
      continue
    }
    let seen = cache.get(name)
    if (!seen || seen.size !== st.size || seen.mtimeMs !== st.mtimeMs) {
      const entry = parsePresence(await readFile(path, 'utf8').catch(() => ''))
      // A file caught mid-write reads as broken: not kept, so the next look reads it again.
      if (!entry) {
        cache.delete(name)
        continue
      }
      seen = { size: st.size, mtimeMs: st.mtimeMs, entry }
      cache.set(name, seen)
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

/** The process table (macOS, Linux), with start times in UTC as Claude Code writes them. */
export function psTable(): Promise<Map<number, ProcessRow>> {
  const ps = process.platform === 'darwin' ? '/bin/ps' : 'ps'
  return new Promise((resolve, reject) => {
    execFile(ps, ['-A', '-o', 'pid=,ppid=,lstart='], { env: { ...process.env, TZ: 'UTC', LC_ALL: 'C' }, timeout: 5000, maxBuffer: 8 * 1024 * 1024 },
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
    this.unwatch = (this.deps.watch ?? watchDirs)([this.deps.dir], () => void this.refresh())
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
        await this.look().catch((err: unknown) => console.warn("presence: reading Claude Code's sessions failed", err))
      } while (this.again && !this.stopped)
    })().finally(() => {
      this.running = null
    })
    return this.running
  }

  private async look(): Promise<void> {
    const entries = (await readPresence(this.deps.dir, this.cache)).filter((e) => this.deps.alive(e.pid))
    let list: ClaudePresence[]
    if (this.deps.processes) {
      if (entries.some((e) => !this.known.has(e.pid) || this.known.get(e.pid) !== e.procStart)) {
        this.table = await this.deps.processes()
        this.known = new Map(entries.map((e) => [e.pid, e.procStart]))
      }
      list = matchProcesses(entries, this.deps.shells(), this.table)
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
