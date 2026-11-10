import { EventEmitter } from 'node:events'
import { afterEach, describe, expect, it, vi } from 'vitest'
import { IPC } from '@shared/channels'
import type { DeviceList } from '@shared/types'
import type { BrowserWindow } from 'electron'
import { SimulatorTracker } from './ios/simulators'
import { fakeProcess, type FakeProcess } from './ios/test-process'
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

/** What each test controls: findAdb/findIdb/anySimulatorBooted's answers (by default, never found),
 *  and how many times each was called. Reset in setup(). */
const h = vi.hoisted(() => ({
  findAdb: async (): Promise<string | null> => null,
  findIdb: async (): Promise<{ companion: string; simVideo: string | null } | null> => null,
  booted: async (): Promise<boolean> => false,
  calls: { findAdb: 0, findIdb: 0, booted: 0 },
}))
vi.mock('./android/adb', async (importOriginal) => ({
  ...(await importOriginal<typeof import('./android/adb')>()),
  findAdb: (): Promise<string | null> => {
    h.calls.findAdb++
    return h.findAdb()
  },
}))
vi.mock('./ios/tools', async (importOriginal) => ({
  ...(await importOriginal<typeof import('./ios/tools')>()),
  findIdb: (): Promise<{ companion: string; simVideo: string | null } | null> => {
    h.calls.findIdb++
    return h.findIdb()
  },
  anySimulatorBooted: (): Promise<boolean> => {
    h.calls.booted++
    return h.booted()
  },
}))

/** Every fake child `spawn()` has handed out, in call order: its command, args, and the FakeProcess
 *  driving it (a parallel array, so neither needs `vi.hoisted`'s own typing gymnastics). */
const spawned = vi.hoisted(() => ({ calls: [] as { cmd: string; args: string[] }[], procs: [] as unknown[] }))
vi.mock('node:child_process', async (importOriginal) => ({
  ...(await importOriginal<typeof import('node:child_process')>()),
  spawn: (cmd: string, args: string[]) => {
    const fp = fakeProcess()
    spawned.calls.push({ cmd, args })
    spawned.procs.push(fp)
    return fp.proc
  },
}))

const procAt = (i: number) => spawned.procs[i] as FakeProcess
const notifiers = () => spawned.calls.map((c, i) => ({ ...c, fp: procAt(i) })).filter((c) => c.args[0] === '--notify')
const adbTrackers = () => spawned.calls.map((c, i) => ({ ...c, fp: procAt(i) })).filter((c) => c.args[0] === 'track-devices')

const deferred = <T>() => {
  let resolve!: (value: T) => void
  const promise = new Promise<T>((r) => (resolve = r))
  return { promise, resolve }
}
/** Long enough for every already-triggered microtask chain (a handful of chained awaits) to settle,
 *  short enough to keep these tests fast: nothing here waits on a real timer below SimulatorTracker's
 *  own 1 s restart. */
const tick = () => new Promise((r) => setTimeout(r, 20))

const IDB = { companion: '/fake/idb_companion', simVideo: '/fake/sim-video' }
const LINE = '[{"udid":"FAKE-UDID","name":"iPhone 17","state":"Booted","type":"Simulator","os_version":"iOS 27.0"}]\n'
const SIM = { id: 'simulator:FAKE-UDID', kind: 'simulator' as const, name: 'iPhone 17', detail: 'Simulator · iOS 27.0', state: 'ready' as const }

