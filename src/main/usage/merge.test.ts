import { describe, expect, it } from 'vitest'
import { mergeWindow, type SeenWindow } from './merge'

const MIN = 60_000
const H = 60 * MIN
const w = (usedPercentage: number, resetsAt: number, seenAt = 0): SeenWindow => ({ usedPercentage, resetsAt, seenAt })

describe('mergeWindow', () => {
  it('takes the first report', () => {
    expect(mergeWindow(null, w(40, 10 * H))).toEqual(w(40, 10 * H))
  })

  it('takes a higher or equal percentage within one window', () => {
    const now = w(85, 10 * H)
    expect(mergeWindow(now, w(87, 10 * H, MIN))).toEqual(w(87, 10 * H, MIN))
    const equal = w(85, 10 * H + 30 * MIN, MIN) // the same window, half an hour apart
    expect(mergeWindow(now, equal)).toBe(equal)
  })

  it('keeps a lower percentage for the same window out for 10 minutes: it is most likely older data', () => {
    const now = w(85, 10 * H, 5 * H)
    expect(mergeWindow(now, w(80, 10 * H, 5 * H + 9 * MIN))).toBe(now)
    expect(mergeWindow(now, w(80, 10 * H, 4 * H))).toBe(now) // written before the kept one
  })

  it('takes a lower percentage once the kept one is 10 minutes old: usage can drop within a window', () => {
    const now = w(85, 10 * H, 5 * H)
    const lower = w(20, 10 * H, 5 * H + 10 * MIN) // a plan upgrade, or a reset by Anthropic
    expect(mergeWindow(now, lower)).toBe(lower)
  })

  it('takes a later window even when it is lower, and ignores an earlier one', () => {
    const now = w(85, 10 * H)
    expect(mergeWindow(now, w(3, 15 * H))).toEqual(w(3, 15 * H))
    expect(mergeWindow(now, w(99, 5 * H, H))).toBe(now)
  })
})
