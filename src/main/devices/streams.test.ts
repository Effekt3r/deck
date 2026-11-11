import { afterEach, beforeEach, describe, expect, it, vi } from 'vitest'
import type { DeviceStreamEvent } from '@shared/types'
import type { DeviceSession, StreamEvents } from './session'
import { DeviceStreams } from './streams'

interface Started {
  id: string
  events: StreamEvents
  session: { input: ReturnType<typeof vi.fn>; keyframe: ReturnType<typeof vi.fn>; stop: ReturnType<typeof vi.fn> }
}

/** `attempts()` counts every call to start(), the failed ones included, for tests that care how many
 *  tries were made rather than how many succeeded. */
function setup(failing: () => boolean = () => false) {
  const started: Started[] = []
  const sent: [string, DeviceStreamEvent][] = []
  let attempts = 0
  const streams = new DeviceStreams({
    start: async (id, events) => {
      attempts++
      if (failing()) throw new Error('device offline')
      const session = { input: vi.fn(), keyframe: vi.fn(), stop: vi.fn() }
      started.push({ id, events, session })
      return session
    },
    send: (id, event) => sent.push([id, event]),
  })
  return { streams, started, sent, attempts: () => attempts }
}

const states = (sent: [string, DeviceStreamEvent][]) => sent.flatMap(([, e]) => (e.type === 'state' ? [e.state] : []))
const flush = () => vi.advanceTimersByTimeAsync(0)
const frame = { config: false, key: true, data: new Uint8Array([1]) }

beforeEach(() => {
  vi.useFakeTimers()
})
afterEach(() => {
  vi.useRealTimers()
})

