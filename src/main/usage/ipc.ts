import { mkdir, writeFile } from 'node:fs/promises'
import { join } from 'node:path'
import { type BrowserWindow, ipcMain } from 'electron'
import { IPC } from '@shared/channels'
import type { Platform, UsageChange, UsageLink, UsageState } from '@shared/types'
import { connect, currentLink, disconnect } from './settings'
import { REPORT_FILE, SCRIPT_FILE, statusLineCommand, statusLineScript } from './statusline'
import { UsageStore } from './store'
import { readReportFile, removeLeftovers, watchReports } from './watch'

export interface UsageIpcOptions {
  /** Deck's usage folder (userData/usage): the script, Claude Code's reports and usage.json. */
  dir: string
  /** Claude Code's user settings file (claudeSettingsFile). */
  settingsFile: string
  platform: Platform
}

export interface UsageIpc {
  /** Pushes go to this window; when it comes to the front, the link and the report are read again. */
  attach(win: BrowserWindow): void
  /** At quit: stop watching. */
  dispose(): void
}

/** Claude's plan usage for the usage card. Connect makes Deck Claude Code's status line, whose runs
 *  then write each report into `dir`; main reads them and keeps the numbers. */
export function registerUsageIpc({ dir, settingsFile, platform }: UsageIpcOptions): UsageIpc {
  const command = statusLineCommand(platform, dir)
  const unusable = `Deck's folder can't be used in a status line command: ${dir}`
  const store = new UsageStore(join(dir, 'usage.json'))
  let link: UsageLink = { state: 'off' }
  let win: BrowserWindow | null = null
  let stopWatching = () => {}
  /** Connect and Disconnect each read, then write, Claude Code's settings: one at a time. */
  let changing: Promise<unknown> = Promise.resolve()

  const state = (): UsageState => {
    const { windows, updatedAt } = store.get()
    return { link, settingsFile, fiveHour: windows.five_hour ?? null, sevenDay: windows.seven_day ?? null, updatedAt }
  }
  const push = () => {
    if (win && !win.isDestroyed() && !win.webContents.isDestroyed()) win.webContents.send(IPC.usageChanged, state())
  }
  const setLink = (next: UsageLink) => {
    if (JSON.stringify(next) === JSON.stringify(link)) return
    link = next
    push()
  }
  const checkLink = async () => {
    setLink(command ? await currentLink(settingsFile, command) : { state: 'error', message: unusable })
  }
  const takeReport = async () => {
    const read = await readReportFile(join(dir, REPORT_FILE))
    if (read && store.add(read.report, read.at)) push()
  }

  const ready = (async () => {
    await mkdir(dir, { recursive: true })
    // Written at every start, so a newer script reaches a Deck that is connected already.
    const script = statusLineScript(dir)
    if (platform !== 'win32' && script) await writeFile(join(dir, SCRIPT_FILE), script, 'utf8')
    await removeLeftovers(dir)
    await store.load()
    await takeReport()
    await checkLink()
    stopWatching = watchReports(dir, () => void takeReport())
  })().catch((err: unknown) => console.error('usage: starting failed', err))

  const change = (run: (command: string) => Promise<UsageLink>): Promise<UsageChange> => {
    const result = changing.then(async (): Promise<UsageChange> => {
      await ready
      try {
        if (!command) throw new Error(unusable)
        setLink(await run(command))
        return { state: state() }
      } catch (err) {
        await checkLink() // whatever got written, the card shows what the settings say now
        return { error: err instanceof Error ? err.message : String(err) }
      }
    })
    changing = result
    return result
  }

  ipcMain.handle(IPC.usageGet, async () => {
    await ready
    return state()
  })
  ipcMain.handle(IPC.usageConnect, (_e, replace: unknown) =>
    change((cmd) => connect({ file: settingsFile, command: cmd, dir, replace: replace === true })))
  ipcMain.handle(IPC.usageDisconnect, () => change((cmd) => disconnect({ file: settingsFile, command: cmd, dir })))

  return {
    attach(w) {
      if (win) throw new Error('registerUsageIpc: attach() runs once')
      win = w
      // Claude Code's settings may have changed while Deck was in the background, and a report the
      // watch missed is read again.
      w.on('focus', () => {
        void ready.then(() => Promise.all([checkLink(), takeReport()]))
      })
    },
    dispose() {
      stopWatching()
    },
  }
}
