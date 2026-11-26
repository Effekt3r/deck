import { describe, expect, it } from 'vitest'
import type { DeviceInfo, StartableDevice } from '@shared/types'
import { menuEntries, startHint } from './menu'

const c66: DeviceInfo = { id: 'android:8d2e61a', kind: 'android', name: 'C66', detail: 'Android 13 · USB', state: 'ready' }
const emu: DeviceInfo = { id: 'emulator:Pixel_9', kind: 'emulator', name: 'Pixel 9', detail: 'Emulator · Android 15', state: 'ready' }
const sim: DeviceInfo = { id: 'simulator:U1', kind: 'simulator', name: 'iPhone 17', detail: 'Simulator · iOS 27.0', state: 'ready' }
const iphone: DeviceInfo = { id: 'iphone:C1', kind: 'iphone', name: "Franco's iPhone", detail: 'iPhone · cable · view only', state: 'ready' }
const avd: StartableDevice = { id: 'emulator:Medium_Phone', kind: 'emulator', name: 'Medium Phone', detail: 'Emulator' }
const shutSim: StartableDevice = { id: 'simulator:U2', kind: 'simulator', name: 'iPhone 17 Pro', detail: 'Simulator · iOS 27.0' }

describe('menuEntries', () => {
  it('lists the devices, then what can be started, then Stop for an emulator or simulator on screen', () => {
    expect(menuEntries([c66, emu], [avd, shutSim], emu).map((e) => e.key)).toEqual([
      'device:android:8d2e61a',
      'device:emulator:Pixel_9',
      'start:emulator:Medium_Phone',
      'start:simulator:U2',
      'stop',
    ])
    expect(menuEntries([sim], [], sim).at(-1)).toEqual({ key: 'stop', type: 'stop', device: sim })
  })

  it('has no Stop for a phone or an iPhone, nor with nothing on screen', () => {
    expect(menuEntries([c66], [avd], c66).map((e) => e.type)).toEqual(['device', 'start'])
    expect(menuEntries([iphone], [], iphone).map((e) => e.type)).toEqual(['device'])
    expect(menuEntries([emu], [], null).map((e) => e.type)).toEqual(['device'])
  })
})

describe('startHint', () => {
  it('says starting, that it failed, or what it is', () => {
    expect(startHint({ ...avd, starting: true })).toBe('starting…')
    expect(startHint({ ...avd, error: 'The emulator stopped (exit code 1).' })).toBe("didn't start")
    expect(startHint(shutSim)).toBe('Simulator · iOS 27.0')
  })
})
