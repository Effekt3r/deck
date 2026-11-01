import { tmpdir } from 'node:os'
import { join, sep } from 'node:path'
import { pathToFileURL } from 'node:url'
import { describe, expect, it } from 'vitest'
import { type ClipboardContent, filePathsFromUriList, fingerprintOf, previewOf } from './item'

/** Native absolute paths on every OS, so file URLs round-trip on macOS and Windows alike. */
const folder = join(tmpdir(), 'deck clip')
const here = (name: string) => join(folder, name)
const text = (t: string, concealed = false): ClipboardContent => ({ kind: 'text', text: t, concealed })

describe('filePathsFromUriList', () => {
  it('turns file URLs back into paths, spaces and accents included', () => {
    const paths = [here('shot one.png'), here('résumé.pdf')]
    expect(filePathsFromUriList(paths.map((p) => pathToFileURL(p).href).join('\r\n'))).toEqual(paths)
  })

  it('skips comments, blank lines and web links', () => {
    const a = here('a.txt')
    expect(filePathsFromUriList(`# copied\n\nhttps://example.com/x\n${pathToFileURL(a).href}\n`)).toEqual([a])
  })

  it('strips a trailing separator from a folder URL (cp -R would copy its contents, not itself)', () => {
    const reports = here('reports')
    expect(filePathsFromUriList(`${pathToFileURL(reports).href}/`)).toEqual([reports])
  })

  it('skips a malformed file URL but keeps the others around it', () => {
    const a = here('a.txt')
    const b = here('b.txt')
    // %2F decodes to a slash inside a path segment, which fileURLToPath refuses on every OS.
    expect(filePathsFromUriList(`${pathToFileURL(a).href}\nfile:///tmp/a%2Fb\n${pathToFileURL(b).href}\n`)).toEqual([a, b])
  })

  it('accepts the scheme case-insensitively', () => {
    const a = here('a.txt')
    const url = pathToFileURL(a).href.replace(/^file:/i, 'FILE:')
    expect(filePathsFromUriList(url)).toEqual([a])
  })

  it.runIf(process.platform === 'win32')('a UNC URL becomes a \\\\server\\share path', () => {
    expect(filePathsFromUriList('file://server/share/a%20b.txt')).toEqual(['\\\\server\\share\\a b.txt'])
  })
})

describe('previewOf', () => {
  it("files: the first three names, how many more, and the first file's folder", () => {
    const paths = ['a.txt', 'b.png', 'c.pdf', 'd.md', 'e.md'].map(here)
    expect(previewOf({ kind: 'files', paths }, 'p1')).toEqual({
      id: 'p1', kind: 'files', names: ['a.txt', 'b.png', 'c.pdf'], more: 2, folder,
    })
  })

  // filePathsFromUriList now trims a trailing separator itself, but previewOf is also handed
  // ClipboardContent directly (read.ts, and tests like this one), so it must still cope with one.
  it('files: a copied folder shows its own name', () => {
    expect(previewOf({ kind: 'files', paths: [here('reports') + sep] }, 'p2')).toMatchObject({ names: ['reports'], more: 0, folder })
  })

  it('files: a volume or drive root falls back to showing the path itself', () => {
    expect(previewOf({ kind: 'files', paths: ['/'] }, 'p3')).toMatchObject({ names: ['/'], more: 0 })
  })

  it('text: the first three lines, long ones cut, counted without a trailing newline', () => {
    const long = 'x'.repeat(130)
    expect(previewOf(text(`one\r\ntwo\n${long}\nfour\n`), 't1')).toEqual({
      id: 't1', kind: 'text', lines: ['one', 'two', `${'x'.repeat(120)}…`], lineCount: 4,
    })
  })

  it('text: a lone CR is one line break too', () => {
    expect(previewOf(text('a\rb'), 't5')).toEqual({ id: 't5', kind: 'text', lines: ['a', 'b'], lineCount: 2 })
  })

  it('text: a line of exactly 120 characters is not cut, 121 is', () => {
    const exact = 'y'.repeat(120)
    const over = 'y'.repeat(121)
    expect(previewOf(text(exact), 't2')).toEqual({ id: 't2', kind: 'text', lines: [exact], lineCount: 1 })
    expect(previewOf(text(over), 't3')).toEqual({ id: 't3', kind: 'text', lines: [`${'y'.repeat(120)}…`], lineCount: 1 })
  })

  it('text: the 120-unit cut never splits a surrogate pair', () => {
    const emoji = '\u{1F600}' // U+1F600, a high surrogate (0xD83D) then a low one (0xDE00)
    const line = `${'z'.repeat(119)}${emoji}tail`
    expect(previewOf(text(line), 't4')).toMatchObject({ lines: [`${'z'.repeat(119)}…`] })
  })

  it('text: C0/C1 control characters show as a middle dot, except tab', () => {
    const line = 'a\x07b\x1bc\x9fd\te' // BEL, ESC, a C1 control, then a real tab
    expect(previewOf(text(line), 't8')).toEqual({ id: 't8', kind: 'text', lines: ['a·b·c·d\te'], lineCount: 1 })
  })

  it('text: bidi overrides and isolates are removed, not shown as anything', () => {
    const line = 'a‮b⁦c‎d‏' // RLO, LRI, LRM, RLM
    expect(previewOf(text(line), 't9')).toEqual({ id: 't9', kind: 'text', lines: ['abcd'], lineCount: 1 })
  })

  it('text: empty and single-line text each count as one line', () => {
    expect(previewOf(text(''), 't6')).toEqual({ id: 't6', kind: 'text', lines: [''], lineCount: 1 })
    expect(previewOf(text('abc'), 't7')).toEqual({ id: 't7', kind: 'text', lines: ['abc'], lineCount: 1 })
  })

  it('image: the size and thumbnail it is given', () => {
    const info = { width: 1440, height: 900, thumbnail: 'data:image/png;base64,AA==' }
    expect(previewOf({ kind: 'image', png: new Uint8Array([1, 2, 3]) }, 'i1', info)).toEqual({ id: 'i1', kind: 'image', ...info })
  })
})

describe('fingerprintOf', () => {
  it('stays the same for the same content and changes with it', () => {
    expect(fingerprintOf(text('a'))).toBe(fingerprintOf(text('a')))
    expect(fingerprintOf(text('a'))).not.toBe(fingerprintOf(text('b')))
    const image = (b: number): ClipboardContent => ({ kind: 'image', png: new Uint8Array([b, 2, 3]) })
    expect(fingerprintOf(image(1))).not.toBe(fingerprintOf(image(9)))
    expect(fingerprintOf({ kind: 'files', paths: ['/a'] })).not.toBe(fingerprintOf({ kind: 'files', paths: ['/b'] }))
  })

  it('tells concealed text from the same text unconcealed, and nothing from anything', () => {
    expect(fingerprintOf(text('pw', true))).not.toBe(fingerprintOf(text('pw')))
    expect(fingerprintOf(null)).toBe('empty')
  })
})
