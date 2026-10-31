import type { Platform } from './types'

/** A path quoted for the shell Deck starts on `platform`: zsh (macOS, Linux) or PowerShell
 *  (Windows). Claude Code reads the same quoting in its prompt: a pasted, quoted image path
 *  becomes an [Image #N] attachment. */
export function quotePath(path: string, platform: Platform): string {
  // PowerShell ends a single-quoted string at ' and also at ‘ ’ ‛; each is escaped by doubling.
  if (platform === 'win32') return `'${path.replace(/['‘’‛]/g, '$&$&')}'`
  return `'${path.replace(/'/g, "'\\''")}'`
}

/** Paths quoted and separated by spaces, ready to paste. */
export function quotePaths(paths: readonly string[], platform: Platform): string {
  return paths.map((p) => quotePath(p, platform)).join(' ')
}
