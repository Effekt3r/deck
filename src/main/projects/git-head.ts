import { readFile, stat } from 'node:fs/promises'
import { join, resolve } from 'node:path'

const HEADS = 'ref: refs/heads/'

/**
 * The branch checked out in `dir`, read from `.git/HEAD` without running git.
 * Detached HEAD → short sha; a `.git` pointer file that can't be followed → '?'; no `.git` → null.
 */
export async function readBranch(dir: string): Promise<string | null> {
  const dotGit = join(dir, '.git')
  const info = await stat(dotGit).catch(() => null)
  if (!info) return null
  let gitDir = dotGit
  if (info.isFile()) {
    // Worktrees and submodules: `.git` is a file holding `gitdir: <path>`, absolute or relative.
    const target = /^gitdir:(.*)$/m.exec(await readFile(dotGit, 'utf8').catch(() => ''))?.[1].trim()
    if (!target) return '?'
    gitDir = resolve(dir, target)
  }
  const head = await readFile(join(gitDir, 'HEAD'), 'utf8').catch(() => null)
  if (head === null) return info.isFile() ? '?' : null
  const ref = head.trim()
  return ref.startsWith(HEADS) ? ref.slice(HEADS.length) : ref.slice(0, 7)
}