let current: DeviceIpc | null = null
function setup(platform: 'darwin' | 'linux' = 'darwin') {
  spawned.calls.length = 0
  spawned.procs.length = 0
  h.calls.findAdb = h.calls.findIdb = h.calls.booted = 0
  h.findAdb = async () => null
  h.findIdb = async () => null
  h.booted = async () => false
  const sent: unknown[][] = []
  const webContents = Object.assign(new EventEmitter(), { isDestroyed: () => false, send: (c: string, ...a: unknown[]) => sent.push([c, ...a]) })
  const win = Object.assign(new EventEmitter(), { isDestroyed: () => false, webContents }) as unknown as BrowserWindow
  const devices = registerDeviceIpc({
    picksFile: '/nonexistent/devices.json',
    resources: '/nonexistent',
    platform,
    home: '/nonexistent/home',
    env: { PATH: '' },
    socketDir: '/nonexistent/s',
    saveImage: async () => '',
  })
  devices.attach(win)
  current = devices
  const pushes = () => sent.filter((s) => s[0] === IPC.devicesChanged).map((s) => s[1])
  return {
    devices,
    pushes,
    watch: () => ipc.listeners.get(IPC.devicesWatch)!({}),
    unwatch: () => ipc.listeners.get(IPC.devicesUnwatch)!({}),
    focus: () => win.emit('focus'),
    list: () => ipc.handlers.get(IPC.devicesList)!({}) as DeviceList | null,
    view: (id: string) => ipc.listeners.get(IPC.devicesView)!({}, id),
    unview: (id: string) => ipc.listeners.get(IPC.devicesUnview)!({}, id),
    streamEvents: (id: string) => sent.filter((s) => s[0] === IPC.devicesStream && s[1] === id).map((s) => s[2]),
  }
}
afterEach(() => current?.dispose())
// Only the booted-vs-listed test below turns these on; harmless (a no-op) for every other test.
afterEach(() => vi.useRealTimers())

