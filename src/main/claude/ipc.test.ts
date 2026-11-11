import { EventEmitter } from 'node:events'
import { afterAll, beforeAll, describe, expect, it, vi } from 'vitest'
import { IPC } from '@shared/channels'
import type { ClaudeImage, ClaudeSessionSummary, ClaudeSnapshot } from '@shared/types'
import { registerClaudeIpc } from './ipc'
import { gifBytes, makeClaudeHome, makeFolder, pngBytes, removeClaudeHomes, sessionLog } from './test-log'

const ipc = vi.hoisted(() => ({
  handlers: new Map<string, (...args: unknown[]) => unknown>(),
  listeners: new Map<string, (...args: unknown[]) => void>(),
}))
vi.mock('electron', () => ({
  ipcMain: {
    handle: (channel: string, fn: (...args: unknown[]) => unknown) => ipc.handlers.set(channel, fn),
    on: (channel: string, fn: (...args: unknown[]) => void) => ipc.listeners.set(channel, fn),
  },
  // These tests' images are small enough to be their own thumbnails: nothing is decoded or opened.
  nativeImage: {
    createFromBuffer: () => {
      throw new Error('nothing is decoded in these tests')
    },
  },
  shell: {
    openPath: async () => {
      throw new Error('tests pass their own openPath')
    },
  },
}))
/** Open's copies and what it opened: saveImage and openPath, as main/index.ts passes them. */
const open = vi.hoisted(() => ({
  saved: [] as { bytes: Uint8Array; ext: string }[],
  opened: [] as string[],
  saveFails: false,
  problem: '',
}))

let nextId = 1
/** The parts of WebContents the Claude IPC uses. */
class FakeContents extends EventEmitter {
  readonly id = nextId++
  readonly sent: [channel: string, folder: string, snapshot: ClaudeSnapshot | null][] = []
  send(channel: string, folder: string, snapshot: ClaudeSnapshot | null) {
    this.sent.push([channel, folder, snapshot])
  }
  isDestroyed() {
    return false
  }
}

const invoke = async (wc: FakeContents, channel: string, ...args: unknown[]) => ipc.handlers.get(channel)?.({ sender: wc }, ...args)
const emit = (wc: FakeContents, channel: string, ...args: unknown[]) => ipc.listeners.get(channel)?.({ sender: wc }, ...args)
const sleep = (ms: number) => new Promise((r) => setTimeout(r, ms))
const lastPush = (wc: FakeContents) => wc.sent.at(-1)?.[2]
const wait = { timeout: 4000, interval: 50 }

let home = ''
beforeAll(() => {
  home = makeClaudeHome()
  registerClaudeIpc({
    env: { CLAUDE_CONFIG_DIR: home },
    saveImage: async (bytes, ext) => {
      if (open.saveFails) throw new Error('ENOSPC: no space left on device')
      open.saved.push({ bytes, ext })
      return `/tmp/Deck clipboard/x/image-0123456789abcdef.${ext}`
    },
    openPath: async (path) => {
      open.opened.push(path)
      return open.problem
    },
  })
})
afterAll(removeClaudeHomes)

