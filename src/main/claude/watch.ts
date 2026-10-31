import { type FSWatcher, watch } from 'node:fs'

/**
 * Watches folders (not their sub-folders); onChange gets the name of the entry that changed, or
 * null when the platform doesn't say. Folders that can't be watched (missing, too many watchers)
 * are skipped: callers rescan on a timer anyway. Returns a stop function, or null when nothing
 * could be watched.
 */
export function watchDirs(dirs: string[], onChange: (name: string | null) => void): (() => void) | null {
  const watchers: FSWatcher[] = []
  for (const dir of dirs) {
    try {
      const w = watch(dir, { persistent: false }, (_event, name) => onChange(typeof name === 'string' ? name : null))
      w.on('error', () => w.close()) // e.g. the folder was deleted
      watchers.push(w)
    } catch {
      // see above
    }
  }
  if (!watchers.length) return null
  return () => {
    for (const w of watchers) w.close()
  }
}
