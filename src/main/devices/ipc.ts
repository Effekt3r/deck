import { spawn } from 'node:child_process'
import { isAbsolute } from 'node:path'
import { type BrowserWindow, ipcMain, powerMonitor, shell } from 'electron'
import { IPC } from '@shared/channels'
import { quoteImagePath } from '@shared/quote'
import type { DeviceActionResult, DeviceList, DeviceProject, InsertResult, Platform } from '@shared/types'
import { adbCandidates, findAdb, runAdb, sdkRoots } from './android/adb'
import { IDENTITY_SCRIPT, parseIdentity } from './android/devices'
import { findEmulator, killEmulator, listAvds, startableEmulators, startAvd } from './android/emulators'
import { adbIo, startScrcpy } from './android/scrcpy'
import { scrcpyServer } from './android/server'
import { androidSession } from './android/session'
import { AndroidTracker } from './android/tracker'
import { bootSimulator, shutdownSimulator } from './ios/boot'
import { iphoneIo, IphoneTracker, screenIdOf, startIphone } from './ios/iphone'
import { startSimulator } from './ios/simulator'
import { removeSocketDir, simulatorIo } from './ios/simulator-io'
import { SimulatorTracker, udidOf } from './ios/simulators'
import { anySimulatorBooted, defaultSimulatorSet, findIdb, idbCandidates, type IdbTools } from './ios/tools'
import { PicksStore } from './picks'
import { describeProject } from './project'
import { type AndroidState, combineLists, type IosState, type IphoneState } from './registry'
import { Starts } from './starts'
import { DeviceStreams } from './streams'

export interface DeviceIpcOptions {
  /** devices.json in userData: each project's device. */
  picksFile: string
  /** Deck's resources folder, which holds scrcpy's server. */
  resources: string
  platform: Platform
  home: string
  env: NodeJS.ProcessEnv
  /** Where simulators' companions put their sockets: short (macOS limits a Unix socket's path) and
   *  this instance's own; used by simulators' sessions. */
  socketDir: string
  /** Deck's iPhone helper (macOS), or null without one: a build on a Mac without Xcode's command line
   *  tools has none, and no iPhones. */
  iphoneHelper: string | null
  /** Where a started emulator's stdout and stderr go, a file of each start's own (`<name>-<ms>.log`,
   *  the AVD's earlier ones removed), so a failed start can say why: see startAvd. Optional; without
   *  one (or when it can't be made or the file can't be opened) a start runs exactly as it did before,
   *  with nothing read from it. */
  emulatorLogDir?: string | null
  /** How long a simulator whose boot command failed still counts as booting, unless the notifier
   *  drops it first: FAILED_BOOT_GRACE_MS (10 s) by default; tests shorten it. */
  failedBootGraceMs?: number
  /** Saves a PNG where Claude can read it (the clipboard card's folder); resolves with its path. */
  saveImage(png: Uint8Array): Promise<string>
}

export interface DeviceIpc {
  /** Pushes go to this window; a reload forgets its watches and views. */
  attach(win: BrowserWindow): void
  /** At quit: stop streaming and watching. */
  dispose(): void
}

/** A screenshot this large is corrupt, not a real capture: scrcpy's own max_size=1600 output is far
 *  smaller than this. */
const MAX_SCREENSHOT_BYTES = 32 * 1024 * 1024
const PNG_SIGNATURE = [0x89, 0x50, 0x4e, 0x47, 0x0d, 0x0a, 0x1a, 0x0a]
const isPng = (data: Uint8Array): boolean => PNG_SIGNATURE.every((byte, i) => data[i] === byte)

/** System Settings › Privacy & Security › Camera, where Deck is let use the camera (an iPhone's
 *  screen is one to macOS). */
const CAMERA_SETTINGS = 'x-apple.systempreferences:com.apple.preference.security?Privacy_Camera'
/** The iPhone helper's first list comes 3 s after it starts. iOS waits for it this long at most, as
 *  adb's first list is capped: else a helper whose list never comes would keep iOS tabs "Looking for
 *  devices…" for LineTracker's 20 s first-list deadline, hiding even a simulator listed and picked,
 *  at every start of watching. */
