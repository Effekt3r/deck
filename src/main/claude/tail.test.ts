import { appendFileSync, readFileSync, truncateSync, writeFileSync } from 'node:fs'
import { join } from 'node:path'
import { afterAll, describe, expect, it } from 'vitest'
import { JsonlTail, type LinePlace } from './tail'
import { makeFolder, removeClaudeHomes } from './test-log'

afterAll(removeClaudeHomes)

const file = () => join(makeFolder('deck-tail-'), 'log.jsonl')

describe('JsonlTail', () => {
  it('returns the complete lines, then only what was appended', async () => {
    const path = file()
    writeFileSync(path, '{"a":1}\n{"a":2}\n')
    const tail = new JsonlTail(path)
    expect(await tail.read()).toEqual({
      entries: [{ a: 1 }, { a: 2 }], places: [{ offset: 0, length: 7 }, { offset: 8, length: 7 }], reset: false, more: false,
    })
    expect(await tail.read()).toEqual({ entries: [], places: [], reset: false, more: false })
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
    expect(await tail.read()).toEqual({ entries: [{ b: 1 }], places: [{ offset: 0, length: 7 }], reset: true, more: false })
    expect((await tail.read()).reset).toBe(false)
  })

  it('a missing file reads as nothing, and is read once it appears', async () => {
    const path = file()
    const tail = new JsonlTail(path)
    expect(await tail.read()).toEqual({ entries: [], places: [], reset: false, more: false })
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

  it("each entry's place: its line's offset and length in bytes, exact around multi-byte text, blank and broken lines", async () => {
    const path = file()
    writeFileSync(path, '{"t":"héllo ✻ 😀"}\n\nnot json\n{"t":"wörld"}\r\n')
    const { entries, places } = await new JsonlTail(path).read()
    expect(entries).toEqual([{ t: 'héllo ✻ 😀' }, { t: 'wörld' }])
    expect(places).toEqual([
      { offset: 0, length: Buffer.byteLength('{"t":"héllo ✻ 😀"}') },
      { offset: Buffer.byteLength('{"t":"héllo ✻ 😀"}\n\nnot json\n'), length: Buffer.byteLength('{"t":"wörld"}\r') },
    ])
    const bytes = readFileSync(path)
    places.forEach((p, i) => expect(JSON.parse(bytes.toString('utf8', p.offset, p.offset + p.length))).toEqual(entries[i]))
  })

  it('a line split between two reads keeps the offset where it began', async () => {
    const path = file()
    writeFileSync(path, '{"a":1}\n{"b":"ü')
    const tail = new JsonlTail(path)
    expect((await tail.read()).places).toEqual([{ offset: 0, length: 7 }])
    appendFileSync(path, 'ber"}')
    expect((await tail.read()).places).toEqual([])
    appendFileSync(path, '\n{"c":3}\n')
    expect(await tail.read()).toMatchObject({
      entries: [{ b: 'über' }, { c: 3 }],
      places: [{ offset: 8, length: Buffer.byteLength('{"b":"über"}') }, { offset: 8 + Buffer.byteLength('{"b":"über"}\n'), length: 7 }],
    })
  })

  it('places stay exact when every read is cut short, through lines and characters', async () => {
    const path = file()
    const lines = Array.from({ length: 40 }, (_, i) => JSON.stringify({ i, text: `héllo ✻ ${'x'.repeat(i * 3)}` }))
    writeFileSync(path, `${lines.join('\n')}\n`)
    const tail = new JsonlTail(path)
    const places: LinePlace[] = []
    for (;;) {
      const read = await tail.read(53)
      places.push(...read.places)
      if (!read.more) break
    }
    const bytes = readFileSync(path)
    expect(places.map((p) => bytes.toString('utf8', p.offset, p.offset + p.length))).toEqual(lines)
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
