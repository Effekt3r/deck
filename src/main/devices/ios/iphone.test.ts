import type { ChildProcess } from 'node:child_process'
import { afterEach, beforeEach, describe, expect, it, vi } from 'vitest'
import type { DeviceBlock } from '@shared/types'
import { CODEC_H264 } from '../android/protocol'
import type { StreamEvents, StreamPacket } from '../session'
import { CAMERA_DENIED, helperFailure, iphoneDevices, iphoneIo, IphoneTracker, readScreenList, screenIdOf, startIphone } from './iphone'
import { fakeProcess, type FakeProcess } from './test-process'

// Made-up capture device IDs: the real ones are UUIDs.
const A = '0A0A0A0A-1111-2222-3333-444444444444'
const B = 'B0B0B0B0-1111-2222-3333-444444444444'
const list = (...devices: unknown[]) => `${JSON.stringify({ devices })}\n`

describe('readScreenList', () => {
  it('reads every screen on offer, keeping the first entry on a repeated id, and says when a line is no list', () => {
    expect(readScreenList(list({ id: A, name: "Franco's iPhone" }, { id: B, name: 'iPad' }, { id: A, name: 'again' })))
      .toEqual({ screens: [{ id: A, name: "Franco's iPhone" }, { id: B, name: 'iPad' }], skipped: 0 })
    expect(readScreenList(list())).toEqual({ screens: [], skipped: 0 })
    expect(readScreenList('not json')).toBeNull()
    expect(readScreenList('[]')).toBeNull()
    expect(readScreenList('null')).toBeNull()
  })

  it('skips IDs that could pass for an option or a path, counting them, and names a nameless screen', () => {
    expect(readScreenList(list({ id: '--max-size' }, { id: '../x' }, { id: 'a b' }, { id: 7 }, null, { id: A, name: ' ' })))
      .toEqual({ screens: [{ id: A, name: 'iPhone' }], skipped: 5 })
  })
})

describe('iphoneDevices', () => {
  it('lists the screens by name, on a cable, view only', () => {
    expect(iphoneDevices([{ id: B, name: 'iPhone 17 Pro' }, { id: A, name: "Franco's iPhone" }])).toEqual([
      { id: `iphone:${A}`, kind: 'iphone', name: "Franco's iPhone", detail: 'iPhone · cable · view only', state: 'ready' },
      { id: `iphone:${B}`, kind: 'iphone', name: 'iPhone 17 Pro', detail: 'iPhone · cable · view only', state: 'ready' },
    ])
    expect(screenIdOf(`iphone:${A}`)).toBe(A)
    expect(screenIdOf('simulator:U1')).toBeNull()
    expect(screenIdOf('iphone:--max-size')).toBeNull()
  })
})

