import type { DeviceStreamEvent } from '@shared/types'
import type { DeviceSession, StreamEvents } from './session'

/** How long a stream must stay live before a break counts as recovered rather than a continuation
 *  of the same problem: without this, a device that drops the stream right after every reconnect
 *  would retry forever instead of reaching the error state. */
const STEADY_MS = 5000

export interface StreamsDeps {
  /** Starts device `id`'s stream; `signal` stops a start still under way. `events`' `size` and
   *  `packet` may arrive before this resolves; a failure before then rejects it instead of calling
   *  `events.end()`. */
  start(id: string, events: StreamEvents, signal: AbortSignal): Promise<DeviceSession>
  /** News for the renderer. */
  send(id: string, event: DeviceStreamEvent): void
  /** How long a stream nobody views keeps running. */
  graceMs?: number
  /** The waits before each new start after a stream broke; then it's an error. */
  retryMs?: readonly number[]
  /** How long a start may run before it's treated as failed and retried. */
  startMs?: number
}

interface Stream {
  viewers: number
  session: DeviceSession | null
  /** The start under way; aborting it stops it. */
  starting: AbortController | null
  /** Breaks in a row; reset once a live stream has stayed up for STEADY_MS before breaking again. */
  failures: number
  graceTimer: ReturnType<typeof setTimeout> | null
  retryTimer: ReturnType<typeof setTimeout> | null
  /** The start under way's deadline; cleared once it settles, or in halt(). */
  startTimer: ReturnType<typeof setTimeout> | null
  /** Set once the retries ran out; cleared by begin() (retry(), resume(), or a fresh view after
   *  every viewer had left and dropped the stream). */
  error: string | null
  /** The latest capture size, for a viewer that joins a running stream; cleared on a restart, since
   *  a reconnected stream's size comes with its new session. */
  size: { width: number; height: number } | null
  live: boolean
  /** Date.now() at the current session's first packet; null until then. Tells a fresh break from a
   *  steady stream's (see STEADY_MS). */
  liveAt: number | null
  /** Bumped at every start and stop, so an older session's news is dropped. */
  generation: number
}

/** One stream per device viewed, shared by its viewers (tabs). It keeps running 10 s after the last
 *  viewer leaves, so switching tabs and back doesn't restart it: a viewer that comes back asks for a
 *  key frame instead. A stream that breaks is started again after 1, 2 and 5 s, then reports the
 *  error until retry() — every viewer leaving (the stream is dropped, so the next one starts clean)
 *  and resume() clear an error too. A stream only counts as recovered, resetting its failure count,
 *  once it has stayed live for STEADY_MS; breaking sooner still counts towards the error. While the
 *  Mac is locked or asleep (pause) nothing streams. */
export class DeviceStreams {
  private readonly streams = new Map<string, Stream>()
  private paused = false
  private readonly graceMs: number
  private readonly retryMs: readonly number[]
  private readonly startMs: number

  constructor(private readonly deps: StreamsDeps) {
    this.graceMs = deps.graceMs ?? 10_000
    this.retryMs = deps.retryMs ?? [1000, 2000, 5000]
    this.startMs = deps.startMs ?? 20_000
  }

  view(id: string): void {
    let s = this.streams.get(id)
    if (!s) {
      s = { viewers: 0, session: null, starting: null, failures: 0, graceTimer: null, retryTimer: null, startTimer: null, error: null, size: null, live: false, liveAt: null, generation: 0 }
      this.streams.set(id, s)
    }
    s.viewers++
    if (s.graceTimer) {
      clearTimeout(s.graceTimer)
      s.graceTimer = null
    }
    if (this.paused) return this.deps.send(id, { type: 'state', state: 'connecting' }) // resume() starts it
    if (s.error) return this.deps.send(id, { type: 'state', state: 'error', message: s.error })
    if (s.session) {
      const session = s.session
      if (s.size) this.deps.send(id, { type: 'size', ...s.size })
      if (!s.live) return this.deps.send(id, { type: 'state', state: s.failures > 0 ? 'reconnecting' : 'connecting' })
      this.deps.send(id, { type: 'state', state: 'live' })
      this.guard(() => session.keyframe()) // the new viewer's decoder starts from a key frame
      return
    }
    if (s.starting || s.retryTimer) return this.deps.send(id, { type: 'state', state: s.failures > 0 ? 'reconnecting' : 'connecting' })
    this.begin(id, s)
  }

  unview(id: string): void {
    const s = this.streams.get(id)
    if (!s || s.viewers === 0) return
    s.viewers--
    if (s.viewers > 0) return
    if (!s.session && !s.starting) return this.drop(id, s) // an error, or a retry nobody waits for
    s.graceTimer = setTimeout(() => {
      s.graceTimer = null
      if (s.viewers === 0 && this.streams.get(id) === s) this.drop(id, s)
    }, this.graceMs)
  }

  /** A fresh key frame: a decoder fell behind or failed. */
  keyframe(id: string): void {
    const session = this.streams.get(id)?.session
    if (session) this.guard(() => session.keyframe())
  }

