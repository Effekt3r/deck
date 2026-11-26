import { EventEmitter } from 'node:events'
import { chmodSync, existsSync, mkdirSync, mkdtempSync, readdirSync, readFileSync, rmSync, writeFileSync } from 'node:fs'
import { tmpdir } from 'node:os'
import { join } from 'node:path'
import { afterAll, beforeAll, beforeEach, describe, expect, it, vi } from 'vitest'
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

/** Boots under way, as Deck sees them: bootSimulator itself runs (against the idb_companion
 *  stand-in below), and this counts each boot down as it settles. ipc.ts's own handlers on the same
 *  boot run in that turn too, so once a test sees the count drop, Deck has dealt with that boot's end. */
const boots = vi.hoisted(() => ({ running: 0 }))
vi.mock('./ios/boot', async (importOriginal) => {
  const real = await importOriginal<typeof import('./ios/boot')>()
  return {
    ...real,
    bootSimulator: (...args: Parameters<typeof real.bootSimulator>): Promise<void> => {
      boots.running++
      const boot = real.bootSimulator(...args)
      const settled = () => {
        boots.running--
      }
      boot.then(settled, settled)
      return boot
    },
  }
})

const call = <T>(channel: string, ...args: unknown[]) => Promise.resolve(ipc.handlers.get(channel)!({}, ...args)) as Promise<T>
const emit = (channel: string, ...args: unknown[]) => ipc.listeners.get(channel)!({}, ...args)
const list = () => call<DeviceList | null>(IPC.devicesList)
const start = (id: unknown) => call<DeviceActionResult>(IPC.devicesStart, id)
const stop = (id: unknown) => call<DeviceActionResult>(IPC.devicesStop, id)

const PIXEL: DeviceInfo = { id: 'emulator:Pixel_9', kind: 'emulator', name: 'Pixel 9', detail: 'Emulator · Android 15', state: 'ready' }
const SIM: DeviceInfo = { id: 'simulator:DEADBEEF-DEAD-BEEF-DEAD-BEEFDEADBEEF', kind: 'simulator', name: 'iPhone 17', detail: 'Simulator · iOS 27.0', state: 'ready' }
/** SIM as it's offered while shut down. */
const SIM_OFFERED = { id: SIM.id, kind: 'simulator' as const, name: 'iPhone 17', detail: 'Simulator · iOS 27.0' }