describe('claude IPC', () => {
  it('answers bad arguments with null, [] or nothing, never a throw', async () => {
    const wc = new FakeContents()
    for (const bad of [undefined, 42, '', 'relative/path', {}, ['/x'], `/${'x'.repeat(5000)}`]) {
      expect(await invoke(wc, IPC.claudeSubscribe, bad)).toBeNull()
      expect(() => emit(wc, IPC.claudeUnsubscribe, bad)).not.toThrow()
      expect(await invoke(wc, IPC.claudeSessions, bad)).toEqual([])
      expect(await invoke(wc, IPC.claudeFollow, bad, null)).toBeUndefined()
    }
    const folder = makeFolder()
    sessionLog(home, folder).prompt('hi')
    await invoke(wc, IPC.claudeSubscribe, folder)
    for (const id of [42, '', '../x', 'a/b', 'a\\b', 'x'.repeat(300), {}, undefined]) {
      expect(await invoke(wc, IPC.claudeFollow, folder, id)).toBeUndefined()
    }
    expect(lastPush(wc)).toBeUndefined() // nothing was switched
    emit(wc, IPC.claudeUnsubscribe, folder)
  })

  it('subscribe resumes the session a tab showed; a malformed resume counts as none (the newest)', async () => {
    const folder = makeFolder()
    const older = sessionLog(home, folder).aiTitle('Older').touch(Date.now() - 60_000)
    const newest = sessionLog(home, folder).prompt('Newest')
    const wc = new FakeContents()
    for (const bad of [42, 'x', [], { sessionId: older.sessionId }, { sessionId: '../x', pinned: true },
      { sessionId: older.sessionId, pinned: 'yes' }, { sessionId: 7, pinned: true }]) {
      expect(await invoke(wc, IPC.claudeSubscribe, folder, bad)).toMatchObject({ session: { id: newest.sessionId }, following: 'newest' })
      emit(wc, IPC.claudeUnsubscribe, folder)
    }
    expect(await invoke(wc, IPC.claudeSubscribe, folder, { sessionId: older.sessionId, pinned: true, extra: 1 })).toMatchObject({
      session: { id: older.sessionId, title: 'Older' }, following: 'pinned',
    })
    emit(wc, IPC.claudeUnsubscribe, folder)
  })

  it('subscribes, pushes what Claude appends, lists sessions, pins and unpins, stops after unsubscribe', async () => {
    const folder = makeFolder()
    const log = sessionLog(home, folder).prompt('Hello there')
    const wc = new FakeContents()
    expect(await invoke(wc, IPC.claudeSubscribe, folder)).toMatchObject({
      session: { id: log.sessionId, path: log.path, title: 'Hello there' }, status: { state: 'working' }, following: 'newest',
    })

    log.toolUse('t1', 'Bash', { command: 'ls', description: 'List files' })
    await vi.waitFor(() => expect(lastPush(wc)?.status).toMatchObject({ state: 'tool', detail: 'Bash' }), wait)
    expect(wc.sent.at(-1)?.slice(0, 2)).toEqual([IPC.claudeUpdate, folder])

    const older = sessionLog(home, folder).aiTitle('An older session').touch(Date.now() - 60_000)
    const sessions = (await invoke(wc, IPC.claudeSessions, folder)) as ClaudeSessionSummary[]
    expect(sessions.map((s) => [s.id, s.title])).toEqual([[log.sessionId, 'Hello there'], [older.sessionId, 'An older session']])

    await invoke(wc, IPC.claudeFollow, folder, older.sessionId)
    expect(lastPush(wc)).toMatchObject({ session: { id: older.sessionId, title: 'An older session' }, following: 'pinned' })
    await invoke(wc, IPC.claudeFollow, folder, null)
    expect(lastPush(wc)).toMatchObject({ session: { id: log.sessionId }, following: 'newest' })

    const pushes = wc.sent.length
    emit(wc, IPC.claudeUnsubscribe, folder)
    log.reply('more')
    await sleep(2500)
    expect(wc.sent).toHaveLength(pushes)
  }, 15_000)

  it('a session that starts after subscribing is pushed', async () => {
    const folder = makeFolder()
    const wc = new FakeContents()
    expect(await invoke(wc, IPC.claudeSubscribe, folder)).toBeNull()
    const log = sessionLog(home, folder).permissionMode('bypassPermissions')
    await vi.waitFor(() => expect(lastPush(wc)).toMatchObject({ session: { id: log.sessionId, mode: 'bypassPermissions' } }), wait)
    emit(wc, IPC.claudeUnsubscribe, folder)
  }, 10_000)

  it('claude:image answers bad arguments with an error, never a throw', async () => {
    const wc = new FakeContents()
    const folder = makeFolder()
    sessionLog(home, folder).prompt('look', { images: [pngBytes(8, 8)] })
    const snapshot = (await invoke(wc, IPC.claudeSubscribe, folder)) as ClaudeSnapshot
    const id = (snapshot.feed[0] as { images: ClaudeImage[] }).images[0].id
    const gone = { error: 'No longer in the session log' }
    for (const [f, i, size] of [
      [undefined, id, 'thumb'], ['relative', id, 'thumb'], [folder, undefined, 'thumb'], [folder, id.toUpperCase(), 'thumb'],
      [folder, id.slice(1), 'thumb'], [folder, `${id}0`, 'thumb'], [folder, '../../etc/passwd', 'full'], [folder, 42, 'full'],
      [folder, id, 'huge'], [folder, id, undefined], [folder, { id }, 'thumb'],
    ]) {
      expect(await invoke(wc, IPC.claudeImage, f, i, size)).toEqual(gone)
    }
    for (const [f, i] of [[undefined, id], [folder, 'abc'], [42, id]]) expect(await invoke(wc, IPC.claudeOpenImage, f, i)).toEqual(gone)
    emit(wc, IPC.claudeUnsubscribe, folder)
  })

  it("claude:image reads an image the followed session lists from its line; anything else is gone", async () => {
    const wc = new FakeContents()
    const folder = makeFolder()
    const png = pngBytes(64, 48)
    const gif = gifBytes(20, 10)
    sessionLog(home, folder).prompt('look', { images: [png, gif], pasteIds: [1, 2] })
    const snapshot = (await invoke(wc, IPC.claudeSubscribe, folder)) as ClaudeSnapshot
    const [pngRef, gifRef] = (snapshot.feed[0] as { images: ClaudeImage[] }).images
    expect([pngRef, gifRef].map((r) => [r.format, r.paste])).toEqual([['png', 1], ['gif', 2]])
    const url = `data:image/png;base64,${Buffer.from(png).toString('base64')}`
    expect(await invoke(wc, IPC.claudeImage, folder, pngRef.id, 'thumb')).toEqual({ url })
    expect(await invoke(wc, IPC.claudeImage, folder, pngRef.id, 'full')).toEqual({ url })
    expect(await invoke(wc, IPC.claudeImage, folder, gifRef.id, 'thumb')).toEqual({ url: `data:image/gif;base64,${Buffer.from(gif).toString('base64')}` })
    expect(await invoke(wc, IPC.claudeImage, folder, '0123456789abcdef', 'thumb')).toEqual({ error: 'No longer in the session log' })
    expect(await invoke(wc, IPC.claudeImage, makeFolder(), pngRef.id, 'thumb')).toEqual({ error: 'No longer in the session log' })
    emit(wc, IPC.claudeUnsubscribe, folder)
    expect(await invoke(wc, IPC.claudeImage, folder, pngRef.id, 'thumb')).toEqual({ error: 'No longer in the session log' })
  })

  it('claude:open-image saves a copy named by its format and opens it; a failure says why', async () => {
    const wc = new FakeContents()
    const folder = makeFolder()
    const png = pngBytes(30, 20)
    sessionLog(home, folder).prompt('look', { images: [png] })
    const snapshot = (await invoke(wc, IPC.claudeSubscribe, folder)) as ClaudeSnapshot
    const { id } = (snapshot.feed[0] as { images: ClaudeImage[] }).images[0]
    open.saved = []
    open.opened = []
    expect(await invoke(wc, IPC.claudeOpenImage, folder, id)).toBeNull()
    expect(open.saved).toHaveLength(1)
    expect(open.saved[0].ext).toBe('png')
    expect(Buffer.compare(Buffer.from(open.saved[0].bytes), png)).toBe(0)
    expect(open.opened).toEqual(['/tmp/Deck clipboard/x/image-0123456789abcdef.png'])
    open.problem = 'No application knows how to open this'
    expect(await invoke(wc, IPC.claudeOpenImage, folder, id)).toEqual({ error: "Couldn't open the copy: No application knows how to open this" })
    open.problem = ''
    open.saveFails = true
    expect(await invoke(wc, IPC.claudeOpenImage, folder, id)).toEqual({ error: "Couldn't save a copy to open: ENOSPC: no space left on device" })
    open.saveFails = false
    expect(await invoke(wc, IPC.claudeOpenImage, folder, '0123456789abcdef')).toEqual({ error: 'No longer in the session log' })
    emit(wc, IPC.claudeUnsubscribe, folder)
  })

  it('a destroyed or reloading webContents loses its subscriptions', async () => {
    const folder = makeFolder()
    const log = sessionLog(home, folder).prompt('go')
    const closed = new FakeContents()
    const reloaded = new FakeContents()
    const crashed = new FakeContents()
    for (const wc of [closed, reloaded, crashed]) await invoke(wc, IPC.claudeSubscribe, folder)
    closed.emit('destroyed')
    reloaded.emit('did-start-loading')
    crashed.emit('render-process-gone')
    log.reply('done')
    await sleep(2500)
    expect(closed.sent).toEqual([])
    expect(reloaded.sent).toEqual([])
    expect(crashed.sent).toEqual([])
  }, 10_000)
})
