import { readdir, realpath, stat } from 'node:fs/promises'
import { basename, dirname, join, resolve } from 'node:path'
import { gitDirs } from '../git/summary'
import { pathKey } from '../projects/config'

/** `folder`'s project root, and whether a repository was found there: a plain folder (the home
 *  folder, a volume holding many projects) never gets scanned for an app. */
async function findRoot(folder: string): Promise<{ root: string; git: boolean }> {
  // Resolved first: git's own `--git-common-dir` can come back relative, and joining that onto a
  // symlink or junction Deck was given, rather than the real folder it points at, lands beside the
  // repository instead of inside it.
  const real = await realpath(folder).catch(() => folder)
  const dirs = await gitDirs(real)
  // The common dir is canonical already: `<main checkout>/.git` unless the repository is bare.
  if (dirs && basename(dirs.commonDir) === '.git') return { root: dirname(dirs.commonDir), git: true }
  const own = dirs ? dirs.root : real
  return { root: await realpath(own).catch(() => own), git: Boolean(dirs) }
}

/** The tab's project: its repository's main work tree, so a worktree belongs to its project; outside
 *  git, the folder itself; as the file system spells it. */
export async function projectRoot(folder: string): Promise<string> {
  return (await findRoot(folder)).root
}

/** Build output and dependencies hold no app of the project's own. */
const SKIP = new Set(['build', 'node_modules', 'Pods', 'DerivedData'])

/** A scan runs when a tab comes to the front: look at no more than this many folders per level. */
const MAX_FOLDERS = 200

async function subfolders(dir: string): Promise<string[]> {
  const entries = await readdir(dir, { withFileTypes: true }).catch(() => [])
  return entries
    .filter((e) => e.isDirectory() && !e.name.startsWith('.') && !SKIP.has(e.name))
    .slice(0, MAX_FOLDERS)
    .map((e) => join(dir, e.name))
}

const isFile = (file: string) => stat(file).then((s) => s.isFile(), () => false)

/** `src/main/`, or Kotlin Multiplatform's `src/androidMain/`. */
const hasManifest = async (module: string): Promise<boolean> =>
  (await Promise.all(['main', 'androidMain'].map((src) => isFile(join(module, 'src', src, 'AndroidManifest.xml'))))).some(Boolean)

/** A folder that builds itself with Gradle: its modules are worth a look even when the folder
 *  itself isn't called `android`. */
const isGradleBuild = async (dir: string): Promise<boolean> =>
  (await Promise.all(['settings.gradle', 'settings.gradle.kts'].map((f) => isFile(join(dir, f))))).some(Boolean)

/** An Android app has an AndroidManifest.xml in `src/main/` or `src/androidMain/` of a module one
 *  level down (`app/src/main/`, `composeApp/src/androidMain/`), or two levels down inside a
 *  first-level folder named `android` in any case (Flutter, React Native), or one that is a Gradle
 *  build of its own (`settings.gradle`/`.kts`: an SDK's `android-demo/`, another's
 *  `sdk/`). */
export async function isAndroidApp(root: string): Promise<boolean> {
  const first = await subfolders(root)
  if ((await Promise.all(first.map(hasManifest))).some(Boolean)) return true
  const look = await Promise.all(
    first.map(async (dir) => basename(dir).toLowerCase() === 'android' || (await isGradleBuild(dir))),
  )
  const second = (await Promise.all(first.filter((_, i) => look[i]).map(subfolders))).flat()
  return (await Promise.all(second.map(hasManifest))).some(Boolean)
}

/** `android` is false without scanning when `folder` isn't inside a git repository (a plain
 *  folder: the home folder, a volume holding many projects) or when the project is the home folder
 *  itself (some people keep `~` as a dotfiles repo): scanning would stat into `~/Desktop`,
 *  `~/Documents` and `~/Downloads`, which can raise a macOS privacy prompt for Deck. */
export async function describeProject(folder: string, home: string): Promise<{ root: string; android: boolean }> {
  const { root, git } = await findRoot(folder)
  if (!git || pathKey(resolve(root)) === pathKey(resolve(home))) return { root, android: false }
  return { root, android: await isAndroidApp(root) }
}
