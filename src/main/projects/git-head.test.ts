import { mkdirSync, mkdtempSync, writeFileSync } from 'node:fs'
import { tmpdir } from 'node:os'
import { join } from 'node:path'
import { describe, expect, it } from 'vitest'
import { readBranch } from './git-head'

function repo(head: string) {
  const d = mkdtempSync(join(tmpdir(), 'deck-git-'))
  mkdirSync(join(d, '.git'))
  writeFileSync(join(d, '.git', 'HEAD'), head)
  return d
}

describe('readBranch', () => {
  it('reads the branch', async () => expect(await readBranch(repo('ref: refs/heads/feature/x\n'))).toBe('feature/x'))
  it('shortens a detached HEAD', async () => expect(await readBranch(repo('0123456789abcdef\n'))).toBe('0123456'))
  it('follows a worktree pointer (relative and absolute)', async () => {
    const main = repo('ref: refs/heads/main\n')
    const wtGit = join(main, '.git', 'worktrees', 'w')
    mkdirSync(wtGit, { recursive: true })
    writeFileSync(join(wtGit, 'HEAD'), 'ref: refs/heads/wt-branch\n')
    const wt = mkdtempSync(join(tmpdir(), 'deck-wt-'))
    writeFileSync(join(wt, '.git'), `gitdir: ${wtGit}\n`)
    expect(await readBranch(wt)).toBe('wt-branch')
    const sub = join(main, 'sub') // relative pointers are how submodules write it
    mkdirSync(sub)
    writeFileSync(join(sub, '.git'), 'gitdir: ../.git/worktrees/w\n')
    expect(await readBranch(sub)).toBe('wt-branch')
  })
  it("returns '?' for a broken pointer and null without .git", async () => {
    const wt = mkdtempSync(join(tmpdir(), 'deck-wt-'))
    writeFileSync(join(wt, '.git'), 'garbage')
    expect(await readBranch(wt)).toBe('?')
    writeFileSync(join(wt, '.git'), `gitdir: ${join(wt, 'gone')}\n`)
    expect(await readBranch(wt)).toBe('?')
    expect(await readBranch(mkdtempSync(join(tmpdir(), 'deck-plain-')))).toBeNull()
  })
})
