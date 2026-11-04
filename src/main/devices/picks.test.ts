import { mkdirSync, mkdtempSync, rmSync, statSync, writeFileSync } from 'node:fs'
import { tmpdir } from 'node:os'
import { join } from 'node:path'
import { afterAll, describe, expect, it } from 'vitest'
import { PicksStore } from './picks'

const root = mkdtempSync(join(tmpdir(), 'deck-picks-'))
afterAll(() => rmSync(root, { recursive: true, force: true }))

describe('PicksStore', () => {
  it("remembers each project's device across restarts", async () => {
    const file = join(root, 'devices.json')
    const store = new PicksStore(file)
    expect(await store.get('/Volumes/Wyobi/AccessControl_Guard')).toBeNull()
    await store.set('/Volumes/Wyobi/AccessControl_Guard', 'android:8d2e61a')
    await store.set('/Volumes/Wyobi/AccessControl_Android', 'emulator:Pixel_9')
    await store.set('/Volumes/Wyobi/AccessControl_Android', 'android:R5CW20XY7QZ')
    const again = new PicksStore(file)
    expect(await again.get('/Volumes/Wyobi/AccessControl_Guard')).toBe('android:8d2e61a')
    expect(await again.get('/Volumes/Wyobi/AccessControl_Android')).toBe('android:R5CW20XY7QZ')
  })

  it("concurrent sets don't lose writes", async () => {
    const file = join(root, 'concurrent.json')
    const store = new PicksStore(file)
    await Promise.all(Array.from({ length: 20 }, (_, i) => store.set(`/r${i}`, `android:d${i}`)))
    const reloaded = new PicksStore(file)
    for (let i = 0; i < 20; i++) expect(await reloaded.get(`/r${i}`)).toBe(`android:d${i}`)
  })

  it("never saves over a store it couldn't read", async () => {
    const file = join(root, 'eisdir.json')
    mkdirSync(file) // reading it fails with EISDIR, not "missing"
    const store = new PicksStore(file)
    await expect(store.get('/r')).rejects.toThrow()
    await expect(store.set('/r', 'android:x')).rejects.toThrow()
    expect(statSync(file).isDirectory()).toBe(true)
  })

  it('treats a broken or odd file as empty and replaces it on the next set', async () => {
    const file = join(root, 'broken.json')
    writeFileSync(file, '{ not json')
    const store = new PicksStore(file)
    expect(await store.get('/r')).toBeNull()
    await store.set('/r', 'android:x')
    expect(await new PicksStore(file).get('/r')).toBe('android:x')
    writeFileSync(file, JSON.stringify({ '/odd': 3, '/ok': 'android:y', '/arr': ['x'] }))
    const odd = new PicksStore(file)
    expect(await odd.get('/odd')).toBeNull()
    expect(await odd.get('/ok')).toBe('android:y')
    expect(await odd.get('/arr')).toBeNull()
  })
})
