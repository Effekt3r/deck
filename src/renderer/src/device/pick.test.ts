import { describe, expect, it } from 'vitest'
import type { DeviceInfo } from '@shared/types'
import { choosePanel, GONE_MS, panelView } from './pick'

const device = (id: string, name: string): DeviceInfo => ({ id, kind: id.startsWith('emulator:') ? 'emulator' : 'android', name, detail: '', state: 'ready' })
const c66 = device('android:8d2e61a', 'C66')
const s25 = device('android:R5CW20XY7QZ', "Franco's S25 FE")
const emu = device('emulator:Pixel_9', 'Pixel 9')

describe('choosePanel', () => {
  const base = { tab: undefined, project: null, android: true, byHand: false }

  it("shows the tab's pick, else the project's, while connected", () => {
    expect(choosePanel({ ...base, tab: s25.id, project: c66.id, devices: [c66, s25] })).toEqual({ kind: 'device', device: s25 })
    expect(choosePanel({ ...base, tab: s25.id, project: c66.id, devices: [c66] })).toEqual({ kind: 'device', device: c66 })
  })

  it('shows the only device that fits, asks among several, and shows nothing without one', () => {
    expect(choosePanel({ ...base, devices: [emu] })).toEqual({ kind: 'device', device: emu })
    expect(choosePanel({ ...base, devices: [c66, s25, emu] })).toEqual({ kind: 'choose', devices: [c66, s25, emu] })
    expect(choosePanel({ ...base, devices: [] })).toEqual({ kind: 'none' })
  })

  it('outside an Android app: only when asked for, or when the project picked a device', () => {
    expect(choosePanel({ ...base, android: false, devices: [c66] })).toEqual({ kind: 'none' })
    expect(choosePanel({ ...base, android: false, byHand: true, devices: [c66] })).toEqual({ kind: 'device', device: c66 })
    expect(choosePanel({ ...base, android: false, project: c66.id, devices: [c66, s25] })).toEqual({ kind: 'device', device: c66 })
  })
})

describe('panelView', () => {
  it('keeps a device that went away, as gone, for 10 s, then moves on', () => {
    const shown = panelView({ kind: 'device', device: c66 }, [c66, emu], null, 0)
    const gone = panelView({ kind: 'device', device: emu }, [emu], shown.held, 1000)
    expect(gone.view).toEqual({ kind: 'device', device: c66, gone: true })
    expect(panelView({ kind: 'device', device: emu }, [emu], gone.held, 1000 + GONE_MS - 1).view).toEqual({ kind: 'device', device: c66, gone: true })
    expect(panelView({ kind: 'device', device: emu }, [emu], gone.held, 1000 + GONE_MS).view).toEqual({ kind: 'device', device: emu, gone: false })
  })

  it('takes the device back when it returns in time', () => {
    const shown = panelView({ kind: 'device', device: c66 }, [c66], null, 0)
    const gone = panelView({ kind: 'none' }, [], shown.held, 100)
    expect(gone.view).toEqual({ kind: 'device', device: c66, gone: true })
    expect(panelView({ kind: 'device', device: c66 }, [c66], gone.held, 200).view).toEqual({ kind: 'device', device: c66, gone: false })
  })

  it('shows a new pick of a connected device at once', () => {
    const shown = panelView({ kind: 'device', device: c66 }, [c66, s25], null, 0)
    expect(panelView({ kind: 'device', device: s25 }, [c66, s25], shown.held, 1).view).toEqual({ kind: 'device', device: s25, gone: false })
  })
})
