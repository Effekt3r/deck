import { EventEmitter } from 'node:events'
import { existsSync, mkdirSync, mkdtempSync, readFileSync, renameSync, rmSync, statSync, utimesSync, writeFileSync } from 'node:fs'
import { tmpdir } from 'node:os'
import { join } from 'node:path'
import { afterAll, describe, expect, it, vi } from 'vitest'
import { IPC } from '@shared/channels'
import type { UsageChange, UsageState } from '@shared/types'
import type { BrowserWindow } from 'electron'
import { registerUsageIpc } from './ipc'
import { statusLineCommand, statusLineScript } from './statusline'

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

/** What the status line script does with each report: a temp file, renamed over statusline.json. */
function writeReport(dir: string) {
  writeFileSync(join(dir, '.statusline.1.tmp'), JSON.stringify({ rate_limits: { seven_day: { used_percentage: 85, resets_at: 1_793_653_200 } } }))
  renameSync(join(dir, '.statusline.1.tmp'), join(dir, 'statusline.json'))
}

const call = <T>(channel: string, ...args: unknown[]) => ipc.handlers.get(channel)!({}, ...args) as Promise<T>
const sleep = (ms: number) => new Promise((resolve) => setTimeout(resolve, ms))

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

      // A report, once the OS watcher has settled (macOS starts it a moment after watch() returns;
      // under load a rename made at once was missed):
      await sleep(300)
      writeReport(dir)
      await vi.waitFor(() => expect(sent.at(-1)?.sevenDay).toEqual({ usedPercentage: 85, resetsAt: 1_793_653_200_000 }), { timeout: 3000 })

      // Disconnect forgets the numbers, and the last report too, which the next focus would read back in.
      expect(await call<UsageChange>(IPC.usageDisconnect)).toEqual({
        state: { link: { state: 'off' }, settingsFile, fiveHour: null, sevenDay: null, updatedAt: null },
      })
      expect(sent.at(-1)).toMatchObject({ link: { state: 'off' }, sevenDay: null, updatedAt: null })
      expect(JSON.parse(readFileSync(settingsFile, 'utf8'))).toEqual({ model: 'opus' })
      expect(existsSync(join(dir, 'statusline.json'))).toBe(false)
      await vi.waitFor(() => expect(JSON.parse(readFileSync(join(dir, 'usage.json'), 'utf8'))).toEqual({ windows: {}, updatedAt: null }))
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

  it('runs a Connect and a Disconnect asked for together one after the other', async () => {
    const original = `${JSON.stringify({ model: 'opus', theme: 'dark' }, null, 2)}\n`
    const { dir, settingsFile } = setup(original)
    const usage = registerUsageIpc({ dir, settingsFile, platform: 'darwin' })
    const { win, sent } = fakeWindow()
    usage.attach(win)
    try {
      const connecting = call<UsageChange>(IPC.usageConnect, false)
      win.emit('focus') // its look at the settings waits its turn as well
      const disconnecting = call<UsageChange>(IPC.usageDisconnect)
      expect(await connecting).toMatchObject({ state: { link: { state: 'connected' } } })
      expect(await disconnecting).toMatchObject({ state: { link: { state: 'off' } } })
      expect(readFileSync(settingsFile, 'utf8')).toBe(original)
      await vi.waitFor(() => expect(sent.at(-1)?.link).toEqual({ state: 'off' }))
    } finally {
      usage.dispose()
    }
  })

  it('still starts what it can when a start-up step fails', async () => {
    const { dir, settingsFile } = setup('{}')
    writeFileSync(settingsFile, JSON.stringify({ statusLine: { type: 'command', command: statusLineCommand('darwin', dir) } }))
    mkdirSync(join(dir, 'statusline.sh'), { recursive: true }) // so the script can't be written
    const kept = { usedPercentage: 85, resetsAt: 1_793_653_200_000 }
    writeFileSync(join(dir, 'usage.json'), JSON.stringify({ windows: { seven_day: { ...kept, seenAt: 1000 } }, updatedAt: 1000 }))
    const logged = vi.spyOn(console, 'error').mockImplementation(() => {})
    const usage = registerUsageIpc({ dir, settingsFile, platform: 'darwin' })
    try {
      expect(await call<UsageState>(IPC.usageGet)).toMatchObject({ link: { state: 'connected' }, sevenDay: kept, updatedAt: 1000 })
      expect(logged).toHaveBeenCalledWith('usage: writing the status line script failed', expect.anything())
    } finally {
      usage.dispose()
      logged.mockRestore()
    }
  })

  it('starts no watch once disposed', async () => {
    const { dir, settingsFile } = setup('{}')
    const usage = registerUsageIpc({ dir, settingsFile, platform: 'darwin' })
    const { win, sent } = fakeWindow()
    usage.attach(win)
    usage.dispose() // while start-up is still under way
    await call(IPC.usageGet) // start-up has finished
    await sleep(300) // as long as a watch takes to settle
    writeReport(dir)
    await sleep(500)
    expect(sent).toEqual([])
  })

  it('writes the script only when it changed, and by a rename, so a run under way reads it whole', async () => {
    const { dir, settingsFile } = setup('{}')
    const script = join(dir, 'statusline.sh')
    mkdirSync(dir, { recursive: true })
    writeFileSync(script, statusLineScript(dir)!)
    utimesSync(script, 1_700_000_000, 1_700_000_000)
    let usage = registerUsageIpc({ dir, settingsFile, platform: 'darwin' })
    await call(IPC.usageGet)
    usage.dispose()
    expect(statSync(script).mtimeMs).toBe(1_700_000_000_000) // the same script: left as it was

    writeFileSync(script, '#!/bin/sh\n# an older script\n')
    const older = statSync(script, { bigint: true }).ino
    usage = registerUsageIpc({ dir, settingsFile, platform: 'darwin' })
    await call(IPC.usageGet)
    usage.dispose()
    expect(readFileSync(script, 'utf8')).toBe(statusLineScript(dir))
    expect(statSync(script, { bigint: true }).ino).not.toBe(older) // a new file, renamed into place
  })
})
