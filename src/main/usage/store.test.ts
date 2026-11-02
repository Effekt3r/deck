import { mkdtempSync, rmSync, writeFileSync } from 'node:fs'
import { tmpdir } from 'node:os'
import { join } from 'node:path'
import { afterAll, describe, expect, it } from 'vitest'
import { UsageStore } from './store'

const root = mkdtempSync(join(tmpdir(), 'deck-usage-store-'))
afterAll(() => rmSync(root, { recursive: true, force: true }))
let n = 0
const file = () => join(root, `usage-${++n}.json`)
const H = 3_600_000

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
      windows: { five_hour: { usedPercentage: 34, resetsAt: 20 * H }, seven_day: { usedPercentage: 86, resetsAt: 100 * H } },
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