describe('registerDeviceIpc: the watch state machine (macOS unless noted)', () => {
  it('nothing until a source answers; then pending says who is left, and finally what both found', async () => {
    const t = setup()
    const adb = deferred<string | null>()
    h.findAdb = () => adb.promise
    h.findIdb = async () => IDB
    t.watch()
    await tick()
    expect(t.list()).toBeNull() // adb still pending, ios's notifier not listed yet: neither has answered
    expect(notifiers()).toHaveLength(1)
    notifiers()[0].fp.stdout.write(LINE)
    await tick()
    expect(t.pushes()).toEqual([{ devices: [SIM], problem: null, iosProblem: null, pending: ['android'] }])
    adb.resolve(null)
    await tick()
    expect(t.pushes().at(-1)).toEqual({ devices: [SIM], problem: 'no-adb', iosProblem: null, pending: [] })
    expect(t.pushes()).toHaveLength(2)
  })

  it('the mirror case: android settles first, pending says ios is still being looked for', async () => {
    const t = setup()
    const idb = deferred<typeof IDB | null>()
    h.findAdb = async () => null
    h.findIdb = () => idb.promise
    t.watch()
    await tick()
    expect(t.pushes()).toEqual([{ devices: [], problem: 'no-adb', iosProblem: null, pending: ['ios'] }])
    idb.resolve(IDB)
    await tick()
    notifiers()[0].fp.stdout.write(LINE)
    await tick()
    expect(t.pushes().at(-1)).toEqual({ devices: [SIM], problem: 'no-adb', iosProblem: null, pending: [] })
  })

  it('a focus during the first idb look starts nothing more', async () => {
    const t = setup()
    const idb = deferred<typeof IDB | null>()
    h.findIdb = () => idb.promise
    t.watch()
    t.focus()
    t.focus()
    t.focus()
    idb.resolve(IDB)
    await tick()
    expect(h.calls.findIdb).toBe(1)
    expect(notifiers()).toHaveLength(1)
  })

  it('watch/unwatch/watch during a slow idb look: the older look resolving first starts nothing', async () => {
    const t = setup()
    const d1 = deferred<typeof IDB | null>()
    const d2 = deferred<typeof IDB | null>()
    const queue = [d1, d2]
    h.findIdb = () => queue.shift()!.promise
    t.watch()
    t.unwatch()
    t.watch()
    d1.resolve(IDB) // stale (the first watch's generation)
    await tick()
    expect(notifiers()).toHaveLength(0)
    d2.resolve(IDB) // the current watch's generation
    await tick()
    expect(notifiers()).toHaveLength(1)
    t.focus() // the notifier is already running: a focus must not start a second one
    await tick()
    expect(notifiers()).toHaveLength(1)
  })

  it('same, with the newer look resolving first', async () => {
    const t = setup()
    const d1 = deferred<typeof IDB | null>()
    const d2 = deferred<typeof IDB | null>()
    const queue = [d1, d2]
    h.findIdb = () => queue.shift()!.promise
    t.watch()
    t.unwatch()
    t.watch()
    d2.resolve(IDB) // the current generation answers first
    await tick()
    expect(notifiers()).toHaveLength(1)
    d1.resolve(IDB) // stale: must not start a second notifier
    await tick()
    expect(notifiers()).toHaveLength(1)
  })

  it("a stale look still in its pgrep step does not publish into the new watch", async () => {
    const t = setup()
    const b1 = deferred<boolean>()
    let calls = 0
    h.findIdb = async () => null
    h.booted = () => (++calls === 1 ? b1.promise : Promise.resolve(false))
    t.watch() // look 1 (generation 1): idb not found, waits in pgrep
    await tick()
    t.unwatch()
    t.watch() // look 2 (generation 3): idb not found, pgrep answers false at once
    await tick()
    b1.resolve(true) // look 1's stale "booted" must not turn into a stale no-idb
    await tick()
    expect(t.list()).toEqual({ devices: [], problem: 'no-adb', iosProblem: null, pending: [] })
  })

  it('dispose during a look starts nothing', async () => {
    const t = setup()
    const idb = deferred<typeof IDB | null>()
    const adb = deferred<string | null>()
    h.findIdb = () => idb.promise
    h.findAdb = () => adb.promise
    t.watch()
    t.devices.dispose()
    idb.resolve(IDB)
    adb.resolve('/fake/adb')
    await tick()
    expect(spawned.calls).toHaveLength(0)
    expect(t.pushes()).toHaveLength(0)
  })

  it('no idb, then installed: a focus starts the notifier and clears the stale hint at once', async () => {
    const t = setup()
    h.booted = async () => true
    t.watch()
    await tick()
    expect(t.list()).toEqual({ devices: [], problem: 'no-adb', iosProblem: 'no-idb', pending: [] })
    h.findIdb = async () => IDB
    t.focus()
    await tick()
    expect(notifiers()).toHaveLength(1)
    // The stale "no-idb" hint is gone the instant the notifier starts, not ~2.5 s later when it lists.
    expect(t.list()).toEqual({ devices: [], problem: 'no-adb', iosProblem: null, pending: ['ios'] })
    notifiers()[0].fp.stdout.write(LINE)
    await tick()
    expect(t.list()).toEqual({ devices: [SIM], problem: 'no-adb', iosProblem: null, pending: [] })
  })

  it('an idb with no sim-video: the hint only while a simulator is booted', async () => {
    const t = setup()
    h.findIdb = async () => ({ companion: '/fake/idb_companion', simVideo: null })
    h.booted = async () => true
    t.watch()
    await tick()
    expect(t.list()?.iosProblem).toBe('old-idb')
    h.booted = async () => false
    t.focus()
    await tick()
    expect(t.list()?.iosProblem).toBeNull()
    expect(notifiers()).toHaveLength(0)
  })

  it('the notifier failing before it lists: the error, then the list once a run lists', async () => {
    const t = setup()
    h.findIdb = async () => IDB
    t.watch()
    await tick()
    const first = notifiers()[0].fp
    first.stderr.write('boom\n')
    first.exit(3)
    await tick()
    expect(t.list()).toEqual({ devices: [], problem: 'no-adb', iosProblem: { error: 'boom' }, pending: [] })
    await vi.waitFor(() => expect(notifiers()).toHaveLength(2), { timeout: 3000 })
    notifiers()[1].fp.stdout.write(LINE)
    await tick()
    expect(t.list()).toEqual({ devices: [SIM], problem: 'no-adb', iosProblem: null, pending: [] })
  })

  it('the notifier failing after it listed: the list stands', async () => {
    const t = setup()
    h.findIdb = async () => IDB
    t.watch()
    await tick()
    const first = notifiers()[0].fp
    first.stdout.write(LINE)
    await tick()
    const pushes = t.pushes().length
    first.exit(3)
    await tick()
    expect(t.list()).toEqual({ devices: [SIM], problem: 'no-adb', iosProblem: null, pending: [] })
    expect(t.pushes()).toHaveLength(pushes)
  })

  it('Linux: one push of the old shape, no idb or pgrep looks, and a focus adds no push', async () => {
    const t = setup('linux')
    t.watch()
    await tick()
    expect(t.pushes()).toEqual([{ devices: [], problem: 'no-adb', iosProblem: null, pending: [] }])
    t.focus()
    await tick()
    expect(t.pushes()).toHaveLength(1)
    expect(h.calls.findIdb).toBe(0)
    expect(h.calls.booted).toBe(0)
    expect(h.calls.findAdb).toBe(2) // the initial look, then one more for the focus
  })

  it('a focus during a newer adb look starts no third one: a stale look clears only its own token', async () => {
    const t = setup()
    h.findIdb = async () => IDB
    const a1 = deferred<string | null>()
    const a2 = deferred<string | null>()
    const queue = [a1, a2]
    h.findAdb = () => queue.shift()!.promise
    t.watch()
    t.unwatch()
    t.watch()
    a1.resolve(null) // stale (generation 1): must clear only its own token, not generation 3's
    await tick()
    t.focus() // tracker is still null (a2 hasn't resolved): must not start a third look
    await tick()
    expect(h.calls.findAdb).toBe(2)
    a2.resolve('/fake/adb')
    await tick()
    expect(adbTrackers()).toHaveLength(1)
  })

  it('unwatch kills the notifier; nothing publishes afterwards', async () => {
    const t = setup()
    h.findIdb = async () => IDB
    t.watch()
    await tick()
    const n = notifiers()[0]
    const before = t.pushes().length
    t.unwatch()
    expect(n.fp.killed()).toBe(true)
    await tick()
    expect(t.pushes()).toHaveLength(before)
    expect(t.list()).toBeNull()
  })

  it('after dispose, a focus with watchers left starts the sources again (theoretical: only will-quit disposes)', async () => {
    const t = setup()
    h.findIdb = async () => IDB
    t.watch()
    await tick()
    t.devices.dispose()
    t.focus()
    await tick()
    expect(notifiers()).toHaveLength(2)
  })

  it("a simulator the tracker no longer reports as booted fails view() with its own message, never falling through to the android id below it", async () => {
    const t = setup()
    h.findIdb = async () => IDB
    t.watch()
    await tick()
    notifiers()[0].fp.stdout.write(LINE)
    await tick()
    expect(t.list()?.devices).toEqual([SIM]) // listed: devicesView's own guard lets the start be tried

    // ipc.ts's start() asks booted() again, live, rather than trusting the list it was found in: a
    // simulator that shut down between a push and the view that follows it must still say so here,
    // not fall through to the id-isn't-android-either branch below (which would say "isn't connected"
    // instead — tracker is null in this test, so that branch is one `adb`/`serial` check away).
    const spy = vi.spyOn(SimulatorTracker.prototype, 'booted').mockReturnValue(false)
    vi.useFakeTimers()
    try {
      t.view('simulator:FAKE-UDID')
      await vi.advanceTimersByTimeAsync(1000 + 2000 + 5000) // DeviceStreams' own three retries
      expect(t.streamEvents('simulator:FAKE-UDID').at(-1)).toEqual({ type: 'state', state: 'error', message: "The simulator isn't booted." })
    } finally {
      t.unview('simulator:FAKE-UDID')
      spy.mockRestore()
    }
  })
})
