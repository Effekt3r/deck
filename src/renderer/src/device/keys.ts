import type { Platform } from '@shared/types'

/** Android key codes (android.view.KeyEvent). */
export const KEYCODE = {
  HOME: 3, BACK: 4, DPAD_UP: 19, DPAD_DOWN: 20, DPAD_LEFT: 21, DPAD_RIGHT: 22, POWER: 26, TAB: 61,
  ENTER: 66, DEL: 67, PAGE_UP: 92, PAGE_DOWN: 93, ESCAPE: 111, FORWARD_DEL: 112, MOVE_HOME: 122,
  MOVE_END: 123, APP_SWITCH: 187,
} as const

/** Android's meta state (KeyEvent.META_SHIFT_ON, META_ALT_ON). */
const META_SHIFT = 0x1
const META_ALT = 0x2

const KEYS: Record<string, number> = {
  Enter: KEYCODE.ENTER, Backspace: KEYCODE.DEL, Delete: KEYCODE.FORWARD_DEL, Tab: KEYCODE.TAB,
  Escape: KEYCODE.ESCAPE, ArrowUp: KEYCODE.DPAD_UP, ArrowDown: KEYCODE.DPAD_DOWN,
  ArrowLeft: KEYCODE.DPAD_LEFT, ArrowRight: KEYCODE.DPAD_RIGHT, Home: KEYCODE.MOVE_HOME,
  End: KEYCODE.MOVE_END, PageUp: KEYCODE.PAGE_UP, PageDown: KEYCODE.PAGE_DOWN,
}

export interface KeyPress {
  key: string
  shiftKey: boolean
  ctrlKey: boolean
  metaKey: boolean
  altKey: boolean
  isComposing?: boolean
}

/** What a key pressed on the device's screen sends: an Android key code (Return, Backspace, the
 *  arrows …) with Shift and Alt, or a typed character as text. null leaves the key to Deck: Cmd
 *  shortcuts, Ctrl ones (but Ctrl+Alt off macOS is AltGr, which types), dead keys while composing,
 *  and keys Android has no use for. */
export function deviceKey(e: KeyPress, platform: Platform): { keycode: number; meta: number } | { text: string } | null {
  if (e.isComposing || e.metaKey) return null
  const altGr = platform !== 'darwin' && e.ctrlKey && e.altKey
  if (e.ctrlKey && !altGr) return null
  const keycode = KEYS[e.key]
  if (keycode !== undefined) return { keycode, meta: (e.shiftKey ? META_SHIFT : 0) | (e.altKey && !altGr ? META_ALT : 0) }
  // One character ("a", "ø", "@"); named keys ("F5", "Dead") are longer.
  return [...e.key].length === 1 ? { text: e.key } : null
}
