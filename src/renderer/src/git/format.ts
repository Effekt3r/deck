import type { Platform } from '@shared/types'

/** An IPC rejection's own message, without Electron's "Error invoking remote method 'x': Error: " wrapper. */
export function errorText(err: unknown): string {
  const text = err instanceof Error ? err.message : String(err)
  return text.replace(/^Error invoking remote method '[^']*': /, '').replace(/^(\w*Error): /, '') || text
}

/** Last segment of a '/' or '\' path. */
export function baseName(path: string): string {
  const trimmed = path.replace(/[\\/]+$/, '')
  return trimmed.slice(Math.max(trimmed.lastIndexOf('/'), trimmed.lastIndexOf('\\')) + 1) || path
}

/** '~/…' under the home folder. On Windows git reports C:/x where the home folder is C:\x, in any case. */
export function displayPath(path: string, home: string, platform: Platform): string {
  const h = home.replace(/[\\/]+$/, '')
  if (!h) return path
  const norm = (p: string) => (platform === 'win32' ? p.replace(/\\/g, '/').toLowerCase() : p)
  const p = norm(path)
  const nh = norm(h)
  if (p === nh || p === `${nh}/`) return '~'
  return p.startsWith(`${nh}/`) ? `~${path.slice(h.length)}` : path
}
