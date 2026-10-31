import { clipboard } from 'electron'
import { type ClipboardContent, filePathsFromUriList } from './item'

/** A raw platform format, as Electron's clipboard names it. */
const raw = (format: string) => `electron application/osclipboard;format="${format}"`

/** Formats password managers add so clipboard tools leave the copy alone. */
const CONCEALED = [
  'org.nspasteboard.ConcealedType', // macOS (nspasteboard.org)
  'org.nspasteboard.TransientType',
  'ExcludeClipboardContentFromMonitorProcessing', // Windows
].map(raw)
/** Windows: a DWORD 0 here keeps the copy out of clipboard history. */
const HISTORY = raw('CanIncludeInClipboardHistory')

const blob = (item: Electron.ClipboardItem, type: string) => item.getType(type) as Promise<Blob>

/** What the clipboard holds, in the order Deck uses it: files, then text, then an image on its own.
 *  Electron's read() gives one item; its text/uri-list lists every copied file. */
export async function readClipboard(): Promise<ClipboardContent | null> {
  const [item] = await clipboard.read()
  if (!item) return null
  const { types } = item
  const text = types.includes('text/plain') ? await (await blob(item, 'text/plain')).text() : null
  if (await isConcealed(item)) return text === null ? null : { kind: 'text', text, concealed: true }
  if (types.includes('text/uri-list')) {
    const paths = filePathsFromUriList(await (await blob(item, 'text/uri-list')).text())
    if (paths.length) return { kind: 'files', paths }
  }
  if (text) return { kind: 'text', text, concealed: false }
  if (types.includes('image/png')) {
    const png = new Uint8Array(await (await blob(item, 'image/png')).arrayBuffer())
    if (png.length) return { kind: 'image', png }
  }
  return null
}

async function isConcealed(item: Electron.ClipboardItem): Promise<boolean> {
  for (const format of CONCEALED) {
    if (item.types.includes(format) || (await clipboard.has(format))) return true
  }
  if (item.types.includes(HISTORY)) {
    const value = new Uint8Array(await (await blob(item, HISTORY)).arrayBuffer())
    if (value.length >= 4 && value[0] === 0 && value[1] === 0 && value[2] === 0 && value[3] === 0) return true
  }
  return false
}
