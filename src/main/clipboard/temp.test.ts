import { chmodSync, existsSync, mkdtempSync, readFileSync, rmSync, writeFileSync } from 'node:fs'
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

  it('the folder does not exist before the first save, and does after', async () => {
    const dir = join(root, 'not-yet')
    expect(existsSync(dir)).toBe(false)
    const temp = new TempImages(dir)
    await temp.save(new Uint8Array([9]))
    expect(existsSync(dir)).toBe(true)
  })

  it('save works again after clear()', async () => {
    const dir = join(root, 'reuse')
    const temp = new TempImages(dir)
    const a = await temp.save(new Uint8Array([5, 6]))
    temp.clear()
    expect(existsSync(dir)).toBe(false)
    const b = await temp.save(new Uint8Array([5, 6]))
    expect(b).toBe(a)
    expect(existsSync(b)).toBe(true)
  })

  it("an unrelated file survives clear(), and the folder stays because it's not empty", async () => {
    const dir = join(root, 'mixed')
    const temp = new TempImages(dir)
    await temp.save(new Uint8Array([7]))
    const other = join(dir, 'notes.txt')
    writeFileSync(other, 'keep me')
    temp.clear()
    expect(existsSync(dir)).toBe(true)
    expect(readFileSync(other, 'utf8')).toBe('keep me')
  })

  it('does not rewrite an existing file with the same content', async () => {
    const dir = join(root, 'no-rewrite')
    const temp = new TempImages(dir)
    const a = await temp.save(new Uint8Array([1, 2, 3]))
    // Same length as [1, 2, 3]; a save() that rewrote the file would replace this with [1, 2, 3].
    writeFileSync(a, new Uint8Array([9, 9, 9]))
    const b = await temp.save(new Uint8Array([1, 2, 3]))
    expect(b).toBe(a)
    expect([...readFileSync(a)]).toEqual([9, 9, 9])
  })

  // chmod-based permission denial isn't meaningful on Windows (and ACLs there work differently).
  it.skipIf(process.platform === 'win32')('clear() does not throw when the folder cannot be written to', async () => {
    const dir = join(root, 'locked')
    const temp = new TempImages(dir)
    await temp.save(new Uint8Array([3]))
    chmodSync(dir, 0o500) // read + execute, no write: unlink (and rmdir) inside it fail
    try {
      expect(() => temp.clear()).not.toThrow()
    } finally {
      chmodSync(dir, 0o700) // so afterAll's rmSync can still remove it
    }
  })
})
