import type { DeviceInfo, StartableDevice } from '@shared/types'

/** One item of the ▾ menu: a device to show, one to start, or Stop for the device on screen. */
export type MenuEntry =
  | { key: string; type: 'device'; device: DeviceInfo }
  | { key: string; type: 'start'; device: StartableDevice }
  | { key: string; type: 'stop'; device: DeviceInfo }

/** The ▾ menu's items, top to bottom: the devices, what can be started, then Stop when the device on
 *  screen (`shown`: listed, not gone; null otherwise) is an emulator or a simulator. Phones and
 *  iPhones have no Stop. Each key is unique, so the keyboard's place survives the list changing
 *  under it. */
export function menuEntries(devices: DeviceInfo[], startable: StartableDevice[], shown: DeviceInfo | null): MenuEntry[] {
  const entries: MenuEntry[] = [
    ...devices.map((device): MenuEntry => ({ key: `device:${device.id}`, type: 'device', device })),
    ...startable.map((device): MenuEntry => ({ key: `start:${device.id}`, type: 'start', device })),
  ]
  if (shown && (shown.kind === 'emulator' || shown.kind === 'simulator')) entries.push({ key: 'stop', type: 'stop', device: shown })
  return entries
}

/** What a Start item says beside its name: starting, that its start failed, or what it is. */
export const startHint = (device: StartableDevice): string =>
  device.starting ? 'starting…' : device.error !== undefined ? "didn't start" : device.detail
