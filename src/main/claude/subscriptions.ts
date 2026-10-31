import { basename, resolve } from 'node:path'
import type { ClaudeSessionSummary, ClaudeSnapshot } from '@shared/types'
import { pathKey } from '../projects/config'
import { cut } from './describe'
import type { SessionFile } from './locator'
import { SessionState } from './session'
import { buildSnapshot, sessionTitle } from './snapshot'
import { claudeStatus } from './status'
import { StepCache, subagentsDir } from './subagents'

/** A subscriber, i.e. a renderer (webContents). */
export interface Client {
  id: number
  send(folder: string, snapshot: ClaudeSnapshot | null): void
}

/** Reads a log incrementally (JsonlTail). */
export interface LogReader {
  read(maxBytes?: number): Promise<{ entries: unknown[]; reset: boolean; more?: boolean }>
  /** The log's modification time (ms) at the last read; 0 before. */
  readonly modified: number
}

/** Everything that touches the file system; the app passes the real ones, tests fakes. */
export interface ClaudeDeps {
  /** The folder's session logs, newest first, and the project folders they are in. */
  scan(folder: string): Promise<{ sessions: SessionFile[]; dirs: string[] }>
  open(path: string): LogReader
  /** Running sub-agents' current steps. */
  steps(sessionPath: string, state: SessionState, project: string, cache: StepCache): Promise<Map<string, string>>
  /** A log's title without parsing all of it (for the picker). */
  title(path: string): Promise<string>
  /** Watches folders, not recursively; null when none could be watched. */
  watch(dirs: string[], onChange: (name: string | null) => void): (() => void) | null
  now(): number
}

export interface Timing {
  /** File events are coalesced for this long … */
  debounceMs: number
  /** … but never delayed longer than this while they keep coming. */
  maxWaitMs: number
  /** New sessions, new project folders, sub-agent steps, missed file events. */
  rescanMs: number
  /** Status from the cached state (maybe-waiting, quiet): no file is read. */
  tickMs: number
  /** A newer session takes over once the followed one has been quiet this long. */
  switchAfterQuietMs: number
  /** Read per step of a long log, so a 15 MB first read doesn't block the main process. */
  chunkBytes: number
  /** Parsed logs kept while no folder follows them. */
  keepParsed: number
  /** Sessions listed for the picker. */
  maxSessions: number
}

export const TIMING: Timing = {
  debounceMs: 150, maxWaitMs: 1000, rescanMs: 2000, tickMs: 1000, switchAfterQuietMs: 15_000,
  chunkBytes: 1 << 20, keepParsed: 4, maxSessions: 50,
}

/** A parsed log, shared by the folders that follow it and kept a while after. */
interface Parsed {
  key: string
  path: string
  project: string
  reader: LogReader
  state: SessionState
  stepCache: StepCache
  /** Folders following it now. */
  users: number
  /** Reads run one at a time. */
  reading: Promise<void>
  /** Read to the end at least once. */
  loaded: boolean
}

interface Want {
  /** List the folder's sessions again (and maybe switch). */
  scan: boolean
  /** Read the running sub-agents' steps again. */
  steps: boolean
  /** Switch to the newest session now, without waiting for the followed one to go quiet. */
  force: boolean
}

/** One client's subscriptions to one folder (`folder` exactly as it was passed). */
interface Sub {
  client: Client
  folder: string
  count: number
  watched: Watched | null
  gone: boolean
}

/** A watched folder. */
interface Watched {
  key: string
  folder: string
  subs: Set<Sub>
  /** subscribe() calls waiting on the first snapshot: they keep it open. */
  pending: number
  closed: boolean
  sessions: SessionFile[]
  current: SessionFile | null
  log: Parsed | null
  steps: Map<string, string>
  stepsKey: string
  /** Running agents the steps were read for. */
  stepsFor: string
  dirsKey: string
  stopDirs: (() => void) | null
  agentsDir: string
  stopAgents: (() => void) | null
  snapshot: ClaudeSnapshot | null
  /** The last snapshot's JSON (what clients have), and what it was built from. */
  json: string | null
  sig: string
  running: Promise<void> | null
  want: Want | null
  debounced: Want | null
  debounceTimer: NodeJS.Timeout | undefined
  debounceSince: number
  timers: NodeJS.Timeout[]
}

const folderKey = (folder: string) => pathKey(resolve(folder))
const logKey = (path: string) => pathKey(resolve(path))
const subKey = (clientId: number, folder: string) => `${clientId}\0${folder}`
const merge = (a: Want | null, b: Partial<Want>): Want => ({
  scan: Boolean(a?.scan || b.scan), steps: Boolean(a?.steps || b.steps), force: Boolean(a?.force || b.force),
})
const unref = (t: NodeJS.Timeout) => {
  t.unref?.()
  return t
}
const nextTurn = () => new Promise<void>((resolve) => setImmediate(resolve))

