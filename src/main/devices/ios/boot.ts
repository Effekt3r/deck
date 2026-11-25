import { type ChildProcess, spawn } from 'node:child_process'
import { asFailure, endedHow, lastLine, stopper } from './process'

export interface BootOptions {
  /** A device set other than Xcode's own (DECK_SIMULATOR_SET), or null. */
  set: string | null
  /** Ends the command at once (Deck quitting): it rejects with "Stopped.". */
  signal?: AbortSignal
  /** ms; tests shorten it. */
  timeoutMs?: number
}

/** idb_companion starts each line of its log with a timestamp ("2026-11-25 15:22:03.218+0200 "):
 *  the reason shown is what follows. */
const STAMP = /^\d{4}-\d\d-\d\d \d\d:\d\d:\d\d(?:\.\d+)?[+-]\d{4} /
/** A log line that reads as a failure, without its timestamp; null for any other. */
const failureLine = (line: string): string | null => asFailure(line.replace(STAMP, '')) || null

/** Boots simulator `udid` with `idb_companion --boot`: through CoreSimulator, as idb does
 *  everything, not `xcrun simctl`, whose wrapper can run Xcode's first-launch step. It doesn't open
 *  Simulator.app (measured 2026-11-25), and without --headless the simulator stays booted after
 *  the command ends. Resolves when idb says the boot has finished (18 s for a first boot, 3 s after
 *  that), which is after the notifier already said "Booted". */
export const bootSimulator = (idb: string, udid: string, opts: BootOptions): Promise<void> => runIdb(idb, ['--boot', udid], opts)

/** Shuts simulator `udid` down with `idb_companion --shutdown` (3 to 6 s). One already shut down is
 *  fine. */
export const shutdownSimulator = (idb: string, udid: string, opts: BootOptions): Promise<void> => runIdb(idb, ['--shutdown', udid], opts)

/** Runs one idb_companion command at --log-level info (its default, debug, would bury a failure's
 *  line in chatter) for up to `timeoutMs` (120 s). Rejects with its last line that reads as a
 *  failure, else how it ended. A SIGTERM ends idb_companion with exit code 0, so an abort answers
 *  "Stopped." before its close is seen. */
function runIdb(idb: string, args: string[], { set, signal, timeoutMs = 120_000 }: BootOptions): Promise<void> {
  return new Promise((resolve, reject) => {
    if (signal?.aborted) return reject(new Error('Stopped.'))
    let child: ChildProcess
    try {
      child = spawn(idb, [...args, ...(set ? ['--device-set-path', set] : []), '--log-level', 'info'], { stdio: ['ignore', 'pipe', 'pipe'] })
    } catch (err) {
      return reject(err instanceof Error ? err : new Error(String(err)))
    }
    const stop = stopper(child)
    const said = lastLine(child.stderr, failureLine)
    lastLine(child.stdout) // read to its end, so the pipe never fills
    let done = false
    const finish = (err: Error | null) => {
      if (done) return
      done = true
      clearTimeout(timer)
      signal?.removeEventListener('abort', onAbort)
      if (err) reject(err)
      else resolve()
    }
    const onAbort = () => {
      stop()
      finish(new Error('Stopped.'))
    }
    const timer = setTimeout(() => {
      stop()
      finish(new Error(`idb_companion didn't finish within ${Math.max(1, Math.round(timeoutMs / 1000))} s.`))
    }, timeoutMs)
    signal?.addEventListener('abort', onAbort, { once: true })
    child.on('error', (err) => finish(new Error(said() || err.message)))
    child.on('close', (code, sig) => finish(code === 0 ? null : new Error(said() || endedHow('idb_companion', code, sig))))
  })
}
