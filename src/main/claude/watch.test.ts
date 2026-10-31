import { appendFileSync, writeFileSync } from 'node:fs'
import { join } from 'node:path'
import { afterAll, describe, expect, it, vi } from 'vitest'
import { makeFolder, removeClaudeHomes } from './test-log'
import { watchDirs } from './watch'

afterAll(removeClaudeHomes)
const sleep = (ms: number) => new Promise((resolve) => setTimeout(resolve, ms))

describe('watchDirs', () => {
  it("reports a file appended to in a watched folder, with its name, until stopped", async () => {
    const dir = makeFolder('deck-watch-')
    const log = join(dir, 's1.jsonl')
    writeFileSync(log, '{}\n')
    const names: (string | null)[] = []
    const stop = watchDirs([dir], (name) => names.push(name))
    expect(stop).not.toBeNull()
    await sleep(300) // let the OS watcher settle
    appendFileSync(log, '{}\n')
    await vi.waitFor(() => expect(names).toContain('s1.jsonl'), { timeout: 2000, interval: 25 })
    stop?.()
    await sleep(100)
    names.length = 0
    appendFileSync(log, '{}\n')
    await sleep(500)
    expect(names).toEqual([])
  })

  it('skips folders that are missing; null when none could be watched', () => {
    const dir = makeFolder('deck-watch-')
    expect(watchDirs([join(dir, 'missing')], () => {})).toBeNull()
    const stop = watchDirs([join(dir, 'missing'), dir], () => {})
    expect(stop).not.toBeNull()
    stop?.()
  })
})
