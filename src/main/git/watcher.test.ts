import { join } from 'node:path'
import { afterAll, describe, expect, it, vi } from 'vitest'
import { gitDirs } from './summary'
import { commit, makeDir, makeRepo, removeRepos, run, write } from './test-repo'
import { repoProbe, watchRepo } from './watcher'

afterAll(removeRepos)

const sleep = (ms: number) => new Promise((resolve) => setTimeout(resolve, ms))

/** Watches `repo`, waits for the OS watcher to settle, then counts calls from zero. */
async function watching(repo: string, opts: { debounceMs?: number; pollMs?: number; probe?: () => Promise<string> } = {}) {
  const dirs = await gitDirs(repo)
  if (!dirs) throw new Error(`not a repo: ${repo}`)
  const counter = { calls: 0 }
  const stop = watchRepo(dirs, () => counter.calls++, { pollMs: 60_000, ...opts })
  await sleep(400)
  counter.calls = 0
  return { counter, stop }
}

describe('watchRepo', () => {
  it('a commit triggers onChange within 2 s', async () => {
    const repo = makeRepo()
    commit(repo, 'c1')
    const { counter, stop } = await watching(repo)
    commit(repo, 'c2')
    await vi.waitFor(() => expect(counter.calls).toBeGreaterThan(0), { timeout: 2000, interval: 50 })
    stop()
  })

  it('staging a file (only the index changes) triggers it too', async () => {
    const repo = makeRepo()
    commit(repo, 'c1')
    const { counter, stop } = await watching(repo)
    write(repo, { 'a.txt': 'a' })
    run(repo, 'add', 'a.txt')
    await vi.waitFor(() => expect(counter.calls).toBeGreaterThan(0), { timeout: 2000, interval: 50 })
    stop()
  })

  it('debounces a burst of ref updates into one call', async () => {
    const repo = makeRepo()
    const c1 = commit(repo, 'c1')
    const { counter, stop } = await watching(repo, { debounceMs: 300 })
    for (let i = 0; i < 5; i++) run(repo, 'update-ref', `refs/heads/b${i}`, c1)
    await sleep(1200)
    expect(counter.calls).toBe(1)
    stop()
  })

  it('ignores the work tree and object writes', async () => {
    const repo = makeRepo()
    commit(repo, 'c1')
    const { counter, stop } = await watching(repo, { debounceMs: 50 })
    write(repo, { 'untracked.txt': 'x' })
    run(repo, 'hash-object', '-w', 'untracked.txt')
    await sleep(600)
    expect(counter.calls).toBe(0)
    stop()
  })

  it('polls even when nothing changes', async () => {
    const repo = makeRepo()
    const { counter, stop } = await watching(repo, { pollMs: 100 })
    await sleep(550)
    expect(counter.calls).toBeGreaterThanOrEqual(3)
    stop()
  })

  it('with a probe, a poll fires only when the probe result changes', async () => {
    const repo = makeRepo()
    let value = 'a'
    const { counter, stop } = await watching(repo, { pollMs: 50, probe: async () => value })
    await sleep(300)
    expect(counter.calls).toBe(0) // same as the baseline taken at start
    value = 'b'
    await sleep(200)
    expect(counter.calls).toBe(1)
    await sleep(200)
    expect(counter.calls).toBe(1) // 'b' is the new baseline
    stop()
  })

  it('repoProbe changes with the work tree and HEAD, and not otherwise', async () => {
    const repo = makeRepo()
    commit(repo, 'c1')
    const dirs = await gitDirs(repo)
    if (!dirs) throw new Error('not a repo')
    const before = await repoProbe(dirs)
    expect(await repoProbe(dirs)).toBe(before)
    write(repo, { 'new.txt': 'x' }) // untracked file
    const untracked = await repoProbe(dirs)
    expect(untracked).not.toBe(before)
    await sleep(20)
    commit(repo, 'c2')
    expect(await repoProbe(dirs)).not.toBe(untracked)
  })

  it('stop() ends events and polling', async () => {
    const repo = makeRepo()
    commit(repo, 'c1')
    const { counter, stop } = await watching(repo, { debounceMs: 50, pollMs: 100 })
    stop()
    counter.calls = 0
    commit(repo, 'c2')
    await sleep(600)
    expect(counter.calls).toBe(0)
  })

  it("watches a worktree's own git dir and the shared refs", async () => {
    const repo = makeRepo()
    commit(repo, 'c1')
    const wt = join(makeDir(), 'wt')
    run(repo, 'worktree', 'add', '-q', '--detach', wt)
    const { counter, stop } = await watching(wt)
    commit(wt, 'detached commit in the worktree') // moves only .git/worktrees/wt/HEAD, no ref
    await vi.waitFor(() => expect(counter.calls).toBeGreaterThan(0), { timeout: 2000, interval: 50 })
    await sleep(400)
    counter.calls = 0
    commit(repo, 'commit on main in the main checkout') // refs/heads/main in the common dir
    await vi.waitFor(() => expect(counter.calls).toBeGreaterThan(0), { timeout: 2000, interval: 50 })
    stop()
  })

  it("doesn't throw for folders that don't exist; the poll still runs", async () => {
    const gone = join(makeDir(), 'gone')
    const counter = { calls: 0 }
    const stop = watchRepo({ gitDir: gone, commonDir: join(gone, 'common') }, () => counter.calls++, { pollMs: 50 })
    await vi.waitFor(() => expect(counter.calls).toBeGreaterThan(0), { timeout: 1000, interval: 20 })
    stop()
  })
})
