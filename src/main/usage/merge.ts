import type { UsageWindow } from '@shared/types'

/** Reset times this close together belong to one window: Claude's windows last 5 hours and 7 days. */
const SAME_WINDOW_MS = 60 * 60_000

/** The window to keep when a report arrives: `current` or `next` itself. Usage only rises within
 *  a window, so a lower percentage for the same window is older data (each session reports its
 *  own last API response, and an idle session's status line still runs on a mode change or at a
 *  reset). A report of an earlier window is older still. */
export function mergeWindow(current: UsageWindow | null, next: UsageWindow): UsageWindow {
  if (!current) return next
  if (Math.abs(next.resetsAt - current.resetsAt) < SAME_WINDOW_MS) {
    return next.usedPercentage >= current.usedPercentage ? next : current
  }
  return next.resetsAt > current.resetsAt ? next : current
}
