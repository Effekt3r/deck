import { mkdirSync, mkdtempSync, rmSync, statSync, writeFileSync } from 'node:fs'
import { tmpdir } from 'node:os'
import { join } from 'node:path'
import { afterAll, describe, expect, it } from 'vitest'
import { PicksStore } from './picks'

const root = mkdtempSync(join(tmpdir(), 'deck-picks-'))
afterAll(() => rmSync(root, { recursive: true, force: true }))

describe('PicksStore', () => {
  it('remembers the devices picked in each project, latest first, across restarts', async () => {
    const file = join(root, 'devices.json')
    const store = new PicksStore(file)
    expect(await store.get('/Volumes/Wyobi/AccessControl_Guard')).toEqual([])
    await store.set('/Volumes/Wyobi/AccessControl_Guard', 'android:8d2e61a')
    await store.set('/Volumes/Wyobi/AccessControl_Android', 'emulator:Pixel_9')
    await store.set('/Volumes/Wyobi/AccessControl_Android', 'android:R5CW20XY7QZ')
    const again = new PicksStore(file)
    expect(await again.get('/Volumes/Wyobi/AccessControl_Guard')).toEqual(['android:8d2e61a'])
    expect(await again.get('/Volumes/Wyobi/AccessControl_Android')).toEqual(['android:R5CW20XY7QZ', 'emulator:Pixel_9'])
  })

  it('moves a device picked again to the front, and keeps the last 8', async () => {
    const store = new PicksStore(join(root, 'order.json'))
    for (let i = 0; i < 10; i++) await store.set('/r', `android:d${i}`)
    await store.set('/r', 'android:d5')
    expect(await store.get('/r')).toEqual(['android:d5', 'android:d9', 'android:d8', 'android:d7', 'android:d6', 'android:d4', 'android:d3', 'android:d2'])
  })

  it('reads the file Deck 0.4 wrote, one device per project, and adds to it', async () => {
    const file = join(root, 'v0.4.json')
    writeFileSync(file, JSON.stringify({ '/guard': 'android:8d2e61a' }))
    const store = new PicksStore(file)
    expect(await store.get('/guard')).toEqual(['android:8d2e61a'])
    await store.set('/guard', 'android:R5CW20XY7QZ')
    expect(await new PicksStore(file).get('/guard')).toEqual(['android:R5CW20XY7QZ', 'android:8d2e61a'])
  })

  it("concurrent sets don't lose writes", async () => {
    const file = join(root, 'concurrent.json')
    const store = new PicksStore(file)
    await Promise.all(Array.from({ length: 20 }, (_, i) => store.set(`/r${i}`, `android:d${i}`)))
    const reloaded = new PicksStore(file)
    for (let i = 0; i < 20; i++) expect(await reloaded.get(`/r${i}`)).toEqual([`android:d${i}`])
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
    expect(await store.get('/r')).toEqual([])
    await store.set('/r', 'android:x')
    expect(await new PicksStore(file).get('/r')).toEqual(['android:x'])
    writeFileSync(file, JSON.stringify({ '/odd': 3, '/ok': 'android:y', '/mixed': ['android:z', 3, '', 'android:z', 'android:w'], '/none': [], '/deep': [['x']] }))
    const odd = new PicksStore(file)
    expect(await odd.get('/odd')).toEqual([])
    expect(await odd.get('/ok')).toEqual(['android:y'])
    expect(await odd.get('/mixed')).toEqual(['android:z', 'android:w'])
    expect(await odd.get('/none')).toEqual([])
    expect(await odd.get('/deep')).toEqual([])
  })
})
