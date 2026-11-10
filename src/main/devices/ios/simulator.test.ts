import { chmodSync, mkdirSync, mkdtempSync, rmSync, symlinkSync } from 'node:fs'
import net from 'node:net'
import { tmpdir } from 'node:os'
import { join } from 'node:path'
import { afterEach, describe, expect, it, vi } from 'vitest'
import type { StreamPacket } from '../session'
import { GrpcNoAnswer, type GrpcStream } from './grpc'
import { DESCRIBE_PATH, HID_PATH, touchEvent } from './proto'
import { type IdbConnection, scaleFor, type SimulatorIo, simulatorIo, socketDirFor, startSimulator } from './simulator'
import { DESCRIBE_ANSWER, fragment, initSegment, nal } from './test-fixtures'
import { fakeProcess, type FakeProcess, type FakeProcessOptions } from './test-process'

function setup(opts: { describe?: () => Promise<Buffer>; companion?: FakeProcessOptions } = {}) {
  const companions: FakeProcess[] = []
  const videos: FakeProcess[] = []
  const videoArgs: [string, number][] = []
  /** The signal each start gave its wait for the socket. */
  const readySignals: AbortSignal[] = []
  /** Set: spawning the next sim-video throws this, as spawn does for ENOEXEC. */
  const fail: { video: Error | null } = { video: null }
  const streams: { path: string; written: Buffer[]; closed: boolean; end?: (why: string) => void }[] = []
  const connection: IdbConnection & { closed: boolean } = {
    closed: false,
    unary: vi.fn(async (path: string) => {
      expect(path).toBe(DESCRIBE_PATH)
      return opts.describe ? opts.describe() : DESCRIBE_ANSWER
    }),
    stream: (path: string, onEnd?: (why: string) => void): GrpcStream => {
      const s = { path, written: [] as Buffer[], closed: false, end: onEnd }
      streams.push(s)
      return { write: (m) => s.written.push(m), close: () => { s.closed = true } }
    },
    close() {
      this.closed = true
    },
  }
  let closeConnection: () => void = () => {}
  const io: SimulatorIo = {
    socketFor: (udid) => `/tmp/sock/${udid}.sock`,
    companion: () => {
      const p = fakeProcess(opts.companion)
      companions.push(p)
      return p.proc
    },
    socketReady: async (_socket, signal) => {
      readySignals.push(signal)
    },
    connect: (_socket, onClose) => {
      closeConnection = onClose
      return connection
    },
    video: (udid, scale) => {
      if (fail.video) throw fail.video
      videoArgs.push([udid, scale])
      const p = fakeProcess()
      videos.push(p)
      return p.proc
    },
  }
  const sizes: [number, number][] = []
  const packets: StreamPacket[] = []
  const ends: string[] = []
  const events = { size: (w: number, h: number) => sizes.push([w, h]), packet: (p: StreamPacket) => packets.push(p), end: (why: string) => ends.push(why) }
  return { io, events, companions, videos, videoArgs, readySignals, fail, streams, connection, sizes, packets, ends, closeConnection: () => closeConnection() }
}

const flush = () => new Promise((r) => setImmediate(r))

const unanswered = () => Promise.reject(new GrpcNoAnswer('The call to describe ended without an answer from idb (ECONNRESET).'))

