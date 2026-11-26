import type { DeviceInfo, DeviceList, DevicePlatform, DeviceProject, Platform, StartableDevice } from '@shared/types'

export type PanelChoice =
  | { kind: 'device'; device: DeviceInfo }
  /** Started from the panel and not listed yet: "Starting …", or why it didn't. */
  | { kind: 'starting'; device: StartableDevice }
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
  /** What can be started, with the starts under way or failed (`DeviceList.startable`). */
  startable: StartableDevice[]
}

/** What a device runs: phones and emulators Android, simulators and iPhones iOS. */
const platformOf = (kind: DeviceInfo['kind']): DevicePlatform => (kind === 'simulator' || kind === 'iphone' ? 'ios' : 'android')

/** A stored id's platform, from its prefix, connected or not. */
const platformOfId = (id: string): DevicePlatform => (id.startsWith('simulator:') || id.startsWith('iphone:') ? 'ios' : 'android')

/** The project is an app for the device's platform. */
const fits = (device: { kind: DeviceInfo['kind'] }, project: { android: boolean; ios: boolean }) => project[platformOf(device.kind)]

/** The device a tab's panel shows: its own pick, else the latest of its project's picks that's
 *  connected, or that was started from the panel and isn't listed yet (it shows as starting, or why
 *  it didn't start, rather than the tab falling back to another device meanwhile). Nothing picked
 *  yet, the only device that fits an app for its platform (phones and emulators an Android one,
 *  simulators and iPhones an iOS one); with several the panel asks. Once something has been picked, a
 *  device the project never picked doesn't open the panel (the C66's project doesn't open on the S25
 *  meanwhile), unless it was asked for. With none there's no panel. */
export function choosePanel({ tab, project, android, ios, byHand, devices, startable }: ChoiceInput): PanelChoice {
  const find = (id: string | undefined): PanelChoice | undefined => {
    if (!id) return undefined
    const device = devices.find((d) => d.id === id)
    if (device) return { kind: 'device', device }
    const start = startable.find((d) => d.id === id && (d.starting || d.error !== undefined))
    return start ? { kind: 'starting', device: start } : undefined
  }
  const picked = find(tab) ?? project.map(find).find((c) => c !== undefined)
  if (picked) return picked
  let fitting: DeviceInfo[] = []
  if (byHand) fitting = devices
  else if ((android || ios) && !tab && project.length === 0) fitting = devices.filter((d) => fits(d, { android, ios }))
  if (fitting.length === 1) return { kind: 'device', device: fitting[0] }
  if (fitting.length > 1) return { kind: 'choose', devices: fitting }
  return { kind: 'none' }
}

/** The menu's order: the devices (or what can be started) that fit the project first, then the
 *  others, each as listed. */
export function menuOrder<T extends { kind: DeviceInfo['kind'] }>(devices: T[], project: { android: boolean; ios: boolean }): T[] {
  return [...devices.filter((d) => fits(d, project)), ...devices.filter((d) => !fits(d, project))]
}

/** At most this many Start buttons in an empty panel; the rest are in the ▾ menu. */
export const MAX_START_BUTTONS = 3

/** What an empty panel offers to start: the tab's device (`pick`) first when it can be started, then
 *  those that fit the tab (emulators where Android devices do, simulators where iOS ones do), none
 *  starting already, up to 3; `more` when the menu has more. */
export function startButtons(startable: StartableDevice[], wants: { android: boolean; ios: boolean }, pick: string | null): { buttons: StartableDevice[]; more: boolean } {
  const offered = startable.filter((d) => !d.starting && (d.id === pick || fits(d, wants)))
  const ordered = [...offered.filter((d) => d.id === pick), ...offered.filter((d) => d.id !== pick)]
  return { buttons: ordered.slice(0, MAX_START_BUTTONS), more: ordered.length > MAX_START_BUTTONS }
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
  list: DeviceList | null
  platform: Platform
}

