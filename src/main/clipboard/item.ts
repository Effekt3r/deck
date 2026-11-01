import { createHmac, randomBytes } from 'node:crypto'
import { basename, dirname, parse, sep } from 'node:path'
import { fileURLToPath } from 'node:url'
import type { ClipboardPreview } from '@shared/types'

/** What the clipboard holds, as Deck uses it (read.ts picks it). */
export type ClipboardContent =
  | { kind: 'files'; paths: string[] }
  /** concealed: a password manager marked it; it pastes, but the card never offers it. */
  | { kind: 'text'; text: string; concealed: boolean }
  | { kind: 'image'; png: Uint8Array }

/** An image's size and a small PNG of it (image.ts). */
export interface ImageInfo {
  width: number
  height: number
  /** A data: URL; '' when the image couldn't be decoded. */
  thumbnail: string
}

const NAMES = 3
const LINES = 3
const LINE_CHARS = 120

/** The local paths in a text/uri-list (one URL per line, # lines are comments). Web links are skipped. */
export function filePathsFromUriList(list: string): string[] {
  const paths: string[] = []
  for (const line of list.split(/\r?\n/)) {
    const url = line.trim()
    if (!/^file:/i.test(url)) continue
    try {
      let path = fileURLToPath(url)
      // A folder's URL ends in a separator; strip it (but not off a root) so e.g. `cp -R` copies
      // the folder itself, not just its contents.
      while (path.length > parse(path).root.length && path.endsWith(sep)) path = path.slice(0, -1)
      paths.push(path)
    } catch {
      // a file: URL that isn't a local path on this OS
    }
  }
  return paths
}

/** A key made once per run; see fingerprintOf. */
const KEY = randomBytes(32)

/** Identifies content without keeping it: a different clipboard is a different fingerprint. Keyed
 *  per run, so a fingerprint that leaks on its own (a log, a report) means nothing outside this
 *  process. */
export function fingerprintOf(content: ClipboardContent | null): string {
  if (!content) return 'empty'
  const hash = createHmac('sha256', KEY).update(content.kind)
  if (content.kind === 'files') hash.update(content.paths.join('\0'))
  else if (content.kind === 'text') hash.update(content.concealed ? 'c' : 't').update(content.text)
  else hash.update(content.png)
  return hash.digest('hex')
}

/** A line's text cut to at most LINE_CHARS units, without splitting a surrogate pair in two. */
function cutLine(line: string): string {
  if (line.length <= LINE_CHARS) return line
  let cut = LINE_CHARS
  const code = line.charCodeAt(cut - 1)
  if (code >= 0xd800 && code <= 0xdbff) cut-- // a high surrogate: its low half is just past the cut
  return `${line.slice(0, cut)}…`
}

/** C0/C1 controls (tab excepted) render as boxes or nothing in the card; show a middle dot instead. */
const CONTROL = /[\u0000-\u0008\u000a-\u001f\u0080-\u009f]/g
/** Bidi overrides and isolates (LRM/RLM, LRE/RLE/PDF/LRO/RLO, LRI/RLI/FSI/PDI) are invisible but can
 *  reorder the rest of the line on screen, so they're dropped rather than shown as anything. */
const BIDI = /[‎‏‪-‮⁦-⁩]/g

/** A preview line made safe to render as plain text: never the content itself, which pastes as the
 *  user copied it. */
function sanitizeLine(line: string): string {
  return line.replace(CONTROL, '·').replace(BIDI, '')
}

/** The text's line count and its first `max` lines, counted with indexOf scans, without splitting
 *  or copying the whole text. CRLF, a lone CR and a lone LF each count as one break; a trailing
 *  break starts no further line. */
function firstLines(text: string, max: number): { lines: string[]; lineCount: number } {
  const lines: string[] = []
  let count = 0
  let start = 0
  let cr = text.indexOf('\r')
  let lf = text.indexOf('\n')
  while (cr !== -1 || lf !== -1) {
    const at = cr === -1 ? lf : lf === -1 ? cr : Math.min(cr, lf)
    const next = at === cr && lf === at + 1 ? at + 2 : at + 1 // CRLF is one break
    if (lines.length < max) lines.push(text.slice(start, at))
    count++
    start = next
    if (cr !== -1 && cr < next) cr = text.indexOf('\r', next)
    if (lf !== -1 && lf < next) lf = text.indexOf('\n', next)
  }
  if (count === 0 || start < text.length) {
    if (lines.length < max) lines.push(text.slice(start))
    count++
  }
  return { lines, lineCount: count }
}

/** What the card shows of `content`. */
export function previewOf(content: ClipboardContent, id: string, image?: ImageInfo): ClipboardPreview {
  switch (content.kind) {
    case 'files':
      return {
        id,
        kind: 'files',
        names: content.paths.slice(0, NAMES).map((p) => basename(p) || p),
        more: Math.max(0, content.paths.length - NAMES),
        folder: dirname(content.paths[0] ?? ''),
      }
    case 'text': {
      const { lines, lineCount } = firstLines(content.text, LINES)
      return { id, kind: 'text', lines: lines.map((l) => sanitizeLine(cutLine(l))), lineCount }
    }
    case 'image':
      return { id, kind: 'image', width: image?.width ?? 0, height: image?.height ?? 0, thumbnail: image?.thumbnail ?? '' }
  }
}