// idb_companion's stand-in, for each registration's `tool` (`$M` is its folder of marks): the
// notifier lists DEADBEEF-DEAD-BEEF-DEAD-BEEFDEADBEEF booted while `booted` is there, which `--boot`
// and `--shutdown` set and clear, and BADDECAF-BADD-ECAF-BADD-ECAFBADDECAF always shut down (booting
// it fails at once).
const IDB_COMPANION = [
  'echo "idb $*" >> "$M/calls"',
  'state() { if [ -f "$M/booted" ]; then echo Booted; else echo Shutdown; fi; }',
  'list() { echo "[{\\"udid\\":\\"DEADBEEF-DEAD-BEEF-DEAD-BEEFDEADBEEF\\",\\"name\\":\\"iPhone 17\\",\\"state\\":\\"$1\\",\\"type\\":\\"Simulator\\",\\"os_version\\":\\"iOS 27.0\\"},{\\"udid\\":\\"BADDECAF-BADD-ECAF-BADD-ECAFBADDECAF\\",\\"name\\":\\"iPhone Broken\\",\\"state\\":\\"Shutdown\\",\\"type\\":\\"Simulator\\",\\"os_version\\":\\"iOS 27.0\\"}]"; }',
  'case "$1" in',
  '  --notify)',
  '    last=$(state); list "$last"',
  '    while :; do now=$(state); if [ "$now" != "$last" ]; then list "$now"; last=$now; fi; sleep 0.05; done ;;',
  '  --boot)',
  '    if [ "$2" = "BADDECAF-BADD-ECAF-BADD-ECAFBADDECAF" ]; then echo "2026-11-25 15:22:03.218+0200 BADDECAF-BADD-ECAF-BADD-ECAFBADDECAF could not be resolved to any target" >&2; exit 1; fi',
  // Each --boot of DEADBEEF counts itself (bootn), so a test can steer one specific invocation
  // (boot-hold-<n>, boot-fail-<n>, boot-fail-up-<n>) while others run as before (an unheld one just
  // sleeps 1 s, as a real first boot's remaining time would, after the notifier already says
  // Booted), and wait for it to end: it marks boot-done-<n> as it exits, whatever the outcome.
  '    n=$(( $(cat "$M/bootn" 2>/dev/null || echo 0) + 1 )); echo "$n" > "$M/bootn"',
  '    trap \': > "$M/boot-done-$n"\' EXIT',
  '    touch "$M/booted"',
  '    if [ -f "$M/boot-hold-$n" ]; then while [ -f "$M/boot-hold-$n" ]; do sleep 0.05; done; else sleep 1; fi',
  // "failed" (not just "died"), so idb_companion's own asFailure() (the FAILURE regex in
  // process.ts) recognises this as the line to show, not the generic exit-code wording.
  // boot-fail-<n>: the simulator goes down, and the command fails a moment later. The short sleep
  // gives the (separately polling, here) notifier a moment to report Shutdown first, the order seen
  // in real use for a boot that works: idb's own notifier learns of a state change before its
  // --boot/--shutdown command actually tears down and exits, not in the same instant.
  '    if [ -f "$M/boot-fail-$n" ]; then rm -f "$M/booted"; sleep 0.2; echo "2026-11-26 00:00:00.000+0200 DEADBEEF-DEAD-BEEF-DEAD-BEEFDEADBEEF failed during boot" >&2; exit 1; fi',
  // boot-fail-up-<n>: the command fails first, with the simulator still up; the test takes it down
  // (removes `booted`), or doesn't.
  '    if [ -f "$M/boot-fail-up-$n" ]; then echo "2026-11-26 00:00:00.000+0200 DEADBEEF-DEAD-BEEF-DEAD-BEEFDEADBEEF failed during boot" >&2; exit 1; fi',
  '    ;;',
  '  --shutdown)',
  '    if [ -f "$M/shutdown-fail" ]; then echo "2026-11-26 00:00:00.000+0200 Target failed to shut down: Simulator is busy booting." >&2; exit 1; fi',
  '    rm -f "$M/booted" ;;',
  'esac',
]

/** Waits until DEADBEEF's boot `n` (as the stand-in counts them) has ended and Deck has dealt with
 *  it: the stand-in marked boot-done-<n> as it exited (a moment before Deck hears it has), and only
 *  `left` boots are still under way for Deck (`boots`). */
const bootEnded = (marks: string, n: number, left = 0) =>
  vi.waitFor(() => {
    expect(existsSync(join(marks, `boot-done-${n}`))).toBe(true)
    expect(boots.running).toBe(left)
  }, { timeout: 5000 })

