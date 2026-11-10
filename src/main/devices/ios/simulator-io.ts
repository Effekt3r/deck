import { type ChildProcess, spawn, type SpawnOptions } from 'node:child_process'
import { randomBytes } from 'node:crypto'
import { lstatSync, mkdirSync, rmSync } from 'node:fs'
import { stat } from 'node:fs/promises'
import { posix } from 'node:path'
import { GrpcClient } from './grpc'
import type { SimulatorIo } from './simulator'

/** The longest Unix socket path macOS takes: sun_path's 104 bytes, less the NUL. */
const MAX_SOCKET_PATH = 103
/** A socket's name in its folder: "/", the simulator's first 8 characters, "-", 8 hex, ".sock". */
const SOCKET_NAME = 23

/** Whether `dir` is this user's own folder, closed to everyone else; lstat, so a link in its place
 *  is refused. */
function isPrivateDir(dir: string): boolean {
  const owned = lstatSync(dir)
  return owned.isDirectory() && owned.uid === process.getuid?.() && (owned.mode & 0o077) === 0
}

/** Removes the companions' socket folder (at quit), sockets and all, only when it's this user's own
 *  private folder, as companion() checks: a folder in /tmp that another user owns could have been
 *  swapped for a link, so anything else is left alone. Never throws. */
export function removeSocketDir(dir: string): void {
  try {
    if (isPrivateDir(dir)) rmSync(dir, { recursive: true, force: true })
  } catch {
    // Gone already, or not ours to remove: nothing to do at quit either way.
  }
}

/** The folder for the companions' sockets: Deck's own in the temp folder, or `/tmp` when that path
 *  would leave too little room for a socket's name. macOS paths, whatever the platform: only macOS
 *  runs simulators. */
export function socketDirFor(temp: string, instance: string, uid: number): string {
  const dir = posix.join(temp, `deck-${instance}`)
  return Buffer.byteLength(dir) <= MAX_SOCKET_PATH - SOCKET_NAME ? dir : posix.join('/tmp', `deck-${uid}-${instance}`)
}

export interface SimulatorIoDeps {
  spawn(command: string, args: string[], options: SpawnOptions): ChildProcess
}

/** The real io: Homebrew's idb_companion and sim-video, sockets in `dir`. macOS only. */
export function simulatorIo(
  opts: { companion: string; simVideo: string; set: string; customSet: boolean; dir: string },
  deps: SimulatorIoDeps = { spawn },
): SimulatorIo {
  return {
    // At random, not counted: each start builds its own io, and a companion that's slow to exit
    // removes its socket as it closes, which must never be a newer one's.
    socketFor: (udid) => posix.join(opts.dir, `${udid.slice(0, 8)}-${randomBytes(4).toString('hex')}.sock`),
    companion: (udid, socket) => {
      mkdirSync(opts.dir, { recursive: true, mode: 0o700 })
      // Only this user may reach the companion: refuse a folder someone else made (in /tmp), or a
      // link in its place.
      if (!isPrivateDir(opts.dir)) throw new Error(`${opts.dir} isn't private to this user.`)
      rmSync(socket, { force: true })
      const child = deps.spawn(opts.companion, [
        '--udid', udid, '--grpc-domain-sock', socket, '--terminate-offline', 'true', '--log-level', 'info',
        ...(opts.customSet ? ['--device-set-path', opts.set] : []),
      ], { stdio: ['ignore', 'ignore', 'pipe'] })
      child.on('close', () => {
        // A throw in an event handler reaches main's uncaught exception handler; the folder goes at
        // quit anyway.
        try {
          rmSync(socket, { force: true })
        } catch {}
      })
      return child
    },
    socketReady: async (socket, signal) => {
      while (!signal.aborted) {
        if (await stat(socket).then((s) => s.isSocket(), () => false)) return
        await new Promise((resolve) => setTimeout(resolve, 100))
      }
      throw new Error('Stopped.')
    },
    connect: (socket, onClose) => new GrpcClient(socket, onClose),
    video: (udid, scale) => deps.spawn(opts.simVideo, [
      'stream', '--set', opts.set, '--udid', udid, '--scale', scale.toFixed(3), '--key-frame-rate', '2', '--transport', 'fmp4', '-',
    ], { stdio: ['pipe', 'pipe', 'pipe'] }),
  }
}
