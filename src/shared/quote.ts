import type { Platform } from './types'

/** Control characters act in the line editor before any shell parses the text (ESC [201~ ends a
 *  bracketed paste, CR is Enter), so no quoting makes a path with them safe to paste. */
const CONTROL = /[\u0000-\u001f\u007f-\u009f]/

/** A path quoted for the shell Deck starts on `platform`: a POSIX shell (zsh, bash; not fish) on
 *  macOS and Linux, PowerShell on Windows. Claude Code reads the same quoting in its prompt: a
 *  pasted, quoted image path becomes an [Image #N] attachment (checked on macOS). null for an
 *  empty path or one with control characters, which can't be pasted safely. */
export function quotePath(path: string, platform: Platform): string | null {
  if (path === '' || CONTROL.test(path)) return null
  // PowerShell reads ' ‘ ’ ‚ ‛ all as single quotes; each is escaped by doubling it.
  if (platform === 'win32') return `'${path.replace(/['\u2018\u2019\u201A\u201B]/g, '$&$&')}'`
  return `'${path.replace(/'/g, "'\\''")}'`
}

/** A path for Claude Code's prompt, which attaches a pasted image path as [Image #N]. On Windows
 *  Claude Code drops the quotes and unescapes backslashes, as a POSIX shell would, so each
 *  backslash is doubled; elsewhere it's quotePath. null when it can't be pasted safely. */
export function quoteImagePath(path: string, platform: Platform): string | null {
  if (platform !== 'win32') return quotePath(path, platform)
  if (path === '' || CONTROL.test(path)) return null
  return `'${path.replace(/\\/g, '\\\\')}'`
}

/** Paths quoted and separated by spaces, ready to paste; null when there are none or any of them
 *  can't be pasted safely (see quotePath). */
export function quotePaths(paths: readonly string[], platform: Platform): string | null {
  const quoted = paths.map((p) => quotePath(p, platform))
  return quoted.length > 0 && quoted.every((q) => q !== null) ? quoted.join(' ') : null
}
