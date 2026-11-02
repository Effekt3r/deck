import type { UsageState, UsageWindow } from '@shared/types'

/** From these percentages up, a window shows amber, then red. */
export const HIGH = 75
export const MAX = 90
const MIN = 60_000
const HOUR = 60 * MIN
const DAY = 24 * HOUR

export type Tone = 'ok' | 'high' | 'max'

export interface Ring {
  key: 'week' | '5h'
  /** 'Week', '5-hour'. */
  label: string
  /** 0–100 as drawn: 0 once the window has reset. */
  percent: number
  tone: Tone
  /** 'resets 23:00', 'resets in 2 h 10 m'; 'reset at 23:00' once past. */
  reset: string
  past: boolean
}

export interface UsageView {
  /** Outer first: the week, then the 5-hour window; only what Claude Code reported. */
  rings: Ring[]
  /** The fullest ring, for the donut's middle; null with none. */
  top: Ring | null
  /** 'week 85% · 5h 34%'. */
  summary: string
  /** 'updated 2 min ago'; '' before the first report. */
  updated: string
  /** The donut's accessible label: 'Week 85% used, 5-hour 34% used'. */
  label: string
}

/** Time formatting, passed in so tests don't depend on the machine's locale and time zone. */
export interface Formats {
  /** A time of day: '23:00', or '11:00 PM' where clocks have 12 hours. */
  clock(ms: number): string
  /** A short weekday: 'Thu'. */
  weekday(ms: number): string
  /** The local calendar day, as a number that goes up by one each day. */
  dayNumber(ms: number): number
}

export const localFormats: Formats = {
  clock: (ms) => new Date(ms).toLocaleTimeString([], { hour: '2-digit', minute: '2-digit' }),
  weekday: (ms) => new Date(ms).toLocaleDateString([], { weekday: 'short' }),
  dayNumber: (ms) => {
    const d = new Date(ms)
    return Math.round(Date.UTC(d.getFullYear(), d.getMonth(), d.getDate()) / DAY)
  },
}

export function toneOf(percent: number): Tone {
  return percent >= MAX ? 'max' : percent >= HIGH ? 'high' : 'ok'
}

/** When a window resets: counted down within 5 hours, else the time today, tomorrow or on a weekday
 *  ('next Mon' a week or more away, which would otherwise read as today). */
export function resetText(at: number, now: number, f: Formats): string {
  if (at <= now) return f.dayNumber(at) === f.dayNumber(now) ? `reset at ${f.clock(at)}` : `reset ${f.weekday(at)} ${f.clock(at)}`
  if (at - now < 5 * HOUR) return `resets in ${duration(at - now)}`
  const days = f.dayNumber(at) - f.dayNumber(now)
  if (days === 0) return `resets ${f.clock(at)}`
  if (days === 1) return `resets tomorrow ${f.clock(at)}`
  return `resets ${days >= 7 ? 'next ' : ''}${f.weekday(at)} ${f.clock(at)}`
}

/** How long ago Claude Code last reported. */
export function updatedText(at: number | null, now: number, f: Formats): string {
  if (at === null) return ''
  const ago = Math.max(0, now - at)
  if (ago < MIN) return 'updated just now'
  if (ago < HOUR) return `updated ${Math.floor(ago / MIN)} min ago`
  if (ago < DAY) return `updated ${Math.floor(ago / HOUR)} h ago`
  return `updated ${f.weekday(at)} ${f.clock(at)}`
}

/** What the usage card draws for `state` at `now`. */
export function usageView(
  state: Pick<UsageState, 'fiveHour' | 'sevenDay' | 'updatedAt'>,
  now: number,
  f: Formats = localFormats,
): UsageView {
  const rings: Ring[] = []
  if (state.sevenDay) rings.push(ring('week', 'Week', state.sevenDay, now, f))
  if (state.fiveHour) rings.push(ring('5h', '5-hour', state.fiveHour, now, f))
  const top = rings.reduce<Ring | null>((best, r) => (best === null || r.percent > best.percent ? r : best), null)
  return {
    rings,
    top,
    summary: rings.map((r) => `${r.key} ${r.percent}%`).join(' · '),
    updated: updatedText(state.updatedAt, now, f),
    label: rings.map((r) => `${r.label} ${r.percent}% used`).join(', '),
  }
}

function ring(key: Ring['key'], label: string, w: UsageWindow, now: number, f: Formats): Ring {
  const past = w.resetsAt <= now
  const percent = past ? 0 : Math.round(Math.min(Math.max(w.usedPercentage, 0), 100))
  return { key, label, percent, tone: toneOf(percent), reset: resetText(w.resetsAt, now, f), past }
}

/** '2 h 10 m', '3 h', '25 m'; part of a minute counts as one. */
function duration(ms: number): string {
  const minutes = Math.ceil(ms / MIN)
  if (minutes < 60) return `${minutes} m`
  const h = Math.floor(minutes / 60)
  const m = minutes % 60
  return m ? `${h} h ${m} m` : `${h} h`
}
