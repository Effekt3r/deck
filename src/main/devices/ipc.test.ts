import { EventEmitter } from 'node:events'
import { mkdtempSync, rmSync } from 'node:fs'
import { tmpdir } from 'node:os'
import { join } from 'node:path'
import { afterAll, describe, expect, it, vi } from 'vitest'
import { IPC } from '@shared/channels'
import type { DeviceList, DeviceProject, InsertResult } from '@shared/types'
import type { BrowserWindow } from 'electron'
import { commit, makeRepo, removeRepos } from '../git/test-repo'
import { registerDeviceIpc } from './ipc'

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

const root = mkdtempSync(join(tmpdir(), 'deck-devices-ipc-'))
afterAll(() => {
  rmSync(root, { recursive: true, force: true })
  removeRepos()
})

/** A window that records what it's sent. */
function fakeWindow() {
  const sent: [string, unknown[]][] = []
  const webContents = Object.assign(new EventEmitter(), {
    isDestroyed: () => false,
    send: (channel: string, ...args: unknown[]) => sent.push([channel, args]),
  })
  const win = Object.assign(new EventEmitter(), { isDestroyed: () => false, webContents })
  return { win: win as unknown as BrowserWindow, sent }
}

const call = <T>(channel: string, ...args: unknown[]) => Promise.resolve(ipc.handlers.get(channel)!({}, ...args)) as Promise<T>
const emit = (channel: string, ...args: unknown[]) => ipc.listeners.get(channel)!({}, ...args)

// One registration for the file: ipcMain keeps one handler per channel. No SDK in `home` and an
// empty PATH: Deck finds no adb.
const devices = registerDeviceIpc({
  picksFile: join(root, 'devices.json'),
  resources: join(root, 'resources'),
  platform: 'linux',
  home: join(root, 'home'),
  env: { PATH: '' },
  saveImage: async () => '/tmp/Deck clipboard/1/clipboard-ab.png',
})
const { win, sent } = fakeWindow()
devices.attach(win)

describe('registerDeviceIpc', () => {
  it("says so when adb can't be found, and forgets it when nothing needs devices", async () => {
    emit(IPC.devicesWatch)
    await vi.waitFor(() => expect(sent.at(-1)).toEqual([IPC.devicesChanged, [{ devices: [], problem: 'no-adb' }]]))
    expect(await call<DeviceList>(IPC.devicesList)).toEqual({ devices: [], problem: 'no-adb' })
    emit(IPC.devicesUnwatch)
    expect(sent.at(-1)).toEqual([IPC.devicesChanged, [{ devices: [], problem: null }]])
  })

  it("describes a tab's project and remembers its device", async () => {
    // Only git repositories are looked into for an app.
    const app = makeRepo()
    commit(app, 'app', { 'app/src/main/AndroidManifest.xml': '<manifest/>' })
    expect(await call<DeviceProject>(IPC.devicesProject, app)).toEqual({ root: app, android: true, pick: null })
    await call(IPC.devicesPick, app, 'android:8d2e61a')
    expect(await call<DeviceProject>(IPC.devicesProject, app)).toEqual({ root: app, android: true, pick: 'android:8d2e61a' })
    await expect(call(IPC.devicesProject, 42)).rejects.toThrow('No folder given.')
    await expect(call(IPC.devicesProject, 'relative/app')).rejects.toThrow('No folder given.')
  })

  it('turns a screenshot into the quoted path Claude reads', async () => {
    expect(await call<InsertResult>(IPC.devicesScreenshot, new Uint8Array([137, 80]))).toEqual({ text: "'/tmp/Deck clipboard/1/clipboard-ab.png' " })
    expect(await call<InsertResult>(IPC.devicesScreenshot, 'not a png')).toEqual({ error: 'There was no screenshot to add.' })
  })

  it('ignores input it cannot use and views of nothing', () => {
    expect(() => emit(IPC.devicesInput, 'android:1', { type: 'shell' })).not.toThrow()
    expect(() => emit(IPC.devicesView, 42)).not.toThrow()
    expect(() => emit(IPC.devicesUnview, 'android:never-viewed')).not.toThrow()
    expect(() => emit(IPC.devicesKeyframe, null)).not.toThrow()
  })
})
