import { app, type BrowserWindow, ipcMain } from 'electron'
import { IPC } from '@shared/channels'

/** What the Dock or the taskbar shows when the number of tabs needing the user changes. */
export interface AttentionSignal {
  /** The Dock's badge (macOS): the count, '' for none. */
  badge: string
  /** Draw the eye (a Dock bounce, a taskbar flash): the count rose while Deck was in the background. */
  alert: boolean
}

export function attentionSignal(before: number, now: number, focused: boolean): AttentionSignal {
  return { badge: now > 0 ? String(now) : '', alert: now > before && !focused }
}

/** More tabs than anyone opens: a larger count isn't one. */
const MAX_COUNT = 999

/** `app:attention`: the renderer's count of tabs that need the user. */
export function registerAttention(platform: NodeJS.Platform): { attach(win: BrowserWindow): void } {
  let win: BrowserWindow | null = null
  let count = 0
  // An `on` listener that throws shows an error dialog, so the count is checked first.
  ipcMain.on(IPC.appAttention, (_e, waiting: unknown) => {
    if (typeof waiting !== 'number' || !Number.isSafeInteger(waiting) || waiting < 0 || waiting > MAX_COUNT) return
    const w = win !== null && !win.isDestroyed() ? win : null
    const signal = attentionSignal(count, waiting, w?.isFocused() ?? false)
    count = waiting
    if (platform === 'darwin') {
      app.dock?.setBadge(signal.badge)
      if (signal.alert) app.dock?.bounce('informational')
    } else if (platform === 'win32' && signal.alert && w) {
      w.flashFrame(true)
    }
  })
  return {
    attach(w) {
      win = w
      // Windows flashes until told to stop.
      if (platform === 'win32') w.on('focus', () => w.flashFrame(false))
    },
  }
}
