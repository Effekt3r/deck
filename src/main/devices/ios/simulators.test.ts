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

  it('ignores a udid shaped wrong for a socket path or argv', () => {
    // udids go into a gRPC socket's filename and sim-video's argv: only plain, shell-safe ones are
    // trusted. A real UDID is upper-hex with dashes (e.g. "5A2F...-...-..."), so this is generous.
    const read = readNotifyLine(
      line(sim('A1-B2', 'ok', 'Booted'), sim('', 'empty', 'Booted'), sim('../../etc', 'traversal', 'Booted'), sim('A; rm -rf', 'shell', 'Booted'), sim('A B', 'space', 'Booted')),
      new Map(),
      true,
    )!
    expect([...read.keys()]).toEqual(['A1-B2'])
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
    let throwOn = new Set<number>()
    let calls = 0
    const tracker = new SimulatorTracker({
      notify: () => {
        calls++
        if (throwOn.has(calls)) {
          const err = new Error('spawn ENOEXEC') as NodeJS.ErrnoException
          err.code = 'ENOEXEC'
          throw err
        }
        const p = fakeProcess()
        spawned.push(p)
        return p.proc
      },
      publish: (devices) => published.push(devices.map((d) => d.id)),
      failed: (why, listed) => failures.push([why, listed]),
    })
    return { tracker, spawned, published, failures, calls: () => calls, throwOnCall: (...n: number[]) => (throwOn = new Set(n)) }
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
    expect(failures[1]).toEqual(['idb_companion stopped (exit code 1).', true])
    await vi.advanceTimersByTimeAsync(2000)
    expect(spawned).toHaveLength(3)
    tracker.stop()
    expect(spawned[2].killed()).toBe(true)
    await vi.advanceTimersByTimeAsync(60_000)
    expect(spawned).toHaveLength(3)
  })

  describe('a notify() that throws', () => {
    it('is caught at start(): reports a failure and retries after 1 s', async () => {
      const { tracker, spawned, failures, calls, throwOnCall } = setup()
      throwOnCall(1)
      expect(() => tracker.start()).not.toThrow()
      expect(failures).toEqual([['spawn ENOEXEC', false]])
      expect(spawned).toHaveLength(0)
      await vi.advanceTimersByTimeAsync(999)
      expect(calls()).toBe(1)
      await vi.advanceTimersByTimeAsync(1)
      expect(calls()).toBe(2)
      expect(spawned).toHaveLength(1) // the retry spawned fine
      tracker.stop()
    })

    it('a second start() while waiting to retry after a throw is still a no-op', async () => {
      const { tracker, failures, throwOnCall } = setup()
      throwOnCall(1)
      tracker.start()
      expect(() => tracker.start()).not.toThrow()
      expect(failures).toHaveLength(1) // not called twice
      tracker.stop()
    })

    it('is caught on a restart too, and keeps retrying', async () => {
      const { tracker, spawned, failures, throwOnCall } = setup()
      tracker.start()
      expect(spawned).toHaveLength(1)
      throwOnCall(2, 3)
      spawned[0].exit(1)
      await vi.advanceTimersByTimeAsync(0)
      expect(failures).toHaveLength(1)
      await vi.advanceTimersByTimeAsync(1000) // call 2: throws
      expect(failures).toHaveLength(2)
      expect(failures[1]).toEqual(['spawn ENOEXEC', false])
      await vi.advanceTimersByTimeAsync(2000) // call 3: throws
      expect(failures).toHaveLength(3)
      await vi.advanceTimersByTimeAsync(4000) // call 4: spawns fine
      expect(spawned).toHaveLength(2)
      tracker.stop()
    })
  })

  describe('listed is per run', () => {
    it('a run that lists keeps booted() true after it dies; a run that never lists clears it', async () => {
      const { tracker, spawned, failures } = setup()
      tracker.start()
      spawned[0].stdout.write(line(sim('A', 'iPhone 17', 'Booted')))
      expect(tracker.booted('A')).toBe(true)
      spawned[0].exit(1) // run 0 listed before dying
      await vi.advanceTimersByTimeAsync(0)
      expect(failures[0]).toEqual(['idb_companion stopped (exit code 1).', true])
      expect(tracker.booted('A')).toBe(true) // still known: run 0 did list

      await vi.advanceTimersByTimeAsync(1000) // restart: run 1
      spawned[1].exit(1) // run 1 never lists before dying
      await vi.advanceTimersByTimeAsync(0)
      expect(failures[1]).toEqual(['idb_companion stopped (exit code 1).', false])
      expect(tracker.booted('A')).toBe(false) // cleared: run 1 never listed

      await vi.advanceTimersByTimeAsync(2000) // restart: run 2
      spawned[2].exit(1) // also never lists
      await vi.advanceTimersByTimeAsync(0)
      expect(failures[2]).toEqual(['idb_companion stopped (exit code 1).', false])
      expect(tracker.booted('A')).toBe(false)
      tracker.stop()
    })
  })

  describe('restart timing', () => {
    it('doubles the wait up to a 30 s cap: 1, 2, 4, 8, 16, 30, 30', async () => {
      const { tracker, spawned } = setup()
      tracker.start()
      const gaps = [1000, 2000, 4000, 8000, 16_000, 30_000, 30_000]
      for (let i = 0; i < gaps.length; i++) {
        spawned[i].exit(1)
        await vi.advanceTimersByTimeAsync(0)
        expect(spawned).toHaveLength(i + 1)
        await vi.advanceTimersByTimeAsync(gaps[i] - 1)
        expect(spawned).toHaveLength(i + 1) // not yet, one ms early
        await vi.advanceTimersByTimeAsync(1)
        expect(spawned).toHaveLength(i + 2) // right on time
      }
      tracker.stop()
    })

    it('goes back to 1 s after a run survives 30 s', async () => {
      const { tracker, spawned } = setup()
      tracker.start()
      spawned[0].exit(1) // wait: 1000 used, becomes 2000
      await vi.advanceTimersByTimeAsync(0)
      await vi.advanceTimersByTimeAsync(1000) // run 1 starts
      expect(spawned).toHaveLength(2)
      spawned[1].stdout.write(line(sim('A', 'iPhone 17', 'Booted'))) // clears its own 20 s deadline
      await vi.advanceTimersByTimeAsync(30_000) // run 1 survives 30 s
      spawned[1].exit(1)
      await vi.advanceTimersByTimeAsync(0)
      await vi.advanceTimersByTimeAsync(999)
      expect(spawned).toHaveLength(2) // not yet
      await vi.advanceTimersByTimeAsync(1)
      expect(spawned).toHaveLength(3) // back to a 1 s wait, not 4 s
      tracker.stop()
    })

    it('stop() during the restart wait leaves nothing scheduled', async () => {
      const { tracker, spawned } = setup()
      tracker.start()
      spawned[0].exit(1)
      await vi.advanceTimersByTimeAsync(500)
      tracker.stop()
      await vi.advanceTimersByTimeAsync(60_000)
      expect(spawned).toHaveLength(1)
    })
  })

  it("a restarted notifier's first line replaces the old list entirely", async () => {
    const { tracker, spawned, published } = setup()
    tracker.start()
    spawned[0].stdout.write(line(sim('A', 'iPhone 17', 'Booted'), sim('B', 'iPad', 'Booted')))
    expect(tracker.booted('A')).toBe(true)
    expect(tracker.booted('B')).toBe(true)
    spawned[0].exit(1)
    await vi.advanceTimersByTimeAsync(0)
    await vi.advanceTimersByTimeAsync(1000) // restart: run 1
    spawned[1].stdout.write(line(sim('C', 'iPhone Air', 'Booted')))
    expect(tracker.booted('A')).toBe(false)
    expect(tracker.booted('B')).toBe(false)
    expect(tracker.booted('C')).toBe(true)
    expect(published.at(-1)).toEqual(['simulator:C'])
    tracker.stop()
  })

  describe('failure reasons', () => {
    it("uses the spawn error's message (the 'error' event) when there are no last words", async () => {
      const { tracker, spawned, failures } = setup()
      tracker.start()
      const err = Object.assign(new Error('spawn /opt/homebrew/bin/idb_companion EACCES'), { code: 'EACCES' })
      spawned[0].proc.emit('error', err)
      await vi.advanceTimersByTimeAsync(0)
      expect(failures[0]).toEqual(['spawn /opt/homebrew/bin/idb_companion EACCES', false])
      tracker.stop()
    })

    it('falls back to the exit code when there are no last words and no spawn error', async () => {
      const { tracker, spawned, failures } = setup()
      tracker.start()
      spawned[0].exit(7)
      await vi.advanceTimersByTimeAsync(0)
      expect(failures[0]).toEqual(['idb_companion stopped (exit code 7).', false])
      tracker.stop()
    })

    it('falls back to the signal when stopped by one', async () => {
      const { tracker, spawned, failures } = setup()
      tracker.start()
      spawned[0].proc.emit('exit', null, 'SIGSEGV')
      spawned[0].proc.emit('close', null, 'SIGSEGV')
      await vi.advanceTimersByTimeAsync(0)
      expect(failures[0]).toEqual(['idb_companion was stopped (SIGSEGV).', false])
      tracker.stop()
    })

    it('falls back to a generic message for a clean exit with no last words', async () => {
      const { tracker, spawned, failures } = setup()
      tracker.start()
      spawned[0].exit(0)
      await vi.advanceTimersByTimeAsync(0)
      expect(failures[0]).toEqual(['idb_companion stopped.', false])
      tracker.stop()
    })

    it('joins stderr written across chunks before taking its last line', async () => {
      const { tracker, spawned, failures } = setup()
      tracker.start()
      spawned[0].stderr.write('Error: CoreSimul')
      spawned[0].stderr.write('ator is out of date\n')
      spawned[0].exit(1)
      await vi.advanceTimersByTimeAsync(0)
      expect(failures[0][0]).toBe('Error: CoreSimulator is out of date')
      tracker.stop()
    })

    it('caps the reported stderr line at 500 characters', async () => {
      const { tracker, spawned, failures } = setup()
      tracker.start()
      spawned[0].stderr.write(`${'E'.repeat(600)}\n`)
      spawned[0].exit(1)
      await vi.advanceTimersByTimeAsync(0)
      expect(failures[0][0]).toHaveLength(500)
      tracker.stop()
    })
  })

  describe('the first-list deadline', () => {
    it('reports a failure and restarts when no list comes within 20 s', async () => {
      const { tracker, spawned, failures } = setup()
      tracker.start()
      await vi.advanceTimersByTimeAsync(19_999)
      expect(failures).toHaveLength(0)
      expect(spawned[0].killed()).toBe(false)
      await vi.advanceTimersByTimeAsync(1)
      expect(failures).toEqual([['idb_companion listed nothing in 20 s.', false]])
      expect(spawned[0].killed()).toBe(true)
      await vi.advanceTimersByTimeAsync(999)
      expect(spawned).toHaveLength(1)
      await vi.advanceTimersByTimeAsync(1)
      expect(spawned).toHaveLength(2) // restarted
      tracker.stop()
    })

    it('is cleared once a line arrives, however late', async () => {
      const { tracker, spawned, failures } = setup()
      tracker.start()
      await vi.advanceTimersByTimeAsync(19_000)
      spawned[0].stdout.write(line(sim('A', 'iPhone 17', 'Booted')))
      await vi.advanceTimersByTimeAsync(5000) // past the original 20 s mark
      expect(failures).toHaveLength(0)
      expect(spawned[0].killed()).toBe(false)
      tracker.stop()
    })

    it('doubles after each deadline kill, capped at 2 min; a run that lists resets it to 20 s', async () => {
      const { tracker, spawned } = setup()
      tracker.start()
      const schedule = [
        { deadline: 20_000, restartWait: 1000 },
        { deadline: 40_000, restartWait: 2000 },
        { deadline: 80_000, restartWait: 4000 },
        { deadline: 120_000, restartWait: 8000 }, // capped: would double to 160 s
        { deadline: 120_000, restartWait: 16_000 },
      ]
      for (let i = 0; i < schedule.length; i++) {
        const { deadline, restartWait } = schedule[i]
        await vi.advanceTimersByTimeAsync(deadline - 1)
        expect(spawned[i].killed()).toBe(false) // not yet, one ms early
        await vi.advanceTimersByTimeAsync(1) // this run's own deadline fires right on time
        expect(spawned[i].killed()).toBe(true)
        await vi.advanceTimersByTimeAsync(restartWait)
        expect(spawned).toHaveLength(i + 2)
      }
      // The newest run lists: the deadline resets to 20 s for whatever comes after it, not 120 s.
      const listedIndex = schedule.length
      spawned[listedIndex].stdout.write(line(sim('A', 'iPhone 17', 'Booted')))
      spawned[listedIndex].exit(1)
      await vi.advanceTimersByTimeAsync(0)
      await vi.advanceTimersByTimeAsync(30_000) // its own restart wait, capped by now
      expect(spawned).toHaveLength(listedIndex + 2)
      await vi.advanceTimersByTimeAsync(19_999)
      expect(spawned.at(-1)!.killed()).toBe(false) // back to a 20 s deadline, not 120 s
      await vi.advanceTimersByTimeAsync(1)
      expect(spawned.at(-1)!.killed()).toBe(true)
      tracker.stop()
    })
  })

  describe('a notifier that ignores SIGTERM (idb_companion handles it on a dispatch queue)', () => {
    it('is escalated to SIGKILL 2 s after the deadline kill', async () => {
      const spawned: FakeProcess[] = []
      const closed: boolean[] = []
      const tracker = new SimulatorTracker({
        notify: () => {
          const p = fakeProcess({ ignoreSigterm: true })
          const i = spawned.length
          closed.push(false)
          p.proc.on('close', () => {
            closed[i] = true
          })
          spawned.push(p)
          return p.proc
        },
        publish: () => {},
        failed: () => {},
      })
      tracker.start()
      await vi.advanceTimersByTimeAsync(20_000) // the deadline fires, sends SIGTERM (ignored)
      expect(closed[0]).toBe(false)
      await vi.advanceTimersByTimeAsync(1999)
      expect(closed[0]).toBe(false) // still not, one ms early
      await vi.advanceTimersByTimeAsync(1) // 2 s after the deadline's kill(): SIGKILL
      // A setImmediate scheduled from inside a setTimeout that advanceTimersByTimeAsync just fired
      // isn't flushed by a further (0) advance, only a non-zero one.
      await vi.advanceTimersByTimeAsync(1)
      expect(closed[0]).toBe(true)
      tracker.stop()
    })

    it('is escalated to SIGKILL 2 s after stop()', async () => {
      const spawned: FakeProcess[] = []
      const closed: boolean[] = []
      const tracker = new SimulatorTracker({
        notify: () => {
          const p = fakeProcess({ ignoreSigterm: true })
          closed.push(false)
          p.proc.on('close', () => {
            closed[0] = true
          })
          spawned.push(p)
          return p.proc
        },
        publish: () => {},
        failed: () => {},
      })
      tracker.start()
      spawned[0].stdout.write(line(sim('A', 'iPhone 17', 'Booted')))
      tracker.stop() // sends SIGTERM (ignored); must not throw, and must still schedule the SIGKILL
      expect(closed[0]).toBe(false)
      await vi.advanceTimersByTimeAsync(1999)
      expect(closed[0]).toBe(false)
      await vi.advanceTimersByTimeAsync(1)
      // A setImmediate scheduled from inside a setTimeout that advanceTimersByTimeAsync just fired
      // isn't flushed by a further (0) advance, only a non-zero one.
      await vi.advanceTimersByTimeAsync(1)
      expect(closed[0]).toBe(true)
    })

    it('does not pile up: a 10 min run of nothing-but-hangs leaves nothing alive after stop()', async () => {
      // Mirrors the reviewer's probe (D1), which found 15 notifiers still alive this way before the
      // fix: with no escalation, kill() alone never stops a notifier stuck ignoring SIGTERM.
      const closed: boolean[] = []
      let spawnCount = 0
      const tracker = new SimulatorTracker({
        notify: () => {
          const p = fakeProcess({ ignoreSigterm: true })
          const i = spawnCount++
          closed.push(false)
          p.proc.on('close', () => {
            closed[i] = true
          })
          return p.proc
        },
        publish: () => {},
        failed: () => {},
      })
      tracker.start()
      await vi.advanceTimersByTimeAsync(10 * 60_000)
      tracker.stop()
      await vi.advanceTimersByTimeAsync(60_000) // grace for the last SIGKILL to land
      expect(spawnCount).toBeGreaterThan(1) // several hang/restart cycles happened
      expect(closed.filter((c) => !c)).toHaveLength(0) // none left running
    })
  })

  describe('guards', () => {
    it('a throwing publish or failed is console.error-ed, and tracking goes on', async () => {
      const errors: unknown[] = []
      const originalError = console.error
      console.error = ((...args: unknown[]) => {
        errors.push(args)
      }) as typeof console.error
      try {
        const spawned: FakeProcess[] = []
        const tracker = new SimulatorTracker({
          notify: () => {
            const p = fakeProcess()
            spawned.push(p)
            return p.proc
          },
          publish: () => {
            throw new Error('boom publish')
          },
          failed: () => {
            throw new Error('boom failed')
          },
        })
        tracker.start()
        spawned[0].stdout.write(line(sim('A', 'iPhone 17', 'Booted')))
        expect(tracker.booted('A')).toBe(true) // internal state still updates despite publish throwing
        spawned[0].exit(1) // failed() throws here, but the restart must still be scheduled
        await vi.advanceTimersByTimeAsync(0)
        await vi.advanceTimersByTimeAsync(1000)
        expect(spawned).toHaveLength(2)
        expect(errors.length).toBeGreaterThanOrEqual(2)
        tracker.stop()
      } finally {
        console.error = originalError
      }
    })
  })
})
