import { describe, expect, it } from 'vitest'
import type { DeviceInfo, DeviceList } from '@shared/types'
import { choosePanel, GONE_MS, menuOrder, panelView, stillLooking } from './pick'

const device = (id: string, name: string): DeviceInfo => ({ id, kind: id.startsWith('emulator:') ? 'emulator' : 'android', name, detail: '', state: 'ready' })
const c66 = device('android:8d2e61a', 'C66')
const s25 = device('android:R5CW20XY7QZ', "Franco's S25 FE")
const emu = device('emulator:Pixel_9', 'Pixel 9')
const sim: DeviceInfo = { id: 'simulator:U1', kind: 'simulator', name: 'iPhone 17', detail: 'Simulator · iOS 27.0', state: 'ready' }

describe('choosePanel', () => {
  const base = { tab: undefined, project: [] as string[], android: true, ios: false, byHand: false }

  it("shows the tab's pick, else the latest of the project's that's connected", () => {
    expect(choosePanel({ ...base, tab: s25.id, project: [c66.id], devices: [c66, s25] })).toEqual({ kind: 'device', device: s25 })
    expect(choosePanel({ ...base, tab: s25.id, project: [c66.id], devices: [c66] })).toEqual({ kind: 'device', device: c66 })
    expect(choosePanel({ ...base, project: [emu.id, s25.id], devices: [c66, s25, emu] })).toEqual({ kind: 'device', device: emu })
    expect(choosePanel({ ...base, project: [emu.id, s25.id], devices: [c66, s25] })).toEqual({ kind: 'device', device: s25 })
  })

  it("once a project has picked, none of its own connected means no panel: another project's device never opens it", () => {
    expect(choosePanel({ ...base, project: [c66.id], devices: [s25] })).toEqual({ kind: 'none' })
    expect(choosePanel({ ...base, project: [c66.id], devices: [s25, emu] })).toEqual({ kind: 'none' })
    expect(choosePanel({ ...base, tab: c66.id, devices: [s25] })).toEqual({ kind: 'none' })
  })

  it('shown by hand, every device fits, whatever the project picked', () => {
    expect(choosePanel({ ...base, project: [c66.id], byHand: true, devices: [s25] })).toEqual({ kind: 'device', device: s25 })
    expect(choosePanel({ ...base, project: [c66.id], byHand: true, devices: [s25, emu] })).toEqual({ kind: 'choose', devices: [s25, emu] })
    expect(choosePanel({ ...base, project: [c66.id], byHand: true, devices: [s25, c66] })).toEqual({ kind: 'device', device: c66 })
  })

  it('shows the only device that fits, asks among several, and shows nothing without one', () => {
    expect(choosePanel({ ...base, devices: [emu] })).toEqual({ kind: 'device', device: emu })
    expect(choosePanel({ ...base, devices: [c66, s25, emu] })).toEqual({ kind: 'choose', devices: [c66, s25, emu] })
    expect(choosePanel({ ...base, devices: [] })).toEqual({ kind: 'none' })
  })

  it('outside an Android app: only when asked for, or when the project picked a device', () => {
    expect(choosePanel({ ...base, android: false, devices: [c66] })).toEqual({ kind: 'none' })
    expect(choosePanel({ ...base, android: false, byHand: true, devices: [c66] })).toEqual({ kind: 'device', device: c66 })
    expect(choosePanel({ ...base, android: false, project: [c66.id], devices: [c66, s25] })).toEqual({ kind: 'device', device: c66 })
  })

  it('an unauthorized device counts as the only one that fits', () => {
    const unauth = { ...c66, state: 'unauthorized' as const }
    expect(choosePanel({ ...base, devices: [unauth] })).toEqual({ kind: 'device', device: unauth })
  })

  it('fits devices by platform: phones and emulators to an Android app, simulators to an iOS one', () => {
    expect(choosePanel({ ...base, devices: [c66, sim] })).toEqual({ kind: 'device', device: c66 })
    expect(choosePanel({ ...base, android: false, ios: true, devices: [c66, sim] })).toEqual({ kind: 'device', device: sim })
    expect(choosePanel({ ...base, ios: true, devices: [c66, sim] })).toEqual({ kind: 'choose', devices: [c66, sim] })
    expect(choosePanel({ ...base, byHand: true, android: false, devices: [c66, sim] })).toEqual({ kind: 'choose', devices: [c66, sim] })
    expect(choosePanel({ ...base, project: [sim.id], devices: [c66, sim] })).toEqual({ kind: 'device', device: sim })
  })
})

