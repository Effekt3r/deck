import { existsSync, readFileSync, rmSync, writeFileSync } from 'node:fs'
import { basename, resolve, sep } from 'node:path'
import { afterAll, afterEach, describe, expect, it, vi } from 'vitest'
import type { ClaudeSnapshot } from '@shared/types'
import { type Client, type ClaudeDeps, ClaudeSubscriptions, type LogReader, TIMING } from './subscriptions'
import { imageId } from './images'
import { type LogWriter, makeClaudeHome, pngBytes, readLines, removeClaudeHomes, sessionLog } from './test-log'

const FOLDER = resolve(sep, 'Users', 'me', 'app')
const T0 = Date.UTC(2026, 9, 31, 8, 0, 0)

afterEach(() => {
  vi.useRealTimers()
})
afterAll(removeClaudeHomes)

/**
 * A hub over fakes: the sessions are LogWriter logs (the content), their modification times are
 * kept here on the fake clock, watchers are callbacks the test fires.
 */
function setup() {
  vi.useFakeTimers({ now: T0, toFake: ['setTimeout', 'clearTimeout', 'setInterval', 'clearInterval', 'Date'] })
  const home = makeClaudeHome()
  const logs: LogWriter[] = []
  const mtime = new Map<string, number>()
  const opened: string[] = []
  const reads = { count: 0, maxBytes: [] as (number | undefined)[] }
  /** Entries one read returns at most; `more` then says there are others (a log read in chunks). */
  const chunk = { entries: Infinity }
  const watchers: { dirs: string[]; onChange: (name: string | null) => void; stopped: boolean }[] = []
  const steps = new Map<string, string>()
  const deps: ClaudeDeps = {
    scan: vi.fn(async () => ({
      sessions: logs.map((l) => ({ id: l.sessionId, path: l.path, modified: mtime.get(l.path) ?? 0 }))
        .sort((a, b) => b.modified - a.modified),
      dirs: [resolve(sep, 'claude', 'projects', 'p')],
    })),
    open: vi.fn((path: string): LogReader => {
      opened.push(path)
      let seen = 0
      // As JsonlTail: what was appended since the last read, with each line's place; a deleted log
      // has nothing new; one that got shorter was rewritten and is read again from the start (reset).
      const reader = {
        modified: 0, // the time seen at the last read
        async read(maxBytes?: number) {
          reads.count++
          reads.maxBytes.push(maxBytes)
          if (!existsSync(path)) return { entries: [], places: [], reset: false, more: false }
          reader.modified = mtime.get(path) ?? 0
          const all = readLines(path)
          const reset = all.length < seen
          if (reset) seen = 0
          const lines = all.slice(seen, seen + chunk.entries)
          seen += lines.length
          return { entries: lines.map((l) => l.entry), places: lines.map(({ offset, length }) => ({ offset, length })), reset, more: seen < all.length }
        },
      }
      return reader
    }),
    steps: vi.fn(async () => new Map(steps)),
    title: vi.fn(async (path: string) => `title of ${basename(path, '.jsonl')}`),
    watch: vi.fn((dirs: string[], onChange: (name: string | null) => void) => {
      const w = { dirs, onChange, stopped: false }
      watchers.push(w)
      return () => {
        w.stopped = true
      }
    }),
    now: () => Date.now(),
  }
  const hub = new ClaudeSubscriptions(deps)
  /** A session log; lines written through write() bump its modification time to now. */
  const session = (id: string, fill?: (log: LogWriter) => void) => {
    const log = sessionLog(home, FOLDER, id)
    logs.push(log)
    if (fill) write(log, fill)
    return log
  }
  const write = (log: LogWriter, fill: (log: LogWriter) => void) => {
    fill(log)
    mtime.set(log.path, Date.now())
  }
  /** The log is deleted: no longer listed, not readable. */
  const remove = (log: LogWriter) => {
    logs.splice(logs.indexOf(log), 1)
    rmSync(log.path)
  }
  /** The log is written again from scratch (shorter than before). */
  const rewrite = (log: LogWriter, fill: (log: LogWriter) => void) => {
    writeFileSync(log.path, '')
    write(log, fill)
  }
  /** Fires the folder watchers (a file event) and lets the debounce run. */
  const change = async (name: string | null) => {
    for (const w of watchers) if (!w.stopped) w.onChange(name)
    await vi.advanceTimersByTimeAsync(200)
  }
  const client = (id: number) => ({ id, send: vi.fn<Client['send']>() })
  const advance = (ms: number) => vi.advanceTimersByTimeAsync(ms)
  const watching = () => watchers.filter((w) => !w.stopped).length
  return { hub, deps, session, write, remove, rewrite, change, client, advance, opened, reads, chunk, steps, watching }
}

