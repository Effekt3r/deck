import { type ChildProcess, execFile, spawn } from 'node:child_process'
import { closeSync, constants, mkdirSync, openSync, readdirSync, readSync, statSync, unlinkSync } from 'node:fs'
import { access } from 'node:fs/promises'
import { join, posix, win32 } from 'node:path'
import type { StartableDevice } from '@shared/types'
import { runAdb } from './adb'

/** An AVD's name as avdmanager allows it (letters, digits, `.`, `_`, `-`), not starting with a dash:
 *  it goes into the emulator's argv after `-avd`. Whatever else `-list-avds` prints (the emulator's
 *  own INFO and WARNING lines, blank lines) isn't one. */
const AVD_NAME = /^[A-Za-z0-9._][A-Za-z0-9._-]*$/

export const isAvdName = (name: string): boolean => name.length <= 200 && AVD_NAME.test(name)

/** The AVD names in `emulator -list-avds`'s output, each once, in its order. */
export function avdNames(stdout: string): string[] {
  return [...new Set(stdout.split(/\r?\n/).map((line) => line.trim()).filter(isAvdName))]
}

/** `<sdk>/emulator/emulator` (`emulator.exe` on Windows) in each SDK folder, in order. */
export function emulatorCandidates(sdks: readonly string[], platform: NodeJS.Platform): string[] {
  const path = platform === 'win32' ? win32 : posix
  const exe = platform === 'win32' ? 'emulator.exe' : 'emulator'
  return sdks.map((dir) => path.join(dir, 'emulator', exe))
}

/** The first SDK's emulator that is there and can be run, or null. Only an SDK has one: an adb found
 *  on PATH or through Homebrew comes without, and then there's nothing to start. (Not findAdb: the
 *  IPC tests replace that one.) */
export async function findEmulator(sdks: readonly string[], platform: NodeJS.Platform): Promise<string | null> {
  for (const file of emulatorCandidates(sdks, platform)) {
    if (await access(file, constants.X_OK).then(() => true, () => false)) return file
  }
  return null
}

/** The AVDs `emulator -list-avds` prints (Android Studio's Device Manager makes them). Rejects when
 *  it fails, or takes longer than `timeoutMs`. */
export function listAvds(emulator: string, timeoutMs = 10_000): Promise<string[]> {
  return new Promise((resolve, reject) => {
    const child = execFile(emulator, ['-list-avds'], { encoding: 'utf8', timeout: timeoutMs, maxBuffer: 1024 * 1024, windowsHide: true },
      (err, stdout) => (err ? reject(err) : resolve(avdNames(stdout))))
    // It reads nothing: EOF rather than a wait; one that exits first makes it an EPIPE.
    child.stdin?.on('error', () => {})
    child.stdin?.end()
  })
}

/** The AVDs as what the panel can start, by name (numbers by value: Pixel 9 before Pixel 10, as
 *  simulators and `Starts.merge` sort them). `emulator:<AVD name>` is the id a running emulator
 *  gets once it answers (ro.boot.qemu.avd_name), so a pick made at the start matches it; the name has
 *  spaces for `_`, as a running one's has. */
export function startableEmulators(avds: readonly string[]): StartableDevice[] {
  return avds
    .map((name): StartableDevice => ({ id: `emulator:${name}`, kind: 'emulator', name: name.replace(/_/g, ' '), detail: 'Emulator' }))
    .sort((a, b) => a.name.localeCompare(b.name, undefined, { numeric: true }) || a.id.localeCompare(b.id))
}

/** How a started emulator ended, in the panel's words. */
const endedAs = (code: number | null, signal: NodeJS.Signals | null): string =>
  signal ? `The emulator was stopped (${signal}).` : code ? `The emulator stopped (exit code ${code}).` : 'The emulator stopped.'

/** Only this much of the emulator's log is checked for its own failure line: enough for its startup
 *  chatter, not so much a huge log costs anything to read. */
const LOG_TAIL_BYTES = 16 * 1024
/** The emulator's own lines that say it failed: PANIC and FATAL, else ERROR. Its last line is usually
 *  a "(Note: Directories are searched...)" hint, not the failure, so the first one found is taken, not
 *  the last; and an ERROR can be harmless (a normal shutdown writes "Failed to restore previous
 *  context"), so a PANIC or FATAL wins over an earlier ERROR. */
const FATAL_LINE = /^(?:PANIC|FATAL)\b/
const ERROR_LINE = /^ERROR\b/
/** Its own "LEVEL        | " prefix on a log line: a word, spaces, `|`, spaces. */
const LOG_PREFIX = /^\S+\s+\|\s*/

/** The first line in `file`'s last LOG_TAIL_BYTES that reads as a failure, its own prefix stripped and
 *  cut to 500 characters; null without one, or without a file there to read (no logDir, or it couldn't
 *  be made or opened for writing). */
function logFailure(file: string): string | null {
  let fd: number
  try {
    fd = openSync(file, 'r')
  } catch {
    return null
  }
  try {
    const size = statSync(file).size
    const length = Math.min(size, LOG_TAIL_BYTES)
    const buffer = Buffer.alloc(length)
    readSync(fd, buffer, 0, length, size - length)
    const lines = buffer.toString('utf8').split(/\r?\n/)
    const line = lines.find((l) => FATAL_LINE.test(l)) ?? lines.find((l) => ERROR_LINE.test(l))
    return line === undefined ? null : line.replace(LOG_PREFIX, '').slice(0, 500)
  } catch {
    return null
  } finally {
    closeSync(fd)
  }
}

