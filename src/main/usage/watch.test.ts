import { existsSync, mkdirSync, mkdtempSync, renameSync, rmSync, utimesSync, writeFileSync } from 'node:fs'
import { tmpdir } from 'node:os'
import { join } from 'node:path'
import { afterAll, describe, expect, it, vi } from 'vitest'
import { readReportFile, removeLeftovers, watchReports } from './watch'

const root = mkdtempSync(join(tmpdir(), 'deck-usage-watch-'))
afterAll(() => rmSync(root, { recursive: true, force: true }))
let n = 0
const dir = () => {
  const d = join(root, String(++n))
  mkdirSync(d)
  return d
}
const report = JSON.stringify({ rate_limits: { seven_day: { used_percentage: 85, resets_at: 1_793_653_200 } } })

describe('readReportFile', () => {
  it("reads the report, dated by the file's modification time", async () => {
    const f = join(dir(), 'statusline.json')
    writeFileSync(f, report)
    utimesSync(f, 1_700_000_000, 1_700_000_000)
    expect(await readReportFile(f)).toEqual({
      report: { seven_day: { usedPercentage: 85, resetsAt: 1_793_653_200_000 } },
      at: 1_700_000_000_000,
    })
  })

  it('gives null for a missing file, half a file and an oversized one', async () => {
    const f = join(dir(), 'statusline.json')
    expect(await readReportFile(f)).toBeNull()
    writeFileSync(f, report.slice(0, 20))
    expect(await readReportFile(f)).toBeNull()
    writeFileSync(f, ' '.repeat(1024 * 1024 + 1))
    expect(await readReportFile(f)).toBeNull()
  })
})

describe('watchReports', () => {
  it('calls back once a report is moved into place', async () => {
    const d = dir()
    const changed = vi.fn()
    const stop = watchReports(d, changed, 20)
    try {
      writeFileSync(join(d, '.statusline.1.tmp'), report)
      renameSync(join(d, '.statusline.1.tmp'), join(d, 'statusline.json'))
      await vi.waitFor(() => expect(changed).toHaveBeenCalled(), { timeout: 3000 })
    } finally {
      stop()
    }
  })
})

describe('removeLeftovers', () => {
  it('removes temp files older than a minute, and nothing else', async () => {
    const d = dir()
    for (const name of ['.statusline.1.tmp', '.statusline.2.tmp', 'statusline.json']) writeFileSync(join(d, name), 'x')
    const old = Date.now() / 1000 - 120
    utimesSync(join(d, '.statusline.1.tmp'), old, old)
    utimesSync(join(d, 'statusline.json'), old, old)
    await removeLeftovers(d)
    expect(existsSync(join(d, '.statusline.1.tmp'))).toBe(false)
    expect(existsSync(join(d, '.statusline.2.tmp'))).toBe(true)
    expect(existsSync(join(d, 'statusline.json'))).toBe(true)
  })
})