describe('IphoneTracker', () => {
  beforeEach(() => vi.useFakeTimers())
  afterEach(() => vi.useRealTimers())

  function setup() {
    const spawned: FakeProcess[] = []
    const published: string[][] = []
    const failures: [string, boolean][] = []
    const tracker = new IphoneTracker({
      list: () => {
        const p = fakeProcess()
        spawned.push(p)
        return p.proc
      },
      publish: (devices) => published.push(devices.map((d) => d.id)),
      failed: (why, listed) => failures.push([why, listed]),
    })
    return { tracker, spawned, published, failures }
  }

  it('publishes every list, read across chunks, and knows which screens are on offer', async () => {
    const { tracker, spawned, published } = setup()
    tracker.start()
    const text = list({ id: A, name: "Franco's iPhone" }) + list()
    spawned[0].stdout.write(text.slice(0, 30))
    spawned[0].stdout.write(text.slice(30, -3))
    await vi.waitFor(() => expect(published).toEqual([[`iphone:${A}`]]))
    expect(tracker.has(A)).toBe(true)
    spawned[0].stdout.write(text.slice(-3))
    await vi.waitFor(() => expect(published).toEqual([[`iphone:${A}`], []]))
    expect(tracker.has(A)).toBe(false)
    tracker.stop()
    expect(spawned[0].killed()).toBe(true)
  })

  it('starts the helper again after 1 s; a run that never listed forgets the screens', async () => {
    const { tracker, spawned, failures } = setup()
    tracker.start()
    spawned[0].stdout.write(list({ id: A, name: 'iPhone' }))
    spawned[0].exit(1)
    await vi.advanceTimersByTimeAsync(0)
    expect(failures).toEqual([['iphone-screen stopped (exit code 1).', true]])
    expect(tracker.has(A)).toBe(true) // a run that listed: its list stands until the next
    await vi.advanceTimersByTimeAsync(1000)
    expect(spawned).toHaveLength(2)
    spawned[1].stderr.write('{"error":"capture","message":"CoreMediaIO failed."}\n')
    spawned[1].exit(1)
    await vi.advanceTimersByTimeAsync(0)
    expect(failures[1]).toEqual(['{"error":"capture","message":"CoreMediaIO failed."}', false])
    expect(tracker.has(A)).toBe(false)
    tracker.stop()
  })

  it('a helper that cannot start at all (a missing binary) reports failure and offers no screens', async () => {
    const failures: [string, boolean][] = []
    const tracker = new IphoneTracker({
      list: () => fakeProcess({ spawnError: new Error('spawn /Deck.app/Contents/Resources/iphone-screen ENOENT') }).proc,
      publish: () => {},
      failed: (why, listed) => failures.push([why, listed]),
    })
    tracker.start()
    await vi.advanceTimersByTimeAsync(0)
    expect(failures).toEqual([['spawn /Deck.app/Contents/Resources/iphone-screen ENOENT', false]])
    expect(tracker.has(A)).toBe(false)
    tracker.stop()
  })

  it('logs a list that drops entries once per run (and again in the next), not on every later line that drops its own', async () => {
    const warnings: unknown[][] = []
    const originalWarn = console.warn
    console.warn = ((...args: unknown[]) => {
      warnings.push(args)
    }) as typeof console.warn
    try {
      const { tracker, spawned, published } = setup()
      tracker.start()
      spawned[0].stdout.write(list({ id: '--max-size' }, null, { id: A, name: 'iPhone' }))
      await vi.waitFor(() => expect(published).toEqual([[`iphone:${A}`]]))
      spawned[0].stdout.write(list({ id: '../x' }, { id: A, name: 'iPhone' }))
      await vi.waitFor(() => expect(published).toEqual([[`iphone:${A}`], [`iphone:${A}`]]))
      expect(warnings).toEqual([["devices: iphone-screen: skipped 2 entries Deck couldn't read"]])
      // The next run warns again.
      spawned[0].exit(1)
      await vi.advanceTimersByTimeAsync(0)
      await vi.advanceTimersByTimeAsync(1000)
      spawned[1].stdout.write(list({ id: '../x' }))
      await vi.waitFor(() => expect(published).toHaveLength(3))
      expect(warnings).toEqual([["devices: iphone-screen: skipped 2 entries Deck couldn't read"], ["devices: iphone-screen: skipped 1 entry Deck couldn't read"]])
      tracker.stop()
    } finally {
      console.warn = originalWarn
    }
  })
})

describe('iphoneIo', () => {
  it('runs the helper with stdin kept open: list, and stream at 1600 px and 60 frames a second', () => {
    const calls: unknown[][] = []
    const io = iphoneIo('/Deck.app/Contents/Resources/iphone-screen', {
      spawn: (command, args, options) => {
        calls.push([command, args, options.stdio])
        return fakeProcess().proc
      },
    })
    io.list()
    io.stream(A)
    expect(calls).toEqual([
      ['/Deck.app/Contents/Resources/iphone-screen', ['list'], ['pipe', 'pipe', 'pipe']],
      ['/Deck.app/Contents/Resources/iphone-screen', ['stream', A, '--max-size', '1600', '--max-fps', '60'], ['pipe', 'pipe', 'pipe']],
    ])
  })
})

describe('helperFailure', () => {
  it("says the helper's failures in Deck's words; only the camera is blocked", () => {
    expect(helperFailure('{"error":"camera-denied"}')).toEqual({ why: CAMERA_DENIED, blocked: 'camera' })
    expect(helperFailure('{"error":"not-found"}')?.why).toBe("The iPhone didn't offer its screen. Unlock it, and check that it trusts this Mac.")
    expect(helperFailure('{"error":"no-picture"}')).toEqual({ why: 'The iPhone sent no picture. Unlock it, and check that its screen is on.' })
    expect(helperFailure('{"error":"disconnected"}')).toEqual({ why: 'The iPhone was disconnected.' })
    expect(helperFailure('{"error":"capture","message":"The iPhone\'s screen stopped: busy."}')).toEqual({ why: "The iPhone's screen stopped: busy." })
    expect(helperFailure('{"error":"encoder","message":"No H.264 encoder (VideoToolbox error -12902)."}')).toEqual({ why: 'No H.264 encoder (VideoToolbox error -12902).' })
    expect(helperFailure('{"error":"something-new"}')).toEqual({ why: 'iphone-screen failed (something-new).' })
    // The line the helper prints when Deck starts it wrongly: its usage, which means nothing to the user.
    expect(helperFailure('{"error":"usage","message":"iphone-screen stream <id> [--max-size N] [--max-fps N]"}')).toEqual({ why: 'Deck started its iPhone helper wrongly (usage).' })
    // Its own words are cut as any process's are.
    expect(helperFailure(JSON.stringify({ error: 'capture', message: 'x'.repeat(3000) }))?.why).toBe('x'.repeat(500))
    expect(helperFailure('2026-11-11 something else')).toBeNull()
    expect(helperFailure('{not json')).toBeNull()
    expect(helperFailure('{"message":"no code"}')).toBeNull()
  })
})

