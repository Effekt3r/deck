import { EventEmitter } from 'node:events'
import { chmodSync, mkdirSync, mkdtempSync, readFileSync, rmSync, writeFileSync } from 'node:fs'
import { tmpdir } from 'node:os'
import { join } from 'node:path'
import { afterAll, beforeAll, describe, expect, it, vi } from 'vitest'
import { IPC } from '@shared/channels'
import type { DeviceActionResult, DeviceInfo, DeviceList } from '@shared/types'
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
  shell: { openExternal: async () => {} },
}))

const call = <T>(channel: string, ...args: unknown[]) => Promise.resolve(ipc.handlers.get(channel)!({}, ...args)) as Promise<T>
const emit = (channel: string, ...args: unknown[]) => ipc.listeners.get(channel)!({}, ...args)
const list = () => call<DeviceList | null>(IPC.devicesList)
const start = (id: unknown) => call<DeviceActionResult>(IPC.devicesStart, id)
const stop = (id: unknown) => call<DeviceActionResult>(IPC.devicesStop, id)

const PIXEL: DeviceInfo = { id: 'emulator:Pixel_9', kind: 'emulator', name: 'Pixel 9', detail: 'Emulator · Android 15', state: 'ready' }
const SIM: DeviceInfo = { id: 'simulator:DEADBEEF-DEAD-BEEF-DEAD-BEEFDEADBEEF', kind: 'simulator', name: 'iPhone 17', detail: 'Simulator · iOS 27.0', state: 'ready' }

