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

/** Outside git, only a folder that builds itself with Gradle — directly, or through a first-level
 *  `android` folder (any case) — is worth scanning: a project that was copied or unpacked rather
 *  than cloned (no `.git`) is still found, without statting into every plain folder on disk. */
async function isGradleProject(root: string): Promise<boolean> {
  if (await isGradleBuild(root)) return true
  const android = (await subfolders(root)).filter((dir) => basename(dir).toLowerCase() === 'android')
  return (await Promise.all(android.map(isGradleBuild))).some(Boolean)
}

const anyManifest = async (modules: string[]): Promise<boolean> => (await Promise.all(modules.map(hasManifest))).some(Boolean)

/** An Android app has an AndroidManifest.xml in `src/main/` or `src/androidMain/` of a module one
 *  level down (`app/src/main/`, `composeApp/src/androidMain/`), or two levels down inside a
 *  first-level folder named `android` in any case (Flutter, React Native), or one that is a Gradle
 *  build of its own (`settings.gradle`/`.kts`: an SDK's `android-demo/` or `sdk/`), or three levels
 *  down inside a Gradle build two levels down (a monorepo's `apps/<build>/`, an app's
 *  `mobile/android/`). */
export async function isAndroidApp(root: string): Promise<boolean> {
  const first = await subfolders(root)
  if (await anyManifest(first)) return true
  const look = await Promise.all(
    first.map(async (dir) => basename(dir).toLowerCase() === 'android' || (await isGradleBuild(dir))),
  )
  // Capped again, flattened: otherwise up to MAX_FOLDERS nested builds could each contribute up to
  // MAX_FOLDERS modules, and every one of those would get stat'd for a manifest.
  const second = (await Promise.all(first.filter((_, i) => look[i]).map(subfolders))).flat().slice(0, MAX_FOLDERS)
  if (await anyManifest(second)) return true
  // Only now are the other first-level folders listed, for Gradle builds of their own two levels
  // down: an app found above costs no extra reads. Capped like the second level.
  const plain = (await Promise.all(first.filter((_, i) => !look[i]).map(subfolders))).flat().slice(0, MAX_FOLDERS)
  const nested = [...second, ...plain]
  const builds = await Promise.all(nested.map(isGradleBuild))
  const third = (await Promise.all(nested.filter((_, i) => builds[i]).map(subfolders))).flat().slice(0, MAX_FOLDERS)
  return anyManifest(third)
}

/** An Xcode project or workspace: a folder Xcode opens. */
const isXcode = (name: string) => name.endsWith('.xcodeproj') || name.endsWith('.xcworkspace')

async function hasXcode(dir: string): Promise<boolean> {
  const entries = await readdir(dir, { withFileTypes: true }).catch(() => [])
  return entries.some((e) => e.isDirectory() && isXcode(e.name))
}

/** An iOS app has an Xcode project or workspace at the project's root (`App.xcodeproj`) or in a
 *  first-level folder (`ios/Runner.xcworkspace`: Flutter, React Native). A Mac-only one counts too. */
export async function isIosApp(root: string): Promise<boolean> {
  if (await hasXcode(root)) return true
  return (await Promise.all((await subfolders(root)).map(hasXcode))).some(Boolean)
}

/** `android` is never scanned for the home folder — resolved with `realpath` first, so a `$HOME`
 *  given in another case or through a symlink still matches (some people keep `~` as a dotfiles
 *  repo: scanning would stat into `~/Desktop`, `~/Documents` and `~/Downloads`, which can raise a
 *  macOS privacy prompt for Deck). Inside git the whole project is scanned; outside it (a copied or
 *  unpacked project, no `.git`), only when the folder is itself a Gradle build. Outside git, an
 *  Xcode project counts only in the folder itself. `wantIos` false (ipc.ts, off macOS: simulators
 *  never show there) skips the Xcode scan too, not just its result: always `ios: false`. */
export async function describeProject(folder: string, home: string, wantIos = true): Promise<{ root: string; android: boolean; ios: boolean }> {
  const { root, git } = await findRoot(folder)
  const realHome = await realpath(home).catch(() => resolve(home))
  if (pathKey(resolve(root)) === pathKey(realHome)) return { root, android: false, ios: false }
  if (!git) {
    const [android, ios] = await Promise.all([
      isGradleProject(root).then((gradle) => gradle && isAndroidApp(root)),
      wantIos ? hasXcode(root) : Promise.resolve(false),
    ])
    return { root, android, ios }
  }
  const [android, ios] = await Promise.all([isAndroidApp(root), wantIos ? isIosApp(root) : Promise.resolve(false)])
  return { root, android, ios }
}
