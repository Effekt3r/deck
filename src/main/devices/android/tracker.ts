import type { ChildProcess } from 'node:child_process'
import type { DeviceInfo } from '@shared/types'
import { type AdbEntry, type Identity, mergeDevices, readTrackFrames, type Seen } from './devices'

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

interface Asked {
  identity: Identity | null
  /** Failed asks in a row. */
  tries: number
  asking: boolean
  /** Answers given while the device was still starting up. */
  boots: number
}

/** Follows the Android devices adb sees with one long-running `adb track-devices -l`, and asks each
 *  connected device once what it is (again while it's still starting up). Runs while a tab needs Android devices. adb's server going
 *  away ends track-devices; it's started again after 1 s, then up to 30 s apart while it keeps
 *  failing. */
export class AndroidTracker {
  private running = false
  private child: ChildProcess | null = null
  private entries: AdbEntry[] = []
  /** By adb name and connection (transport id). */
  private readonly asked = new Map<string, Asked>()
  private serials = new Map<string, string>()
  private readonly timers = new Set<ReturnType<typeof setTimeout>>()
  private readonly retry: NonNullable<TrackerDeps['retryMs']>
  private restartMs: number
  private lastPublished = ''

  constructor(private readonly deps: TrackerDeps) {
    this.retry = deps.retryMs ?? { identity: 1500, booting: 3000, restartMin: 1000, restartMax: 30_000 }
    this.restartMs = this.retry.restartMin
  }

  start(): void {
    if (this.running) return
    this.running = true
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
    this.lastPublished = ''
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
    let child: ChildProcess
    try {
      child = this.deps.track()
    } catch (err) {
      return this.ended(err instanceof Error ? err.message : String(err))
    }
    this.child = child
    let pending: Buffer = Buffer.alloc(0)
    let said = ''
    let done = false
    const end = (why: string) => {
      if (done || this.child !== child) return
      done = true
      this.child = null
      this.ended(why)
    }
    child.stdout?.on('data', (chunk: Buffer) => {
      if (this.child !== child) return
      try {
        const { lists, rest } = readTrackFrames(pending.length ? Buffer.concat([pending, chunk]) : chunk)
        pending = rest
        const latest = lists.at(-1)
        if (!latest) return
        this.restartMs = this.retry.restartMin
        this.entries = latest
        this.update()
      } catch (err) {
        said = err instanceof Error ? err.message : String(err)
        child.kill()
      }
    })
    child.stderr?.on('data', (chunk: Buffer) => {
      said = `${said}${chunk.toString()}`.slice(-2000)
    })
    child.on('error', (err) => end(err.message))
    child.on('close', (code) => end(lastLine(said) || `adb track-devices stopped (exit code ${code}).`))
  }

  private ended(why: string): void {
    if (!this.running) return
    this.entries = []
    this.asked.clear()
    this.publish(why)
    const wait = this.restartMs
    this.restartMs = Math.min(this.restartMs * 2, this.retry.restartMax)
    this.later(wait, () => {
      if (this.running && !this.child) this.spawn()
    })
  }

  private update(): void {
    const keys = new Set(this.entries.map(keyOf))
    for (const key of this.asked.keys()) if (!keys.has(key)) this.asked.delete(key)
    for (const entry of this.entries) if (entry.state === 'device') this.ask(entry)
    this.publish(null)
  }

  /** `again`: ask once more a device that failed to answer, or answered while still starting up. */
  private ask(entry: AdbEntry, again = false): void {
    const key = keyOf(entry)
    const asked = this.asked.get(key) ?? { identity: null, tries: 0, asking: false, boots: 0 }
    this.asked.set(key, asked)
    if ((asked.identity && !again) || asked.asking || asked.tries >= IDENTITY_TRIES) return
    asked.asking = true
    this.deps.identify(entry.serial).then(
      (identity) => {
        if (this.asked.get(key) !== asked) return
        asked.asking = false
        asked.tries = 0
        asked.identity = identity
        this.publish(null)
        // Still starting up: Android's settings, and with them the phone's own name, aren't there yet.
        if (!identity.booted && ++asked.boots < BOOT_TRIES) this.askLater(key, this.retry.booting)
      },
      () => {
        if (this.asked.get(key) !== asked) return
        asked.asking = false
        if (++asked.tries >= IDENTITY_TRIES) return this.publish(null)
        this.askLater(key, this.retry.identity)
      },
    )
  }

  private askLater(key: string, ms: number): void {
    this.later(ms, () => {
      const now = this.entries.find((e) => keyOf(e) === key)
      if (now?.state === 'device') this.ask(now, true)
    })
  }

  private publish(error: string | null): void {
    // A ready device is listed once it has said what it is (or Deck stopped asking), so its id (an
    // emulator's AVD name) never changes under the panel.
    const seen: Seen[] = []
    for (const entry of this.entries) {
      const asked = this.asked.get(keyOf(entry))
      if (entry.state === 'device' && !asked?.identity && (asked?.asking || (asked?.tries ?? 0) < IDENTITY_TRIES)) continue
      seen.push({ entry, identity: asked?.identity ?? null })
    }
    const { devices, serials } = mergeDevices(seen)
    this.serials = serials
    const text = JSON.stringify([devices, error])
    if (text === this.lastPublished) return
    this.lastPublished = text
    this.deps.publish(devices, error)
  }
}

const keyOf = (e: AdbEntry) => `${e.serial}#${e.transport}`
const lastLine = (text: string) => text.split('\n').map((line) => line.trim()).filter(Boolean).at(-1) ?? ''
