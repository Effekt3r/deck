import { existsSync, mkdirSync, writeFileSync } from 'node:fs'
import { basename, dirname, join, resolve } from 'node:path'
import { afterAll, describe, expect, it } from 'vitest'
import { pathKey } from '../projects/config'
import { countStatus, gitDirs, readSummary } from './summary'
import { addRemote, branch, checkout, commit, makeDir, makeRepo, removeRepos, run, setRef, short, write } from './test-repo'

afterAll(removeRepos)

/** Same folder however git spells it (forward slashes and drive-letter case on Windows). */
const key = (p: string) => pathKey(resolve(p))
const clean = { staged: 0, changed: 0, untracked: 0, conflicts: 0 }

describe('gitDirs', () => {
  it('finds the root, git dir and common dir from any folder inside the repo', async () => {
    const repo = makeRepo()
    commit(repo, 'c1')
    mkdirSync(join(repo, 'sub', 'deeper'), { recursive: true })
    const dirs = await gitDirs(join(repo, 'sub', 'deeper'))
    expect(dirs && key(dirs.root)).toBe(key(repo))
    expect(dirs && key(dirs.gitDir)).toBe(key(join(repo, '.git')))
    expect(dirs && key(dirs.commonDir)).toBe(key(join(repo, '.git'))) // git prints it relative: ../../.git
  })

  it("a worktree has its own git dir and the main repo's common dir", async () => {
    const repo = makeRepo()
    commit(repo, 'c1')
    const wt = join(makeDir(), 'wt')
    run(repo, 'worktree', 'add', '-q', '-b', 'wt-branch', wt)
    const dirs = await gitDirs(wt)
    expect(dirs && key(dirs.root)).toBe(key(wt))
    expect(dirs && key(dirs.gitDir)).toBe(key(join(repo, '.git', 'worktrees', 'wt')))
    expect(dirs && key(dirs.commonDir)).toBe(key(join(repo, '.git')))
  })

  it('spells the git dir and common dir alike when the folder is passed in another case', async () => {
    const repo = makeRepo()
    commit(repo, 'c1')
    const shouted = join(dirname(repo), basename(repo).toUpperCase())
    if (!existsSync(shouted)) return // a case-sensitive file system: nothing to check
    const dirs = await gitDirs(shouted)
    expect(dirs?.commonDir).toBe(dirs?.gitDir) // else the watcher would take the repo for a worktree
  })

  it('is null outside a repo', async () => {
    expect(await gitDirs(makeDir())).toBeNull()
    expect(await gitDirs(join(makeDir(), 'missing'))).toBeNull()
  })
})

