import type { DeviceInfo, DeviceList, DevicePlatform } from '@shared/types'

/** What one source of devices knows: adb's, idb's simulators, or the iPhone helper's screens. */
export interface SourceState<P> {
  /** Still finding its first devices. */
  pending: boolean
  devices: DeviceInfo[]
  problem: P
}

export type AndroidState = SourceState<DeviceList['problem']>
export type IosState = SourceState<DeviceList['iosProblem']>
/** iPhones have no problem to show: without the helper, or with one that fails, there are none. */
export type IphoneState = SourceState<null>

/** One list from the three sources, phones first (Android's, as adb's tracker orders them, then
 *  iPhones), then emulators, then simulators. iOS is pending while the simulators or the iPhones
 *  are. */
export function combineLists(android: AndroidState, ios: IosState, iphones: IphoneState): DeviceList {
  const pending: DevicePlatform[] = []
  if (android.pending) pending.push('android')
  if (ios.pending || iphones.pending) pending.push('ios')
  const phones = android.devices.filter((d) => d.kind === 'android')
  const emulators = android.devices.filter((d) => d.kind !== 'android')
  return { devices: [...phones, ...iphones.devices, ...emulators, ...ios.devices], problem: android.problem, iosProblem: ios.problem, pending }
}
