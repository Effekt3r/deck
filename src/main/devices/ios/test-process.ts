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
}

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
  return { proc, stdin, stdout, stderr, killed: () => killed, exit: (code) => exit(code ?? 0) }
}
