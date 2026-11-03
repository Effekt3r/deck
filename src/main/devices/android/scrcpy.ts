import { type ChildProcess, spawn } from 'node:child_process'
import { randomInt } from 'node:crypto'
import { connect, type Socket } from 'node:net'
import { runAdb } from './adb'
import { CODEC_H264, VideoReader } from './protocol'
import type { ScrcpyServer } from './server'

/** Where the server is copied on the device. It deletes itself once started (scrcpy's cleanup). */
export const REMOTE_PATH = '/data/local/tmp/deck-scrcpy-server.jar'

export interface ScrcpyEvents {
  /** A capture session started: the frames that follow have this size. */
  size(width: number, height: number): void
  packet(packet: { config: boolean; key: boolean; data: Uint8Array }): void
  /** The stream ended by itself: why. Not called after stop(). */
  end(why: string): void
}

export interface ScrcpySession {
  /** A control message (protocol.ts). */
  send(message: Buffer): void
  stop(): void
}

/** How a session reaches adb and the tunnel; tests replace it. */
export interface ScrcpyIo {
  run(args: string[], timeoutMs?: number): Promise<string>
  spawn(args: string[]): ChildProcess
  connect(port: number): Socket
}

export function adbIo(adb: string): ScrcpyIo {
  return {
    run: (args, timeoutMs) => runAdb(adb, args, timeoutMs),
    spawn: (args) => spawn(adb, args, { stdio: ['ignore', 'pipe', 'pipe'], windowsHide: true }),
    connect: (port) => connect({ host: '127.0.0.1', port }),
  }
}

/** What `adb shell` runs: H.264 at most 1600 px on the long side and 60 frames a second, no audio,
 *  control on; the screen kept on while the device is plugged in (scrcpy puts the setting back when
 *  it stops); the device's own copies not sent back. */
export function serverArgs(version: string, scid: string): string[] {
  return [
    `CLASSPATH=${REMOTE_PATH}`, 'app_process', '/', 'com.genymobile.scrcpy.Server', version,
    `scid=${scid}`, 'log_level=info', 'tunnel_forward=true', 'audio=false', 'control=true',
    'video_codec=h264', 'max_size=1600', 'max_fps=60', 'stay_awake=true', 'clipboard_autosync=false',
  ]
}

/** The last error the server (or adb) printed, without its prefix or class name; '' if none. Scans
 *  backwards: a `Caused by: X` line is read as X; an exception header (`Name` or `Name: message`)
 *  with a message returns the nearest earlier ERROR line (cleaned) when that line already mentions
 *  the message (it's the same complaint, just more specific), else the message alone; without a
 *  message it's `<nearest earlier ERROR line> (<SimpleName>)`, or just `<SimpleName>` with no ERROR
 *  line. Anything else falls back to the nearest ERROR line or adb's own "error:" line, cleaned. A
 *  stack frame ("\tat …") matches none of these and is skipped. */
export function serverError(text: string): string {
  const exceptionLine = /^([\w.$]+(?:Exception|Error))(?::\s*(.*))?$/
  const isErrorLine = (line: string) => /\bERROR\b/.test(line) || /^(adb: )?error:/i.test(line)
  const clean = (line: string) => line.replace(/^\[server\]\s*/, '').replace(/^ERROR:\s*/, '').replace(/^Caused by:\s*/, '')
  const lines = text.split(/\r?\n/).map((line) => line.trim())
  for (let i = lines.length - 1; i >= 0; i--) {
    const line = lines[i]
    const effective = line.startsWith('Caused by: ') ? line.slice('Caused by: '.length) : line
    const exc = exceptionLine.exec(effective)
    if (exc) {
      const [, qualifiedName, message] = exc
      let nearestError = ''
      for (let j = i - 1; j >= 0; j--) {
        if (isErrorLine(lines[j])) {
          nearestError = clean(lines[j])
          break
        }
      }
      if (message) return nearestError && nearestError.includes(message) ? nearestError : message
      const simpleName = qualifiedName.split('.').pop() ?? qualifiedName
      return nearestError ? `${nearestError} (${simpleName})` : simpleName
    }
    if (isErrorLine(line)) return clean(line)
  }
  return ''
}

