import { mkdtempSync, readdirSync, readFileSync, rmSync, statSync, writeFileSync } from 'node:fs'
import { tmpdir } from 'node:os'
import { join } from 'node:path'
import { afterAll, describe, expect, it } from 'vitest'
import { writeFileAtomic } from './atomic'

const root = mkdtempSync(join(tmpdir(), 'deck-atomic-'))
afterAll(() => rmSync(root, { recursive: true, force: true }))

describe('writeFileAtomic', () => {
  it('writes a new file and replaces an old one, leaving no temp file', async () => {
    const file = join(root, 'a.json')
    await writeFileAtomic(file, 'one')
    await writeFileAtomic(file, 'two')
    expect(readFileSync(file, 'utf8')).toBe('two')
    expect(readdirSync(root).filter((n) => n.startsWith('a.json'))).toEqual(['a.json'])
  })

  it.skipIf(process.platform === 'win32')('gives the new file the mode it is asked for', async () => {
    const file = join(root, 'b.json')
    writeFileSync(file, 'old', { mode: 0o600 })
    await writeFileAtomic(file, 'new', 0o600)
    expect(statSync(file).mode & 0o777).toBe(0o600)
  })

  it('rejects when the folder is missing', async () => {
    await expect(writeFileAtomic(join(root, 'missing', 'c.json'), 'x')).rejects.toThrow()
  })
})
