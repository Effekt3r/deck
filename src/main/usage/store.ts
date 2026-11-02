import { readFile } from 'node:fs/promises'
import { writeFileAtomic } from '../fs/atomic'
import { mergeWindow, type SeenWindow } from './merge'
import { type UsageReport, WINDOWS, type WindowKey } from './report'

export interface Readings {
  windows: Partial<Record<WindowKey, SeenWindow>>
  /** When the newest report that counted was written (ms since the epoch); null before any. */
  updatedAt: number | null
}

/** The numbers Claude Code last reported, kept in usage.json so a restart shows them. */
export class UsageStore {
  private readonly file: string
  private readings: Readings = { windows: {}, updatedAt: null }
  private saving: Promise<void> = Promise.resolve()

  constructor(file: string) {
    this.file = file
  }

  /** Reads usage.json; a missing or broken file leaves the store empty. */
  async load(): Promise<void> {
    try {
      this.readings = sanitize(JSON.parse(await readFile(this.file, 'utf8')))
    } catch {
      this.readings = { windows: {}, updatedAt: null }
    }
  }

  get(): Readings {
    return this.readings
  }

  /** Merges a report written at `at` by mergeWindow's rules. True when it counted (a window was
   *  taken from it); the store is then saved in the background. The numbers kept, reported again
   *  no later than they were seen, don't count: that's the same file read again (when the window
   *  comes to the front), not news. */
  add(report: UsageReport, at: number): boolean {
    const windows = { ...this.readings.windows }
    let counted = false
    for (const key of WINDOWS) {
      const reported = report[key]
      if (!reported) continue
      const kept = windows[key]
      const same = kept && kept.usedPercentage === reported.usedPercentage && kept.resetsAt === reported.resetsAt
      if (same && at <= kept.seenAt) continue
      const next = { ...reported, seenAt: at }
      if (mergeWindow(kept ?? null, next) !== next) continue
      windows[key] = next
      counted = true
    }
    if (!counted) return false
    this.readings = { windows, updatedAt: Math.max(at, this.readings.updatedAt ?? 0) }
    this.save()
    return true
  }

  /** Forgets every number (Disconnect), and saves that. */
  clear(): void {
    this.readings = { windows: {}, updatedAt: null }
    this.save()
  }

  /** Resolves once every save so far has finished. */
  flush(): Promise<void> {
    return this.saving
  }

  /** In the background, one save after another, so the last one written is the newest. */
  private save(): void {
    const text = `${JSON.stringify(this.readings, null, 2)}\n`
    this.saving = this.saving
      .then(() => writeFileAtomic(this.file, text))
      .catch((err: unknown) => console.error('usage: saving usage.json failed', err))
  }
}

/** Only windows with finite numbers survive; anything else reads as nothing kept. A window saved
 *  before seenAt was kept is dated by updatedAt. */
function sanitize(data: unknown): Readings {
  const readings: Readings = { windows: {}, updatedAt: null }
  if (typeof data !== 'object' || data === null) return readings
  const { windows, updatedAt } = data as { windows?: unknown; updatedAt?: unknown }
  if (isFiniteNumber(updatedAt)) readings.updatedAt = updatedAt
  if (typeof windows !== 'object' || windows === null) return readings
  for (const key of WINDOWS) {
    const w = (windows as Record<string, unknown>)[key]
    if (typeof w !== 'object' || w === null) continue
    const { usedPercentage, resetsAt, seenAt } = w as { usedPercentage?: unknown; resetsAt?: unknown; seenAt?: unknown }
    if (!isFiniteNumber(usedPercentage) || !isFiniteNumber(resetsAt)) continue
    readings.windows[key] = { usedPercentage, resetsAt, seenAt: isFiniteNumber(seenAt) ? seenAt : (readings.updatedAt ?? 0) }
  }
  return readings
}

const isFiniteNumber = (v: unknown): v is number => typeof v === 'number' && Number.isFinite(v)
