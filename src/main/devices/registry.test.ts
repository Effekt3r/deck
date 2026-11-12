import { describe, expect, it } from 'vitest'
import type { DeviceInfo } from '@shared/types'
import { combineLists, type IphoneState } from './registry'

const phone: DeviceInfo = { id: 'android:X1', kind: 'android', name: 'C66', detail: 'Android 13 · USB', state: 'ready' }
const emulator: DeviceInfo = { id: 'emulator:Pixel_9', kind: 'emulator', name: 'Pixel 9', detail: 'Emulator · Android 15', state: 'ready' }
const sim: DeviceInfo = { id: 'simulator:U1', kind: 'simulator', name: 'iPhone 17', detail: 'Simulator · iOS 27.0', state: 'ready' }
const iphone: DeviceInfo = { id: 'iphone:C1', kind: 'iphone', name: "Franco's iPhone", detail: 'iPhone · cable · view only', state: 'ready' }
const noIphones: IphoneState = { pending: false, devices: [], problem: null }

describe('combineLists', () => {
  it("lists adb's devices, then the simulators, with each source's problem", () => {
    expect(combineLists({ pending: false, devices: [phone], problem: null }, { pending: false, devices: [sim], problem: null }, noIphones))
      .toEqual({ devices: [phone, sim], problem: null, iosProblem: null, pending: [] })
    expect(combineLists({ pending: false, devices: [], problem: 'no-adb' }, { pending: false, devices: [], problem: 'no-idb' }, noIphones))
      .toEqual({ devices: [], problem: 'no-adb', iosProblem: 'no-idb', pending: [] })
  })

  it('says which kinds are still pending', () => {
    expect(combineLists({ pending: false, devices: [phone], problem: null }, { pending: true, devices: [], problem: null }, noIphones).pending).toEqual(['ios'])
    expect(combineLists({ pending: true, devices: [], problem: null }, { pending: false, devices: [sim], problem: null }, noIphones).pending).toEqual(['android'])
  })

  it('puts iPhones with the phones, before emulators and simulators; iOS waits for them too', () => {
    const iphones: IphoneState = { pending: false, devices: [iphone], problem: null }
    expect(combineLists({ pending: false, devices: [phone, emulator], problem: null }, { pending: false, devices: [sim], problem: null }, iphones).devices)
      .toEqual([phone, iphone, emulator, sim])
    expect(combineLists({ pending: false, devices: [], problem: null }, { pending: false, devices: [sim], problem: null }, { ...iphones, pending: true }).pending)
      .toEqual(['ios'])
  })
})
