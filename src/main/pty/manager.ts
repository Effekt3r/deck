import { randomUUID } from 'node:crypto'
import { posix, win32 } from 'node:path'
import { type IPty, spawn as ptySpawn } from 'node-pty'
import type { PtyCreateOptions, PtyInfo } from '@shared/types'
import type { ShellLaunch } from '../shell/launch'
import { DataBatcher } from './batcher'
import { StartupCommand } from './startup-command'

export type Launcher = (cwd: string) => ShellLaunch
type Spawn = typeof ptySpawn

/** Flow control (xterm.js's watermark scheme): stop reading a pty once this much
 *  output is unacknowledged by its terminal, and go on again below LOW. A flood
 *  (`yes`, a huge `cat`) would otherwise swamp the renderer every tab shares. */
const HIGH_WATER = 100_000
const LOW_WATER = 10_000

export interface PtyEvents {
  data(id: string, data: string): void
  exit(id: string, exitCode: number): void
  /** The pty's foreground process changed, e.g. 'zsh' → 'claude'. */
  process(id: string, name: string): void
}

interface Session {
  pty: IPty
  poll: ReturnType<typeof setInterval>
  startup?: StartupCommand
  /** Foreground process name last reported. */
  processName: string
  /** Windows: node-pty's `process` is the terminal name ('xterm-256color'),
   *  so the tab reports the shell's own name instead. */
  fixedName?: string
  /** Characters sent to the renderer and not yet acknowledged. */
  unacked: number
  paused: boolean
}

/** The node-pty sessions behind the terminal tabs, one shell per tab. */
export class PtyManager {
  private readonly launcher: Launcher
  private readonly events: PtyEvents
  private readonly processPollMs: number
  private readonly spawn: Spawn
  private readonly batcher: DataBatcher
  private readonly sessions = new Map<string, Session>()

  constructor(launcher: Launcher, events: PtyEvents, opts: { processPollMs?: number; spawn?: Spawn } = {}) {
    this.launcher = launcher
    this.events = events
    this.processPollMs = opts.processPollMs ?? 1000
    this.spawn = opts.spawn ?? ptySpawn
    this.batcher = new DataBatcher((id, data) => this.events.data(id, data))
  }

  create(opts: PtyCreateOptions): PtyInfo {
    const launch = this.launcher(opts.cwd)
    // ConPTY on Windows by default.
    const p = this.spawn(launch.file, launch.args, {
      name: 'xterm-256color', cols: opts.cols, rows: opts.rows, cwd: opts.cwd, env: launch.env,
    })
    const id = randomUUID()
    // zsh always loads Deck's hook, so it can wait for the prompt: a blind
    // timeout would type into startup questions such as oh-my-zsh's
    // "update? [Y/n]". PowerShell keeps it (an execution policy can block the hook).
    const timeoutMs = posix.basename(launch.file) === 'zsh' ? null : 4000
    const session: Session = {
      pty: p,
      poll: setInterval(() => this.pollProcess(id), this.processPollMs),
      startup: opts.command ? new StartupCommand(opts.command, (d) => p.write(d), { timeoutMs }) : undefined,
      processName: '',
      fixedName: process.platform === 'win32' ? win32.basename(launch.file) : undefined,
      unacked: 0,
      paused: false,
    }
    this.sessions.set(id, session)
    p.onData((d) => {
      session.startup?.onData(d)
      this.batcher.push(id, d)
      session.unacked += d.length
      if (!session.paused && session.unacked > HIGH_WATER) {
        session.paused = true
        this.guard(id, 'pause', () => p.pause())
      }
    })
    p.onExit(({ exitCode }) => {
      this.forget(id)
      this.batcher.flushAll()
      this.events.exit(id, exitCode)
    })
    return { id, shell: launch.file, pid: p.pid }
  }

  // write/resize/kill can race the shell's exit: node-pty throws on a pty whose
  // process is gone (ConPTY for ~1 s before its exit event), and a throw here
  // would end up as an error dialog from an IPC listener.
  write(id: string, data: string): void {
    const s = this.sessions.get(id)
    if (s) this.guard(id, 'write', () => s.pty.write(data))
  }

  resize(id: string, cols: number, rows: number): void {
    // node-pty throws on sizes below 1.
    if (!(cols >= 1 && rows >= 1 && Number.isFinite(cols) && Number.isFinite(rows))) return
    const s = this.sessions.get(id)
    if (s) this.guard(id, 'resize', () => s.pty.resize(cols, rows))
  }

  /** The renderer has processed `chars` characters of this pty's output. */
  ack(id: string, chars: number): void {
    const s = this.sessions.get(id)
    if (!s) return
    s.unacked = Math.max(0, s.unacked - chars)
    if (s.paused && s.unacked < LOW_WATER) {
      s.paused = false
      this.guard(id, 'resume', () => s.pty.resume())
    }
  }

  kill(id: string): void {
    const s = this.sessions.get(id)
    if (!s) return
    this.forget(id)
    this.guard(id, 'kill', () => s.pty.kill())
  }

  killAll(): void {
    for (const id of [...this.sessions.keys()]) this.kill(id)
  }

  private pollProcess(id: string): void {
    const s = this.sessions.get(id)
    if (!s) return
    let name: string | undefined
    try {
      name = s.fixedName ?? s.pty.process
    } catch {
      return // the pty is closing; its exit follows
    }
    if (name && name !== s.processName) {
      s.processName = name
      this.events.process(id, name)
    }
  }

  private guard(id: string, what: string, fn: () => void): void {
    try {
      fn()
    } catch (err) {
      console.warn(`pty ${id}: ${what} failed:`, err instanceof Error ? err.message : err)
    }
  }

  private forget(id: string): void {
    const s = this.sessions.get(id)
    if (!s) return
    clearInterval(s.poll)
    s.startup?.dispose()
    this.sessions.delete(id)
  }
}
