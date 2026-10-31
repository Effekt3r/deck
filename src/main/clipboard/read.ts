import { clipboard } from 'electron'
import { type ClipboardContent, filePathsFromUriList } from './item'

/** A raw platform format, as Electron's clipboard names it. */
const raw = (format: string) => `electron application/osclipboard;format="${format}"`

/** Formats apps add to say "leave this pasteboard copy alone": password managers (so clipboard
 *  tools don't retain a secret), and anything that only passes data through the system pasteboard
 *  to move it, not because anyone copied it. */
const CONCEALED = [
  'org.nspasteboard.ConcealedType', // macOS (nspasteboard.org): most password managers, incl. 1Password
  'org.nspasteboard.TransientType', // macOS (nspasteboard.org): e.g. snippet expanders, mid-paste
  'com.agilebits.onepassword', // macOS: 1Password's own marker (AgileBits), alongside the one above
  'de.petermaurer.TransientPasteboardType', // macOS: TextExpander, Typinator, Butler and the like
  'ExcludeClipboardContentFromMonitorProcessing', // Windows: Clipboard History / Cloud Clipboard
  'Clipboard Viewer Ignore', // Windows: the older format (KeePass and other password managers set it)
].map(raw)
/** Windows: a DWORD 0 here keeps the copy out of clipboard history. */
const HISTORY = raw('CanIncludeInClipboardHistory')

/** The clipboard couldn't be opened for this read (Windows: another app has it open — RDP, Office,
 *  the clipboard history UI). Electron resolves such a read as empty data instead of rejecting;
 *  readClipboard turns a listed-but-empty type back into this rejection, so the watch treats it as
 *  "try again next look" (it catches a thrown read) rather than as the clipboard having changed. */
const BUSY = 'The clipboard is in use by another app.'

const blob = (item: Electron.ClipboardItem, type: string) => item.getType(type) as Promise<Blob>

/** What the clipboard holds, in the order Deck uses it: files, then text, then an image on its own.
 *  Electron's read() gives one item; its text/uri-list lists every copied file. */
export async function readClipboard(): Promise<ClipboardContent | null> {
  const [item] = await clipboard.read()
  if (!item) return null
  const { types } = item
  const text = types.includes('text/plain') ? await (await blob(item, 'text/plain')).text() : null
  // getType() reads when called and has() is read() plus a search: one fresh list after the text
  // read catches a marker the first missed (a copy in between, or a list Windows took while busy).
  const [after] = await clipboard.read()
  if (await isConcealed(after ? [item, after] : [item])) return text === null ? null : { kind: 'text', text, concealed: true }
  if (types.includes('text/uri-list')) {
    const paths = filePathsFromUriList(await (await blob(item, 'text/uri-list')).text())
    if (paths.length) return { kind: 'files', paths }
  }
  if (text) return { kind: 'text', text, concealed: false }
  // Electron resolves a read that couldn't open the clipboard as empty data: a listed type that
  // comes back empty is a failed read (the next look tries again), not an empty clipboard.
  if (types.includes('image/png')) {
    const png = new Uint8Array(await (await blob(item, 'image/png')).arrayBuffer())
    if (!png.length) throw new Error(BUSY)
    return { kind: 'image', png }
  }
  if (text === '') throw new Error(BUSY)
  return null
}

/** Any of `items` (the item read for text/files/image, and the fresh one read right after) carries
 *  a concealed marker, or Windows' clipboard-history DWORD says 0. */
async function isConcealed(items: Electron.ClipboardItem[]): Promise<boolean> {
  if (items.some((i) => CONCEALED.some((f) => i.types.includes(f)))) return true
  const holder = items.find((i) => i.types.includes(HISTORY))
  if (!holder) return false
  const value = new Uint8Array(await (await blob(holder, HISTORY)).arrayBuffer())
  return value.length < 4 || value.subarray(0, 4).every((b) => b === 0) // DWORD 0; unreadable fails closed
}
