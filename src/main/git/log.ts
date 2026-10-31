import type { GitCommit, GitRef } from '@shared/types'
import { git, tryGit } from './runner'

export const LOG_PAGE = 1000

const SEP = '\x1f'
const FORMAT = `${['%H', '%P', '%D', '%s', '%ct', '%an'].join('%x1f')}%x1e`
const RANK: Record<GitRef['kind'], number> = { head: 0, branch: 1, remote: 2, tag: 3 }

function fullRef(name: string): GitRef | null {
  if (name.startsWith('tag: refs/tags/')) return { name: name.slice('tag: refs/tags/'.length), kind: 'tag' }
  if (name.startsWith('refs/heads/')) return { name: name.slice('refs/heads/'.length), kind: 'branch' }
  if (name.startsWith('refs/remotes/') && !name.endsWith('/HEAD')) {
    return { name: name.slice('refs/remotes/'.length), kind: 'remote' }
  }
  return null // <remote>/HEAD, refs/stash, notes, pull requests, …
}

/**
 * `%D` of `git log --decorate=full` → refs, the checked-out branch (or a detached HEAD) first, then
 * local branches, remotes, tags. Full names tell a local branch called `origin/x` from a remote one.
 */
export function parseRefs(decoration: string): GitRef[] {
  const refs: GitRef[] = []
  for (const item of decoration.split(', ')) {
    const [name, target] = item.split(' -> ')
    if (name === 'HEAD') {
      if (target === undefined) refs.push({ name: 'HEAD', kind: 'head' })
      else if (target.startsWith('refs/heads/')) refs.push({ name: target.slice('refs/heads/'.length), kind: 'branch', current: true })
      continue
    }
    const ref = fullRef(name)
    if (ref) refs.push(ref)
  }
  return refs.sort((a, b) => (a.current ? 0 : RANK[a.kind]) - (b.current ? 0 : RANK[b.kind]))
}

function parseLog(out: string): GitCommit[] {
  const commits: GitCommit[] = []
  for (const record of out.split('\x1e')) {
    const fields = record.trimStart().split(SEP)
    if (fields.length < 6) continue
    const [hash, parents, decoration] = fields
    commits.push({
      hash,
      parents: parents ? parents.split(' ') : [],
      refs: parseRefs(decoration),
      subject: fields.slice(3, -2).join(SEP), // a subject can't hold the separator, but just in case
      time: Number(fields[fields.length - 2]) * 1000,
      author: fields[fields.length - 1],
    })
  }
  return commits
}

/** One page of `git log --all --date-order` without the stash; [] in a repo without commits. */
export async function readLog(repo: string, skip: number, limit: number): Promise<GitCommit[]> {
  const out = await git(repo, [
    // --exclude applies to the --all after it. log.showSignature would mix gpg output into the records.
    // Excludes apply to the --all after them. notes, prefetch (git maintenance) and original
    // (filter-branch) refs aren't branches; their commits would show as lanes without a name.
    'log', '--exclude=refs/stash', '--exclude=refs/notes/*', '--exclude=refs/prefetch/*', '--exclude=refs/original/*', '--all', '--date-order', '--decorate=full', '--no-show-signature',
    `--skip=${skip}`, `--max-count=${limit}`, `--format=${FORMAT}`, '--',
  ])
  return parseLog(out)
}

/** Commits in `target..HEAD`, newest first, at most 2000. */
export async function readToMerge(repo: string, target: string): Promise<string[]> {
  if (!target || target.startsWith('-')) return []
  const out = await tryGit(repo, ['rev-list', '--max-count=2000', `${target}..HEAD`])
  return out ? out.split('\n').filter(Boolean) : []
}
