import type { ChildProcess } from 'node:child_process'
import type { DeviceSession, StreamEvents, StreamPacket } from '../session'
import { Fmp4Reader } from './fmp4'
import { GrpcNoAnswer, type GrpcStream } from './grpc'
import { simulatorEvents } from './input'
import { lastLine, stopper } from './process'
import { DESCRIBE_PATH, HID_PATH, parseDescribe, type ScreenSize } from './proto'

/** What a session needs of the gRPC client. */
export interface IdbConnection {
  unary(path: string, message: Buffer, timeoutMs?: number): Promise<Buffer>
  /** `onEnd`: idb ended the call (an event it couldn't perform); a new one may be opened. */
  stream(path: string, onEnd?: (why: string) => void): GrpcStream
  close(): void
}

/** How a session reaches idb: the real one is simulator-io.ts's; tests replace it. The session
 *  listens to each process's 'error' at once: a spawn that fails once under way (ENOENT, EACCES)
 *  says so there. */
export interface SimulatorIo {
  /** A new socket path for `udid`'s companion. */
  socketFor(udid: string): string
  /** `idb_companion --udid <udid> --grpc-domain-sock <socket> --terminate-offline true`. Throws when
   *  it can't be started at all. */
  companion(udid: string, socket: string): ChildProcess
  /** Resolves once the socket is there; rejects when `signal` aborts. */
  socketReady(socket: string, signal: AbortSignal): Promise<void>
  /** A gRPC client on the socket; `onClose` when its connection closes. */
  connect(socket: string, onClose: () => void): IdbConnection
  /** `sim-video stream … --scale <scale> --key-frame-rate 2 --transport fmp4 -`, stdin kept open. */
  video(udid: string, scale: number): ChildProcess
}

/** The picture's long side, as scrcpy's max_size for Android. */
const MAX_SIDE = 1600
/** sim-video can't be asked for a key frame. A group of pictures this short (the last key frame and
 *  what followed) is replayed instead; a longer one would trip the view's backlog rule (more than 10
 *  pictures waiting: skip to the next key frame, and ask again), so sim-video is started again, which
 *  begins with a key frame of the screen as it is. */
const REPLAY_FRAMES = 8
/** The companion opens its socket in about half a second (measured); one that hasn't in this long
 *  never will (it can run on without one), so the start gives up in its words rather than spend the
 *  streams' whole 20 s. */
const SOCKET_WAIT = 10_000
/** How long the companion gets to say why it's going: after its connection closes while it runs on,
 *  after sim-video ends without an error of its own, and after describe goes unanswered at the start. */
const WORDS_WAIT = 1000
const NOT_ANSWERING = "The simulator's companion stopped answering."

export const scaleFor = (screen: ScreenSize) => Math.min(1, MAX_SIDE / Math.max(screen.width, screen.height))

/** sim-video's "Error: …" lines, without the word. */
const videoError = (line: string) => (line.startsWith('Error: ') ? line.slice(7) : null)
/** The companion's lines, without the time and the bracketed UDID they start with. */
const companionLine = (line: string) =>
  line.replace(/^\d{4}-\d{2}-\d{2} \S+ /, '').replace(/^\[[^\]\s]+\] /, '').trim() || null

/** Starts simulator `udid`'s stream. Resolves once sim-video runs; the first picture follows within
 *  about a second. `signal` stops a start under way and closes what it opened. */
