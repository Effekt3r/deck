import type { ChildProcess } from 'node:child_process'
import { EventEmitter } from 'node:events'
import { mkdirSync, mkdtempSync, rmSync, writeFileSync } from 'node:fs'
import { connect, createServer, type Server, type Socket } from 'node:net'
import { tmpdir } from 'node:os'
import { join } from 'node:path'
import { PassThrough } from 'node:stream'
import { afterAll, afterEach, describe, expect, it, vi } from 'vitest'
import { CODEC_H264, resetVideoMessage } from './protocol'
import { REMOTE_PATH, type ScrcpyIo, serverError, startScrcpy } from './scrcpy'
import { scrcpyServer } from './server'

const server = { path: '/res/scrcpy-server', version: '5.0.1' }
let device: Server | null = null
afterEach(() => {
  device?.close()
  device = null
})

/** The device's end of the tunnel. adb accepts a connection before the server listens and then
 *  drops it, so the first is closed; the next is the video socket, the one after the control socket. */
async function fakeDevice(bytes: Buffer) {
  let n = 0
  let gotVideo: (s: Socket) => void = () => {}
  let gotControl: (s: Socket) => void = () => {}
  const video = new Promise<Socket>((resolve) => (gotVideo = resolve))
  const control = new Promise<Socket>((resolve) => (gotControl = resolve))
  device = createServer((socket) => {
    socket.on('error', () => {})
    if (++n === 1) return socket.destroy()
    if (n === 2) {
      gotVideo(socket)
      return void socket.write(bytes)
    }
    gotControl(socket)
  })
  await new Promise<void>((resolve) => device!.listen(0, '127.0.0.1', resolve))
  return { port: (device.address() as { port: number }).port, video, control }
}

function fakeShell() {
  const child = Object.assign(new EventEmitter(), { stdout: new PassThrough(), stderr: new PassThrough(), kill: vi.fn(() => true) })
  return child as unknown as ChildProcess & { stdout: PassThrough; stderr: PassThrough; kill: ReturnType<typeof vi.fn> }
}

/** adb, as far as a session sees it: the forward picks port 27183; connections reach `port`. */
function fakeIo(port: number) {
  const runs: string[][] = []
  const shell = fakeShell()
  const io: ScrcpyIo = {
    run: async (args) => {
      runs.push(args)
      return args.includes('tcp:0') ? '27183\n' : ''
    },
    spawn: vi.fn(() => shell),
    connect: () => connect({ host: '127.0.0.1', port }),
  }
  return { io, runs, shell }
}

function videoBytes(): Buffer {
  const name = Buffer.alloc(64)
  name.write('C66')
  const codec = Buffer.alloc(4)
  codec.writeUInt32BE(CODEC_H264)
  const session = Buffer.alloc(12)
  session.writeUInt32BE(0x80000000, 0)
  session.writeUInt32BE(720, 4)
  session.writeUInt32BE(1440, 8)
  const packet = (flags: bigint, data: number[]) => {
    const head = Buffer.alloc(12)
    head.writeBigUInt64BE(flags, 0)
    head.writeUInt32BE(data.length, 8)
    return Buffer.concat([head, Buffer.from(data)])
  }
  return Buffer.concat([Buffer.from([0]), name, codec, session, packet(1n << 62n, [0, 0, 0, 1, 0x67]), packet(1n << 61n, [0, 0, 0, 1, 0x65])])
}

const quiet = { size() {}, packet() {}, end() {} }

