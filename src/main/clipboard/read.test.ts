import { tmpdir } from 'node:os'
import { join } from 'node:path'
import { pathToFileURL } from 'node:url'
import { beforeEach, describe, expect, it, vi } from 'vitest'
import { readClipboard } from './read'

const raw = (format: string) => `electron application/osclipboard;format="${format}"`

/** Every marker read.ts's CONCEALED list wraps with raw(). */
const MARKERS = [
  'org.nspasteboard.ConcealedType',
  'org.nspasteboard.TransientType',
  'com.agilebits.onepassword',
  'de.petermaurer.TransientPasteboardType',
  'ExcludeClipboardContentFromMonitorProcessing',
  'Clipboard Viewer Ignore',
]

type Listing = Record<string, string | Uint8Array<ArrayBuffer>>
const fake = vi.hoisted(() => ({
  /** The clipboard's one item: type → data, as readClipboard's first clipboard.read() call sees it. */
  data: {} as Listing,
  /** What its second, immediate re-read sees; null (the common case) mirrors `data` dynamically, as
   *  nothing having changed between the two reads would. */
  second: null as Listing | null,
  /** How many times clipboard.read() has been called, to tell the first call from the second. */
  calls: 0,
}))

vi.mock('electron', () => {
  const itemFor = (data: Listing) => {
    const types = Object.keys(data)
    if (!types.length) return []
    return [{
      types,
      getType: async (type: string) => {
        if (!(type in data)) throw new Error(`no ${type}`)
        return new Blob([data[type]])
      },
    }]
  }
  return {
    clipboard: {
      read: async () => itemFor(fake.calls++ % 2 === 0 ? fake.data : (fake.second ?? fake.data)),
    },
  }
})

beforeEach(() => {
  fake.data = {}
  fake.second = null
  fake.calls = 0
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

  it.each(MARKERS)('marks a copy concealed when %s is among the types', async (marker) => {
    fake.data = { 'text/plain': 's3cret', [raw(marker)]: '' }
    expect(await readClipboard()).toEqual({ kind: 'text', text: 's3cret', concealed: true })
  })

  it('marks it concealed when a marker only the second listing has (a copy landed in between)', async () => {
    fake.data = { 'text/plain': 's3cret' }
    fake.second = { 'text/plain': 's3cret', [raw('org.nspasteboard.ConcealedType')]: '' }
    expect(await readClipboard()).toEqual({ kind: 'text', text: 's3cret', concealed: true })
  })

  it("marks it concealed when Windows' clipboard history is told to skip it (DWORD 0), not when allowed", async () => {
    fake.data = { 'text/plain': 's3cret', [raw('CanIncludeInClipboardHistory')]: new Uint8Array([0, 0, 0, 0]) }
    expect(await readClipboard()).toMatchObject({ concealed: true })
    fake.data = { 'text/plain': 'fine', [raw('CanIncludeInClipboardHistory')]: new Uint8Array([1, 0, 0, 0]) }
    expect(await readClipboard()).toMatchObject({ concealed: false })
  })

  it('a clipboard-history value shorter than the DWORD fails closed (concealed)', async () => {
    fake.data = { 'text/plain': 's3cret', [raw('CanIncludeInClipboardHistory')]: new Uint8Array([1, 0]) }
    expect(await readClipboard()).toMatchObject({ concealed: true })
  })

  it('concealed beats files: a uri-list and the text that comes with it still read as concealed text', async () => {
    const path = join(tmpdir(), 'secret.pdf')
    fake.data = {
      'text/uri-list': pathToFileURL(path).href,
      'text/plain': 'secret.pdf',
      [raw('org.nspasteboard.ConcealedType')]: '',
    }
    expect(await readClipboard()).toEqual({ kind: 'text', text: 'secret.pdf', concealed: true })
  })

  it('concealed with no text is null: nothing to paste', async () => {
    fake.data = { [raw('org.nspasteboard.ConcealedType')]: '' }
    expect(await readClipboard()).toBeNull()
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

  it("empty text alongside a real image reads as the image (empty text alone isn't assumed busy)", async () => {
    fake.data = { 'text/plain': '', 'image/png': new Uint8Array([137, 80, 78, 71]) }
    expect(await readClipboard()).toEqual({ kind: 'image', png: new Uint8Array([137, 80, 78, 71]) })
  })

  it('text/plain listed but empty, with nothing else, rejects as busy rather than reading as empty', async () => {
    fake.data = { 'text/plain': '' }
    await expect(readClipboard()).rejects.toThrow('The clipboard is in use by another app.')
  })

  it('image/png listed but reading 0 bytes rejects as busy rather than reading as an empty image', async () => {
    fake.data = { 'image/png': new Uint8Array([]) }
    await expect(readClipboard()).rejects.toThrow('The clipboard is in use by another app.')
  })

  it.each(['Apple PNG pasteboard type', 'public.png', 'PNG'])(
    'reads PNG bytes from the raw %s format rather than the decoded image/png',
    async (format) => {
      const fromRaw = new Uint8Array([137, 80, 78, 71, 1])
      const fromDecoded = new Uint8Array([137, 80, 78, 71, 2]) // what image/png alone would give
      fake.data = { 'image/png': fromDecoded, [raw(format)]: fromRaw }
      expect(await readClipboard()).toEqual({ kind: 'image', png: fromRaw })
    },
  )

  it('a raw PNG format listed but empty rejects as busy, even though image/png itself has bytes', async () => {
    fake.data = { 'image/png': new Uint8Array([137, 80, 78, 71]), [raw('Apple PNG pasteboard type')]: new Uint8Array([]) }
    await expect(readClipboard()).rejects.toThrow('The clipboard is in use by another app.')
  })

  it.each(['public.utf8-plain-text', 'NSStringPboardType'])(
    'reads text from the raw %s format rather than text/plain, including non-ASCII bytes',
    async (format) => {
      fake.data = { 'text/plain': 'from text/plain', [raw(format)]: new TextEncoder().encode('café ✓') }
      expect(await readClipboard()).toEqual({ kind: 'text', text: 'café ✓', concealed: false })
    },
  )

  it('a raw text format listed but empty, with no image, rejects as busy even though text/plain has bytes', async () => {
    fake.data = { 'text/plain': 'from text/plain', [raw('public.utf8-plain-text')]: new Uint8Array([]) }
    await expect(readClipboard()).rejects.toThrow('The clipboard is in use by another app.')
  })
})
