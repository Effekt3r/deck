import type { Platform } from '@shared/types'

/** Android key codes (android.view.KeyEvent). */
export const KEYCODE = {
  HOME: 3, BACK: 4, DPAD_UP: 19, DPAD_DOWN: 20, DPAD_LEFT: 21, DPAD_RIGHT: 22, POWER: 26, TAB: 61,
  ENTER: 66, DEL: 67, PAGE_UP: 92, PAGE_DOWN: 93, ESCAPE: 111, FORWARD_DEL: 112, MOVE_HOME: 122,
  MOVE_END: 123, APP_SWITCH: 187,
} as const

/** Android's meta state (KeyEvent.META_SHIFT_ON, META_ALT_ON, META_CTRL_ON). */
const META_SHIFT = 0x1
const META_ALT = 0x2
const META_CTRL = 0x1000

const KEYS: Record<string, number> = {
  Enter: KEYCODE.ENTER, Backspace: KEYCODE.DEL, Delete: KEYCODE.FORWARD_DEL, Tab: KEYCODE.TAB,
  Escape: KEYCODE.ESCAPE, ArrowUp: KEYCODE.DPAD_UP, ArrowDown: KEYCODE.DPAD_DOWN,
  ArrowLeft: KEYCODE.DPAD_LEFT, ArrowRight: KEYCODE.DPAD_RIGHT, Home: KEYCODE.MOVE_HOME,
  End: KEYCODE.MOVE_END, PageUp: KEYCODE.PAGE_UP, PageDown: KEYCODE.PAGE_DOWN,
}

/** macOS's word-wise editing keys (Option+Backspace/Delete/←/→ moves or deletes by word). Android's
 *  own Alt modifier instead moves/deletes by line, so these are sent with Ctrl, Android's word-wise
 *  modifier, instead of Alt. */
const WORD_WISE: Record<string, number> = {
  Backspace: KEYCODE.DEL, Delete: KEYCODE.FORWARD_DEL, ArrowLeft: KEYCODE.DPAD_LEFT, ArrowRight: KEYCODE.DPAD_RIGHT,
}

export interface KeyPress {
  key: string
  shiftKey: boolean
  ctrlKey: boolean
  metaKey: boolean
  altKey: boolean
  /** AltGr held (`e.getModifierState('AltGraph')`), when the browser reports it. */
  altGraph?: boolean
  isComposing?: boolean
}

/** What a key pressed on the device's screen sends: an Android key code (Return, Backspace, the
 *  arrows …) with Shift and Alt, or a typed character as text. null leaves the key to Deck: Cmd
 *  shortcuts (Cmd+Left/Right excepted: macOS's line start/end), Ctrl ones (but Ctrl+Alt off macOS
 *  is AltGr, which types), dead keys while composing, and keys Android has no use for — off macOS,
 *  an Alt combo that isn't AltGr is a menu key (Alt+F), an Alt code (Alt+0233) or the window menu
 *  (Alt+Space), none of them text for the device. */
export function deviceKey(e: KeyPress, platform: Platform): { keycode: number; meta: number } | { text: string } | null {
  if (e.isComposing) return null
  const mac = platform === 'darwin'
  if (e.metaKey) {
    // Cmd+Left/Right is macOS's line start/end; every other Cmd combo (copy/paste, Deck's own
    // shortcuts, tab switching, …) is left alone.
    if (mac && !e.ctrlKey && !e.altKey && (e.key === 'ArrowLeft' || e.key === 'ArrowRight')) {
      return { keycode: e.key === 'ArrowLeft' ? KEYCODE.MOVE_HOME : KEYCODE.MOVE_END, meta: e.shiftKey ? META_SHIFT : 0 }
    }
    return null
  }
  // Off macOS, a browser that reports AltGr (`getModifierState('AltGraph')`) is trusted over
  // guessing it from Ctrl+Alt.
  const altGr = !mac && (e.altGraph ?? (e.ctrlKey && e.altKey))
  if (e.ctrlKey && !altGr) return null
  if (mac && e.altKey) {
    const keycode = WORD_WISE[e.key]
    if (keycode !== undefined) return { keycode, meta: META_CTRL | (e.shiftKey ? META_SHIFT : 0) }
  }
  const keycode = KEYS[e.key]
  if (keycode !== undefined) return { keycode, meta: (e.shiftKey ? META_SHIFT : 0) | (e.altKey && !altGr ? META_ALT : 0) }
  if (!mac && e.altKey && !altGr) return null
  // One character ("a", "ø", "@"); named keys ("F5", "Dead") are longer.
  return [...e.key].length === 1 ? { text: e.key } : null
}