describe('startScrcpy', () => {
  it('copies the server, opens a tunnel, starts it, removes the tunnel once connected and streams what it sends', async () => {
    const { port, control } = await fakeDevice(videoBytes())
    const { io, runs, shell } = fakeIo(port)
    const sizes: number[][] = []
    const packets: { config: boolean; key: boolean }[] = []
    const session = await startScrcpy('8d2e61a', server, {
      size: (width, height) => sizes.push([width, height]),
      packet: (p) => packets.push({ config: p.config, key: p.key }),
      end: () => {},
    }, io)

    expect(runs[0]).toEqual(['-s', '8d2e61a', 'push', '/res/scrcpy-server', REMOTE_PATH])
    expect(runs[1].slice(0, 4)).toEqual(['-s', '8d2e61a', 'forward', 'tcp:0'])
    expect(runs[1][4]).toMatch(/^localabstract:scrcpy_[0-9a-f]{8}$/)
    const scid = runs[1][4].slice(-8)
    expect(io.spawn).toHaveBeenCalledWith(['-s', '8d2e61a', 'shell',
      `CLASSPATH=${REMOTE_PATH}`, 'app_process', '/', 'com.genymobile.scrcpy.Server', '5.0.1',
      `scid=${scid}`, 'log_level=info', 'tunnel_forward=true', 'audio=false', 'control=true',
      'video_codec=h264', 'max_size=1600', 'max_fps=60', 'stay_awake=true', 'clipboard_autosync=false',
    ])
    // Removed as soon as both sockets are through it, not held for the life of the session.
    expect(runs[2]).toEqual(['-s', '8d2e61a', 'forward', '--remove', 'tcp:27183'])
    await vi.waitFor(() => expect(packets).toEqual([{ config: true, key: false }, { config: false, key: true }]))
    expect(sizes).toEqual([[720, 1440]])

    const socket = await control
    const got = new Promise<Buffer>((resolve) => socket.once('data', resolve))
    session.send(resetVideoMessage())
    expect([...(await got)]).toEqual([0x11])

    session.stop()
    expect(shell.kill).toHaveBeenCalled()
    expect(runs).toHaveLength(3) // not removed again
  })

  it('ends when the device stops sending video and the shell never closes, but says nothing after stop()', async () => {
    const { port, video } = await fakeDevice(videoBytes())
    const { io } = fakeIo(port)
    const ended: string[] = []
    const session = await startScrcpy('8d2e61a', server, { ...quiet, end: (why) => ended.push(why) }, io)
    ;(await video).destroy()
    await vi.waitFor(() => expect(ended).toEqual(['The device stopped sending video.']), { timeout: 3000 })
    session.stop()
    expect(ended).toHaveLength(1)
  })

  it('device closes video, and the shell explains why a moment later', async () => {
    const { port, video } = await fakeDevice(videoBytes())
    const { io, shell } = fakeIo(port)
    const ended: string[] = []
    await startScrcpy('8d2e61a', server, { ...quiet, end: (why) => ended.push(why) }, io)
    ;(await video).destroy()
    setTimeout(() => {
      shell.stderr.emit('data', Buffer.from('[server] ERROR: Could not create default video encoder for h264\n'))
      shell.emit('close', 1)
    }, 50)
    await vi.waitFor(() => expect(ended).toEqual(['Could not create default video encoder for h264']), { timeout: 3000 })
  })

  it('forgets a stale startup error once packets start flowing', async () => {
    const { port, video } = await fakeDevice(videoBytes())
    const { io, shell } = fakeIo(port)
    vi.mocked(io.spawn).mockImplementation(() => {
      // A non-fatal line the server printed before any packet flowed.
      queueMicrotask(() => shell.stderr.emit('data', Buffer.from('[server] ERROR: Could not write default settings\n')))
      return shell
    })
    const ended: string[] = []
    await startScrcpy('8d2e61a', server, { ...quiet, end: (why) => ended.push(why) }, io)
    ;(await video).destroy()
    // Give the video close a chance to be noticed (and arm its own reason) before the shell exits,
    // so the outcome doesn't race between the two.
    await new Promise((resolve) => setTimeout(resolve, 30))
    shell.emit('close', 0)
    await vi.waitFor(() => expect(ended).toEqual(['The device stopped sending video.']))
  })

  it('a clean shell exit after the device stops sending video keeps that reason', async () => {
    const { port, video } = await fakeDevice(videoBytes())
    const { io, shell } = fakeIo(port)
    const ended: string[] = []
    await startScrcpy('8d2e61a', server, { ...quiet, end: (why) => ended.push(why) }, io)
    ;(await video).destroy()
    setTimeout(() => shell.emit('close', 1), 30)
    await vi.waitFor(() => expect(ended).toEqual(['The device stopped sending video.']), { timeout: 3000 })
  })

  it("rejects with the server's own error when it stops before answering", async () => {
    device = createServer((socket) => socket.destroy())
    await new Promise<void>((resolve) => device!.listen(0, '127.0.0.1', resolve))
    const { io, runs, shell } = fakeIo((device.address() as { port: number }).port)
    const started = startScrcpy('8d2e61a', server, quiet, io)
    await new Promise((resolve) => setTimeout(resolve, 50))
    shell.stderr.emit('data', Buffer.from('[server] INFO: Device: [CHAINWAY] C66 (Android 13)\n[server] ERROR: Could not open video stream\n'))
    shell.emit('close', 1)
    await expect(started).rejects.toThrow('Could not open video stream')
    expect(shell.kill).toHaveBeenCalled()
    expect(runs.at(-1)).toEqual(['-s', '8d2e61a', 'forward', '--remove', 'tcp:27183'])
  })

  it('a stop while starting closes what it opened', async () => {
    device = createServer((socket) => socket.destroy()) // the server never answers
    await new Promise<void>((resolve) => device!.listen(0, '127.0.0.1', resolve))
    const { io, runs, shell } = fakeIo((device.address() as { port: number }).port)
    const stop = new AbortController()
    const started = startScrcpy('8d2e61a', server, quiet, io, stop.signal)
    await new Promise((resolve) => setTimeout(resolve, 150))
    stop.abort()
    await expect(started).rejects.toThrow('Stopped.')
    expect(shell.kill).toHaveBeenCalled()
    expect(runs.at(-1)).toEqual(['-s', '8d2e61a', 'forward', '--remove', 'tcp:27183'])
  })

  it('a stop queued right as the control socket starts connecting rejects with Stopped.', async () => {
    const { port } = await fakeDevice(videoBytes())
    const { io, runs, shell } = fakeIo(port)
    const stop = new AbortController()
    let connects = 0
    const realConnect = io.connect
    io.connect = (p) => {
      connects++
      const socket = realConnect(p)
      if (connects === 3) queueMicrotask(() => stop.abort()) // the control socket
      return socket
    }
    const started = startScrcpy('8d2e61a', server, quiet, io, stop.signal)
    await expect(started).rejects.toThrow('Stopped.')
    expect(shell.kill).toHaveBeenCalled()
    expect(runs.at(-1)).toEqual(['-s', '8d2e61a', 'forward', '--remove', 'tcp:27183'])
  })

  it('a stop during the push rejects, having opened nothing', async () => {
    const runs: string[][] = []
    const shell = fakeShell()
    let releasePush: () => void = () => {}
    const io: ScrcpyIo = {
      run: async (args) => {
        runs.push(args)
        if (args.includes('push')) await new Promise<void>((resolve) => { releasePush = resolve })
        return args.includes('tcp:0') ? '27183\n' : ''
      },
      spawn: vi.fn(() => shell),
      connect: () => connect({ host: '127.0.0.1', port: 0 }),
    }
    const stop = new AbortController()
    const started = startScrcpy('8d2e61a', server, quiet, io, stop.signal)
    await vi.waitFor(() => expect(runs).toEqual([['-s', '8d2e61a', 'push', '/res/scrcpy-server', REMOTE_PATH]]))
    stop.abort()
    releasePush()
    await expect(started).rejects.toThrow('Stopped.')
    expect(shell.kill).not.toHaveBeenCalled()
    expect(runs).toHaveLength(1)
  })

  it('a fake push that rejects when its signal aborts: a stop during the push rejects at once', async () => {
    const runs: string[][] = []
    const shell = fakeShell()
    const io: ScrcpyIo = {
      run: (args, _timeoutMs, signal) =>
        new Promise((_resolve, reject) => {
          runs.push(args)
          if (args.includes('push')) signal?.addEventListener('abort', () => reject(new Error('Stopped.')), { once: true })
        }),
      spawn: vi.fn(() => shell),
      connect: () => connect({ host: '127.0.0.1', port: 0 }),
    }
    const stop = new AbortController()
    const started = startScrcpy('8d2e61a', server, quiet, io, stop.signal)
    await vi.waitFor(() => expect(runs).toEqual([['-s', '8d2e61a', 'push', '/res/scrcpy-server', REMOTE_PATH]]))
    stop.abort()
    await expect(started).rejects.toThrow('Stopped.')
    expect(shell.kill).not.toHaveBeenCalled()
    expect(runs).toHaveLength(1)
  })

  it('a stop during the forward still removes the tunnel it opened', async () => {
    const runs: string[][] = []
    const shell = fakeShell()
    let releaseForward: () => void = () => {}
    const io: ScrcpyIo = {
      run: async (args) => {
        runs.push(args)
        if (args.includes('tcp:0')) {
          await new Promise<void>((resolve) => { releaseForward = resolve })
          return '27183\n'
        }
        return ''
      },
      spawn: vi.fn(() => shell),
      connect: () => connect({ host: '127.0.0.1', port: 0 }),
    }
    const stop = new AbortController()
    const started = startScrcpy('8d2e61a', server, quiet, io, stop.signal)
    await vi.waitFor(() => expect(runs).toHaveLength(2))
    stop.abort()
    releaseForward()
    await expect(started).rejects.toThrow('Stopped.')
    expect(shell.kill).not.toHaveBeenCalled() // aborted before the shell was ever spawned
    expect(runs.at(-1)).toEqual(['-s', '8d2e61a', 'forward', '--remove', 'tcp:27183'])
  })

  it('an already-aborted signal makes no adb call at all', async () => {
    const { io, runs, shell } = fakeIo(0)
    const stop = new AbortController()
    stop.abort()
    await expect(startScrcpy('8d2e61a', server, quiet, io, stop.signal)).rejects.toThrow('Stopped.')
    expect(runs).toEqual([])
    expect(shell.kill).not.toHaveBeenCalled()
  })

  it('stop(), then the device closing, calls end() for neither', async () => {
    const { port, video } = await fakeDevice(videoBytes())
    const { io } = fakeIo(port)
    const ended: string[] = []
    const session = await startScrcpy('8d2e61a', server, { ...quiet, end: (why) => ended.push(why) }, io)
    session.stop()
    ;(await video).destroy()
    // Longer than finishSoon's 1 s cap: a wrongly armed timer would otherwise fire after this test
    // already moved on.
    await new Promise((resolve) => setTimeout(resolve, 1200))
    expect(ended).toEqual([])
  })

  it('the device closing, then stop() within the 1 s window, calls end() for neither', async () => {
    const { port, video } = await fakeDevice(videoBytes())
    const { io } = fakeIo(port)
    const ended: string[] = []
    const session = await startScrcpy('8d2e61a', server, { ...quiet, end: (why) => ended.push(why) }, io)
    ;(await video).destroy()
    await new Promise((resolve) => setTimeout(resolve, 50)) // still well inside the 1 s grace window
    session.stop()
    await new Promise((resolve) => setTimeout(resolve, 1200))
    expect(ended).toEqual([])
  })
})

