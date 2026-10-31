import type { ClipboardPreview } from '@shared/types'

/** The card's heading: "Image · 1440×900", "3 files", "12 lines". */
export function cardTitle(item: ClipboardPreview): string {
  switch (item.kind) {
    case 'image':
      return item.width && item.height ? `Image · ${item.width}×${item.height}` : 'Image'
    case 'files': {
      const n = item.names.length + item.more
      return n === 1 ? '1 file' : `${n} files`
    }
    case 'text':
      return item.lineCount === 1 ? '1 line' : `${item.lineCount} lines`
  }
}

/** A short type label for a file name: its extension in capitals ("PDF"), or '' for none or a long one. */
export function fileBadge(name: string): string {
  const dot = name.lastIndexOf('.')
  if (dot <= 0 || dot === name.length - 1) return ''
  const ext = name.slice(dot + 1)
  return ext.length <= 4 ? ext.toUpperCase() : ''
}
