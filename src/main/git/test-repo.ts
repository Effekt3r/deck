// Test helper: throwaway repos built with the git CLI. Not used by the app.
import { execFileSync } from 'node:child_process'
import { appendFileSync, mkdirSync, mkdtempSync, realpathSync, rmSync, writeFileSync } from 'node:fs'
import { tmpdir } from 'node:os'
import { dirname, join } from 'node:path'
import { gitEnv } from './runner'

const made: string[] = []
// Commits get increasing, fixed timestamps so `--date-order` and times are predictable.
let clock = 1_700_000_000

/** Seconds since epoch of the next commit made by these helpers. */
export const nextTime = () => clock + 60

function exec(repo: string, args: string[], env: NodeJS.ProcessEnv): string {
  return execFileSync('git', ['-C', repo, ...args], {
    env, encoding: 'utf8', windowsHide: true, stdio: ['ignore', 'pipe', 'pipe'],
  }).trim()
}

/** Runs git in `repo`; trimmed stdout. Throws when git fails. */
export function run(repo: string, ...args: string[]): string {
  return exec(repo, args, gitEnv())
}

/** Like run(), for commands that create commits: the next timestamp of the clock. */
export function runDated(repo: string, ...args: string[]): string {
  clock += 60
  const date = `${clock} +0000`
  return exec(repo, args, { ...gitEnv(), GIT_AUTHOR_DATE: date, GIT_COMMITTER_DATE: date })
}

/** An empty folder (real path, as git reports it) that removeRepos() deletes. */
export function makeDir(prefix = 'deck-git-'): string {
  const dir = realpathSync.native(mkdtempSync(join(tmpdir(), prefix)))
  made.push(dir)
  return dir
}

/** `git init -b main` with a local identity; global signing, hooks or autocrlf must not get in the way. */
export function makeRepo(): string {
  const dir = makeDir()
  run(dir, 'init', '-q', '-b', 'main')
  // Appended to .git/config directly: one `git config` per key would be six more processes per repo.
  const hooks = join(dir, '.git', 'no-hooks').replace(/\\/g, '/')
  appendFileSync(join(dir, '.git', 'config'), [
    '[user]', '\tname = Test User', '\temail = test@example.com',
    '[commit]', '\tgpgsign = false', '[tag]', '\tgpgsign = false',
    '[core]', '\tautocrlf = false', `\thooksPath = ${hooks}`, '',
  ].join('\n'))
  return dir
}

/** Writes `files` (null deletes one), stages everything and commits. Returns the new commit's hash. */
export function commit(repo: string, message: string, files: Record<string, string | Buffer | null> = {}): string {
  write(repo, files)
  if (Object.keys(files).length) run(repo, 'add', '-A')
  runDated(repo, 'commit', '-q', '--allow-empty', '-m', message)
  return run(repo, 'rev-parse', 'HEAD')
}

/** Writes files into the work tree without staging them (null deletes one). */
export function write(repo: string, files: Record<string, string | Buffer | null>): void {
  for (const [rel, content] of Object.entries(files)) {
    const path = join(repo, rel)
    if (content === null) rmSync(path, { force: true })
    else {
      mkdirSync(dirname(path), { recursive: true })
      writeFileSync(path, content)
    }
  }
}

export const branch = (repo: string, name: string, at = 'HEAD') => void run(repo, 'branch', name, at)
export const checkout = (repo: string, ref: string) => void run(repo, 'checkout', '-q', ref)
export const head = (repo: string) => run(repo, 'rev-parse', 'HEAD')
export const short = (repo: string, ref = 'HEAD') => run(repo, 'rev-parse', '--short', ref)

/** `git merge --no-ff`; returns the merge commit. */
export function merge(repo: string, name: string, message = `Merge ${name}`): string {
  runDated(repo, 'merge', '-q', '--no-ff', '-m', message, name)
  return head(repo)
}

/** Points `ref` at `sha`, e.g. refs/remotes/origin/main to fake a fetched remote without a network. */
export const setRef = (repo: string, ref: string, sha: string) => void run(repo, 'update-ref', ref, sha)

/** A remote that is configured but never contacted (its URL is a folder that doesn't exist). */
export const addRemote = (repo: string, name = 'origin') =>
  void run(repo, 'remote', 'add', name, join(repo, '.git', `no-remote-${name}`))

export function tag(repo: string, name: string, message?: string): void {
  if (message) run(repo, 'tag', '-a', '-m', message, name)
  else run(repo, 'tag', name)
}

/** Deletes every folder the helpers made. */
export function removeRepos(): void {
  for (const dir of made.splice(0)) {
    try {
      rmSync(dir, { recursive: true, force: true, maxRetries: 3 })
    } catch {
      // A watcher still closing on Windows can hold a handle; the OS cleans tmp eventually.
    }
  }
}
