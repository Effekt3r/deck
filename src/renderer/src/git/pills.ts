import type { GitRef } from '@shared/types'

export type PillKind = 'current' | 'head' | 'branch' | 'remote' | 'tag'

export interface Pill {
  kind: PillKind
  name: string
  title: string
  /** Remote branches at the same commit, folded into this local branch's pill. */
  remotes?: string[]
}

const ORDER: Record<PillKind, number> = { current: 0, head: 0, branch: 1, remote: 2, tag: 3 }

/** A commit's refs as pills: the checked-out branch (or detached HEAD) first,
 *  then branches, remotes, tags. A remote branch at the same commit as the
 *  local branch of that name (origin/main next to main) shares its pill, which
 *  keeps rows readable in a narrow panel. */
export function refPills(refs: GitRef[]): Pill[] {
  const locals = new Set(refs.filter((r) => r.kind === 'branch').map((r) => r.name))
  const folded = new Map<string, string[]>()
  const foldedNames = new Set<string>()
  for (const r of refs) {
    if (r.kind !== 'remote') continue
    const slash = r.name.indexOf('/')
    const local = r.name.slice(slash + 1)
    if (slash > 0 && locals.has(local)) {
      folded.set(local, [...(folded.get(local) ?? []), r.name])
      foldedNames.add(r.name)
    }
  }
  const pills: Pill[] = []
  for (const r of refs) {
    if (r.kind === 'remote' && foldedNames.has(r.name)) continue
    const kind: PillKind = r.kind === 'branch' && r.current ? 'current' : r.kind
    const remotes = r.kind === 'branch' ? folded.get(r.name) : undefined
    const title = kind === 'head' ? 'HEAD (detached)'
      : kind === 'tag' ? `Tag ${r.name}`
      : `${r.name}${kind === 'current' ? ' (checked out)' : ''}${remotes ? `, same as ${remotes.join(', ')}` : ''}`
    pills.push(remotes ? { kind, name: r.name, title, remotes } : { kind, name: r.name, title })
  }
  return pills.sort((a, b) => ORDER[a.kind] - ORDER[b.kind])
}
