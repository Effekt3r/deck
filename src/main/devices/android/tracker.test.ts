import type { ChildProcess } from 'node:child_process'
import { EventEmitter } from 'node:events'
import { PassThrough } from 'node:stream'
import { afterEach, describe, expect, it, vi } from 'vitest'
import type { DeviceInfo } from '@shared/types'
import type { Identity } from './devices'
import { AndroidTracker } from './tracker'

type FakeChild = ChildProcess & { stdout: PassThrough; stderr: PassThrough; kill: ReturnType<typeof vi.fn> }

/** `adb track-devices`: emitting on its streams directly keeps the tests in step. */
function fakeChild(): FakeChild {
  const child = Object.assign(new EventEmitter(), { stdout: new PassThrough(), stderr: new PassThrough() })
  return Object.assign(child, { kill: vi.fn(() => child.emit('close', null)) }) as unknown as FakeChild
}

const frame = (text: string) => Buffer.from(Buffer.byteLength(text).toString(16).padStart(4, '0') + text)
const C66 = '8d2e61a device usb:34603008X product:C66 model:C66 device:C66 transport_id:1\n'
const c66: Identity = { serialNo: '8d2e61a', maker: 'CHAINWAY', model: 'C66', release: '13', avd: '', name: 'C66', booted: true }

function setup(identify: (serial: string) => Promise<Identity>, publish?: (devices: DeviceInfo[], error: string | null) => void) {
  const children: FakeChild[] = []
  const published: { devices: DeviceInfo[]; error: string | null }[] = []
  const tracker = new AndroidTracker({
    track: () => {
      const child = fakeChild()
      children.push(child)
      return child
    },
    identify,
    publish: publish ?? ((devices, error) => published.push({ devices, error })),
    retryMs: { identity: 10, booting: 10, restartMin: 20, restartMax: 80 },
  })
  return { tracker, children, published }
}

afterEach(() => {
  vi.useRealTimers()
})

