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

function setup(identify: (serial: string) => Promise<Identity>) {
  const children: FakeChild[] = []
  const published: { devices: DeviceInfo[]; error: string | null }[] = []
  const tracker = new AndroidTracker({
    track: () => {
      const child = fakeChild()
      children.push(child)
      return child
    },
    identify,
    publish: (devices, error) => published.push({ devices, error }),
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
})
