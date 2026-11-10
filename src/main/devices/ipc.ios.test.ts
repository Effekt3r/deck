import { EventEmitter } from 'node:events'
import { chmodSync, mkdirSync, mkdtempSync, rmSync, writeFileSync } from 'node:fs'
import { tmpdir } from 'node:os'
import { join } from 'node:path'
import { afterAll, beforeAll, describe, expect, it, vi } from 'vitest'
import { IPC } from '@shared/channels'
import type { DeviceList } from '@shared/types'
import type { BrowserWindow } from 'electron'
import { type DeviceIpc, registerDeviceIpc } from './ipc'

const ipc = vi.hoisted(() => ({
  handlers: new Map<string, (...args: unknown[]) => unknown>(),
  listeners: new Map<string, (...args: unknown[]) => void>(),
}))
vi.mock('electron', () => ({
  ipcMain: {
    handle: (channel: string, fn: (...args: unknown[]) => unknown) => ipc.handlers.set(channel, fn),
    on: (channel: string, fn: (...args: unknown[]) => void) => ipc.listeners.set(channel, fn),
  },
  powerMonitor: { on: () => {} },
}))

describe.skipIf(process.platform === 'win32')('registerDeviceIpc on macOS', () => {
  // Everything that touches the filesystem or spawns a child lives in beforeAll, not here: a
  // describe.skipIf(true) body still runs (for collection) on Windows, but its hooks don't, so code
  // here directly would create a temp folder that's never cleaned up there.
  let root: string
  let devices: DeviceIpc

  beforeAll(() => {
    root = mkdtempSync(join(tmpdir(), 'deck-ios-ipc-'))
    const libexec = join(root, 'libexec')
    mkdirSync(libexec)
    // Prints a first list with one booted simulator, then stays up as the real notifier does.
    writeFileSync(join(libexec, 'idb_companion'), [
      '#!/bin/sh',
      `echo '[{"udid":"FAKE-UDID","name":"iPhone 17","state":"Booted","type":"Simulator","os_version":"iOS 27.0"}]'`,
      'exec sleep 60',
      '',
    ].join('\n'))
    writeFileSync(join(libexec, 'sim-video'), '#!/bin/sh\n')
    chmodSync(join(libexec, 'idb_companion'), 0o755)
    chmodSync(join(libexec, 'sim-video'), 0o755)

    // A real adb (Homebrew's android-platform-tools) must never be reached: on darwin, adbCandidates
    // adds /opt/homebrew/bin and /usr/local/bin even with PATH empty, so a Mac with the platform
    // tools installed would otherwise run a real `adb track-devices`, taking over the adb server and
    // asking connected phones. ANDROID_HOME puts a fake one first in the candidate list instead.
    const platformTools = join(root, 'sdk', 'platform-tools')
    mkdirSync(platformTools, { recursive: true })
    writeFileSync(join(platformTools, 'adb'), '#!/bin/sh\nprintf 0000\nexec sleep 60\n')
    chmodSync(join(platformTools, 'adb'), 0o755)

    const sent: [string, unknown[]][] = []
    const webContents = Object.assign(new EventEmitter(), { isDestroyed: () => false, send: (c: string, ...a: unknown[]) => sent.push([c, a]) })
    const win = Object.assign(new EventEmitter(), { isDestroyed: () => false, webContents }) as unknown as BrowserWindow
    devices = registerDeviceIpc({
      picksFile: join(root, 'devices.json'),
      resources: join(root, 'resources'),
      platform: 'darwin',
      home: join(root, 'home'),
      env: { PATH: '', ANDROID_HOME: join(root, 'sdk'), DECK_IDB_COMPANION: join(libexec, 'idb_companion') },
      socketDir: join(root, 's'),
      saveImage: async () => '',
    })
    devices.attach(win)
  })
  afterAll(() => {
    devices?.dispose()
    rmSync(root, { recursive: true, force: true })
  })

  it('lists the simulators beside adb (a fake one, so a real Homebrew adb is never touched)', async () => {
    ipc.listeners.get(IPC.devicesWatch)!({})
    await vi.waitFor(async () => {
      const list = (await ipc.handlers.get(IPC.devicesList)!({})) as DeviceList | null
      expect(list).toEqual({
        devices: [{ id: 'simulator:FAKE-UDID', kind: 'simulator', name: 'iPhone 17', detail: 'Simulator · iOS 27.0', state: 'ready' }],
        problem: null,
        iosProblem: null,
        pending: [],
      })
    }, { timeout: 15_000 })
    ipc.listeners.get(IPC.devicesUnwatch)!({})
    expect(await ipc.handlers.get(IPC.devicesList)!({})).toBeNull()
  }, 20_000)
})
