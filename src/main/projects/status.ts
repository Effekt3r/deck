import type { ProjectStatus } from '@shared/types'
import { tryGit } from '../git/runner'

/** Counts from `git status --porcelain=v1`, one per path: a path staged and changed again is one
 *  changed path here (the git panel's `countStatus` in git/summary.ts counts it in both). */
export function countStatus(porcelain: string): Omit<ProjectStatus, 'path'> {
  let changed = 0
  let untracked = 0
  let conflicts = 0
  for (const line of porcelain.split('\n')) {
    if (line.length < 2) continue
    const xy = line.slice(0, 2)
    if (xy === '??') untracked++
    else if (xy.includes('U') || xy === 'AA' || xy === 'DD') conflicts++
    else changed++ // staged, modified or both: one path either way
  }
  return { changed, untracked, conflicts }
}

async function statusOf(path: string, timeout: number): Promise<ProjectStatus | null> {
  // The runner keeps optional locks and fsmonitor off; null: not a repo, no git, or too slow.
  const out = await tryGit(path, ['status', '--porcelain=v1'], { timeoutMs: timeout })
  return out === null ? null : { path, ...countStatus(out) }
}

/** Dirty counts for each repo in `paths`, a few git processes at a time; non-repos are left out. */
export async function projectStatus(
  paths: string[],
  opts: { concurrency?: number; timeoutMs?: number } = {},
): Promise<ProjectStatus[]> {
  const { concurrency = 4, timeoutMs = 3000 } = opts
  const results: (ProjectStatus | null)[] = []
  let next = 0
  const worker = async () => {
    while (next < paths.length) {
      const i = next++
      results[i] = await statusOf(paths[i], timeoutMs)
    }
  }
  await Promise.all(Array.from({ length: Math.max(1, Math.min(concurrency, paths.length)) }, worker))
  return results.filter((s): s is ProjectStatus => s !== null)
}