describe('startSimulator', () => {
  it('describes the screen, then streams it scaled to 1600 px at most', async () => {
    const t = setup()
    await startSimulator('U1', t.events, t.io, new AbortController().signal)
    expect(t.videoArgs).toEqual([['U1', 1600 / 2622]])
    t.videos[0].stdout.write(Buffer.concat([initSegment(), fragment([nal(0x65)]), fragment([nal(0x41)])]))
    await flush()
    expect(t.sizes).toEqual([[604, 1312]])
    expect(t.packets.map((p) => [p.config, p.key])).toEqual([[true, false], [false, true], [false, false]])
  })

  it('replays the current group of pictures for a key frame', async () => {
    const t = setup()
    const session = await startSimulator('U1', t.events, t.io, new AbortController().signal)
    t.videos[0].stdout.write(Buffer.concat([initSegment(), fragment([nal(0x41)]), fragment([nal(0x65)]), fragment([nal(0x41, 9)])]))
    await flush()
    const before = t.packets.length
    session.keyframe()
    // The config, then the last key frame and what followed it; not the P frame before it.
    expect(t.packets.slice(before).map((p) => [p.config, p.key, p.data.length])).toEqual([[true, false, t.packets[0].data.length], [false, true, 10], [false, false, 13]])
  })

  it('starts sim-video again for a key frame when the group is too long to replay', async () => {
    const t = setup()
    const session = await startSimulator('U1', t.events, t.io, new AbortController().signal)
    const ps = Array.from({ length: 9 }, () => fragment([nal(0x41)]))
    t.videos[0].stdout.write(Buffer.concat([initSegment(), fragment([nal(0x65)]), ...ps]))
    await flush()
    session.keyframe()
    expect(t.videos).toHaveLength(2)
    expect(t.videos[0].killed()).toBe(true)
    session.keyframe() // the new one's first key frame is on its way: no third
    expect(t.videos).toHaveLength(2)
    await flush()
    expect(t.ends).toEqual([]) // the old process's end isn't the session's
    t.videos[1].stdout.write(Buffer.concat([initSegment(), fragment([nal(0x65)])]))
    await flush()
    expect(t.sizes).toEqual([[604, 1312], [604, 1312]])
  })

  it('sends input in points down one hid stream, and drops what a simulator has no use for', async () => {
    const t = setup()
    const session = await startSimulator('U1', t.events, t.io, new AbortController().signal)
    session.input({ type: 'scroll', x: 1, y: 1, width: 10, height: 10, dx: 0, dy: 1 })
    expect(t.streams).toEqual([])
    session.input({ type: 'touch', action: 'down', x: 302, y: 656, width: 604, height: 1312 })
    session.input({ type: 'touch', action: 'up', x: 302, y: 656, width: 604, height: 1312 })
    expect(t.streams).toHaveLength(1)
    expect(t.streams[0].path).toBe(HID_PATH)
    expect(t.streams[0].written).toEqual([touchEvent(201, 437, false), touchEvent(201, 437, true)])
  })

  it("ends with sim-video's own error, or the companion's last words", async () => {
    const t = setup()
    await startSimulator('U1', t.events, t.io, new AbortController().signal)
    t.videos[0].stderr.write('Overlay setup: screenInfo=1206x2622@3.0x\nError: No simulator U1 in /set\nUsage: sim-video\n')
    t.videos[0].exit(64)
    await vi.waitFor(() => expect(t.ends).toEqual(['No simulator U1 in /set']))

    const u = setup()
    await startSimulator('U2', u.events, u.io, new AbortController().signal)
    u.companions[0].stderr.write('2026-11-10 14:21:57.805+0200 [U2] Target is no longer booted, companion going offline\n')
    u.companions[0].exit(0)
    await vi.waitFor(() => expect(u.ends).toEqual(['Target is no longer booted, companion going offline']))
    expect(u.videos[0].killed()).toBe(true)
  })

  it('ends a second after the connection closes while the companion runs on', async () => {
    const t = setup()
    await startSimulator('U1', t.events, t.io, new AbortController().signal)
    t.closeConnection()
    expect(t.ends).toEqual([])
    await vi.waitFor(() => expect(t.ends).toEqual(["The simulator's companion stopped answering."]), { timeout: 2000 })
    expect(t.companions[0].killed()).toBe(true)
  })

  it("prefers the companion's words when it exits as the connection closes", async () => {
    const t = setup()
    await startSimulator('U1', t.events, t.io, new AbortController().signal)
    t.closeConnection()
    t.companions[0].stderr.write('2026-11-10 14:21:57.805+0200 [U1] Target is no longer booted, companion going offline\n')
    t.companions[0].exit(0)
    await vi.waitFor(() => expect(t.ends).toEqual(['Target is no longer booted, companion going offline']))
  })

  it('opens a new hid stream after idb ends one', async () => {
    const t = setup()
    const session = await startSimulator('U1', t.events, t.io, new AbortController().signal)
    session.input({ type: 'button', button: 'home' })
    t.streams[0].end?.('Bad event')
    session.input({ type: 'button', button: 'home' })
    expect(t.streams).toHaveLength(2)
    expect(t.streams[1].written).toHaveLength(2)
  })

  it('ends on a broken picture stream', async () => {
    const t = setup()
    await startSimulator('U1', t.events, t.io, new AbortController().signal)
    t.videos[0].stdout.write(fragment([nal(0x65)]))
    await vi.waitFor(() => expect(t.ends).toEqual(['sim-video sent a picture before its configuration.']))
  })

  it('stops everything on stop(), and says nothing after', async () => {
    const t = setup()
    const session = await startSimulator('U1', t.events, t.io, new AbortController().signal)
    session.input({ type: 'button', button: 'home' })
    session.stop()
    expect(t.companions[0].killed()).toBe(true)
    expect(t.videos[0].killed()).toBe(true)
    expect(t.streams[0].closed).toBe(true)
    expect(t.connection.closed).toBe(true)
    await flush()
    expect(t.ends).toEqual([])
  })

  it("fails a start whose companion stops first (in its words, also when describe went unanswered), and one that is stopped", async () => {
    const t = setup({ describe: () => new Promise(() => {}) })
    const starting = startSimulator('U1', t.events, t.io, new AbortController().signal)
    await flush()
    t.companions[0].stderr.write('2026-11-10 10:00:00.000+0200 The operation couldn’t be completed.\n')
    t.companions[0].exit(1)
    await expect(starting).rejects.toThrow('The operation couldn’t be completed.')
    expect(t.videos).toEqual([])

    const w = setup({ describe: () => Promise.reject(new GrpcNoAnswer('The call to describe ended without an answer from idb (ECONNRESET).')) })
    const gone = startSimulator('U1', w.events, w.io, new AbortController().signal)
    setTimeout(() => {
      w.companions[0].stderr.write('2026-11-10 10:00:00.000+0200 [U1] Target is no longer booted, companion going offline\n')
      w.companions[0].exit(0)
    }, 50)
    await expect(gone).rejects.toThrow('Target is no longer booted, companion going offline')

    const u = setup({ describe: () => new Promise(() => {}) })
    const abort = new AbortController()
    const stopped = startSimulator('U1', u.events, u.io, abort.signal)
    await flush()
    abort.abort()
    await expect(stopped).rejects.toThrow('Stopped.')
    expect(u.companions[0].killed()).toBe(true)
  })
})

