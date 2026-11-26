import { afterEach, beforeEach, describe, expect, it, vi } from 'vitest'
import { LineTracker } from './tracker'
import { fakeProcess, type FakeProcess } from './test-process'

/** A trivial parser for these tests: a line is a list of one iff it starts with "L". Good enough to
 *  exercise LineTracker's own machinery without any of a real caller's parsing rules. */
const parse = (line: string): string | null => (line.startsWith('L') ? line : null)

describe('LineTracker', () => {
  beforeEach(() => vi.useFakeTimers())
  afterEach(() => vi.useRealTimers())

  function setup() {
    const spawned: FakeProcess[] = []
    const published: string[] = []
    const failures: [string, boolean][] = []
    const tracker = new LineTracker<string>({
      name: 'thing',
      spawn: () => {
        const p = fakeProcess()
        spawned.push(p)
        return p.proc
      },
      parse: (line) => parse(line),
      publish: (list) => published.push(list),
      failed: (why, listed) => failures.push([why, listed]),
    })
    return { tracker, spawned, published, failures }
  }

  it('publishes a parsed line and ignores one that is not a list', async () => {
    const { tracker, spawned, published } = setup()
    tracker.start()
    spawned[0].stdout.write('chatter\nL1\n')
    await vi.advanceTimersByTimeAsync(0)
    expect(published).toEqual(['L1'])
    tracker.stop()
  })

  it('a line that is not a list neither counts as listed nor clears the first-list deadline: a run of only such lines is still killed at the deadline', async () => {
    const { tracker, spawned, failures } = setup()
    tracker.start()
    await vi.advanceTimersByTimeAsync(19_000)
    spawned[0].stdout.write('chatter\nmore chatter\n')
    await vi.advanceTimersByTimeAsync(999)
    expect(spawned[0].killed()).toBe(false) // not yet, one ms early
    await vi.advanceTimersByTimeAsync(1)
    expect(spawned[0].killed()).toBe(true)
    expect(failures).toEqual([['thing listed nothing in 20 s.', false]]) // never listed, either
    tracker.stop()
  })

  it('a parse that throws is logged and does not stop the tracker: a later line still gets through', async () => {
    const errors: unknown[] = []
    const originalError = console.error
    console.error = ((...args: unknown[]) => {
      errors.push(args)
    }) as typeof console.error
    try {
      const spawned: FakeProcess[] = []
      const published: string[] = []
      const tracker = new LineTracker<string>({
        name: 'thing',
        spawn: () => {
          const p = fakeProcess()
          spawned.push(p)
          return p.proc
        },
        parse: (line) => {
          if (line === 'boom') throw new Error('bad line')
          return parse(line)
        },
        publish: (list) => published.push(list),
        failed: () => {},
      })
      tracker.start()
      spawned[0].stdout.write('boom\nL1\n')
      await vi.advanceTimersByTimeAsync(0)
      expect(published).toEqual(['L1']) // the line after the throw still gets through
      expect(errors).toHaveLength(1) // the throw was logged, not left uncaught
      tracker.stop()
    } finally {
      console.error = originalError
    }
  })

  it("a stop()+start() from inside publish() stops the rest of that chunk from reaching the old run, so a hung new run's deadline still kills it", async () => {
    const spawned: FakeProcess[] = []
    const tracker: LineTracker<string> = new LineTracker<string>({
      name: 'thing',
      spawn: () => {
        const p = fakeProcess()
        spawned.push(p)
        return p.proc
      },
      parse: (line) => parse(line),
      publish: (list) => {
        // The first list of the first run restarts the tracker synchronously, as a caller reacting
        // to a published list might. "L2", right behind it in the same chunk, belongs to a run
        // that's already over by the time the loop gets to it.
        if (list === 'L1' && spawned.length === 1) {
          tracker.stop()
          tracker.start()
        }
      },
      failed: () => {},
    })
    tracker.start()
    spawned[0].stdout.write('L1\nL2\n')
    await vi.advanceTimersByTimeAsync(0)
    expect(spawned).toHaveLength(2) // start() spawned the second run synchronously
    await vi.advanceTimersByTimeAsync(20_000) // the new run's own first-list deadline
    expect(spawned[1].killed()).toBe(true) // "L2" must not have cleared it on its way to nowhere
    tracker.stop()
  })
})
