import { mkdtempSync, rmSync, writeFileSync } from 'node:fs'
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

  it('reads a broken file as empty', async () => {
    const file = join(root, 'broken.json')
    writeFileSync(file, '{ not json')
    expect(await new PicksStore(file).get('/x')).toBeNull()
  })
})