describe('startSimulator, when its processes fail or hang', () => {
  afterEach(() => vi.useRealTimers())

  it("fails the start in spawn's words when the companion can't be started, and stops waiting for its socket", async () => {
    const t = setup({ describe: () => new Promise(() => {}) })
    const starting = startSimulator('U1', t.events, t.io, new AbortController().signal)
    await flush()
    // How Node reports a spawn that fails once under way (ENOENT, EACCES): 'error', then 'close'.
    // Unheard, the 'error' would reach main's uncaught exception handler.
    t.companions[0].proc.emit('error', new Error('spawn /opt/homebrew/bin/idb_companion ENOENT'))
    t.companions[0].exit(-2)
    await expect(starting).rejects.toThrow('spawn /opt/homebrew/bin/idb_companion ENOENT')
    expect(t.connection.closed).toBe(true)
    // The streams never abort a start that failed: the socket's poll needs its own stop.
    expect(t.readySignals[0].aborted).toBe(true)
  })

  it("closes the companion and the connection when sim-video can't be started", async () => {
    const t = setup()
    t.fail.video = new Error('spawn ENOEXEC')
    await expect(startSimulator('U1', t.events, t.io, new AbortController().signal)).rejects.toThrow('spawn ENOEXEC')
    expect(t.companions[0].killed()).toBe(true)
    expect(t.connection.closed).toBe(true)
  })

  it("ends the session, without throwing, when sim-video can't be started again for a key frame", async () => {
    const t = setup()
    const session = await startSimulator('U1', t.events, t.io, new AbortController().signal)
    const ps = Array.from({ length: 9 }, () => fragment([nal(0x41)]))
    t.videos[0].stdout.write(Buffer.concat([initSegment(), fragment([nal(0x65)]), ...ps]))
    await flush()
    t.fail.video = new Error('spawn EAGAIN')
    expect(() => session.keyframe()).not.toThrow()
    expect(t.ends).toEqual(['spawn EAGAIN'])
    expect(t.videos[0].killed()).toBe(true)
    expect(t.companions[0].killed()).toBe(true)
  })

  it("ends in spawn's words when sim-video fails once under way, and shrugs off its stdin's EPIPE", async () => {
    const t = setup()
    await startSimulator('U1', t.events, t.io, new AbortController().signal)
    t.videos[0].proc.emit('error', new Error('spawn /opt/homebrew/opt/idb-companion/libexec/sim-video ENOENT'))
    t.videos[0].exit(-2)
    await flush()
    expect(t.ends).toEqual(['spawn /opt/homebrew/opt/idb-companion/libexec/sim-video ENOENT'])
    // Ending the stdin of a sim-video that has gone can fail the write: no uncaught exception.
    expect(() => t.videos[0].stdin.emit('error', new Error('write EPIPE'))).not.toThrow()
  })

  it('keeps a reason to 500 characters', async () => {
    const t = setup()
    await startSimulator('U1', t.events, t.io, new AbortController().signal)
    t.videos[0].stderr.write(`Error: ${'x'.repeat(600)}\n`)
    t.videos[0].exit(1)
    await vi.waitFor(() => expect(t.ends[0]).toHaveLength(500))
  })

  it("lands a stop at once, while describe is asked and while the start waits for the companion's words", async () => {
    vi.useFakeTimers()
    // describe that never answers, then one that went unanswered (the start then waits up to 1 s).
    for (const describe of [() => new Promise<Buffer>(() => {}), unanswered]) {
      // A companion that ignores SIGTERM: the stop can't land through its exit.
      const t = setup({ describe, companion: { ignoreSigterm: true } })
      const abort = new AbortController()
      const starting = startSimulator('U1', t.events, t.io, abort.signal)
      const failed = vi.fn()
      starting.catch(failed)
      await vi.advanceTimersByTimeAsync(0)
      expect(failed).not.toHaveBeenCalled()
      abort.abort()
      await vi.advanceTimersByTimeAsync(0) // no time passes
      expect(failed).toHaveBeenCalledWith(new Error('Stopped.'))
      expect(t.companions[0].killed()).toBe(true)
    }
  })

  it('leaves no timer behind on stop(), the grace after a lost connection included', async () => {
    vi.useFakeTimers()
    const t = setup()
    const session = await startSimulator('U1', t.events, t.io, new AbortController().signal)
    t.closeConnection()
    session.stop()
    await vi.advanceTimersByTimeAsync(1) // the processes close
    expect(vi.getTimerCount()).toBe(0)
  })

  it('gives up on an unanswered describe after 1 s, and kills a companion that ignores SIGTERM 2 s later', async () => {
    vi.useFakeTimers()
    const t = setup({ describe: unanswered, companion: { ignoreSigterm: true } })
    const starting = startSimulator('U1', t.events, t.io, new AbortController().signal)
    const failed = vi.fn()
    starting.catch(failed)
    await vi.advanceTimersByTimeAsync(999)
    expect(failed).not.toHaveBeenCalled()
    expect(t.companions[0].killed()).toBe(false) // still waiting for its words
    await vi.advanceTimersByTimeAsync(1)
    await expect(starting).rejects.toThrow('ended without an answer from idb (ECONNRESET)')
    expect(t.companions[0].killed()).toBe(true) // SIGTERM, which it ignores
    const closed = vi.fn()
    t.companions[0].proc.on('close', closed)
    await vi.advanceTimersByTimeAsync(1999)
    expect(closed).not.toHaveBeenCalled()
    await vi.advanceTimersByTimeAsync(1) // SIGKILL
    await vi.advanceTimersByTimeAsync(1) // the fake's exit: a setImmediate that timer scheduled
    expect(closed).toHaveBeenCalledTimes(1)
    expect(vi.getTimerCount()).toBe(0)
  })

  it("ends the wait for the companion's words as they come, its timer with it", async () => {
    vi.useFakeTimers()
    const t = setup({ describe: unanswered })
    const starting = startSimulator('U1', t.events, t.io, new AbortController().signal)
    const failed = vi.fn()
    starting.catch(failed)
    await vi.advanceTimersByTimeAsync(0)
    t.companions[0].stderr.write('2026-11-10 10:00:00.000+0200 [U1] Target is no longer booted, companion going offline\n')
    t.companions[0].exit(0)
    await vi.advanceTimersByTimeAsync(1) // its exit
    expect(failed).toHaveBeenCalledWith(new Error('Target is no longer booted, companion going offline'))
    expect(vi.getTimerCount()).toBe(0)
  })

  it('leaves nothing running after stop(), a companion that ignores SIGTERM included', async () => {
    vi.useFakeTimers()
    const t = setup({ companion: { ignoreSigterm: true } })
    const session = await startSimulator('U1', t.events, t.io, new AbortController().signal)
    const closed = { companion: vi.fn(), video: vi.fn() }
    t.companions[0].proc.on('close', closed.companion)
    t.videos[0].proc.on('close', closed.video)
    session.stop()
    await vi.advanceTimersByTimeAsync(1)
    expect(closed.video).toHaveBeenCalledTimes(1)
    expect(closed.companion).not.toHaveBeenCalled()
    await vi.advanceTimersByTimeAsync(1999) // SIGKILL, 2 s after the SIGTERM
    await vi.advanceTimersByTimeAsync(1)
    expect(closed.companion).toHaveBeenCalledTimes(1)
    expect(vi.getTimerCount()).toBe(0)
    expect(t.ends).toEqual([])
  })

  it('fails the start when the companion ends just as describe answers', async () => {
    const t = setup()
    // describe's answer, then the companion's 'close', both before the start goes on (in Node, two
    // events in one round of nextTicks): describe has already won the race.
    t.connection.unary = () => {
      const answer = Promise.resolve(DESCRIBE_ANSWER)
      queueMicrotask(() => {
        answer.then(() => t.companions[0].proc.emit('close', 0, null))
      })
      return answer
    }
    await expect(startSimulator('U1', t.events, t.io, new AbortController().signal)).rejects.toThrow('idb_companion stopped.')
    expect(t.videos).toEqual([])
    expect(t.connection.closed).toBe(true)
  })

  it('ends a second later when the connection closes just as describe answers', async () => {
    vi.useFakeTimers()
    let answering = () => {}
    const t = setup({
      describe: async () => {
        answering()
        return DESCRIBE_ANSWER
      },
    })
    answering = () => t.closeConnection()
    await startSimulator('U1', t.events, t.io, new AbortController().signal)
    await vi.advanceTimersByTimeAsync(999)
    expect(t.ends).toEqual([])
    await vi.advanceTimersByTimeAsync(1)
    expect(t.ends).toEqual(["The simulator's companion stopped answering."])
  })
})

