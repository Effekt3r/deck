import { readdirSync } from 'node:fs'
import { join } from 'node:path'
import { afterAll, describe, expect, it } from 'vitest'
import type { GitFileChange } from '@shared/types'
import { readDetails } from './details'
import { branch, checkout, commit, makeDir, makeRepo, merge, removeRepos, run, runDated } from './test-repo'

afterAll(removeRepos)

const byPath = (files: GitFileChange[] | undefined) => [...(files ?? [])].sort((a, b) => (a.path < b.path ? -1 : 1))
const lines = (n: number, word: string) => Array.from({ length: n }, (_, i) => `${word} ${i}\n`).join('')

describe('readDetails', () => {
  it('lists added, modified, deleted, renamed and binary files with line counts', async () => {
    const repo = makeRepo()
    commit(repo, 'c1', { 'a.txt': 'one\ntwo\nthree\n', 'b.txt': 'bye\n', 'c.txt': lines(20, 'moved') })
    const c2 = commit(repo, 'c2', {
      'a.txt': 'one\n2\nthree\nfour\n', 'b.txt': null, 'c.txt': null, 'd.txt': lines(20, 'moved'),
      'e.bin': Buffer.from([0, 1, 2, 0, 255]), 'dir with space/ü.txt': 'x\n',
    })
    const d = await readDetails(repo, c2)
    expect(byPath(d?.files)).toEqual([
      { status: 'M', path: 'a.txt', additions: 2, deletions: 1 },
      { status: 'D', path: 'b.txt', additions: 0, deletions: 1 },
      { status: 'R', path: 'd.txt', oldPath: 'c.txt', additions: 0, deletions: 0 },
      { status: 'A', path: 'dir with space/ü.txt', additions: 1, deletions: 0 },
      { status: 'A', path: 'e.bin', additions: null, deletions: null },
    ])
  })

  it('has the full message, author, email, time and parents', async () => {
    const repo = makeRepo()
    const c1 = commit(repo, 'c1')
    runDated(repo, 'commit', '-q', '--allow-empty', '-m', 'Subject line', '-m', 'Body text\nsecond line')
    const c2 = run(repo, 'rev-parse', 'HEAD')
    expect(await readDetails(repo, c2.slice(0, 10))).toEqual({
      hash: c2, parents: [c1], author: 'Test User', email: 'test@example.com',
      time: Number(run(repo, 'log', '-1', '--format=%ct', c2)) * 1000,
      message: 'Subject line\n\nBody text\nsecond line', files: [],
    })
  })

  it('diffs a merge against its first parent', async () => {
    const repo = makeRepo()
    commit(repo, 'c1', { 'base.txt': 'b\n' })
    branch(repo, 'feature')
    checkout(repo, 'feature')
    commit(repo, 'f1', { 'f.txt': 'f\n' })
    checkout(repo, 'main')
    const m1 = commit(repo, 'm1', { 'm.txt': 'm\n' })
    const m = merge(repo, 'feature')
    const d = await readDetails(repo, m)
    expect(d?.parents[0]).toBe(m1)
    expect(d?.files).toEqual([{ status: 'A', path: 'f.txt', additions: 1, deletions: 0 }])
  })

  it('diffs a root commit against the empty tree', async () => {
    const repo = makeRepo()
    const c1 = commit(repo, 'c1', { 'a.txt': 'a\nb\n', 'z.txt': 'z\n' })
    expect((await readDetails(repo, c1))?.files).toEqual([
      { status: 'A', path: 'a.txt', additions: 2, deletions: 0 },
      { status: 'A', path: 'z.txt', additions: 1, deletions: 0 },
    ])
  })

  it('is null for an unknown hash, a non-commit object or anything that is not a hash', async () => {
    const repo = makeRepo()
    commit(repo, 'c1', { 'a.txt': 'a\n' })
    expect(await readDetails(repo, 'deadbeefdeadbeef')).toBeNull()
    expect(await readDetails(repo, run(repo, 'rev-parse', 'HEAD^{tree}'))).toBeNull()
    expect(await readDetails(repo, '--output=x')).toBeNull()
    expect(await readDetails(repo, 'HEAD')).toBeNull()
  })

  it('never fetches missing blobs in a partial clone; the counts are just unavailable', async () => {
    const origin = makeRepo()
    commit(origin, 'base', { 'a.txt': 'one\n', 'b.txt': 'two\n' })
    const head = commit(origin, 'edit', { 'a.txt': 'one\nmore\n' })
    run(origin, 'config', 'uploadpack.allowFilter', 'true')
    const clone = join(makeDir(), 'clone')
    run(origin, 'clone', '-q', '--no-checkout', '--filter=blob:none', `file://${origin}`, clone)
    const packs = () => readdirSync(join(clone, '.git', 'objects', 'pack')).filter((f) => f.endsWith('.pack')).length
    const before = packs()
    const details = await readDetails(clone, head)
    expect(packs()).toBe(before) // nothing fetched or written
    expect(details?.files.map((f) => `${f.status} ${f.path}`)).toEqual(['M a.txt'])
    expect(details?.countsUnavailable).toBe(true)
  })
})