  /** The renderer's input for the device, while its stream runs: its session checks it. */
  input(id: string, input: unknown): void {
    const session = this.streams.get(id)?.session
    if (session) this.guard(() => session.input(input))
  }

  retry(id: string): void {
    const s = this.streams.get(id)
    if (!s || !s.error || s.viewers === 0 || this.paused) return
    s.failures = 0
    this.begin(id, s)
  }

  pause(): void {
    if (this.paused) return
    this.paused = true
    for (const [id, s] of this.streams) {
      this.halt(s)
      if (s.viewers === 0) this.streams.delete(id)
    }
  }

  resume(): void {
    if (!this.paused) return
    this.paused = false
    for (const [id, s] of this.streams) {
      s.failures = 0
      this.begin(id, s)
    }
  }

  /** A reload or quit: every stream stops, viewers forgotten. */
  stopAll(): void {
    for (const s of this.streams.values()) this.halt(s)
    this.streams.clear()
  }

  private begin(id: string, s: Stream): void {
    const start = new AbortController()
    s.starting = start
    s.live = false
    s.liveAt = null
    s.size = null // a reconnected stream's size comes with its new session
    s.error = null
    const generation = ++s.generation
    this.deps.send(id, { type: 'state', state: s.failures > 0 ? 'reconnecting' : 'connecting' })
    const current = () => this.streams.get(id) === s && s.generation === generation
    // This start's own deadline: a start that settles late (aborted, then its adb step returned)
    // must not clear the deadline of the start that replaced it.
    const deadline = setTimeout(() => {
      if (s.startTimer === deadline) s.startTimer = null
      if (!current() || s.starting !== start) return
      s.generation++ // the abort's own "Stopped." rejection must not be heard
      start.abort()
      s.starting = null
      this.failed(id, s, `The device didn't start its stream within ${Math.max(1, Math.round(this.startMs / 1000))} s.`)
    }, this.startMs)
    s.startTimer = deadline
    const clearStartTimer = () => {
      clearTimeout(deadline)
      if (s.startTimer === deadline) s.startTimer = null
    }
    const events: StreamEvents = {
      size: (width, height) => {
        if (!current()) return
        s.size = { width, height }
        this.deps.send(id, { type: 'size', width, height })
      },
      packet: (packet) => {
        if (!current()) return
        if (!s.live) {
          s.live = true
          s.liveAt = Date.now()
          this.deps.send(id, { type: 'state', state: 'live' })
        }
        // Nobody views it during its grace: a packet would only cross to a renderer that drops it.
        // A viewer coming back asks for a key frame (view()).
        if (s.viewers > 0) this.deps.send(id, { type: 'packet', ...packet })
      },
      end: (why) => {
        if (!current()) return
        s.generation++ // nothing more is heard from this session
        if (s.liveAt !== null && Date.now() - s.liveAt >= STEADY_MS) s.failures = 0
        s.session = null
        s.starting = null
        s.live = false
        s.liveAt = null
        this.failed(id, s, why)
      },
    }
    this.deps.start(id, events, start.signal).then(
      (session) => {
        clearStartTimer()
        if (!current()) return session.stop()
        s.starting = null
        s.session = session
      },
      (err: unknown) => {
        clearStartTimer()
        if (!current()) return
        s.starting = null
        this.failed(id, s, err instanceof Error ? err.message : String(err))
      },
    )
  }

  private failed(id: string, s: Stream, why: string): void {
    if (s.viewers === 0) return this.drop(id, s)
    if (this.paused) return
    if (s.failures < this.retryMs.length) {
      const wait = this.retryMs[s.failures++]
      this.deps.send(id, { type: 'state', state: 'reconnecting' })
      s.retryTimer = setTimeout(() => {
        s.retryTimer = null
        if (this.streams.get(id) === s && s.viewers > 0 && !this.paused) this.begin(id, s)
      }, wait)
      return
    }
    s.error = why
    this.deps.send(id, { type: 'state', state: 'error', message: why })
  }

  /** Stops the stream's session and timers; its news from here on is dropped. */
  private halt(s: Stream): void {
    if (s.graceTimer) clearTimeout(s.graceTimer)
    if (s.retryTimer) clearTimeout(s.retryTimer)
    if (s.startTimer) clearTimeout(s.startTimer)
    s.graceTimer = null
    s.retryTimer = null
    s.startTimer = null
    s.generation++
    // Taken out of the stream first: a throwing stop() (guarded below, but belt and braces) must
    // still leave the pending start aborted and the stream's own state fully reset.
    const session = s.session
    s.session = null
    s.starting?.abort()
    s.starting = null
    s.live = false
    if (session) this.guard(() => session.stop())
  }

  /** Session methods shouldn't throw (session.ts), but they run in IPC listeners and timers, where
   *  a throw would show Electron's modal error dialog: guarded anyway. */
  private guard(run: () => void): void {
    try {
      run()
    } catch (err) {
      console.error('devices: a session failed', err)
    }
  }

  private drop(id: string, s: Stream): void {
    this.halt(s)
    this.streams.delete(id)
  }
}
