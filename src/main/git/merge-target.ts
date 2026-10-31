// Port of merge_target() / resolve() in git_graph_pane.py.
import { gitOk, tryGit } from './runner'

const TRUNK_ORDER = ['dev', 'develop', 'development', 'main', 'master']
const RELEASE_ORDER = ['main', 'master']
const DEV_BRANCHES = new Set(['dev', 'develop', 'development'])
const RELEASE_BRANCHES = new Set(['main', 'master'])

/** The commit `ref` names, or null. A name starting with '-' is never handed to git (it'd be an option). */
async function commitOf(repo: string, ref: string): Promise<string | null> {
  if (!ref || ref.startsWith('-')) return null
  const out = await tryGit(repo, ['rev-parse', '--verify', '-q', `${ref}^{commit}`])
  return out?.trim() || null
}

/** Commits in `range` (e.g. `dev..HEAD`), or null when git can't count them. */
async function count(repo: string, range: string): Promise<number | null> {
  const out = (await tryGit(repo, ['rev-list', '--count', range]))?.trim()
  return out && /^\d+$/.test(out) ? Number(out) : null
}

/**
 * `name` as the local branch, unless that is missing or only a stale copy of origin/<name>
 * (an ancestor of it), then origin/<name>: PRs merge on the remote, so that's where commits land.
 */
export async function resolveRef(repo: string, name: string): Promise<string | null> {
  const remote = `origin/${name}`
  const [localSha, remoteSha] = await Promise.all([commitOf(repo, name), commitOf(repo, remote)])
  if (localSha && remoteSha && localSha !== remoteSha
    && (await gitOk(repo, ['merge-base', '--is-ancestor', localSha, remoteSha]))) return remote
  return localSha ? name : remoteSha ? remote : null
}

/** What can be picked as a merge target: local branches, then origin/…, then other remotes' branches. */
export async function targetChoices(repo: string): Promise<string[]> {
  const out = await tryGit(repo, ['for-each-ref', '--format=%(refname)', 'refs/heads', 'refs/remotes'])
  const local: string[] = []
  const origin: string[] = []
  const other: string[] = []
  for (const ref of out?.split('\n') ?? []) {
    if (ref.startsWith('refs/heads/')) local.push(ref.slice('refs/heads/'.length))
    else if (ref.startsWith('refs/remotes/') && !ref.endsWith('/HEAD')) {
      const name = ref.slice('refs/remotes/'.length)
      ;(name.startsWith('origin/') ? origin : other).push(name)
    }
  }
  return [...local, ...origin, ...other]
}

/**
 * Where `branch` merges next. Order: Deck's override if it resolves, then
 * `git config branch.<b>.mergeTarget` if it resolves, then the rules: main/master → none,
 * dev/develop/development → main/master, anything else → whichever of dev, develop, development,
 * main, master HEAD is fewest commits ahead of (ties go to the earlier name).
 */
export async function mergeTarget(
  repo: string,
  branch: string | null,
  override?: string | null,
): Promise<{ ref: string; source: 'deck' | 'git-config' | 'auto' } | null> {
  if (!branch) return null
  const [deckOk, configured] = await Promise.all([
    override ? commitOf(repo, override) : null,
    tryGit(repo, ['config', '--get', `branch.${branch}.mergeTarget`]).then((out) => out?.trim() || null),
  ])
  if (override && deckOk) return { ref: override, source: 'deck' }
  if (configured && (await commitOf(repo, configured))) return { ref: configured, source: 'git-config' }
  if (RELEASE_BRANCHES.has(branch)) return null

  const order = DEV_BRANCHES.has(branch) ? RELEASE_ORDER : TRUNK_ORDER
  const candidates = await Promise.all(
    order.map(async (name) => {
      if (name === branch) return null
      const ref = await resolveRef(repo, name)
      const ahead = ref ? await count(repo, `${ref}..HEAD`) : null
      return ref && ahead !== null ? { ref, ahead } : null
    }),
  )
  let best: { ref: string; ahead: number } | null = null
  for (const c of candidates) if (c && (!best || c.ahead < best.ahead)) best = c // in order: ties keep the earlier
  return best ? { ref: best.ref, source: 'auto' } : null
}
