import type { UsageWindow } from '@shared/types'

/** Reset times this close together belong to one window: Claude's windows last 5 hours and 7 days. */
const SAME_WINDOW_MS = 60 * 60_000
/** How long a kept percentage holds out against a lower one for the same window. */
const HOLD_MS = 10 * 60_000

/** A window as kept, with when it was reported (ms since the epoch: the report's file time). */
export interface SeenWindow extends UsageWindow {
  seenAt: number
}

/** The window to keep when a report arrives: `current` or `next` itself.
 *  - The same window, higher or equal: `next`.
 *  - The same window, lower: most likely older data (each session reports its own last API
 *    response, and an idle session's status line still runs on a mode change or at a reset), so
 *    it's kept out for 10 minutes after the kept one was seen. After that it wins, because usage
 *    can drop within a window (a plan upgrade, a reset by Anthropic); a stale report let in that
 *    way is corrected by the next real reply, since higher wins.
 *  - A report of an earlier window is older still. */
export function mergeWindow(current: SeenWindow | null, next: SeenWindow): SeenWindow {
  if (!current) return next
  if (Math.abs(next.resetsAt - current.resetsAt) < SAME_WINDOW_MS) {
    if (next.usedPercentage >= current.usedPercentage) return next
    return next.seenAt - current.seenAt < HOLD_MS ? current : next
  }
  return next.resetsAt > current.resetsAt ? next : current
}
