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

  it('an unauthorized device counts as the only one that fits', () => {
    const unauth = { ...c66, state: 'unauthorized' as const }
    expect(choosePanel({ ...base, devices: [unauth] })).toEqual({ kind: 'device', device: unauth })
  })
})

describe('panelView', () => {
  it('keeps a device that went away, as gone, for 10 s, then moves on', () => {
    const shown = panelView({ kind: 'device', device: c66 }, [c66, emu], null, 0, null)
    const gone = panelView({ kind: 'device', device: emu }, [emu], shown.held, 1000, null)
    expect(gone.view).toEqual({ kind: 'device', device: c66, gone: true })
    expect(panelView({ kind: 'device', device: emu }, [emu], gone.held, 1000 + GONE_MS - 1, null).view).toEqual({ kind: 'device', device: c66, gone: true })
    expect(panelView({ kind: 'device', device: emu }, [emu], gone.held, 1000 + GONE_MS, null).view).toEqual({ kind: 'device', device: emu, gone: false })
  })

  it('takes the device back when it returns in time', () => {
    const shown = panelView({ kind: 'device', device: c66 }, [c66], null, 0, null)
    const gone = panelView({ kind: 'none' }, [], shown.held, 100, null)
    expect(gone.view).toEqual({ kind: 'device', device: c66, gone: true })
    expect(panelView({ kind: 'device', device: c66 }, [c66], gone.held, 200, null).view).toEqual({ kind: 'device', device: c66, gone: false })
  })

  it('shows a new pick of a connected device at once', () => {
    const shown = panelView({ kind: 'device', device: c66 }, [c66, s25], null, 0, null)
    expect(panelView({ kind: 'device', device: s25 }, [c66, s25], shown.held, 1, null).view).toEqual({ kind: 'device', device: s25, gone: false })
  })

  it('a new pick ends a gone hold: the new device shows at once', () => {
    const shown = panelView({ kind: 'device', device: c66 }, [c66], null, 0, c66.id)
    const gone = panelView({ kind: 'none' }, [], shown.held, 100, c66.id)
    expect(gone.view).toEqual({ kind: 'device', device: c66, gone: true })
    const picked = panelView({ kind: 'device', device: s25 }, [s25], gone.held, 150, s25.id)
    expect(picked.view).toEqual({ kind: 'device', device: s25, gone: false })
  })

  it('a device shown alone stays shown when a second one arrives to choose from', () => {
    const shown = panelView({ kind: 'device', device: c66 }, [c66], null, 0, null)
    const result = panelView({ kind: 'choose', devices: [c66, emu] }, [c66, emu], shown.held, 50, null)
    expect(result.view).toEqual({ kind: 'device', device: c66, gone: false })
  })

  it('a returning device comes back as the fresh object, even with a changed state', () => {
    const shown = panelView({ kind: 'device', device: c66 }, [c66], null, 0, null)
    const gone = panelView({ kind: 'none' }, [], shown.held, 50, null)
    const backC66 = { ...c66, state: 'unauthorized' as const }
    const back = panelView({ kind: 'choose', devices: [backC66, emu] }, [backC66, emu], gone.held, 100, null)
    expect(back.view).toEqual({ kind: 'device', device: backC66, gone: false })
  })
})
