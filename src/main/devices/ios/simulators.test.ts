import { afterEach, beforeEach, describe, expect, it, vi } from 'vitest'
import { readNotifyLine, simulatorDevices, SimulatorTracker, type SimTarget, udidOf } from './simulators'
import { fakeProcess, type FakeProcess } from './test-process'

const sim = (udid: string, name: string, state: string, os = 'iOS 27.0') =>
  ({ udid, name, model: name, state, type: 'Simulator', os_version: os })
const line = (...targets: (object | null)[]) => `${JSON.stringify(targets)}\n`

describe('readNotifyLine', () => {
  it('takes the first line as every simulator, and later lines as changes', () => {
    const first = readNotifyLine(line(sim('A', 'iPhone 17', 'Booted'), sim('B', 'iPad', 'Shutdown')), new Map(), true)!
    expect([...first.keys()]).toEqual(['A', 'B'])
    const next = readNotifyLine(line(sim('B', 'iPad', 'Booted')), first, false)!
    expect(next.get('B')?.state).toBe('Booted')
    expect(next.get('A')?.state).toBe('Booted')
    const again = readNotifyLine(line(sim('C', 'iPhone Air', 'Booted')), next, true)!
    expect([...again.keys()]).toEqual(['C']) // a restarted notifier's first line replaces the rest
  })

  it('ignores devices and odd entries, and says when a line is no list', () => {
    const read = readNotifyLine(line({ udid: 'D', type: 'Device', state: 'Booted' }, null, { type: 'Simulator' }, sim('A', '', 'Booted')), new Map(), true)!
    expect([...read.values()]).toEqual([{ udid: 'A', name: 'A', state: 'Booted', osVersion: 'iOS 27.0' }])
    expect(readNotifyLine('2026-11-10 starting', new Map(), true)).toBeNull()
  })
})

describe('simulatorDevices', () => {
  it('lists the booted ones by name, as devices', () => {
    const targets = new Map<string, SimTarget>([
      ['B', { udid: 'B', name: 'iPhone 18 Pro Max', state: 'Booted', osVersion: 'iOS 27.0' }],
      ['A', { udid: 'A', name: 'iPhone 16', state: 'Booted', osVersion: 'iOS 18.5' }],
      ['C', { udid: 'C', name: 'iPad', state: 'Shutdown', osVersion: 'iOS 27.0' }],
    ])
    expect(simulatorDevices(targets)).toEqual([
      { id: 'simulator:A', kind: 'simulator', name: 'iPhone 16', detail: 'Simulator · iOS 18.5', state: 'ready' },
      { id: 'simulator:B', kind: 'simulator', name: 'iPhone 18 Pro Max', detail: 'Simulator · iOS 27.0', state: 'ready' },
    ])
    expect(udidOf('simulator:A')).toBe('A')
    expect(udidOf('android:A')).toBeNull()
  })
})

describe('SimulatorTracker', () => {
  beforeEach(() => vi.useFakeTimers())
  afterEach(() => vi.useRealTimers())

  function setup() {
    const spawned: FakeProcess[] = []
    const published: string[][] = []
    const failures: [string, boolean][] = []
    const tracker = new SimulatorTracker({
      notify: () => {
        const p = fakeProcess()
        spawned.push(p)
        return p.proc
      },
      publish: (devices) => published.push(devices.map((d) => d.id)),
      failed: (why, listed) => failures.push([why, listed]),
    })
    return { tracker, spawned, published, failures }
  }

  it('publishes after each line, read across chunks', async () => {
    const { tracker, spawned, published } = setup()
    tracker.start()
    const text = line(sim('A', 'iPhone 17', 'Booted')) + line(sim('B', 'iPhone 18', 'Booted'))
    spawned[0].stdout.write(text.slice(0, 20))
    spawned[0].stdout.write(text.slice(20))
    await vi.waitFor(() => expect(published).toEqual([['simulator:A'], ['simulator:A', 'simulator:B']]))
    expect(tracker.booted('B')).toBe(true)
    tracker.stop()
  })

  it('starts the notifier again after 1 s, then 2 s, saying why, and stops for good', async () => {
    const { tracker, spawned, failures } = setup()
    tracker.start()
    spawned[0].stderr.write('Error: CoreSimulator is broken\n')
    spawned[0].exit(1)
    await vi.advanceTimersByTimeAsync(0)
    expect(failures).toEqual([['Error: CoreSimulator is broken', false]])
    await vi.advanceTimersByTimeAsync(999)
    expect(spawned).toHaveLength(1)
    await vi.advanceTimersByTimeAsync(1)
    expect(spawned).toHaveLength(2)
    spawned[1].stdout.write(line(sim('A', 'iPhone 17', 'Booted')))
    spawned[1].exit(1)
    await vi.advanceTimersByTimeAsync(0)
    expect(failures[1]).toEqual(['idb_companion stopped.', true])
    await vi.advanceTimersByTimeAsync(2000)
    expect(spawned).toHaveLength(3)
    tracker.stop()
    expect(spawned[2].killed()).toBe(true)
    await vi.advanceTimersByTimeAsync(60_000)
    expect(spawned).toHaveLength(3)
  })
})
