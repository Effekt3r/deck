import type { DeviceInfo, DeviceList, DevicePlatform } from '@shared/types'

/** What one source of devices knows: adb's, or idb's simulators. */
export interface SourceState<P> {
  /** Still finding its first devices. */
  pending: boolean
  devices: DeviceInfo[]
  problem: P
}

export type AndroidState = SourceState<DeviceList['problem']>
export type IosState = SourceState<DeviceList['iosProblem']>

/** One list from both sources: adb's devices as its tracker orders them, then the simulators. */
export function combineLists(android: AndroidState, ios: IosState): DeviceList {
  const pending: DevicePlatform[] = []
  if (android.pending) pending.push('android')
  if (ios.pending) pending.push('ios')
  return { devices: [...android.devices, ...ios.devices], problem: android.problem, iosProblem: ios.problem, pending }
}