/** The helper's stream: scrcpy's, from the codec id on. */
function codec(id = CODEC_H264): Buffer {
  const b = Buffer.alloc(4)
  b.writeUInt32BE(id)
  return b
}
function session(width: number, height: number): Buffer {
  const b = Buffer.alloc(12)
  b.writeUInt32BE(0x80000000, 0)
  b.writeUInt32BE(width, 4)
  b.writeUInt32BE(height, 8)
  return b
}
function packet(flags: bigint, data: number[]): Buffer {
  const head = Buffer.alloc(12)
  head.writeBigUInt64BE(flags, 0)
  head.writeUInt32BE(data.length, 8)
  return Buffer.concat([head, Buffer.from(data)])
}

describe('startIphone', () => {
  function setup(options: Parameters<typeof fakeProcess>[0] = {}) {
    const helper = fakeProcess(options)
    const streamed: string[] = []
    const io = {
      list: (): ChildProcess => {
        throw new Error('not here')
      },
      stream: (id: string) => {
        streamed.push(id)
        return helper.proc
      },
    }
    const sizes: [number, number][] = []
    const packets: StreamPacket[] = []
    const ends: [string, DeviceBlock | undefined][] = []
    const events: StreamEvents = {
      size: (w, h) => sizes.push([w, h]),
      packet: (p) => packets.push(p),
      end: (why, blocked) => ends.push([why, blocked]),
    }
    const stdin: string[] = []
    helper.stdin.on('data', (chunk: Buffer) => stdin.push(chunk.toString()))
    return { helper, io, streamed, sizes, packets, ends, events, stdin }
  }

  it('passes the screen on as it comes, and asks for key frames on stdin; input goes nowhere', async () => {
    const t = setup()
    const live = await startIphone(A, t.events, t.io, new AbortController().signal)
    expect(t.streamed).toEqual([A])
    const bytes = Buffer.concat([codec(), session(736, 1600), packet(1n << 62n, [0, 0, 0, 1, 0x67]), packet((1n << 61n) | 16_666n, [0, 0, 0, 1, 0x65])])
    t.helper.stdout.write(bytes.subarray(0, 9))
    t.helper.stdout.write(bytes.subarray(9))
    await vi.waitFor(() => expect(t.packets).toHaveLength(2))
    expect(t.sizes).toEqual([[736, 1600]])
    expect(t.packets).toEqual([
      { config: true, key: false, data: new Uint8Array([0, 0, 0, 1, 0x67]) },
      { config: false, key: true, data: new Uint8Array([0, 0, 0, 1, 0x65]) },
    ])
    live.keyframe()
    live.input({ type: 'touch', action: 'down', x: 1, y: 1, width: 736, height: 1600 })
    await vi.waitFor(() => expect(t.stdin.join('')).toBe('key\n'))
    const closed = new Promise((resolve) => t.helper.proc.once('close', resolve))
    live.stop()
    expect(t.helper.killed()).toBe(true)
    await closed
    expect(t.ends).toEqual([]) // a stop is never reported as an end
  })

  it("ends with the camera blocked when macOS hasn't let Deck use it", async () => {
    const t = setup()
    await startIphone(A, t.events, t.io, new AbortController().signal)
    t.helper.stderr.write('{"error":"camera-denied"}\n')
    t.helper.exit(1)
    await vi.waitFor(() => expect(t.ends).toEqual([[CAMERA_DENIED, 'camera']]))

    // Its last line counts with no newline too.
    const unended = setup()
    await startIphone(A, unended.events, unended.io, new AbortController().signal)
    unended.helper.stderr.write('{"error":"camera-denied"}')
    unended.helper.exit(1)
    await vi.waitFor(() => expect(unended.ends).toEqual([[CAMERA_DENIED, 'camera']]))
  })

  it("ends in the helper's words, else a line that reads as a failure, else how it ended", async () => {
    const found = setup()
    await startIphone(A, found.events, found.io, new AbortController().signal)
    found.helper.stderr.write('{"error":"not-found"}\n')
    found.helper.exit(1)
    await vi.waitFor(() => expect(found.ends).toEqual([["The iPhone didn't offer its screen. Unlock it, and check that it trusts this Mac.", undefined]]))

    const crashed = setup()
    await startIphone(A, crashed.events, crashed.io, new AbortController().signal)
    crashed.helper.stderr.write('Fatal error: Unexpectedly found nil\n')
    crashed.helper.exit(133)
    await vi.waitFor(() => expect(crashed.ends).toEqual([['Fatal error: Unexpectedly found nil', undefined]]))

    const quiet = setup()
    await startIphone(A, quiet.events, quiet.io, new AbortController().signal)
    quiet.helper.exit(3)
    await vi.waitFor(() => expect(quiet.ends).toEqual([['iphone-screen stopped (exit code 3).', undefined]]))
  })

  it('a helper that stops mid-packet: the cut packet goes nowhere, and the stream still ends', async () => {
    const t = setup()
    await startIphone(A, t.events, t.io, new AbortController().signal)
    const cut = packet(1n << 61n, [0, 0, 0, 1, 0x65, 0x88])
    t.helper.stdout.write(Buffer.concat([codec(), session(736, 1600), cut.subarray(0, cut.length - 2)]))
    t.helper.exit(0)
    await vi.waitFor(() => expect(t.ends).toEqual([['iphone-screen stopped.', undefined]]))
    expect(t.sizes).toEqual([[736, 1600]])
    expect(t.packets).toEqual([])
  })

  it('a stream that makes no sense ends it, and stops the helper', async () => {
    const t = setup()
    await startIphone(A, t.events, t.io, new AbortController().signal)
    t.helper.stdout.write(Buffer.concat([codec(), session(0, 1600)]))
    await vi.waitFor(() => expect(t.ends).toEqual([["Deck's iPhone helper sent a 0×1600 screen.", undefined]]))
    expect(t.helper.killed()).toBe(true)

    const other = setup()
    await startIphone(A, other.events, other.io, new AbortController().signal)
    other.helper.stdout.write(codec(0x68323635))
    await vi.waitFor(() => expect(other.ends).toEqual([["Deck's iPhone helper sent another codec.", undefined]]))
    expect(other.helper.killed()).toBe(true)
  })

  it('asks for no key frame once it has ended or been stopped', async () => {
    const ended = setup()
    const endedLive = await startIphone(A, ended.events, ended.io, new AbortController().signal)
    ended.helper.exit(1)
    await vi.waitFor(() => expect(ended.ends).toHaveLength(1))
    const endedWrite = vi.spyOn(ended.helper.stdin, 'write')
    endedLive.keyframe()
    expect(endedWrite).not.toHaveBeenCalled()

    const stopped = setup()
    const stoppedLive = await startIphone(A, stopped.events, stopped.io, new AbortController().signal)
    stoppedLive.stop()
    const stoppedWrite = vi.spyOn(stopped.helper.stdin, 'write')
    stoppedLive.keyframe()
    expect(stoppedWrite).not.toHaveBeenCalled()
  })

  it('a helper that fails to start: the spawn error, or a rejected start; a stopped start spawns nothing', async () => {
    const t = setup({ spawnError: Object.assign(new Error('spawn /x/iphone-screen ENOENT'), { code: 'ENOENT' }) })
    await startIphone(A, t.events, t.io, new AbortController().signal)
    await vi.waitFor(() => expect(t.ends).toEqual([['spawn /x/iphone-screen ENOENT', undefined]]))

    const throwing = { list: () => fakeProcess().proc, stream: (): ChildProcess => { throw new Error('spawn ENOEXEC') } }
    await expect(startIphone(A, t.events, throwing, new AbortController().signal)).rejects.toThrow('spawn ENOEXEC')

    const stopped = setup()
    const signal = AbortSignal.abort()
    await expect(startIphone(A, stopped.events, stopped.io, signal)).rejects.toThrow('Stopped.')
    expect(stopped.streamed).toEqual([])
  })
})
