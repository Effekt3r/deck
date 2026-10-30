import { afterAll, describe, expect, it } from 'vitest'
import { GitError, git, gitEnv, gitOk, tryGit } from './runner'
import { checkout, commit, makeDir, makeRepo, removeRepos, run } from './test-repo'

afterAll(removeRepos)

describe('git runner', () => {
  it('never takes optional locks or prompts, and ignores a parent git environment', () => {
    const env = gitEnv({ PATH: '/bin', HOME: '/h', GIT_DIR: '/x/.git', GIT_WORK_TREE: '/x', GIT_INDEX_FILE: '/x/i' })
    expect(env).toMatchObject({ PATH: '/bin', HOME: '/h', GIT_OPTIONAL_LOCKS: '0', GIT_TERMINAL_PROMPT: '0' })
    // Set inside a git hook, these would point every command at that other repo.
    expect(env).not.toHaveProperty('GIT_DIR')
    expect(env).not.toHaveProperty('GIT_WORK_TREE')
    expect(env).not.toHaveProperty('GIT_INDEX_FILE')
    expect(gitEnv()).toMatchObject({ GIT_OPTIONAL_LOCKS: '0', GIT_TERMINAL_PROMPT: '0' })
  })

  it('runs with fsmonitor off and paths unquoted', async () => {
    const repo = makeRepo()
    commit(repo, 'init', { 'café.txt': 'x' })
    expect(await git(repo, ['config', 'core.fsmonitor'])).toBe('false\n')
    expect(await git(repo, ['ls-files'])).toBe('café.txt\n')
  })

  it('throws a GitError with stderr and exit code', async () => {
    const err = await git(makeDir(), ['status']).catch((e: unknown) => e)
    expect(err).toBeInstanceOf(GitError)
    expect((err as GitError).code).toBe(128)
    expect((err as GitError).stderr).toMatch(/not a git repository/i)
  })

  it('refuses to run without a repository (git -C "" would use the current folder)', async () => {
    await expect(git('', ['status'])).rejects.toBeInstanceOf(GitError)
  })

  it('tryGit resolves null instead of throwing', async () => {
    expect(await tryGit(makeDir(), ['status'])).toBeNull()
    const repo = makeRepo()
    expect(await tryGit(repo, ['rev-parse', '--is-inside-work-tree'])).toBe('true\n')
  })

  it('gitOk tells exit status 0 from anything else', async () => {
    const repo = makeRepo()
    const a = commit(repo, 'a')
    const b = commit(repo, 'b')
    run(repo, 'checkout', '-q', '--orphan', 'other')
    const c = commit(repo, 'unrelated')
    checkout(repo, 'main')
    expect(await gitOk(repo, ['merge-base', '--is-ancestor', a, b])).toBe(true)
    expect(await gitOk(repo, ['merge-base', '--is-ancestor', c, b])).toBe(false)
    expect(await gitOk(makeDir(), ['status'])).toBe(false)
  })
})
