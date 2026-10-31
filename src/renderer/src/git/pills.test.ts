import { describe, expect, it } from 'vitest'
import type { GitRef } from '@shared/types'
import { refPills } from './pills'

const names = (refs: GitRef[]) => refPills(refs).map((p) => `${p.kind}:${p.name}${p.remotes ? `+${p.remotes.join('+')}` : ''}`)

describe('refPills', () => {
  it('puts the checked-out branch first, then branches, remotes, tags', () => {
    expect(names([
      { name: 'v1.0', kind: 'tag' },
      { name: 'upstream/dev', kind: 'remote' },
      { name: 'feature', kind: 'branch' },
      { name: 'main', kind: 'branch', current: true },
    ])).toEqual(['current:main', 'branch:feature', 'remote:upstream/dev', 'tag:v1.0'])
  })
  it('folds remote branches into the local branch of the same name', () => {
    expect(names([
      { name: 'feature/x', kind: 'branch', current: true },
      { name: 'origin/feature/x', kind: 'remote' },
      { name: 'upstream/feature/x', kind: 'remote' },
      { name: 'origin/other', kind: 'remote' },
    ])).toEqual(['current:feature/x+origin/feature/x+upstream/feature/x', 'remote:origin/other'])
  })
  it('keeps a remote branch whose local branch is elsewhere', () => {
    expect(names([{ name: 'origin/main', kind: 'remote' }])).toEqual(['remote:origin/main'])
  })
  it('shows a detached HEAD first', () => {
    const pills = refPills([{ name: 'v2', kind: 'tag' }, { name: 'HEAD', kind: 'head' }])
    expect(pills.map((p) => p.kind)).toEqual(['head', 'tag'])
    expect(pills[0].title).toBe('HEAD (detached)')
  })
})
