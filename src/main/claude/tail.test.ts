import { appendFileSync, truncateSync, writeFileSync } from 'node:fs'
import { join } from 'node:path'
import { afterAll, describe, expect, it } from 'vitest'
import { JsonlTail } from './tail'
import { makeFolder, removeClaudeHomes } from './test-log'

afterAll(removeClaudeHomes)

const file = () => join(makeFolder('deck-tail-'), 'log.jsonl')

describe('JsonlTail', () => {
  it('returns the complete lines, then only what was appended', async () => {
    const path = file()
    writeFileSync(path, '{"a":1}\n{"a":2}\n')
    const tail = new JsonlTail(path)
    expect(await tail.read()).toEqual({ entries: [{ a: 1 }, { a: 2 }], reset: false, more: false })
    expect(await tail.read()).toEqual({ entries: [], reset: false, more: false })
    appendFileSync(path, '{"a":3}\n')
    expect((await tail.read()).entries).toEqual([{ a: 3 }])
  })

  it('a partial last line waits for its newline', async () => {
    const path = file()
    writeFileSync(path, '{"a":1}\n{"a":')
    const tail = new JsonlTail(path)
    expect((await tail.read()).entries).toEqual([{ a: 1 }])
    appendFileSync(path, '2}')
    expect((await tail.read()).entries).toEqual([])
    appendFileSync(path, '\n')
    expect((await tail.read()).entries).toEqual([{ a: 2 }])
  })

  it('skips lines that are not JSON, and blank lines; CRLF is fine', async () => {
    const path = file()
    writeFileSync(path, '{"a":1}\nnot json\n\n{"a":2}\r\n{"a":\n')
    expect((await new JsonlTail(path).read()).entries).toEqual([{ a: 1 }, { a: 2 }])
  })

  it('reads a file that shrank again from the start, with reset', async () => {
    const path = file()
    writeFileSync(path, '{"a":1}\n{"a":2}\n')
    const tail = new JsonlTail(path)
    await tail.read()
    truncateSync(path, 0)
    appendFileSync(path, '{"b":1}\n')
    expect(await tail.read()).toEqual({ entries: [{ b: 1 }], reset: true, more: false })
    expect((await tail.read()).reset).toBe(false)
  })

  it('a missing file reads as nothing, and is read once it appears', async () => {
    const path = file()
    const tail = new JsonlTail(path)
    expect(await tail.read()).toEqual({ entries: [], reset: false, more: false })
    writeFileSync(path, '{"a":1}\n')
    expect((await tail.read()).entries).toEqual([{ a: 1 }])
  })

  it('reads at most maxBytes per call, keeping multi-byte characters whole', async () => {
    const path = file()
    const lines = Array.from({ length: 50 }, (_, i) => JSON.stringify({ i, text: `héllo wörld ✻ ${'x'.repeat(i)}` }))
    writeFileSync(path, `${lines.join('\n')}\n`)
    const tail = new JsonlTail(path)
    const got: unknown[] = []
    let calls = 0
    for (;;) {
      const { entries, more } = await tail.read(97) // smaller than some lines, and cuts through characters
      got.push(...entries)
      calls++
      if (!more) break
    }
    expect(calls).toBeGreaterThan(10)
    expect(got).toEqual(lines.map((l) => JSON.parse(l)))
  })

  it('remembers the size and modification time it last saw', async () => {
    const path = file()
    writeFileSync(path, '{"a":1}\n')
    const tail = new JsonlTail(path)
    expect(tail.modified).toBe(0)
    await tail.read()
    expect(tail.size).toBe(8)
    expect(tail.modified).toBeGreaterThan(0)
  })
})
