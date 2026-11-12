import { type ChildProcess, spawn, type SpawnOptions } from 'node:child_process'
import type { DeviceBlock, DeviceInfo } from '@shared/types'
import { CODEC_H264, VideoReader } from '../android/protocol'
import type { DeviceSession, StreamEvents } from '../session'
import { asFailure, endedHow, lastLine, stopper } from './process'
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

/** An ID goes into the helper's argv, so only this shape is trusted: a real one is a UUID; this is
 *  generous rather than exact, and never starts with "-". */
const ID_SHAPE = /^[A-Za-z0-9][A-Za-z0-9-]{0,127}$/

/** The capture device ID in a device id, or null for another kind of device, or an id that isn't a
 *  screen's shape (so it's never trusted into the helper's argv just because `has()` hasn't been
 *  asked yet). */
export const screenIdOf = (id: string): string | null => {
  if (!id.startsWith(PREFIX)) return null
  const screenId = id.slice(PREFIX.length)
  return ID_SHAPE.test(screenId) ? screenId : null
}

/** `readScreenList`'s result: the screens on offer, and how many entries in the line were dropped
 *  (not an object, no string `id`, or an id that isn't a screen's shape) — never a repeated id, which
 *  keeps its first entry silently. */
export interface ScreenList {
  screens: IphoneScreen[]
  skipped: number
}

/** One line of `iphone-screen list`, `{"devices":[{"id","name"}]}`: every screen on offer. null: a
 *  line that isn't a list. */
export function readScreenList(line: string): ScreenList | null {
  let raw: unknown
  try {
    raw = JSON.parse(line)
  } catch {
    return null
  }
  const devices = typeof raw === 'object' && raw !== null ? (raw as { devices?: unknown }).devices : undefined
  if (!Array.isArray(devices)) return null
  const screens = new Map<string, IphoneScreen>()
  let skipped = 0
  for (const item of devices) {
    if (typeof item !== 'object' || item === null) {
      skipped++
      continue
    }
    const { id, name } = item as Record<string, unknown>
    if (typeof id !== 'string' || !ID_SHAPE.test(id)) {
      skipped++
      continue
    }
    if (screens.has(id)) continue // a repeated id keeps its first entry, not its last
    screens.set(id, { id, name: typeof name === 'string' && name.trim() ? name.trim() : 'iPhone' })
  }
  return { screens: [...screens.values()], skipped }
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
 *  (tracker.ts). Each line lists every screen on offer, the first 3 s after the start. A line that
 *  drops entries Deck can't read (ScreenList's `skipped`) is logged once per run: otherwise a helper
 *  that kept sending the same ones would repeat it forever. */
export class IphoneTracker {
  private offered = new Set<string>()
  /** Reset at the start of every run, so a new run that still drops entries gets its own warning. */
  private warnedSkipped = false
  private readonly tracker: LineTracker<ScreenList>

  constructor(deps: IphoneTrackerDeps) {
    this.tracker = new LineTracker({
      name: 'iphone-screen',
      spawn: () => {
        this.warnedSkipped = false
        return deps.list()
      },
      parse: (line) => readScreenList(line),
      publish: ({ screens, skipped }) => {
        this.offered = new Set(screens.map((s) => s.id))
        // Said once per run, not on every line: if macOS ever changed the id's format, every iPhone
        // would otherwise vanish behind a valid-looking empty list with nothing in the log to explain it.
        if (skipped > 0 && !this.warnedSkipped) {
          this.warnedSkipped = true
          console.warn(`devices: iphone-screen: skipped ${skipped} ${skipped === 1 ? 'entry' : 'entries'} Deck couldn't read`)
        }
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

/** What the panel says, under "Camera not allowed". */
export const CAMERA_DENIED = "macOS hasn't let Deck use the camera, which is how it shows an iPhone's screen."

/** The helper's failure line (`{"error":"<code>","message":"…"}`) as Deck says it, and what only the
 *  user can change; null for any other line. */
export function helperFailure(line: string): { why: string; blocked?: DeviceBlock } | null {
  let raw: unknown
  try {
    raw = JSON.parse(line)
  } catch {
    return null
  }
  if (typeof raw !== 'object' || raw === null) return null
  const { error, message } = raw as Record<string, unknown>
  if (typeof error !== 'string') return null
  switch (error) {
    case 'camera-denied':
      return { why: CAMERA_DENIED, blocked: 'camera' }
    case 'not-found':
      return { why: "The iPhone didn't offer its screen. Unlock it, and check that it trusts this Mac." }
    case 'no-picture':
      return { why: 'The iPhone sent no picture. Unlock it, and check that its screen is on.' }
    case 'disconnected':
      return { why: 'The iPhone was disconnected.' }
    default:
      return { why: typeof message === 'string' && message ? message : `iphone-screen failed (${error}).` }
  }
}

/** Starts iPhone screen `id`'s stream: the helper asks for the camera (macOS treats the screen as
 *  one; the prompt shows once, for Deck), finds the screen and captures it. Resolves once the helper
 *  runs, so the streams' 20 s start deadline doesn't cover the prompt, which waits for an answer; the
 *  first picture follows in about 3 s after that. The helper gives up by itself when the screen isn't
 *  offered within 10 s or sends nothing in 15 s. View only: input is dropped. */
export async function startIphone(id: string, events: StreamEvents, io: IphoneIo, signal: AbortSignal): Promise<DeviceSession> {
  if (signal.aborted) throw new Error('Stopped.')
  // A spawn that throws (ENOEXEC) rejects the start here, with nothing opened.
  const proc = io.stream(id)
  const stop = stopper(proc)
  let over = false
  /** The helper's own failure line, which explains more than how it ended. */
  let failure: { why: string; blocked?: DeviceBlock } | null = null
  const said = lastLine(proc.stderr, (line) => {
    const known = helperFailure(line)
    if (known) failure = known
    return known ? known.why : asFailure(line) || null
  })
  const end = (why: string, blocked?: DeviceBlock) => {
    if (over) return
    over = true
    stop()
    events.end(why, blocked)
  }
  const finish = (fallback: string) => {
    // said() first: it also reads a last line with no newline, which may be the helper's failure.
    const last = said()
    if (failure) end(failure.why, failure.blocked)
    else end(last || fallback)
  }

  const reader = new VideoReader({ from: 'codec', sender: "Deck's iPhone helper" })
  proc.stdout?.on('data', (chunk: Buffer) => {
    for (const event of reader.feed(chunk)) {
      if (over) return
      if (event.type === 'error') return end(event.message)
      if (event.type === 'codec' && event.codec !== CODEC_H264) return end("Deck's iPhone helper sent another codec.")
      if (event.type === 'size') events.size(event.width, event.height)
      else if (event.type === 'packet') events.packet({ config: event.config, key: event.key, data: event.data })
    }
  })
  // Writing to a helper that has just gone can fail (EPIPE): its 'close' says why.
  proc.stdin?.on('error', () => {})
  // A spawn that fails once under way (ENOENT, EACCES) says so in 'error', then 'close'. Unheard, the
  // 'error' would reach main's uncaught exception handler.
  proc.on('error', (err) => finish(err.message))
  proc.on('close', (code: number | null, sig: NodeJS.Signals | null) => finish(endedHow('iphone-screen', code, sig)))

  return {
    input: () => {}, // view only: Apple offers no way to tap a real iPhone remotely
    keyframe: () => {
      if (!over && proc.stdin?.writable) proc.stdin.write('key\n')
    },
    stop: () => {
      if (over) return
      over = true
      stop()
    },
  }
}
