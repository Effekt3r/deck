import { readFileSync, writeFileSync } from 'node:fs'
import { join } from 'node:path'
import { afterAll, describe, expect, it } from 'vitest'
import { TargetsStore } from './targets-store'
import { makeDir, removeRepos } from './test-repo'

afterAll(removeRepos)

const file = () => join(makeDir('deck-targets-'), 'sub', 'git-targets.json')

describe('TargetsStore', () => {
  it('sets, gets and clears an override per repo and branch', async () => {
    const store = new TargetsStore(file())
    expect(await store.get('/r', 'feature')).toBeNull()
    await store.set('/r', 'feature', 'origin/dev')
    await store.set('/r', 'other', 'main')
    await store.set('/elsewhere', 'feature', 'main')
    expect(await store.get('/r', 'feature')).toBe('origin/dev')
    await store.set('/r', 'feature', null)
    expect(await store.get('/r', 'feature')).toBeNull()
    expect(await store.get('/r', 'other')).toBe('main')
    expect(await store.get('/elsewhere', 'feature')).toBe('main')
  })

  it('survives a reload and keeps repos keyed by folder, however it is spelled', async () => {
    const f = file()
    await new TargetsStore(f).set('/r/repo', 'feature', 'dev')
    const reloaded = new TargetsStore(f)
    expect(await reloaded.get('/r/repo', 'feature')).toBe('dev')
    expect(await reloaded.get('/r/repo/', 'feature')).toBe('dev')
    await reloaded.set('/r/repo', 'feature', null)
    expect(JSON.parse(readFileSync(f, 'utf8'))).toEqual({}) // empty repos are dropped
  })

  it("concurrent sets don't lose writes", async () => {
    const f = file()
    const store = new TargetsStore(f)
    await Promise.all(Array.from({ length: 20 }, (_, i) => store.set('/r', `b${i}`, `t${i}`)))
    const reloaded = new TargetsStore(f)
    for (let i = 0; i < 20; i++) expect(await reloaded.get('/r', `b${i}`)).toBe(`t${i}`)
  })

  it('treats a broken or odd file as empty and replaces it on the next set', async () => {
    const f = join(makeDir('deck-targets-'), 'git-targets.json')
    writeFileSync(f, '{ not json')
    const store = new TargetsStore(f)
    expect(await store.get('/r', 'feature')).toBeNull()
    await store.set('/r', 'feature', 'dev')
    expect(await new TargetsStore(f).get('/r', 'feature')).toBe('dev')
    writeFileSync(f, JSON.stringify({ '/r': { feature: 3, ok: 'main' }, '/s': 'nope' }))
    const odd = new TargetsStore(f)
    expect(await odd.get('/r', 'feature')).toBeNull()
    expect(await odd.get('/r', 'ok')).toBe('main')
  })
})
