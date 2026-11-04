import type { ChildProcess } from 'node:child_process'
import type { DeviceInfo } from '@shared/types'
import { lastWord } from './adb'
import { type AdbEntry, deviceId, type Identity, mergeDevices, readTrackFrames, type Seen } from './devices'

export interface TrackerDeps {
  /** Starts `adb track-devices -l`. */
  track(): ChildProcess
  /** Asks a device what it is (IDENTITY_SCRIPT through `adb -s <serial> shell`). */
  identify(serial: string): Promise<Identity>
  /** The devices changed; `error` while adb's track-devices is down. */
  publish(devices: DeviceInfo[], error: string | null): void
  /** ms; tests shorten them. */
  retryMs?: { identity: number; booting: number; restartMin: number; restartMax: number }
}

/** A connection that doesn't answer is asked this many times, then listed as adb names it. */
const IDENTITY_TRIES = 3
/** A phone still starting up is asked again, this many times at most (about two minutes). */
const BOOT_TRIES = 40

/** After track-devices (re)starts, the first list waits this long at most for its devices' answers. */
const SETTLE_MS = 3000

interface Asked {
  identity: Identity | null
  /** Failed asks in a row. */
  tries: number
  asking: boolean
  /** Answers given while the device was still starting up. */
  boots: number
  /** A re-ask came due while the device wasn't ready: ask when it is. */
  due: boolean
}

/** Follows the Android devices adb sees with one long-running `adb track-devices -l`, and asks each
 *  connected device once what it is (again while it's still starting up); after each start, the
 *  first list waits for every ready device's first answer (3 s at most). Runs while a tab needs
 *  Android devices. adb's server going away ends track-devices; it's started again after 1 s, then
 *  up to 30 s apart while it keeps failing. */
export class AndroidTracker {
  private running = false
  private child: ChildProcess | null = null
  private entries: AdbEntry[] = []
  /** By adb name and connection (transport id). */
  private readonly asked = new Map<string, Asked>()
  private serials = new Map<string, string>()
  /** Ids of the last computed list, so a device already shown can stay listed (as connecting)
   *  through its first ask instead of flashing as disconnected. */
  private lastIds = new Set<string>()
  private readonly timers = new Set<ReturnType<typeof setTimeout>>()
  private readonly retry: NonNullable<TrackerDeps['retryMs']>
  private restartMs: number
  private lastPublished = ''
  /** Since adb's first list after a (re)start, until every ready device has answered or run out of
   *  tries (at most SETTLE_MS, counted from that first list rather than the start, since starting
   *  adb's own server takes time of its own): the list isn't published yet, so it holds every device
   *  that answers in time rather than growing one at a time. A project with two devices would
   *  otherwise show whichever answered first. */
  private settling = false

  constructor(private readonly deps: TrackerDeps) {
    this.retry = deps.retryMs ?? { identity: 1500, booting: 3000, restartMin: 1000, restartMax: 30_000 }
    this.restartMs = this.retry.restartMin
  }

  start(): void {
    if (this.running) return
    this.running = true
    this.restartMs = this.retry.restartMin
    this.spawn()
  }

  stop(): void {
    this.running = false
    for (const timer of this.timers) clearTimeout(timer)
    this.timers.clear()
    const child = this.child
    this.child = null
    child?.kill()
    this.entries = []
    this.asked.clear()
    this.serials.clear()
    this.lastIds.clear()
    this.lastPublished = ''
    this.settling = false
  }

  /** The adb name to reach device `id` by (a ready connection first, USB before Wi-Fi); undefined
   *  when adb doesn't list it. */
  serialFor(id: string): string | undefined {
    return this.serials.get(id)
  }

  private later(ms: number, run: () => void): void {
    const timer = setTimeout(() => {
      this.timers.delete(timer)
      run()
    }, ms)
    this.timers.add(timer)
  }

  private spawn(): void {
    const startedAt = Date.now()
    let child: ChildProcess
    try {
      child = this.deps.track()
    } catch (err) {
      return this.ended(err instanceof Error ? err.message : String(err), 0)
    }
    this.child = child
    this.settling = true
    let pending: Buffer = Buffer.alloc(0)
    let listed = false
    let said = ''
    let done = false
    const end = (why: string) => {
      if (done || this.child !== child) return
      done = true
      this.child = null
      this.ended(why, Date.now() - startedAt)
    }
    child.stdout?.on('data', (chunk: Buffer) => {
      if (this.child !== child) return
      let latest: AdbEntry[] | undefined
      try {
        const { lists, rest } = readTrackFrames(pending.length ? Buffer.concat([pending, chunk]) : chunk)
        pending = rest
        latest = lists.at(-1)
      } catch (err) {
        said = err instanceof Error ? err.message : String(err)
        child.kill()
        return
      }
      if (!latest) return
      // What adb printed while starting its server (e.g. "* daemon started successfully") isn't an
      // error: a list means it's up.
      said = ''
      this.entries = latest
      // The wait starts at adb's first list: starting adb's own server takes time of its own.
      if (!listed) {
        listed = true
        this.later(SETTLE_MS, () => {
          if (this.child !== child || !this.settling) return
          this.settling = false
          this.publish(null)
        })
      }
      this.update()
    })
    child.stderr?.setEncoding('utf8')
    child.stderr?.on('data', (chunk: string) => {
      said = `${said}${chunk}`.slice(-2000)
    })
    child.on('error', (err) => end(err.message))
    child.on('close', (code, signal) =>
      end(
        lastWord(said) ??
          (signal ? `adb track-devices was stopped (${signal}).` : code === 0 ? "adb's server stopped." : `adb track-devices stopped (exit code ${code}).`),
      ),
    )
  }

