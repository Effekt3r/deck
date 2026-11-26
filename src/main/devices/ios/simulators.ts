import type { ChildProcess } from 'node:child_process'
import type { DeviceInfo, StartableDevice } from '@shared/types'
import { LineTracker } from './tracker'

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

/** One line of `idb_companion --notify stdout`: a JSON array of targets, kept to iOS simulators
 *  (`--only simulator` also lists watchOS, tvOS and visionOS ones). Its first line lists every
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
    // `--only simulator` also lists watchOS, tvOS and visionOS simulators (they're "Simulator" too):
    // only an iOS one would ever fit an iOS project's tab. iPad simulators report "iOS" as well, so
    // this keeps them without a separate case.
    const osVersion = typeof t.os_version === 'string' ? t.os_version : null
    if (!osVersion?.startsWith('iOS')) continue
    const name = typeof t.name === 'string' && t.name ? t.name : t.udid
    next.set(t.udid, { udid: t.udid, name, state: typeof t.state === 'string' ? t.state : '', osVersion })
  }
  return next
}

const byName = (a: SimTarget, b: SimTarget) => a.name.localeCompare(b.name) || a.udid.localeCompare(b.udid)
const detailOf = (t: SimTarget) => (t.osVersion ? `Simulator · ${t.osVersion}` : 'Simulator')

/** The booted simulators, by name, as devices. */
export function simulatorDevices(targets: ReadonlyMap<string, SimTarget>): DeviceInfo[] {
  return [...targets.values()]
    .filter((t) => t.state === 'Booted')
    .sort(byName)
    .map((t) => ({ id: `${PREFIX}${t.udid}`, kind: 'simulator', name: t.name, detail: detailOf(t), state: 'ready' }))
}

/** The shut-down simulators, by name, as what the panel can start. One booting or shutting down is
 *  neither listed nor offered until it settles. */
export function startableSimulators(targets: ReadonlyMap<string, SimTarget>): StartableDevice[] {
  return [...targets.values()]
    .filter((t) => t.state === 'Shutdown')
    .sort(byName)
    .map((t) => ({ id: `${PREFIX}${t.udid}`, kind: 'simulator', name: t.name, detail: detailOf(t) }))
}

export interface SimulatorTrackerDeps {
  /** `idb_companion --notify stdout --only simulator --log-level info`. Spawning it can throw
   *  synchronously (ENOEXEC: a file with the execute bit that isn't a program; -86 for an Intel
   *  binary without Rosetta). */
  notify(): ChildProcess
  /** The booted simulators, after each line. */
  publish(devices: DeviceInfo[]): void
  /** The notifier stopped (it starts again soon): its last words, and whether *this run* had listed
   *  anything before it died. */
  failed(why: string, listed: boolean): void
}

/** Follows the simulators with one long-running notifier, restarted and timed out as LineTracker
 *  does (tracker.ts). Its first line lists every simulator, each later one only those whose state
 *  changed. A run that never listed clears what's known, so `booted()` reports false rather than
 *  stale news from a much earlier run. */
export class SimulatorTracker {
  private targets = new Map<string, SimTarget>()
  private readonly tracker: LineTracker<Map<string, SimTarget>>

  constructor(deps: SimulatorTrackerDeps) {
    this.tracker = new LineTracker({
      name: 'idb_companion',
      spawn: () => deps.notify(),
      parse: (line, first) => readNotifyLine(line, this.targets, first),
      publish: (targets) => {
        this.targets = targets
        deps.publish(simulatorDevices(targets))
      },
      failed: (why, listed) => {
        if (!listed) this.targets = new Map()
        deps.failed(why, listed)
      },
    })
  }

  start(): void {
    this.tracker.start()
  }

  stop(): void {
    this.tracker.stop()
  }

  /** Whether simulator `udid` was booted at the last line. */
  booted(udid: string): boolean {
    return this.targets.get(udid)?.state === 'Booted'
  }

  /** The simulators shut down at the last line, as what the panel can start. */
  shutDown(): StartableDevice[] {
    return startableSimulators(this.targets)
  }
}