describe('menuOrder', () => {
  it('lists the devices that fit first, each group as listed', () => {
    expect(menuOrder([c66, sim, emu], { android: false, ios: true })).toEqual([sim, c66, emu])
    expect(menuOrder([c66, sim, emu], { android: true, ios: false })).toEqual([c66, emu, sim])
  })
})

describe('stillLooking', () => {
  const list = (pending: ('android' | 'ios')[]): DeviceList => ({ devices: [], problem: null, iosProblem: null, pending })
  const android = { android: true, ios: false, picks: [] }
  it('waits for the list, and for the kinds the tab shows', () => {
    expect(stillLooking(null, android, false, undefined)).toBe(true)
    expect(stillLooking(list(['ios']), android, false, undefined)).toBe(false)
    expect(stillLooking(list(['android']), android, false, undefined)).toBe(true)
    expect(stillLooking(list(['ios']), android, true, undefined)).toBe(true)
    expect(stillLooking(list(['ios']), android, false, sim.id)).toBe(true)
    expect(stillLooking(list(['ios']), { ...android, picks: [sim.id] }, false, undefined)).toBe(true)
    expect(stillLooking(list([]), null, true, undefined)).toBe(false)
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

  it('answers the same when fed its own hold back, as useHeldView does while rendering', () => {
    const cases: [Parameters<typeof panelView>[0], DeviceInfo[], Parameters<typeof panelView>[2], string | null][] = [
      [{ kind: 'device', device: c66 }, [c66], null, null],
      [{ kind: 'choose', devices: [c66, s25] }, [c66, s25], { device: c66, goneSince: null, pick: null }, null],
      [{ kind: 'device', device: s25 }, [s25], { device: c66, goneSince: 100, pick: s25.id }, s25.id],
      [{ kind: 'none' }, [], { device: c66, goneSince: null, pick: null }, null],
    ]
    for (const [choice, devices, held, pick] of cases) {
      const out = panelView(choice, devices, held, 1_000, pick)
      expect(panelView(choice, devices, out.held, 1_000, pick)).toEqual(out)
    }
  })

  it("the pick is the stored id, not choosePanel's resolved device: the tab's own pick unplugging doesn't hand the hold to the project's", () => {
    const pick = s25.id // the tab's own pick; the project's is C66, also connected throughout
    const shown = panelView({ kind: 'device', device: s25 }, [c66, s25], null, 0, pick)
    expect(shown.view).toEqual({ kind: 'device', device: s25, gone: false })
    // S25 unplugs. If `pick` were choosePanel's resolved device instead of the stored id, it would
    // now resolve to C66 (still connected) and the hold would end at once; it doesn't, because the
    // tab's own pick hasn't changed.
    const at1s = panelView({ kind: 'device', device: c66 }, [c66], shown.held, 1000, pick)
    expect(at1s.view).toEqual({ kind: 'device', device: s25, gone: true })
    const at9_9s = panelView({ kind: 'device', device: c66 }, [c66], at1s.held, 1000 + GONE_MS - 100, pick)
    expect(at9_9s.view).toEqual({ kind: 'device', device: s25, gone: true })
    const at10s = panelView({ kind: 'device', device: c66 }, [c66], at9_9s.held, 1000 + GONE_MS, pick)
    expect(at10s.view).toEqual({ kind: 'device', device: c66, gone: false })
  })
})
