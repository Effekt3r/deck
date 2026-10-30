import type { GitSnapshot } from '@shared/types'
import { LOG_PAGE, readLog, readToMerge } from './log'
import { tryGit } from './runner'
import { readSummary } from './summary'

/** Where Deck's merge-target overrides come from (TargetsStore). */
export interface TargetOverrides {
  get(repoRoot: string, branch: string): Promise<string | null>
}

/** Everything the panel shows for the repo at `root`; the log is read alongside the header. */
export async function readSnapshot(root: string, targets: TargetOverrides, pageSize = LOG_PAGE): Promise<GitSnapshot> {
  const header = async () => {
    // The override is per branch, so the branch is needed before readSummary.
    const branch = (await tryGit(root, ['symbolic-ref', '--short', '-q', 'HEAD']))?.trim()
    const override = branch ? await targets.get(root, branch).catch(() => null) : null
    const summary = await readSummary(root, override)
    const toMerge = summary.target?.ahead ? await readToMerge(root, summary.target.ref) : []
    return { summary, toMerge }
  }
  // One commit more than a page tells whether there is more.
  const [page, { summary, toMerge }] = await Promise.all([readLog(root, 0, pageSize + 1), header()])
  return { summary, commits: page.slice(0, pageSize), hasMore: page.length > pageSize, toMerge }
}