describe('serverError', () => {
  it("takes the server's last error, without its prefix", () => {
    expect(serverError('[server] INFO: Device: [CHAINWAY] C66\n[server] ERROR: Encoding error: x\n')).toBe('Encoding error: x')
    // A bare exception (no ": message") wins over the ERROR line before it, which explains it.
    expect(serverError(
      '[server] ERROR: Video encoding error\njava.lang.IllegalStateException\n\tat android.media.MediaCodec.native_dequeueOutputBuffer(Native Method)',
    )).toBe('Video encoding error (IllegalStateException)')
    // An exception's own message, with no ERROR line at all, keeps the class prefix off.
    expect(serverError('java.lang.IllegalArgumentException: The server version (5.0.0) does not match the client (5.0.1)'))
      .toBe('The server version (5.0.0) does not match the client (5.0.1)')
    // The ERROR line already says the same thing as the exception's message: it wins (it's more complete).
    expect(serverError('[server] ERROR: Could not open video stream: Permission denied\njava.io.IOException: Permission denied'))
      .toBe('Could not open video stream: Permission denied')
    // The ERROR line here is unrelated ("Exception on thread …"), so the exception's own message wins instead.
    expect(serverError(
      '[server] ERROR: Exception on thread Thread[control-recv,5,main]\n' +
      'java.lang.SecurityException: Injecting input events requires the caller (or the source of the instrumentation, if any) to have the INJECT_EVENTS permission.\n' +
      '\tat android.os.Parcel.createExceptionOrNull(Parcel.java:3069)\n',
    )).toBe('Injecting input events requires the caller (or the source of the instrumentation, if any) to have the INJECT_EVENTS permission.')
    // "Caused by:" is read as its own exception header; the root cause (last in the chain) wins.
    expect(serverError(
      '[server] ERROR: Could not open video stream\n' +
      'java.io.IOException: Broken wrapper\n' +
      '\tat com.genymobile.scrcpy.ScreenEncoder.streamScreen(ScreenEncoder.java:160)\n' +
      'Caused by: java.io.IOException: Broken pipe\n' +
      '\tat java.base/sun.nio.ch.FileDispatcherImpl.write0(Native Method)\n',
    )).toBe('Broken pipe')
    expect(serverError('[server] ERROR: Could not create default video encoder for h264\n')).toBe('Could not create default video encoder for h264')
    expect(serverError('adb: error: failed to get feature set: device offline\n')).toBe('adb: error: failed to get feature set: device offline')
    expect(serverError('[server] INFO: all good\n')).toBe('')
  })
})

describe('scrcpyServer', () => {
  const resources = mkdtempSync(join(tmpdir(), 'deck-resources-'))
  afterAll(() => rmSync(resources, { recursive: true, force: true }))

  it("finds the server and its version, or says how to get it", async () => {
    await expect(scrcpyServer(resources)).rejects.toThrow(/npm run fetch:scrcpy/)
    mkdirSync(resources, { recursive: true })
    writeFileSync(join(resources, 'scrcpy-server'), 'dex')
    writeFileSync(join(resources, 'scrcpy-server.json'), JSON.stringify({ version: '5.0.1' }))
    expect(await scrcpyServer(resources)).toEqual({ path: join(resources, 'scrcpy-server'), version: '5.0.1' })
  })

  it('rejects a version string that is not a version', async () => {
    const bad = mkdtempSync(join(tmpdir(), 'deck-resources-bad-'))
    try {
      writeFileSync(join(bad, 'scrcpy-server'), 'dex')
      writeFileSync(join(bad, 'scrcpy-server.json'), JSON.stringify({ version: 'latest' }))
      await expect(scrcpyServer(bad)).rejects.toThrow(/npm run fetch:scrcpy/)
    } finally {
      rmSync(bad, { recursive: true, force: true })
    }
  })
})
