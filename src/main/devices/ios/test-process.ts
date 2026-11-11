import type { ChildProcess } from 'node:child_process'
import { EventEmitter } from 'node:events'
import { PassThrough } from 'node:stream'

/** A child process for tests: stdio the test writes and reads; kill() and exit() end it as a real
 *  one ends ('exit', then 'close', after its output). */
export interface FakeProcess {
  proc: ChildProcess
  stdin: PassThrough
  stdout: PassThrough
  stderr: PassThrough
  killed(): boolean
  exit(code?: number | null): void
}

export interface FakeProcessOptions {
  /** kill() with no signal, or SIGTERM, does nothing: only kill('SIGKILL') ends it. Simulates
   *  idb_companion, which handles SIGTERM itself on a dispatch queue, so a run hung on it may never
   *  act on one. */
  ignoreSigterm?: boolean
  /** A spawn that fails once under way, as Node reports ENOENT or EACCES: no pid, then this 'error'
   *  on the next tick, and 'close'. */
  spawnError?: Error
}

let nextPid = 40_000

export function fakeProcess(options: FakeProcessOptions = {}): FakeProcess {
  const emitter = new EventEmitter()
  const stdin = new PassThrough()
  const stdout = new PassThrough()
  const stderr = new PassThrough()
  let ended = false
  let killed = false
  const exit = (code: number | null = 0, signal: NodeJS.Signals | null = null) => {
    if (ended) return
    ended = true
    stdout.end()
    stderr.end()
    setImmediate(() => {
      emitter.emit('exit', code, signal)
      emitter.emit('close', code, signal)
    })
  }
  const proc = Object.assign(emitter, {
    // Node leaves a failed spawn's pid undefined.
    pid: options.spawnError ? undefined : nextPid++,
    stdin,
    stdout,
    stderr,
    kill: (signal?: NodeJS.Signals | number) => {
      killed = true
      if (options.ignoreSigterm && signal !== 'SIGKILL') return true
      exit(null, typeof signal === 'string' ? signal : 'SIGTERM')
      return true
    },
  }) as unknown as ChildProcess
  const spawnError = options.spawnError
  if (spawnError) {
    process.nextTick(() => {
      ended = true
      stdout.end()
      stderr.end()
      emitter.emit('error', spawnError)
      setImmediate(() => emitter.emit('close', -2, null))
    })
  }
  return { proc, stdin, stdout, stderr, killed: () => killed, exit: (code) => exit(code ?? 0) }
}