describe('scaleFor and socketDirFor', () => {
  it('keeps the long side within 1600 px, never scaling up', () => {
    expect(scaleFor({ width: 1320, height: 2868, widthPoints: 440, heightPoints: 956 })).toBeCloseTo(0.558, 3)
    expect(scaleFor({ width: 750, height: 1334, widthPoints: 375, heightPoints: 667 })).toBe(1)
  })

  it("keeps the socket's path under macOS's 104 bytes", () => {
    expect(socketDirFor('/var/folders/wv/abc/T', 'deadbeef', 501)).toBe('/var/folders/wv/abc/T/deck-deadbeef')
    expect(socketDirFor(`/${'x'.repeat(90)}`, 'deadbeef', 501)).toBe('/tmp/deck-501-deadbeef')
  })

  it("counts the path's bytes, not its characters", () => {
    // 47 characters, but 79 bytes: each é is two.
    expect(socketDirFor(`/${'é'.repeat(32)}`, 'deadbeef', 501)).toBe('/tmp/deck-501-deadbeef')
  })
})

describe('simulatorIo', () => {
  const made: string[] = []
  afterEach(() => {
    for (const dir of made.splice(0)) rmSync(dir, { recursive: true, force: true })
  })
  const tempDir = () => {
    const dir = mkdtempSync(join(tmpdir(), 'deck-sim-'))
    made.push(dir)
    return dir
  }
  // Paths that don't exist: nothing here may start a real idb_companion or sim-video.
  const ioIn = (dir: string) =>
    simulatorIo({ companion: '/nonexistent/idb_companion', simVideo: '/nonexistent/sim-video', set: '/nonexistent/set', customSet: false, dir })

  it('gives each session its own socket, named after its simulator', () => {
    const io = ioIn('/private/d')
    expect(io.socketFor('ABCDEF12-3456-7890')).toBe('/private/d/ABCDEF12-1.sock')
    expect(io.socketFor('ABCDEF12-3456-7890')).toBe('/private/d/ABCDEF12-2.sock')
  })

  it("refuses a socket folder that isn't private to this user, or a link to one, before starting anything", () => {
    const base = tempDir()
    const shared = join(base, 'shared')
    mkdirSync(shared)
    chmodSync(shared, 0o755)
    expect(() => ioIn(shared).companion('U1', join(shared, 'U1-1.sock'))).toThrow("isn't private to this user")
    const own = join(base, 'own')
    mkdirSync(own, { mode: 0o700 })
    const link = join(base, 'link')
    symlinkSync(own, link)
    expect(() => ioIn(link).companion('U1', join(link, 'U1-1.sock'))).toThrow("isn't private to this user")
  })

  it('waits for the socket, and stops waiting when told', async () => {
    const dir = tempDir()
    const io = ioIn(dir)
    const socket = join(dir, 'a.sock')
    const ready = io.socketReady(socket, new AbortController().signal)
    const server = net.createServer().listen(socket)
    await ready
    await new Promise((resolve) => server.close(resolve))
    const abort = new AbortController()
    const waiting = io.socketReady(join(dir, 'b.sock'), abort.signal)
    abort.abort()
    await expect(waiting).rejects.toThrow('Stopped.')
  })
})
