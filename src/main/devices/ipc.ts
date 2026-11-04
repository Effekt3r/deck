import { spawn } from 'node:child_process'
import { isAbsolute } from 'node:path'
import { type BrowserWindow, ipcMain, powerMonitor } from 'electron'
import { IPC } from '@shared/channels'
import { quoteImagePath } from '@shared/quote'
import type { DeviceList, DeviceProject, InsertResult, Platform } from '@shared/types'
import { adbCandidates, findAdb, runAdb } from './android/adb'
import { IDENTITY_SCRIPT, parseIdentity } from './android/devices'
import { controlMessages } from './android/input'
import { adbIo, startScrcpy } from './android/scrcpy'
import { scrcpyServer } from './android/server'
import { AndroidTracker } from './android/tracker'
import { PicksStore } from './picks'
import { describeProject } from './project'
import { DeviceStreams } from './streams'

export interface DeviceIpcOptions {
  /** devices.json in userData: each project's device. */
  picksFile: string
  /** Deck's resources folder, which holds scrcpy's server. */
  resources: string
  platform: Platform
  home: string
  env: NodeJS.ProcessEnv
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

/** The device panel's main side: Android devices adb sees (looked for only while a tab needs them),
 *  each project's device, scrcpy streams for the devices viewed, and screenshots for Claude. */
export function registerDeviceIpc(opts: DeviceIpcOptions): DeviceIpc {
  const picks = new PicksStore(opts.picksFile)
  let win: BrowserWindow | null = null
  /** null until the first list after watching starts, and again once nothing watches: a tab waits
   *  for the list rather than taking "no devices" for an answer. */
  let list: DeviceList | null = null
  let watchers = 0
  let tracker: AndroidTracker | null = null
  /** Looked for again at each start of watching, so an SDK installed since is found. */
  let adb: string | null = null
  /** Bumped by every start and stop, so a slow look for adb can't start watching late. */
  let generation = 0

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
      const serial = tracker?.serialFor(id)
      if (!adb || !serial) throw new Error("The device isn't connected.")
      return startScrcpy(serial, await scrcpyServer(opts.resources), events, adbIo(adb), signal)
    },
    send: (id, event) => send(IPC.devicesStream, id, event),
  })

  const startWatching = async () => {
    const mine = ++generation
    const found = await findAdb(adbCandidates(opts.env, opts.platform, opts.home))
    if (mine !== generation) return
    adb = found
    if (!found) return publish({ devices: [], problem: 'no-adb' })
    tracker = new AndroidTracker({
      track: () => spawn(found, ['track-devices', '-l'], { stdio: ['ignore', 'pipe', 'pipe'], windowsHide: true }),
      identify: async (serial) => parseIdentity(await runAdb(found, ['-s', serial, 'shell', IDENTITY_SCRIPT], 10_000)),
      publish: (devices, error) => publish({ devices, problem: error && devices.length === 0 ? { error } : null }),
    })
    tracker.start()
  }
  const stopWatching = () => {
    generation++
    tracker?.stop()
    tracker = null
    // No push: every tab that watched has already stopped listening (it calls off() before unwatch).
    list = null
  }

  /** A folder's project, for 30 s: asked whenever a tab comes to the front, and each look runs git
   *  and a few dozen stats. The pick is read fresh every time. */
  const projects = new Map<string, { at: number; value: Promise<{ root: string; android: boolean }> }>()
  const describe = (folder: string) => {
    const now = performance.now()
    const cached = projects.get(folder)
    if (cached && now - cached.at < 30_000) return cached.value
    if (projects.size > 200) projects.clear()
    const value = describeProject(folder, opts.home)
    projects.set(folder, { at: now, value })
    // A later look at the same folder may already have replaced this entry (its own, newer value):
    // a failure must only clear the entry it caused, never a fresher one that's since taken its place.
    value.catch(() => {
      if (projects.get(folder)?.value === value) projects.delete(folder)
    })
    return value
  }

  // ipcMain.on listeners check their arguments: a throw there becomes an error dialog.
  ipcMain.on(IPC.devicesWatch, () => {
    if (++watchers === 1) void startWatching()
  })
  ipcMain.on(IPC.devicesUnwatch, () => {
    if (watchers > 0 && --watchers === 0) stopWatching()
  })
  ipcMain.handle(IPC.devicesList, () => list)
  ipcMain.handle(IPC.devicesProject, async (_e, folder: unknown): Promise<DeviceProject> => {
    if (typeof folder !== 'string' || !isAbsolute(folder)) throw new Error('No folder given.')
    const { root, android } = await describe(folder)
    // An unreadable devices.json must not hide every tab's panel: no pick, then.
    const pick = await picks.get(root).catch((err: unknown) => {
      console.error('devices: reading devices.json failed', err)
      return null
    })
    return { root, android, pick }
  })
  ipcMain.handle(IPC.devicesPick, async (_e, root: unknown, id: unknown) => {
    if (typeof root !== 'string' || !isAbsolute(root) || root.length > 4096 || typeof id !== 'string' || !id || id.length > 4096) {
      throw new Error('No project or device given.')
    }
    await picks.set(root, id)
  })
  ipcMain.on(IPC.devicesView, (_e, id: unknown) => {
    // A stale id (the renderer's own state, or a device that's since disconnected) would only ever
    // fail to start: skip the doomed connecting → retrying → error cycle for it.
    if (typeof id === 'string' && id && list?.devices.some((d) => d.id === id)) streams.view(id)
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
    if (typeof id !== 'string') return
    for (const message of controlMessages(input)) streams.input(id, message)
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
      // adb installed while Deck runs (Android Studio, the platform tools): look again when Deck comes
      // to the front, rather than only when a tab starts needing devices.
      w.on('focus', () => {
        if (watchers > 0 && !tracker) void startWatching()
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
      streams.stopAll()
      generation++
      tracker?.stop()
      tracker = null
    },
  }
}
