import type { Platform } from '@shared/types'

/** 'menu': not for xterm, and not cancelled, so the application menu's accelerator fires. */
export type KeyAction = 'newline' | 'copy' | 'paste' | 'find' | 'menu' | null

export interface KeyInput {
  type: string
  key: string
  /** Physical key ('KeyC', 'Digit1'); the same on every keyboard layout. */
  code?: string
  shiftKey: boolean
  ctrlKey: boolean
  metaKey: boolean
  altKey: boolean
}

/** Off macOS, menu accelerators only fire for keys the page leaves alone, so
 *  Deck's own Ctrl+Shift shortcuts must not reach xterm (see menu.ts). */
const MENU_LETTERS = new Set(['t', 'w', 'o', 'g', 'a', 'd'])

/** Keys Deck handles before xterm sees them. Everything else goes to the shell. */
export function keyAction(e: KeyInput, platform: Platform, hasSelection: boolean): KeyAction {
  if (e.type !== 'keydown') return null
  const { shiftKey: shift, ctrlKey: ctrl, metaKey: meta, altKey: alt } = e
  // ESC CR: a newline in Claude Code's prompt.
  if (e.key === 'Enter') return shift && !ctrl && !meta && !alt ? 'newline' : null
  if (alt) return null // also AltGr (Ctrl+Alt) on Windows layouts
  // By physical key where there is one, so Ctrl+C still copies on a Cyrillic layout.
  const letter = e.code && /^Key[A-Z]$/.test(e.code) ? e.code.slice(3).toLowerCase() : e.key.toLowerCase()

  if (platform === 'darwin') {
    // Copy and paste come from the Edit menu's roles.
    return meta && !ctrl && !shift && letter === 'f' ? 'find' : null
  }

  if (!ctrl || meta) return null
  // Next / previous tab; xterm would turn these into \t and ESC [Z and swallow them.
  if (e.key === 'Tab') return 'menu'
  if (shift) {
    if (letter === 'c') return 'copy'
    if (letter === 'v') return 'paste'
    if (letter === 'f') return 'find'
    if (MENU_LETTERS.has(letter) || /^Digit[1-9]$/.test(e.code ?? '')) return 'menu'
    return null
  }
  if (letter === 'c') return hasSelection ? 'copy' : null // without a selection Ctrl+C is SIGINT
  return letter === 'v' ? 'paste' : null
}