const IPHONE_FIRST_LIST_MS = 6000
/** A simulator whose `--boot` failed is still listed as booting this long, unless the notifier says
 *  it's gone first: see devices:start. */
const FAILED_BOOT_GRACE_MS = 10_000

/** The device panel's main side: Android devices adb sees and, on macOS, booted simulators
 *  idb-companion sees and iPhones on a cable (each looked for only while a tab needs them), each
 *  project's device, streams for the devices viewed (scrcpy for Android, idb-companion's sim-video
 *  for simulators, Deck's helper for iPhones), and screenshots for Claude. */
export function registerDeviceIpc(opts: DeviceIpcOptions): DeviceIpc {
  const picks = new PicksStore(opts.picksFile)
  let win: BrowserWindow | null = null
  /** null until the first list after watching starts, and again once nothing watches: a tab waits
   *  for the list rather than taking "no devices" for an answer. */
  let list: DeviceList | null = null
  let watchers = 0
  let tracker: AndroidTracker | null = null
  let simulators: SimulatorTracker | null = null
  let iphoneTracker: IphoneTracker | null = null
  /** Looked for again at each start of watching, so an SDK installed since is found. */
  let adb: string | null = null
  let idb: IdbTools | null = null
  /** The look under way, if any: a focus waits for it, a new watch's look takes it over (a stale
   *  look clears only its own token, never a newer one's). */
  let adbLook: object | null = null
  let idbLook: object | null = null
  let android: AndroidState = { pending: true, devices: [], problem: null }
  let ios: IosState = { pending: false, devices: [], problem: null }
  let iphones: IphoneState = { pending: false, devices: [], problem: null }
  /** Ends iOS's wait for the helper's first list; cleared once it lists or fails. */
  let iphoneWait: ReturnType<typeof setTimeout> | null = null
  /** iPhones show on macOS, with the helper. */
  const iphoneHelper = opts.platform === 'darwin' ? opts.iphoneHelper : null
  /** Bumped by every start and stop, so a slow look can't start watching late. */
  let generation = 0
  /** dispose() is final: once set, nothing (a focus included) starts a source again. */
  let disposed = false
  /** A custom device set, for checks (Xcode's own otherwise). */
  const simulatorSet = opts.env.DECK_SIMULATOR_SET || null
  /** The SDK's emulator, found again at each read of the AVDs; null without one. */
  let emulator: string | null = null
  /** The AVDs it listed last; null without an emulator, and until its first answer since watching
   *  started. */
  let avds: string[] | null = null
  /** The read of the AVDs under way, if any: a newer read's token replaces it. */
  let avdLook: object | null = null
  /** Emulators and simulators started from the panel, until they're listed. */
  const starts = new Starts(() => refresh())
  /** Simulators Deck is booting, each with its own boot's token. The notifier says "Booted" as soon as
   *  a boot begins (19 s before it had finished, on a first boot), so each is listed as booting until
   *  idb's boot command ends (one that fails, a while longer: see devices:start). A token (not just
   *  the id) tells two overlapping boots of the same simulator apart (Start, Stop, Start again while
   *  the first `--boot` still runs): only the boot whose own token is still current may clear the
   *  flag, so an older boot ending can't mark a newer one's simulator ready while it's still starting. */
  const booting = new Map<string, object>()
  const failedBootGraceMs = opts.failedBootGraceMs ?? FAILED_BOOT_GRACE_MS
  /** The failed boots' graces under way, ended when Deck quits. */
  const graces = new Set<ReturnType<typeof setTimeout>>()
  /** Ends idb's boot/shutdown commands under way when Deck quits; the boot itself completes anyway
   *  (measured), since it runs in CoreSimulator, not in the command Deck ran. */
  const quitting = new AbortController()

  const send = (channel: string, ...args: unknown[]) => {
    if (win && !win.isDestroyed() && !win.webContents.isDestroyed()) win.webContents.send(channel, ...args)
  }
  const publish = (next: DeviceList) => {
    if (JSON.stringify(next) === JSON.stringify(list)) return
    list = next
    send(IPC.devicesChanged, list)
  }

  const streams = new DeviceStreams({
    start: async (id, events, signal) => {
      const screen = screenIdOf(id)
      if (screen !== null) {
        if (!iphoneHelper || !iphoneTracker?.has(screen)) throw new Error("The iPhone isn't connected.")
        return startIphone(screen, events, iphoneIo(iphoneHelper), signal)
      }
      const udid = udidOf(id)
      if (udid !== null) {
        if (!idb?.simVideo || !simulators?.booted(udid)) throw new Error("The simulator isn't booted.")
        const set = simulatorSet ?? defaultSimulatorSet(opts.home)
        const io = simulatorIo({ companion: idb.companion, simVideo: idb.simVideo, set, customSet: simulatorSet !== null, dir: opts.socketDir })
        return startSimulator(udid, events, io, signal)
      }
      const serial = tracker?.serialFor(id)
      if (!adb || !serial) throw new Error("The device isn't connected.")
      return androidSession(await startScrcpy(serial, await scrcpyServer(opts.resources), events, adbIo(adb), signal))
    },
    send: (id, event) => send(IPC.devicesStream, id, event),
  })

  /** The list, once some source has answered (or, with one already shown, once any source's pending
   *  flag changes): until a first list, a tab waits rather than taking "no devices" for an answer.
   *  Without `list !== null`, setting a settled source back to pending while the others are already
   *  pending would leave the old list showing instead of saying so. With it, what can be started:
   *  the AVDs and shut-down simulators not running, and the starts not listed yet. */
  const update = () => {
    if (disposed || watchers === 0 || (list === null && android.pending && ios.pending && iphones.pending)) return
    const simulatorDevices = ios.devices.map((d) => (booting.has(d.id) ? { ...d, state: 'booting' as const } : d))
    const found = combineLists(android, { ...ios, devices: simulatorDevices }, iphones)
    // Ends a start only once its device is listed and no longer booting: a booting device (a
    // simulator Deck is booting; an emulator mid cold-boot) can still fail, or close cleanly, before
    // it's really up, and that must still reach its start (via fail() or forget(), not lost because
    // listed() already ended it the moment it was merely visible).
    starts.listed(found.devices.filter((d) => d.state !== 'booting'))
    const offered = [...startableEmulators(avds ?? []), ...(simulators?.shutDown() ?? [])]
    publish({ ...found, startable: starts.merge(offered, found.devices), noAvds: avds !== null && avds.length === 0 })
  }
  /** What can be started changed: a list already out is sent again. The first list still waits for
   *  a device source (update's rule), and has what's known by then. */
  const refresh = () => {
    if (list !== null) update()
  }

  /** The AVDs the SDK's emulator lists: read at each start of watching, when Deck comes to the front
   *  (one made in Android Studio meanwhile), and after an emulator's start or stop. The newest read
   *  wins; one that fails keeps what the last one found. */
  const readAvds = async (mine: number) => {
    // A start or stop's own re-read shouldn't outlive the watch it began in, or Deck quitting: its
    // caller captures `mine` when it's clicked, so this can still be stale by its own generation check
    // below once the read itself settles, but there's no point even starting it once nothing's
    // watching any more or Deck's on its way out.
    if (disposed || watchers === 0) return
    const look = (avdLook = {})
    try {
      const found = await findEmulator(sdkRoots(opts.env, opts.platform, opts.home), opts.platform)
      let failure: unknown = null
      const names = found
        ? await listAvds(found).catch((err: unknown) => {
            failure = err
            return null
          })
        : null
      // A stale read (watching stopped or restarted, or a newer read began) says nothing.
      if (mine !== generation || avdLook !== look) return
      if (failure) console.error('devices: listing the AVDs failed', failure)
      emulator = found
      if (!found) avds = null
      else if (names) avds = names
      refresh()
    } finally {
      if (avdLook === look) avdLook = null
    }
  }

  const watchAndroid = async (mine: number, focus = false) => {
    if (focus && adbLook) return
    const look = (adbLook = {})
    try {
      const found = await findAdb(adbCandidates(opts.env, opts.platform, opts.home))
      if (mine !== generation || tracker) return
      adb = found
      if (!found) {
        android = { pending: false, devices: [], problem: 'no-adb' }
        return update()
      }
      tracker = new AndroidTracker({
        track: () => spawn(found, ['track-devices', '-l'], { stdio: ['ignore', 'pipe', 'pipe'], windowsHide: true }),
        identify: async (serial) => parseIdentity(await runAdb(found, ['-s', serial, 'shell', IDENTITY_SCRIPT], 10_000)),
        publish: (devices, error) => {
          android = { pending: false, devices, problem: error && devices.length === 0 ? { error } : null }
          update()
        },
      })
      tracker.start()
    } finally {
      if (adbLook === look) adbLook = null
    }
  }

  /** Simulators: macOS only, with idb-companion. Without it (or with one too old for sim-video), a
   *  booted simulator gets the panel to say what to install (asked with pgrep: cheap and starting
   *  nothing, so a focus may ask too, and an idb-companion installed meanwhile changes the hint). */
  const watchSimulators = async (mine: number, focus = false) => {
    if (opts.platform !== 'darwin' || (focus && idbLook)) return
    const look = (idbLook = {})
    try {
      const found = await findIdb(idbCandidates(opts.env))
      if (mine !== generation || simulators) return
      idb = found
      if (!found?.simVideo) {
        const booted = await anySimulatorBooted()
        if (mine !== generation) return
        ios = { pending: false, devices: [], problem: booted ? (found ? 'old-idb' : 'no-idb') : null }
        return update()
      }
      // Keeps whatever ios already said (a stale hint, or nothing: no simulator can be shown yet
      // here, since simulators is still null) until the notifier's own first list replaces it:
      // resetting to pending flashed "Looking…" — dropping, say, an Android device already shown in
      // a tab that also wants iOS — for the ~2.5 s the notifier takes to list, on a focus re-look
      // after idb-companion is installed.
      startSimulators(found.companion)
    } finally {
      if (idbLook === look) idbLook = null
    }
  }

  const startSimulators = (companion: string) => {
    simulators = new SimulatorTracker({
      // --log-level info, as a simulator's own companion is started (simulator-io.ts): idb's default
      // (debug) fills stderr with chatter, which would otherwise outrank a real failure's last line.
      notify: () => spawn(companion, ['--notify', 'stdout', '--only', 'simulator', '--log-level', 'info', ...(simulatorSet ? ['--device-set-path', simulatorSet] : [])], { stdio: ['ignore', 'pipe', 'pipe'] }),
      publish: (devices) => {
        ios = { pending: false, devices, problem: null }
        update()
      },
      failed: (why, listed) => {
        if (listed) return // this run had listed: its list stands until the notifier is back
        ios = { pending: false, devices: [], problem: { error: why } }
        update()
      },
    })
    simulators.start()
  }

  const endIphoneWait = () => {
    if (iphoneWait) clearTimeout(iphoneWait)
    iphoneWait = null
  }

  /** iPhones: macOS, with the helper, which lists the screens on offer 3 s after it starts, then on
   *  each change. Quiet when it fails: the list then has no iPhones (a run that had listed keeps its
   *  list while the helper is started again), and the reason goes to main's log. A first list that's
   *  late stops holding iOS at IPHONE_FIRST_LIST_MS, and still counts when it comes. */
  const watchIphones = (helper: string) => {
    // Before start(): a helper that can't be spawned at all fails inside it, and clears this.
    iphoneWait = setTimeout(() => {
      iphoneWait = null
      iphones = { ...iphones, pending: false }
      update()
    }, IPHONE_FIRST_LIST_MS)
    iphoneTracker = new IphoneTracker({
      list: () => iphoneIo(helper).list(),
      publish: (devices) => {
        endIphoneWait()
        iphones = { pending: false, devices, problem: null }
        update()
      },
      failed: (why, listed) => {
        endIphoneWait()
        console.error('devices: the iPhone helper stopped:', why)
        if (listed) return
        iphones = { pending: false, devices: [], problem: null }
        update()
      },
    })
    iphoneTracker.start()
  }

  const startWatching = () => {
    const mine = ++generation
    android = { pending: true, devices: [], problem: null }
    ios = { pending: opts.platform === 'darwin', devices: [], problem: null }
    iphones = { pending: iphoneHelper !== null, devices: [], problem: null }
    void watchAndroid(mine)
    void watchSimulators(mine)
    void readAvds(mine)
    if (iphoneHelper) watchIphones(iphoneHelper)
  }
  const stopWatching = () => {
    generation++
    // A start under way goes on by itself (an emulator is detached, a simulator's boot runs in
    // CoreSimulator): the next watch lists it once it's up.
    starts.clear()
    avds = null
    tracker?.stop()
    tracker = null
    simulators?.stop()
    simulators = null
    iphoneTracker?.stop()
    iphoneTracker = null
    endIphoneWait()
    // No push: every tab that watched has already stopped listening (it calls off() before unwatch).
    list = null
  }

  /** A folder's project, for 30 s: asked whenever a tab comes to the front, and each look runs git
   *  and a few dozen stats. The pick is read fresh every time. */
  const projects = new Map<string, { at: number; value: Promise<{ root: string; android: boolean; ios: boolean }> }>()
  const describe = (folder: string) => {
    const now = performance.now()
    const cached = projects.get(folder)
    if (cached && now - cached.at < 30_000) return cached.value
    if (projects.size > 200) projects.clear()
    // Simulators never show off macOS: describeProject skips the Xcode scan there too, not just its result.
    const value = describeProject(folder, opts.home, opts.platform === 'darwin')
    projects.set(folder, { at: now, value })
    // A later look at the same folder may already have replaced this entry (its own, newer value):
    // a failure must only clear the entry it caused, never a fresher one that's since taken its place.
    value.catch(() => {
      if (projects.get(folder)?.value === value) projects.delete(folder)
    })
    return value
  }

  // ipcMain.on listeners check their arguments: a throw there leaves the listener's work half done
  // and reaches only main's uncaught exception handler, which logs it (index.ts).
  ipcMain.on(IPC.devicesWatch, () => {
    if (++watchers === 1) startWatching()
  })
  ipcMain.on(IPC.devicesUnwatch, () => {
    if (watchers > 0 && --watchers === 0) stopWatching()
  })
  ipcMain.handle(IPC.devicesList, () => list)
  ipcMain.handle(IPC.devicesProject, async (_e, folder: unknown): Promise<DeviceProject> => {
    if (typeof folder !== 'string' || !isAbsolute(folder)) throw new Error('No folder given.')
    const { root, android, ios } = await describe(folder)
    // An unreadable devices.json must not hide every tab's panel: no picks, then.
    const picked = await picks.get(root).catch((err: unknown): string[] => {
      console.error('devices: reading devices.json failed', err)
      return []
    })
    return { root, android, ios, picks: picked }
  })
  ipcMain.handle(IPC.devicesPick, async (_e, root: unknown, id: unknown) => {
    if (typeof root !== 'string' || !isAbsolute(root) || root.length > 4096 || typeof id !== 'string' || !id || id.length > 4096) {
      throw new Error('No project or device given.')
    }
    await picks.set(root, id)
  })
  ipcMain.on(IPC.devicesView, (_e, id: unknown) => {
    // A stale id (the renderer's own state, or a device that's since disconnected) would only ever
    // fail to start: skip the doomed connecting → retrying → error cycle for it. Likewise a device
    // still booting: there's nothing to stream yet, and the panel's own pick (which drives this) holds
    // off until it's ready.
    if (typeof id === 'string' && id && list?.devices.some((d) => d.id === id && d.state !== 'booting')) streams.view(id)
  })
  ipcMain.on(IPC.devicesUnview, (_e, id: unknown) => {
    if (typeof id === 'string') streams.unview(id)
  })
  ipcMain.on(IPC.devicesKeyframe, (_e, id: unknown) => {
    if (typeof id === 'string') streams.keyframe(id)
  })
  ipcMain.on(IPC.devicesRetry, (_e, id: unknown) => {
    if (typeof id === 'string') streams.retry(id)
  })
  ipcMain.on(IPC.devicesInput, (_e, id: unknown, input: unknown) => {
    if (typeof id === 'string') streams.input(id, input)
  })
  ipcMain.on(IPC.devicesCameraSettings, () => {
    if (opts.platform === 'darwin') void shell.openExternal(CAMERA_SETTINGS)
  })
  // Only what the list offers can be started, and only a listed emulator or simulator stopped: the
  // ids come from adb's, the emulator's and idb's own lists, checked where they're read.
  ipcMain.handle(IPC.devicesStart, (_e, id: unknown): DeviceActionResult => {
    if (!list) return { error: "Deck isn't looking for devices." }
    // Started some other way meanwhile: the pick shows it. Only an emulator or a simulator is ever
    // started from here, so any other kind already listed (a phone, an iPhone) isn't "already
    // running" from this call's point of view either — it gets the same answer an id Deck doesn't
    // know at all does.
    const already = list.devices.find((d) => d.id === id)
    if (already) return already.kind === 'emulator' || already.kind === 'simulator' ? null : { error: 'Deck no longer sees it.' }
    const device = list.startable.find((d) => d.id === id)
    if (!device) return { error: 'Deck no longer sees it.' }
    const start = starts.begin(device)
    if (!start) return null // already starting
    refresh()
    // Captured now (the click), not read lazily once this start's own async work settles: a watch
    // that stops and starts again while it's in flight must still look stale to readAvds below.
    const mine = generation
    const failWith = (err: unknown) => start.fail(err instanceof Error ? err.message : String(err))
    if (device.kind === 'emulator') {
      if (!emulator) start.fail("Deck can't find Android's emulator.")
      else {
        const ended = (how: string, info: { clean: boolean }) => {
          // A clean exit (code 0, nothing wrong in its log) once the device was up is the user
          // closing its own window, not a failed start: forget it rather than show an error. This
          // start only: an older emulator of the same AVD closing late (Stop, then Start while it
          // saves its snapshot) mustn't forget the newer start.
          if (info.clean) start.forget()
          else start.fail(how)
        }
        startAvd(emulator, device.id.slice('emulator:'.length), ended, opts.emulatorLogDir ?? null).then(() => void readAvds(mine), failWith)
      }
      return null
    }
    const udid = udidOf(device.id)
    if (!idb || !udid) {
      start.fail("Deck can't find idb-companion.")
      return null
    }
    const boot = {}
    booting.set(device.id, boot)
    const bootOver = () => {
      // Only if this is still the current boot: an older boot ending (Start, Stop, Start again
      // while the first `--boot` still runs) must not clear the newer one's flag.
      if (booting.get(device.id) === boot) booting.delete(device.id)
      refresh()
    }
    bootSimulator(idb.companion, udid, { set: simulatorSet, signal: quitting.signal }).then(bootOver, (err: unknown) => {
      if (quitting.signal.aborted) return bootOver()
      failWith(err)
      // Booting a while longer: a failing `--boot` may end before the notifier says the simulator is
      // going down (the notifier was seen first only in boots that worked). Ready at once, it would end
      // its start, error and all, and could be streamed as it shuts down; still booting, it keeps both
      // until the notifier drops it, and one that's up after all (booted some other way meanwhile)
      // turns ready, ending its start, once the grace is over.
      const grace = setTimeout(() => {
        graces.delete(grace)
        bootOver()
      }, failedBootGraceMs)
      graces.add(grace)
    })
    return null
  })
  ipcMain.handle(IPC.devicesStop, async (_e, id: unknown): Promise<DeviceActionResult> => {
    const device = typeof id === 'string' ? list?.devices.find((d) => d.id === id) : undefined
    if (!device || (device.kind !== 'emulator' && device.kind !== 'simulator')) return { error: 'Only a running emulator or simulator can be stopped.' }
    // A Stop during a boot (a simulator still booting; an emulator mid cold-boot) ends its start too:
    // its command's own outcome, even a late failure once this has already answered, must never show
    // as a failed start once the user asked to stop it (Starts itself ignores a fail() for a start it
    // no longer has, so a stray one after this changes nothing).
    const mine = generation // captured now, for the same reason devices:start captures it
    starts.forget(device.id)
    try {
      if (device.kind === 'emulator') {
        const serial = tracker?.serialFor(device.id)
        if (!adb || !serial) return { error: "adb doesn't list it." }
        await killEmulator(adb, serial)
        void readAvds(mine)
        return null
      }
      const udid = udidOf(device.id)
      if (!idb || !udid) return { error: "Deck can't find idb-companion." }
      await shutdownSimulator(idb.companion, udid, { set: simulatorSet, signal: quitting.signal })
      return null
    } catch (err) {
      return { error: err instanceof Error ? err.message : String(err) }
    }
  })
  ipcMain.handle(IPC.devicesScreenshot, async (_e, png: unknown): Promise<InsertResult> => {
    if (!(png instanceof Uint8Array) || png.length === 0 || png.length > MAX_SCREENSHOT_BYTES || !isPng(png)) {
      return { error: 'There was no screenshot to add.' }
    }
    try {
      const text = quoteImagePath(await opts.saveImage(png), opts.platform)
      return text === null ? { error: "The screenshot's path can't be pasted safely." } : { text: `${text} ` }
    } catch (err) {
      return { error: `Couldn't save the screenshot for Claude: ${err instanceof Error ? err.message : String(err)}` }
    }
  })

  /** A new renderer (a reload, a crash) knows nothing of the old one's watches and views. */
  const forget = () => {
    streams.stopAll()
    if (watchers > 0) {
      watchers = 0
      stopWatching()
    }
  }

  return {
    attach(w) {
      if (win) throw new Error('registerDeviceIpc: attach() runs once')
      win = w
      w.webContents.on('did-start-loading', forget)
      w.webContents.on('render-process-gone', forget)
      // adb or idb-companion installed while Deck runs: look again when Deck comes to the front,
      // rather than only when a tab starts needing devices. Never once disposed: that's final, even
      // in theory (only will-quit disposes, after which a focus shouldn't reach here at all).
      w.on('focus', () => {
        if (disposed || watchers === 0) return
        if (!tracker) void watchAndroid(generation, true)
        if (opts.platform === 'darwin' && !simulators) void watchSimulators(generation, true)
        // An AVD made in Android Studio meanwhile.
        if (!avdLook) void readAvds(generation)
      })
      // A locked screen or a sleeping Mac: nobody's watching, and the device may sleep. Waking with
      // a password fires resume, then unlock-screen: stream again only once unlocked.
      let locked = false
      powerMonitor.on('lock-screen', () => {
        locked = true
        streams.pause()
      })
      powerMonitor.on('unlock-screen', () => {
        locked = false
        streams.resume()
      })
      powerMonitor.on('suspend', () => streams.pause())
      powerMonitor.on('resume', () => {
        if (!locked) streams.resume()
      })
    },
    dispose() {
      disposed = true
      quitting.abort()
      for (const grace of graces) clearTimeout(grace)
      graces.clear()
      starts.clear()
      streams.stopAll()
      generation++
      tracker?.stop()
      tracker = null
      simulators?.stop()
      simulators = null
      iphoneTracker?.stop()
      iphoneTracker = null
      endIphoneWait()
      // Now, not after the companions it just signalled have exited: quitting mustn't wait out their
      // 2 s kill escalation, and unlinking a socket one still holds open is harmless.
      removeSocketDir(opts.socketDir)
    },
  }
}
