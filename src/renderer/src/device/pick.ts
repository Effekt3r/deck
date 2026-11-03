import type { DeviceInfo } from '@shared/types'

export type PanelChoice =
  | { kind: 'device'; device: DeviceInfo }
  | { kind: 'choose'; devices: DeviceInfo[] }
  | { kind: 'none' }

export interface ChoiceInput {
  /** The tab's own pick. */
  tab: string | undefined
  /** The project's last pick. */
  project: string | null
  /** The project is an Android app. */
  android: boolean
  /** The panel was asked for (View → Device Panel), so every device fits. */
  byHand: boolean
  devices: DeviceInfo[]
}

/** The device a tab's panel shows: its own pick, else its project's, while connected; else the only
 *  device that fits. With several the panel asks; with none there's no panel. */
export function choosePanel({ tab, project, android, byHand, devices }: ChoiceInput): PanelChoice {
  const find = (id: string | null | undefined) => (id ? devices.find((d) => d.id === id) : undefined)
  const picked = find(tab) ?? find(project)
  if (picked) return { kind: 'device', device: picked }
  const fits = android || byHand ? devices : []
  if (fits.length === 1) return { kind: 'device', device: fits[0] }
  if (fits.length > 1) return { kind: 'choose', devices: fits }
  return { kind: 'none' }
}

/** How long a device that went away keeps its place. */
export const GONE_MS = 10_000

export type PanelView =
  | { kind: 'device'; device: DeviceInfo; gone: boolean }
  | { kind: 'choose'; devices: DeviceInfo[] }
  | { kind: 'none' }

/** The device shown last, and since when it's gone (null while it's connected). */
export interface Held {
  device: DeviceInfo
  goneSince: number | null
}

/** What the panel shows: the choice, except that a shown device that went away stays, as gone, for
 *  10 s, so a cable that wiggles doesn't move the pane. Also what to hold for next time. */
export function panelView(choice: PanelChoice, devices: DeviceInfo[], held: Held | null, now: number): { view: PanelView; held: Held | null } {
  if (held && !devices.some((d) => d.id === held.device.id)) {
    const goneSince = held.goneSince ?? now
    if (now - goneSince < GONE_MS) return { view: { kind: 'device', device: held.device, gone: true }, held: { device: held.device, goneSince } }
  }
  if (choice.kind === 'device') return { view: { kind: 'device', device: choice.device, gone: false }, held: { device: choice.device, goneSince: null } }
  return { view: choice, held: null }
}
