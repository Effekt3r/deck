import { existsSync, mkdtempSync, readFileSync, rmSync } from 'node:fs'
import { tmpdir } from 'node:os'
import { join } from 'node:path'
import { afterAll, describe, expect, it } from 'vitest'
import { TempImages } from './temp'

const root = mkdtempSync(join(tmpdir(), 'deck-temp-test-'))
afterAll(() => rmSync(root, { recursive: true, force: true }))

describe('TempImages', () => {
  it('writes a PNG named by its content, the same file for the same content', async () => {
    const dir = join(root, 'Deck clipboard')
    const temp = new TempImages(dir)
    const a = await temp.save(new Uint8Array([1, 2, 3]))
    expect(a.startsWith(dir)).toBe(true)
    expect(a.endsWith('.png')).toBe(true)
    expect([...readFileSync(a)]).toEqual([1, 2, 3])
    expect(await temp.save(new Uint8Array([1, 2, 3]))).toBe(a)
    expect(await temp.save(new Uint8Array([4]))).not.toBe(a)
  })

  it('clear() removes the folder, and is fine when there is none', async () => {
    const temp = new TempImages(join(root, 'gone'))
    await temp.save(new Uint8Array([1]))
    temp.clear()
    expect(existsSync(join(root, 'gone'))).toBe(false)
    expect(() => temp.clear()).not.toThrow()
  })
})
