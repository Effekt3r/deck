import { EventEmitter } from 'node:events'
import { afterAll, beforeAll, describe, expect, it, vi } from 'vitest'
import { IPC } from '@shared/channels'
import type { ClaudeSessionSummary, ClaudeSnapshot } from '@shared/types'
import { registerClaudeIpc } from './ipc'
import { makeClaudeHome, makeFolder, removeClaudeHomes, sessionLog } from './test-log'

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
  registerClaudeIpc({ env: { CLAUDE_CONFIG_DIR: home } })
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