describe('DeviceStreams', () => {
  it('one stream for two viewers, kept 10 s after the last leaves; a viewer coming back gets a key frame', async () => {
    const { streams, started, sent } = setup()
    streams.view('android:1')
    streams.view('android:1')
    await flush()
    expect(started).toHaveLength(1)
    started[0].events.size(720, 1440)
    started[0].events.packet(frame)
    expect(states(sent)).toEqual(['connecting', 'connecting', 'live']) // the second viewer is told too

    streams.unview('android:1')
    streams.unview('android:1')
    await vi.advanceTimersByTimeAsync(9_000)
    streams.view('android:1')
    expect(started).toHaveLength(1)
    expect(started[0].session.keyframe).toHaveBeenCalledTimes(1)
    expect(sent.slice(-2)).toEqual([['android:1', { type: 'size', width: 720, height: 1440 }], ['android:1', { type: 'state', state: 'live' }]])

    streams.unview('android:1')
    await vi.advanceTimersByTimeAsync(10_000)
    expect(started[0].session.stop).toHaveBeenCalled()
  })

  it('sends no packets while nobody views it (its grace); a viewer coming back gets a key frame first', async () => {
    const { streams, started, sent } = setup()
    const packets = () => sent.filter(([, e]) => e.type === 'packet').length
    streams.view('android:1')
    await flush()
    started[0].events.packet(frame)
    expect(packets()).toBe(1)
    streams.unview('android:1')
    started[0].events.packet(frame)
    started[0].events.packet(frame)
    expect(packets()).toBe(1)
    streams.view('android:1')
    expect(started[0].session.keyframe).toHaveBeenCalledTimes(1)
    started[0].events.packet(frame)
    expect(packets()).toBe(2)
  })

  it('a stream that breaks starts again after 1, 2 and 5 s, then reports the error until retry()', async () => {
    let failing = false
    const { streams, started, sent } = setup(() => failing)
    streams.view('android:1')
    await flush()
    failing = true
    started[0].events.end('The device stopped sending video.')
    expect(sent.at(-1)).toEqual(['android:1', { type: 'state', state: 'reconnecting' }])
    await vi.advanceTimersByTimeAsync(1000 + 2000 + 5000)
    expect(sent.at(-1)).toEqual(['android:1', { type: 'state', state: 'error', message: 'device offline' }])

    failing = false
    streams.retry('android:1')
    await flush()
    expect(started).toHaveLength(2)
  })

  it('a viewer joining before the first packet gets connecting and no key-frame reset; a viewer joining while paused gets connecting', async () => {
    const { streams, started, sent } = setup()
    streams.view('android:1')
    await flush()
    const joined = sent.length
    streams.view('android:1') // the session exists but hasn't gone live: no stale state, no reset
    expect(sent.slice(joined)).toEqual([['android:1', { type: 'state', state: 'connecting' }]])
    expect(started[0].session.keyframe).not.toHaveBeenCalled()

    streams.pause()
    const before = sent.length
    streams.view('android:2')
    expect(sent.slice(before)).toEqual([['android:2', { type: 'state', state: 'connecting' }]])
  })

  it('a stream that goes live and breaks at once, again and again, reaches the error after its three retries', async () => {
    const { streams, started, sent } = setup()
    streams.view('android:1')
    await flush()
    started[0].events.packet(frame)
    started[0].events.end('gone') // breaks right after going live: not steady for 5 s, so it still counts
    await vi.advanceTimersByTimeAsync(1000)
    started[1].events.packet(frame)
    started[1].events.end('gone')
    await vi.advanceTimersByTimeAsync(2000)
    started[2].events.packet(frame)
    started[2].events.end('gone')
    await vi.advanceTimersByTimeAsync(5000)
    started[3].events.packet(frame)
    started[3].events.end('gone')
    expect(started).toHaveLength(4)
    expect(sent.at(-1)).toEqual(['android:1', { type: 'state', state: 'error', message: 'gone' }])
  })

  it('a stream that stays live 6 s before breaking gets three fresh tries', async () => {
    const { streams, started } = setup()
    streams.view('android:1')
    await flush()
    for (let i = 0; i < 4; i++) {
      started[i].events.packet(frame)
      await vi.advanceTimersByTimeAsync(6_000) // past STEADY_MS: this break doesn't count against it
      started[i].events.end('gone')
      await vi.advanceTimersByTimeAsync(1000) // always the first (shortest) wait: a fresh try each time
    }
    expect(started).toHaveLength(5)
  })

  it('stops while the Mac is locked or asleep, and starts again after', async () => {
    const { streams, started, sent } = setup()
    streams.view('android:1')
    await flush()
    streams.pause()
    expect(started[0].session.stop).toHaveBeenCalled()
    // News from the stopped session is dropped.
    const before = sent.length
    started[0].events.packet(frame)
    started[0].events.end('gone')
    expect(sent).toHaveLength(before)
    streams.resume()
    await flush()
    expect(started).toHaveLength(2)
  })

  it('passes input and key frame requests to a running session only', async () => {
    const { streams, started } = setup()
    streams.input('android:1', { type: 'text', text: 'a' })
    streams.view('android:1')
    await flush()
    streams.input('android:1', { type: 'text', text: 'b' })
    streams.keyframe('android:1')
    expect(started[0].session.input.mock.calls).toEqual([[{ type: 'text', text: 'b' }]])
    expect(started[0].session.keyframe).toHaveBeenCalledTimes(1)
  })

  it('stopping a stream that is still starting stops the start', async () => {
    const signals: AbortSignal[] = []
    const streams = new DeviceStreams({
      start: (_id, _events, signal) => {
        signals.push(signal)
        return new Promise(() => {}) // adb never finishes
      },
      send: () => {},
    })
    streams.view('android:1')
    streams.unview('android:1')
    await vi.advanceTimersByTimeAsync(10_000)
    expect(signals[0].aborted).toBe(true)
    streams.view('android:2')
    streams.pause()
    expect(signals[1].aborted).toBe(true)
  })

  it("a packet after end() doesn't flip the stream back to live", async () => {
    const { streams, started, sent } = setup()
    streams.view('android:1')
    await flush()
    started[0].events.end('gone')
    const before = sent.length
    started[0].events.packet(frame) // a straggler, raced with the teardown
    expect(sent.slice(before)).toEqual([])
  })

  it("a start past its deadline is aborted and retried after 1 s; the retries' error is the deadline's", async () => {
    const signals: AbortSignal[] = []
    const sent: [string, DeviceStreamEvent][] = []
    const streams = new DeviceStreams({
      start: (_id, _events, signal) => {
        signals.push(signal)
        return new Promise(() => {}) // adb or the device hung: this start never settles on its own
      },
      send: (id, event) => sent.push([id, event]),
    })
    streams.view('android:1')
    await vi.advanceTimersByTimeAsync(20_000)
    expect(signals[0].aborted).toBe(true)
    expect(states(sent).slice(-1)).toEqual(['reconnecting'])
    await vi.advanceTimersByTimeAsync(1_000)
    expect(signals).toHaveLength(2)

    // Two more deadlines, 2 s and 5 s apart, before the third retry gives up.
    await vi.advanceTimersByTimeAsync(20_000 + 2_000 + 20_000 + 5_000 + 20_000)
    expect(signals).toHaveLength(4)
    expect(sent.at(-1)).toEqual(['android:1', { type: 'state', state: 'error', message: "The device didn't start its stream within 20 s." }])
  })
})

