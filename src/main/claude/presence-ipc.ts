import { join } from 'node:path'
import { type BrowserWindow, ipcMain } from 'electron'
import { IPC } from '@shared/channels'
import type { ClaudePresence } from '@shared/types'
import { claudeHome } from './locator'
import { alive, PresenceWatch, psTable } from './presence'

export interface PresenceIpcOptions {
  /** Each tab's shell pid → its pty id (PtyManager.shells). */
  shells(): ReadonlyMap<number, string>
  /** Where Claude's home is ($CLAUDE_CONFIG_DIR); tests pass their own. */
  env?: NodeJS.ProcessEnv
  platform: NodeJS.Platform
}

export interface PresenceIpc {
  /** Changes are pushed to this window. */
  attach(win: BrowserWindow): void
  /** At quit: stop watching. */
  dispose(): void
}

/** `claude:presence`: which Claude Code runs where and what it's doing, for the tabs. Watching
 *  starts with the first ask. Read-only, like the rest of Deck's Claude code. */
export function registerPresenceIpc(opts: PresenceIpcOptions): PresenceIpc {
  let win: BrowserWindow | null = null
  const watch = new PresenceWatch({
    dir: join(claudeHome(opts.env ?? process.env), 'sessions'),
    shells: opts.shells,
    processes: opts.platform === 'win32' ? null : psTable,
    alive,
    publish: (list) => {
      if (win && !win.isDestroyed() && !win.webContents.isDestroyed()) win.webContents.send(IPC.claudePresenceChanged, list)
    },
  })
  ipcMain.handle(IPC.claudePresence, async (): Promise<ClaudePresence[]> => {
    watch.start()
    await watch.refresh()
    return watch.current()
  })
  return {
    attach(w) {
      win = w
    },
    dispose() {
      watch.stop()
    },
  }
}
