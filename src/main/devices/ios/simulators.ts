import type { ChildProcess } from 'node:child_process'
import type { DeviceInfo } from '@shared/types'
import { endedHow, lastLine, stopper } from './process'

/** What idb_companion's notifier says of a simulator. */
export interface SimTarget {
  udid: string
  name: string
  state: string
  osVersion: string
}

const PREFIX = 'simulator:'

export const udidOf = (id: string): string | null => (id.startsWith(PREFIX) ? id.slice(PREFIX.length) : null)

/** A udid goes into a gRPC socket's filename and sim-video's argv, so only this shape is trusted
 *  (a real one is upper-hex with dashes; this is generous rather than exact). */
const UDID_SHAPE = /^[A-Za-z0-9][A-Za-z0-9-]*$/

/** One line of `idb_companion --notify stdout`: a JSON array of targets. Its first line lists every
 *  simulator, each later one only those whose state changed (idb-companion 1.6.1). null: a line
 *  that isn't a list. */
export function readNotifyLine(line: string, known: ReadonlyMap<string, SimTarget>, first: boolean): Map<string, SimTarget> | null {
  let raw: unknown
  try {
    raw = JSON.parse(line)
  } catch {
    return null
  }
  if (!Array.isArray(raw)) return null
  const next = new Map(first ? [] : known)
  for (const item of raw) {
    if (typeof item !== 'object' || item === null) continue
    const t = item as Record<string, unknown>
    if (t.type !== 'Simulator' || typeof t.udid !== 'string' || !UDID_SHAPE.test(t.udid)) continue
    const name = typeof t.name === 'string' && t.name ? t.name : t.udid
    next.set(t.udid, {
      udid: t.udid,
      name,
      state: typeof t.state === 'string' ? t.state : '',
      osVersion: typeof t.os_version === 'string' ? t.os_version : '',
    })
  }
  return next
}

/** The booted simulators, by name, as devices. */
export function simulatorDevices(targets: ReadonlyMap<string, SimTarget>): DeviceInfo[] {
  return [...targets.values()]
    .filter((t) => t.state === 'Booted')
    .sort((a, b) => a.name.localeCompare(b.name) || a.udid.localeCompare(b.udid))
    .map((t) => ({ id: `${PREFIX}${t.udid}`, kind: 'simulator', name: t.name, detail: t.osVersion ? `Simulator · ${t.osVersion}` : 'Simulator', state: 'ready' }))
}

export interface SimulatorTrackerDeps {
  /** `idb_companion --notify stdout --only simulator`. Spawning it can throw synchronously (ENOEXEC:
   *  a file with the execute bit that isn't a program; -86 for an Intel binary without Rosetta). */
  notify(): ChildProcess
  /** The booted simulators, after each line. */
  publish(devices: DeviceInfo[]): void
  /** The notifier stopped (it starts again soon): its last words, and whether *this run* had listed
   *  anything before it died. */
  failed(why: string, listed: boolean): void
}

/** No line is ever this long: a run of garbage with no newline. */
const MAX_PENDING_LINE = 4 * 1024 * 1024
/** idb-companion's first line normally comes in about 2.5 s (measured); a run that never lists
 *  anything in this long is treated as hung and killed. Doubles after each such kill (capped at
 *  DEADLINE_MAX), since a notifier that needs longer than this on every cold start would otherwise
 *  loop forever; a run that lists resets it back to this. */
const FIRST_LIST_DEADLINE = 20_000
const DEADLINE_MAX = 120_000
const RESTART_MIN = 1000
const RESTART_MAX = 30_000

/** Follows the simulators with one long-running notifier. If it stops, it's started again after
 *  1 s, then twice the wait each time, up to 30 s; the wait goes back to 1 s after a run of 30 s on
 *  its own (a run killed for being hung never counts as that, however long we let it run first).
 *  `notify()` throwing (a bad spawn) is handled the same way as the process dying later, so the
 *  tracker is never left wedged. A run that never lists anything within its deadline (20 s at
 *  first, doubling each time this happens, up to 2 min; a list resets it) is treated as hung and
 *  killed: SIGTERM, then SIGKILL 2 s later if it's still running (idb_companion handles SIGTERM
 *  itself on a dispatch queue, so a hung one may never act on it) — the same escalation `stop()`
 *  uses, so a hung notifier is never left running past a stop either. */
export class SimulatorTracker {
  private child: ChildProcess | null = null
  /** Ends the running notifier (process.ts's stopper): SIGTERM, then SIGKILL if it's still running
   *  2 s later. */
  private stopChild: (() => void) | null = null
  private timer: ReturnType<typeof setTimeout> | null = null
  private deadline: ReturnType<typeof setTimeout> | null = null
  private wait = RESTART_MIN
  private deadlineMs = FIRST_LIST_DEADLINE
  private running = false
  private targets = new Map<string, SimTarget>()

