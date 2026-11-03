import { afterEach, beforeEach, describe, expect, it, vi } from 'vitest'
import type { DeviceStreamEvent } from '@shared/types'
import type { ScrcpyEvents } from './android/scrcpy'
import { DeviceStreams } from './streams'

interface Started {
  id: string
  events: ScrcpyEvents
  session: { send: ReturnType<typeof vi.fn>; stop: ReturnType<typeof vi.fn> }
}

function setup(failing: () => boolean = () => false) {
  const started: Started[] = []
  const sent: [string, DeviceStreamEvent][] = []
  const streams = new DeviceStreams({
    start: async (id, events) => {
      if (failing()) throw new Error('device offline')
      const session = { send: vi.fn(), stop: vi.fn() }
      started.push({ id, events, session })
      return session
    },
    send: (id, event) => sent.push([id, event]),
  })
  return { streams, started, sent }
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
    expect(started[0].session.send).toHaveBeenCalledWith(Buffer.from([17]))
    expect(sent.slice(-2)).toEqual([['android:1', { type: 'size', width: 720, height: 1440 }], ['android:1', { type: 'state', state: 'live' }]])

    streams.unview('android:1')
    await vi.advanceTimersByTimeAsync(10_000)
    expect(started[0].session.stop).toHaveBeenCalled()
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

  it('a stream that went live and broke gets three fresh tries', async () => {
    const { streams, started } = setup()
    streams.view('android:1')
    await flush()
    for (let i = 0; i < 4; i++) {
      started[i].events.packet(frame)
      started[i].events.end('gone')
      await vi.advanceTimersByTimeAsync(1000)
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
    streams.input('android:1', Buffer.from([1]))
    streams.view('android:1')
    await flush()
    streams.input('android:1', Buffer.from([2]))
    streams.keyframe('android:1')
    expect(started[0].session.send.mock.calls).toEqual([[Buffer.from([2])], [Buffer.from([17])]])
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
})