/**
 * Who follows which folder's Claude session: one watcher per folder however many clients
 * subscribe; snapshots are pushed only when they changed. Follows the newest session (switching
 * only once the followed one has been quiet, so two sessions in one folder don't flip-flop) or the
 * one pinned with follow().
 */
export class ClaudeSubscriptions {
  private readonly subs = new Map<string, Sub>()
  private readonly folders = new Map<string, Watched>()
  /** Parsed logs by path, least recently used first. */
  private readonly parsed = new Map<string, Parsed>()
  /** Pinned session per folder; kept across unsubscribe so a tab switch doesn't lose it. */
  private readonly pins = new Map<string, string>()
  private readonly timing: Timing

  constructor(private readonly deps: ClaudeDeps, timing: Partial<Timing> = {}) {
    this.timing = { ...TIMING, ...timing }
  }

  /** The folder's current snapshot (null: no session yet); pushes follow until unsubscribe(). */
  async subscribe(client: Client, folder: string): Promise<ClaudeSnapshot | null> {
    const key = subKey(client.id, folder)
    let sub = this.subs.get(key)
    if (!sub) {
      sub = { client, folder, count: 0, watched: null, gone: false }
      this.subs.set(key, sub)
    }
    sub.count++
    const watched = sub.watched ?? this.watch(folder)
    watched.pending++
    try {
      await this.run(watched, { scan: true })
    } finally {
      watched.pending--
    }
    // Attached only now, so the snapshot just built isn't also pushed to this client. An
    // unsubscribe that arrived meanwhile has already made `sub` gone.
    if (!sub.gone && !sub.watched) {
      sub.watched = watched
      watched.subs.add(sub)
    }
    const snapshot = watched.snapshot
    this.closeIfUnused(watched)
    return snapshot
  }

  unsubscribe(clientId: number, folder: string): void {
    const sub = this.subs.get(subKey(clientId, folder))
    if (sub) this.release(sub)
  }

  /** Everything `clientId` subscribed to (its webContents was destroyed or reloaded). */
  drop(clientId: number): void {
    for (const sub of [...this.subs.values()]) if (sub.client.id === clientId) this.remove(sub)
  }

  /** The folder's sessions, newest first, with titles (for the picker). */
  async sessions(folder: string): Promise<ClaudeSessionSummary[]> {
    const scanned = await this.deps.scan(folder).catch(() => null)
    if (!scanned) return []
    return Promise.all(scanned.sessions.slice(0, this.timing.maxSessions).map(async (s) => {
      const parsed = this.parsed.get(logKey(s.path))
      const title = parsed?.loaded ? sessionTitle(parsed.state) : await this.deps.title(s.path).catch(() => '')
      return { id: s.id, path: s.path, title: cut(title, 300), modified: s.modified }
    }))
  }

  /** Follow one session of a subscribed folder (an id from sessions()), or the newest again (null).
   *  Resolves once the new snapshot has been pushed. */
  async follow(folder: string, sessionId: string | null): Promise<void> {
    const watched = this.folders.get(folderKey(folder))
    if (!watched || watched.closed) return
    if (sessionId === null) {
      this.pins.delete(watched.key)
      await this.run(watched, { scan: true, force: true })
      return
    }
    const scanned = await this.deps.scan(watched.folder).catch(() => null)
    if (!scanned?.sessions.some((s) => s.id === sessionId) || watched.closed) return
    this.pins.delete(watched.key)
    this.pins.set(watched.key, sessionId)
    if (this.pins.size > 100) this.pins.delete(this.pins.keys().next().value as string)
    await this.run(watched, { scan: true })
  }

  private watch(folder: string): Watched {
    const key = folderKey(folder)
    const existing = this.folders.get(key)
    if (existing) return existing
    const w: Watched = {
      key, folder, subs: new Set(), pending: 0, closed: false, sessions: [], current: null, log: null,
      steps: new Map(), stepsKey: '[]', stepsFor: '', dirsKey: '', stopDirs: null, agentsDir: '', stopAgents: null,
      snapshot: null, json: null, sig: '', running: null, want: null, debounced: null, debounceTimer: undefined,
      debounceSince: 0, timers: [],
    }
    w.timers.push(
      unref(setInterval(() => void this.run(w, { scan: true }), this.timing.rescanMs)),
      unref(setInterval(() => this.tick(w), this.timing.tickMs)),
    )
    this.folders.set(key, w)
    return w
  }