describe('readSummary', () => {
  it('a clean repo, read from a sub-folder', async () => {
    const repo = makeRepo()
    commit(repo, 'c1', { 'sub/a.txt': 'a' })
    const s = await readSummary(join(repo, 'sub'))
    expect(key(s.root)).toBe(key(repo))
    expect(s).toEqual({
      root: s.root, branch: 'main', head: short(repo), operation: null, upstream: null, target: null, counts: clean,
    })
  })

  it('counts staged, changed and untracked paths like the prototype', async () => {
    const repo = makeRepo()
    commit(repo, 'c1', { 'a.txt': 'a', 'd.txt': 'd' })
    write(repo, { 'a.txt': 'a2', 'b.txt': 'b', 'd.txt': 'd2' })
    run(repo, 'add', 'b.txt', 'd.txt')
    write(repo, { 'd.txt': 'd3', 'c.txt': 'c' }) // d.txt is now staged and changed again
    expect((await readSummary(repo)).counts).toEqual({ staged: 2, changed: 2, untracked: 1, conflicts: 0 })
  })

  it('a detached HEAD has no branch and no target', async () => {
    const repo = makeRepo()
    commit(repo, 'c1')
    commit(repo, 'c2')
    run(repo, 'checkout', '-q', '--detach', 'HEAD~1')
    const s = await readSummary(repo)
    expect(s).toMatchObject({ branch: null, head: short(repo), target: null, upstream: null })
  })

  it('a conflicted merge is an operation in progress with a conflict', async () => {
    const repo = makeRepo()
    commit(repo, 'c1', { 'f.txt': 'a\n' })
    branch(repo, 'other')
    checkout(repo, 'other')
    commit(repo, 'other', { 'f.txt': 'b\n' })
    checkout(repo, 'main')
    commit(repo, 'main', { 'f.txt': 'c\n' })
    expect(() => run(repo, 'merge', 'other')).toThrow()
    const s = await readSummary(repo)
    expect(s.operation).toBe('merge')
    expect(s.counts).toEqual({ ...clean, conflicts: 1 })
  })

  it("reads rebase, cherry-pick and revert from the worktree's own git dir", async () => {
    const repo = makeRepo()
    commit(repo, 'c1')
    const wt = join(makeDir(), 'wt')
    run(repo, 'worktree', 'add', '-q', '-b', 'wt-branch', wt)
    const wtGit = join(repo, '.git', 'worktrees', 'wt')
    mkdirSync(join(wtGit, 'rebase-merge'))
    expect((await readSummary(wt)).operation).toBe('rebase')
    expect((await readSummary(repo)).operation).toBeNull()
    writeFileSync(join(repo, '.git', 'CHERRY_PICK_HEAD'), `${run(repo, 'rev-parse', 'HEAD')}\n`)
    expect((await readSummary(repo)).operation).toBe('cherry-pick')
    writeFileSync(join(repo, '.git', 'REVERT_HEAD'), `${run(repo, 'rev-parse', 'HEAD')}\n`)
    expect((await readSummary(repo)).operation).toBe('cherry-pick') // the prototype's order
    mkdirSync(join(repo, '.git', 'rebase-apply'))
    expect((await readSummary(repo)).operation).toBe('rebase')
  })

  it('upstream ahead/behind against a faked origin/main', async () => {
    const repo = makeRepo()
    const c1 = commit(repo, 'c1')
    commit(repo, 'r1')
    const r2 = commit(repo, 'r2')
    run(repo, 'reset', '-q', '--hard', c1)
    commit(repo, 'local')
    addRemote(repo)
    setRef(repo, 'refs/remotes/origin/main', r2)
    run(repo, 'branch', '-q', '--set-upstream-to=origin/main', 'main')
    expect((await readSummary(repo)).upstream).toEqual({ ref: 'origin/main', ahead: 1, behind: 2 })
    setRef(repo, 'refs/remotes/origin/main', run(repo, 'rev-parse', 'HEAD'))
    expect((await readSummary(repo)).upstream).toEqual({ ref: 'origin/main', ahead: 0, behind: 0 })
    run(repo, 'update-ref', '-d', 'refs/remotes/origin/main') // upstream configured but gone
    expect((await readSummary(repo)).upstream).toBeNull()
  })

  it('the merge target with commits to merge and behind; an override changes it', async () => {
    const repo = makeRepo()
    commit(repo, 'c1')
    branch(repo, 'dev')
    checkout(repo, 'dev')
    commit(repo, 'd1')
    branch(repo, 'feature')
    checkout(repo, 'dev')
    commit(repo, 'd2')
    checkout(repo, 'feature')
    commit(repo, 'f1')
    commit(repo, 'f2')
    expect((await readSummary(repo)).target).toEqual({ ref: 'dev', ahead: 2, behind: 1, source: 'auto' })
    expect((await readSummary(repo, 'main')).target).toEqual({ ref: 'main', ahead: 3, behind: 0, source: 'deck' })
  })

  it("doesn't throw in a repo without commits", async () => {
    const repo = makeRepo()
    write(repo, { 'new.txt': 'n' })
    const s = await readSummary(repo)
    expect(s).toEqual({
      root: s.root, branch: 'main', head: '', operation: null, upstream: null, target: null,
      counts: { ...clean, untracked: 1 },
    })
    run(repo, 'checkout', '-q', '-b', 'feature')
    expect(await readSummary(repo)).toMatchObject({ branch: 'feature', head: '', target: null })
  })
})

describe('countStatus', () => {
  it('counts like status_counts() in the prototype', () => {
    expect(countStatus('UU a\nAA b\nDD c\nDU d\nMM e\nA  f\nR  g -> h\n?? i\n M j\n'))
      .toEqual({ staged: 3, changed: 2, untracked: 1, conflicts: 4 })
    expect(countStatus('')).toEqual(clean)
  })
})
