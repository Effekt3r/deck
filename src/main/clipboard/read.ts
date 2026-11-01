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

/** Electron omits from `types` any raw format Chromium treats as standard
 *  (electron_api_clipboard.cc: `if (IsStandardClipboardFormat(fmt)) continue`); in Chromium 156
 *  that's macOS `public.png` and Windows `PNG`, so only this legacy alias ever survives. Windows
 *  has no raw path at all: image/png there always goes through Electron's ReadMime decode.
 *  getType('image/png') makes Chromium decode the image to validate it: 62 ms for a 5K screenshot's
 *  1 MB PNG, measured in the running app, against 0.5 ms for the same bytes read raw. */
const PNG_RAW = raw('Apple PNG pasteboard type')
/** 89 50 4E 47 0D 0A 1A 0A. */
const PNG_SIGNATURE = Uint8Array.of(0x89, 0x50, 0x4e, 0x47, 0x0d, 0x0a, 0x1a, 0x0a)
const isPng = (bytes: Uint8Array) => bytes.length >= PNG_SIGNATURE.length && PNG_SIGNATURE.every((b, i) => bytes[i] === b)

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
  // dataForType: (what a raw read calls) returns only the first pasteboard item; text/plain's
  // stringForType: joins every item with newlines, so an app that writes one item per row keeps
  // all of them. A raw UTF-8 read only ever helped multi-MB texts, so it isn't used here.
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
    let png = types.includes(PNG_RAW) ? new Uint8Array(await (await blob(item, PNG_RAW)).arrayBuffer()) : new Uint8Array(0)
    // A missing signature also catches an empty raw read; Chromium itself used to fall back to
    // TIFF when public.png's data went missing, so falling back to image/png here follows suit.
    if (!isPng(png)) png = new Uint8Array(await (await blob(item, 'image/png')).arrayBuffer())
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
