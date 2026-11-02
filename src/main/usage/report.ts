import type { UsageWindow } from '@shared/types'

/** The windows the card shows, by the keys of Claude Code's status line input. */
export const WINDOWS = ['five_hour', 'seven_day'] as const
export type WindowKey = (typeof WINDOWS)[number]
export type UsageReport = Partial<Record<WindowKey, UsageWindow>>

/** The plan usage in Claude Code's status line input (`rate_limits`): a window counts with a
 *  finite `used_percentage` and a `resets_at` (Unix seconds) after the epoch. Everything else in
 *  the input is ignored. */
export function readReport(input: unknown): UsageReport {
  const report: UsageReport = {}
  const limits = isObject(input) ? input.rate_limits : undefined
  if (!isObject(limits)) return report
  for (const key of WINDOWS) {
    const window = limits[key]
    if (!isObject(window)) continue
    const used = window.used_percentage
    const resets = window.resets_at
    if (typeof used !== 'number' || !Number.isFinite(used)) continue
    if (typeof resets !== 'number' || !Number.isFinite(resets) || resets <= 0) continue
    report[key] = { usedPercentage: Math.min(Math.max(used, 0), 100), resetsAt: resets * 1000 }
  }
  return report
}

const isObject = (v: unknown): v is Record<string, unknown> => typeof v === 'object' && v !== null && !Array.isArray(v)