  constructor(private readonly deps: SimulatorTrackerDeps) {}

  start(): void {
    if (this.running) return
    this.running = true
    this.run()
  }

  stop(): void {
    this.running = false
    if (this.timer) clearTimeout(this.timer)
    this.timer = null
    this.clearDeadline()
    const stopChild = this.stopChild
    this.child = null
    this.stopChild = null
    stopChild?.()
  }

  /** Whether simulator `udid` was booted at the last line. */
  booted(udid: string): boolean {
    return this.targets.get(udid)?.state === 'Booted'
  }

  private run(): void {
    let child: ChildProcess
    try {
      child = this.deps.notify()
    } catch (err) {
      this.ended(err instanceof Error ? err.message : String(err), 0, false)
      return
    }
    this.child = child
    const stopChild = stopper(child)
    this.stopChild = stopChild
    const said = lastLine(child.stderr)
    const startedAt = Date.now()
    let first = true
    let rest = ''
    let listed = false
    let done = false

    const finish = (why: string, hung = false) => {
      if (done || this.child !== child) return
      done = true
      this.clearDeadline()
      this.child = null
      this.stopChild = null
      this.ended(why, Date.now() - startedAt, listed, hung)
    }
    // Measured: the first line normally comes in ~2.5 s. A run stuck longer than this (its own
    // deadlineMs, which grows the more this keeps happening) is hung (idb-companion wedged, or a
    // CoreSimulator problem that never prints anything) and is killed rather than left silently
    // providing no devices forever.
    const deadlineMs = this.deadlineMs
    this.deadline = setTimeout(() => {
      this.deadlineMs = Math.min(this.deadlineMs * 2, DEADLINE_MAX) // for next time, if this keeps happening
      finish(`idb_companion listed nothing in ${deadlineMs / 1000} s.`, true)
      stopChild()
    }, deadlineMs)

    child.stdout?.setEncoding('utf8')
    child.stdout?.on('data', (text: string) => {
      if (this.child !== child) return
      const lines = (rest + text).split('\n')
      rest = lines.pop() ?? ''
      if (rest.length > MAX_PENDING_LINE) rest = '' // no line is this long: garbage
      for (const line of lines) {
        if (!line.trim()) continue
        const next = readNotifyLine(line, this.targets, first)
        if (!next) continue
        first = false
        listed = true
        this.deadlineMs = FIRST_LIST_DEADLINE // proof idb can respond quickly: back to the base wait
        this.clearDeadline()
        this.targets = next
        this.safePublish(simulatorDevices(next))
      }
    })
    // 'error' and 'close' can both fire for a failed spawn (e.g. EACCES): whichever comes first
    // finalizes the run (finish's own guard drops the other), each with its own best reason.
    child.on('error', (err) => finish(said() || err.message))
    child.on('close', (code, signal) => finish(said() || endedHow('idb_companion', code, signal)))
  }

  /** `listed`: whether the run that just ended had listed anything before it died (not sticky across
   *  restarts). A run that never listed clears `targets`, so `booted()` reports false rather than
   *  stale data from a much earlier run. `hung`: it was killed by the first-list deadline, not a
   *  death of its own. */
  private ended(why: string, ranMs: number, listed: boolean, hung = false): void {
    if (!this.running) return
    if (!listed) this.targets = new Map()
    // A run that lasted as long as the longest wait, on its own, means idb is healthy again: back
    // off from scratch next time, rather than keep the slow pace a past failure earned. A run we had
    // to kill for being hung proves nothing of the sort, however long its (grown) deadline let it
    // run first, so it never resets this.
    if (!hung && ranMs >= RESTART_MAX) this.wait = RESTART_MIN
    this.safeFailed(why, listed)
    const wait = this.wait
    this.timer = setTimeout(() => {
      this.timer = null
      if (this.running) this.run()
    }, wait)
    this.wait = Math.min(this.wait * 2, RESTART_MAX)
  }

  private clearDeadline(): void {
    if (this.deadline) {
      clearTimeout(this.deadline)
      this.deadline = null
    }
  }

  private safePublish(devices: DeviceInfo[]): void {
    try {
      this.deps.publish(devices)
    } catch (err) {
      console.error('devices: publishing the simulator list failed', err)
    }
  }

  private safeFailed(why: string, listed: boolean): void {
    try {
      this.deps.failed(why, listed)
    } catch (err) {
      console.error('devices: reporting a simulator failure failed', err)
    }
  }
}
