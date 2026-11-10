import type { ChildProcess } from 'node:child_process'
import type { DeviceInfo } from '@shared/types'

/** What idb_companion's notifier says of a simulator. */
export interface SimTarget {
  udid: string
  name: string
  state: string
  osVersion: string
}

const PREFIX = 'simulator:'

export const udidOf = (id: string): string | null => (id.startsWith(PREFIX) ? id.slice(PREFIX.length) : null)

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
    if (t.type !== 'Simulator' || typeof t.udid !== 'string' || !t.udid) continue
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
  /** `idb_companion --notify stdout --only simulator`. */
  notify(): ChildProcess
  /** The booted simulators, after each line. */
  publish(devices: DeviceInfo[]): void
  /** The notifier stopped (it starts again soon): its last words, and whether it had listed anything. */
  failed(why: string, listed: boolean): void
}

/** Follows the simulators with one long-running notifier. If it stops, it's started again after
 *  1 s, then twice the wait each time, up to 30 s; the wait goes back to 1 s after a run of 30 s. */
export class SimulatorTracker {
  private child: ChildProcess | null = null
  private timer: ReturnType<typeof setTimeout> | null = null
  private wait = 1000
  private running = false
  private targets = new Map<string, SimTarget>()
  private listed = false

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
    const child = this.child
    this.child = null
    child?.kill()
  }

  /** Whether simulator `udid` was booted at the last line. */
  booted(udid: string): boolean {
    return this.targets.get(udid)?.state === 'Booted'
  }

  private run(): void {
    const child = this.deps.notify()
    this.child = child
    const startedAt = Date.now()
    let first = true
    let rest = ''
    let lastWords = ''
    child.stdout?.setEncoding('utf8')
    child.stdout?.on('data', (text: string) => {
      if (this.child !== child) return
      const lines = (rest + text).split('\n')
      rest = lines.pop() ?? ''
      if (rest.length > 4 * 1024 * 1024) rest = '' // no line is this long: garbage
      for (const line of lines) {
        if (!line.trim()) continue
        const next = readNotifyLine(line, this.targets, first)
        if (!next) continue
        first = false
        this.targets = next
        this.listed = true
        this.deps.publish(simulatorDevices(next))
      }
    })
    child.stderr?.setEncoding('utf8')
    child.stderr?.on('data', (text: string) => {
      const line = text.trim().split('\n').at(-1)?.trim()
      if (line) lastWords = line
    })
    let ended = false
    const end = () => {
      if (ended || this.child !== child) return
      ended = true
      this.child = null
      if (!this.running) return
      if (Date.now() - startedAt >= 30_000) this.wait = 1000
      this.deps.failed(lastWords || 'idb_companion stopped.', this.listed)
      this.timer = setTimeout(() => {
        this.timer = null
        if (this.running) this.run()
      }, this.wait)
      this.wait = Math.min(this.wait * 2, 30_000)
    }
    child.on('error', end) // it couldn't start
    child.on('close', end)
  }
}
