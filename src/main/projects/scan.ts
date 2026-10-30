import type { Dirent } from 'node:fs'
import { readdir, stat } from 'node:fs/promises'
import { basename, join } from 'node:path'
import type { ProjectItem, ProjectsConfig } from '@shared/types'
import { pathKey, resolvePath } from './config'
import { readBranch } from './git-head'

/** Folder names never listed or walked into: dependencies and build output. */
export const SKIP: ReadonlySet<string> = new Set([
  'node_modules', 'build', 'Pods', 'DerivedData', '.gradle', 'venv', '.venv', 'dist', 'target', 'out',
])

const isDir = (p: string) => stat(p).then((s) => s.isDirectory(), () => false)
const exists = (p: string) => stat(p).then(() => true, () => false)
const mtime = (p: string) => stat(p).then((s) => s.mtimeMs, () => 0)

/** Case-insensitive, like the prototype's sort on `name.lower()`. */
function byName(a: Dirent, b: Dirent): number {
  const x = a.name.toLowerCase()
  const y = b.name.toLowerCase()
  return x < y ? -1 : x > y ? 1 : 0
}

/**
 * Folders to list under `dir`, in walk order: every folder at level 1, deeper only git repos.
 * Repos aren't walked into; unreadable folders are skipped.
 */
async function walk(dir: string, level: number, depth: number): Promise<string[]> {
  const entries = await readdir(dir, { withFileTypes: true }).catch((): Dirent[] => [])
  entries.sort(byName)
  const found = await Promise.all(
    entries.map(async (e) => {
      if (e.name.startsWith('.') || SKIP.has(e.name)) return []
      const path = join(dir, e.name)
      // A symlink to a folder counts as a folder, as with Python's DirEntry.is_dir().
      if (!e.isDirectory() && !(e.isSymbolicLink() && (await isDir(path)))) return []
      const repo = await exists(join(path, '.git'))
      const below = !repo && level < depth ? await walk(path, level + 1, depth) : []
      return level === 1 || repo ? [path, ...below] : below
    }),
  )
  return found.flat()
}

/** Newest mtime (ms) of the folder and of the git files that change on commit, checkout and fetch. */
async function activityTime(path: string): Promise<number> {
  const git = join(path, '.git')
  const times = await Promise.all([join(git, 'index'), join(git, 'HEAD'), join(git, 'FETCH_HEAD'), path].map(mtime))
  return Math.max(0, ...times)
}

async function item(path: string, pinned: boolean): Promise<ProjectItem> {
  const [branch, activity] = await Promise.all([readBranch(path), activityTime(path)])
  return { path, name: basename(path) || path, branch, pinned, activity }
}

/** Pinned folders in config order, then the folders found under the scan roots, newest activity first. */
export async function scanProjects(config: ProjectsConfig, home: string): Promise<ProjectItem[]> {
  const pinned = config.pinned.map((p) => resolvePath(p, home))
  const depth = Math.max(1, config.depth)
  const [pinnedDirs, walked] = await Promise.all([
    Promise.all(pinned.map(isDir)),
    Promise.all(config.scan.map((root) => walk(resolvePath(root, home), 1, depth))),
  ])
  // The first mention wins, so a pinned folder isn't listed again under its scan root.
  const seen = new Set<string>()
  const unseen = (p: string) => {
    const key = pathKey(p)
    if (seen.has(key)) return false
    seen.add(key)
    return true
  }
  const pins = pinned.filter((p, i) => pinnedDirs[i] && unseen(p))
  const rest = walked.flat().filter(unseen)
  const [pinItems, restItems] = await Promise.all([
    Promise.all(pins.map((p) => item(p, true))),
    Promise.all(rest.map((p) => item(p, false))),
  ])
  return [...pinItems, ...restItems.sort((a, b) => b.activity - a.activity)]
}
