import { readdir, realpath, stat } from 'node:fs/promises'
import { basename, dirname, join } from 'node:path'
import { gitDirs } from '../git/summary'

/** The tab's project: its repository's main work tree, so a worktree belongs to its project; outside
 *  git, the folder itself; as the file system spells it. */
export async function projectRoot(folder: string): Promise<string> {
  const dirs = await gitDirs(folder)
  // The common dir is canonical already: `<main checkout>/.git` unless the repository is bare.
  if (dirs && basename(dirs.commonDir) === '.git') return dirname(dirs.commonDir)
  const own = dirs ? dirs.root : folder
  return realpath(own).catch(() => own)
}

/** Build output and dependencies hold no app of the project's own. */
const SKIP = new Set(['build', 'node_modules', 'Pods', 'DerivedData'])

async function subfolders(dir: string): Promise<string[]> {
  const entries = await readdir(dir, { withFileTypes: true }).catch(() => [])
  return entries.filter((e) => e.isDirectory() && !e.name.startsWith('.') && !SKIP.has(e.name)).map((e) => join(dir, e.name))
}

const hasManifest = (module: string) =>
  stat(join(module, 'src', 'main', 'AndroidManifest.xml')).then((s) => s.isFile(), () => false)

/** An Android app has an AndroidManifest.xml in `src/main/` of a folder one level down
 *  (`app/src/main/`), or two levels down in `android/` (Flutter, React Native). */
export async function isAndroidApp(root: string): Promise<boolean> {
  const first = await subfolders(root)
  if ((await Promise.all(first.map(hasManifest))).some(Boolean)) return true
  const android = first.filter((dir) => basename(dir) === 'android')
  const second = (await Promise.all(android.map(subfolders))).flat()
  return (await Promise.all(second.map(hasManifest))).some(Boolean)
}

export async function describeProject(folder: string): Promise<{ root: string; android: boolean }> {
  const root = await projectRoot(folder)
  return { root, android: await isAndroidApp(root) }
}
