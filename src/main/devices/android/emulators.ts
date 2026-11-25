import { type ChildProcess, execFile, spawn } from 'node:child_process'
import { constants } from 'node:fs'
import { access } from 'node:fs/promises'
import { posix, win32 } from 'node:path'
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

/** The AVDs as what the panel can start, by name. `emulator:<AVD name>` is the id a running emulator
 *  gets once it answers (ro.boot.qemu.avd_name), so a pick made at the start matches it; the name has
 *  spaces for `_`, as a running one's has. */
export function startableEmulators(avds: readonly string[]): StartableDevice[] {
  return avds
    .map((name): StartableDevice => ({ id: `emulator:${name}`, kind: 'emulator', name: name.replace(/_/g, ' '), detail: 'Emulator' }))
    .sort((a, b) => a.name.localeCompare(b.name) || a.id.localeCompare(b.id))
}

/** How a started emulator ended, in the panel's words. */
const endedAs = (code: number | null, signal: NodeJS.Signals | null): string =>
  signal ? `The emulator was stopped (${signal}).` : code ? `The emulator stopped (exit code ${code}).` : 'The emulator stopped.'

/** Starts AVD `name` in the emulator's own window, as Android Studio does: detached, so it keeps
 *  running when Deck quits, with nothing read from it. Resolves once it runs; rejects when it can't
 *  be started (ENOENT, EACCES). `ended` hears if it ends while Deck runs, and how, so a start that
 *  dies early (a broken AVD, a missing system image) needn't wait out its 3 minutes. */
export function startAvd(emulator: string, name: string, ended: (how: string) => void = () => {}): Promise<void> {
  if (!isAvdName(name)) return Promise.reject(new Error(`"${name}" isn't an AVD's name.`))
  return new Promise((resolve, reject) => {
    let child: ChildProcess
    try {
      // windowsHide keeps a console from opening on Windows. Unchecked there: if the emulator's own
      // window doesn't show (SW_HIDE reaching it), or a console window opens beside it, start here.
      child = spawn(emulator, ['-avd', name], { detached: true, stdio: 'ignore', windowsHide: true })
    } catch (err) {
      return reject(err instanceof Error ? err : new Error(String(err)))
    }
    child.once('error', reject)
    child.once('spawn', () => {
      // Deck's quit doesn't wait for it, and nothing of Deck's ends it.
      child.unref()
      resolve()
    })
    child.once('exit', (code, signal) => ended(endedAs(code, signal)))
  })
}

/** Tells emulator `serial` (adb's name for it, `emulator-5554`) to close, through its console:
 *  `adb -s <serial> emu kill`. Resolves once it was told; it closes a moment later. */
export async function killEmulator(adb: string, serial: string): Promise<void> {
  // Only an emulator's adb name reaches its console, and only such a name goes into the argv.
  if (!/^emulator-\d+$/.test(serial)) throw new Error(`${serial} isn't an emulator.`)
  await runAdb(adb, ['-s', serial, 'emu', 'kill'])
}
