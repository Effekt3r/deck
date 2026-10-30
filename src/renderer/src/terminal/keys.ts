import type { Platform } from '@shared/types'

/** 'menu': not for xterm, and not cancelled, so the application menu's accelerator fires. */
export type KeyAction = 'newline' | 'copy' | 'paste' | 'find' | 'menu' | null

export interface KeyInput {
  type: string
  key: string
  shiftKey: boolean
  ctrlKey: boolean
  metaKey: boolean
  altKey: boolean
}

/** Keys Deck handles before xterm sees them. Everything else goes to the shell. */
export function keyAction(e: KeyInput, platform: Platform, hasSelection: boolean): KeyAction {
  if (e.type !== 'keydown') return null
  const { shiftKey: shift, ctrlKey: ctrl, metaKey: meta, altKey: alt } = e
  // ESC CR: a newline in Claude Code's prompt.
  if (e.key === 'Enter') return shift && !ctrl && !meta && !alt ? 'newline' : null
  if (alt) return null // also AltGr (Ctrl+Alt) on Windows layouts
  const key = e.key.toLowerCase()

  if (platform === 'darwin') {
    // Copy and paste come from the Edit menu's roles.
    return meta && !ctrl && !shift && key === 'f' ? 'find' : null
  }

  if (!ctrl || meta) return null
  // Next / previous tab; xterm would turn these into \t and ESC [Z and swallow them.
  if (e.key === 'Tab') return 'menu'
  if (shift) return key === 'c' ? 'copy' : key === 'v' ? 'paste' : key === 'f' ? 'find' : null
  if (key === 'c') return hasSelection ? 'copy' : null // without a selection Ctrl+C is SIGINT
  return key === 'v' ? 'paste' : null
}