describe('DeviceStreams, the edges', () => {
  it('a start that resolved is never timed out', async () => {
    const { streams, started, sent } = setup()
    streams.view('android:1')
    await flush()
    started[0].events.packet(frame)
    await vi.advanceTimersByTimeAsync(60_000)
    expect(states(sent)).toEqual(['connecting', 'live'])
    expect(started).toHaveLength(1)
    expect(started[0].session.stop).not.toHaveBeenCalled()
  })

  it("a timed-out start's own Stopped. isn't a second failure: one retry, one new start", async () => {
    const signals: AbortSignal[] = []
    const sent: [string, DeviceStreamEvent][] = []
    const streams = new DeviceStreams({
      start: (_id, _events, signal) =>
        new Promise((_resolve, reject) => {
          signals.push(signal)
          signal.addEventListener('abort', () => reject(new Error('Stopped.'))) // as startScrcpy does
        }),
      send: (id, event) => sent.push([id, event]),
    })
    streams.view('android:1')
    await vi.advanceTimersByTimeAsync(20_000)
    expect(states(sent)).toEqual(['connecting', 'reconnecting'])
    await vi.advanceTimersByTimeAsync(2_000)
    expect(signals).toHaveLength(2)
  })

  it("a start that settles long after it was stopped doesn't cancel the next start's deadline", async () => {
    const starts: { signal: AbortSignal; reject: (err: Error) => void }[] = []
    const streams = new DeviceStreams({
      start: (_id, _events, signal) => new Promise((_resolve, reject) => { starts.push({ signal, reject }) }),
      send: () => {},
    })
    streams.view('android:1')
    streams.pause() // locked mid-start: start 0 is aborted, but its adb step is still running
    streams.resume()
    await vi.advanceTimersByTimeAsync(5_000)
    starts[0].reject(new Error('Stopped.')) // the adb step returns
    await vi.advanceTimersByTimeAsync(15_000)
    expect(starts[1].signal.aborted).toBe(true) // start 1 still met its 20 s deadline
  })

  it('a viewer joining a reconnected, not-yet-live session gets reconnecting, with no stale size or key-frame reset', async () => {
    const { streams, started, sent } = setup()
    streams.view('android:1')
    await flush()
    started[0].events.size(720, 1440)
    started[0].events.packet(frame)
    started[0].events.end('gone')
    await vi.advanceTimersByTimeAsync(1000) // the retry begins a new, not-yet-live session
    const before = sent.length
    streams.view('android:1')
    expect(sent.slice(before)).toEqual([['android:1', { type: 'state', state: 'reconnecting' }]])
    expect(started[1].session.keyframe).not.toHaveBeenCalled()
  })

  it('a stream live for exactly STEADY_MS (5000 ms) gets a fresh try; one ms short still counts towards the error', async () => {
    for (const [ms, fresh] of [[5000, true], [4999, false]] as const) {
      const { streams, started } = setup()
      streams.view('android:1')
      await flush()
      started[0].events.end('x') // a break before going live: failures 0 → 1, next wait 2 s
      await vi.advanceTimersByTimeAsync(1000)
      started[1].events.packet(frame)
      await vi.advanceTimersByTimeAsync(ms)
      started[1].events.end('y')
      await vi.advanceTimersByTimeAsync(1000) // a fresh try waits 1 s; a still-counted one waits 2 s
      expect(started.length === 3).toBe(fresh)
      streams.stopAll()
    }
  })

  it('waits exactly 1, 2 and 5 s between tries, then stops trying; retry() gives three fresh ones', async () => {
    let failing = false
    const { streams, started, sent, attempts } = setup(() => failing)
    streams.view('android:1')
    await flush()
    failing = true
    started[0].events.end('gone')
    for (const wait of [1000, 2000, 5000]) {
      const before = attempts()
      await vi.advanceTimersByTimeAsync(wait - 1)
      expect(attempts()).toBe(before)
      await vi.advanceTimersByTimeAsync(1)
      expect(attempts()).toBe(before + 1)
    }
    expect(states(sent)).toEqual(['connecting', 'reconnecting', 'reconnecting', 'reconnecting', 'reconnecting', 'reconnecting', 'reconnecting', 'error'])
    await vi.advanceTimersByTimeAsync(60_000)
    expect(attempts()).toBe(4)

    streams.retry('android:1')
    streams.view('android:1') // a second viewer during the new start isn't shown the old error
    expect(states(sent).slice(-2)).toEqual(['connecting', 'connecting'])
    await vi.advanceTimersByTimeAsync(1000 + 2000 + 5000)
    expect(attempts()).toBe(8)
  })

  it('stopAll() stops every session and forgets every viewer', async () => {
    const { streams, started } = setup()
    streams.view('android:1')
    await flush()
    streams.stopAll()
    expect(started[0].session.stop).toHaveBeenCalled()
    streams.view('android:1') // the reloaded window's one viewer
    await flush()
    expect(started).toHaveLength(2)
    streams.unview('android:1')
    await vi.advanceTimersByTimeAsync(10_000)
    expect(started[1].session.stop).toHaveBeenCalled()
  })

  it('a start that finishes after its stream stopped is stopped at once, guarded even here', async () => {
    const errorSpy = vi.spyOn(console, 'error').mockImplementation(() => {})
    try {
      let finish!: (session: DeviceSession) => void
      const session = { input: vi.fn(), keyframe: vi.fn(), stop: vi.fn(() => { throw new Error('stop boom') }) }
      const streams = new DeviceStreams({ start: () => new Promise((resolve) => { finish = resolve }), send: () => {} })
      streams.view('android:1')
      streams.pause()
      finish(session)
      await flush()
      expect(session.stop).toHaveBeenCalled()
      expect(errorSpy).toHaveBeenCalledWith('devices: a session failed', expect.any(Error))
    } finally {
      errorSpy.mockRestore()
    }
  })

  it('pause() forgets streams in their grace and starts nothing; resume() starts only the viewed ones', async () => {
    const { streams, started } = setup()
    streams.view('android:1')
    streams.view('android:2')
    await flush()
    streams.unview('android:2')
    streams.pause()
    streams.view('android:3')
    await flush()
    expect(started).toHaveLength(2)
    streams.resume()
    await flush()
    expect(started.map((s) => s.id)).toEqual(['android:1', 'android:2', 'android:1', 'android:3'])
  })

  it('resume() gives a stream that was retrying three fresh tries', async () => {
    const { streams, started, attempts } = setup(() => attempts() > 1)
    streams.view('android:1')
    await flush()
    started[0].events.end('gone')
    await vi.advanceTimersByTimeAsync(1000 + 2000) // two failed tries: the next wait would be 5 s
    streams.pause()
    streams.resume()
    await flush()
    const before = attempts()
    await vi.advanceTimersByTimeAsync(1000)
    expect(attempts()).toBe(before + 1)
  })

  it('a viewer joining a retry wait waits for it; retry() only acts on an error', async () => {
    const { streams, started, sent } = setup()
    streams.view('android:1')
    await flush()
    streams.retry('android:1')
    started[0].events.end('gone')
    const before = sent.length
    streams.view('android:1')
    streams.retry('android:1')
    expect(sent.slice(before)).toEqual([['android:1', { type: 'state', state: 'reconnecting' }]])
    expect(started).toHaveLength(1)
    await vi.advanceTimersByTimeAsync(1000)
    expect(started).toHaveLength(2)
  })

  it('a viewer joining an error is told it; a stream that broke gets no input; no retry() while paused', async () => {
    let failing = false
    const { streams, started, sent, attempts } = setup(() => failing)
    streams.view('android:1')
    await flush()
    failing = true
    started[0].events.end('gone')
    streams.input('android:1', { type: 'text', text: 'b' })
    streams.keyframe('android:1')
    expect(started[0].session.input).not.toHaveBeenCalled()
    expect(started[0].session.keyframe).not.toHaveBeenCalled()
    await vi.advanceTimersByTimeAsync(1000 + 2000 + 5000)
    const before = sent.length
    streams.view('android:1')
    expect(sent.slice(before)).toEqual([['android:1', { type: 'state', state: 'error', message: 'device offline' }]])
    streams.pause()
    const tries = attempts()
    streams.retry('android:1')
    expect(attempts()).toBe(tries)
  })

  it('a stream nobody views that breaks is forgotten at once', async () => {
    const { streams, started, sent } = setup()
    streams.view('android:1')
    await flush()
    started[0].events.packet(frame)
    streams.unview('android:1')
    const before = sent.length
    started[0].events.end('gone')
    await vi.advanceTimersByTimeAsync(60_000)
    expect(sent).toHaveLength(before)
    expect(started).toHaveLength(1)
  })

  it('an unview too many changes nothing', async () => {
    const { streams, started } = setup()
    streams.unview('android:1')
    streams.view('android:1')
    await flush()
    streams.unview('android:1')
    streams.unview('android:1')
    streams.view('android:1')
    streams.unview('android:1')
    await vi.advanceTimersByTimeAsync(10_000)
    expect(started[0].session.stop).toHaveBeenCalled()
  })

  it('the grace is 10 s to the millisecond', async () => {
    const { streams, started } = setup()
    streams.view('android:1')
    await flush()
    streams.unview('android:1')
    await vi.advanceTimersByTimeAsync(9_999)
    expect(started[0].session.stop).not.toHaveBeenCalled()
    await vi.advanceTimersByTimeAsync(1)
    expect(started[0].session.stop).toHaveBeenCalled()
  })

  it('a session whose input, keyframe and stop all throw is guarded: nothing throws, and a stale session’s end() after stopAll() is ignored', async () => {
    const errorSpy = vi.spyOn(console, 'error').mockImplementation(() => {})
    try {
      const sent: [string, DeviceStreamEvent][] = []
      const session = {
        input: vi.fn(() => { throw new Error('input boom') }),
        keyframe: vi.fn(() => { throw new Error('keyframe boom') }),
        stop: vi.fn(() => { throw new Error('stop boom') }),
      }
      let events!: StreamEvents
      const streams = new DeviceStreams({
        start: async (_id, ev) => {
          events = ev
          return session
        },
        send: (id, event) => sent.push([id, event]),
      })
      streams.view('android:1')
      await flush()
      events.packet(frame) // live, with a session: a second view() below asks it for a key frame

      expect(() => streams.input('android:1', { type: 'text', text: 'a' })).not.toThrow()
      expect(() => streams.keyframe('android:1')).not.toThrow()
      expect(() => streams.view('android:1')).not.toThrow() // a second viewer: asks for a key frame too
      expect(() => streams.stopAll()).not.toThrow()
      expect(session.stop).toHaveBeenCalledTimes(1)

      expect(errorSpy).toHaveBeenCalledTimes(4) // input, keyframe, the second view's keyframe, stop
      for (const call of errorSpy.mock.calls) expect(call).toEqual(['devices: a session failed', expect.any(Error)])

      const before = sent.length
      expect(() => events.end('gone')).not.toThrow() // the stopped session's own news, ignored
      expect(sent).toHaveLength(before)
    } finally {
      errorSpy.mockRestore()
    }
  })
})
