import { realpath, stat } from 'node:fs/promises'
import { join, resolve } from 'node:path'
import type { GitCounts, GitSummary } from '@shared/types'
import { mergeTarget } from './merge-target'
import { GitError, git, tryGit } from './runner'

export interface GitDirs {
  /** Work-tree root as git prints it. */
  root: string
  /** This checkout's git dir: `.git`, or `.git/worktrees/<name>` for a worktree. */
  gitDir: string
  /** The git dir shared by all worktrees (refs, packed-refs, config). */
  commonDir: string
}

/** The path as the file system spells it (case included), or as it is if that fails. */
const canonical = (p: string) => realpath(p).catch(() => p)

/** null: `repo` isn't inside a git work tree. */
export async function gitDirs(repo: string): Promise<GitDirs | null> {
  const out = await tryGit(repo, ['rev-parse', '--show-toplevel', '--absolute-git-dir', '--git-common-dir'])
  const [root, gitDir, commonDir] = out?.split('\n') ?? []
  if (!root || !gitDir || !commonDir) return null
  // The common dir comes relative to the folder git ran in (`../.git` from a sub-folder), so in
  // the caller's spelling, e.g. /Volumes/wyobi for /Volumes/Wyobi; for a worktree it's absolute.
  // Pass a real path: through a symlink or junction the relative dir lands beside the repository.
  const [own, shared] = await Promise.all([canonical(resolve(gitDir)), canonical(resolve(repo, commonDir))])
  return { root, gitDir: own, commonDir: shared }
}

/** Counts from `git status --porcelain=v1`, as `status_counts()` in the prototype: a path staged
 *  and changed again counts in both. */
export function countStatus(porcelain: string): GitCounts {
  const counts: GitCounts = { staged: 0, changed: 0, untracked: 0, conflicts: 0 }
  for (const line of porcelain.split('\n')) {
    if (line.length < 2) continue
    const x = line[0]
    const y = line[1]
    if (x === '?' && y === '?') counts.untracked++
    else if (x === 'U' || y === 'U' || (x === y && (x === 'A' || x === 'D'))) counts.conflicts++
    else {
      if (x !== ' ' && x !== '?') counts.staged++
      if (y !== ' ' && y !== '?') counts.changed++
    }
  }
  return counts
}

// The prototype's order: a rebase that stopped on a cherry-pick is still a rebase.
const OPERATIONS: [file: string, op: NonNullable<GitSummary['operation']>][] = [
  ['MERGE_HEAD', 'merge'], ['rebase-merge', 'rebase'], ['rebase-apply', 'rebase'],
  ['CHERRY_PICK_HEAD', 'cherry-pick'], ['REVERT_HEAD', 'revert'],
]

async function readOperation(gitDir: string): Promise<GitSummary['operation']> {
  const found = await Promise.all(OPERATIONS.map(([file]) => stat(join(gitDir, file)).then(() => true, () => false)))
  return OPERATIONS[found.indexOf(true)]?.[1] ?? null
}

/** `rev-list --left-right --count A...B` → [only in A, only in B]; [0, 0] when git couldn't count. */
async function leftRight(repo: string, range: string): Promise<[number, number]> {
  const [a, b] = ((await tryGit(repo, ['rev-list', '--left-right', '--count', range])) ?? '').trim().split(/\s+/)
  return [Number(a) || 0, Number(b) || 0]
}

async function readUpstream(root: string): Promise<GitSummary['upstream']> {
  const [ref, [ahead, behind]] = await Promise.all([
    tryGit(root, ['rev-parse', '--abbrev-ref', '--symbolic-full-name', '@{u}']).then((out) => out?.trim()),
    leftRight(root, 'HEAD...@{u}'),
  ])
  return ref ? { ref, ahead, behind } : null
}

async function readTarget(root: string, branch: string | null, override?: string | null): Promise<GitSummary['target']> {
  const found = await mergeTarget(root, branch, override)
  if (!found) return null
  const [ahead, behind] = await leftRight(root, `HEAD...${found.ref}`)
  return { ref: found.ref, ahead, behind, source: found.source }
}

/** Header data for `repo` (any folder inside it). Throws GitError when it isn't a repo. */
export async function readSummary(repo: string, override?: string | null): Promise<GitSummary> {
  const dirs = await gitDirs(repo)
  if (!dirs) throw new GitError(`not a git repository: ${repo}`, '', null)
  const { root, gitDir } = dirs
  const current = tryGit(root, ['symbolic-ref', '--short', '-q', 'HEAD']).then((out) => out?.trim() || null)
  const [branch, head, operation, upstream, target, counts] = await Promise.all([
    current,
    tryGit(root, ['rev-parse', '--short', 'HEAD']).then((out) => out?.trim() ?? ''), // no commits yet: ''
    readOperation(gitDir),
    readUpstream(root),
    current.then((b) => readTarget(root, b, override)),
    git(root, ['status', '--porcelain=v1']).then(countStatus),
  ])
  return { root, branch, head, operation, upstream, target, counts }
}
