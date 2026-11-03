import type { ChildProcess } from 'node:child_process'
import { EventEmitter } from 'node:events'
import { mkdirSync, mkdtempSync, rmSync, writeFileSync } from 'node:fs'
import { connect, createServer, type Server, type Socket } from 'node:net'
import { tmpdir } from 'node:os'
import { join } from 'node:path'
import { PassThrough } from 'node:stream'
import { afterAll, afterEach, describe, expect, it, vi } from 'vitest'
import { CODEC_H264, resetVideoMessage } from './protocol'
import { REMOTE_PATH, type ScrcpyIo, serverArgs, serverError, startScrcpy } from './scrcpy'
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
  return child as unknown as ChildProcess & { stdout: PassThrough; kill: ReturnType<typeof vi.fn> }
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
  it('copies the server, opens a tunnel, starts it and streams what it sends', async () => {
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
    expect(io.spawn).toHaveBeenCalledWith(['-s', '8d2e61a', 'shell', ...serverArgs('5.0.1', runs[1][4].slice(-8))])
    await vi.waitFor(() => expect(packets).toEqual([{ config: true, key: false }, { config: false, key: true }]))
    expect(sizes).toEqual([[720, 1440]])

    const socket = await control
    const got = new Promise<Buffer>((resolve) => socket.once('data', resolve))
    session.send(resetVideoMessage())
    expect([...(await got)]).toEqual([0x11])

    session.stop()
    expect(shell.kill).toHaveBeenCalled()
    await vi.waitFor(() => expect(runs.at(-1)).toEqual(['-s', '8d2e61a', 'forward', '--remove', 'tcp:27183']))
  })

  it('ends when the device stops sending video, and says nothing after stop()', async () => {
    const { port, video } = await fakeDevice(videoBytes())
    const { io } = fakeIo(port)
    const ended: string[] = []
    const session = await startScrcpy('8d2e61a', server, { ...quiet, end: (why) => ended.push(why) }, io)
    ;(await video).destroy()
    await vi.waitFor(() => expect(ended).toEqual(['The device stopped sending video.']))
    session.stop()
    expect(ended).toHaveLength(1)
  })

  it("rejects with the server's own error when it stops before answering", async () => {
    device = createServer((socket) => socket.destroy())
    await new Promise<void>((resolve) => device!.listen(0, '127.0.0.1', resolve))
    const { io, shell } = fakeIo((device.address() as { port: number }).port)
    const started = startScrcpy('8d2e61a', server, quiet, io)
    await new Promise((resolve) => setTimeout(resolve, 50))
    shell.stdout.emit('data', Buffer.from('[server] INFO: Device: [CHAINWAY] C66 (Android 13)\n[server] ERROR: Could not open video stream\n'))
    shell.emit('close', 1)
    await expect(started).rejects.toThrow('Could not open video stream')
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
})

describe('serverError', () => {
  it("takes the server's last error, without its prefix", () => {
    expect(serverError('[server] INFO: Device: [CHAINWAY] C66\n[server] ERROR: Encoding error: x\n')).toBe('Encoding error: x')
    expect(serverError('Exception in thread "main" java.lang.IllegalArgumentException: The server version (5.0.0) does not match the client (5.0.1)\n'))
      .toMatch(/does not match/)
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
})