const lastSent = (c: { send: { mock: { calls: Parameters<Client['send']>[] } } }): ClaudeSnapshot | null | undefined =>
  c.send.mock.calls.at(-1)?.[1]

describe('ClaudeSubscriptions', () => {
  it("resolves with the folder's newest session; null when there is none, then pushes the first one", async () => {
    const { hub, session, client, advance } = setup()
    const a = client(1)
    expect(await hub.subscribe(a, FOLDER)).toBeNull()
    session('s1', (l) => l.prompt('hello'))
    await advance(2000) // the rescan finds it
    expect(a.send).toHaveBeenCalledTimes(1)
    expect(a.send.mock.calls[0][0]).toBe(FOLDER)
    expect(lastSent(a)).toMatchObject({ session: { id: 's1', title: 'hello' }, status: { state: 'working' }, following: 'newest' })
  })

  it('reads the followed log when it changes (debounced) and pushes the new snapshot', async () => {
    const { hub, session, write, change, client, reads } = setup()
    const s1 = session('s1', (l) => l.prompt('go'))
    const a = client(1)
    expect(await hub.subscribe(a, FOLDER)).toMatchObject({ status: { state: 'working' }, feed: [{ kind: 'prompt', text: 'go' }] })
    const before = reads.count
    write(s1, (l) => l.toolUse('t1', 'Bash', { command: 'ls', description: 'List' }))
    await change(basename(s1.path))
    expect(reads.count).toBe(before + 1)
    expect(lastSent(a)).toMatchObject({ status: { state: 'tool', detail: 'Bash' } })
    expect(lastSent(a)?.feed.at(-1)).toEqual({ kind: 'tool', id: 't1', name: 'Bash', summary: 'List', state: 'running' })
  })

  it('a burst of file events is one read', async () => {
    const { hub, session, write, client, reads, deps, advance } = setup()
    const s1 = session('s1', (l) => l.prompt('go'))
    await hub.subscribe(client(1), FOLDER)
    const before = reads.count
    const onChange = vi.mocked(deps.watch).mock.calls[0][1]
    for (let i = 0; i < 5; i++) {
      write(s1, (l) => l.reply(`r${i}`, { stopReason: 'tool_use' }))
      onChange(basename(s1.path))
      await advance(50)
    }
    await advance(200)
    expect(reads.count).toBe(before + 1)
  })

  it('follows a newer session only once the followed one has been quiet for 15 s', async () => {
    const { hub, session, write, client, advance } = setup()
    const s1 = session('s1', (l) => l.prompt('one'))
    const a = client(1)
    expect((await hub.subscribe(a, FOLDER))?.session.id).toBe('s1')
    await advance(5000)
    const s2 = session('s2', (l) => l.prompt('two'))
    await advance(9000) // s1 quiet for 14 s
    expect(a.send.mock.calls.map((c) => c[1]?.session.id)).not.toContain('s2')
    await advance(2000) // 16 s
    expect(lastSent(a)).toMatchObject({ session: { id: 's2' }, following: 'newest' })
    // Two Claude sessions in one folder don't flip-flop: while s2 keeps writing, s1 being the
    // newer log doesn't take over.
    const switched = a.send.mock.calls.length
    for (let i = 0; i < 4; i++) {
      write(s2, (l) => l.reply(`s2 step ${i}`, { stopReason: 'tool_use' }))
      await advance(1000)
      write(s1, (l) => l.reply(`s1 step ${i}`, { stopReason: 'tool_use' }))
      await advance(4000)
    }
    expect(a.send.mock.calls.slice(switched - 1).map((c) => c[1]?.session.id)).toEqual(
      Array(a.send.mock.calls.length - switched + 1).fill('s2'))
    await advance(16_000) // s2 quiet now
    expect(lastSent(a)?.session.id).toBe('s1')
  })

  it('a write the rescan sees (no file event) counts as activity of the followed session', async () => {
    const { hub, session, write, client, advance } = setup()
    const s1 = session('s1', (l) => l.prompt('one'))
    const a = client(1)
    await hub.subscribe(a, FOLDER)
    await advance(5000)
    const s2 = session('s2', (l) => l.prompt('two'))
    await advance(9000) // the rescan at 14 s: s1 quiet for 14 s
    await advance(1000)
    write(s1, (l) => l.reply('still here', { stopReason: 'tool_use' })) // 15 s
    await advance(500)
    write(s2, (l) => l.reply('newer still', { stopReason: 'tool_use' }))
    await advance(500) // the rescan at 16 s: s2 newest, s1 written 1 s ago
    expect(a.send.mock.calls.map((c) => c[1]?.session.id)).not.toContain('s2')
    expect(lastSent(a)?.feed.at(-1)).toEqual({ kind: 'reply', text: 'still here' })
  })

  it('follow(id) pins a session; follow(null) goes back to the newest at once', async () => {
    const { hub, session, write, client, advance } = setup()
    const s1 = session('s1', (l) => l.customTitle('Older'))
    await advance(1000)
    const s2 = session('s2', (l) => l.prompt('newer'))
    const a = client(1)
    expect((await hub.subscribe(a, FOLDER))?.session.id).toBe('s2')

    await hub.follow(FOLDER, 's1')
    expect(lastSent(a)).toMatchObject({ session: { id: 's1', title: 'Older' }, following: 'pinned' })
    write(s2, (l) => l.reply('more', { stopReason: 'tool_use' }))
    await advance(30_000)
    expect(lastSent(a)?.session.id).toBe('s1')

    write(s1, (l) => l.prompt('busy'))
    await advance(1000)
    write(s2, (l) => l.reply('newest again', { stopReason: 'tool_use' }))
    await hub.follow(FOLDER, null) // s1 was written 1 s ago, and still follow(null) switches now

    expect(lastSent(a)).toMatchObject({ session: { id: 's2' }, following: 'newest' })

    const sent = a.send.mock.calls.length
    await hub.follow(FOLDER, 'unknown-session') // not one of the folder's sessions: nothing changes
    await hub.follow(resolve(sep, 'not', 'subscribed'), 's1')
    expect(a.send).toHaveBeenCalledTimes(sent)
  })

  it("a pin is the tab's: subscribing with it keeps it; without it (another tab, a new one) the newest", async () => {
    const { hub, session, client, advance } = setup()
    session('s1', (l) => l.prompt('older'))
    await advance(1000)
    session('s2', (l) => l.prompt('newer'))
    const app = client(1)
    await hub.subscribe(app, FOLDER)
    await hub.follow(FOLDER, 's1')
    expect(lastSent(app)).toMatchObject({ session: { id: 's1' }, following: 'pinned' })
    hub.unsubscribe(1, FOLDER)
    expect(await hub.subscribe(app, FOLDER)).toMatchObject({ session: { id: 's2' }, following: 'newest' })
    hub.unsubscribe(1, FOLDER)
    await advance(60_000) // however quiet it is
    expect(await hub.subscribe(app, FOLDER, { sessionId: 's1', pinned: true })).toMatchObject({ session: { id: 's1' }, following: 'pinned' })
    await advance(30_000)
    expect(lastSent(app)?.session.id).toBe('s1') // no push of s2 since
  })

  it("two tabs in one folder, both running Claude: switching shows each tab's session, not the newest", async () => {
    const { hub, session, write, client, advance } = setup()
    const a = session('a', (l) => l.prompt('in tab A'))
    const b = session('b', (l) => l.prompt('in tab B'))
    const app = client(1)
    const show = async (sessionId: string) => {
      hub.unsubscribe(1, FOLDER) // the tab switched from
      return hub.subscribe(app, FOLDER, { sessionId, pinned: false })
    }
    expect((await hub.subscribe(app, FOLDER, { sessionId: 'a', pinned: false }))?.session.id).toBe('a')
    for (let i = 0; i < 3; i++) {
      await advance(3000)
      write(a, (l) => l.reply(`a${i}`, { stopReason: 'tool_use' })) // a is the newest
      expect(await show('b')).toMatchObject({ session: { id: 'b' }, following: 'newest' }) // written 3 s ago
      await advance(3000)
      write(b, (l) => l.reply(`b${i}`, { stopReason: 'tool_use' })) // b is the newest
      expect((await show('a'))?.session.id).toBe('a')
    }
    // Still the 15 s rule: once a has been quiet that long, the newest takes over.
    await advance(16_000)
    expect(lastSent(app)?.session.id).toBe('b')
  })

  it('a resumed session that is not, or no longer, one of the folder\'s: the newest', async () => {
    const { hub, deps, session, client, advance } = setup()
    session('s1', (l) => l.prompt('older'))
    await advance(1000)
    session('s2', (l) => l.prompt('newer'))
    const scan = vi.mocked(deps.scan).getMockImplementation()!
    vi.mocked(deps.scan).mockImplementation(async (folder) => {
      const r = await scan(folder)
      return { ...r, sessions: r.sessions.filter((s) => s.id !== 's1') } // s1.jsonl deleted
    })
    const app = client(1)
    for (const sessionId of ['s1', 'another-folders-session']) {
      for (const pinned of [true, false]) {
        expect(await hub.subscribe(app, FOLDER, { sessionId, pinned })).toMatchObject({ session: { id: 's2' }, following: 'newest' })
        hub.unsubscribe(1, FOLDER)
      }
    }
  })

  it('a subscribe sets the follow state of a folder that is watched already, and opens that log', async () => {
    const { hub, session, write, client, advance } = setup()
    const s1 = session('s1', (l) => l.prompt('older'))
    await advance(1000)
    session('s2', (l) => l.prompt('newer'))
    const a = client(1)
    const b = client(2)
    expect((await hub.subscribe(a, FOLDER))?.session.id).toBe('s2')
    write(s1, (l) => l.reply('busy', { stopReason: 'tool_use' })) // newest now, but b resumes it unpinned anyway
    await advance(1000)
    expect(await hub.subscribe(b, FOLDER, { sessionId: 's1', pinned: false })).toMatchObject({
      session: { id: 's1' }, following: 'newest', feed: [{ kind: 'prompt', text: 'older' }, { kind: 'reply', text: 'busy' }],
    })
    expect(lastSent(a)?.session.id).toBe('s1') // only the active tab subscribes: the latest wins
    hub.unsubscribe(2, FOLDER)
    expect(await hub.subscribe(b, FOLDER, { sessionId: 's2', pinned: true })).toMatchObject({ session: { id: 's2' }, following: 'pinned' })
  })

  it("follow() wins over a subscribe's resume that hasn't been applied yet", async () => {
    const { hub, deps, session, client, advance } = setup()
    session('s1', (l) => l.prompt('older'))
    await advance(1000)
    session('s2', (l) => l.prompt('newer'))
    let open!: () => void
    const gate = new Promise<void>((resolve) => (open = resolve))
    const scan = vi.mocked(deps.scan).getMockImplementation()!
    vi.mocked(deps.scan).mockImplementationOnce(async (folder) => {
      await gate
      return scan(folder)
    })
    const subscribed = hub.subscribe(client(1), FOLDER, { sessionId: 's1', pinned: true })
    const followed = hub.follow(FOLDER, null) // e.g. Claude started in the tab while its scan ran
    open()
    await followed
    expect(await subscribed).toMatchObject({ session: { id: 's2' }, following: 'newest' })
  })

  // A scan that misses the followed log (deleted, or a read that failed for a moment) doesn't switch
  // at once: like any followed session, it gives way once it has been quiet for 15 s.
  it('a pinned session whose log is deleted is unpinned; the newest takes over once it has been quiet', async () => {
    const { hub, session, remove, client, advance } = setup()
    const s1 = session('s1', (l) => l.prompt('older'))
    await advance(1000)
    session('s2', (l) => l.prompt('newer'))
    const a = client(1)
    await hub.subscribe(a, FOLDER, { sessionId: 's1', pinned: true })
    remove(s1)
    await advance(2000)
    expect(lastSent(a)).toMatchObject({ session: { id: 's1' }, following: 'newest' })
    await advance(14_000) // the rescan after s1 has been quiet for more than 15 s
    expect(lastSent(a)).toMatchObject({ session: { id: 's2' }, following: 'newest' })
  })

  it('a followed (not pinned) log that is deleted: the newest takes over once it has been quiet', async () => {
    const { hub, session, remove, client, advance } = setup()
    session('s1', (l) => l.prompt('older'))
    await advance(1000)
    const s2 = session('s2', (l) => l.prompt('newest, then deleted'))
    const a = client(1)
    expect((await hub.subscribe(a, FOLDER))?.session.id).toBe('s2')
    remove(s2)
    await advance(14_000)
    expect(a.send).not.toHaveBeenCalled() // reading the deleted log changed nothing
    await advance(2000)
    expect(lastSent(a)).toMatchObject({ session: { id: 's1' }, following: 'newest', feed: [{ kind: 'prompt', text: 'older' }] })
  })

  it('a long log is read in chunks, to its end, before the snapshot', async () => {
    const { hub, session, client, reads, chunk } = setup()
    session('s1', (l) => l.prompt('go').toolUse('t1', 'Bash', { command: 'ls' }).toolResult('t1').reply('done'))
    chunk.entries = 3 // 4 entries: two reads
    expect(await hub.subscribe(client(1), FOLDER)).toMatchObject({
      status: { state: 'idle' },
      feed: [
        { kind: 'prompt', text: 'go' },
        { kind: 'tool', id: 't1', name: 'Bash', summary: 'ls', state: 'done' },
        { kind: 'reply', text: 'done' },
      ],
    })
    expect(reads.count).toBe(2)
    expect(reads.maxBytes).toEqual([TIMING.chunkBytes, TIMING.chunkBytes])
  })

  it('a rewritten log is parsed again from the start', async () => {
    const { hub, session, rewrite, change, client } = setup()
    const s1 = session('s1', (l) => l.prompt('first version').reply('one'))
    const a = client(1)
    expect((await hub.subscribe(a, FOLDER))?.feed).toHaveLength(2)
    rewrite(s1, (l) => l.prompt('second'))
    await change(basename(s1.path))
    expect(lastSent(a)).toMatchObject({ status: { state: 'working' }, feed: [{ kind: 'prompt', text: 'second' }] })
  })

  it('a run asked for just as the previous one ends is not dropped', async () => {
    const { hub, session, change, client, advance } = setup()
    const s1 = session('s1', (l) => l.customTitle('Older'))
    await advance(1000)
    session('s2', (l) => l.prompt('newer'))
    const a = client(1)
    await hub.subscribe(a, FOLDER, { sessionId: 's1', pinned: true })
    // The push ends an update; two microtasks later its loop has ended, and before the fix the
    // promise still counted as running for one more: this follow(null) was dropped.
    let followed: Promise<void> | undefined
    a.send.mockImplementationOnce(() => {
      queueMicrotask(() => queueMicrotask(() => {
        followed = hub.follow(FOLDER, null)
      }))
    })
    s1.prompt('busy') // read, but s2 stays the newest
    await change(basename(s1.path))
    expect(followed).toBeDefined()
    await followed
    expect(lastSent(a)).toMatchObject({ session: { id: 's2' }, following: 'newest' })
  })

  it('the status tick pushes maybe-waiting without a log change, and reads no files', async () => {
    const { hub, deps, session, client, advance, reads } = setup()
    session('s1', (l) => l.prompt('go').toolUse('t1', 'Bash', { command: 'rm -rf build' }))
    const a = client(1)
    expect((await hub.subscribe(a, FOLDER))?.status).toMatchObject({ state: 'tool', detail: 'Bash' })
    await advance(8000)
    expect(a.send).not.toHaveBeenCalled()
    const scans = vi.mocked(deps.scan).mock.calls.length
    const read = reads.count
    await advance(1000) // a tick (no rescan at 9 s): 9 s of silence
    expect(lastSent(a)?.status).toEqual({ state: 'maybe-waiting', detail: 'Bash', agents: 0, background: 0 })
    expect(vi.mocked(deps.scan).mock.calls.length).toBe(scans)
    expect(reads.count).toBe(read)
  })

  it('a turn silent for over 10 minutes turns quiet', async () => {
    const { hub, session, client, advance } = setup()
    session('s1', (l) => l.prompt('go').reply('thinking aloud', { stopReason: 'tool_use' }))
    const a = client(1)
    await hub.subscribe(a, FOLDER)
    await advance(600_000)
    expect(a.send).not.toHaveBeenCalled()
    await advance(1000)
    expect(lastSent(a)?.status.state).toBe('quiet')
  })

  it('pushes nothing while nothing changes', async () => {
    const { hub, session, change, client, advance } = setup()
    const s1 = session('s1', (l) => l.prompt('go').reply('done'))
    const a = client(1)
    await hub.subscribe(a, FOLDER)
    await advance(30_000)
    await change(basename(s1.path))
    await change(null)
    expect(a.send).not.toHaveBeenCalled()
  })

  it("running agents' steps are refreshed with the rescan and pushed; finished agents aren't asked for", async () => {
    const { hub, deps, session, write, change, client, advance, steps } = setup()
    const s1 = session('s1', (l) => l.prompt('go')
      .toolUse('t1', 'Agent', { subagent_type: 'Explore', description: 'look' })
      .toolResult('t1', { toolUseResult: { status: 'async_launched', agentId: 'ag1' } }))
    const a = client(1)
    expect((await hub.subscribe(a, FOLDER))?.agents).toEqual([
      { toolUseId: 't1', type: 'Explore', description: 'look', done: false, failed: false },
    ])
    steps.set('t1', 'Grep: parser')
    await advance(2000)
    expect(lastSent(a)?.agents[0].step).toBe('Grep: parser')
    write(s1, (l) => l.notification({ taskId: 'ag1', toolUseId: 't1', status: 'completed', summary: 'Done' }))
    await change(basename(s1.path))
    expect(lastSent(a)?.agents[0]).toEqual({ toolUseId: 't1', type: 'Explore', description: 'look', done: true, failed: false })
    const calls = vi.mocked(deps.steps).mock.calls.length
    await advance(10_000)
    expect(vi.mocked(deps.steps).mock.calls.length).toBe(calls)
  })

  it('keeps parsed sessions: switching back reads only what was added, and at most 4 unused ones stay', async () => {
    const { hub, session, client, advance, opened } = setup()
    const logs: LogWriter[] = []
    for (let i = 0; i < 6; i++) {
      logs.push(session(`s${i}`, (l) => l.prompt(`prompt ${i}`)))
      await advance(1000)
    }
    const a = client(1)
    await hub.subscribe(a, FOLDER) // s5, the newest
    for (const log of [logs[0], logs[1], logs[0]]) await hub.follow(FOLDER, log.sessionId)
    expect(opened.filter((p) => p === logs[0].path)).toHaveLength(1)
    for (const log of logs.slice(1)) await hub.follow(FOLDER, log.sessionId)
    // Followed since s0: s1, s2, s3, s4 (unused, cached) and s5 (followed). s0 was dropped.
    await hub.follow(FOLDER, logs[4].sessionId)
    await hub.follow(FOLDER, logs[1].sessionId)
    expect(opened.filter((p) => p === logs[1].path)).toHaveLength(1)
    await hub.follow(FOLDER, logs[0].sessionId)
    expect(opened.filter((p) => p === logs[0].path)).toHaveLength(2)
    expect(lastSent(a)?.feed).toEqual([{ kind: 'prompt', text: 'prompt 0' }])
  })

  it('counts subscriptions per client and folder; the last one leaving stops watching and timers', async () => {
    const { hub, deps, session, write, change, client, advance, watching } = setup()
    const s1 = session('s1', (l) => l.prompt('go'))
    const a = client(1)
    const b = client(2)
    await hub.subscribe(a, FOLDER)
    await hub.subscribe(a, FOLDER)
    await hub.subscribe(b, FOLDER)
    expect(deps.watch).toHaveBeenCalledTimes(1)
    hub.unsubscribe(1, FOLDER)
    hub.unsubscribe(2, FOLDER)
    write(s1, (l) => l.reply('x', { stopReason: 'tool_use' }))
    await change(basename(s1.path))
    expect(a.send).toHaveBeenCalledTimes(1)
    expect(b.send).not.toHaveBeenCalled()
    hub.unsubscribe(1, FOLDER)
    expect(watching()).toBe(0)
    const scans = vi.mocked(deps.scan).mock.calls.length
    await advance(20_000)
    expect(vi.mocked(deps.scan).mock.calls.length).toBe(scans)
    hub.unsubscribe(1, FOLDER) // one too many: ignored
  })

  it('drop() removes everything a client subscribed to', async () => {
    const { hub, session, write, change, client, watching } = setup()
    const s1 = session('s1', (l) => l.prompt('go'))
    const other = resolve(sep, 'Users', 'me', 'other')
    const a = client(1)
    const b = client(2)
    await hub.subscribe(a, FOLDER)
    await hub.subscribe(a, other)
    await hub.subscribe(b, FOLDER)
    hub.drop(1)
    write(s1, (l) => l.reply('x', { stopReason: 'tool_use' }))
    await change(basename(s1.path))
    expect(a.send).not.toHaveBeenCalled()
    expect(b.send).toHaveBeenCalledTimes(1)
    hub.drop(2)
    expect(watching()).toBe(0)
  })

  it('an unsubscribe that overtakes its subscribe leaves nothing running', async () => {
    const { hub, deps, session, client, watching, advance } = setup()
    session('s1', (l) => l.prompt('go'))
    let open!: () => void
    const gate = new Promise<void>((resolve) => (open = resolve))
    const scan = deps.scan
    vi.mocked(deps.scan).mockImplementationOnce(async (folder) => {
      await gate
      return vi.mocked(scan).getMockImplementation()!(folder)
    })
    const pending = hub.subscribe(client(1), FOLDER)
    hub.unsubscribe(1, FOLDER)
    open()
    expect((await pending)?.session.id).toBe('s1') // the caller still gets an answer
    expect(watching()).toBe(0)
    const scans = vi.mocked(deps.scan).mock.calls.length
    await advance(10_000)
    expect(vi.mocked(deps.scan).mock.calls.length).toBe(scans)
  })

  it('one client failing to receive does not stop the others', async () => {
    const { hub, session, write, change, client } = setup()
    const s1 = session('s1', (l) => l.prompt('go'))
    const broken = client(1)
    broken.send.mockImplementation(() => {
      throw new Error('render frame disposed')
    })
    const ok = client(2)
    await hub.subscribe(broken, FOLDER)
    await hub.subscribe(ok, FOLDER)
    write(s1, (l) => l.reply('x'))
    await change(basename(s1.path))
    expect(ok.send).toHaveBeenCalledTimes(1)
  })

  it("sessions(): the folder's sessions newest first, titled from the parsed state or the log", async () => {
    const { hub, deps, session, client, advance } = setup()
    session('s1', (l) => l.prompt('older'))
    await advance(1000)
    session('s2', (l) => l.prompt('followed one'))
    await hub.subscribe(client(1), FOLDER)
    expect(await hub.sessions(FOLDER)).toEqual([
      { id: 's2', path: expect.stringContaining('s2.jsonl'), title: 'followed one', modified: T0 + 1000 },
      { id: 's1', path: expect.stringContaining('s1.jsonl'), title: 'title of s1', modified: T0 },
    ])
    expect(deps.title).toHaveBeenCalledTimes(1)
  })

  it("imageSource(): an image of the followed session is found in its log's line, and only there", async () => {
    const { hub, session, write, change, client } = setup()
    const shot = pngBytes(12, 8)
    const id = imageId(Buffer.from(shot).toString('base64'))
    const s1 = session('s1', (l) => l.prompt('first'))
    await hub.subscribe(client(1), FOLDER)
    expect(hub.imageSource(FOLDER, id)).toBeNull()
    write(s1, (l) => l.prompt('look', { images: [shot] }))
    await change(basename(s1.path))
    const source = hub.imageSource(FOLDER, id)
    expect(source).toMatchObject({ path: s1.path, bytes: shot.length })
    const line = readFileSync(s1.path).toString('utf8', source!.offset, source!.offset + source!.length)
    expect(JSON.parse(line)).toMatchObject({ message: { content: [{ type: 'image' }, { type: 'text', text: 'look' }] } })
    expect(hub.imageSource(FOLDER, '0123456789abcdef')).toBeNull()
    expect(hub.imageSource(resolve(sep, 'Users', 'me', 'other'), id)).toBeNull()
    hub.unsubscribe(1, FOLDER)
    expect(hub.imageSource(FOLDER, id)).toBeNull() // nobody follows the folder now
  })

  it('settled(): an image asked for while a subscribe is still reading the log is found once it has', async () => {
    const { hub, deps, session, client } = setup()
    const shot = pngBytes(12, 8)
    const id = imageId(Buffer.from(shot).toString('base64'))
    session('s1', (l) => l.prompt('look', { images: [shot] }))
    await hub.settled(FOLDER) // nobody follows the folder: at once
    const subscribed = hub.subscribe(client(1), FOLDER) // a tab coming back to the front
    expect(hub.imageSource(FOLDER, id)).toBeNull() // its log isn't open yet
    await hub.settled(FOLDER)
    expect(hub.imageSource(FOLDER, id)).toMatchObject({ bytes: shot.length })
    await subscribed
    hub.unsubscribe(1, FOLDER)
    // A first update that fails still settles, and never rejects.
    vi.mocked(deps.scan).mockRejectedValueOnce(new Error('EIO'))
    const failing = hub.subscribe(client(2), FOLDER)
    await expect(hub.settled(FOLDER)).resolves.toBeUndefined()
    expect(hub.imageSource(FOLDER, id)).toBeNull()
    await failing
    hub.unsubscribe(2, FOLDER)
  })

  it('imageSource(): a rewritten log gives the same image its new place', async () => {
    const { hub, session, rewrite, change, client } = setup()
    const shot = pngBytes(12, 8)
    const id = imageId(Buffer.from(shot).toString('base64'))
    const s1 = session('s1', (l) => l.prompt('before').prompt('look', { images: [shot] }))
    await hub.subscribe(client(1), FOLDER)
    expect(hub.imageSource(FOLDER, id)?.offset).toBe(readLines(s1.path)[1].offset)
    rewrite(s1, (l) => l.prompt('look', { images: [shot] })) // shorter: parsed again from the start
    await change(basename(s1.path))
    expect(hub.imageSource(FOLDER, id)).toMatchObject({ offset: 0, length: readLines(s1.path)[0].length })
  })

  it('a scan that fails keeps what it had', async () => {
    const { hub, deps, session, client, advance } = setup()
    session('s1', (l) => l.prompt('go'))
    const a = client(1)
    await hub.subscribe(a, FOLDER)
    vi.mocked(deps.scan).mockRejectedValue(new Error('EACCES'))
    await advance(10_000)
    expect(a.send).not.toHaveBeenCalled()
    expect(await hub.sessions(FOLDER)).toEqual([])
  })
})