// Shell scripts stand in for the SDK's adb and emulator and for idb_companion, never the real ones
// (a real adb would take over the adb server; real simulators are Franco's). They share a folder of
// marks: the emulator lists the AVDs in `avds` and, started, marks `started` and stays up; adb's
// track-devices lists emulator-5554 from then until `emu kill` (which ends the emulator); idb's
// notifier lists DEADBEEF-DEAD-BEEF-DEAD-BEEFDEADBEEF booted while `booted` is there, which `--boot` and `--shutdown` set and
// clear. Every call goes to `calls`, one line each.
describe.skipIf(process.platform === 'win32')('registerDeviceIpc: starting and stopping', () => {
  let root: string
  let marks: string
  let set: string
  let devices: DeviceIpc
  let win: BrowserWindow
  const calls = () => readFileSync(join(marks, 'calls'), 'utf8').split('\n')
  const tool = (path: string, body: string[]) => {
    mkdirSync(join(path, '..'), { recursive: true })
    writeFileSync(path, ['#!/bin/sh', `M='${marks}'`, ...body, ''].join('\n'))
    chmodSync(path, 0o755)
  }

  beforeAll(() => {
    root = mkdtempSync(join(tmpdir(), 'deck-start-ipc-'))
    marks = join(root, 'marks')
    set = join(root, 'set')
    mkdirSync(marks)
    writeFileSync(join(marks, 'avds'), 'Pixel_9\nBroken_AVD\n')
    writeFileSync(join(marks, 'calls'), '')
    tool(join(root, 'sdk', 'emulator', 'emulator'), [
      'echo "emulator $*" >> "$M/calls"',
      'if [ "$1" = "-list-avds" ]; then cat "$M/avds"; exit 0; fi',
      'if [ "$2" = "Broken_AVD" ]; then exit 1; fi',
      'echo $$ > "$M/emulator.pid"',
      'touch "$M/started"',
      'exec sleep 30',
    ])
    tool(join(root, 'sdk', 'platform-tools', 'adb'), [
      'echo "adb $1 $2 $3 $4" >> "$M/calls"',
      'if [ "$1" = "track-devices" ]; then',
      "  printf '0000'",
      '  while [ ! -f "$M/started" ]; do sleep 0.05; done',
      "  printf '0015emulator-5554\\tdevice\\n'",
      '  while [ ! -f "$M/killed" ]; do sleep 0.05; done',
      "  printf '0000'",
      '  exec sleep 30',
      'fi',
      'if [ "$3" = "shell" ]; then',
      "  printf 'serial=EMULATOR1\\nmaker=Google\\nmodel=sdk_gphone64_arm64\\nrelease=15\\nbooted=1\\navd=Pixel_9\\navd_old=\\nname=\\n'",
      '  exit 0',
      'fi',
      'if [ "$3" = "emu" ]; then',
      '  touch "$M/killed"',
      '  kill "$(cat "$M/emulator.pid")"',
      "  echo 'OK: killing emulator, bye bye'",
      'fi',
      'exit 0',
    ])
    tool(join(root, 'libexec', 'idb_companion'), [
      'echo "idb $*" >> "$M/calls"',
      'state() { if [ -f "$M/booted" ]; then echo Booted; else echo Shutdown; fi; }',
      'list() { echo "[{\\"udid\\":\\"DEADBEEF-DEAD-BEEF-DEAD-BEEFDEADBEEF\\",\\"name\\":\\"iPhone 17\\",\\"state\\":\\"$1\\",\\"type\\":\\"Simulator\\",\\"os_version\\":\\"iOS 27.0\\"},{\\"udid\\":\\"BADDECAF-BADD-ECAF-BADD-ECAFBADDECAF\\",\\"name\\":\\"iPhone Broken\\",\\"state\\":\\"Shutdown\\",\\"type\\":\\"Simulator\\",\\"os_version\\":\\"iOS 27.0\\"}]"; }',
      'case "$1" in',
      '  --notify)',
      '    last=$(state); list "$last"',
      '    while :; do now=$(state); if [ "$now" != "$last" ]; then list "$now"; last=$now; fi; sleep 0.05; done ;;',
      '  --boot)',
      '    if [ "$2" = "BADDECAF-BADD-ECAF-BADD-ECAFBADDECAF" ]; then echo "2026-11-25 15:22:03.218+0200 BADDECAF-BADD-ECAF-BADD-ECAFBADDECAF could not be resolved to any target" >&2; exit 1; fi',
      // The notifier says Booted at once; the boot itself goes on a while, as a real first boot does.
      '    touch "$M/booted"; sleep 1 ;;',
      '  --shutdown) rm -f "$M/booted" ;;',
      'esac',
    ])
    writeFileSync(join(root, 'libexec', 'sim-video'), '#!/bin/sh\n')
    chmodSync(join(root, 'libexec', 'sim-video'), 0o755)

    const webContents = Object.assign(new EventEmitter(), { isDestroyed: () => false, send: () => {} })
    win = Object.assign(new EventEmitter(), { isDestroyed: () => false, webContents }) as unknown as BrowserWindow
    devices = registerDeviceIpc({
      picksFile: join(root, 'devices.json'),
      resources: join(root, 'resources'),
      platform: 'darwin',
      home: join(root, 'home'),
      env: { PATH: '', ANDROID_HOME: join(root, 'sdk'), DECK_IDB_COMPANION: join(root, 'libexec', 'idb_companion'), DECK_SIMULATOR_SET: set },
      socketDir: join(root, 's'),
      iphoneHelper: null,
      saveImage: async () => '',
    })
    devices.attach(win)
    emit(IPC.devicesWatch)
  })
  afterAll(() => {
    emit(IPC.devicesUnwatch)
    devices?.dispose()
    // The emulator stand-in is detached, as a real one is: end it if a test didn't.
    try {
      process.kill(Number(readFileSync(join(marks, 'emulator.pid'), 'utf8')))
    } catch {
      // never started, or already ended
    }
    rmSync(root, { recursive: true, force: true })
  })

  it('offers the AVDs and the shut-down simulators, emulators first, each by name', async () => {
    await vi.waitFor(async () => expect((await list())?.startable).toEqual([
      { id: 'emulator:Broken_AVD', kind: 'emulator', name: 'Broken AVD', detail: 'Emulator' },
      { id: 'emulator:Pixel_9', kind: 'emulator', name: 'Pixel 9', detail: 'Emulator' },
      { id: 'simulator:DEADBEEF-DEAD-BEEF-DEAD-BEEFDEADBEEF', kind: 'simulator', name: 'iPhone 17', detail: 'Simulator · iOS 27.0' },
      { id: 'simulator:BADDECAF-BADD-ECAF-BADD-ECAFBADDECAF', kind: 'simulator', name: 'iPhone Broken', detail: 'Simulator · iOS 27.0' },
    ]), { timeout: 5000 })
    expect((await list())?.noAvds).toBe(false)
  })

  it('reads the AVDs again when Deck comes to the front, and says when there are none', async () => {
    writeFileSync(join(marks, 'avds'), '')
    win.emit('focus')
    await vi.waitFor(async () => expect((await list())?.noAvds).toBe(true), { timeout: 5000 })
    expect((await list())?.startable.filter((d) => d.kind === 'emulator')).toEqual([])
    writeFileSync(join(marks, 'avds'), 'Pixel_9\nBroken_AVD\n')
    win.emit('focus')
    await vi.waitFor(async () => expect((await list())?.startable.filter((d) => d.kind === 'emulator').map((d) => d.id)).toEqual(['emulator:Broken_AVD', 'emulator:Pixel_9']), { timeout: 5000 })
    expect((await list())?.noAvds).toBe(false)
  })

  it('starts an emulator: starting until adb lists it, then an ordinary device; Stop closes it', async () => {
    expect(await start('emulator:Pixel_9')).toBeNull()
    expect((await list())?.startable).toContainEqual({ id: 'emulator:Pixel_9', kind: 'emulator', name: 'Pixel 9', detail: 'Emulator', starting: true })
    expect(await start('emulator:Pixel_9')).toBeNull() // a second click changes nothing
    await vi.waitFor(async () => expect((await list())?.devices).toEqual([PIXEL]), { timeout: 5000 })
    expect((await list())?.startable.map((d) => d.id)).not.toContain('emulator:Pixel_9')
    expect(calls().filter((c) => c === 'emulator -avd Pixel_9')).toHaveLength(1)
    expect(await start('emulator:Pixel_9')).toBeNull() // running: nothing to do

    expect(await stop('emulator:Pixel_9')).toBeNull()
    expect(calls()).toContain('adb -s emulator-5554 emu kill')
    await vi.waitFor(async () => expect((await list())?.devices).toEqual([]), { timeout: 5000 })
    expect((await list())?.startable.map((d) => d.id)).toContain('emulator:Pixel_9')
  })

  it("boots a simulator in the private set: booting until idb's boot ends, then ready; Stop shuts it down", async () => {
    expect(await start('simulator:DEADBEEF-DEAD-BEEF-DEAD-BEEFDEADBEEF')).toBeNull()
    await vi.waitFor(async () => expect((await list())?.devices).toEqual([{ ...SIM, state: 'booting' }]), { timeout: 5000 })
    expect((await list())?.startable.map((d) => d.id)).not.toContain('simulator:DEADBEEF-DEAD-BEEF-DEAD-BEEFDEADBEEF')
    await vi.waitFor(async () => expect((await list())?.devices).toEqual([SIM]), { timeout: 5000 })
    expect(calls()).toContain(`idb --boot DEADBEEF-DEAD-BEEF-DEAD-BEEFDEADBEEF --device-set-path ${set} --log-level info`)

    expect(await stop('simulator:DEADBEEF-DEAD-BEEF-DEAD-BEEFDEADBEEF')).toBeNull()
    expect(calls()).toContain(`idb --shutdown DEADBEEF-DEAD-BEEF-DEAD-BEEFDEADBEEF --device-set-path ${set} --log-level info`)
    await vi.waitFor(async () => expect((await list())?.devices).toEqual([]), { timeout: 5000 })
  })

  it("a start that fails says why, and starting it again clears that (Try again)", async () => {
    expect(await start('emulator:Broken_AVD')).toBeNull()
    expect(await start('simulator:BADDECAF-BADD-ECAF-BADD-ECAFBADDECAF')).toBeNull()
    await vi.waitFor(async () => expect((await list())?.startable).toEqual(expect.arrayContaining([
      { id: 'emulator:Broken_AVD', kind: 'emulator', name: 'Broken AVD', detail: 'Emulator', error: 'The emulator stopped (exit code 1).' },
      { id: 'simulator:BADDECAF-BADD-ECAF-BADD-ECAFBADDECAF', kind: 'simulator', name: 'iPhone Broken', detail: 'Simulator · iOS 27.0', error: 'BADDECAF-BADD-ECAF-BADD-ECAFBADDECAF could not be resolved to any target' },
    ])), { timeout: 5000 })
    expect(await start('emulator:Broken_AVD')).toBeNull()
    expect((await list())?.startable).toContainEqual({ id: 'emulator:Broken_AVD', kind: 'emulator', name: 'Broken AVD', detail: 'Emulator', starting: true })
  })

  it("refuses what isn't offered, and stops only a running emulator or simulator", async () => {
    for (const id of [42, 'emulator:Not_There', 'emulator:-help', 'android:8d2e61a']) expect(await start(id)).toEqual({ error: 'Deck no longer sees it.' })
    for (const id of [42, 'android:8d2e61a', 'emulator:Pixel_9', 'simulator:DEADBEEF-DEAD-BEEF-DEAD-BEEFDEADBEEF']) {
      expect(await stop(id)).toEqual({ error: 'Only a running emulator or simulator can be stopped.' })
    }
  })

  it('starts nothing while nothing watches', async () => {
    emit(IPC.devicesUnwatch)
    expect(await start('simulator:DEADBEEF-DEAD-BEEF-DEAD-BEEFDEADBEEF')).toEqual({ error: "Deck isn't looking for devices." })
    emit(IPC.devicesWatch) // for afterAll's unwatch
  })
})
