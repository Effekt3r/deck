import { mkdtempSync, rmSync, writeFileSync } from 'node:fs'
import { tmpdir } from 'node:os'
import { join } from 'node:path'
import { afterAll, describe, expect, it } from 'vitest'
import { UsageStore } from './store'

const root = mkdtempSync(join(tmpdir(), 'deck-usage-store-'))
afterAll(() => rmSync(root, { recursive: true, force: true }))
let n = 0
const file = () => join(root, `usage-${++n}.json`)
const MIN = 60_000
const H = 60 * MIN

describe('UsageStore', () => {
  it('keeps what counted, saves it and reads it back after a restart', async () => {
    const f = file()
    const store = new UsageStore(f)
    await store.load()
    expect(store.get()).toEqual({ windows: {}, updatedAt: null })
    expect(store.add({ seven_day: { usedPercentage: 85, resetsAt: 100 * H } }, 1000)).toBe(true)
    expect(store.add({
      five_hour: { usedPercentage: 34, resetsAt: 20 * H },
      seven_day: { usedPercentage: 86, resetsAt: 100 * H },
    }, 2000)).toBe(true)
    await store.flush()
    const again = new UsageStore(f)
    await again.load()
    expect(again.get()).toEqual({
      windows: {
        five_hour: { usedPercentage: 34, resetsAt: 20 * H, seenAt: 2000 },
        seven_day: { usedPercentage: 86, resetsAt: 100 * H, seenAt: 2000 },
      },
      updatedAt: 2000,
    })
  })

  it("ignores a report that doesn't count, and doesn't call it an update", async () => {
    const store = new UsageStore(file())
    store.add({ seven_day: { usedPercentage: 85, resetsAt: 100 * H } }, 5000)
    expect(store.add({ seven_day: { usedPercentage: 80, resetsAt: 100 * H } }, 6000)).toBe(false) // older data
    expect(store.add({}, 7000)).toBe(false)
    expect(store.get().updatedAt).toBe(5000)
    expect(store.get().windows.seven_day?.usedPercentage).toBe(85)
    await store.flush()
  })

  it('takes a lower figure for the same window once the kept one is 10 minutes old', async () => {
    const store = new UsageStore(file())
    store.add({ seven_day: { usedPercentage: 85, resetsAt: 100 * H } }, 0)
    expect(store.add({ seven_day: { usedPercentage: 60, resetsAt: 100 * H } }, 9 * MIN)).toBe(false)
    expect(store.add({ seven_day: { usedPercentage: 60, resetsAt: 100 * H } }, 10 * MIN)).toBe(true)
    expect(store.get()).toEqual({ windows: { seven_day: { usedPercentage: 60, resetsAt: 100 * H, seenAt: 10 * MIN } }, updatedAt: 10 * MIN })
    await store.flush()
  })

  it("doesn't count the same report read again, but does a new one with the same numbers", async () => {
    const store = new UsageStore(file())
    const report = { seven_day: { usedPercentage: 85, resetsAt: 100 * H } }
    expect(store.add(report, 5000)).toBe(true)
    expect(store.add(report, 5000)).toBe(false) // statusline.json read again when the window comes to the front
    expect(store.add(report, 6000)).toBe(true) // the next reply, with nothing used meanwhile
    expect(store.get()).toEqual({ windows: { seven_day: { ...report.seven_day, seenAt: 6000 } }, updatedAt: 6000 })
    await store.flush()
  })

  it('forgets everything on clear(), usage.json too', async () => {
    const f = file()
    const store = new UsageStore(f)
    store.add({ seven_day: { usedPercentage: 85, resetsAt: 100 * H } }, 5000)
    store.clear()
    expect(store.get()).toEqual({ windows: {}, updatedAt: null })
    await store.flush()
    const again = new UsageStore(f)
    await again.load()
    expect(again.get()).toEqual({ windows: {}, updatedAt: null })
  })

  it('dates windows kept without seenAt (an older usage.json) by updatedAt', async () => {
    const f = file()
    writeFileSync(f, JSON.stringify({ windows: { seven_day: { usedPercentage: 85, resetsAt: 100 * H } }, updatedAt: 5000 }))
    const store = new UsageStore(f)
    await store.load()
    expect(store.get().windows.seven_day).toEqual({ usedPercentage: 85, resetsAt: 100 * H, seenAt: 5000 })
  })

  it('starts empty from a broken file', async () => {
    const f = file()
    writeFileSync(f, '{ not json')
    const store = new UsageStore(f)
    await store.load()
    expect(store.get()).toEqual({ windows: {}, updatedAt: null })
    writeFileSync(f, JSON.stringify({ windows: { seven_day: { usedPercentage: 'x', resetsAt: 1 } }, updatedAt: 'y' }))
    await store.load()
    expect(store.get()).toEqual({ windows: {}, updatedAt: null })
  })
})
