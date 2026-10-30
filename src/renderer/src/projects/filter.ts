import type { Platform, ProjectItem } from '@shared/types'

/** Case-insensitive; every word must appear in the name or the path. */
export function filterProjects(items: ProjectItem[], query: string): ProjectItem[] {
  const words = query.toLowerCase().split(/\s+/).filter(Boolean)
  if (!words.length) return items
  return items.filter((item) => {
    const hay = `${item.name} ${item.path}`.toLowerCase()
    return words.every((w) => hay.includes(w))
  })
}

const MIN = 60
const HOUR = 60 * MIN
const DAY = 24 * HOUR

/** '<1m', '5m', '3h', '2d', '4mo', '2y' (months are 30 days). */
export function ago(ms: number, now: number): string {
  const s = (now - ms) / 1000
  if (s < MIN) return '<1m'
  if (s < HOUR) return `${Math.floor(s / MIN)}m`
  if (s < DAY) return `${Math.floor(s / HOUR)}h`
  if (s < 60 * DAY) return `${Math.floor(s / DAY)}d`
  if (s < 365 * DAY) return `${Math.floor(s / (30 * DAY))}mo`
  return `${Math.floor(s / (365 * DAY))}y`
}

/** The home folder prefix becomes '~'. */
export function shortPath(path: string, home: string): string {
  const h = home.replace(/[\\/]+$/, '')
  if (!h || !path.startsWith(h)) return path
  const rest = path.slice(h.length)
  return rest === '' || rest[0] === '/' || rest[0] === '\\' ? `~${rest}` : path
}

/** `path` is `folder` or inside it. OSC 7 reports 'C:/x' where main has 'C:\x',
 *  and macOS and Windows file systems usually ignore case. */
export function isInside(path: string, folder: string, platform: Platform): boolean {
  const norm = (p: string) => {
    const s = p.replace(/\\/g, '/').replace(/\/+$/, '')
    return platform === 'linux' ? s : s.toLowerCase()
  }
  const p = norm(path)
  const f = norm(folder)
  return path !== '' && (p === f || p.startsWith(`${f}/`))
}
