import { execFile } from 'node:child_process'
import { realpath, stat } from 'node:fs/promises'
import { basename, delimiter, dirname, isAbsolute, join } from 'node:path'

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

/** Homebrew's stable "opt" link for sim-video, beside a companion found as `<prefix>/bin/idb_companion`
 *  (`<prefix>/opt/idb-companion/libexec/sim-video`): `brew link`/`brew upgrade` keep it pointing at
 *  the current version, unlike the versioned Cellar path a running Deck may have realpath'd before an
 *  upgrade deletes it. null when `companion` wasn't found under a `bin` folder. */
function stableSimVideo(companion: string): string | null {
  const bin = dirname(companion)
  if (basename(bin) !== 'bin') return null
  return join(dirname(bin), 'opt', 'idb-companion', 'libexec', 'sim-video')
}

/** The first idb_companion found, and its sim-video: Homebrew's stable opt link when there is one,
 *  else beside the real file (`…/Cellar/idb-companion/<version>/libexec/`). */
export async function findIdb(candidates: readonly string[]): Promise<IdbTools | null> {
  for (const companion of candidates) {
    if (!(await isFile(companion))) continue
    const stable = stableSimVideo(companion)
    if (stable && (await isFile(stable))) return { companion, simVideo: stable }
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

export interface AnySimulatorBootedDeps {
  run(cmd: string, args: string[]): Promise<string>
}

/** Whether any simulator is booted, asked without idb (to say idb-companion is missing). Each booted
 *  simulator runs one `launchd_sim`, so `pgrep -x launchd_sim` finds it without starting anything:
 *  unlike the selected Xcode's `usr/bin/simctl` (a bash wrapper that can run
 *  `xcodebuild -runFirstLaunch` after an Xcode update), which a background hint must never trigger.
 *  Counts any device set, which is fine for a hint. True when pgrep exits 0 with output; false
 *  otherwise (exit 1: no match; anything else: unreadable). */
export async function anySimulatorBooted(deps: AnySimulatorBootedDeps = { run: runTool }): Promise<boolean> {
  try {
    const out = await deps.run('/usr/bin/pgrep', ['-x', 'launchd_sim'])
    return out.trim().length > 0
  } catch {
    return false
  }
}
