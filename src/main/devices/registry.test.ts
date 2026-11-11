import { describe, expect, it } from 'vitest'
import type { DeviceInfo } from '@shared/types'
import { combineLists } from './registry'

const phone: DeviceInfo = { id: 'android:X1', kind: 'android', name: 'C66', detail: 'Android 13 · USB', state: 'ready' }
const sim: DeviceInfo = { id: 'simulator:U1', kind: 'simulator', name: 'iPhone 17', detail: 'Simulator · iOS 27.0', state: 'ready' }

describe('combineLists', () => {
  it("lists adb's devices, then the simulators, with each source's problem", () => {
    expect(combineLists({ pending: false, devices: [phone], problem: null }, { pending: false, devices: [sim], problem: null }))
      .toEqual({ devices: [phone, sim], problem: null, iosProblem: null, pending: [] })
    expect(combineLists({ pending: false, devices: [], problem: 'no-adb' }, { pending: false, devices: [], problem: 'no-idb' }))
      .toEqual({ devices: [], problem: 'no-adb', iosProblem: 'no-idb', pending: [] })
  })

  it('says which kinds are still pending', () => {
    expect(combineLists({ pending: false, devices: [phone], problem: null }, { pending: true, devices: [], problem: null }).pending).toEqual(['ios'])
    expect(combineLists({ pending: true, devices: [], problem: null }, { pending: false, devices: [sim], problem: null }).pending).toEqual(['android'])
  })
})
