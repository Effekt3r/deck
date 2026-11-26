import { describe, expect, it } from 'vitest'
import type { DeviceInfo, StartableDevice } from '@shared/types'
import { cursorAfter, type MenuEntry, menuEntries, startHint } from './menu'

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

describe('cursorAfter', () => {
  const pixelStart: StartableDevice = { id: 'emulator:Pixel_9', kind: 'emulator', name: 'Pixel 9', detail: 'Emulator' }
  const deviceEntry = (device: DeviceInfo): MenuEntry => ({ key: `device:${device.id}`, type: 'device', device })
  const startEntry = (device: StartableDevice): MenuEntry => ({ key: `start:${device.id}`, type: 'start', device })
  const stopEntry = (device: DeviceInfo): MenuEntry => ({ key: 'stop', type: 'stop', device })

  it('keeps the same key when it still exists', () => {
    expect(cursorAfter([deviceEntry(c66), deviceEntry(emu)], 'device:emulator:Pixel_9')).toBe('device:emulator:Pixel_9')
  })

  it('maps a start entry to its device entry once the device is listed, instead of jumping to the top', () => {
    expect(cursorAfter([deviceEntry(emu)], 'start:emulator:Pixel_9')).toBe('device:emulator:Pixel_9')
  })

  it('maps the other way too: a device that stopped becomes its start entry', () => {
    expect(cursorAfter([startEntry(pixelStart)], 'device:emulator:Pixel_9')).toBe('start:emulator:Pixel_9')
  })

  it("doesn't follow onto Stop, a different entry for the same device already on screen", () => {
    expect(cursorAfter([deviceEntry(emu), stopEntry(emu)], 'device:emulator:Pixel_9')).toBe('device:emulator:Pixel_9')
  })

  it('falls back to null when the device is gone entirely (the caller falls back to the first entry)', () => {
    expect(cursorAfter([deviceEntry(c66)], 'device:emulator:Pixel_9')).toBeNull()
  })

  it('null stays null', () => {
    expect(cursorAfter([deviceEntry(emu)], null)).toBeNull()
  })
})
