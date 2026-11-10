import { EventEmitter } from 'node:events'
import { chmodSync, mkdirSync, mkdtempSync, rmSync, writeFileSync } from 'node:fs'
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
/** Unlike a stub, keeps every listener and can fire it: the lock/resume/unlock-screen/suspend tests
 *  below need the real wiring to run, not just to have been registered. */
const power = vi.hoisted(() => {
  const listeners = new Map<string, Set<() => void>>()
  return {
    on(event: string, fn: () => void) {
      if (!listeners.has(event)) listeners.set(event, new Set())
      listeners.get(event)!.add(fn)
    },
    emit(event: string) {
      for (const fn of [...(listeners.get(event) ?? [])]) fn()
    },
  }
})
vi.mock('electron', () => ({
  ipcMain: {
    handle: (channel: string, fn: (...args: unknown[]) => unknown) => ipc.handlers.set(channel, fn),
    on: (channel: string, fn: (...args: unknown[]) => void) => ipc.listeners.set(channel, fn),
  },
  powerMonitor: power,
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

/** A full PNG signature plus one byte: the smallest input the screenshot check accepts. */
const PNG_BYTES = new Uint8Array([0x89, 0x50, 0x4e, 0x47, 0x0d, 0x0a, 0x1a, 0x0a, 0x00])

// Replaceable so one test can make saveImage fail without disturbing the others.
let saveImageImpl = async (_png: Uint8Array): Promise<string> => '/tmp/Deck clipboard/1/clipboard-ab.png'

// Mutated, not replaced, by the locked/streaming test below: adbCandidates reads opts.env.PATH
// fresh on every devices:watch, so pointing it at a fake adb there (and back at '' after) finds adb
// for just that one test, leaving every other test's "no SDK, empty PATH" environment alone.
const env = { PATH: '' }

// One registration for the file: ipcMain keeps one handler per channel.
const devices = registerDeviceIpc({
  picksFile: join(root, 'devices.json'),
  resources: join(root, 'resources'),
  platform: 'linux',
  home: join(root, 'home'),
  env,
  socketDir: join(root, 'sockets'),
  saveImage: (png) => saveImageImpl(png),
})
const { win, sent } = fakeWindow()
devices.attach(win)
// A backstop for the locked/streaming test below: if it times out, its own finally never runs, and
// without this the fake adb (and the sleep standing in for its persistent track-devices) would be
// left running. afterAll runs even then.
afterAll(() => devices.dispose())

describe('registerDeviceIpc', () => {
  it("answers null until the first list, says so when adb can't be found, and forgets it when nothing needs devices", async () => {
    expect(await call<DeviceList | null>(IPC.devicesList)).toBeNull()
    emit(IPC.devicesWatch)
    await vi.waitFor(() => expect(sent.at(-1)).toEqual([IPC.devicesChanged, [{ devices: [], problem: 'no-adb', iosProblem: null, pending: [] }]]))
    expect(await call<DeviceList | null>(IPC.devicesList)).toEqual({ devices: [], problem: 'no-adb', iosProblem: null, pending: [] })
    const pushes = sent.length
    emit(IPC.devicesUnwatch)
    // Nobody listens any more: nothing is pushed, and the list is unknown again.
    expect(sent).toHaveLength(pushes)
    expect(await call<DeviceList | null>(IPC.devicesList)).toBeNull()
  })

  it("describes a tab's project and remembers the devices picked in it, latest first", async () => {
    // Only git repositories are looked into for an app.
    const app = makeRepo()
    commit(app, 'app', { 'app/src/main/AndroidManifest.xml': '<manifest/>' })
    expect(await call<DeviceProject>(IPC.devicesProject, app)).toEqual({ root: app, android: true, ios: false, picks: [] })
    await call(IPC.devicesPick, app, 'android:8d2e61a')
    await call(IPC.devicesPick, app, 'emulator:Pixel_9')
    expect(await call<DeviceProject>(IPC.devicesProject, app)).toEqual({ root: app, android: true, ios: false, picks: ['emulator:Pixel_9', 'android:8d2e61a'] })
    await expect(call(IPC.devicesProject, 42)).rejects.toThrow('No folder given.')
    await expect(call(IPC.devicesProject, 'relative/app')).rejects.toThrow('No folder given.')
  })

  it('devices:pick rejects a relative root, a non-string id, and an over-long id', async () => {
    await expect(call(IPC.devicesPick, 'relative/app', 'android:1')).rejects.toThrow('No project or device given.')
    await expect(call(IPC.devicesPick, '/abs/app', 42)).rejects.toThrow('No project or device given.')
    await expect(call(IPC.devicesPick, '/abs/app', 'x'.repeat(4097))).rejects.toThrow('No project or device given.')
  })

  it('turns a screenshot into the quoted path Claude reads', async () => {
    expect(await call<InsertResult>(IPC.devicesScreenshot, PNG_BYTES)).toEqual({ text: "'/tmp/Deck clipboard/1/clipboard-ab.png' " })
    expect(await call<InsertResult>(IPC.devicesScreenshot, 'not a png')).toEqual({ error: 'There was no screenshot to add.' })
  })

  it('rejects a screenshot that is too large, or that is not a PNG at all', async () => {
    expect(await call<InsertResult>(IPC.devicesScreenshot, new Uint8Array([]))).toEqual({ error: 'There was no screenshot to add.' })
    expect(await call<InsertResult>(IPC.devicesScreenshot, new Uint8Array([1, 2, 3, 4, 5, 6, 7, 8, 9]))).toEqual({ error: 'There was no screenshot to add.' })
    const huge = new Uint8Array(32 * 1024 * 1024 + 1)
    huge.set(PNG_BYTES)
    expect(await call<InsertResult>(IPC.devicesScreenshot, huge)).toEqual({ error: 'There was no screenshot to add.' })
  })

  it('a screenshot that fails to save says why', async () => {
    const prev = saveImageImpl
    saveImageImpl = async () => {
      throw new Error('disk full')
    }
    try {
      expect(await call<InsertResult>(IPC.devicesScreenshot, PNG_BYTES)).toEqual({ error: "Couldn't save the screenshot for Claude: disk full" })
    } finally {
      saveImageImpl = prev
    }
  })

  it('ignores input it cannot use and views of nothing', () => {
    expect(() => emit(IPC.devicesInput, 'android:1', { type: 'shell' })).not.toThrow()
    expect(() => emit(IPC.devicesView, 42)).not.toThrow()
    expect(() => emit(IPC.devicesUnview, 'android:never-viewed')).not.toThrow()
    expect(() => emit(IPC.devicesKeyframe, null)).not.toThrow()
  })

  it('view, keyframe and input send nothing on devices:stream for a bad id, or one not currently listed', () => {
    const streamSends = () => sent.filter(([channel]) => channel === IPC.devicesStream).length
    const before = streamSends()
    emit(IPC.devicesView, 42)
    emit(IPC.devicesView, '')
    emit(IPC.devicesView, 'android:not-listed')
    emit(IPC.devicesKeyframe, 42)
    emit(IPC.devicesKeyframe, 'android:not-listed')
    emit(IPC.devicesInput, 42, { type: 'text', text: 'hi' })
    emit(IPC.devicesInput, 'android:not-listed', { type: 'text', text: 'hi' })
    expect(streamSends()).toBe(before)
  })

  it("a reload forgets the watches: devices:watch publishes no-adb again, and the old page's late unwatch does nothing", async () => {
    emit(IPC.devicesWatch)
    await vi.waitFor(() => expect(sent.at(-1)).toEqual([IPC.devicesChanged, [{ devices: [], problem: 'no-adb', iosProblem: null, pending: [] }]]))

    win.webContents.emit('did-start-loading')
    expect(await call<DeviceList | null>(IPC.devicesList)).toBeNull()

    const pushes = sent.length
    emit(IPC.devicesUnwatch) // the old page's effect cleanup, arriving late: watchers is already 0
    expect(sent).toHaveLength(pushes)

    emit(IPC.devicesWatch) // the new page watches again
    await vi.waitFor(() => expect(sent.at(-1)).toEqual([IPC.devicesChanged, [{ devices: [], problem: 'no-adb', iosProblem: null, pending: [] }]]))
    emit(IPC.devicesUnwatch) // leave watchers at 0 for later tests
  })

  // Only this test points opts.env.PATH at a real (fake) adb: every other test relies on adb never
  // being found. The device answers "unauthorized" so the tracker lists it without ever asking it
  // what it is (no identify() round trip to script), and then just sleeps, so the one device stays
  // listed for as long as the test needs it.
  it.skipIf(process.platform === 'win32')('locks and resumes streaming; waking still locked changes nothing', async () => {
    const fakeAdbDir = join(root, 'fake-adb')
    mkdirSync(fakeAdbDir, { recursive: true })
    const fakeAdb = join(fakeAdbDir, 'adb')
    // exec, not a plain `sleep`: that would leave sleep running as an orphaned grandchild once the
    // tracker kills this script's shell (SIGTERM only reaches the shell, not its own children). exec
    // replaces the shell with sleep in the same process, so killing this pid kills the sleep. 60 s,
    // not longer: the afterAll above is a backstop, not the only way this ever stops.
    writeFileSync(fakeAdb, ['#!/bin/sh', 'if [ "$1" = "track-devices" ]; then', "  printf '0013FAKE01\\tunauthorized'", '  exec sleep 60', 'fi', 'exit 0', ''].join('\n'))
    chmodSync(fakeAdb, 0o755)

    env.PATH = fakeAdbDir
    try {
      emit(IPC.devicesWatch)
      await vi.waitFor(
        () =>
          expect(sent.at(-1)).toEqual([
            IPC.devicesChanged,
            [{ devices: [{ id: 'android:FAKE01', kind: 'android', name: 'FAKE01', detail: 'USB', state: 'unauthorized' }], problem: null, iosProblem: null, pending: [] }],
          ]),
        { timeout: 3000 },
      )

      power.emit('lock-screen')
      const afterLock = sent.length
      emit(IPC.devicesView, 'android:FAKE01') // paused: view() answers at once, without starting anything
      expect(sent.slice(afterLock)).toEqual([[IPC.devicesStream, ['android:FAKE01', { type: 'state', state: 'connecting' }]]])

      const afterView = sent.length
      power.emit('resume') // woke still locked (no unlock-screen yet): stays stopped
      expect(sent.length).toBe(afterView)

      power.emit('unlock-screen') // starts the stream; there's no scrcpy server in `resources`, so it fails
      await vi.waitFor(() => expect(sent.length).toBeGreaterThanOrEqual(afterView + 2), { timeout: 3000 })
      expect(sent.slice(afterView, afterView + 2)).toEqual([
        [IPC.devicesStream, ['android:FAKE01', { type: 'state', state: 'connecting' }]],
        [IPC.devicesStream, ['android:FAKE01', { type: 'state', state: 'reconnecting' }]],
      ])
    } finally {
      emit(IPC.devicesUnview, 'android:FAKE01')
      emit(IPC.devicesUnwatch)
      env.PATH = ''
    }
  }, 10_000)

  it.skipIf(process.platform === 'win32')('looks for adb again when Deck comes to the front, while it had found none', async () => {
    const lateAdbDir = join(root, 'late-adb')
    mkdirSync(lateAdbDir, { recursive: true })
    writeFileSync(join(lateAdbDir, 'adb'), ['#!/bin/sh', 'if [ "$1" = "track-devices" ]; then', "  printf '0013FAKE03\\tunauthorized'", '  exec sleep 60', 'fi', 'exit 0', ''].join('\n'))
    chmodSync(join(lateAdbDir, 'adb'), 0o755)
    try {
      emit(IPC.devicesWatch)
      await vi.waitFor(() => expect(sent.at(-1)).toEqual([IPC.devicesChanged, [{ devices: [], problem: 'no-adb', iosProblem: null, pending: [] }]]))
      env.PATH = lateAdbDir // the platform tools are installed now
      win.emit('focus')
      await vi.waitFor(
        () => expect(sent.at(-1)).toEqual([IPC.devicesChanged, [{ devices: [expect.objectContaining({ id: 'android:FAKE03', state: 'unauthorized' })], problem: null, iosProblem: null, pending: [] }]]),
        { timeout: 3000 },
      )
    } finally {
      emit(IPC.devicesUnwatch)
      env.PATH = ''
    }
  })

  it.skipIf(process.platform === 'win32')("answers null while adb's server is still starting, and pushes nothing before the first list", async () => {
    const slowAdbDir = join(root, 'slow-adb')
    mkdirSync(slowAdbDir, { recursive: true })
    // A track-devices that lists after half a second, like adb starting its server.
    writeFileSync(join(slowAdbDir, 'adb'), ['#!/bin/sh', 'if [ "$1" = "track-devices" ]; then', '  sleep 0.5', "  printf '0013FAKE02\\tunauthorized'", '  exec sleep 60', 'fi', 'exit 0', ''].join('\n'))
    chmodSync(join(slowAdbDir, 'adb'), 0o755)
    env.PATH = slowAdbDir
    try {
      const pushes = () => sent.filter(([channel]) => channel === IPC.devicesChanged).length
      const before = pushes()
      emit(IPC.devicesWatch)
      await new Promise((resolve) => setTimeout(resolve, 200))
      expect(await call<DeviceList | null>(IPC.devicesList)).toBeNull()
      expect(pushes()).toBe(before)
      await vi.waitFor(
        () => expect(sent.at(-1)).toEqual([IPC.devicesChanged, [{ devices: [expect.objectContaining({ id: 'android:FAKE02', state: 'unauthorized' })], problem: null, iosProblem: null, pending: [] }]]),
        { timeout: 3000 },
      )
      expect(await call<DeviceList | null>(IPC.devicesList)).toEqual({ devices: [expect.objectContaining({ id: 'android:FAKE02' })], problem: null, iosProblem: null, pending: [] })
    } finally {
      emit(IPC.devicesUnwatch)
      env.PATH = ''
    }
  })
})
