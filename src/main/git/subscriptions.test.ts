import { describe, expect, it, vi } from 'vitest'
import type { GitSnapshot } from '@shared/types'
import { type Client, RepoSubscriptions } from './subscriptions'
import type { GitDirs } from './summary'

const DIRS: GitDirs = { root: '/r', gitDir: '/r/.git', commonDir: '/r/.git' }
const tick = () => new Promise((resolve) => setTimeout(resolve, 0))

function snap(head: string): GitSnapshot {
  return {
    summary: {
      root: '/r', branch: 'main', head, operation: null, upstream: null, target: null,
      counts: { staged: 0, changed: 0, untracked: 0, conflicts: 0 },
    },
    commits: [],
    hasMore: false,
    toMerge: [],
  }
}

/** A hub over fakes: '/r…' folders are one repo, anything else isn't a repo. */
function setup() {
  const state = { head: 'a' }
  const onChange: (() => void)[] = []
  const stop = vi.fn()
  const deps = {
    resolve: vi.fn(async (repo: string) => (repo.startsWith('/r') ? DIRS : null)),
    snapshot: vi.fn(async () => snap(state.head)),
    watch: vi.fn((_dirs: GitDirs, cb: () => void) => {
      onChange.push(cb)
      return stop
    }),
  }
  const hub = new RepoSubscriptions(deps)
  const client = (id: number) => ({ id, send: vi.fn<Client['send']>() })
  const change = async (head?: string) => {
    if (head) state.head = head
    onChange.at(-1)?.()
    await tick()
  }
  return { hub, deps, stop, client, change }
}

/** A promise with its resolve function, to hold a fake git call open. */
function gate<T>() {
  let open!: (value: T) => void
  const promise = new Promise<T>((resolve) => (open = resolve))
  return { promise, open }
}

describe('RepoSubscriptions', () => {
  it('resolves with the snapshot; one watcher per repo, shared by clients and folders', async () => {
    const { hub, deps, client } = setup()
    expect(await hub.subscribe(client(1), '/r')).toEqual(snap('a'))
    expect(await hub.subscribe(client(2), '/r/sub')).toEqual(snap('a'))
    expect(deps.watch).toHaveBeenCalledTimes(1)
  })

  it('is null for a folder that is not a repo, and watches nothing', async () => {
    const { hub, deps, client } = setup()
    expect(await hub.subscribe(client(1), '/elsewhere')).toBeNull()
    hub.unsubscribe(1, '/elsewhere')
    expect(deps.watch).not.toHaveBeenCalled()
  })

  it('pushes a changed snapshot to each subscriber with its own folder; an identical one is not pushed', async () => {
    const { hub, client, change } = setup()
    const a = client(1)
    const b = client(2)
    await hub.subscribe(a, '/r')
    await hub.subscribe(b, '/r/sub')
    expect(a.send).not.toHaveBeenCalled() // subscribe's own result isn't pushed again
    await change('b')
    expect(a.send).toHaveBeenCalledExactlyOnceWith('/r', snap('b'))
    expect(b.send).toHaveBeenCalledExactlyOnceWith('/r/sub', snap('b'))
    await change()
    expect(a.send).toHaveBeenCalledTimes(1)
  })

  it('never builds two snapshots of a repo at once; changes meanwhile cause one more build', async () => {
    const { hub, deps, client, change } = setup()
    await hub.subscribe(client(1), '/r')
    let running = 0
    let most = 0
    const gates: ReturnType<typeof gate<GitSnapshot>>[] = []
    deps.snapshot.mockImplementation(async () => {
      running++
      most = Math.max(most, running)
      const g = gate<GitSnapshot>()
      gates.push(g)
      const s = await g.promise
      running--
      return s
    })
    await change()
    await change()
    await change()
    expect(gates).toHaveLength(1)
    gates[0].open(snap('b'))
    await tick()
    expect(gates).toHaveLength(2)
    gates[1].open(snap('c'))
    await tick()
    expect(gates).toHaveLength(2)
    expect(most).toBe(1)
  })

  it('counts subscriptions per client and folder; the last one leaving stops the watcher', async () => {
    const { hub, stop, client, change } = setup()
    const a = client(1)
    await hub.subscribe(a, '/r')
    await hub.subscribe(a, '/r')
    await hub.subscribe(client(2), '/r')
    hub.unsubscribe(1, '/r')
    hub.unsubscribe(2, '/r')
    expect(stop).not.toHaveBeenCalled()
    await change('b')
    expect(a.send).toHaveBeenCalledTimes(1)
    hub.unsubscribe(1, '/r')
    expect(stop).toHaveBeenCalledTimes(1)
    hub.unsubscribe(1, '/r') // one too many: ignored
  })

  it('an unsubscribe that overtakes its subscribe leaves no watcher running', async () => {
    const { hub, deps, stop, client } = setup()
    const slow = gate<GitDirs | null>()
    deps.resolve.mockReturnValueOnce(slow.promise)
    const pending = hub.subscribe(client(1), '/r')
    hub.unsubscribe(1, '/r')
    slow.open(DIRS)
    expect(await pending).toEqual(snap('a')) // the caller still gets an answer
    expect(deps.watch).toHaveBeenCalledTimes(1)
    expect(stop).toHaveBeenCalledTimes(1)
    // A fresh subscribe for the same folder works normally.
    await hub.subscribe(client(1), '/r')
    expect(deps.watch).toHaveBeenCalledTimes(2)
    expect(stop).toHaveBeenCalledTimes(1)
  })

  it('drop() removes everything a client subscribed to', async () => {
    const { hub, stop, client, change } = setup()
    const a = client(1)
    const b = client(2)
    await hub.subscribe(a, '/r')
    await hub.subscribe(a, '/r/sub')
    await hub.subscribe(b, '/r')
    hub.drop(1)
    await change('b')
    expect(a.send).not.toHaveBeenCalled()
    expect(b.send).toHaveBeenCalledTimes(1)
    hub.drop(2)
    expect(stop).toHaveBeenCalledTimes(1)
  })

  it('a failed first snapshot rejects, and the subscription recovers on the next change', async () => {
    const { hub, deps, client, change } = setup()
    deps.snapshot.mockRejectedValueOnce(new Error('git timed out'))
    const a = client(1)
    await expect(hub.subscribe(a, '/r')).rejects.toThrow('git timed out')
    await change('b')
    expect(a.send).toHaveBeenCalledExactlyOnceWith('/r', snap('b'))
  })

  it('refresh() rebuilds a watched repo now, by any spelling of its root', async () => {
    const { hub, deps, client } = setup()
    const a = client(1)
    await hub.subscribe(a, '/r')
    deps.snapshot.mockResolvedValueOnce(snap('z'))
    await hub.refresh('/r/')
    expect(a.send).toHaveBeenCalledExactlyOnceWith('/r', snap('z'))
    await hub.refresh('/not-watched') // nothing to do
  })

  it('one client failing to receive does not stop the others', async () => {
    const { hub, client, change } = setup()
    const broken = client(1)
    broken.send.mockImplementation(() => { throw new Error('render frame disposed') })
    const ok = client(2)
    await hub.subscribe(broken, '/r')
    await hub.subscribe(ok, '/r')
    await change('b')
    expect(ok.send).toHaveBeenCalledTimes(1)
  })
})
