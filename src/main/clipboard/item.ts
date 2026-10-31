import { createHash } from 'node:crypto'
import { basename, dirname } from 'node:path'
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
    if (!url.startsWith('file:')) continue
    try {
      paths.push(fileURLToPath(url))
    } catch {
      // a file: URL that isn't a local path on this OS
    }
  }
  return paths
}

/** Identifies content without keeping it: a different clipboard is a different fingerprint. */
export function fingerprintOf(content: ClipboardContent | null): string {
  if (!content) return 'empty'
  const hash = createHash('sha1').update(content.kind)
  if (content.kind === 'files') hash.update(content.paths.join('\0'))
  else if (content.kind === 'text') hash.update(content.concealed ? 'c' : 't').update(content.text)
  else hash.update(content.png)
  return hash.digest('hex')
}

/** What the card shows of `content`. */
export function previewOf(content: ClipboardContent, id: string, image?: ImageInfo): ClipboardPreview {
  switch (content.kind) {
    case 'files':
      return {
        id,
        kind: 'files',
        names: content.paths.slice(0, NAMES).map((p) => basename(p)),
        more: Math.max(0, content.paths.length - NAMES),
        folder: dirname(content.paths[0] ?? ''),
      }
    case 'text': {
      const lines = content.text.split(/\r\n|\r|\n/)
      if (lines.length > 1 && lines[lines.length - 1] === '') lines.pop()
      return {
        id,
        kind: 'text',
        lines: lines.slice(0, LINES).map((l) => (l.length > LINE_CHARS ? `${l.slice(0, LINE_CHARS)}…` : l)),
        lineCount: lines.length,
      }
    }
    case 'image':
      return { id, kind: 'image', width: image?.width ?? 0, height: image?.height ?? 0, thumbnail: image?.thumbnail ?? '' }
  }
}
