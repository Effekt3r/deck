import { type FSWatcher, watch } from 'node:fs'
import { readdir, readFile, rm, stat } from 'node:fs/promises'
import { join } from 'node:path'
import { readReport, type UsageReport } from './report'
import { REPORT_FILE } from './statusline'

/** Far more than a status line input (a few kB); a bigger file isn't one. */
const MAX_BYTES = 1024 * 1024
/** Temp files of status line runs (statusline.ts); one a minute old was cancelled mid-write. */
const LEFTOVER = /^\.statusline\..+\.tmp$/

/** The report in `file`, dated by its modification time. null when the file is missing, too big
 *  or not JSON (on Windows, a write still under way: the next change reads it again). */
export async function readReportFile(file: string): Promise<{ report: UsageReport; at: number } | null> {
  try {
    const info = await stat(file)
    if (!info.isFile() || info.size > MAX_BYTES) return null
    return { report: readReport(JSON.parse(await readFile(file, 'utf8'))), at: info.mtimeMs }
  } catch {
    return null
  }
}

/** Calls `onChange`, debounced, when a status line run writes `<dir>/statusline.json`. The folder
 *  is watched, not the file: each run replaces the file by a rename. Returns a stop function. */
export function watchReports(dir: string, onChange: () => void, debounceMs = 100): () => void {
  let timer: NodeJS.Timeout | null = null
  let watcher: FSWatcher | null = null
  try {
    watcher = watch(dir, (_event, name) => {
      if (name !== null && name !== REPORT_FILE) return
      if (timer) clearTimeout(timer)
      timer = setTimeout(() => {
        timer = null
        onChange()
      }, debounceMs)
    })
    watcher.on('error', (err) => console.error('usage: watching the reports failed', err))
  } catch (err) {
    console.error('usage: watching the reports failed', err)
  }
  return () => {
    if (timer) clearTimeout(timer)
    watcher?.close()
  }
}

/** Removes temp files of status line runs that were cancelled mid-write (a minute old or more). */
export async function removeLeftovers(dir: string, now = Date.now()): Promise<void> {
  const names = await readdir(dir).catch(() => [] as string[])
  await Promise.all(names.filter((name) => LEFTOVER.test(name)).map(async (name) => {
    const file = join(dir, name)
    const info = await stat(file).catch(() => null)
    if (info && now - info.mtimeMs >= 60_000) await rm(file, { force: true }).catch(() => {})
  }))
}
