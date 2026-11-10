import type { DeviceInfo } from '@shared/types'

export type PanelChoice =
  | { kind: 'device'; device: DeviceInfo }
  | { kind: 'choose'; devices: DeviceInfo[] }
  | { kind: 'none' }

export interface ChoiceInput {
  /** The tab's own pick. */
  tab: string | undefined
  /** The devices picked in the project, latest first. */
  project: string[]
  /** The project is an Android app. */
  android: boolean
  /** The panel was asked for (View → Device Panel), so every device fits. */
  byHand: boolean
  devices: DeviceInfo[]
}

/** The device a tab's panel shows: its own pick, else the latest of its project's picks that's
 *  connected. Nothing picked yet, the only device that fits; with several the panel asks. Once
 *  something has been picked, a device the project never picked doesn't open the panel (the C66's
 *  project doesn't open on the S25 meanwhile), unless it was asked for. With none there's no panel. */
export function choosePanel({ tab, project, android, byHand, devices }: ChoiceInput): PanelChoice {
  const find = (id: string | undefined) => (id ? devices.find((d) => d.id === id) : undefined)
  const picked = find(tab) ?? project.map(find).find((d) => d !== undefined)
  if (picked) return { kind: 'device', device: picked }
  const fits = byHand || (android && !tab && project.length === 0) ? devices : []
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
  /** The pick in force when it was shown: the tab's own pick, else the project's latest, else null —
   *  the stored id itself, never `choosePanel`'s resolved device. Passing the resolved device would
   *  end the hold the moment a tab's own pick unplugs and the project's pick takes its place. */
  pick: string | null
}

/** What the panel shows: the choice, except, as long as the pick in force hasn't changed since the
 *  held device was shown: (1) a device that went away stays, as gone, for 10 s, so a cable that
 *  wiggles doesn't move the pane, and (2) a still-connected device stays shown rather than jumping
 *  to the chooser when a second device arrives — the menu switches instead. A new pick (the tab or
 *  project pick changed) ends both at once, showing the new choice straight away. `pick` is the
 *  tab's own pick, else the project's latest, else null: the stored ids themselves (see
 *  `Held.pick`), not `choosePanel`'s resolved device. Also what to hold for next time. */
export function panelView(choice: PanelChoice, devices: DeviceInfo[], held: Held | null, now: number, pick: string | null): { view: PanelView; held: Held | null } {
  if (held && held.pick === pick) {
    const current = devices.find((d) => d.id === held.device.id)
    if (!current) {
      const goneSince = held.goneSince ?? now
      if (now - goneSince < GONE_MS) return { view: { kind: 'device', device: held.device, gone: true }, held: { ...held, goneSince } }
    } else if (choice.kind === 'choose') {
      // Still connected: it stays when a second device arrives (the menu switches).
      return { view: { kind: 'device', device: current, gone: false }, held: { device: current, goneSince: null, pick } }
    }
  }
  if (choice.kind === 'device') return { view: { kind: 'device', device: choice.device, gone: false }, held: { device: choice.device, goneSince: null, pick } }
  return { view: choice, held: null }
}
