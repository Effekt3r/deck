import { type FSWatcher, watch } from 'node:fs'
import { stat } from 'node:fs/promises'
import { join } from 'node:path'
import { pathKey } from '../projects/config'
import { tryGit } from './runner'

// What moves when HEAD, the index, an operation (merge, rebase, …) or packed refs change. Git
// writes `<file>.lock` and renames it over the file, so the folder is watched, not the file.
const GIT_DIR_FILES = new Set([
  'HEAD', 'index', 'packed-refs', 'MERGE_HEAD', 'CHERRY_PICK_HEAD', 'REVERT_HEAD', 'rebase-merge', 'rebase-apply',
])

/**
 * What a poll compares: `git status` (work-tree edits change the counts without touching the git
 * dir) and the times of the files git rewrites when HEAD, the index or refs move, as a backstop
 * for missed file events. One git process instead of the twenty a full snapshot takes.
 */
export async function repoProbe(dirs: { root: string; gitDir: string; commonDir: string }): Promise<string> {
  const files = [join(dirs.gitDir, 'HEAD'), join(dirs.gitDir, 'index'), join(dirs.gitDir, 'logs', 'HEAD'),
    join(dirs.commonDir, 'packed-refs'), join(dirs.commonDir, 'FETCH_HEAD')]
  const [status, ...times] = await Promise.all([
    tryGit(dirs.root, ['status', '--porcelain=v1']),
    ...files.map((f) => stat(f).then((s) => s.mtimeMs, () => 0)),
  ])
  return `${times.join(',')}\0${status ?? '(git failed)'}`
}

/**
 * Calls onChange (debounced) after HEAD, refs, packed-refs, index or logs/HEAD change in either git dir,
 * and every pollMs: work-tree edits change the status counts without touching the git dir, and file
 * events can be missed (network drives, watcher overflow). With a `probe`, a poll only calls onChange
 * when the probe's result differs from the previous one. Returns a stop function.
 */
export function watchRepo(
  dirs: { gitDir: string; commonDir: string },
  onChange: () => void,
  opts: { debounceMs?: number; pollMs?: number; probe?: () => Promise<string> } = {},
): () => void {
  const { debounceMs = 300, pollMs = 3000, probe } = opts
  let stopped = false
  let timer: NodeJS.Timeout | undefined
  const fire = () => {
    if (!stopped) onChange()
  }
  const changed = () => {
    if (stopped) return
    clearTimeout(timer)
    timer = setTimeout(fire, debounceMs)
    timer.unref()
  }

  const watchers: FSWatcher[] = []
  const add = (dir: string, recursive: boolean, wanted: (name: string) => boolean) => {
    try {
      const w = watch(dir, { recursive, persistent: false }, (_event, name) => {
        if (name === null || wanted(name)) changed()
      })
      w.on('error', () => w.close()) // e.g. the folder was deleted; the poll carries on
      watchers.push(w)
    } catch {
      // Missing folder (logs/ appears with the first commit, reftable/ only in reftable repos)
      // or no recursive watching on this platform: the poll covers it.
    }
  }
  const { gitDir, commonDir } = dirs
  add(gitDir, false, (name) => GIT_DIR_FILES.has(name))
  add(join(gitDir, 'logs'), false, (name) => name === 'HEAD')
  add(join(commonDir, 'refs'), true, (name) => !name.endsWith('.lock'))
  add(join(commonDir, 'reftable'), false, () => true)
  // A worktree's refs and packed-refs live in the main repo's git dir.
  if (pathKey(gitDir) !== pathKey(commonDir)) add(commonDir, false, (name) => name === 'packed-refs')

  // The baseline is taken at start; a failed probe counts as a change.
  let last: Promise<string | null> = probe ? probe().catch(() => null) : Promise.resolve(null)
  let probing = false
  const tick = async () => {
    if (!probe) return fire()
    if (probing) return
    probing = true
    try {
      const [before, now] = await Promise.all([last, probe().catch(() => null)])
      last = Promise.resolve(now)
      if (now === null || now !== before) fire()
    } finally {
      probing = false
    }
  }
  const poll = setInterval(() => void tick(), pollMs)
  poll.unref()
  return () => {
    stopped = true
    clearTimeout(timer)
    clearInterval(poll)
    for (const w of watchers) w.close()
  }
}
