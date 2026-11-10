import { execFile } from 'node:child_process'
import { realpath, stat } from 'node:fs/promises'
import { delimiter, dirname, isAbsolute, join } from 'node:path'

/** idb-companion as Homebrew installs it. */
export interface IdbTools {
  /** idb_companion as found (Homebrew's link). */
  companion: string
  /** sim-video beside idb_companion's real file; null: an idb-companion without it. */
  simVideo: string | null
}

const isFile = (path: string) => stat(path).then((s) => s.isFile(), () => false)

/** Where idb_companion may be: PATH's absolute folders, then Homebrew's (Deck started from Finder
 *  gets a short PATH). `DECK_IDB_COMPANION` replaces them all, so a check can hide idb. */
export function idbCandidates(env: NodeJS.ProcessEnv): string[] {
  if (env.DECK_IDB_COMPANION) return [env.DECK_IDB_COMPANION]
  const dirs = (env.PATH ?? '').split(delimiter).filter((d) => d && isAbsolute(d))
  return [...new Set([...dirs, '/opt/homebrew/bin', '/usr/local/bin'])].map((d) => join(d, 'idb_companion'))
}

/** The first idb_companion found, and the sim-video Homebrew puts beside its real file
 *  (`…/Cellar/idb-companion/<version>/libexec/`). */
export async function findIdb(candidates: readonly string[]): Promise<IdbTools | null> {
  for (const companion of candidates) {
    if (!(await isFile(companion))) continue
    const real = await realpath(companion).catch(() => companion)
    const simVideo = join(dirname(real), 'sim-video')
    return { companion, simVideo: (await isFile(simVideo)) ? simVideo : null }
  }
  return null
}

/** Xcode's own device set, which idb_companion follows unless told another. */
export const defaultSimulatorSet = (home: string) => join(home, 'Library', 'Developer', 'CoreSimulator', 'Devices')

function runTool(cmd: string, args: string[]): Promise<string> {
  return new Promise((resolve, reject) => {
    execFile(cmd, args, { timeout: 10_000, maxBuffer: 8 * 1024 * 1024 }, (err, stdout) => (err ? reject(err) : resolve(stdout)))
  })
}

/** Whether any simulator is booted, asked without idb (to say idb-companion is missing). Only with a
 *  developer folder selected: without one, `xcrun` offers to install the command line tools. */
export async function simulatorBooted(run: (cmd: string, args: string[]) => Promise<string> = runTool): Promise<boolean> {
  try {
    await run('xcode-select', ['-p'])
    const out = await run('xcrun', ['simctl', 'list', 'devices', 'booted', '-j'])
    const devices = (JSON.parse(out) as { devices?: Record<string, { state?: string }[]> }).devices ?? {}
    return Object.values(devices).some((list) => Array.isArray(list) && list.some((d) => d?.state === 'Booted'))
  } catch {
    return false
  }
}