  private ended(why: string, ranMs: number): void {
    if (!this.running) return
    this.entries = []
    this.asked.clear()
    this.publish(why)
    // A run that lasted as long as the longest wait means adb is healthy again: back off from
    // scratch next time, rather than keep the slow pace a past failure earned.
    if (ranMs >= this.retry.restartMax) this.restartMs = this.retry.restartMin
    const wait = this.restartMs
    this.restartMs = Math.min(this.restartMs * 2, this.retry.restartMax)
    this.later(wait, () => {
      if (this.running && !this.child) this.spawn()
    })
  }

  private update(): void {
    const keys = new Set(this.entries.map(keyOf))
    for (const key of this.asked.keys()) if (!keys.has(key)) this.asked.delete(key)
    for (const entry of this.entries) {
      if (entry.state !== 'device') continue
      const asked = this.asked.get(keyOf(entry))
      // A device waiting out its retry gap is asked by its timer, not by the next list.
      if (!asked || asked.due) this.ask(entry, asked?.due ?? false)
    }
    this.publish(null)
  }

  /** `again`: ask once more a device that failed to answer, or answered while still starting up. */
  private ask(entry: AdbEntry, again = false): void {
    const key = keyOf(entry)
    const asked = this.asked.get(key) ?? { identity: null, tries: 0, asking: false, boots: 0, due: false }
    this.asked.set(key, asked)
    if ((asked.identity && !again) || asked.asking || asked.tries >= IDENTITY_TRIES) return
    asked.asking = true
    asked.due = false
    this.deps.identify(entry.serial).then(
      (identity) => {
        if (this.asked.get(key) !== asked) return
        asked.asking = false
        asked.tries = 0
        asked.identity = identity
        this.publish(null)
        // Still starting up: Android's settings, and with them the phone's own name, aren't there yet.
        if (!identity.booted && ++asked.boots < BOOT_TRIES) this.askLater(key, asked, this.retry.booting)
      },
      () => {
        if (this.asked.get(key) !== asked) return
        asked.asking = false
        if (++asked.tries >= IDENTITY_TRIES) return this.publish(null)
        this.askLater(key, asked, this.retry.identity)
      },
    )
  }

  private askLater(key: string, asked: Asked, ms: number): void {
    this.later(ms, () => {
      if (this.asked.get(key) !== asked) return
      const now = this.entries.find((e) => keyOf(e) === key)
      if (now?.state === 'device') this.ask(now, true)
      else asked.due = true
    })
  }

  private publish(error: string | null): void {
    if (this.settling) {
      if (error === null && this.entries.some((e) => this.unanswered(e))) return
      this.settling = false
    }
    // A ready device is listed once it has said what it is (or Deck stopped asking), so its id (an
    // emulator's AVD name) never changes under the panel. One already listed (e.g. unauthorized)
    // stays listed, as connecting, while its first ask is in flight, so allowing it on the device
    // doesn't make it flash as disconnected.
    const seen: Seen[] = []
    for (const entry of this.entries) {
      const asked = this.asked.get(keyOf(entry))
      if (this.unanswered(entry)) {
        const connecting: Seen = { entry: { ...entry, state: 'connecting' }, identity: null }
        if (this.lastIds.has(deviceId(connecting))) seen.push(connecting)
        continue
      }
      seen.push({ entry, identity: asked?.identity ?? null })
    }
    const { devices, serials } = mergeDevices(seen)
    this.lastIds = new Set(devices.map((d) => d.id))
    this.serials = serials
    const text = JSON.stringify([devices, error])
    if (text === this.lastPublished) return
    try {
      this.deps.publish(devices, error)
      this.lastPublished = text
    } catch (err) {
      console.error('devices: publishing the list failed', err)
    }
  }

  /** A ready device that hasn't said what it is yet and is still being asked: it isn't listed under
   *  its own id yet, and a first list waits for it. */
  private unanswered(entry: AdbEntry): boolean {
    const asked = this.asked.get(keyOf(entry))
    return entry.state === 'device' && !asked?.identity && (asked?.asking || (asked?.tries ?? 0) < IDENTITY_TRIES)
  }
}

const keyOf = (e: AdbEntry) => `${e.serial}#${e.transport}`
