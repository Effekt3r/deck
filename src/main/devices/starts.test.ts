import { afterEach, beforeEach, describe, expect, it, vi } from 'vitest'
import type { DeviceInfo, StartableDevice } from '@shared/types'
import { START_DEADLINE_MS, Starts } from './starts'

const pixel: StartableDevice = { id: 'emulator:Pixel_9', kind: 'emulator', name: 'Pixel 9', detail: 'Emulator' }
const medium: StartableDevice = { id: 'emulator:Medium_Phone', kind: 'emulator', name: 'Medium Phone', detail: 'Emulator' }
const iphone: StartableDevice = { id: 'simulator:U1', kind: 'simulator', name: 'iPhone 17', detail: 'Simulator · iOS 27.0' }
const running = (d: StartableDevice): DeviceInfo => ({ id: d.id, kind: d.kind, name: d.name, detail: d.detail, state: 'ready' })

describe('Starts', () => {
  beforeEach(() => vi.useFakeTimers())
  afterEach(() => vi.useRealTimers())

  it('offers what is offered and not running, emulators first, each kind by name', () => {
    const starts = new Starts(() => {})
    expect(starts.merge([iphone, pixel, medium], [])).toEqual([medium, pixel, iphone])
    expect(starts.merge([iphone, pixel, medium], [running(pixel)])).toEqual([medium, iphone])
  })

  it('a start shows as starting, even once no longer offered, until its device is listed', () => {
    const changed = vi.fn()
    const starts = new Starts(changed)
    expect(starts.begin(iphone)).not.toBeNull()
    expect(starts.merge([iphone], [])).toEqual([{ ...iphone, starting: true }])
    // Booting: the notifier no longer says it's shut down, and doesn't list it yet.
    expect(starts.merge([], [])).toEqual([{ ...iphone, starting: true }])
    starts.listed([running(iphone)])
    expect(starts.merge([], [running(iphone)])).toEqual([])
    expect(changed).not.toHaveBeenCalled()
  })

  it('merge stands on its own: a running device is itself, not starting, without a prior listed()', () => {
    const starts = new Starts(() => {})
    starts.begin(pixel)
    expect(starts.merge([], [running(pixel)])).toEqual([])
  })

  it('a second click while it starts does nothing', () => {
    const starts = new Starts(() => {})
    expect(starts.begin(pixel)).not.toBeNull()
    expect(starts.begin(pixel)).toBeNull()
  })

  it("a failed command keeps its reason until the next start, which clears it (Try again)", () => {
    const changed = vi.fn()
    const starts = new Starts(changed)
    const fail = starts.begin(pixel)!
    fail('The emulator stopped (exit code 1).')
    expect(changed).toHaveBeenCalledTimes(1)
    expect(starts.merge([pixel], [])).toEqual([{ ...pixel, error: 'The emulator stopped (exit code 1).' }])
    fail('Said twice.') // only once
    expect(changed).toHaveBeenCalledTimes(1)
    const again = starts.begin(pixel)
    expect(again).not.toBeNull()
    expect(starts.merge([pixel], [])).toEqual([{ ...pixel, starting: true }])
    fail('From the first start.') // the first start's failure can't touch the second
    expect(starts.merge([pixel], [])).toEqual([{ ...pixel, starting: true }])
  })

  it('runs out of time after 3 minutes', () => {
    const changed = vi.fn()
    const starts = new Starts(changed)
    starts.begin(pixel)
    vi.advanceTimersByTime(START_DEADLINE_MS - 1)
    expect(changed).not.toHaveBeenCalled()
    vi.advanceTimersByTime(1)
    expect(changed).toHaveBeenCalledTimes(1)
    expect(starts.merge([pixel], [])).toEqual([{ ...pixel, error: "It didn't start within 3 minutes." }])
  })

  it('says "1 minute" in the singular for a one-minute deadline', () => {
    const changed = vi.fn()
    const starts = new Starts(changed, 60_000)
    starts.begin(pixel)
    vi.advanceTimersByTime(60_000)
    expect(changed).toHaveBeenCalledTimes(1)
    expect(starts.merge([pixel], [])).toEqual([{ ...pixel, error: "It didn't start within 1 minute." }])
  })

  it('sorts within a kind numerically, so "Pixel 9" comes before "Pixel 10"', () => {
    const pixel10: StartableDevice = { id: 'emulator:Pixel_10', kind: 'emulator', name: 'Pixel 10', detail: 'Emulator' }
    const starts = new Starts(() => {})
    expect(starts.merge([pixel10, pixel], [])).toEqual([pixel, pixel10])
  })

  it('a listed device ends its start, failed or not, and its deadline with it', () => {
    const changed = vi.fn()
    const starts = new Starts(changed)
    const fail = starts.begin(pixel)!
    starts.listed([running(pixel)])
    vi.advanceTimersByTime(START_DEADLINE_MS)
    fail('Too late.')
    expect(changed).not.toHaveBeenCalled()
    starts.begin(medium)!('Broken AVD.')
    starts.listed([running(medium)]) // it came up anyway
    expect(starts.merge([], [running(medium)])).toEqual([])
  })

  it('clear() forgets every start and its deadline', () => {
    const changed = vi.fn()
    const starts = new Starts(changed)
    starts.begin(pixel)
    starts.clear()
    vi.advanceTimersByTime(START_DEADLINE_MS)
    expect(changed).not.toHaveBeenCalled()
    expect(starts.merge([], [])).toEqual([])
  })
})
