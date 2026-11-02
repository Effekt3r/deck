import { describe, expect, it } from 'vitest'
import type { UsageWindow } from '@shared/types'
import { type Formats, resetText, toneOf, updatedText, usageView } from './view'

const MIN = 60_000
const H = 60 * MIN
const DAY = 24 * H
/** UTC, 24-hour, English day names: the tests don't depend on the machine's zone or locale. */
const utc: Formats = {
  clock: (ms) => new Date(ms).toISOString().slice(11, 16),
  weekday: (ms) => ['Sun', 'Mon', 'Tue', 'Wed', 'Thu', 'Fri', 'Sat'][new Date(ms).getUTCDay()],
  dayNumber: (ms) => Math.floor(ms / DAY),
}
/** Monday 2 November 2026, 11:44 UTC. */
const now = Date.UTC(2026, 10, 2, 11, 44)
const win = (usedPercentage: number, resetsAt: number): UsageWindow => ({ usedPercentage, resetsAt })

describe('toneOf', () => {
  it('turns amber from 75% and red from 90%', () => {
    expect([0, 74, 75, 89, 90, 100].map(toneOf)).toEqual(['ok', 'ok', 'high', 'high', 'max', 'max'])
  })
})

describe('resetText', () => {
  it('counts down within 5 hours', () => {
    expect(resetText(now + 2 * H + 10 * MIN, now, utc)).toBe('resets in 2 h 10 m')
    expect(resetText(now + 3 * H, now, utc)).toBe('resets in 3 h')
    expect(resetText(now + 25 * MIN, now, utc)).toBe('resets in 25 m')
    expect(resetText(now + 30_000, now, utc)).toBe('resets in 1 m')
  })
  it('names the time later today, tomorrow or on a weekday', () => {
    expect(resetText(Date.UTC(2026, 10, 2, 23, 0), now, utc)).toBe('resets 23:00')
    expect(resetText(Date.UTC(2026, 10, 3, 9, 0), now, utc)).toBe('resets tomorrow 09:00')
    expect(resetText(Date.UTC(2026, 10, 5, 9, 0), now, utc)).toBe('resets Thu 09:00')
  })
  it('says "next" for a weekday a week or more away, which would otherwise read as today', () => {
    expect(resetText(Date.UTC(2026, 10, 8, 9, 0), now, utc)).toBe('resets Sun 09:00')
    expect(resetText(Date.UTC(2026, 10, 9, 9, 0), now, utc)).toBe('resets next Mon 09:00')
  })
  it('says when a past window reset', () => {
    expect(resetText(Date.UTC(2026, 10, 2, 9, 0), now, utc)).toBe('reset at 09:00')
    expect(resetText(Date.UTC(2026, 10, 1, 23, 0), now, utc)).toBe('reset Sun 23:00')
  })
})

describe('updatedText', () => {
  it('says how long ago Claude Code reported', () => {
    expect(updatedText(null, now, utc)).toBe('')
    expect(updatedText(now - 30_000, now, utc)).toBe('updated just now')
    expect(updatedText(now + 5000, now, utc)).toBe('updated just now') // clocks disagree
    expect(updatedText(now - 2 * MIN, now, utc)).toBe('updated 2 min ago')
    expect(updatedText(now - 3 * H, now, utc)).toBe('updated 3 h ago')
    expect(updatedText(now - 2 * DAY, now, utc)).toBe('updated Sat 11:44')
  })
})

describe('usageView', () => {
  const week = win(85, Date.UTC(2026, 10, 2, 23, 0))
  const fiveHour = win(34.4, now + 2 * H + 10 * MIN)

  it('draws the week outside and the 5-hour window inside, the fuller one in the middle', () => {
    const v = usageView({ sevenDay: week, fiveHour, updatedAt: now - 2 * MIN }, now, utc)
    expect(v.rings.map((r) => [r.key, r.label, r.percent, r.tone, r.reset])).toEqual([
      ['week', 'Week', 85, 'high', 'resets 23:00'],
      ['5h', '5-hour', 34, 'ok', 'resets in 2 h 10 m'],
    ])
    expect(v.top?.key).toBe('week')
    expect(v.summary).toBe('week 85% · 5h 34%')
    expect(v.label).toBe('Week 85% used, 5-hour 34% used')
    expect(v.updated).toBe('updated 2 min ago')
    expect(usageView({ sevenDay: week, fiveHour: win(95, fiveHour.resetsAt), updatedAt: now }, now, utc).top?.key).toBe('5h')
  })

  it('leaves out a window Claude Code did not report', () => {
    const v = usageView({ sevenDay: week, fiveHour: null, updatedAt: now }, now, utc)
    expect(v.rings.map((r) => r.key)).toEqual(['week'])
    expect(v.summary).toBe('week 85%')
  })

  it('shows a window whose reset has passed as 0% until the next report', () => {
    const v = usageView({ sevenDay: null, fiveHour: win(97, now - 10 * MIN), updatedAt: now - 3 * H }, now, utc)
    expect(v.rings[0]).toMatchObject({ percent: 0, tone: 'ok', past: true, reset: 'reset at 11:34' })
  })

  it('has nothing to draw before the first report', () => {
    expect(usageView({ sevenDay: null, fiveHour: null, updatedAt: null }, now, utc))
      .toMatchObject({ rings: [], top: null, summary: '', updated: '', label: '' })
  })

  it('keeps percentages within 0–100', () => {
    expect(usageView({ sevenDay: win(130, week.resetsAt), fiveHour: null, updatedAt: now }, now, utc).rings[0].percent).toBe(100)
  })
})
