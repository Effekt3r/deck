import { HID_KEY, HID_MOD } from '@shared/hid'
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

/** macOS's word-wise deletes (Option+Backspace/Delete): Android's own Alt modifier instead deletes
 *  the whole line, so Ctrl goes instead, Android's word-wise modifier. Never with Shift: Android's
 *  text fields do nothing for Ctrl+Shift+Backspace (BaseKeyListener), while Option+Shift+Delete
 *  still just deletes a word on a Mac too, the same as Option+Delete. */
const WORD_DELETE: Record<string, number> = { Backspace: KEYCODE.DEL, Delete: KEYCODE.FORWARD_DEL }

/** macOS's word-wise selection (Option+←/→): Ctrl again, keeping Shift this time (word-wise
 *  selection, same as Android's own). */
const WORD_MOVE: Record<string, number> = { ArrowLeft: KEYCODE.DPAD_LEFT, ArrowRight: KEYCODE.DPAD_RIGHT }

/** Off macOS, the editing keys Windows does word-wise with Ctrl (Backspace, Delete, ←, →), and Ctrl+Home/End
 *  for the text's start and end: Android reads Ctrl the same way, and none of them is a Deck shortcut. */
const CTRL_EDIT: Record<string, number> = {
  Backspace: KEYCODE.DEL, Delete: KEYCODE.FORWARD_DEL, ArrowLeft: KEYCODE.DPAD_LEFT, ArrowRight: KEYCODE.DPAD_RIGHT,
  Home: KEYCODE.MOVE_HOME, End: KEYCODE.MOVE_END,
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
 *  arrows …) with Shift (and on macOS Option's Alt or Ctrl), or a typed character as text. null
 *  leaves the key to Deck: Cmd shortcuts (Cmd+Left/Right/Up/Down excepted: macOS's line or text
 *  start/end), Ctrl ones (but off macOS Ctrl+Alt is AltGr, which types, and Ctrl's editing keys go
 *  through), dead keys while composing, and keys Android has no use for. Off macOS, Alt that isn't
 *  AltGr never goes to the device: it's a menu key (Alt+F), an Alt code (Alt+0233), the window menu
 *  (Alt+Space) or a system key, and Android's Alt+Backspace would delete the whole line. */
export function deviceKey(e: KeyPress, platform: Platform): { keycode: number; meta: number } | { text: string } | null {
  if (e.isComposing) return null
  const mac = platform === 'darwin'
  if (e.metaKey) {
    // Cmd+Left/Right is the line's start/end, like Home/End; Cmd+Up/Down is the whole text's,
    // which Android reaches with Ctrl+Home/Ctrl+End instead. Every other Cmd combo (copy/paste,
    // Deck's own shortcuts, tab switching, Cmd+Backspace included — Android's nearest key,
    // Alt+Backspace, deletes the whole line rather than just up to the cursor — …) is left alone.
    if (mac && !e.ctrlKey && !e.altKey) {
      const shift = e.shiftKey ? META_SHIFT : 0
      if (e.key === 'ArrowLeft') return { keycode: KEYCODE.MOVE_HOME, meta: shift }
      if (e.key === 'ArrowRight') return { keycode: KEYCODE.MOVE_END, meta: shift }
      if (e.key === 'ArrowUp') return { keycode: KEYCODE.MOVE_HOME, meta: META_CTRL | shift }
      if (e.key === 'ArrowDown') return { keycode: KEYCODE.MOVE_END, meta: META_CTRL | shift }
    }
    return null
  }
  // Off macOS, Windows itself treats Ctrl+Alt as AltGr whenever it produces a character, and
  // Chromium may report AltGraph only for the right-hand key: a reported value can only add to
  // that guess, never take it away, or a real AltGr character would be dropped.
  const altGr = !mac && (e.altGraph === true || (e.ctrlKey && e.altKey))
  if (e.ctrlKey && !altGr) {
    const edit = mac ? undefined : CTRL_EDIT[e.key]
    if (edit === undefined) return null
    // Never with Shift on the deletes: Android deletes nothing for Ctrl+Shift+Backspace.
    const deletes = edit === KEYCODE.DEL || edit === KEYCODE.FORWARD_DEL
    return { keycode: edit, meta: META_CTRL | (e.shiftKey && !deletes ? META_SHIFT : 0) }
  }
  if (!mac && e.altKey && !altGr) return null
  if (mac && e.altKey) {
    const del = WORD_DELETE[e.key]
    if (del !== undefined) return { keycode: del, meta: META_CTRL }
    const move = WORD_MOVE[e.key]
    if (move !== undefined) return { keycode: move, meta: META_CTRL | (e.shiftKey ? META_SHIFT : 0) }
    if (e.key === 'ArrowUp' || e.key === 'ArrowDown') {
      // Android's Alt+Up/Down jump to the text's start/end; Option+Up/Down do neither on a Mac, so
      // the plain key goes through instead, Shift only.
      return { keycode: e.key === 'ArrowUp' ? KEYCODE.DPAD_UP : KEYCODE.DPAD_DOWN, meta: e.shiftKey ? META_SHIFT : 0 }
    }
  }
  const keycode = KEYS[e.key]
  if (keycode !== undefined) return { keycode, meta: (e.shiftKey ? META_SHIFT : 0) | (mac && e.altKey ? META_ALT : 0) }
  // One character ("a", "ø", "@"); named keys ("F5", "Dead") are longer.
  return [...e.key].length === 1 ? { text: e.key } : null
}

const HID_KEYS: Record<string, number> = {
  Enter: HID_KEY.ENTER, Escape: HID_KEY.ESCAPE, Backspace: HID_KEY.BACKSPACE, Tab: HID_KEY.TAB,
  Home: HID_KEY.HOME, PageUp: HID_KEY.PAGE_UP, Delete: HID_KEY.DELETE, End: HID_KEY.END,
  PageDown: HID_KEY.PAGE_DOWN, ArrowRight: HID_KEY.RIGHT, ArrowLeft: HID_KEY.LEFT,
  ArrowDown: HID_KEY.DOWN, ArrowUp: HID_KEY.UP,
}
const ARROWS = new Set(['ArrowLeft', 'ArrowRight', 'ArrowUp', 'ArrowDown'])

/** What a key pressed on a simulator's screen sends: a named key's USB HID usage with its modifiers,
 *  or a typed character as text; null leaves it to Deck. iOS edits text the way a Mac does, so keys
 *  go as they are: Option+Backspace deletes a word, Option+←/→ move by word, ⌘←/→ go to the line's
 *  ends and ⌘↑/↓ to the text's. Every other ⌘ key, and Ctrl ones, stay Deck's. (Simulators run on
 *  macOS only.) */
export function simulatorKey(e: KeyPress): { usage: number; modifiers: number } | { text: string } | null {
  if (e.isComposing) return null
  const modifiers = (e.shiftKey ? HID_MOD.SHIFT : 0) | (e.altKey ? HID_MOD.ALT : 0)
  if (e.metaKey) return !e.ctrlKey && ARROWS.has(e.key) ? { usage: HID_KEYS[e.key], modifiers: modifiers | HID_MOD.CMD } : null
  if (e.ctrlKey) return null
  const usage = HID_KEYS[e.key]
  if (usage !== undefined) return { usage, modifiers }
  return [...e.key].length === 1 ? { text: e.key } : null
}
