import { type ChildProcess, spawn, type SpawnOptions } from 'node:child_process'
import type { DeviceInfo } from '@shared/types'
import { LineTracker } from './tracker'

/** An iPhone's screen, as Deck's helper (native/iphone-screen/) lists it: its capture device's ID (a
 *  UUID macOS gives it: not the phone's UDID, but the same across reconnects and runs) and the
 *  phone's name. */
export interface IphoneScreen {
  id: string
  name: string
}

const PREFIX = 'iphone:'
/** The picture's long side, as scrcpy's max_size for Android. */
const MAX_SIDE = 1600
const MAX_FPS = 60

/** The capture device ID in a device id, or null for another kind of device. */
export const screenIdOf = (id: string): string | null => (id.startsWith(PREFIX) ? id.slice(PREFIX.length) : null)

/** An ID goes into the helper's argv, so only this shape is trusted: a real one is a UUID; this is
 *  generous rather than exact, and never starts with "-". */
const ID_SHAPE = /^[A-Za-z0-9][A-Za-z0-9-]{0,127}$/

/** One line of `iphone-screen list`, `{"devices":[{"id","name"}]}`: every screen on offer. null: a
 *  line that isn't a list. */
export function readScreenList(line: string): IphoneScreen[] | null {
  let raw: unknown
  try {
    raw = JSON.parse(line)
  } catch {
    return null
  }
  const devices = typeof raw === 'object' && raw !== null ? (raw as { devices?: unknown }).devices : undefined
  if (!Array.isArray(devices)) return null
  const screens = new Map<string, IphoneScreen>()
  for (const item of devices) {
    if (typeof item !== 'object' || item === null) continue
    const { id, name } = item as Record<string, unknown>
    if (typeof id !== 'string' || !ID_SHAPE.test(id)) continue
    screens.set(id, { id, name: typeof name === 'string' && name.trim() ? name.trim() : 'iPhone' })
  }
  return [...screens.values()]
}

/** The screens, by name, as devices: on a cable, view only. */
export function iphoneDevices(screens: readonly IphoneScreen[]): DeviceInfo[] {
  return [...screens]
    .sort((a, b) => a.name.localeCompare(b.name) || a.id.localeCompare(b.id))
    .map((s) => ({ id: `${PREFIX}${s.id}`, kind: 'iphone', name: s.name, detail: 'iPhone · cable · view only', state: 'ready' }))
}

export interface IphoneTrackerDeps {
  /** `iphone-screen list`. Spawning it can throw synchronously. */
  list(): ChildProcess
  /** The screens on offer, after each list. */
  publish(devices: DeviceInfo[]): void
  /** The helper stopped (it starts again soon): its last words, and whether *this run* had listed. */
  failed(why: string, listed: boolean): void
}

/** Follows the iPhone screens with the helper's `list`, restarted and timed out as LineTracker does
 *  (tracker.ts). Each line lists every screen on offer, the first 3 s after the start. */
export class IphoneTracker {
  private offered = new Set<string>()
  private readonly tracker: LineTracker<IphoneScreen[]>

  constructor(deps: IphoneTrackerDeps) {
    this.tracker = new LineTracker({
      name: 'iphone-screen',
      spawn: () => deps.list(),
      parse: (line) => readScreenList(line),
      publish: (screens) => {
        this.offered = new Set(screens.map((s) => s.id))
        deps.publish(iphoneDevices(screens))
      },
      failed: (why, listed) => {
        if (!listed) this.offered = new Set()
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

  /** Whether screen `id` was on offer at the last list. */
  has(id: string): boolean {
    return this.offered.has(id)
  }
}

/** How a session and the tracker run the helper; tests replace it. */
export interface IphoneIo {
  /** `iphone-screen list`. Throws when it can't be started at all. */
  list(): ChildProcess
  /** `iphone-screen stream <id> --max-size 1600 --max-fps 60`. Throws when it can't be started. */
  stream(id: string): ChildProcess
}

export interface IphoneIoDeps {
  spawn(command: string, args: string[], options: SpawnOptions): ChildProcess
}

/** The real helper, at `helper`. Its stdin is a pipe Deck keeps open: the helper ends when it closes,
 *  so a Deck that crashes leaves none behind. */
export function iphoneIo(helper: string, deps: IphoneIoDeps = { spawn }): IphoneIo {
  const options: SpawnOptions = { stdio: ['pipe', 'pipe', 'pipe'] }
  return {
    list: () => deps.spawn(helper, ['list'], options),
    stream: (id) => deps.spawn(helper, ['stream', id, '--max-size', String(MAX_SIDE), '--max-fps', String(MAX_FPS)], options),
  }
}
