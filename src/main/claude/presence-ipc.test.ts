import { mkdir, mkdtemp, rm, writeFile } from 'node:fs/promises'
import { tmpdir } from 'node:os'
import { join } from 'node:path'
import { afterEach, describe, expect, it, vi } from 'vitest'
import { IPC } from '@shared/channels'
import { registerPresenceIpc } from './presence-ipc'

const ipc = vi.hoisted(() => ({ handlers: new Map<string, (...args: unknown[]) => unknown>() }))
vi.mock('electron', () => ({
  ipcMain: { handle: (channel: string, fn: (...args: unknown[]) => unknown) => ipc.handlers.set(channel, fn) },
}))

const homes: string[] = []
afterEach(async () => {
  for (const h of homes.splice(0)) await rm(h, { recursive: true, force: true })
})

describe('registerPresenceIpc', () => {
  it('answers with the running Claudes and pushes changes to the window', async () => {
    const home = await mkdtemp(join(tmpdir(), 'deck-presence-ipc-'))
    homes.push(home)
    await mkdir(join(home, 'sessions'))
    // This test's own process stands in for Claude: it's alive. 'win32' means no ps, on every platform.
    await writeFile(join(home, 'sessions', `${process.pid}.json`), JSON.stringify({ pid: process.pid, sessionId: 's1', cwd: '/w/a', status: 'busy' }))
    const presence = registerPresenceIpc({ shells: () => new Map(), env: { CLAUDE_CONFIG_DIR: home }, platform: 'win32' })
    const sent: unknown[][] = []
    presence.attach({ isDestroyed: () => false, webContents: { isDestroyed: () => false, send: (...a: unknown[]) => sent.push(a) } } as never)
    const list = await ipc.handlers.get(IPC.claudePresence)?.({})
    expect(list).toEqual([{ pid: process.pid, sessionId: 's1', cwd: '/w/a', state: 'working' }])
    expect(sent).toEqual([[IPC.claudePresenceChanged, list]])
    presence.dispose()
  })
})