// Shell scripts stand in for the SDK's adb and emulator and for idb_companion, never the real ones
// (a real adb would take over the adb server; real simulators are Franco's). They share a folder of
// marks: the emulator lists the AVDs in `avds` and, started, marks `started` and stays up; adb's
// track-devices lists emulator-5554 from then until `emu kill` (which ends the emulator); idb's is
// IDB_COMPANION above. Every call goes to `calls`, one line each.
describe.skipIf(process.platform === 'win32')('registerDeviceIpc: starting and stopping', () => {
  let root: string
  let marks: string
  let set: string
  let devices: DeviceIpc
  let win: BrowserWindow
  /** What Deck sent the window, each [channel, args]. */
  const sent: [string, unknown[]][] = []
  const streamEvents = (id: string) => sent.filter(([channel, args]) => channel === IPC.devicesStream && args[0] === id)
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
      'if [ "$2" = "Broken_AVD" ]; then echo "ERROR        | Unknown AVD name [Broken_AVD], use -list-avds to see valid list."; exit 1; fi',
      'echo $$ > "$M/emulator.pid"',
      'touch "$M/started"',
      'exec sleep 30',
    ])
    tool(join(root, 'sdk', 'platform-tools', 'adb'), [
      'echo "adb $1 $2 $3 $4" >> "$M/calls"',
      'if [ "$1" = "track-devices" ]; then',
      "  printf '0000'",
      // Loops over as many start/kill cycles as the tests ask for (one persistent track-devices, as
      // adb's really would be), clearing each cycle's marks so the next start/kill pair is its own.
      '  while :; do',
      '    while [ ! -f "$M/started" ]; do sleep 0.05; done',
      "    printf '0015emulator-5554\\tdevice\\n'",
      '    while [ ! -f "$M/killed" ]; do sleep 0.05; done',
      "    printf '0000'",
      '    rm -f "$M/started" "$M/killed"',
      '  done',
      'fi',
      'if [ "$3" = "shell" ]; then',
      "  printf 'serial=EMULATOR1\\nmaker=Google\\nmodel=sdk_gphone64_arm64\\nrelease=15\\nbooted=1\\navd=Pixel_9\\navd_old=\\nname=\\n'",
      '  exit 0',
      'fi',
      'if [ "$3" = "emu" ]; then',
      '  if [ -f "$M/kill-fail" ]; then echo "error: could not connect to TCP port 5554: Connection refused" >&2; exit 1; fi',
      '  touch "$M/killed"',
      '  kill "$(cat "$M/emulator.pid")"',
      "  echo 'OK: killing emulator, bye bye'",
      'fi',
      'exit 0',
    ])
    tool(join(root, 'libexec', 'idb_companion'), IDB_COMPANION)
    writeFileSync(join(root, 'libexec', 'sim-video'), '#!/bin/sh\n')
    chmodSync(join(root, 'libexec', 'sim-video'), 0o755)

    const webContents = Object.assign(new EventEmitter(), { isDestroyed: () => false, send: (channel: string, ...args: unknown[]) => sent.push([channel, args]) })
    win = Object.assign(new EventEmitter(), { isDestroyed: () => false, webContents }) as unknown as BrowserWindow
    devices = registerDeviceIpc({
      picksFile: join(root, 'devices.json'),
      resources: join(root, 'resources'),
      platform: 'darwin',
      home: join(root, 'home'),
      env: { PATH: '', ANDROID_HOME: join(root, 'sdk'), DECK_IDB_COMPANION: join(root, 'libexec', 'idb_companion'), DECK_SIMULATOR_SET: set },
      socketDir: join(root, 's'),
      iphoneHelper: null,
      emulatorLogDir: join(root, 'emulator-logs'),
      saveImage: async () => '',
    })
    devices.attach(win)
    emit(IPC.devicesWatch)
  })
  // Each test begins watching, with a first list out (the AVDs read, both sources listed), whatever
  // ran before it: so any one of them can run alone (-t).
  beforeEach(async () => {
    await vi.waitFor(async () => {
      const now = await list()
      expect(now?.pending).toEqual([])
      expect(now?.noAvds || now?.startable.some((d) => d.kind === 'emulator')).toBe(true)
    }, { timeout: 5000 })
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
      { id: 'emulator:Broken_AVD', kind: 'emulator', name: 'Broken AVD', detail: 'Emulator', error: 'Unknown AVD name [Broken_AVD], use -list-avds to see valid list.' },
      { id: 'simulator:BADDECAF-BADD-ECAF-BADD-ECAFBADDECAF', kind: 'simulator', name: 'iPhone Broken', detail: 'Simulator · iOS 27.0', error: 'BADDECAF-BADD-ECAF-BADD-ECAFBADDECAF could not be resolved to any target' },
    ])), { timeout: 5000 })
    expect(await start('emulator:Broken_AVD')).toBeNull()
    expect((await list())?.startable).toContainEqual({ id: 'emulator:Broken_AVD', kind: 'emulator', name: 'Broken AVD', detail: 'Emulator', starting: true })
  })

  /** Removes every boot-* mark (a held boot goes on, as one that works). */
  const clearBootMarks = () => {
    for (const file of readdirSync(marks)) if (file.startsWith('boot-')) rmSync(join(marks, file), { force: true })
  }
  /** Numbers DEADBEEF's boots from 1 again, with none of an earlier test's marks left. */
  const freshBoots = () => {
    clearBootMarks()
    writeFileSync(join(marks, 'bootn'), '0')
  }

  // A best-effort reset for the tests below, which drive DEADBEEF's boot by hand: whatever the test's
  // own assertions did, this always leaves it shut down, its boots ended and their marks gone, so one
  // test's failure can't cascade into the next's.
  const resetSim = async () => {
    clearBootMarks()
    await stop(SIM.id).catch(() => {})
    await vi.waitFor(async () => expect((await list())?.devices.some((d) => d.id === SIM.id)).toBe(false), { timeout: 5000 }).catch(() => {})
    await vi.waitFor(() => expect(boots.running).toBe(0), { timeout: 5000 }).catch(() => {})
  }

  it("gives each boot of the same simulator its own flag: Start, Stop, Start again while the first --boot still runs keeps it booting until the SECOND ends", async () => {
    freshBoots()
    writeFileSync(join(marks, 'boot-hold-1'), '')
    writeFileSync(join(marks, 'boot-hold-2'), '')
    try {
      expect(await start(SIM.id)).toBeNull()
      await vi.waitFor(async () => expect((await list())?.devices).toEqual([{ ...SIM, state: 'booting' }]), { timeout: 5000 })

      expect(await stop(SIM.id)).toBeNull()
      await vi.waitFor(async () => expect((await list())?.devices).toEqual([]), { timeout: 5000 })

      expect(await start(SIM.id)).toBeNull()
      await vi.waitFor(async () => expect((await list())?.devices).toEqual([{ ...SIM, state: 'booting' }]), { timeout: 5000 })

      // Ends the FIRST boot (still running, held): the SECOND boot's own flag must keep it booting.
      rmSync(join(marks, 'boot-hold-1'))
      await bootEnded(marks, 1, 1)
      expect((await list())?.devices).toEqual([{ ...SIM, state: 'booting' }])

      // Ends the second boot: only now does it go ready.
      rmSync(join(marks, 'boot-hold-2'))
      await vi.waitFor(async () => expect((await list())?.devices).toEqual([SIM]), { timeout: 5000 })
    } finally {
      await resetSim()
    }
  })

  it('a boot whose stand-in reports Booted then fails keeps its error once the device is gone (no Stop involved)', async () => {
    freshBoots()
    writeFileSync(join(marks, 'boot-fail-1'), '')
    try {
      expect(await start('simulator:DEADBEEF-DEAD-BEEF-DEAD-BEEFDEADBEEF')).toBeNull()
      // The notifier says Booted first (before the command answers): the start must survive that.
      await vi.waitFor(async () => expect((await list())?.devices).toEqual([{ ...SIM, state: 'booting' }]), { timeout: 5000 })
      // The command then fails, after removing "booted": the device disappears (the notifier notices
      // the file is gone a little before the command itself actually exits), and the failure reaches
      // the startable entry instead of being lost the moment it was merely visible.
      await vi.waitFor(async () => expect((await list())?.devices).toEqual([]), { timeout: 5000 })
      await vi.waitFor(
        async () =>
          expect((await list())?.startable).toContainEqual({
            id: 'simulator:DEADBEEF-DEAD-BEEF-DEAD-BEEFDEADBEEF',
            kind: 'simulator',
            name: 'iPhone 17',
            detail: 'Simulator · iOS 27.0',
            error: 'DEADBEEF-DEAD-BEEF-DEAD-BEEFDEADBEEF failed during boot',
          }),
        { timeout: 5000 },
      )
    } finally {
      await resetSim()
    }
  })

  it("a boot whose command fails while the simulator is still up stays booting, unstreamed, until it's gone, then shows its error", async () => {
    freshBoots()
    writeFileSync(join(marks, 'boot-hold-1'), '')
    writeFileSync(join(marks, 'boot-fail-up-1'), '')
    try {
      expect(await start(SIM.id)).toBeNull()
      await vi.waitFor(async () => expect((await list())?.devices).toEqual([{ ...SIM, state: 'booting' }]), { timeout: 5000 })

      // The command fails first, while the notifier still says Booted: still booting, so its start
      // keeps its error, and there's nothing to stream.
      rmSync(join(marks, 'boot-hold-1'))
      await bootEnded(marks, 1)
      expect((await list())?.devices).toEqual([{ ...SIM, state: 'booting' }])
      const before = streamEvents(SIM.id).length
      emit(IPC.devicesView, SIM.id)
      expect(streamEvents(SIM.id)).toHaveLength(before)

      // Then the simulator goes down: once it's gone, the error shows.
      rmSync(join(marks, 'booted'))
      await vi.waitFor(async () => expect((await list())?.devices).toEqual([]), { timeout: 5000 })
      await vi.waitFor(async () => expect((await list())?.startable).toContainEqual({ ...SIM_OFFERED, error: 'DEADBEEF-DEAD-BEEF-DEAD-BEEFDEADBEEF failed during boot' }), { timeout: 5000 })
    } finally {
      emit(IPC.devicesUnview, SIM.id)
      await resetSim()
    }
  })

  it('a Stop during a boot forgets its start: no error, even once the still-running boot command fails afterwards', async () => {
    freshBoots()
    writeFileSync(join(marks, 'boot-hold-1'), '')
    try {
      expect(await start(SIM.id)).toBeNull()
      await vi.waitFor(async () => expect((await list())?.devices).toEqual([{ ...SIM, state: 'booting' }]), { timeout: 5000 })

      expect(await stop(SIM.id)).toBeNull()
      await vi.waitFor(async () => expect((await list())?.devices).toEqual([]), { timeout: 5000 })
      // Forgotten at once: plainly startable again, no "error", before the held boot command even answers.
      expect((await list())?.startable).toContainEqual(SIM_OFFERED)

      // The original --boot command, still running, now fails: must not retroactively show an error.
      writeFileSync(join(marks, 'boot-fail-1'), '')
      rmSync(join(marks, 'boot-hold-1'))
      await bootEnded(marks, 1)
      expect((await list())?.startable).toContainEqual(SIM_OFFERED)
    } finally {
      await resetSim()
    }
  })

  // Same idea as resetSim, for the Pixel_9 tests below.
  const resetPixel = async () => {
    writeFileSync(join(marks, 'avds'), 'Pixel_9\nBroken_AVD\n')
    rmSync(join(marks, 'kill-fail'), { force: true })
    await stop('emulator:Pixel_9').catch(() => {})
    await vi.waitFor(async () => expect((await list())?.devices.some((d) => d.id === 'emulator:Pixel_9')).toBe(false), { timeout: 5000 }).catch(() => {})
  }

  it('reads the AVDs again once a start has spawned, and once a stop has asked the emulator to close', async () => {
    writeFileSync(join(marks, 'avds'), 'Pixel_9\nBroken_AVD\nNew_AVD\n')
    try {
      expect(await start('emulator:Pixel_9')).toBeNull()
      await vi.waitFor(async () => expect((await list())?.startable.map((d) => d.id)).toContain('emulator:New_AVD'), { timeout: 5000 })
      await vi.waitFor(async () => expect((await list())?.devices).toEqual([PIXEL]), { timeout: 5000 })

      writeFileSync(join(marks, 'avds'), 'Pixel_9\nBroken_AVD\n') // New_AVD removed in Android Studio meanwhile
      expect(await stop('emulator:Pixel_9')).toBeNull()
      await vi.waitFor(async () => expect((await list())?.startable.map((d) => d.id)).not.toContain('emulator:New_AVD'), { timeout: 5000 })
      await vi.waitFor(async () => expect((await list())?.devices).toEqual([]), { timeout: 5000 })
    } finally {
      await resetPixel()
    }
  })

  it("a Stop that fails says adb's own error, and the emulator stays running", async () => {
    try {
      expect(await start('emulator:Pixel_9')).toBeNull()
      await vi.waitFor(async () => expect((await list())?.devices).toEqual([PIXEL]), { timeout: 5000 })
      writeFileSync(join(marks, 'kill-fail'), '')
      expect(await stop('emulator:Pixel_9')).toEqual({ error: 'error: could not connect to TCP port 5554: Connection refused' })
      expect((await list())?.devices).toEqual([PIXEL])
    } finally {
      await resetPixel()
    }
  })

  it('a simulator Stop that fails says so, and it stays booted', async () => {
    try {
      expect(await start('simulator:DEADBEEF-DEAD-BEEF-DEAD-BEEFDEADBEEF')).toBeNull()
      await vi.waitFor(async () => expect((await list())?.devices).toEqual([SIM]), { timeout: 5000 })
      writeFileSync(join(marks, 'shutdown-fail'), '')
      expect(await stop('simulator:DEADBEEF-DEAD-BEEF-DEAD-BEEFDEADBEEF')).toEqual({ error: 'Target failed to shut down: Simulator is busy booting.' })
      expect((await list())?.devices).toEqual([SIM])
    } finally {
      rmSync(join(marks, 'shutdown-fail'), { force: true })
      await resetSim()
    }
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

// A separate registration, isolated from the shared one above: these scenarios end by disposing it
// (or need an emulator that goes through Android's own "booting" state, which the shared SDK stand-in
// never reports), so they can't share its state with the other tests.
describe.skipIf(process.platform === 'win32')('registerDeviceIpc: an emulator closing on its own, and a stop outliving the watch', () => {
  let root: string
  let marks: string
  let devices: DeviceIpc
  let win: BrowserWindow
  const calls = () => readFileSync(join(marks, 'calls'), 'utf8').split('\n')
  const tool = (path: string, body: string[]) => {
    mkdirSync(join(path, '..'), { recursive: true })
    writeFileSync(path, ['#!/bin/sh', `M='${marks}'`, ...body, ''].join('\n'))
    chmodSync(path, 0o755)
  }

  beforeAll(async () => {
    root = mkdtempSync(join(tmpdir(), 'deck-start-ipc-edge-'))
    marks = join(root, 'marks')
    mkdirSync(marks)
    writeFileSync(join(marks, 'avds'), 'Slow_Boot\n')
    writeFileSync(join(marks, 'calls'), '')
    tool(join(root, 'sdk', 'emulator', 'emulator'), [
      'echo "emulator $*" >> "$M/calls"',
      'if [ "$1" = "-list-avds" ]; then cat "$M/avds"; exit 0; fi',
      'echo $$ > "$M/emulator.pid"',
      'touch "$M/started"',
      // A test asks this one to close on its own (code 0), rather than being killed through adb.
      'if [ -f "$M/exit-clean-after" ]; then',
      '  while [ ! -f "$M/exit-clean-go" ]; do sleep 0.05; done',
      '  touch "$M/emulator-gone"',
      '  exit 0',
      'fi',
      'exec sleep 30',
    ])
    tool(join(root, 'sdk', 'platform-tools', 'adb'), [
      'echo "adb $1 $2 $3 $4" >> "$M/calls"',
      'if [ "$1" = "track-devices" ]; then',
      "  printf '0000'",
      '  while :; do',
      '    while [ ! -f "$M/started" ]; do sleep 0.05; done',
      "    printf '0015emulator-5554\\tdevice\\n'",
      '    while [ ! -f "$M/killed" ] && [ ! -f "$M/emulator-gone" ]; do sleep 0.05; done',
      "    printf '0000'",
      '    rm -f "$M/started" "$M/killed" "$M/emulator-gone"',
      '  done',
      'fi',
      'if [ "$3" = "shell" ]; then',
      // Never finishes "booting" here (nothing ever creates $M/booted): these tests only need the
      // device listed, never ready.
      "  printf 'serial=SLOWBOOT1\\nmaker=Google\\nmodel=sdk_gphone64_arm64\\nrelease=15\\nbooted=0\\navd=Slow_Boot\\navd_old=\\nname=\\n'",
      '  exit 0',
      'fi',
      'if [ "$3" = "emu" ]; then',
      '  touch "$M/killed"',
      '  kill "$(cat "$M/emulator.pid")"',
      // A held "emu kill" lets a test dispose (or unwatch) while a Stop is still in flight.
      '  if [ -f "$M/kill-hold" ]; then while [ -f "$M/kill-hold" ]; do sleep 0.05; done; fi',
      "  echo 'OK: killing emulator, bye bye'",
      'fi',
      'exit 0',
    ])
    const webContents = Object.assign(new EventEmitter(), { isDestroyed: () => false, send: () => {} })
    win = Object.assign(new EventEmitter(), { isDestroyed: () => false, webContents }) as unknown as BrowserWindow
    devices = registerDeviceIpc({
      picksFile: join(root, 'devices.json'),
      resources: join(root, 'resources'),
      platform: 'darwin',
      home: join(root, 'home'),
      // DECK_IDB_COMPANION absolute but nonexistent: these tests are Android-only, and without it
      // idbCandidates() would fall back to Homebrew's usual paths and find a real idb-companion (and
      // real simulators) on this Mac.
      env: { PATH: '', ANDROID_HOME: join(root, 'sdk'), DECK_IDB_COMPANION: join(root, 'no-idb-here') },
      socketDir: join(root, 's'),
      iphoneHelper: null,
      emulatorLogDir: join(root, 'emulator-logs'),
      saveImage: async () => '',
    })
    devices.attach(win)
    emit(IPC.devicesWatch)
    // Not just "list() answers": readAvds() is its own async chain, so Slow_Boot must actually be
    // offered before a test tries to start it.
    await vi.waitFor(async () => expect((await list())?.startable.map((d) => d.id)).toContain('emulator:Slow_Boot'), { timeout: 5000 })
  })
  afterAll(() => {
    try {
      emit(IPC.devicesUnwatch)
    } catch {
      // the "outliving the watch" test below may already have disposed this registration
    }
    devices?.dispose()
    try {
      process.kill(Number(readFileSync(join(marks, 'emulator.pid'), 'utf8')))
    } catch {
      // never started, or already ended
    }
    rmSync(root, { recursive: true, force: true })
  })

  it('is forgotten, not shown as failed, once it closes cleanly before Android finished starting', async () => {
    writeFileSync(join(marks, 'exit-clean-after'), '')
    try {
      expect(await start('emulator:Slow_Boot')).toBeNull()
      await vi.waitFor(
        async () => expect((await list())?.devices).toEqual([{ id: 'emulator:Slow_Boot', kind: 'emulator', name: 'Slow Boot', detail: 'Emulator · Android 15', state: 'booting' }]),
        { timeout: 5000 },
      )

      writeFileSync(join(marks, 'exit-clean-go'), '')
      await vi.waitFor(async () => expect((await list())?.devices).toEqual([]), { timeout: 5000 })
      // Startable again, plainly: no "error" from the clean exit that ended it.
      expect((await list())?.startable).toContainEqual({ id: 'emulator:Slow_Boot', kind: 'emulator', name: 'Slow Boot', detail: 'Emulator' })
    } finally {
      rmSync(join(marks, 'exit-clean-after'), { force: true })
      rmSync(join(marks, 'exit-clean-go'), { force: true })
    }
  })

  it("a stop's AVD re-read does nothing once Deck has quit meanwhile", async () => {
    rmSync(join(marks, 'killed'), { force: true })
    rmSync(join(marks, 'emulator-gone'), { force: true })
    expect(await start('emulator:Slow_Boot')).toBeNull()
    await vi.waitFor(async () => expect((await list())?.devices).toHaveLength(1), { timeout: 5000 })

    const before = calls().filter((c) => c === 'emulator -list-avds').length
    writeFileSync(join(marks, 'kill-hold'), '')
    const stopping = stop('emulator:Slow_Boot')
    await vi.waitFor(() => expect(calls()).toContain('adb -s emulator-5554 emu kill'), { timeout: 5000 })

    devices.dispose() // Deck quits while the stop's "emu kill" is still held
    rmSync(join(marks, 'kill-hold'))
    expect(await stopping).toBeNull()
    await new Promise((resolve) => setTimeout(resolve, 300)) // give the stop's own readAvds a chance to (mis)fire
    expect(calls().filter((c) => c === 'emulator -list-avds').length).toBe(before)
  })
})

// A registration of its own, with a short grace for a failed boot: the shared one above keeps the
// default (10 s), long enough for the notifier to drop a simulator that goes down; this one shows one
// that stays up turning ready once the grace is over.
describe.skipIf(process.platform === 'win32')('registerDeviceIpc: a failed boot whose simulator stays up', () => {
  let root: string
  let marks: string
  let devices: DeviceIpc
  const tool = (path: string, body: string[]) => {
    mkdirSync(join(path, '..'), { recursive: true })
    writeFileSync(path, ['#!/bin/sh', `M='${marks}'`, ...body, ''].join('\n'))
    chmodSync(path, 0o755)
  }

  beforeAll(async () => {
    root = mkdtempSync(join(tmpdir(), 'deck-start-ipc-grace-'))
    marks = join(root, 'marks')
    mkdirSync(marks)
    writeFileSync(join(marks, 'calls'), '')
    // No devices, ever: only there so that no real adb (Homebrew's) is found and started.
    tool(join(root, 'sdk', 'platform-tools', 'adb'), ['if [ "$1" = "track-devices" ]; then printf \'0000\'; exec sleep 60; fi', 'exit 0'])
    tool(join(root, 'libexec', 'idb_companion'), IDB_COMPANION)
    writeFileSync(join(root, 'libexec', 'sim-video'), '#!/bin/sh\n')
    chmodSync(join(root, 'libexec', 'sim-video'), 0o755)
    const webContents = Object.assign(new EventEmitter(), { isDestroyed: () => false, send: () => {} })
    const win = Object.assign(new EventEmitter(), { isDestroyed: () => false, webContents }) as unknown as BrowserWindow
    devices = registerDeviceIpc({
      picksFile: join(root, 'devices.json'),
      resources: join(root, 'resources'),
      platform: 'darwin',
      home: join(root, 'home'),
      env: { PATH: '', ANDROID_HOME: join(root, 'sdk'), DECK_IDB_COMPANION: join(root, 'libexec', 'idb_companion'), DECK_SIMULATOR_SET: join(root, 'set') },
      socketDir: join(root, 's'),
      iphoneHelper: null,
      failedBootGraceMs: 300,
      saveImage: async () => '',
    })
    devices.attach(win)
    emit(IPC.devicesWatch)
    await vi.waitFor(async () => expect((await list())?.startable).toContainEqual(SIM_OFFERED), { timeout: 5000 })
  })
  afterAll(() => {
    emit(IPC.devicesUnwatch)
    devices?.dispose()
    rmSync(root, { recursive: true, force: true })
  })

  it('turns ready once the grace is over, which ends its start, with no error', async () => {
    writeFileSync(join(marks, 'boot-hold-1'), '')
    writeFileSync(join(marks, 'boot-fail-up-1'), '')
    expect(await start(SIM.id)).toBeNull()
    await vi.waitFor(async () => expect((await list())?.devices).toEqual([{ ...SIM, state: 'booting' }]), { timeout: 5000 })

    rmSync(join(marks, 'boot-hold-1'))
    await bootEnded(marks, 1)
    // Seen before the grace can be over: bootEnded's check runs on a timer due well before it.
    expect((await list())?.devices).toEqual([{ ...SIM, state: 'booting' }])
    await vi.waitFor(async () => expect((await list())?.devices).toEqual([SIM]), { timeout: 5000 })

    // Its start ended as it turned ready: once it's gone (shut down some other way), it's offered
    // plainly, with no error and not starting.
    rmSync(join(marks, 'booted'))
    await vi.waitFor(async () => expect((await list())?.startable).toContainEqual(SIM_OFFERED), { timeout: 5000 })
  })
})
