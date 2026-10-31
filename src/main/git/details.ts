import type { GitCommitDetails, GitFileChange } from '@shared/types'
import { tryGit } from './runner'

const SEP = '\x1f'
// Only (abbreviated) hashes: this also keeps anything option-like, such as --output=…, away from git.
const HASH = /^[0-9a-f]{4,64}$/i

type Counts = Pick<GitFileChange, 'additions' | 'deletions'>

/** `--numstat -z` → counts by path (the new path for a rename); '-' (binary) → null. */
function parseNumstat(out: string): Map<string, Counts> {
  const counts = new Map<string, Counts>()
  const tokens = out.split('\0')
  for (let i = 0; i < tokens.length; ) {
    const record = tokens[i++]
    if (!record) continue
    const tab1 = record.indexOf('\t')
    const tab2 = record.indexOf('\t', tab1 + 1)
    const [add, del] = [record.slice(0, tab1), record.slice(tab1 + 1, tab2)]
    let path = record.slice(tab2 + 1)
    if (!path) { // a rename: old and new path follow as tokens of their own
      i++
      path = tokens[i++] ?? ''
    }
    counts.set(path, { additions: add === '-' ? null : Number(add), deletions: del === '-' ? null : Number(del) })
  }
  return counts
}

/** `--name-status -z` joined with the numstat counts. */
function parseFiles(nameStatus: string, numstat: string): GitFileChange[] {
  const counts = parseNumstat(numstat)
  const files: GitFileChange[] = []
  const tokens = nameStatus.split('\0')
  for (let i = 0; i < tokens.length; ) {
    const status = tokens[i++]?.[0] // R100 → R
    if (!status) continue
    const oldPath = status === 'R' || status === 'C' ? tokens[i++] : undefined
    const path = tokens[i++] ?? ''
    const { additions, deletions } = counts.get(path) ?? { additions: null, deletions: null }
    files.push(oldPath === undefined ? { status, path, additions, deletions } : { status, path, oldPath, additions, deletions })
  }
  return files
}

/** One commit's message and files, against its first parent (a root commit against the empty tree). */
export async function readDetails(repo: string, hash: string): Promise<GitCommitDetails | null> {
  if (!HASH.test(hash)) return null
  const out = await tryGit(repo, [
    'show', '-s', '--no-show-signature', '--format=%H%x1f%P%x1f%an%x1f%ae%x1f%ct%x1f%B', `${hash}^{commit}`,
  ])
  const [full, parentList, author, email, ct, ...message] = out?.split(SEP) ?? []
  if (!full || !message.length) return null
  const parents = parentList ? parentList.split(' ') : []
  const trees = parents.length ? [parents[0], full] : ['--root', full]
  const diff = (format: string) => tryGit(repo, ['diff-tree', '-r', '-M', '--no-commit-id', format, '-z', ...trees])
  const [nameStatus, numstat] = await Promise.all([diff('--name-status'), diff('--numstat')])
  return {
    hash: full, parents, author, email, time: Number(ct) * 1000,
    message: message.join(SEP).trimEnd(),
    files: parseFiles(nameStatus ?? '', numstat ?? ''),
    // --numstat needs the blobs; a partial clone may not have them (and must not fetch them).
    ...(nameStatus !== null && numstat === null ? { countsUnavailable: true } : {}),
  }
}
