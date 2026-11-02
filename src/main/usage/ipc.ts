import { mkdir, readFile, rm } from 'node:fs/promises'
import { join } from 'node:path'
import { type BrowserWindow, ipcMain } from 'electron'
import { IPC } from '@shared/channels'
import type { Platform, UsageChange, UsageLink, UsageState, UsageWindow } from '@shared/types'
import { writeFileAtomic } from '../fs/atomic'
import type { SeenWindow } from './merge'
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
  let disposed = false
  /** Connect, Disconnect and the check when the window comes to the front each read Claude Code's
   *  settings, then set the link: one at a time, so an older read never lands after a newer one. */
  let queue: Promise<unknown> = Promise.resolve()
  const serial = <T>(run: () => Promise<T>): Promise<T> => {
    const result = queue.then(run)
    queue = result.catch(() => {})
    return result
  }

  const state = (): UsageState => {
    const { windows, updatedAt } = store.get()
    return { link, settingsFile, fiveHour: shown(windows.five_hour), sevenDay: shown(windows.seven_day), updatedAt }
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
  /** After Disconnect, so a later Connect waits for Claude's next report rather than showing old
   *  numbers. The last report goes too: the next focus would read it back in. */
  const forget = async () => {
    store.clear()
    await rm(join(dir, REPORT_FILE), { force: true })
      .catch((err: unknown) => console.error('usage: removing the last report failed', err))
  }

  /** macOS and Linux: the script the command runs. Written only when it changed, and by a rename, so
   *  a status line run under way never reads half of it. */
  const writeScript = async () => {
    const script = statusLineScript(dir)
    if (platform === 'win32' || !script) return
    const file = join(dir, SCRIPT_FILE)
    if ((await readFile(file, 'utf8').catch(() => null)) !== script) await writeFileAtomic(file, script)
  }
  /** One step of starting: a failing one (a script Deck can't write) leaves the others to run. */
  const step = async (what: string, run: () => Promise<unknown>) => {
    try {
      await run()
    } catch (err) {
      console.error(`usage: ${what} failed`, err)
    }
  }

  const ready = (async () => {
    await step('creating the usage folder', () => mkdir(dir, { recursive: true }))
    // Checked at every start, so a newer script reaches a Deck that is connected already.
    await step('writing the status line script', writeScript)
    await step('removing leftovers', () => removeLeftovers(dir))
    await step('reading usage.json', () => store.load())
    // Watching before the first read: a report written in between is caught by one or the other.
    if (!disposed) stopWatching = watchReports(dir, () => void takeReport())
    await step('reading the report', takeReport)
    await step("reading Claude Code's settings", checkLink)
  })()

  const change = (run: (command: string) => Promise<UsageLink>): Promise<UsageChange> =>
    serial(async () => {
      await ready
      try {
        if (!command) throw new Error(unusable)
        link = await run(command)
        push() // even when the link is the same: Disconnect forgets the numbers too
        return { state: state() }
      } catch (err) {
        await checkLink() // whatever got written, the card shows what the settings say now
        return { error: err instanceof Error ? err.message : String(err) }
      }
    })

  ipcMain.handle(IPC.usageGet, async () => {
    await ready
    return state()
  })
  ipcMain.handle(IPC.usageConnect, (_e, replace: unknown) =>
    change((cmd) => connect({ file: settingsFile, command: cmd, dir, replace: replace === true })))
  ipcMain.handle(IPC.usageDisconnect, () =>
    change(async (cmd) => {
      const next = await disconnect({ file: settingsFile, command: cmd, dir })
      await forget()
      return next
    }))

  return {
    attach(w) {
      if (win) throw new Error('registerUsageIpc: attach() runs once')
      win = w
      // Claude Code's settings may have changed while Deck was in the background (checked in turn
      // with Connect and Disconnect), and a report the watch missed is read again.
      w.on('focus', () => {
        serial(async () => {
          await ready
          await checkLink()
        }).catch((err: unknown) => console.error("usage: reading Claude Code's settings failed", err))
        void ready.then(takeReport)
      })
    },
    dispose() {
      disposed = true
      stopWatching()
    },
  }
}

/** A kept window as the card gets it: when it was seen stays in main. */
const shown = (w: SeenWindow | undefined): UsageWindow | null =>
  w ? { usedPercentage: w.usedPercentage, resetsAt: w.resetsAt } : null
