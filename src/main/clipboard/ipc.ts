import { type BrowserWindow, ipcMain, powerMonitor } from 'electron'
import { IPC } from '@shared/channels'
import type { InsertResult, Platform } from '@shared/types'
import { imageInfo } from './image'
import { insertFor } from './insert'
import { readClipboard } from './read'
import { TempImages } from './temp'
import { ClipboardWatch } from './watch'

export interface ClipboardIpc {
  /** Follow this window's focus; its renderer gets the card's item. */
  attach(win: BrowserWindow): void
  /** At quit: stop looking and remove the saved images. */
  dispose(): void
}

export function registerClipboardIpc(opts: { tempDir: string; platform: Platform }): ClipboardIpc {
  const temp = new TempImages(opts.tempDir)
  temp.clear() // images a crashed run left behind
  let win: BrowserWindow | null = null
  const watch = new ClipboardWatch({
    read: readClipboard,
    imageInfo,
    insert: (content, claude) => insertFor(content, claude, { platform: opts.platform, saveImage: (png) => temp.save(png) }),
    publish: (item) => {
      if (win && !win.isDestroyed()) win.webContents.send(IPC.clipboardItem, item)
    },
  })

  ipcMain.handle(IPC.clipboardCurrent, () => watch.current())
  ipcMain.handle(IPC.clipboardAdd, (_e, id: unknown): Promise<InsertResult> | InsertResult =>
    typeof id === 'string' ? watch.add(id) : { error: 'No clipboard item given.' })
  ipcMain.handle(IPC.clipboardPaste, (_e, o: unknown) =>
    watch.paste(typeof o === 'object' && o !== null && (o as { claude?: unknown }).claude === true))
  ipcMain.on(IPC.clipboardDismiss, (_e, id: unknown) => {
    if (typeof id === 'string') watch.dismiss(id)
  })

  return {
    attach(w) {
      win = w
      void watch.baseline()
      w.on('focus', () => watch.focus())
      w.on('blur', () => watch.blur())
      // A locked screen or a sleeping Mac sends no blur: stop looking then too (blur() does nothing
      // when Deck wasn't in front). Waking with a password first fires resume, then unlock-screen:
      // look again only once unlocked.
      let locked = false
      const away = () => watch.blur()
      const back = () => {
        if (!locked && !w.isDestroyed() && w.isFocused()) watch.focus()
      }
      powerMonitor.on('lock-screen', () => {
        locked = true
        away()
      })
      powerMonitor.on('unlock-screen', () => {
        locked = false
        back()
      })
      powerMonitor.on('suspend', away)
      powerMonitor.on('resume', back)
      if (w.isFocused()) watch.focus()
    },
    dispose() {
      watch.stop()
      temp.clear()
    },
  }
}
