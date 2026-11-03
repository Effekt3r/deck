import type { DeviceStreamEvent } from '@shared/types'
import { resetVideoMessage } from './android/protocol'
import type { ScrcpyEvents, ScrcpySession } from './android/scrcpy'

export interface StreamsDeps {
  /** Starts device `id`'s stream; `signal` stops a start still under way. */
  start(id: string, events: ScrcpyEvents, signal: AbortSignal): Promise<ScrcpySession>
  /** News for the renderer. */
  send(id: string, event: DeviceStreamEvent): void
  /** How long a stream nobody views keeps running. */
  graceMs?: number
  /** The waits before each new start after a stream broke; then it's an error. */
  retryMs?: readonly number[]
}

interface Stream {
  viewers: number
  session: ScrcpySession | null
  /** The start under way; aborting it stops it. */
  starting: AbortController | null
  /** Breaks in a row; a stream that goes live counts from 0 again. */
  failures: number
  graceTimer: ReturnType<typeof setTimeout> | null
  retryTimer: ReturnType<typeof setTimeout> | null
  /** Set once the retries ran out, until retry(). */
  error: string | null
  /** The latest capture size, for a viewer that joins a running stream. */
  size: { width: number; height: number } | null
  live: boolean
  /** Bumped at every start and stop, so an older session's news is dropped. */
  generation: number
}

/** One stream per device viewed, shared by its viewers (tabs). It keeps running 10 s after the last
 *  viewer leaves, so switching tabs and back doesn't restart it: a viewer that comes back asks for a
 *  key frame instead. A stream that breaks is started again after 1, 2 and 5 s, then reports the
 *  error until retry(). While the Mac is locked or asleep (pause) nothing streams. */
export class DeviceStreams {
  private readonly streams = new Map<string, Stream>()
  private paused = false
  private readonly graceMs: number
  private readonly retryMs: readonly number[]

  constructor(private readonly deps: StreamsDeps) {
    this.graceMs = deps.graceMs ?? 10_000
    this.retryMs = deps.retryMs ?? [1000, 2000, 5000]
  }

  view(id: string): void {
    let s = this.streams.get(id)
    if (!s) {
      s = { viewers: 0, session: null, starting: null, failures: 0, graceTimer: null, retryTimer: null, error: null, size: null, live: false, generation: 0 }
      this.streams.set(id, s)
    }
    s.viewers++
    if (s.graceTimer) {
      clearTimeout(s.graceTimer)
      s.graceTimer = null
    }
    if (this.paused) return
    if (s.error) return this.deps.send(id, { type: 'state', state: 'error', message: s.error })
    if (s.session) {
      if (s.size) this.deps.send(id, { type: 'size', ...s.size })
      if (s.live) this.deps.send(id, { type: 'state', state: 'live' })
      s.session.send(resetVideoMessage()) // the new viewer's decoder starts from a key frame
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
    this.streams.get(id)?.session?.send(resetVideoMessage())
  }

  /** A control message for the device, while its stream runs. */
  input(id: string, message: Buffer): void {
    this.streams.get(id)?.session?.send(message)
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
    s.error = null
    const generation = ++s.generation
    this.deps.send(id, { type: 'state', state: s.failures > 0 ? 'reconnecting' : 'connecting' })
    const current = () => this.streams.get(id) === s && s.generation === generation
    const events: ScrcpyEvents = {
      size: (width, height) => {
        if (!current()) return
        s.size = { width, height }
        this.deps.send(id, { type: 'size', width, height })
      },
      packet: (packet) => {
        if (!current()) return
        if (!s.live) {
          s.live = true
          s.failures = 0
          this.deps.send(id, { type: 'state', state: 'live' })
        }
        this.deps.send(id, { type: 'packet', ...packet })
      },
      end: (why) => {
        if (!current()) return
        s.session = null
        s.live = false
        this.failed(id, s, why)
      },
    }
    this.deps.start(id, events, start.signal).then(
      (session) => {
        if (!current()) return session.stop()
        s.starting = null
        s.session = session
      },
      (err: unknown) => {
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
    s.graceTimer = null
    s.retryTimer = null
    s.generation++
    s.session?.stop()
    s.session = null
    s.starting?.abort()
    s.starting = null
    s.live = false
  }

  private drop(id: string, s: Stream): void {
    this.halt(s)
    this.streams.delete(id)
  }
}
