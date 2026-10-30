import { afterAll, describe, expect, it } from 'vitest'
import { parseRefs, readLog, readToMerge } from './log'
import { addRemote, branch, checkout, commit, makeRepo, merge, removeRepos, run, setRef, tag, write } from './test-repo'

afterAll(removeRepos)

const time = (repo: string, sha: string) => Number(run(repo, 'log', '-1', '--format=%ct', sha)) * 1000

describe('parseRefs', () => {
  it('reads --decorate=full names: current branch first, then branches, remotes, tags', () => {
    expect(parseRefs(
      'HEAD -> refs/heads/main, tag: refs/tags/v1, refs/remotes/origin/main, refs/remotes/origin/HEAD, '
      + 'refs/heads/feature/x, refs/heads/origin/foo, refs/remotes/upstream/dev',
    )).toEqual([
      { name: 'main', kind: 'branch', current: true },
      { name: 'feature/x', kind: 'branch' },
      { name: 'origin/foo', kind: 'branch' }, // a local branch, however it's named
      { name: 'origin/main', kind: 'remote' },
      { name: 'upstream/dev', kind: 'remote' },
      { name: 'v1', kind: 'tag' },
    ])
  })
  it('a detached HEAD is a ref of its own', () => {
    expect(parseRefs('HEAD, refs/heads/main')).toEqual([{ name: 'HEAD', kind: 'head' }, { name: 'main', kind: 'branch' }])
  })
  it('drops */HEAD and refs that are not branches or tags', () => {
    expect(parseRefs('')).toEqual([])
    expect(parseRefs('refs/remotes/origin/HEAD, refs/stash, refs/notes/commits, refs/pull/1/head')).toEqual([])
    expect(parseRefs('refs/remotes/origin/HEAD -> refs/remotes/origin/main')).toEqual([])
  })
})

/** c1 (tag v1) ← c2 (origin/main) ← f1 (feature) ; c2 ← c3 ← M (main, merges feature) */
function history() {
  const repo = makeRepo()
  const c1 = commit(repo, 'c1')
  tag(repo, 'v1', 'release 1')
  const c2 = commit(repo, 'c2')
  branch(repo, 'feature')
  checkout(repo, 'feature')
  const f1 = commit(repo, 'f1: the feature')
  checkout(repo, 'main')
  const c3 = commit(repo, 'c3')
  const m = merge(repo, 'feature')
  addRemote(repo)
  setRef(repo, 'refs/remotes/origin/main', c2)
  return { repo, c1, c2, f1, c3, m }
}

describe('readLog', () => {
  it('all branches newest first, with parents, refs, subject, time and author', async () => {
    const { repo, c1, c2, f1, c3, m } = history()
    const log = await readLog(repo, 0, 100)
    expect(log.map((c) => c.hash)).toEqual([m, c3, f1, c2, c1])
    expect(log[0]).toEqual({
      hash: m, parents: [c3, f1], refs: [{ name: 'main', kind: 'branch', current: true }],
      subject: 'Merge feature', time: time(repo, m), author: 'Test User',
    })
    expect(log[2]).toMatchObject({ parents: [c2], refs: [{ name: 'feature', kind: 'branch' }], subject: 'f1: the feature' })
    expect(log[3].refs).toEqual([{ name: 'origin/main', kind: 'remote' }])
    expect(log[4]).toMatchObject({ parents: [], refs: [{ name: 'v1', kind: 'tag' }] })
  })

  it('pages with skip and limit', async () => {
    const { repo, c3, f1 } = history()
    expect((await readLog(repo, 1, 2)).map((c) => c.hash)).toEqual([c3, f1])
    expect(await readLog(repo, 5, 10)).toEqual([])
  })

  it('leaves out the stash and shows a detached HEAD', async () => {
    const { repo, c3 } = history()
    write(repo, { 'wip.txt': 'wip' })
    run(repo, 'stash', 'push', '-q', '-u')
    run(repo, 'checkout', '-q', '--detach', c3)
    const log = await readLog(repo, 0, 100)
    expect(log).toHaveLength(5)
    expect(log.find((c) => c.hash === c3)?.refs).toEqual([{ name: 'HEAD', kind: 'head' }])
  })

  it('is empty in a repo without commits', async () => {
    expect(await readLog(makeRepo(), 0, 100)).toEqual([])
  })
})

describe('readToMerge', () => {
  it('lists exactly the commits on the branch that the target lacks', async () => {
    const repo = makeRepo()
    commit(repo, 'c1')
    branch(repo, 'dev')
    checkout(repo, 'dev')
    commit(repo, 'd1')
    branch(repo, 'feature')
    checkout(repo, 'feature')
    const f1 = commit(repo, 'f1')
    const f2 = commit(repo, 'f2')
    expect(await readToMerge(repo, 'dev')).toEqual([f2, f1])
    expect(await readToMerge(repo, 'feature')).toEqual([])
    expect(await readToMerge(repo, 'gone')).toEqual([])
    expect(await readToMerge(repo, '--all')).toEqual([])
  })
})