/** The video codec id's four ASCII letters, the way scrcpy names them (0x68323634 is "h264"); the
 *  hex value when the bytes aren't printable (a corrupt or unknown id). */
function codecName(codec: number): string {
  const bytes = Buffer.alloc(4)
  bytes.writeUInt32BE(codec >>> 0)
  const text = bytes.toString('latin1')
  return /^[\x20-\x7e]{4}$/.test(text) ? text : `0x${codec.toString(16)}`
}

const connected = (socket: Socket) =>
  new Promise<void>((resolve, reject) => {
    socket.once('connect', () => resolve())
    socket.once('error', reject)
    // Destroying a still-connecting socket (cleanUp after a stop, or the shell exiting right then)
    // only ever emits 'close': without this, startScrcpy would hang instead of rejecting.
    socket.once('close', () => reject(new Error('closed before connecting')))
  })

/** Through a forward tunnel a connection succeeds even before the server listens (adb accepts it,
 *  then drops it), so scrcpy's dummy byte says the server is really there. Up to 100 tries, 100 ms
 *  apart, as scrcpy itself does. The socket comes back paused, with what it sent first. `onAttempt`
 *  reports the in-flight attempt's socket (null between attempts), so a stop can close it instead of
 *  waiting out its 2 s cap. */
async function firstAnswer(io: ScrcpyIo, port: number, gaveUp: () => boolean, onAttempt: (socket: Socket | null) => void): Promise<{ socket: Socket; chunk: Buffer }> {
  for (let attempt = 0; attempt < 100 && !gaveUp(); attempt++) {
    const answer = await new Promise<{ socket: Socket; chunk: Buffer } | null>((resolve) => {
      const socket = io.connect(port)
      onAttempt(socket)
      let done = false
      const settle = (value: { socket: Socket; chunk: Buffer } | null) => {
        if (done) return
        done = true
        clearTimeout(timer)
        onAttempt(null)
        if (!value) socket.destroy()
        resolve(value)
      }
      const timer = setTimeout(() => settle(null), 2000)
      socket.on('error', () => {})
      socket.once('close', () => settle(null))
      socket.once('data', (chunk: Buffer) => {
        socket.pause()
        settle({ socket, chunk })
      })
    })
    if (answer) return answer
    await new Promise((resolve) => setTimeout(resolve, 100))
  }
  throw new Error("scrcpy's server didn't answer.")
}

/** Streams one device: copies the server, opens a tunnel, starts the server and connects to its
 *  video and control sockets. Resolves once both sockets are connected (the server answered),
 *  before any frame; rejects, cleaning up, when a step fails or `signal` stops it first. */
