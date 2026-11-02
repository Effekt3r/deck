import { describe, expect, it } from 'vitest'
import { readReport } from './report'

describe('readReport', () => {
  it("takes both windows from Claude Code's status line input, resets_at in ms", () => {
    const input = {
      session_id: 's',
      cwd: '/x',
      rate_limits: {
        five_hour: { used_percentage: 34.5, resets_at: 1_793_620_800 },
        seven_day: { used_percentage: 85, resets_at: 1_793_653_200 },
      },
    }
    expect(readReport(input)).toEqual({
      five_hour: { usedPercentage: 34.5, resetsAt: 1_793_620_800_000 },
      seven_day: { usedPercentage: 85, resetsAt: 1_793_653_200_000 },
    })
  })

  it('keeps a window that comes alone (seen live: only seven_day)', () => {
    expect(readReport({ rate_limits: { seven_day: { used_percentage: 85, resets_at: 1_793_653_200 } } }))
      .toEqual({ seven_day: { usedPercentage: 85, resetsAt: 1_793_653_200_000 } })
  })

  it('is empty before the first API response, and for anything that is not a report', () => {
    for (const input of [{}, { rate_limits: null }, { rate_limits: [] }, null, 'x', 42, []]) {
      expect(readReport(input)).toEqual({})
    }
  })

  it('skips windows without finite numbers or a real reset time, and limits it does not show', () => {
    expect(readReport({
      rate_limits: {
        five_hour: { used_percentage: '34', resets_at: 1_793_620_800 },
        seven_day: { used_percentage: 85, resets_at: 0 },
        spend_limit: { used_percentage: 12, resets_at: 1_793_653_200 },
      },
    })).toEqual({})
  })

  it('keeps the percentage within 0–100', () => {
    const report = readReport({
      rate_limits: {
        five_hour: { used_percentage: 120, resets_at: 1 },
        seven_day: { used_percentage: -3, resets_at: 1 },
      },
    })
    expect(report.five_hour?.usedPercentage).toBe(100)
    expect(report.seven_day?.usedPercentage).toBe(0)
  })
})
