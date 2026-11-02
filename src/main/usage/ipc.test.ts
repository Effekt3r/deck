import { EventEmitter } from 'node:events'
import { mkdirSync, mkdtempSync, readFileSync, renameSync, rmSync, writeFileSync } from 'node:fs'
import { tmpdir } from 'node:os'
import { join } from 'node:path'
import { afterAll, describe, expect, it, vi } from 'vitest'
import { IPC } from '@shared/channels'
import type { UsageChange, UsageState } from '@shared/types'
import type { BrowserWindow } from 'electron'
import { registerUsageIpc } from './ipc'
import { statusLineCommand } from './statusline'

const ipc = vi.hoisted(() => ({ handlers: new Map<string, (...args: unknown[]) => unknown>() }))
vi.mock('electron', () => ({
  ipcMain: {
    handle: (channel: string, fn: (...args: unknown[]) => unknown) => ipc.handlers.set(channel, fn),
  },
}))

const root = mkdtempSync(join(tmpdir(), 'deck-usage-ipc-'))
afterAll(() => rmSync(root, { recursive: true, force: true }))
let n = 0

/** Deck's usage folder and a Claude settings file holding `settings`. */
function setup(settings: string) {
  const base = join(root, String(++n))
  mkdirSync(join(base, 'claude'), { recursive: true })
  const settingsFile = join(base, 'claude', 'settings.json')
  writeFileSync(settingsFile, settings)
  return { dir: join(base, 'usage'), settingsFile }
}

/** A window that records the states it's sent. */
function fakeWindow() {
  const sent: UsageState[] = []
  const win = Object.assign(new EventEmitter(), {
    isDestroyed: () => false,
    webContents: { isDestroyed: () => false, send: (_channel: string, state: UsageState) => sent.push(state) },
  })
  return { win: win as unknown as BrowserWindow, sent }
}

const call = <T>(channel: string, ...args: unknown[]) => ipc.handlers.get(channel)!({}, ...args) as Promise<T>

describe('registerUsageIpc', () => {
  it('connects, picks up a report Claude Code writes, and disconnects', async () => {
    const { dir, settingsFile } = setup('{"model":"opus"}')
    const usage = registerUsageIpc({ dir, settingsFile, platform: 'darwin' })
    const { win, sent } = fakeWindow()
    usage.attach(win)
    try {
      expect(await call<UsageState>(IPC.usageGet)).toEqual({
        link: { state: 'off' }, settingsFile, fiveHour: null, sevenDay: null, updatedAt: null,
      })

      expect(await call<UsageChange>(IPC.usageConnect, false)).toMatchObject({ state: { link: { state: 'connected' } } })
      expect(JSON.parse(readFileSync(settingsFile, 'utf8')).statusLine)
        .toEqual({ type: 'command', command: statusLineCommand('darwin', dir) })

      // What the status line script does with each report:
      writeFileSync(join(dir, '.statusline.1.tmp'), JSON.stringify({ rate_limits: { seven_day: { used_percentage: 85, resets_at: 1_793_653_200 } } }))
      renameSync(join(dir, '.statusline.1.tmp'), join(dir, 'statusline.json'))
      await vi.waitFor(() => expect(sent.at(-1)?.sevenDay).toEqual({ usedPercentage: 85, resetsAt: 1_793_653_200_000 }), { timeout: 3000 })

      expect(await call<UsageChange>(IPC.usageDisconnect)).toMatchObject({ state: { link: { state: 'off' }, sevenDay: { usedPercentage: 85 } } })
      expect(JSON.parse(readFileSync(settingsFile, 'utf8'))).toEqual({ model: 'opus' })
    } finally {
      usage.dispose()
    }
  })

  it("shows settings it can't read as an error, and Connect fails without writing", async () => {
    const { dir, settingsFile } = setup('{ broken')
    const usage = registerUsageIpc({ dir, settingsFile, platform: 'darwin' })
    usage.attach(fakeWindow().win)
    try {
      expect((await call<UsageState>(IPC.usageGet)).link.state).toBe('error')
      expect(await call<UsageChange>(IPC.usageConnect, true)).toEqual({ error: expect.stringContaining('leaves it alone') })
      expect(readFileSync(settingsFile, 'utf8')).toBe('{ broken')
    } finally {
      usage.dispose()
    }
  })
})
