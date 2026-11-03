import { execFile } from 'node:child_process'
import { constants } from 'node:fs'
import { access } from 'node:fs/promises'
import { posix, win32 } from 'node:path'

export class AdbError extends Error {
  constructor(message: string) {
    super(message)
    this.name = 'AdbError'
  }
}

/** Where adb may be, in the order Deck tries them: ANDROID_HOME and ANDROID_SDK_ROOT (Deck's own
 *  environment — on Windows this must be the live process.env, since its names are case-insensitive
 *  there and a copy holds `Path`, not `PATH`; one set only in shell profiles isn't seen when Deck
 *  starts from Finder), the SDK's usual place, then PATH and Homebrew's folders. The SDK's adb comes
 *  before the others because Android Studio runs it, and two adb versions restart each other's
 *  server. Only absolute paths are tried: a relative PATH entry means "run what's in the current
 *  folder", not Deck's. */
export function adbCandidates(env: NodeJS.ProcessEnv, platform: NodeJS.Platform, home: string): string[] {
  const path = platform === 'win32' ? win32 : posix
  const exe = platform === 'win32' ? 'adb.exe' : 'adb'
  // Windows PATH entries are sometimes individually quoted ("C:\Program Files\...").
  const unquote = (dir: string): string => (platform === 'win32' && dir.startsWith('"') && dir.endsWith('"') ? dir.slice(1, -1) : dir)
  const sdks = [env.ANDROID_HOME, env.ANDROID_SDK_ROOT]
  if (platform === 'darwin') sdks.push(path.join(home, 'Library', 'Android', 'sdk'))
  else if (platform === 'win32') sdks.push(path.join(env.LOCALAPPDATA || path.join(home, 'AppData', 'Local'), 'Android', 'Sdk'))
  else sdks.push(path.join(home, 'Android', 'Sdk'))
  const dirs = (env.PATH ?? '').split(path.delimiter).map(unquote)
  if (platform === 'darwin') dirs.push('/opt/homebrew/bin', '/usr/local/bin')
  const files = [
    ...sdks.filter((dir): dir is string => typeof dir === 'string' && path.isAbsolute(dir)).map((dir) => path.join(dir, 'platform-tools', exe)),
    ...dirs.filter((dir) => dir !== '' && path.isAbsolute(dir)).map((dir) => path.join(dir, exe)),
  ]
  return [...new Set(files)]
}

/** The first candidate that is there and can be run; null when none is. */
export async function findAdb(candidates: readonly string[]): Promise<string | null> {
  for (const file of candidates) {
    if (await access(file, constants.X_OK).then(() => true, () => false)) return file
  }
  return null
}

/** stdout of `adb <args>`, as utf8 text. Throws AdbError with adb's own error line ("adb: device
 *  offline"), else the output's last line, else a summary of how adb failed; cut to 500 characters. */
export function runAdb(adb: string, args: readonly string[], timeoutMs = 15_000): Promise<string> {
  return new Promise((resolve, reject) => {
    const child = execFile(adb, args, { encoding: 'utf8', timeout: timeoutMs, maxBuffer: 16 * 1024 * 1024, windowsHide: true },
      (err, stdout, stderr) => {
        if (!err) return resolve(stdout)
        if (err.killed) return reject(new AdbError(`adb didn't answer within ${Math.max(1, Math.round(timeoutMs / 1000))} s.`))
        if (err.code === 'ERR_CHILD_PROCESS_STDIO_MAXBUFFER') return reject(new AdbError('adb printed more than 16 MiB.'))
        const fallback = typeof err.code === 'number' ? `adb exited with code ${err.code}.` : err.signal ? `adb was stopped (${err.signal}).` : err.message
        reject(new AdbError((lastWord(stderr) ?? lastWord(stdout) ?? fallback).slice(0, 500)))
      })
    // Nothing Deck runs reads stdin: EOF instead of a wait; an adb that exits first makes it an EPIPE.
    child.stdin?.on('error', () => {})
    child.stdin?.end()
  })
}

/** adb's own error lines start with "adb:" or "error:" (an unauthorized device's is followed by
 *  hints); "* daemon …" lines are chatter. Else the last line said. */
function lastWord(text: string): string | undefined {
  const lines = text.split('\n').map((line) => line.trim()).filter((line) => line && !line.startsWith('* '))
  return lines.findLast((line) => /^(adb: |error: )/.test(line)) ?? lines.at(-1)
}