describe('AndroidTracker', () => {
  it('lists a device once it has said what it is, and finds its adb name', async () => {
    const { tracker, children, published } = setup(async () => c66)
    tracker.start()
    children[0].stdout.emit('data', frame(C66))
    await vi.waitFor(() => expect(published.at(-1)?.devices.map((d) => d.name)).toEqual(['C66']))
    // Never listed under a stand-in name first.
    expect(published.every((p) => p.devices.every((d) => d.name === 'C66'))).toBe(true)
    expect(tracker.serialFor('android:8d2e61a')).toBe('8d2e61a')
    tracker.stop()
  })

  it("asks three times, then lists the device as adb names it", async () => {
    const identify = vi.fn(async (): Promise<Identity> => {
      throw new Error('closed')
    })
    const { tracker, children, published } = setup(identify)
    tracker.start()
    children[0].stdout.emit('data', frame(C66))
    await vi.waitFor(() => expect(published.at(-1)?.devices.map((d) => d.id)).toEqual(['android:8d2e61a']))
    expect(identify).toHaveBeenCalledTimes(3)
    tracker.stop()
  })

  it('asks a phone that is still starting up again until it has booted', async () => {
    const answers: Identity[] = [{ ...c66, name: '', booted: false }, c66]
    const { tracker, children, published } = setup(async () => answers.shift() ?? c66)
    tracker.start()
    children[0].stdout.emit('data', frame(C66))
    await vi.waitFor(() => expect(published.at(-1)?.devices.map((d) => d.name)).toEqual(['C66']))
    // Named by maker and model until Android had started.
    expect(published.map((p) => p.devices[0]?.name)).toContain('CHAINWAY C66')
    tracker.stop()
  })

  it("starts again after adb's server goes away, waiting longer each time, and says why", () => {
    vi.useFakeTimers()
    const { tracker, children, published } = setup(async () => c66)
    tracker.start()
    children[0].stderr.emit('data', Buffer.from('error: cannot connect to daemon\n'))
    children[0].emit('close', 1)
    expect(published.at(-1)).toEqual({ devices: [], error: 'error: cannot connect to daemon' })
    vi.advanceTimersByTime(19)
    expect(children).toHaveLength(1)
    vi.advanceTimersByTime(1)
    expect(children).toHaveLength(2)
    children[1].emit('close', 1)
    vi.advanceTimersByTime(39)
    expect(children).toHaveLength(2)
    vi.advanceTimersByTime(1)
    expect(children).toHaveLength(3)
    tracker.stop()
  })

  it('stop() ends track-devices for good', () => {
    vi.useFakeTimers()
    const { tracker, children } = setup(async () => c66)
    tracker.start()
    tracker.stop()
    expect(children[0].kill).toHaveBeenCalled()
    vi.advanceTimersByTime(1000)
    expect(children).toHaveLength(1)
  })

  it("doesn't mistake adb's own start-up chatter for an error once a list arrives", () => {
    vi.useFakeTimers()
    const { tracker, children, published } = setup(async () => c66)
    tracker.start()
    children[0].stderr.emit('data', Buffer.from('* daemon not running; starting now at tcp:5037\n* daemon started successfully\n'))
    children[0].stdout.emit('data', frame(''))
    children[0].emit('close', 0)
    expect(published.at(-1)?.error).toBe("adb's server stopped.")
    tracker.stop()
  })

  it("uses adb's own error line over a generic exit message", () => {
    vi.useFakeTimers()
    const { tracker, children, published } = setup(async () => c66)
    tracker.start()
    children[0].stderr.emit('data', Buffer.from("error: protocol fault (couldn't read status): Connection reset by peer\n"))
    children[0].emit('close', 1)
    expect(published.at(-1)?.error).toBe("error: protocol fault (couldn't read status): Connection reset by peer")
    tracker.stop()
  })

  it('backs off further only while restarts keep failing fast, and resets once one lasts', async () => {
    vi.useFakeTimers()
    const { tracker, children } = setup(async () => c66)
    tracker.start()

    // Each child lists (adb sends the current snapshot as soon as it connects) then closes at
    // once: the list must not be mistaken for a run worth resetting the backoff over.
    children[0].stdout.emit('data', frame(''))
    children[0].emit('close', 1)
    await vi.advanceTimersByTimeAsync(19)
    expect(children).toHaveLength(1)
    await vi.advanceTimersByTimeAsync(1)
    expect(children).toHaveLength(2)

    children[1].stdout.emit('data', frame(''))
    children[1].emit('close', 1)
    await vi.advanceTimersByTimeAsync(39)
    expect(children).toHaveLength(2)
    await vi.advanceTimersByTimeAsync(1)
    expect(children).toHaveLength(3)

    children[2].stdout.emit('data', frame(''))
    children[2].emit('close', 1)
    await vi.advanceTimersByTimeAsync(79)
    expect(children).toHaveLength(3)
    await vi.advanceTimersByTimeAsync(1)
    expect(children).toHaveLength(4)

    children[3].stdout.emit('data', frame(''))
    children[3].emit('close', 1)
    await vi.advanceTimersByTimeAsync(79)
    expect(children).toHaveLength(4)
    await vi.advanceTimersByTimeAsync(1)
    expect(children).toHaveLength(5)

    // This one lives as long as the backoff cap before closing: adb is healthy again, so the next
    // wait resets to the minimum instead of staying capped.
    children[4].stdout.emit('data', frame(''))
    await vi.advanceTimersByTimeAsync(80)
    children[4].emit('close', 1)
    await vi.advanceTimersByTimeAsync(19)
    expect(children).toHaveLength(5)
    await vi.advanceTimersByTimeAsync(1)
    expect(children).toHaveLength(6)

    tracker.stop()
  })

  it('keeps tracking when publish throws, and tries again with the next list', async () => {
    vi.useFakeTimers()
    const errorSpy = vi.spyOn(console, 'error').mockImplementation(() => {})
    const calls: { devices: DeviceInfo[]; error: string | null }[] = []
    let first = true
    const { tracker, children } = setup(async () => c66, (devices, error) => {
      if (first) {
        first = false
        throw new Error('boom')
      }
      calls.push({ devices, error })
    })
    tracker.start()
    children[0].stdout.emit('data', frame(C66))
    expect(errorSpy).toHaveBeenCalledWith('devices: publishing the list failed', expect.any(Error))
    await vi.advanceTimersByTimeAsync(0)
    expect(calls.at(-1)?.devices.map((d) => d.name)).toEqual(['C66'])
    // The throw didn't look like adb dying: no restart.
    expect(children).toHaveLength(1)
    tracker.stop()
    errorSpy.mockRestore()
  })

  it('a re-ask timer orphaned by a restart asks nothing; the restarted list is asked once more', async () => {
    vi.useFakeTimers()
    const identify = vi.fn(async (): Promise<Identity> => ({ ...c66, booted: false }))
    const { tracker, children } = setup(identify)
    tracker.start()
    children[0].stdout.emit('data', frame(C66))
    await vi.advanceTimersByTimeAsync(0)
    expect(identify).toHaveBeenCalledTimes(1)

    // adb's server goes away before the 10 ms booting re-ask fires.
    children[0].emit('close', 1)
    await vi.advanceTimersByTimeAsync(10)
    expect(identify).toHaveBeenCalledTimes(1)

    // The 20 ms restart spawns a new track-devices, which lists the same device again.
    await vi.advanceTimersByTimeAsync(10)
    expect(children).toHaveLength(2)
    children[1].stdout.emit('data', frame(C66))
    expect(identify).toHaveBeenCalledTimes(2)

    await vi.advanceTimersByTimeAsync(0)
    tracker.stop()
  })

  it('keeps a phone listed, as connecting, while its first ask is in flight', async () => {
    vi.useFakeTimers()
    let resolveIdentify: (identity: Identity) => void = () => {}
    const identify = vi.fn(() => new Promise<Identity>((resolve) => { resolveIdentify = resolve }))
    const { tracker, children, published } = setup(identify)
    tracker.start()

    children[0].stdout.emit('data', frame('8d2e61a unauthorized usb:1 transport_id:7\n'))
    expect(published.at(-1)?.devices).toEqual([expect.objectContaining({ id: 'android:8d2e61a', state: 'unauthorized' })])

    children[0].stdout.emit('data', frame('8d2e61a device usb:34603008X product:C66 model:C66 device:C66 transport_id:7\n'))
    expect(published.at(-1)?.devices).toEqual([expect.objectContaining({ id: 'android:8d2e61a', state: 'connecting' })])

    resolveIdentify(c66)
    await vi.advanceTimersByTimeAsync(0)
    expect(published.at(-1)?.devices).toEqual([expect.objectContaining({ id: 'android:8d2e61a', name: 'C66', state: 'ready' })])
    tracker.stop()
  })

  it('keeps a never-before-seen device hidden through its first two failed asks', async () => {
    vi.useFakeTimers()
    const identify = vi.fn(async (): Promise<Identity> => {
      throw new Error('closed')
    })
    const { tracker, children, published } = setup(identify)
    tracker.start()
    children[0].stdout.emit('data', frame(C66))
    await vi.advanceTimersByTimeAsync(0)
    expect(identify).toHaveBeenCalledTimes(1)
    expect(published.at(-1)?.devices).toEqual([])

    await vi.advanceTimersByTimeAsync(10)
    expect(identify).toHaveBeenCalledTimes(2)
    expect(published.at(-1)?.devices).toEqual([])
    tracker.stop()
  })

  it("forgets a device's adb name once it leaves the list, or adb goes away", async () => {
    vi.useFakeTimers()
    const { tracker, children } = setup(async () => c66)
    tracker.start()
    children[0].stdout.emit('data', frame(C66))
    await vi.advanceTimersByTimeAsync(0)
    expect(tracker.serialFor('android:8d2e61a')).toBe('8d2e61a')

    // Unplugged: an empty list.
    children[0].stdout.emit('data', frame(''))
    expect(tracker.serialFor('android:8d2e61a')).toBeUndefined()

    // Plugged back in, then adb's server goes away entirely.
    children[0].stdout.emit('data', frame(C66))
    await vi.advanceTimersByTimeAsync(0)
    expect(tracker.serialFor('android:8d2e61a')).toBe('8d2e61a')
    children[0].emit('close', 1)
    expect(tracker.serialFor('android:8d2e61a')).toBeUndefined()
    tracker.stop()
  })

  it('stop() cancels a pending restart, and a late answer to an ask already in flight publishes nothing', async () => {
    vi.useFakeTimers()
    let resolveIdentify: (identity: Identity) => void = () => {}
    const identify = vi.fn(() => new Promise<Identity>((resolve) => { resolveIdentify = resolve }))
    const { tracker, children, published } = setup(identify)
    tracker.start()
    children[0].stdout.emit('data', frame(C66))
    expect(identify).toHaveBeenCalledTimes(1)

    // adb's server goes away while that ask is still in flight: a restart is now pending too.
    children[0].emit('close', 1)
    expect(vi.getTimerCount()).toBeGreaterThan(0)

    tracker.stop()
    expect(vi.getTimerCount()).toBe(0)

    const before = published.length
    resolveIdentify(c66)
    await vi.advanceTimersByTimeAsync(0)
    expect(published.length).toBe(before)
  })
})
