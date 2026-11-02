import { describe, expect, it } from 'vitest'
import { mergeWindow } from './merge'

const H = 3_600_000
const w = (usedPercentage: number, resetsAt: number) => ({ usedPercentage, resetsAt })

describe('mergeWindow', () => {
  it('takes the first report', () => {
    expect(mergeWindow(null, w(40, 10 * H))).toEqual(w(40, 10 * H))
  })

  it('keeps the higher percentage within one window: a lower one is older data', () => {
    const now = w(85, 10 * H)
    expect(mergeWindow(now, w(80, 10 * H))).toBe(now)
    expect(mergeWindow(now, w(87, 10 * H))).toEqual(w(87, 10 * H))
    const equal = w(85, 10 * H + 30 * 60_000) // the same window, half an hour apart
    expect(mergeWindow(now, equal)).toBe(equal)
  })

  it('takes a later window even when it is lower, and ignores an earlier one', () => {
    const now = w(85, 10 * H)
    expect(mergeWindow(now, w(3, 15 * H))).toEqual(w(3, 15 * H))
    expect(mergeWindow(now, w(99, 5 * H))).toBe(now)
  })
})