  /** Runs `want` (merged with anything already asked for); one update at a time per folder. The
   *  promise resolves once it has run. */
  private run(w: Watched, want: Partial<Want>): Promise<void> {
    if (w.closed) return Promise.resolve()
    w.want = merge(w.want, want)
    w.running ??= (async () => {
      while (w.want && !w.closed) {
        const next = w.want
        w.want = null
        try {
          await this.update(w, next)
        } catch {
          // deps are guarded; the next change or rescan tries again
        }
      }
    })().finally(() => {
      w.running = null
    })
    return w.running
  }

  /** Coalesces file events: runs debounceMs after the last one, or maxWaitMs after the first. */
  private debounce(w: Watched, want: Partial<Want>): void {
    if (w.closed) return
    const now = Date.now()
    if (!w.debounced) w.debounceSince = now
    w.debounced = merge(w.debounced, want)
    clearTimeout(w.debounceTimer)
    const delay = Math.min(this.timing.debounceMs, Math.max(0, w.debounceSince + this.timing.maxWaitMs - now))
    w.debounceTimer = unref(setTimeout(() => {
      const next = w.debounced
      w.debounced = null
      if (next) void this.run(w, next)
    }, delay))
  }

  private onFileEvent(w: Watched, name: string | null): void {
    if (name !== null && !name.endsWith('.jsonl')) return // session folders, memory/
    // The followed log only needs reading; any other log may be a new session.
    const followed = w.current ? basename(w.current.path) : null
    this.debounce(w, { scan: name === null || name !== followed })
  }

  private tick(w: Watched): void {
    if (!w.running && !w.closed) this.publish(w)
  }

  private async update(w: Watched, want: Want): Promise<void> {
    if (want.scan || !w.current) {
      const scanned = await this.deps.scan(w.folder).catch(() => null)
      if (w.closed) return
      if (scanned) {
        w.sessions = scanned.sessions
        this.watchDirs(w, scanned.dirs)
        // A pinned session whose log is gone: back to following the newest.
        const pinned = this.pins.get(w.key)
        if (pinned && !scanned.sessions.some((s) => s.id === pinned)) this.pins.delete(w.key)
      }
      this.pick(w, want.force)
    }
    const log = w.log
    if (!log) return this.publish(w)
    await this.catchUp(log)
    if (w.closed || w.log !== log) return
    const running = [...log.state.agents].filter(([, a]) => !a.done).map(([id]) => id).join('\0')
    if (!running) {
      w.steps = new Map()
      w.stepsFor = ''
      this.unwatchAgents(w)
    } else {
      if (want.scan || want.steps || running !== w.stepsFor) {
        w.steps = await this.deps.steps(log.path, log.state, w.folder, log.stepCache).catch(() => w.steps)
        if (w.closed || w.log !== log) return
        w.stepsFor = running
      }
      this.watchAgents(w, subagentsDir(log.path))
    }
    w.stepsKey = JSON.stringify([...w.steps])
    this.publish(w)
  }

  /** Applies the follow rules to the latest scan. */
  private pick(w: Watched, force: boolean): void {
    const list = w.sessions
    const pinned = this.pins.get(w.key)
    const same = (s: SessionFile | null | undefined) => (s && w.current ? logKey(s.path) === logKey(w.current.path) : false)
    // The followed log as this scan saw it (its time is fresher than the last read's).
    const fresh = w.current ? list.find((s) => same(s)) : undefined
    let target: SessionFile | null
    if (pinned) {
      target = list.find((s) => s.id === pinned) ?? w.current // (not listed: the scan failed)
    } else if (!list.length) {
      target = null
    } else {
      const newest = list[0]
      const quiet = w.current ? this.deps.now() - Math.max(fresh?.modified ?? 0, this.modifiedOf(w)) : Infinity
      // Other tabs or worktrees may run Claude here too: stay on the session being followed until
      // it has been quiet for a while.
      if (!w.current || force || same(newest) || quiet > this.timing.switchAfterQuietMs) target = newest
      else target = fresh ?? w.current
    }
    if (target && same(target)) {
      w.current = target // fresher modification time
      return
    }
    const previous = w.log
    w.current = target
    w.log = target ? this.acquire(target.path, w.folder) : null
    this.releaseLog(previous) // after acquiring, so going back and forth never evicts the target
    w.steps = new Map()
    w.stepsFor = ''
    this.unwatchAgents(w)
  }

  private modifiedOf(w: Watched): number {
    return Math.max(w.current?.modified ?? 0, w.log?.reader.modified ?? 0)
  }