export async function startSimulator(udid: string, events: StreamEvents, io: SimulatorIo, signal: AbortSignal): Promise<DeviceSession> {
  if (signal.aborted) throw new Error('Stopped.')
  const socket = io.socketFor(udid)
  // A spawn that throws (ENOEXEC) or a socket folder that isn't private rejects the start here, with
  // nothing opened yet.
  const companion = io.companion(udid, socket)
  const companionSaid = lastLine(companion.stderr, companionLine)
  const stopCompanion = stopper(companion)
  let video: { proc: ChildProcess; stop: () => void } | null = null
  let client: IdbConnection | null = null
  let hid: GrpcStream | null = null
  let socketTimer: ReturnType<typeof setTimeout> | undefined
  /** endSoon()'s: the session ends when it fires. */
  let graceTimer: ReturnType<typeof setTimeout> | undefined
  let stopping = false
  let ended = false
  /** Resolved: from here a failure ends the session (before, it rejects the start). */
  let started = false
  /** The connection closed (maybe while the start was still under way). */
  let lost = false
  /** Why the companion ended, once it has. */
  let companionEnded: Error | null = null
  /** The start's own waits (the socket's poll): the streams never abort a start that failed, so a
   *  failure stops them here, as a stop does. */
  const startWork = new AbortController()
  const close = () => {
    startWork.abort()
    clearTimeout(socketTimer)
    clearTimeout(graceTimer)
    hid?.close()
    hid = null
    client?.close()
    stopCompanion()
    video?.stop()
  }
  const end = (why: string) => {
    if (ended || stopping) return
    ended = true
    close()
    events.end(why)
  }
  /** Ends the session as `why` a moment from now, unless the companion's words come first: it exits
   *  when its simulator shuts down, and says so, which explains more. */
  const endSoon = (why: string) => {
    if (ended || stopping || graceTimer) return
    graceTimer = setTimeout(() => end(why), WORDS_WAIT)
  }

  let rejectGone: (err: Error) => void = () => {}
  /** Rejects, in the companion's words, if it ends before the start resolves. */
  const gone = new Promise<never>((_, reject) => {
    rejectGone = reject
  })
  gone.catch(() => {}) // also raced below
  let spawnError = ''
  const companionEnd = () => {
    if (companionEnded) return
    companionEnded = new Error(companionSaid() || spawnError || 'idb_companion stopped.')
    if (started) end(companionEnded.message)
    else rejectGone(companionEnded)
  }
  // A spawn that fails once under way (ENOENT, EACCES) says so in 'error', then 'close'. Unheard,
  // the 'error' would reach main's uncaught exception handler.
  companion.on('error', (err) => {
    spawnError ||= err.message
    companionEnd()
  })
  companion.once('close', companionEnd)

  let onAbort = () => {}
  /** Rejects as `signal` aborts, after closing what the start opened: a stop lands at once. */
  const stopped = new Promise<never>((_, reject) => {
    onAbort = () => {
      close()
      reject(new Error('Stopped.'))
    }
  })
  stopped.catch(() => {}) // also raced below
  signal.addEventListener('abort', onAbort, { once: true })
  let screen: ScreenSize
  try {
    const socketLate = new Promise<never>((_, reject) => {
      socketTimer = setTimeout(
        () => reject(new Error(companionSaid() || `idb_companion didn't open its socket in ${SOCKET_WAIT / 1000} s.`)),
        SOCKET_WAIT,
      )
    })
    await Promise.race([io.socketReady(socket, startWork.signal), gone, stopped, socketLate])
    clearTimeout(socketTimer)
    client = io.connect(socket, () => {
      lost = true
      if (started) endSoon(NOT_ANSWERING)
    })
    screen = parseDescribe(await Promise.race([client.unary(DESCRIBE_PATH, Buffer.alloc(0)), gone, stopped]))
    if (signal.aborted) throw new Error('Stopped.')
  } catch (err) {
    let why = err
    // An unanswered describe is often the companion going: its own words, a moment later, say why.
    // A stop meanwhile lands at once.
    if (err instanceof GrpcNoAnswer && !signal.aborted) {
      let timer: ReturnType<typeof setTimeout> | undefined
      const waited = new Promise<void>((resolve) => {
        timer = setTimeout(resolve, WORDS_WAIT)
      })
      const words = await Promise.race([gone, stopped, waited]).catch((e: unknown) => e)
      clearTimeout(timer)
      if (words instanceof Error) why = words
    }
    signal.removeEventListener('abort', onAbort)
    close()
    throw signal.aborted ? new Error('Stopped.') : why
  }
  signal.removeEventListener('abort', onAbort)
  // Its 'close' heard in the same tick as describe's answer, which still won the race.
  if (companionEnded) {
    close()
    throw companionEnded
  }

  const scale = scaleFor(screen)
  let config: StreamPacket | null = null
  /** The last key frame and the pictures since; null once longer than REPLAY_FRAMES, until the next
   *  key frame. */
  let gop: StreamPacket[] | null = null
  /** A sim-video's first key frame, or a new configuration's, hasn't come yet: one asked for meanwhile
   *  (about 250 ms at every start and restart) is on its way already. */
  let keyFrameDue = true
  const remember = (packet: StreamPacket) => {
    if (packet.key) gop = [packet]
    else if (gop && gop.length < REPLAY_FRAMES) gop.push(packet)
    else gop = null
  }
  /** sim-video, also started again for a key frame: each process reads its own stream, and only the
   *  current one's end ends the session. Throws when spawn does. */
  const startVideo = () => {
    const proc = io.video(udid, scale)
    const v = { proc, stop: stopper(proc) }
    video = v
    config = null
    gop = null
    keyFrameDue = true
    const error = lastLine(proc.stderr, videoError)
    const said = lastLine(proc.stderr)
    let spawnFailed = ''
    const reader = new Fmp4Reader()
    proc.stdout?.on('data', (chunk: Buffer) => {
      if (video !== v || ended || stopping) return
      let parsed
      try {
        parsed = reader.push(chunk)
      } catch (err) {
        return end(err instanceof Error ? err.message : String(err))
      }
      for (const e of parsed) {
        if (e.type === 'config') {
          config = { config: true, key: false, data: e.data }
          gop = null // a new configuration starts with its own key frame
          keyFrameDue = true
          events.size(e.width, e.height)
          events.packet(config)
        } else {
          const packet = { config: false, key: e.key, data: e.data }
          if (packet.key) keyFrameDue = false
          remember(packet)
          events.packet(packet)
        }
      }
    })
    // Ending the stdin of a sim-video that has just gone can fail (EPIPE): its 'close' says why.
    proc.stdin?.on('error', () => {})
    const over = () => {
      if (video !== v || ended || stopping) return
      const definite = error() || spawnFailed
      if (definite) return end(definite)
      // No error of its own: most often its simulator shutting down, which the companion, going too,
      // explains better a moment later. Nothing to replay or restart meanwhile.
      config = null
      endSoon(said() || 'sim-video stopped.')
    }
    proc.on('error', (err) => {
      spawnFailed ||= err.message
      over()
    })
    proc.on('close', over)
  }
  try {
    startVideo()
  } catch (err) {
    close()
    throw err
  }

  const points = { width: screen.widthPoints, height: screen.heightPoints }
  const connection = client
  started = true
  if (lost) endSoon(NOT_ANSWERING)
  return {
    input(input) {
      if (ended || stopping) return
      const messages = simulatorEvents(input, points)
      if (messages.length === 0) return
      let call = hid
      if (!call) {
        const opened = connection.stream(HID_PATH, () => {
          // idb ended the call (an event it couldn't perform): the next input opens another.
          if (hid === opened) hid = null
        })
        call = opened
        hid = opened
      }
      for (const m of messages) call.write(m)
    },
    keyframe() {
      // No configuration (yet, or any more), or its first key frame is on its way.
      if (ended || stopping || !config || keyFrameDue) return
      if (gop) {
        events.packet(config)
        for (const packet of gop) events.packet(packet)
        return
      }
      const old = video
      try {
        startVideo()
      } catch (err) {
        // The old sim-video is still `video`, so it goes with the rest.
        return end(err instanceof Error ? err.message : String(err))
      }
      old?.stop()
    },
    stop() {
      if (stopping) return
      stopping = true
      close()
    },
  }
}
