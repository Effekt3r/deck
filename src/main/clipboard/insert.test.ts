import { describe, expect, it } from 'vitest'
import { insertFor, UNSAFE } from './insert'

const deps = { platform: 'darwin' as const, saveImage: async () => '/tmp/Deck clipboard/clipboard-1.png' }
const image = { kind: 'image' as const, png: new Uint8Array([1]) }

describe('insertFor', () => {
  it('files: quoted paths, separated by spaces', async () => {
    expect(await insertFor({ kind: 'files', paths: ['/a b/c.pdf', '/d.png'] }, false, deps)).toEqual({ text: "'/a b/c.pdf' '/d.png'" })
  })

  it('text, concealed or not: as it is', async () => {
    expect(await insertFor({ kind: 'text', text: 'hi\nthere', concealed: false }, true, deps)).toEqual({ text: 'hi\nthere' })
    expect(await insertFor({ kind: 'text', text: 'pw', concealed: true }, false, deps)).toEqual({ text: 'pw' })
  })

  it('an image, with Claude running: the quoted path of the saved PNG', async () => {
    expect(await insertFor(image, true, deps)).toEqual({ text: "'/tmp/Deck clipboard/clipboard-1.png'" })
  })

  it('an image in a shell tab: nothing, as before', async () => {
    expect(await insertFor(image, false, deps)).toBeNull()
  })

  it("an image that can't be saved: says why", async () => {
    const failing = { ...deps, saveImage: async (): Promise<string> => { throw new Error('disk full') } }
    expect(await insertFor(image, true, failing)).toEqual({ error: "Couldn't save the image for Claude: disk full" })
  })

  it('Windows: PowerShell quoting', async () => {
    expect(await insertFor({ kind: 'files', paths: ["C:\\it's\\a.txt"] }, false, { ...deps, platform: 'win32' })).toEqual({ text: "'C:\\it''s\\a.txt'" })
  })

  it("a file name with control characters: refused, it can't be pasted safely", async () => {
    expect(await insertFor({ kind: 'files', paths: ['/ok.txt', '/bad\u001b[201~name'] }, true, deps)).toEqual({ error: UNSAFE })
  })

  it('files: an empty list is nothing to paste', async () => {
    expect(await insertFor({ kind: 'files', paths: [] }, true, deps)).toBeNull()
  })

  it("an image saved to a path with control characters: refused, it can't be pasted safely", async () => {
    const badPath = { ...deps, saveImage: async () => '/tmp/Deck clipboard/clipboard-\u001b1.png' }
    expect(await insertFor(image, true, badPath)).toEqual({ error: UNSAFE })
  })
})