/** Removes AVD `name`'s earlier logs from `dir`: exactly `<name>-<digits>.log`, so AVD `Pixel` never
 *  takes `Pixel-2`'s. As best it can: Windows may refuse to remove a log an emulator still runs with,
 *  and it stays until a later start's. */
function removeOldLogs(dir: string, name: string): void {
  const escaped = name.replace(/[.*+?^${}()|[\]\\]/g, '\\$&')
  const own = new RegExp(`^${escaped}-\\d+\\.log$`)
  let files: string[]
  try {
    files = readdirSync(dir)
  } catch {
    return
  }
  for (const file of files) {
    if (!own.test(file)) continue
    try {
      unlinkSync(join(dir, file))
    } catch {
      // still in use, or already gone
    }
  }
}

/** Starts AVD `name` in the emulator's own window, as Android Studio does: detached, so it keeps running
 *  when Deck quits. Resolves once it runs; rejects when it can't be started (ENOENT, EACCES). `ended`
 *  hears if it ends while Deck runs, how, and whether that was clean (code 0, no signal): a start that
 *  dies early (a broken AVD, a missing system image) needn't wait out its 3 minutes, and a clean exit is
 *  the user closing its window, not a failure. Its log doesn't decide that: a normal shutdown
 *  (`emu kill`; closing its window should be the same) exits 0 but still writes "ERROR | Failed to
 *  restore previous context: 12297", while its failures exit 1 (an unknown AVD, a second emulator of a
 *  running AVD; macOS, emulator 37.2, 2026-11-26). With `logDir`, the emulator's stdout and stderr go to
 *  a new file of this start's own, `<logDir>/<name>-<ms>.log`, rather than a pipe, since a file, unlike
 *  a pipe, can't ever break the emulator once Deck quits; `ended`'s reason then comes from that log's
 *  first PANIC or FATAL line, else its first ERROR line, read back once it exits. Its own file, not one
 *  per AVD: an older emulator of the same AVD can still be running (Stop, then Start while it saves its
 *  snapshot; Try again while a start past its deadline still boots), and in a shared file its lines
 *  would land among this start's, where the reason read back could be its. Each start removes the AVD's
 *  earlier logs (removeOldLogs). Without `logDir`, or when the folder or the file can't be made, the
 *  start still runs, with nothing read from it, as before. */
export function startAvd(
  emulator: string,
  name: string,
  ended: (how: string, info: { clean: boolean }) => void = () => {},
  logDir: string | null = null,
): Promise<void> {
  if (!isAvdName(name)) return Promise.reject(new Error(`"${name}" isn't an AVD's name.`))
  let logFile: string | null = null
  let fd: number | null = null
  if (logDir) {
    // Milliseconds, so names don't repeat across Deck's runs either: the folder stays in temp.
    logFile = join(logDir, `${name}-${Date.now()}.log`)
    try {
      mkdirSync(logDir, { recursive: true })
      removeOldLogs(logDir, name)
      // 'wx': a new file, never one another emulator still writes to.
      fd = openSync(logFile, 'wx')
    } catch {
      // The start must still work, with nothing read from it (stdio falls back to 'ignore' below):
      // without a file of its own, whatever that path holds isn't this start's to report.
      logFile = null
      fd = null
    }
  }
  return new Promise((resolve, reject) => {
    let child: ChildProcess
    try {
      // No windowsHide: with detached: true libuv already starts it without a console window
      // (Microsoft documents CREATE_NO_WINDOW as ignored for a detached process), and windowsHide's
      // SW_HIDE could instead hide the emulator's own window. Unverified on Windows.
      child = spawn(emulator, ['-avd', name], { detached: true, stdio: fd !== null ? ['ignore', fd, fd] : 'ignore' })
    } catch (err) {
      return reject(err instanceof Error ? err : new Error(String(err)))
    } finally {
      // Node dups an fd passed as stdio for the child; Deck's own copy is done with it either way.
      if (fd !== null) closeSync(fd)
    }
    child.once('error', reject)
    child.once('spawn', () => {
      // Deck's quit doesn't wait for it, and nothing of Deck's ends it.
      child.unref()
      resolve()
    })
    child.once('exit', (code, signal) => {
      const failure = (logFile && logFailure(logFile)) || null
      ended(failure || endedAs(code, signal), { clean: code === 0 && signal === null })
    })
  })
}

/** Tells emulator `serial` (adb's name for it, `emulator-5554`) to close, through its console:
 *  `adb -s <serial> emu kill`. Resolves once it was told; it closes a moment later. */
export async function killEmulator(adb: string, serial: string): Promise<void> {
  // Only an emulator's adb name reaches its console, and only such a name goes into the argv.
  if (!/^emulator-\d+$/.test(serial)) throw new Error(`${serial} isn't an emulator.`)
  await runAdb(adb, ['-s', serial, 'emu', 'kill'])
}
