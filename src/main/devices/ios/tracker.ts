import type { ChildProcess } from 'node:child_process'
import { asFailure, endedHow, lastLine, stopper } from './process'

export interface LineTrackerDeps<L> {
  /** The program, as its failures name it ("idb_companion stopped."). */
  name: string
  /** Starts it. Spawning can throw synchronously (ENOEXEC: a file with the execute bit that isn't a
   *  program; -86 for an Intel binary without Rosetta). */
  spawn(): ChildProcess
  /** One line of its stdout as a list, or null for a line that isn't one. `first`: this run hasn't
   *  listed yet. */
  parse(line: string, first: boolean): L | null
  /** Each list, as it comes. */
  publish(list: L): void
  /** It stopped (it starts again soon): its last words, and whether *this run* had listed anything
   *  before it died. */
  failed(why: string, listed: boolean): void
}

/** No line is ever this long: a run of garbage with no newline. */
const MAX_PENDING_LINE = 4 * 1024 * 1024
/** A run that lists nothing in this long is treated as hung and killed (idb-companion's first line
 *  normally comes in about 2.5 s, the iPhone helper's at 3 s). Doubles after each such kill (capped
 *  at DEADLINE_MAX), since a program that needs longer than this on every cold start would otherwise
 *  loop forever; a run that lists resets it back to this. */
const FIRST_LIST_DEADLINE = 20_000
const DEADLINE_MAX = 120_000
const RESTART_MIN = 1000
const RESTART_MAX = 30_000

/** Follows a long-running program that prints lists, one per line: idb_companion's simulator
 *  notifier, the iPhone helper's screens. If it stops, it's started again after 1 s, then twice the
 *  wait each time, up to 30 s; the wait goes back to 1 s after a run of 30 s on its own (a run killed
 *  for being hung never counts as that, however long we let it run first). `spawn()` throwing (a bad
 *  spawn) is handled the same way as the process dying later, so the tracker is never left wedged. A
 *  run that never lists anything within its deadline (20 s at first, doubling each time this happens,
 *  up to 2 min; a list resets it) is treated as hung and killed: SIGTERM, then SIGKILL 2 s later if
 *  it's still running (idb_companion handles SIGTERM itself on a dispatch queue, so a hung one may
 *  never act on it) — the same escalation `stop()` uses, so a hung program is never left running
 *  past a stop either. */
export class LineTracker<L> {
  private child: ChildProcess | null = null
  /** Ends the running program (process.ts's stopper): SIGTERM, then SIGKILL if it's still running
   *  2 s later. */
  private stopChild: (() => void) | null = null
  private timer: ReturnType<typeof setTimeout> | null = null
  private deadline: ReturnType<typeof setTimeout> | null = null
  private wait = RESTART_MIN
  private deadlineMs = FIRST_LIST_DEADLINE
  private running = false

  constructor(private readonly deps: LineTrackerDeps<L>) {}

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

  private run(): void {
    let child: ChildProcess
    try {
      child = this.deps.spawn()
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
    // A run stuck longer than this (its own deadlineMs, which grows the more this keeps happening)
    // is hung (idb-companion wedged, a CoreSimulator or CoreMediaIO problem that never prints
    // anything) and is killed rather than left silently providing no devices forever.
    const deadlineMs = this.deadlineMs
    this.deadline = setTimeout(() => {
      this.deadlineMs = Math.min(this.deadlineMs * 2, DEADLINE_MAX) // for next time, if this keeps happening
      finish(`${this.deps.name} listed nothing in ${deadlineMs / 1000} s.`, true)
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
        const list = this.guard('reading', () => this.deps.parse(line, first)) ?? null
        if (list === null) continue
        first = false
        listed = true
        this.deadlineMs = FIRST_LIST_DEADLINE // proof it can answer quickly: back to the base wait
        this.clearDeadline()
        this.guard('publishing', () => this.deps.publish(list))
      }
    })
    // 'error' and 'close' can both fire for a failed spawn (e.g. EACCES): whichever comes first
    // finalizes the run (finish's own guard drops the other), each with its own best reason. Its
    // stderr's last line is only a reason when it reads as a failure (asFailure): idb at --log-level
    // info prints routine chatter there too.
    child.on('error', (err) => finish(asFailure(said()) || err.message))
    child.on('close', (code, signal) => finish(asFailure(said()) || endedHow(this.deps.name, code, signal)))
  }

  /** `listed`: whether the run that just ended had listed anything before it died (not sticky across
   *  restarts). `hung`: it was killed by the first-list deadline, not a death of its own. */
  private ended(why: string, ranMs: number, listed: boolean, hung = false): void {
    if (!this.running) return
    // A run that lasted as long as the longest wait, on its own, means the program is healthy again:
    // back off from scratch next time, rather than keep the slow pace a past failure earned. A run we
    // had to kill for being hung proves nothing of the sort, however long its (grown) deadline let it
    // run first, so it never resets this.
    if (!hung && ranMs >= RESTART_MAX) this.wait = RESTART_MIN
    this.guard('reporting a failure of', () => this.deps.failed(why, listed))
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

  /** The callbacks run inside a stream's handler or a timer: a throw there would reach only main's
   *  last-resort log and leave the run half handled. */
  private guard<T>(doing: string, run: () => T): T | undefined {
    try {
      return run()
    } catch (err) {
      console.error(`devices: ${doing} ${this.deps.name}'s list failed`, err)
      return undefined
    }
  }
}
