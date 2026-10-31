import { afterAll, describe, expect, it } from 'vitest'
import { mergeTarget, resolveRef, targetChoices } from './merge-target'
import { branch, checkout, commit, makeDir, makeRepo, removeRepos, run, setRef } from './test-repo'

afterAll(removeRepos)

/** main: c1 · dev: c1 d1 · feature (checked out): c1 d1 f1 f2 */
function trunk() {
  const repo = makeRepo()
  const c1 = commit(repo, 'c1')
  branch(repo, 'dev')
  checkout(repo, 'dev')
  const d1 = commit(repo, 'd1')
  branch(repo, 'feature')
  checkout(repo, 'feature')
  commit(repo, 'f1')
  commit(repo, 'f2')
  return { repo, c1, d1 }
}

describe('mergeTarget', () => {
  it('feature → dev, dev → main, main → none', async () => {
    const { repo } = trunk()
    expect(await mergeTarget(repo, 'feature')).toEqual({ ref: 'dev', source: 'auto' })
    checkout(repo, 'dev')
    expect(await mergeTarget(repo, 'dev')).toEqual({ ref: 'main', source: 'auto' })
    checkout(repo, 'main')
    expect(await mergeTarget(repo, 'main')).toBeNull()
    expect(await mergeTarget(repo, null)).toBeNull()
  })

  it('picks the trunk the branch is fewest commits ahead of; ties go to dev', async () => {
    const { repo } = trunk()
    checkout(repo, 'main')
    commit(repo, 'm1')
    branch(repo, 'hotfix')
    checkout(repo, 'hotfix')
    commit(repo, 'h1') // 1 ahead of main, 2 ahead of dev
    expect(await mergeTarget(repo, 'hotfix')).toEqual({ ref: 'main', source: 'auto' })

    const tie = makeRepo()
    commit(tie, 'c1')
    branch(tie, 'dev') // dev and main on the same commit
    branch(tie, 'topic')
    checkout(tie, 'topic')
    commit(tie, 't1')
    expect(await mergeTarget(tie, 'topic')).toEqual({ ref: 'dev', source: 'auto' })
  })

  it('uses origin/<name> when the local branch is missing', async () => {
    const repo = makeRepo()
    commit(repo, 'c1')
    const d1 = commit(repo, 'd1')
    setRef(repo, 'refs/remotes/origin/dev', d1)
    run(repo, 'reset', '-q', '--hard', 'HEAD~1')
    branch(repo, 'feature', d1)
    checkout(repo, 'feature')
    commit(repo, 'f1')
    expect(await mergeTarget(repo, 'feature')).toEqual({ ref: 'origin/dev', source: 'auto' })
  })

  it('uses origin/main when local main is only a stale ancestor of it', async () => {
    const { repo, c1, d1 } = trunk()
    // origin/main has the merged PR (c1 → d1); local main still sits on c1.
    setRef(repo, 'refs/remotes/origin/main', d1)
    checkout(repo, 'dev')
    commit(repo, 'd2')
    expect(run(repo, 'rev-parse', 'main')).toBe(c1)
    expect(await resolveRef(repo, 'main')).toBe('origin/main')
    expect(await mergeTarget(repo, 'dev')).toEqual({ ref: 'origin/main', source: 'auto' })
  })

  it('keeps the local branch when it is level with or ahead of origin', async () => {
    const { repo, c1 } = trunk()
    setRef(repo, 'refs/remotes/origin/main', c1)
    expect(await resolveRef(repo, 'main')).toBe('main') // same commit
    checkout(repo, 'main')
    commit(repo, 'unpushed')
    expect(await resolveRef(repo, 'main')).toBe('main') // local is ahead
    expect(await resolveRef(repo, 'dev')).toBe('dev')
    expect(await resolveRef(repo, 'nope')).toBeNull()
  })

  it('honours git config branch.<b>.mergeTarget, and a Deck override wins', async () => {
    const { repo } = trunk()
    run(repo, 'config', 'branch.feature.mergeTarget', 'main')
    expect(await mergeTarget(repo, 'feature')).toEqual({ ref: 'main', source: 'git-config' })
    expect(await mergeTarget(repo, 'feature', 'dev')).toEqual({ ref: 'dev', source: 'deck' })
    // The overrides apply even on main, where the rules have nothing.
    expect(await mergeTarget(repo, 'main', 'dev')).toEqual({ ref: 'dev', source: 'deck' })
  })

  it('ignores an override that does not resolve', async () => {
    const { repo } = trunk()
    run(repo, 'config', 'branch.feature.mergeTarget', 'gone')
    expect(await mergeTarget(repo, 'feature', 'also-gone')).toEqual({ ref: 'dev', source: 'auto' })
    run(repo, 'config', 'branch.feature.mergeTarget', 'main')
    expect(await mergeTarget(repo, 'feature', 'also-gone')).toEqual({ ref: 'main', source: 'git-config' })
    // Never passed to git as an option.
    expect(await mergeTarget(repo, 'feature', '--output=x')).toEqual({ ref: 'main', source: 'git-config' })
  })
})

describe('targetChoices', () => {
  it('lists local branches, then origin/…, then other remotes, without */HEAD', async () => {
    const { repo, c1 } = trunk()
    setRef(repo, 'refs/remotes/upstream/main', c1)
    setRef(repo, 'refs/remotes/origin/main', c1)
    setRef(repo, 'refs/remotes/origin/dev', c1)
    run(repo, 'symbolic-ref', 'refs/remotes/origin/HEAD', 'refs/remotes/origin/main')
    run(repo, 'tag', 'v1')
    expect(await targetChoices(repo)).toEqual(['dev', 'feature', 'main', 'origin/dev', 'origin/main', 'upstream/main'])
  })
  it('is empty outside a repo or before the first commit', async () => {
    expect(await targetChoices(makeRepo())).toEqual([])
    expect(await targetChoices(makeDir())).toEqual([])
  })
})