  private acquire(path: string, project: string): Parsed {
    const key = logKey(path)
    let p = this.parsed.get(key)
    if (p) {
      this.parsed.delete(key) // most recently used last
    } else {
      p = {
        key, path, project, reader: this.deps.open(path), state: new SessionState(project), stepCache: new StepCache(),
        users: 0, reading: Promise.resolve(), loaded: false,
      }
    }
    this.parsed.set(key, p)
    p.users++
    return p
  }

  private releaseLog(p: Parsed | null): void {
    if (!p) return
    p.users--
    let unused = 0
    for (const q of this.parsed.values()) if (q.users <= 0) unused++
    for (const [key, q] of this.parsed) {
      if (unused <= this.timing.keepParsed) break
      if (q.users <= 0) {
        this.parsed.delete(key)
        unused--
      }
    }
  }

  /** Reads what was appended, a chunk at a time (other work runs in between). */
  private catchUp(p: Parsed): Promise<void> {
    p.reading = p.reading.then(async () => {
      for (;;) {
        const { entries, reset, more } = await p.reader.read(this.timing.chunkBytes)
        if (reset) {
          p.state = new SessionState(p.project)
          p.stepCache = new StepCache()
        }
        for (const e of entries) p.state.ingest(e)
        if (!more) break
        await nextTurn()
      }
      p.loaded = true
    }).catch(() => {})
    return p.reading
  }

  /** Builds the snapshot and pushes it when it changed. Cheap when nothing did: the inputs are
   *  compared first, so the 1 s tick reads nothing and builds nothing. */
  private publish(w: Watched): void {
    if (w.closed) return
    const p = w.log
    const current = w.current
    let snapshot: ClaudeSnapshot | null = null
    if (p && current) {
      const modified = this.modifiedOf(w)
      const quiet = Math.max(0, this.deps.now() - modified)
      const following = this.pins.has(w.key) ? 'pinned' : 'newest'
      const sig = [p.key, p.state.version, modified, following, w.stepsKey, JSON.stringify(claudeStatus(p.state, quiet))].join('\0')
      if (sig === w.sig) return
      w.sig = sig
      snapshot = buildSnapshot({ id: current.id, path: current.path, title: '', modified }, p.state, quiet, w.steps, following)
    } else {
      if (w.sig === 'none') return
      w.sig = 'none'
    }
    const json = JSON.stringify(snapshot)
    if (json === w.json) return
    w.json = json
    w.snapshot = snapshot
    for (const sub of w.subs) {
      try {
        sub.client.send(sub.folder, snapshot)
      } catch {
        // A renderer going away mid-send; the others still get theirs.
      }
    }
  }

  private watchDirs(w: Watched, dirs: string[]): void {
    const key = dirs.map(logKey).sort().join('\0')
    if (key === w.dirsKey) return
    w.stopDirs?.()
    w.stopDirs = dirs.length ? this.deps.watch(dirs, (name) => this.onFileEvent(w, name)) : null
    // Nothing watchable yet: the next scan tries again.
    w.dirsKey = !dirs.length || w.stopDirs ? key : ''
  }

  /** The followed session's sub-agent logs, while agents run (the folder watch doesn't see into
   *  `<session>/subagents`). Missing until the first agent writes: tried again each update. */
  private watchAgents(w: Watched, dir: string): void {
    if (w.stopAgents && w.agentsDir === dir) return
    this.unwatchAgents(w)
    w.stopAgents = this.deps.watch([dir], () => this.debounce(w, { steps: true }))
    w.agentsDir = dir
  }

  private unwatchAgents(w: Watched): void {
    w.stopAgents?.()
    w.stopAgents = null
    w.agentsDir = ''
  }

  private release(sub: Sub): void {
    if (!sub.gone && --sub.count <= 0) this.remove(sub)
  }

  private remove(sub: Sub): void {
    if (sub.gone) return
    sub.gone = true
    sub.count = 0
    const key = subKey(sub.client.id, sub.folder)
    if (this.subs.get(key) === sub) this.subs.delete(key)
    if (sub.watched) {
      sub.watched.subs.delete(sub)
      this.closeIfUnused(sub.watched)
    }
  }

  private closeIfUnused(w: Watched): void {
    if (w.closed || w.subs.size > 0 || w.pending > 0) return
    w.closed = true
    for (const t of w.timers) clearInterval(t)
    clearTimeout(w.debounceTimer)
    w.stopDirs?.()
    w.stopDirs = null
    this.unwatchAgents(w)
    // Its parsed log stays cached a while: switching back to this tab reads only what's new.
    this.releaseLog(w.log)
    w.log = null
    if (this.folders.get(w.key) === w) this.folders.delete(w.key)
  }
}
