import { mkdirSync, mkdtempSync, utimesSync, writeFileSync } from 'node:fs'
import { tmpdir } from 'node:os'
import { join, sep } from 'node:path'
import { describe, expect, it } from 'vitest'
import { defaultConfig } from './config'
import { scanProjects } from './scan'

function tree() {
  const root = mkdtempSync(join(tmpdir(), 'deck-scan-'))
  const mk = (rel: string, gitAgeSec?: number) => {
    const p = join(root, rel)
    mkdirSync(p, { recursive: true })
    if (gitAgeSec !== undefined) {
      mkdirSync(join(p, '.git'))
      writeFileSync(join(p, '.git', 'HEAD'), 'ref: refs/heads/main\n')
      const t = Date.now() / 1000 - gitAgeSec
      utimesSync(join(p, '.git', 'HEAD'), t, t)
      utimesSync(p, t, t)
    }
    return p
  }
  return { root, mk }
}

describe('scanProjects', () => {
  it('lists pinned first, then level-1 folders and deeper repos, newest first', async () => {
    const { root, mk } = tree()
    const old = Date.now() / 1000 - 10_000
    const a = mk('a'); utimesSync(a, old, old)                 // plain folder at level 1: listed
    const b = mk('b', 100)                                       // repo
    const d = mk('c/d', 10)                                      // repo at level 2: listed
    mk('c/e')                                                    // plain folder at level 2: not listed
    mk('b/inner', 1); mk('node_modules/x', 1); mk('.hidden', 1) // inside a repo / skipped / hidden
    const c = join(root, 'c'); utimesSync(c, old - 1, old - 1)  // after its children were created
    const pinned = mkdtempSync(join(tmpdir(), 'deck-pinned-'))     // outside the scan root
    const items = await scanProjects({ ...defaultConfig(), pinned: [pinned, b, join(root, 'missing')], scan: [root], depth: 2 }, '/home/none')
    expect(items.map((i) => i.path)).toEqual([pinned, b, d, a, c])
    expect(items.map((i) => i.pinned)).toEqual([true, true, false, false, false])
    expect(items.find((i) => i.path === d)).toMatchObject({ name: 'd', branch: 'main' })
    expect(items.find((i) => i.path === a)?.branch).toBeNull()
  })
  it('honours depth', async () => {
    const { root, mk } = tree()
    mk('x/y/z', 5)
    expect((await scanProjects({ ...defaultConfig(), scan: [root], depth: 2 }, '/h')).map((i) => i.name)).toEqual(['x'])
    expect((await scanProjects({ ...defaultConfig(), scan: [root], depth: 3 }, '/h')).map((i) => i.name)).toContain('z')
  })
  it('treats ~ and a trailing separator as the same pinned folder', async () => {
    const { root, mk } = tree()
    const b = mk('b', 1)
    const items = await scanProjects({ ...defaultConfig(), pinned: ['~/b', b + sep], scan: [root], depth: 1 }, root)
    expect(items.map((i) => [i.path, i.pinned])).toEqual([[b, true]])
  })
})
