import { tmpdir } from 'node:os'
import { join } from 'node:path'
import { pathToFileURL } from 'node:url'
import { beforeEach, describe, expect, it, vi } from 'vitest'
import { readClipboard } from './read'

const raw = (format: string) => `electron application/osclipboard;format="${format}"`
const fake = vi.hoisted(() => ({
  /** The clipboard's one item: type → data. Empty: nothing on the clipboard. */
  data: {} as Record<string, string | Uint8Array<ArrayBuffer>>,
  /** Formats clipboard.has() reports beyond the item's own types, as Windows may. */
  has: new Set<string>(),
}))
vi.mock('electron', () => ({
  clipboard: {
    read: async () => {
      const types = Object.keys(fake.data)
      if (!types.length) return []
      return [{
        types,
        getType: async (type: string) => {
          if (!(type in fake.data)) throw new Error(`no ${type}`)
          return new Blob([fake.data[type]])
        },
      }]
    },
    has: async (format: string) => format in fake.data || fake.has.has(format),
  },
}))

beforeEach(() => {
  fake.data = {}
  fake.has = new Set()
})

describe('readClipboard', () => {
  it('is null for an empty clipboard, or one with nothing Deck pastes', async () => {
    expect(await readClipboard()).toBeNull()
    fake.data = { 'electron application/findtext': 'x' }
    expect(await readClipboard()).toBeNull()
  })

  it('reads text', async () => {
    fake.data = { 'text/plain': 'hello' }
    expect(await readClipboard()).toEqual({ kind: 'text', text: 'hello', concealed: false })
  })

  it("marks a password manager's copy concealed (macOS: its marker is among the types)", async () => {
    fake.data = { 'text/plain': 's3cret', [raw('org.nspasteboard.ConcealedType')]: '' }
    expect(await readClipboard()).toEqual({ kind: 'text', text: 's3cret', concealed: true })
  })

  it('marks it concealed when only has() knows the marker (Windows)', async () => {
    fake.data = { 'text/plain': 's3cret' }
    fake.has.add(raw('ExcludeClipboardContentFromMonitorProcessing'))
    expect(await readClipboard()).toMatchObject({ concealed: true })
  })

  it("marks it concealed when Windows' clipboard history is told to skip it (DWORD 0), not when allowed", async () => {
    fake.data = { 'text/plain': 's3cret', [raw('CanIncludeInClipboardHistory')]: new Uint8Array([0, 0, 0, 0]) }
    expect(await readClipboard()).toMatchObject({ concealed: true })
    fake.data = { 'text/plain': 'fine', [raw('CanIncludeInClipboardHistory')]: new Uint8Array([1, 0, 0, 0]) }
    expect(await readClipboard()).toMatchObject({ concealed: false })
  })

  it('reads every copied file from the uri-list', async () => {
    const paths = [join(tmpdir(), 'a b.pdf'), join(tmpdir(), 'c.png')]
    fake.data = { 'text/uri-list': paths.map((p) => pathToFileURL(p).href).join('\r\n'), 'text/plain': 'a b.pdf' }
    expect(await readClipboard()).toEqual({ kind: 'files', paths })
  })

  it('takes a uri-list of web links as the text that comes with it', async () => {
    fake.data = { 'text/uri-list': 'https://example.com/', 'text/plain': 'https://example.com/' }
    expect(await readClipboard()).toEqual({ kind: 'text', text: 'https://example.com/', concealed: false })
  })

  it('prefers text over the picture an Excel or Word copy carries', async () => {
    fake.data = { 'text/plain': 'A1\tB1', 'image/png': new Uint8Array([137, 80]) }
    expect(await readClipboard()).toMatchObject({ kind: 'text', text: 'A1\tB1' })
  })

  it('reads an image on its own as PNG bytes', async () => {
    fake.data = { 'image/png': new Uint8Array([137, 80, 78, 71]) }
    expect(await readClipboard()).toEqual({ kind: 'image', png: new Uint8Array([137, 80, 78, 71]) })
  })
})
