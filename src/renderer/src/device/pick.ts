import type { DeviceInfo, DeviceList, DevicePlatform, DeviceProject, Platform } from '@shared/types'

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
  /** The project is an iOS app. */
  ios: boolean
  /** The panel was asked for (View → Device Panel), so every device fits. */
  byHand: boolean
  devices: DeviceInfo[]
}

/** What a device runs: phones and emulators Android, simulators iOS. */
export const platformOf = (kind: DeviceInfo['kind']): DevicePlatform => (kind === 'simulator' ? 'ios' : 'android')

/** A stored id's platform, from its prefix, connected or not. */
const platformOfId = (id: string): DevicePlatform => (id.startsWith('simulator:') ? 'ios' : 'android')

/** The project is an app for the device's platform. */
const fits = (device: DeviceInfo, project: { android: boolean; ios: boolean }) => project[platformOf(device.kind)]

/** The device a tab's panel shows: its own pick, else the latest of its project's picks that's
 *  connected. Nothing picked yet, the only device that fits an app for its platform (phones and
 *  emulators an Android one, simulators an iOS one); with several the panel asks. Once something
 *  has been picked, a device the project never picked doesn't open the panel (the C66's project
 *  doesn't open on the S25 meanwhile), unless it was asked for. With none there's no panel. */
export function choosePanel({ tab, project, android, ios, byHand, devices }: ChoiceInput): PanelChoice {
  const find = (id: string | undefined) => (id ? devices.find((d) => d.id === id) : undefined)
  const picked = find(tab) ?? project.map(find).find((d) => d !== undefined)
  if (picked) return { kind: 'device', device: picked }
  let fitting: DeviceInfo[] = []
  if (byHand) fitting = devices
  else if ((android || ios) && !tab && project.length === 0) fitting = devices.filter((d) => fits(d, { android, ios }))
  if (fitting.length === 1) return { kind: 'device', device: fitting[0] }
  if (fitting.length > 1) return { kind: 'choose', devices: fitting }
  return { kind: 'none' }
}

/** The menu's order: the devices that fit the project first, then the others, each as listed. */
export function menuOrder(devices: DeviceInfo[], project: { android: boolean; ios: boolean }): DeviceInfo[] {
  return [...devices.filter((d) => fits(d, project)), ...devices.filter((d) => !fits(d, project))]
}

/** Whether a tab still waits for devices: the list isn't in, or a kind it may show is still being
 *  looked for (the project's, its picks' and the tab's own pick's; every kind when asked for), so a
 *  project with a phone and a simulator asks rather than showing whichever came first. */
export function stillLooking(list: DeviceList | null, project: { android: boolean; ios: boolean; picks: string[] } | null, byHand: boolean, tabPick: string | undefined): boolean {
  if (!list) return true
  const wanted = new Set<DevicePlatform>()
  if (byHand || project?.android) wanted.add('android')
  if (byHand || project?.ios) wanted.add('ios')
  for (const id of [...(project?.picks ?? []), ...(tabPick ? [tabPick] : [])]) wanted.add(platformOfId(id))
  return list.pending.some((p) => wanted.has(p))
}

/** What the device panel needs to know this render: the tab's project (null until read), its own
 *  pick and show/hide choice, every device Deck currently knows (null until the first list), and the
 *  platform (iOS only counts on macOS). */
export interface PanelInputs {
  project: DeviceProject | null
  tabDevice: string | undefined
  tabHidden: boolean | undefined
  byHand: boolean
  list: DeviceList | null
  platform: Platform
}

/** What App.tsx needs back: whether main should be asked to watch for devices, the project's own
 *  apps, what the panel speaks of when it has nothing, whether a kind the tab may show is still
 *  being looked for, the device to show (a choice, or none), and whether a booted simulator Deck
 *  can't show should open the panel anyway. */
export interface PanelRules {
  needed: boolean
  apps: { android: boolean; ios: boolean }
  wants: { android: boolean; ios: boolean }
  looking: boolean
  choice: PanelChoice | null
  iosHint: boolean
}

/** The device panel's rules, outside React: App.tsx calls this (`list` is useDeviceList's, read
 *  after it, since `needed` decides whether to ask it for one — `needed`'s own formula never looks
 *  at `list`, so a first call with `list: null` to open that hook's gate agrees with a second, once
 *  it answers) and useHeldView (a hook, so it can't live in here) for the device itself. Hidden by
 *  hand (`tabHidden === true`) wins over everything else. Outside an app the panel shows only when
 *  asked for: the project's picks are remembered for then, but don't open the panel in every new tab
 *  there. The choice is null — nothing to choose from yet — while the panel isn't needed, the list
 *  hasn't answered, it's still looking (a kind the tab may show hasn't had its first list: "not
 *  needed any more" would otherwise show the old list's choice), or neither the project nor byHand is
 *  known yet. A booted simulator Deck can't show (no idb-companion, or one without sim-video) opens
 *  an iOS project's panel to say what to install. */
export function panelRules({ project, tabDevice, tabHidden, byHand, list, platform }: PanelInputs): PanelRules {
  const apps = { android: project?.android ?? false, ios: project?.ios ?? false }
  const needed = tabHidden !== true && (byHand || apps.android || apps.ios || Boolean(tabDevice))
  const looking = stillLooking(list, project, byHand, tabDevice)
  const choice = needed && list && !looking && (project || byHand)
    ? choosePanel({ tab: tabDevice, project: project?.picks ?? [], ...apps, byHand, devices: list.devices })
    : null
  // A booted simulator Deck can't show (no idb-companion, or one without sim-video) opens an iOS
  // project's panel to say what to install.
  const iosHint = apps.ios && (list?.iosProblem === 'no-idb' || list?.iosProblem === 'old-idb')
  // What the panel speaks of when it has nothing: the kinds the tab shows (iOS only on macOS).
  const wants = { android: byHand || apps.android, ios: (byHand && platform === 'darwin') || apps.ios }
  return { needed, apps, wants, looking, choice, iosHint }
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
