import { EventEmitter } from 'node:events'
import { readFileSync } from 'node:fs'
import { join, resolve } from 'node:path'
import { afterAll, beforeAll, describe, expect, it, vi } from 'vitest'
import { IPC } from '@shared/channels'
import type { GitSnapshot } from '@shared/types'
import { pathKey } from '../projects/config'
import { registerGitIpc } from './ipc'
import { branch, checkout, commit, makeDir, makeRepo, removeRepos } from './test-repo'

const ipc = vi.hoisted(() => ({
  handlers: new Map<string, (...args: unknown[]) => unknown>(),
  listeners: new Map<string, (...args: unknown[]) => void>(),
}))
vi.mock('electron', () => ({
  ipcMain: {
    handle: (channel: string, fn: (...args: unknown[]) => unknown) => ipc.handlers.set(channel, fn),
    on: (channel: string, fn: (...args: unknown[]) => void) => ipc.listeners.set(channel, fn),
  },
}))

let nextId = 1
/** The parts of WebContents the git IPC uses. */
class FakeContents extends EventEmitter {
  readonly id = nextId++
  readonly sent: [channel: string, repo: string, snapshot: GitSnapshot][] = []
  send(channel: string, repo: string, snapshot: GitSnapshot) {
    this.sent.push([channel, repo, snapshot])
  }
  isDestroyed() {
    return false
  }
}

const invoke = async (wc: FakeContents, channel: string, ...args: unknown[]) => ipc.handlers.get(channel)?.({ sender: wc }, ...args)
const emit = (wc: FakeContents, channel: string, ...args: unknown[]) => ipc.listeners.get(channel)?.({ sender: wc }, ...args)
const sleep = (ms: number) => new Promise((r) => setTimeout(r, ms))
const lastPush = (wc: FakeContents) => wc.sent.at(-1)?.[2]

let targetsFile = ''
beforeAll(() => {
  targetsFile = join(makeDir('deck-ipc-'), 'git-targets.json')
  registerGitIpc({ targetsFile })
})
afterAll(removeRepos)

describe('git IPC', () => {
  it('answers bad arguments with null, [] or nothing, never a throw', async () => {
    const wc = new FakeContents()
    const plain = makeDir()
    for (const bad of [undefined, 42, '', 'relative/path', {}, plain]) {
      expect(await invoke(wc, IPC.gitSubscribe, bad)).toBeNull()
      expect(() => emit(wc, IPC.gitUnsubscribe, bad)).not.toThrow()
      expect(await invoke(wc, IPC.gitLogPage, bad, 0, 10)).toEqual([])
      expect(await invoke(wc, IPC.gitDetails, bad, 'abc1234')).toBeNull()
      expect(await invoke(wc, IPC.gitTargets, bad)).toEqual([])
      expect(await invoke(wc, IPC.gitSetTarget, bad, 'main', 'dev')).toBeUndefined()
    }
    const repo = makeRepo()
    commit(repo, 'c1')
    for (const [skip, limit] of [[-1, 10], [0, 0], [0, 1.5], ['0', 10], [0, 1e9], [Number.NaN, 10]]) {
      expect(await invoke(wc, IPC.gitLogPage, repo, skip, limit)).toEqual([])
    }
    expect(await invoke(wc, IPC.gitDetails, repo, 42)).toBeNull()
    for (const [b, t] of [['', 'dev'], ['-x', 'dev'], [42, 'dev'], ['main', 42], ['main', '--output=x'], ['main', 'a b']]) {
      expect(await invoke(wc, IPC.gitSetTarget, repo, b, t)).toBeUndefined()
    }
    expect(() => readFileSync(targetsFile)).toThrow() // nothing was stored
  })

  it('subscribes from any folder in the repo, pushes changes with that folder, stops after unsubscribe', async () => {
    const repo = makeRepo()
    const c1 = commit(repo, 'c1', { 'sub/a.txt': 'a' })
    const folder = join(repo, 'sub')
    const wc = new FakeContents()
    const snap = (await invoke(wc, IPC.gitSubscribe, folder)) as GitSnapshot
    expect(pathKey(resolve(snap.summary.root))).toBe(pathKey(resolve(repo)))
    expect(snap.commits.map((c) => c.hash)).toEqual([c1])
    expect(snap.hasMore).toBe(false)

    const c2 = commit(repo, 'c2')
    await vi.waitFor(() => expect(lastPush(wc)?.commits[0].hash).toBe(c2), { timeout: 3000, interval: 50 })
    expect(wc.sent.at(-1)?.slice(0, 2)).toEqual([IPC.gitUpdate, folder])

    const pushes = wc.sent.length
    emit(wc, IPC.gitUnsubscribe, folder)
    commit(repo, 'c3')
    await sleep(1000)
    expect(wc.sent).toHaveLength(pushes)
  }, 10_000)

  it('serves more history, commit details and target choices', async () => {
    const repo = makeRepo()
    const c1 = commit(repo, 'c1')
    const c2 = commit(repo, 'c2', { 'a.txt': 'a\n' })
    branch(repo, 'dev')
    const wc = new FakeContents()
    expect(((await invoke(wc, IPC.gitLogPage, repo, 1, 10)) as GitSnapshot['commits']).map((c) => c.hash)).toEqual([c1])
    expect(await invoke(wc, IPC.gitDetails, repo, c2)).toMatchObject({
      hash: c2, parents: [c1], files: [{ status: 'A', path: 'a.txt', additions: 1, deletions: 0 }],
    })
    expect(await invoke(wc, IPC.gitDetails, repo, 'deadbeef')).toBeNull()
    expect(await invoke(wc, IPC.gitTargets, repo)).toEqual(['dev', 'main'])
  })

  it('setTarget stores the override in its file and pushes the new target', async () => {
    const repo = makeRepo()
    commit(repo, 'c1')
    branch(repo, 'dev')
    checkout(repo, 'dev')
    commit(repo, 'd1')
    branch(repo, 'feature')
    checkout(repo, 'feature')
    commit(repo, 'f1')
    const wc = new FakeContents()
    const snap = (await invoke(wc, IPC.gitSubscribe, repo)) as GitSnapshot
    expect(snap.summary.target).toMatchObject({ ref: 'dev', source: 'auto' })

    await invoke(wc, IPC.gitSetTarget, repo, 'feature', 'main')
    expect(lastPush(wc)?.summary.target).toEqual({ ref: 'main', ahead: 2, behind: 0, source: 'deck' })
    expect(lastPush(wc)?.toMerge).toHaveLength(2)
    expect(Object.values(JSON.parse(readFileSync(targetsFile, 'utf8')))).toEqual([{ feature: 'main' }])

    await invoke(wc, IPC.gitSetTarget, repo, 'feature', null)
    expect(lastPush(wc)?.summary.target).toMatchObject({ ref: 'dev', source: 'auto' })
    emit(wc, IPC.gitUnsubscribe, repo)
  })

  it('a destroyed or reloading webContents loses its subscriptions', async () => {
    const repo = makeRepo()
    commit(repo, 'c1')
    const closed = new FakeContents()
    const reloaded = new FakeContents()
    await invoke(closed, IPC.gitSubscribe, repo)
    await invoke(reloaded, IPC.gitSubscribe, repo)
    closed.emit('destroyed')
    reloaded.emit('did-start-loading')
    commit(repo, 'c2')
    await sleep(1000)
    expect(closed.sent).toEqual([])
    expect(reloaded.sent).toEqual([])
  }, 10_000)
})
