import { execFile } from 'node:child_process'
import { promisify } from 'node:util'
import type { ProjectStatus } from '@shared/types'

const run = promisify(execFile)

/** Counts from `git status --porcelain=v1`, as `status_counts()` in the prototype does. */
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
  try {
    const { stdout } = await run('git', ['-C', path, 'status', '--porcelain=v1'], {
      // Optional locks off so this never takes index.lock while Claude commits; never wait on a prompt.
      env: { ...process.env, GIT_OPTIONAL_LOCKS: '0', GIT_TERMINAL_PROMPT: '0' },
      timeout,
      maxBuffer: 16 * 1024 * 1024,
      windowsHide: true,
    })
    return { path, ...countStatus(stdout) }
  } catch {
    return null // not a repo, no git, or too slow
  }
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
