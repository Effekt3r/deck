import { randomUUID } from 'node:crypto'
import { posix, win32 } from 'node:path'
import { type IPty, spawn } from 'node-pty'
import type { PtyCreateOptions, PtyInfo } from '@shared/types'
import type { ShellLaunch } from '../shell/launch'
import { DataBatcher } from './batcher'
import { StartupCommand } from './startup-command'

export type Launcher = (cwd: string) => ShellLaunch

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
}

/** The node-pty sessions behind the terminal tabs, one shell per tab. */
export class PtyManager {
  private readonly launcher: Launcher
  private readonly events: PtyEvents
  private readonly processPollMs: number
  private readonly batcher: DataBatcher
  private readonly sessions = new Map<string, Session>()

  constructor(launcher: Launcher, events: PtyEvents, opts: { processPollMs?: number } = {}) {
    this.launcher = launcher
    this.events = events
    this.processPollMs = opts.processPollMs ?? 1000
    this.batcher = new DataBatcher((id, data) => this.events.data(id, data))
  }

  create(opts: PtyCreateOptions): PtyInfo {
    const launch = this.launcher(opts.cwd)
    // ConPTY on Windows by default.
    const p = spawn(launch.file, launch.args, {
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
    }
    this.sessions.set(id, session)
    p.onData((d) => {
      session.startup?.onData(d)
      this.batcher.push(id, d)
    })
    p.onExit(({ exitCode }) => {
      this.forget(id)
      this.batcher.flushAll()
      this.events.exit(id, exitCode)
    })
    return { id, shell: launch.file, pid: p.pid }
  }

  write(id: string, data: string): void {
    this.sessions.get(id)?.pty.write(data)
  }

  resize(id: string, cols: number, rows: number): void {
    // node-pty throws on sizes below 1; in an IPC handler that is a main-process error.
    if (!(cols >= 1 && rows >= 1 && Number.isFinite(cols) && Number.isFinite(rows))) return
    this.sessions.get(id)?.pty.resize(cols, rows)
  }

  kill(id: string): void {
    const s = this.sessions.get(id)
    if (!s) return
    this.forget(id)
    s.pty.kill()
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

  private forget(id: string): void {
    const s = this.sessions.get(id)
    if (!s) return
    clearInterval(s.poll)
    s.startup?.dispose()
    this.sessions.delete(id)
  }
}
