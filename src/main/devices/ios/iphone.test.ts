import { afterEach, beforeEach, describe, expect, it, vi } from 'vitest'
import { iphoneDevices, iphoneIo, IphoneTracker, readScreenList, screenIdOf } from './iphone'
import { fakeProcess, type FakeProcess } from './test-process'

// Made-up capture device IDs: the real ones are UUIDs.
const A = '0A0A0A0A-1111-2222-3333-444444444444'
const B = 'B0B0B0B0-1111-2222-3333-444444444444'
const list = (...devices: unknown[]) => `${JSON.stringify({ devices })}\n`

describe('readScreenList', () => {
  it('reads every screen on offer, once each, and says when a line is no list', () => {
    expect(readScreenList(list({ id: A, name: "Franco's iPhone" }, { id: B, name: 'iPad' }, { id: A, name: 'again' })))
      .toEqual([{ id: A, name: 'again' }, { id: B, name: 'iPad' }])
    expect(readScreenList(list())).toEqual([])
    expect(readScreenList('not json')).toBeNull()
    expect(readScreenList('[]')).toBeNull()
    expect(readScreenList('null')).toBeNull()
  })

  it('skips IDs that could pass for an option or a path, and names a nameless screen', () => {
    expect(readScreenList(list({ id: '--max-size' }, { id: '../x' }, { id: 'a b' }, { id: 7 }, null, { id: A, name: ' ' })))
      .toEqual([{ id: A, name: 'iPhone' }])
  })
})

describe('iphoneDevices', () => {
  it('lists the screens by name, on a cable, view only', () => {
    expect(iphoneDevices([{ id: B, name: 'iPhone 17 Pro' }, { id: A, name: "Franco's iPhone" }])).toEqual([
      { id: `iphone:${A}`, kind: 'iphone', name: "Franco's iPhone", detail: 'iPhone · cable · view only', state: 'ready' },
      { id: `iphone:${B}`, kind: 'iphone', name: 'iPhone 17 Pro', detail: 'iPhone · cable · view only', state: 'ready' },
    ])
    expect(screenIdOf(`iphone:${A}`)).toBe(A)
    expect(screenIdOf('simulator:U1')).toBeNull()
  })
})

describe('IphoneTracker', () => {
  beforeEach(() => vi.useFakeTimers())
  afterEach(() => vi.useRealTimers())

  function setup() {
    const spawned: FakeProcess[] = []
    const published: string[][] = []
    const failures: [string, boolean][] = []
    const tracker = new IphoneTracker({
      list: () => {
        const p = fakeProcess()
        spawned.push(p)
        return p.proc
      },
      publish: (devices) => published.push(devices.map((d) => d.id)),
      failed: (why, listed) => failures.push([why, listed]),
    })
    return { tracker, spawned, published, failures }
  }

  it('publishes every list, read across chunks, and knows which screens are on offer', async () => {
    const { tracker, spawned, published } = setup()
    tracker.start()
    const text = list({ id: A, name: "Franco's iPhone" }) + list()
    spawned[0].stdout.write(text.slice(0, 30))
    spawned[0].stdout.write(text.slice(30, -3))
    await vi.waitFor(() => expect(published).toEqual([[`iphone:${A}`]]))
    expect(tracker.has(A)).toBe(true)
    spawned[0].stdout.write(text.slice(-3))
    await vi.waitFor(() => expect(published).toEqual([[`iphone:${A}`], []]))
    expect(tracker.has(A)).toBe(false)
    tracker.stop()
    expect(spawned[0].killed()).toBe(true)
  })

  it('starts the helper again after 1 s; a run that never listed forgets the screens', async () => {
    const { tracker, spawned, failures } = setup()
    tracker.start()
    spawned[0].stdout.write(list({ id: A, name: 'iPhone' }))
    spawned[0].exit(1)
    await vi.advanceTimersByTimeAsync(0)
    expect(failures).toEqual([['iphone-screen stopped (exit code 1).', true]])
    expect(tracker.has(A)).toBe(true) // a run that listed: its list stands until the next
    await vi.advanceTimersByTimeAsync(1000)
    expect(spawned).toHaveLength(2)
    spawned[1].stderr.write('{"error":"capture","message":"CoreMediaIO failed."}\n')
    spawned[1].exit(1)
    await vi.advanceTimersByTimeAsync(0)
    expect(failures[1]).toEqual(['{"error":"capture","message":"CoreMediaIO failed."}', false])
    expect(tracker.has(A)).toBe(false)
    tracker.stop()
  })
})

describe('iphoneIo', () => {
  it('runs the helper with stdin kept open: list, and stream at 1600 px and 60 frames a second', () => {
    const calls: unknown[][] = []
    const io = iphoneIo('/Deck.app/Contents/Resources/iphone-screen', {
      spawn: (command, args, options) => {
        calls.push([command, args, options.stdio])
        return fakeProcess().proc
      },
    })
    io.list()
    io.stream(A)
    expect(calls).toEqual([
      ['/Deck.app/Contents/Resources/iphone-screen', ['list'], ['pipe', 'pipe', 'pipe']],
      ['/Deck.app/Contents/Resources/iphone-screen', ['stream', A, '--max-size', '1600', '--max-fps', '60'], ['pipe', 'pipe', 'pipe']],
    ])
  })
})
