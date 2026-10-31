import { afterAll, describe, expect, it } from 'vitest'
import { readSnapshot } from './snapshot'
import { branch, checkout, commit, makeRepo, removeRepos } from './test-repo'

afterAll(removeRepos)

const none = { get: async () => null }

/** main: c1 · dev: c1 d1 · feature (checked out): c1 d1 f1 f2 */
function trunk() {
  const repo = makeRepo()
  commit(repo, 'c1')
  branch(repo, 'dev')
  checkout(repo, 'dev')
  const d1 = commit(repo, 'd1')
  branch(repo, 'feature')
  checkout(repo, 'feature')
  const f1 = commit(repo, 'f1')
  const f2 = commit(repo, 'f2')
  return { repo, d1, f1, f2 }
}

describe('readSnapshot', () => {
  it('header, first page of history and the commits that will merge', async () => {
    const { repo, f1, f2 } = trunk()
    const s = await readSnapshot(repo, none)
    expect(s.summary.target).toEqual({ ref: 'dev', ahead: 2, behind: 0, source: 'auto' })
    expect(s.commits).toHaveLength(4)
    expect(s.hasMore).toBe(false)
    expect(s.toMerge).toEqual([f2, f1])
  })

  it("applies Deck's override for the checked-out branch", async () => {
    const { repo, d1, f1, f2 } = trunk()
    const asked: string[] = []
    const targets = { get: async (_root: string, b: string) => (asked.push(b), b === 'feature' ? 'main' : null) }
    const s = await readSnapshot(repo, targets)
    expect(asked).toEqual(['feature'])
    expect(s.summary.target).toMatchObject({ ref: 'main', source: 'deck' })
    expect(s.toMerge).toEqual([f2, f1, d1])
    const broken = { get: async () => { throw new Error('disk on fire') } }
    expect((await readSnapshot(repo, broken)).summary.target?.source).toBe('auto')
  })

  it('says when there is more history than one page', async () => {
    const { repo } = trunk()
    const s = await readSnapshot(repo, none, 3)
    expect(s.commits).toHaveLength(3)
    expect(s.hasMore).toBe(true)
    expect((await readSnapshot(repo, none, 4)).hasMore).toBe(false)
  })

  it('nothing to merge without a target', async () => {
    const { repo } = trunk()
    checkout(repo, 'main')
    const s = await readSnapshot(repo, none)
    expect(s.summary.target).toBeNull()
    expect(s.toMerge).toEqual([])
    expect(s.commits).toHaveLength(4) // all branches
  })
})