/** Whether main should be asked to watch for devices: outside an app the panel shows only when asked
 *  for by hand (`tabHidden === false`) — the project's picks are remembered for then, but don't open
 *  the panel in every new tab there — hidden by hand (`tabHidden === true`) wins over everything
 *  else. Takes `PanelInputs` minus `list` so a caller can read this before `useDeviceList` gives one:
 *  the type itself says this never reads the list that depends on its answer. */
export function devicesNeeded({ project, tabDevice, tabHidden }: Omit<PanelInputs, 'list'>): boolean {
  const byHand = tabHidden === false
  return tabHidden !== true && (byHand || project?.android === true || project?.ios === true || Boolean(tabDevice))
}

/** What App.tsx needs back from `panelRules`: whether main should be asked to watch for devices
 *  (`devicesNeeded` again, now that the list it gates is known), the panel was asked for by hand, the
 *  project's own apps, what the panel speaks of when it has nothing, whether a kind the tab may show
 *  is still being looked for, the device to show (a choice, or none), whether a booted simulator
 *  Deck can't show should open the panel anyway, and whether the tab's device can be started (the
 *  panel stays, to start it). */
export interface PanelRules {
  needed: boolean
  byHand: boolean
  apps: { android: boolean; ios: boolean }
  wants: { android: boolean; ios: boolean }
  looking: boolean
  choice: PanelChoice | null
  iosHint: boolean
  startPick: boolean
}

/** The device panel's rules once the list is known, outside React: App.tsx calls `devicesNeeded`
 *  before `useDeviceList`, then this (`list` is what it answered) and useHeldView (a hook, so it
 *  can't live in here) for the device itself. The choice is null — nothing to choose from yet — while
 *  the panel isn't needed, the list hasn't answered, it's still looking (a kind the tab may show
 *  hasn't had its first list: "not needed any more" would otherwise show the old list's choice), or
 *  neither the project nor byHand is known yet. A booted simulator Deck can't show (no idb-companion,
 *  or one without sim-video) opens an iOS project's panel to say what to install. */
export function panelRules({ project, tabDevice, tabHidden, list, platform }: PanelInputs): PanelRules {
  const byHand = tabHidden === false
  const apps = { android: project?.android ?? false, ios: project?.ios ?? false }
  const needed = devicesNeeded({ project, tabDevice, tabHidden, platform })
  const looking = stillLooking(list, project, byHand, tabDevice)
  const choice = needed && list && !looking && (project || byHand)
    ? choosePanel({ tab: tabDevice, project: project?.picks ?? [], ...apps, byHand, devices: list.devices, startable: list.startable })
    : null
  // A booted simulator Deck can't show (no idb-companion, or one without sim-video) opens an iOS
  // project's panel to say what to install.
  const iosHint = apps.ios && (list?.iosProblem === 'no-idb' || list?.iosProblem === 'old-idb')
  // What the panel speaks of when it has nothing: the kinds the tab shows (iOS only on macOS).
  const wants = { android: byHand || apps.android, ios: (byHand && platform === 'darwin') || apps.ios }
  // The tab's device (its own pick, else the project's latest) is an emulator or a simulator that
  // isn't running: the panel stays open with its Start button, as it doesn't for an unplugged phone.
  // So a Stop leaves a way to start it again, and a project whose simulator is shut down offers it.
  const pick = tabDevice ?? project?.picks[0]
  const startPick = choice !== null && pick !== undefined && (list?.startable.some((d) => d.id === pick) ?? false)
  return { needed, byHand, apps, wants, looking, choice, iosHint, startPick }
}

/** How long a device that went away keeps its place. */
export const GONE_MS = 10_000

export type PanelView =
  | { kind: 'device'; device: DeviceInfo; gone: boolean }
  | { kind: 'starting'; device: StartableDevice }
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
  // Started again right after a stop, with the same pick: "Starting …" at once, not the stopped
  // device's "disconnected" hold.
  if (choice.kind === 'starting') return { view: choice, held: null }
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
