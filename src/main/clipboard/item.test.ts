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
})

describe('previewOf', () => {
  it("files: the first three names, how many more, and the first file's folder", () => {
    const paths = ['a.txt', 'b.png', 'c.pdf', 'd.md', 'e.md'].map(here)
    expect(previewOf({ kind: 'files', paths }, 'p1')).toEqual({
      id: 'p1', kind: 'files', names: ['a.txt', 'b.png', 'c.pdf'], more: 2, folder,
    })
  })

  it('files: a copied folder shows its own name', () => {
    expect(previewOf({ kind: 'files', paths: [here('reports') + sep] }, 'p2')).toMatchObject({ names: ['reports'], more: 0, folder })
  })

  it('text: the first three lines, long ones cut, counted without a trailing newline', () => {
    const long = 'x'.repeat(130)
    expect(previewOf(text(`one\r\ntwo\n${long}\nfour\n`), 't1')).toEqual({
      id: 't1', kind: 'text', lines: ['one', 'two', `${'x'.repeat(120)}…`], lineCount: 4,
    })
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