export async function startScrcpy(serial: string, server: ScrcpyServer, events: ScrcpyEvents, io: ScrcpyIo, signal?: AbortSignal): Promise<ScrcpySession> {
  const scid = randomInt(0, 0x7fffffff).toString(16).padStart(8, '0')
  const adb = (args: string[], timeoutMs?: number) => io.run(['-s', serial, ...args], timeoutMs)
  let port = 0
  let shell: ChildProcess | null = null
  let probe: Socket | null = null
  let video: Socket | null = null
  let control: Socket | null = null
  let said = ''
  let sawPacket = false
  let endTimer: NodeJS.Timeout | null = null
  let pendingFallback = '' // the reason a video/control close already armed, for the shell's own close
  let returned = false
  let over = false
  let why = ''

  /** Safe to run again: a step that finishes after a stop may have opened something since. */
  const cleanUp = () => {
    if (endTimer) {
      clearTimeout(endTimer)
      endTimer = null
    }
    probe?.destroy()
    video?.destroy()
    control?.destroy()
    shell?.kill()
    if (port) {
      const tunnel = port
      port = 0
      adb(['forward', '--remove', `tcp:${tunnel}`]).catch(() => {})
    }
  }
  /** The stream is over: the caller hears it once it has the session; before that it's thrown. */
  const finish = (reason: string) => {
    if (over) return
    over = true
    why = reason
    cleanUp()
    if (returned) events.end(reason)
  }
  const reason = (fallback: string) => serverError(said) || fallback
  /** Between steps: a stop or a failure meanwhile ends the start here. */
  const still = () => {
    if (over) throw new Error(why)
  }
  /** A video or control close is reported at once, before the shell's own: its last words reach
   *  Deck a moment later (adbd, then the adb client), and explain the drop better. Waits at most 1 s
   *  for the shell to close first; one pending timer, so two closes can't race two reasons, and
   *  finish() itself stays idempotent either way. */
  const finishSoon = (fallback: string) => {
    if (over || endTimer) return
    pendingFallback = fallback
    endTimer = setTimeout(() => {
      endTimer = null
      finish(reason(fallback))
    }, 1000)
  }
  // Stopping a start under way: without it, a Deck that quit mid-start left the server running on
  // the device (seen on 2026-11-03).
  const stop = () => finish('Stopped.')
  signal?.addEventListener('abort', stop, { once: true })

  try {
    if (signal?.aborted) stop()
    still()
    await adb(['push', server.path, REMOTE_PATH], 60_000)
    still()
    port = Number.parseInt((await adb(['forward', 'tcp:0', `localabstract:scrcpy_${scid}`])).trim(), 10)
    still()
    if (!Number.isInteger(port) || port <= 0) throw new Error("adb couldn't open a tunnel to the device.")
    const child = io.spawn(['-s', serial, 'shell', ...serverArgs(server.version, scid)])
    shell = child
    const keep = (chunk: Buffer) => {
      said = `${said}${chunk.toString()}`.slice(-4000)
    }
    child.stdout?.on('data', keep)
    child.stderr?.on('data', keep)
    child.on('error', (err) => finish(err.message))
    child.on('close', (code, sig) => {
      if (endTimer) {
        clearTimeout(endTimer)
        endTimer = null
      }
      const fallback = sig ? `scrcpy's server was stopped (${sig}).` : `scrcpy's server stopped (exit code ${code}).`
      // A socket that already closed explains the drop better than a bare exit code once the
      // server itself said nothing.
      finish(reason(pendingFallback || fallback))
    })

    const first = await firstAnswer(io, port, () => over, (socket) => { probe = socket })
    video = first.socket
    still()
    video.on('error', () => {})
    video.on('close', () => finishSoon('The device stopped sending video.'))

    control = io.connect(port)
    try {
      await connected(control)
    } catch {
      throw new Error("Couldn't connect to the device's control socket.")
    }
    still()
    control.setNoDelay(true) // scrcpy disables Nagle on its control socket: taps shouldn't wait.
    // Nothing needs the tunnel once both sockets are through it; removing it now means a crash
    // after this point leaves no forward behind.
    if (port) {
      const tunnel = port
      port = 0
      adb(['forward', '--remove', `tcp:${tunnel}`]).catch(() => {})
    }
    control.on('error', () => {})
    control.on('data', () => {}) // device messages: none were asked for
    control.on('close', () => finishSoon('The device closed the control connection.'))

    const reader = new VideoReader()
    const onChunk = (chunk: Buffer) => {
      for (const event of reader.feed(chunk)) {
        if (over) return
        if (event.type === 'error') return finish(event.message)
        if (event.type === 'codec' && event.codec !== CODEC_H264) {
          return finish(reason(event.codec <= 1 ? "The device couldn't start its video." : `scrcpy sent another codec (${codecName(event.codec)}).`))
        }
        if (event.type === 'size') events.size(event.width, event.height)
        else if (event.type === 'packet') {
          if (!sawPacket) {
            sawPacket = true
            said = '' // a non-fatal startup line (e.g. a refused settings write) must not outlive it
          }
          events.packet({ config: event.config, key: event.key, data: event.data })
        }
      }
    }
    video.on('data', onChunk)
    onChunk(first.chunk)
    video.resume()
  } catch (err) {
    finish(err instanceof Error ? err.message : String(err))
    cleanUp()
  } finally {
    signal?.removeEventListener('abort', stop)
  }
  if (over) throw new Error(why === 'Stopped.' ? why : serverError(said) || why)
  returned = true

  return {
    send(message) {
      if (!over && control && !control.destroyed) control.write(message)
    },
    stop() {
      if (over) return
      over = true
      cleanUp()
    },
  }
}
