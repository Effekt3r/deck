# Clipboard Card and Smart Paste Implementation Plan

> **For agentic workers:** REQUIRED SUB-SKILL: Use superpowers:subagent-driven-development (recommended) or superpowers:executing-plans to implement this plan task-by-task. Steps use checkbox (`- [ ]`) syntax for tracking.

**Goal:** Show what was just copied (image, files, text) in a card under the Claude panel with **Add to Claude**, and make Cmd/Ctrl+V and drops insert images (as a saved PNG's path) and copied files (as quoted paths).

**Architecture:** The main process alone reads the clipboard (`src/main/clipboard/`):
- **Reading:** `read.ts` picks the content: files, then text, then an image; password-manager copies are concealed.
- **Deciding what's new:** `watch.ts` decides what the card offers. It looks when the window comes to the front and once a second while it's there, and ignores text that changes while Deck is in front (Deck's own copies).
- **Inserting:** `insert.ts` turns content into text for the terminal. Images are saved by `temp.ts` and pasted as their quoted path; Claude Code turns that into `[Image #N]`.

The renderer shows the card (`src/renderer/src/clipboard/`). The terminal routes Cmd/Ctrl+V and drops through main and pastes the result with `term.paste()`, which applies bracketed paste.

**Tech Stack:** Electron 45.2 (its clipboard API is async and web-like), React 19, xterm.js 6, TypeScript, vitest.

**Spec:** `docs/superpowers/specs/2026-10-31-clipboard-design.md`.

**Facts this plan relies on**

Checked on macOS on 2026-10-31 with throwaway scripts; none of them is in the repo.

- **The clipboard API is async.** Electron 45's `clipboard` has `read(): Promise<ClipboardItem[]>`, `has(mime)`, `readText()`, `write()` and `writeText()`. `readImage`, `readBuffer` and `availableFormats` are gone.
- **One item, several types.** `read()` returns one item. Its `types` lists MIME types (`text/plain`, `text/uri-list`, `image/png`) and raw platform formats as `electron application/osclipboard;format="<name>"`. `getType(type)` resolves to a `Blob`, and rejects for a type the item doesn't list.
- **Copied files:**
  - Finder's copy of several files gives a `text/uri-list` with every file, one `file://` URL per line.
  - The raw `NSFilenamesPboardType` holds only the first file, so don't use it.
  - **Test artifact:** if the program that wrote the clipboard has quit, macOS keeps only its first item. Test writers must stay running, as Finder does.
- **Password managers** add `org.nspasteboard.ConcealedType`. It is listed among the raw types, and `clipboard.has(rawFormat)` sees it.
- **Images:**
  - A screenshot-style PNG (515 KB) reads as `image/png` in about 6 ms; a TIFF-backed image in about 30 ms (Chromium converts it). Hashing it takes under 1 ms.
  - An Excel- or Word-style copy carries both `text/plain` and `image/png`.
- **Claude Code** 2.1.283 turns a pasted `'/path/shot one.png'` or `/path/shot\ one.png` into `[Image #1]` / `[Image #2]`.
- **Paste routing:**
  - macOS Cmd+V is the Edit menu's `paste` role. It reaches xterm's hidden textarea as a DOM `paste` event, which a capture-phase listener on an ancestor can cancel.
  - Windows Ctrl+V and Ctrl+Shift+V are `keys.ts` → `'paste'`; `TerminalView` handles them today with `app.readText()`.
- **Dropped files:** `webUtils.getPathForFile(file)` gives a dropped file's path. It works in a sandboxed preload, and a DOM `File` crosses the context bridge.

**Not verifiable on this Mac.** These go into the Windows checklist (`docs/TESTING.md`, Task 8):
- that Windows' `text/uri-list` lists every file copied in Explorer;
- that Claude Code on Windows attaches an image from a pasted `'C:\…\x.png'`;
- that Windows password managers' formats show up through `clipboard.has()`.

## File structure

| File | Responsibility |
|---|---|
| `src/shared/types.ts` (modify) | `ClipboardPreview`, `InsertResult`, `DeckApi.clipboard`, `DeckApi.app.pathForFile`; drop `app.readText` |
| `src/shared/channels.ts` (modify) | `clipboard:*` channels; drop `app:read-text` |
| `src/shared/quote.ts` (create) | `quotePath`/`quotePaths`: zsh quoting on macOS, PowerShell on Windows (used by main and the drop handler) |
| `src/preload/index.ts` (modify) | `window.deck.clipboard`, `app.pathForFile` |
| `src/main/clipboard/item.ts` (create) | `ClipboardContent`, `ImageInfo`; `filePathsFromUriList`, `fingerprintOf`, `previewOf` (pure) |
| `src/main/clipboard/read.ts` (create) | `readClipboard()`: the only caller of Electron's `clipboard` |
| `src/main/clipboard/image.ts` (create) | `imageInfo(png)`: size and thumbnail via `nativeImage` |
| `src/main/clipboard/temp.ts` (create) | `TempImages`: `<temp>/Deck clipboard/clipboard-<hash>.png`, cleared at start and quit |
| `src/main/clipboard/insert.ts` (create) | `insertFor(content, claude, deps)`: the text to paste (pure apart from `saveImage`) |
| `src/main/clipboard/watch.ts` (create) | `ClipboardWatch`: when an item is new, the card's item, add/paste/dismiss |
| `src/main/clipboard/ipc.ts` (create) | `registerClipboardIpc()`: IPC handlers, window focus/blur |
| `src/main/index.ts` (modify) | register, attach to the window, dispose at quit; drop the `app:read-text` handler |
| `src/renderer/src/terminal/TerminalView.tsx` (modify) | smart paste (both platforms), file drops, `pasteRef` for the card |
| `src/renderer/src/clipboard/card.ts` (create) | `cardTitle`, `fileBadge` (pure) |
| `src/renderer/src/clipboard/useClipboardItem.ts` (create) | the window's current item |
| `src/renderer/src/clipboard/ClipboardCard.tsx` + `clipboard.css` (create) | the card |
| `src/renderer/src/App.tsx` (modify) | item → `Workspace` → card under the Claude panel; Add pastes through `pasteRef` |
| `README.md`, `CLAUDE.md`, `docs/TESTING.md`, `docs/DECK.md` (modify) | docs |

Commands below assume Node 22: `export PATH="$HOME/.nvm/versions/node/v22.19.0/bin:$PATH"`. Commit with `git -c user.email=franco@effektstudios.com commit` and end messages with `Claude-Session: https://claude.ai/code/session_012Tidn9qVajMb9EYY5GyX8U` (no `Co-Authored-By`).

---

### Task 1: Shared contract, quoting and preload

**Files:**
- Create: `src/shared/quote.ts`
- Test: `src/shared/quote.test.ts`
- Modify: `src/shared/types.ts`, `src/shared/channels.ts`, `src/preload/index.ts`

- [ ] **Step 1: Write the failing test** — `src/shared/quote.test.ts`:

```ts
import { describe, expect, it } from 'vitest'
import { quotePath, quotePaths } from './quote'

describe('quotePath', () => {
  it('wraps a path in single quotes for zsh', () => {
    expect(quotePath('/Users/franco/Desktop/shot one.png', 'darwin')).toBe("'/Users/franco/Desktop/shot one.png'")
  })

  it("writes a ' inside as '\\'' for zsh", () => {
    expect(quotePath("/tmp/it's here.txt", 'darwin')).toBe("'/tmp/it'\\''s here.txt'")
  })

  it('keeps accents and other non-ASCII as they are', () => {
    expect(quotePath('/tmp/café/résumé.pdf', 'darwin')).toBe("'/tmp/café/résumé.pdf'")
  })

  it('doubles quotes for PowerShell, the curly ones it also ends strings at included', () => {
    expect(quotePath("C:\\Users\\franco\\it's.png", 'win32')).toBe("'C:\\Users\\franco\\it''s.png'")
    expect(quotePath('C:\\tmp\\Franco’s file.txt', 'win32')).toBe("'C:\\tmp\\Franco’’s file.txt'")
  })
})

describe('quotePaths', () => {
  it('separates quoted paths with spaces', () => {
    expect(quotePaths(['/a b', '/c'], 'darwin')).toBe("'/a b' '/c'")
  })
})
```

- [ ] **Step 2: Run it to make sure it fails**

Run: `npx vitest run src/shared/quote.test.ts`
Expected: FAIL, `Failed to resolve import "./quote"`.

- [ ] **Step 3: Write `src/shared/quote.ts`**

```ts
import type { Platform } from './types'

/** A path quoted for the shell Deck starts on `platform`: zsh (macOS, Linux) or PowerShell
 *  (Windows). Claude Code reads the same quoting in its prompt: a pasted, quoted image path
 *  becomes an [Image #N] attachment. */
export function quotePath(path: string, platform: Platform): string {
  // PowerShell ends a single-quoted string at ' and also at ‘ ’ ‛; each is escaped by doubling.
  if (platform === 'win32') return `'${path.replace(/['\u2018\u2019\u201B]/g, '$&$&')}'`
  return `'${path.replace(/'/g, "'\\''")}'`
}

/** Paths quoted and separated by spaces, ready to paste. */
export function quotePaths(paths: readonly string[], platform: Platform): string {
  return paths.map((p) => quotePath(p, platform)).join(' ')
}
```

- [ ] **Step 4: Run it to make sure it passes**

Run: `npx vitest run src/shared/quote.test.ts`
Expected: PASS, 5 tests.

- [ ] **Step 5: Add the contract to `src/shared/types.ts`**

Insert just above `export interface DeckApi {`:

```ts
/** The item the clipboard card offers: what Cmd/Ctrl+V would paste now. */
export type ClipboardPreview =
  | {
      id: string
      kind: 'image'
      width: number
      height: number
      /** A small PNG of it, as a data: URL. */
      thumbnail: string
    }
  | {
      id: string
      kind: 'files'
      /** The first three file names. */
      names: string[]
      /** How many more files there are. */
      more: number
      /** The first file's folder. */
      folder: string
    }
  | {
      id: string
      kind: 'text'
      /** The first three lines, each cut at 120 characters. */
      lines: string[]
      lineCount: number
    }

/** Text for a terminal to paste, or why there is none. */
export type InsertResult = { text: string } | { error: string }
```

In `DeckApi`, add after the `claude: { … }` block:

```ts
  clipboard: {
    /** The item the card offers now, or null. */
    current(): Promise<ClipboardPreview | null>
    /** The card's item changed: a new copy, or null once it was used, dismissed or replaced. */
    onItem(cb: (item: ClipboardPreview | null) => void): () => void
    /** The text that inserts this item: the snapshot the card shows, even if the clipboard changed since. */
    add(id: string): Promise<InsertResult>
    /** What Cmd/Ctrl+V inserts now; null: nothing (an image in a shell tab). Pasting the card's item uses it up. */
    paste(opts: { claude: boolean }): Promise<InsertResult | null>
    dismiss(id: string): void
  }
```

In `DeckApi.app`, replace `readText(): Promise<string>` with:

```ts
    /** A dropped file's path; '' for a drop with no file behind it. */
    pathForFile(file: File): string
```

- [ ] **Step 6: Channels** — in `src/shared/channels.ts`, remove `appReadText: 'app:read-text',` and add after `claudeFollow`:

```ts
  clipboardCurrent: 'clipboard:current',
  clipboardItem: 'clipboard:item',
  clipboardAdd: 'clipboard:add',
  clipboardPaste: 'clipboard:paste',
  clipboardDismiss: 'clipboard:dismiss',
```

- [ ] **Step 7: Preload** — in `src/preload/index.ts`:

Change the imports to:

```ts
import { contextBridge, ipcRenderer, webUtils, type IpcRendererEvent } from 'electron'
import { IPC } from '@shared/channels'
import type { ClaudeSnapshot, ClipboardPreview, DeckApi, GitSnapshot, MenuCommand, Platform } from '@shared/types'
```

Add after the `claude: { … },` block:

```ts
  clipboard: {
    current: () => ipcRenderer.invoke(IPC.clipboardCurrent),
    onItem: (cb) => on<[ClipboardPreview | null]>(IPC.clipboardItem, cb),
    add: (id) => ipcRenderer.invoke(IPC.clipboardAdd, id),
    paste: (opts) => ipcRenderer.invoke(IPC.clipboardPaste, opts),
    dismiss: (id) => ipcRenderer.send(IPC.clipboardDismiss, id),
  },
```

In `app: { … }`, replace `readText: () => ipcRenderer.invoke(IPC.appReadText),` with:

```ts
    pathForFile: (file) => {
      try {
        return webUtils.getPathForFile(file)
      } catch {
        return '' // not a File (or not one from disk)
      }
    },
```

- [ ] **Step 8: Typecheck** — the main process and `TerminalView` still use `readText`. Leave them for Tasks 5 and 6, and confirm that only those fail:

Run: `npm run typecheck 2>&1 | grep -E "error TS" | sed -E 's/\(.*//' | sort -u`
Expected: errors only in `src/main/index.ts` (`appReadText`) and `src/renderer/src/terminal/TerminalView.tsx` (`readText`).

- [ ] **Step 9: Commit**

```bash
git add src/shared src/preload
git -c user.email=franco@effektstudios.com commit -m "Clipboard: contract, shell quoting, preload bridge" -m "Claude-Session: https://claude.ai/code/session_012Tidn9qVajMb9EYY5GyX8U"
```

**After review (done in a follow-up commit):**
- `quotePath` and `quotePaths` return `string | null`. They refuse empty paths and any path with control characters (`/[\u0000-\u001f\u007f-\u009f]/`): a file name holding `ESC[201~`, Ctrl+U and CR ran a command in zsh with no Enter.
- The PowerShell class covers all five of its quote characters (`/['\u2018\u2019\u201A\u201B]/g`; U+201A was missing).
- Tests round-trip names through the real zsh, and through `pwsh` where it exists.

---

### Task 2: Clipboard content, previews and fingerprints

> Done and reviewed. The code below is the first version; review fixes changed it (see "After review" at the end of this task). The final code is in `src/main/clipboard/item.ts`; don't re-run these steps as written.

**Files:**
- Create: `src/main/clipboard/item.ts`
- Test: `src/main/clipboard/item.test.ts`

- [ ] **Step 1: Write the failing test** — `src/main/clipboard/item.test.ts`:

```ts
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
```

- [ ] **Step 2: Run it to make sure it fails**

Run: `npx vitest run src/main/clipboard/item.test.ts`
Expected: FAIL, `Failed to resolve import "./item"`.

- [ ] **Step 3: Write `src/main/clipboard/item.ts`**

```ts
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
```

- [ ] **Step 4: Run it to make sure it passes**

Run: `npx vitest run src/main/clipboard/item.test.ts`
Expected: PASS, 8 tests.

- [ ] **Step 5: Commit**

```bash
git add src/main/clipboard/item.ts src/main/clipboard/item.test.ts
git -c user.email=franco@effektstudios.com commit -m "Clipboard: content, previews and fingerprints" -m "Claude-Session: https://claude.ai/code/session_012Tidn9qVajMb9EYY5GyX8U"
```

**After review (follow-up commits):**
- **Paths from the uri-list:**
  - Folder paths lose their trailing separator, unless they are a root. Otherwise `cp -R '/x/reports/'` copies the folder's contents instead of the folder.
  - The `file:` scheme is matched without regard to case.
- **The text preview:**
  - It counts lines without splitting the whole text.
  - Its 120-character cut never splits a surrogate pair.
  - A copied root (a volume or drive) keeps its name.
- **The fingerprint** is an HMAC-SHA256 with a key made once per run. A short concealed secret then can't be brute-forced back from it.

---

### Task 3: Saved images and the text to insert

> Done and reviewed. The code below is the first version; review fixes changed it (see "After review" at the end of this task). The final code is in `src/main/clipboard/temp.ts` and `insert.ts`; don't re-run these steps as written.

**Files:**
- Create: `src/main/clipboard/temp.ts`, `src/main/clipboard/insert.ts`
- Test: `src/main/clipboard/temp.test.ts`, `src/main/clipboard/insert.test.ts`

- [ ] **Step 1: Write the failing tests**

`src/main/clipboard/temp.test.ts`:

```ts
import { existsSync, mkdtempSync, readFileSync, rmSync } from 'node:fs'
import { tmpdir } from 'node:os'
import { join } from 'node:path'
import { afterAll, describe, expect, it } from 'vitest'
import { TempImages } from './temp'

const root = mkdtempSync(join(tmpdir(), 'deck-temp-test-'))
afterAll(() => rmSync(root, { recursive: true, force: true }))

describe('TempImages', () => {
  it('writes a PNG named by its content, the same file for the same content', async () => {
    const dir = join(root, 'Deck clipboard')
    const temp = new TempImages(dir)
    const a = await temp.save(new Uint8Array([1, 2, 3]))
    expect(a.startsWith(dir)).toBe(true)
    expect(a.endsWith('.png')).toBe(true)
    expect([...readFileSync(a)]).toEqual([1, 2, 3])
    expect(await temp.save(new Uint8Array([1, 2, 3]))).toBe(a)
    expect(await temp.save(new Uint8Array([4]))).not.toBe(a)
  })

  it('clear() removes the folder, and is fine when there is none', async () => {
    const temp = new TempImages(join(root, 'gone'))
    await temp.save(new Uint8Array([1]))
    temp.clear()
    expect(existsSync(join(root, 'gone'))).toBe(false)
    expect(() => temp.clear()).not.toThrow()
  })
})
```

`src/main/clipboard/insert.test.ts`:

```ts
import { describe, expect, it } from 'vitest'
import { insertFor, UNSAFE } from './insert'

const deps = { platform: 'darwin' as const, saveImage: async () => '/tmp/Deck clipboard/clipboard-1.png' }
const image = { kind: 'image' as const, png: new Uint8Array([1]) }

describe('insertFor', () => {
  it('files: quoted paths, separated by spaces', async () => {
    expect(await insertFor({ kind: 'files', paths: ['/a b/c.pdf', '/d.png'] }, false, deps)).toEqual({ text: "'/a b/c.pdf' '/d.png'" })
  })

  it('text, concealed or not: as it is', async () => {
    expect(await insertFor({ kind: 'text', text: 'hi\nthere', concealed: false }, true, deps)).toEqual({ text: 'hi\nthere' })
    expect(await insertFor({ kind: 'text', text: 'pw', concealed: true }, false, deps)).toEqual({ text: 'pw' })
  })

  it('an image, with Claude running: the quoted path of the saved PNG', async () => {
    expect(await insertFor(image, true, deps)).toEqual({ text: "'/tmp/Deck clipboard/clipboard-1.png'" })
  })

  it('an image in a shell tab: nothing, as before', async () => {
    expect(await insertFor(image, false, deps)).toBeNull()
  })

  it("an image that can't be saved: says why", async () => {
    const failing = { ...deps, saveImage: async (): Promise<string> => { throw new Error('disk full') } }
    expect(await insertFor(image, true, failing)).toEqual({ error: "Couldn't save the image for Claude: disk full" })
  })

  it('Windows: PowerShell quoting', async () => {
    expect(await insertFor({ kind: 'files', paths: ["C:\\it's\\a.txt"] }, false, { ...deps, platform: 'win32' })).toEqual({ text: "'C:\\it''s\\a.txt'" })
  })

  it("a file name with control characters: refused, it can't be pasted safely", async () => {
    expect(await insertFor({ kind: 'files', paths: ['/ok.txt', '/bad\u001b[201~name'] }, true, deps)).toEqual({ error: UNSAFE })
  })
})
```

- [ ] **Step 2: Run them to make sure they fail**

Run: `npx vitest run src/main/clipboard/temp.test.ts src/main/clipboard/insert.test.ts`
Expected: FAIL, both imports unresolved.

- [ ] **Step 3: Write `src/main/clipboard/temp.ts`**

```ts
import { createHash } from 'node:crypto'
import { rmSync } from 'node:fs'
import { mkdir, writeFile } from 'node:fs/promises'
import { join } from 'node:path'

/** Clipboard images pasted into a terminal, as files Claude Code can read. They stay until Deck
 *  quits (Claude may read one only when the prompt is sent); the next start clears what a crash left. */
export class TempImages {
  constructor(readonly dir: string) {}

  /** The PNG's file, named by its content (saving the same image again rewrites the same file). */
  async save(png: Uint8Array): Promise<string> {
    const file = join(this.dir, `clipboard-${createHash('sha1').update(png).digest('hex').slice(0, 16)}.png`)
    await mkdir(this.dir, { recursive: true })
    await writeFile(file, png)
    return file
  }

  clear(): void {
    rmSync(this.dir, { recursive: true, force: true })
  }
}
```

- [ ] **Step 4: Write `src/main/clipboard/insert.ts`**

```ts
import { quotePath, quotePaths } from '@shared/quote'
import type { InsertResult, Platform } from '@shared/types'
import type { ClipboardContent } from './item'

/** quotePath refused a path: it has control characters, which no quoting makes safe to paste. */
export const UNSAFE = "A file name has control characters, so it can't be pasted safely."

export interface InsertDeps {
  platform: Platform
  /** Writes an image where Claude can read it; resolves with its path (TempImages.save). */
  saveImage(png: Uint8Array): Promise<string>
}

/** The text that inserts `content` into a terminal:
 *  - files: their quoted paths (Claude reads them; images among them attach);
 *  - text: as it is;
 *  - an image, in a tab running Claude: the quoted path of a saved PNG, which Claude Code
 *    attaches as [Image #N]; in a shell tab: null, nothing, as before. */
export async function insertFor(content: ClipboardContent, claude: boolean, deps: InsertDeps): Promise<InsertResult | null> {
  switch (content.kind) {
    case 'files': {
      const text = quotePaths(content.paths, deps.platform)
      return text === null ? { error: UNSAFE } : { text }
    }
    case 'text':
      return { text: content.text }
    case 'image':
      if (!claude) return null
      try {
        const text = quotePath(await deps.saveImage(content.png), deps.platform)
        return text === null ? { error: UNSAFE } : { text }
      } catch (err) {
        return { error: `Couldn't save the image for Claude: ${err instanceof Error ? err.message : String(err)}` }
      }
  }
}
```

- [ ] **Step 5: Run them to make sure they pass**

Run: `npx vitest run src/main/clipboard/temp.test.ts src/main/clipboard/insert.test.ts`
Expected: PASS, 9 tests.

- [ ] **Step 6: Commit**

```bash
git add src/main/clipboard/temp.ts src/main/clipboard/temp.test.ts src/main/clipboard/insert.ts src/main/clipboard/insert.test.ts
git -c user.email=franco@effektstudios.com commit -m "Clipboard: saved images and the text to insert" -m "Claude-Session: https://claude.ai/code/session_012Tidn9qVajMb9EYY5GyX8U"
```

**After review (follow-up commits):**
- **`TempImages.clear()`:**
  - It never throws. It runs at startup before the window opens, and a permission error there left Deck with no window.
  - It removes only its own `clipboard-*.png` files (and `.tmp` ones), then the folder if that leaves it empty.
- **`save()`:**
  - It keeps an existing file of the same size, since the name is the content's hash.
  - Otherwise it writes a `.tmp` file and renames it.
  - The folder gets mode `0700` and the files `0600`.
- **`insertFor`** returns null for an empty file list.

---

### Task 4: The watch: what the card offers, and when

**Files:**
- Create: `src/main/clipboard/watch.ts`
- Test: `src/main/clipboard/watch.test.ts`

- [ ] **Step 1: Write the failing test** — `src/main/clipboard/watch.test.ts`:

```ts
import { afterEach, beforeEach, describe, expect, it, vi } from 'vitest'
import type { ClipboardPreview, InsertResult } from '@shared/types'
import type { ClipboardContent } from './item'
import { ClipboardWatch, type WatchDeps } from './watch'

const text = (t: string, concealed = false): ClipboardContent => ({ kind: 'text', text: t, concealed })
const files = (...paths: string[]): ClipboardContent => ({ kind: 'files', paths })
const image = (b = 1): ClipboardContent => ({ kind: 'image', png: new Uint8Array([b, 2, 3]) })

/** A watch over a fake clipboard (`clip.now`), recording everything it published. */
function setup(overrides: Partial<WatchDeps> = {}) {
  const clip: { now: ClipboardContent | null } = { now: text('there at start') }
  const published: (ClipboardPreview | null)[] = []
  const counts = { reads: 0 }
  const watch = new ClipboardWatch({
    read: async () => {
      counts.reads++
      return clip.now
    },
    imageInfo: () => ({ width: 1440, height: 900, thumbnail: 'data:image/png;base64,AA==' }),
    insert: async (c, claude): Promise<InsertResult | null> => {
      if (c.kind === 'image') return claude ? { text: "'/tmp/clipboard-1.png'" } : null
      return { text: c.kind === 'files' ? c.paths.join(' ') : c.text }
    },
    publish: (item) => published.push(item),
    ...overrides,
  })
  return { clip, published, counts, watch, last: () => published.at(-1) }
}

/** Lets queued looks run, and polls given a time. */
const tick = (ms = 0) => vi.advanceTimersByTimeAsync(ms)

beforeEach(() => vi.useFakeTimers())
afterEach(() => vi.useRealTimers())

describe('ClipboardWatch', () => {
  it("doesn't offer what the clipboard held at start", async () => {
    const { watch, published } = setup()
    await watch.baseline()
    watch.focus()
    await tick()
    expect(published).toEqual([])
    watch.stop()
  })

  it('offers text copied in another app when Deck comes to the front', async () => {
    const { clip, watch, last } = setup()
    await watch.baseline()
    clip.now = text('copied elsewhere\nsecond line')
    watch.focus()
    await tick()
    expect(last()).toMatchObject({ kind: 'text', lines: ['copied elsewhere', 'second line'], lineCount: 2 })
    expect(watch.current()).toEqual(last())
    watch.stop()
  })

  it('offers a screenshot taken while Deck is in front at the next look', async () => {
    const { clip, watch, last } = setup()
    await watch.baseline()
    watch.focus()
    await tick()
    clip.now = image()
    await tick(1000)
    expect(last()).toMatchObject({ kind: 'image', width: 1440, height: 900 })
    watch.stop()
  })

  it('takes text that changes while Deck is in front as its own copy: no card, and the old one goes', async () => {
    const { clip, watch, last, published } = setup()
    await watch.baseline()
    watch.focus()
    clip.now = files('/a.pdf')
    await tick(1000)
    expect(last()).toMatchObject({ kind: 'files' })
    clip.now = text('selected in the terminal')
    await tick(1000)
    expect(last()).toBeNull()
    expect(published).toHaveLength(2)
    watch.stop()
  })

  it('never offers concealed text, and drops the card when it arrives', async () => {
    const { clip, watch, last } = setup()
    await watch.baseline()
    clip.now = image()
    watch.focus()
    await tick()
    expect(last()).toMatchObject({ kind: 'image' })
    watch.blur()
    await tick()
    clip.now = text('s3cret', true)
    watch.focus()
    await tick()
    expect(last()).toBeNull()
    watch.stop()
  })

  it('publishes nothing while nothing changes', async () => {
    const { clip, watch, published, counts } = setup()
    await watch.baseline()
    clip.now = image()
    watch.focus()
    await tick(5000)
    expect(published).toHaveLength(1)
    expect(counts.reads).toBeGreaterThanOrEqual(5)
    watch.stop()
  })

  it("doesn't look while Deck is in the background, after one last look on leaving", async () => {
    const { clip, watch, last, counts } = setup()
    await watch.baseline()
    watch.focus()
    await tick()
    clip.now = files('/copied/just/before/leaving.png')
    watch.blur()
    await tick()
    expect(last()).toMatchObject({ kind: 'files', names: ['leaving.png'] })
    const reads = counts.reads
    await tick(10_000)
    expect(counts.reads).toBe(reads)
  })

  it("add() gives the snapshot's text even if the clipboard changed since, and uses the item up", async () => {
    const { clip, watch, last } = setup()
    await watch.baseline()
    clip.now = files('/x/spec.pdf')
    watch.focus()
    await tick()
    const id = last()!.id
    watch.stop() // no look sees the next change
    clip.now = text('something else')
    expect(await watch.add(id)).toEqual({ text: '/x/spec.pdf' })
    expect(last()).toBeNull()
    expect(watch.current()).toBeNull()
  })

  it('add() with an item that is gone says so', async () => {
    const { watch } = setup()
    expect(await watch.add('nope')).toEqual({ error: 'That clipboard item is gone. Copy it again.' })
  })

  it("paste() uses up the card's item, and what was pasted never shows later", async () => {
    const { clip, watch, last, published } = setup()
    await watch.baseline()
    clip.now = image()
    watch.focus()
    await tick()
    expect(await watch.paste(true)).toEqual({ text: "'/tmp/clipboard-1.png'" })
    expect(last()).toBeNull()
    await tick(3000)
    expect(published).toHaveLength(2)
    watch.stop()
  })

  it('paste() of an image in a shell tab pastes nothing and keeps the card', async () => {
    const { clip, watch, last } = setup()
    await watch.baseline()
    clip.now = image()
    watch.focus()
    await tick()
    expect(await watch.paste(false)).toBeNull()
    expect(last()).toMatchObject({ kind: 'image' })
    watch.stop()
  })

  it('a copy pasted before Deck looked never shows', async () => {
    const { clip, watch, published } = setup()
    await watch.baseline()
    clip.now = text('pasted at once')
    expect(await watch.paste(true)).toEqual({ text: 'pasted at once' })
    watch.focus()
    await tick()
    expect(published).toEqual([])
    watch.stop()
  })

  it('dismiss() hides the card', async () => {
    const { clip, watch, last } = setup()
    await watch.baseline()
    clip.now = files('/a')
    watch.focus()
    await tick()
    watch.dismiss(last()!.id)
    expect(last()).toBeNull()
    watch.stop()
  })

  it("looks one at a time, and a slow clipboard doesn't pile up looks", async () => {
    let open = 0
    let most = 0
    let reads = 0
    const { watch } = setup({
      read: async () => {
        reads++
        open++
        most = Math.max(most, open)
        await new Promise((r) => setTimeout(r, 2500))
        open--
        return null
      },
    })
    watch.focus()
    await tick(10_000)
    expect(most).toBe(1)
    expect(reads).toBeLessThanOrEqual(5)
    watch.stop()
  })
})
```

- [ ] **Step 2: Run it to make sure it fails**

Run: `npx vitest run src/main/clipboard/watch.test.ts`
Expected: FAIL, `Failed to resolve import "./watch"`.

- [ ] **Step 3: Write `src/main/clipboard/watch.ts`**

```ts
import { randomUUID } from 'node:crypto'
import type { ClipboardPreview, InsertResult } from '@shared/types'
import { type ClipboardContent, fingerprintOf, type ImageInfo, previewOf } from './item'

export interface WatchDeps {
  /** The clipboard now; null when it's empty or holds nothing Deck pastes. */
  read(): Promise<ClipboardContent | null>
  /** Size and thumbnail of a new image item. */
  imageInfo(png: Uint8Array): ImageInfo
  /** What inserts `content` into a terminal (insertFor). */
  insert(content: ClipboardContent, claude: boolean): Promise<InsertResult | null>
  /** The card's item changed. */
  publish(item: ClipboardPreview | null): void
  /** How often to look while the window is in front; 1000 ms by default. */
  pollMs?: number
}

interface Item {
  preview: ClipboardPreview
  fingerprint: string
  content: ClipboardContent
}

/** Decides what the clipboard card offers.
 *  - Deck looks when its window comes to the front and about once a second while it's there,
 *    never in the background.
 *  - Coming to the front, anything copied since Deck last looked is new: it came from another app.
 *  - While Deck is in front, only images and files are new (a screenshot to the clipboard): text
 *    that changes then is Deck's own copy (a terminal selection, Copy hash, Copy path).
 *  - Any change clears the old item, so the card shows what Cmd/Ctrl+V would paste. Concealed
 *    text (a password manager's copy) never shows.
 *  Looks, adds and pastes run one at a time. */
export class ClipboardWatch {
  private seen: string | null = null
  private item: Item | null = null
  private timer: ReturnType<typeof setInterval> | null = null
  private chain: Promise<unknown> = Promise.resolve()
  /** A poll's look is queued or running: further polls are skipped rather than piling up. */
  private looking = false

  constructor(private readonly deps: WatchDeps) {}

  current(): ClipboardPreview | null {
    return this.item?.preview ?? null
  }

  /** What the clipboard holds when Deck starts is not new. */
  baseline(): Promise<void> {
    return this.serial(async () => {
      this.seen = fingerprintOf(await this.deps.read().catch(() => null))
    })
  }

  /** The window came to the front. */
  focus(): void {
    void this.look(true)
    this.timer ??= setInterval(() => void this.look(false), this.deps.pollMs ?? 1000)
  }

  /** The window went to the background: one last look (a copy made just before) and no more. */
  blur(): void {
    this.stop()
    void this.look(false)
  }

  stop(): void {
    if (this.timer) clearInterval(this.timer)
    this.timer = null
  }

  /** The text for the card's item `id` (its snapshot), which is then used up. */
  add(id: string): Promise<InsertResult> {
    return this.serial(async () => {
      const item = this.item
      if (!item || item.preview.id !== id) return { error: 'That clipboard item is gone. Copy it again.' }
      const result = (await this.deps.insert(item.content, true)) ?? { error: 'There is nothing to add.' }
      if ('text' in result) this.set(null)
      return result
    })
  }

  /** What Cmd/Ctrl+V pastes now. Pasting the card's item uses it up, and what is pasted never shows later. */
  paste(claude: boolean): Promise<InsertResult | null> {
    return this.serial(async () => {
      let content: ClipboardContent | null
      try {
        content = await this.deps.read()
      } catch (err) {
        return { error: `Couldn't read the clipboard: ${err instanceof Error ? err.message : String(err)}` }
      }
      const fingerprint = fingerprintOf(content)
      this.seen = fingerprint
      if (!content) return null
      const result = await this.deps.insert(content, claude)
      if (result && 'text' in result && this.item?.fingerprint === fingerprint) this.set(null)
      return result
    })
  }

  dismiss(id: string): void {
    if (this.item?.preview.id === id) this.set(null)
  }

  /** `arrived`: the window just came to the front (else a poll, or leaving). */
  private look(arrived: boolean): Promise<void> {
    if (!arrived) {
      if (this.looking) return Promise.resolve()
      this.looking = true
    }
    return this.serial(async () => {
      try {
        let content: ClipboardContent | null
        try {
          content = await this.deps.read()
        } catch {
          return // unreadable just now: the next look tries again
        }
        const fingerprint = fingerprintOf(content)
        if (fingerprint === this.seen) return
        this.seen = fingerprint
        if (!content || (content.kind === 'text' && (content.concealed || !arrived))) return this.set(null)
        const image = content.kind === 'image' ? this.deps.imageInfo(content.png) : undefined
        this.set({ preview: previewOf(content, randomUUID(), image), fingerprint, content })
      } finally {
        if (!arrived) this.looking = false
      }
    })
  }

  private set(item: Item | null): void {
    if (item === null && this.item === null) return
    this.item = item
    this.deps.publish(item?.preview ?? null)
  }

  private serial<T>(task: () => Promise<T>): Promise<T> {
    const run = this.chain.then(task, task)
    this.chain = run.catch(() => undefined)
    return run
  }
}
```

- [ ] **Step 4: Run it to make sure it passes**

Run: `npx vitest run src/main/clipboard/watch.test.ts`
Expected: PASS, 14 tests.

- [ ] **Step 5: Commit**

```bash
git add src/main/clipboard/watch.ts src/main/clipboard/watch.test.ts
git -c user.email=franco@effektstudios.com commit -m "Clipboard: the watch that decides what the card offers" -m "Claude-Session: https://claude.ai/code/session_012Tidn9qVajMb9EYY5GyX8U"
```

**After review (follow-up commit; the code above is the first version):**
- **`paste()`** retires a card the clipboard has moved past. Example: Cmd+C in the terminal, then Cmd+V within a second.
- **Looks:**
  - **All or nothing:** an undecodable image gives an "Image" card.
  - **Reasons:** each look has a reason, `'arrived' | 'poll' | 'leaving'`. The leaving look always runs.
  - **Duty-cycle backoff:** a slow read (a large image) spaces the next polls out, so reading stays at about 5% of the time.
- **`focus()`** while already focused does nothing.
- **A failed `baseline()`** makes the first look the baseline.
- **Tests:**
  - the pile-up test now checks that no looks are left queued;
  - new tests for the leaving look, read failures, an undecodable image, dismissal, refocus, failed adds and the backoff.

---

### Task 5: Reading the system clipboard, IPC and the main process

**Files:**
- Create: `src/main/clipboard/read.ts`, `src/main/clipboard/image.ts`, `src/main/clipboard/ipc.ts`
- Test: `src/main/clipboard/read.test.ts`
- Modify: `src/main/index.ts`

- [ ] **Step 1: Write the failing test** — `src/main/clipboard/read.test.ts`:

```ts
import { tmpdir } from 'node:os'
import { join } from 'node:path'
import { pathToFileURL } from 'node:url'
import { beforeEach, describe, expect, it, vi } from 'vitest'
import { readClipboard } from './read'

const raw = (format: string) => `electron application/osclipboard;format="${format}"`
const fake = vi.hoisted(() => ({
  /** The clipboard's one item: type → data. Empty: nothing on the clipboard. */
  data: {} as Record<string, string | Uint8Array>,
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
```

- [ ] **Step 2: Run it to make sure it fails**

Run: `npx vitest run src/main/clipboard/read.test.ts`
Expected: FAIL, `Failed to resolve import "./read"`.

- [ ] **Step 3: Write `src/main/clipboard/read.ts`**

```ts
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
```

- [ ] **Step 4: Run it to make sure it passes**

Run: `npx vitest run src/main/clipboard/read.test.ts`
Expected: PASS, 9 tests.

- [ ] **Step 5: Write `src/main/clipboard/image.ts`**

```ts
import { nativeImage } from 'electron'
import type { ImageInfo } from './item'

const THUMB_WIDTH = 240

/** An image's size and a thumbnail at most 240 px wide, as a data: URL (the renderer's CSP allows data: images). */
export function imageInfo(png: Uint8Array): ImageInfo {
  const image = nativeImage.createFromBuffer(Buffer.from(png))
  const { width, height } = image.getSize()
  const thumb = width > THUMB_WIDTH ? image.resize({ width: THUMB_WIDTH, quality: 'good' }) : image
  return { width, height, thumbnail: thumb.isEmpty() ? '' : thumb.toDataURL() }
}
```

- [ ] **Step 6: Write `src/main/clipboard/ipc.ts`**

```ts
import { type BrowserWindow, ipcMain, powerMonitor } from 'electron'
import { IPC } from '@shared/channels'
import type { InsertResult, Platform } from '@shared/types'
import { imageInfo } from './image'
import { insertFor } from './insert'
import { readClipboard } from './read'
import { TempImages } from './temp'
import { ClipboardWatch } from './watch'

export interface ClipboardIpc {
  /** Follow this window's focus; its renderer gets the card's item. */
  attach(win: BrowserWindow): void
  /** At quit: stop looking and remove the saved images. */
  dispose(): void
}

export function registerClipboardIpc(opts: { tempDir: string; platform: Platform }): ClipboardIpc {
  const temp = new TempImages(opts.tempDir)
  temp.clear() // images a crashed run left behind
  let win: BrowserWindow | null = null
  const watch = new ClipboardWatch({
    read: readClipboard,
    imageInfo,
    insert: (content, claude) => insertFor(content, claude, { platform: opts.platform, saveImage: (png) => temp.save(png) }),
    publish: (item) => {
      if (win && !win.isDestroyed()) win.webContents.send(IPC.clipboardItem, item)
    },
  })

  ipcMain.handle(IPC.clipboardCurrent, () => watch.current())
  ipcMain.handle(IPC.clipboardAdd, (_e, id: unknown): Promise<InsertResult> | InsertResult =>
    typeof id === 'string' ? watch.add(id) : { error: 'No clipboard item given.' })
  ipcMain.handle(IPC.clipboardPaste, (_e, o: unknown) =>
    watch.paste(typeof o === 'object' && o !== null && (o as { claude?: unknown }).claude === true))
  ipcMain.on(IPC.clipboardDismiss, (_e, id: unknown) => {
    if (typeof id === 'string') watch.dismiss(id)
  })

  return {
    attach(w) {
      win = w
      void watch.baseline()
      w.on('focus', () => watch.focus())
      w.on('blur', () => watch.blur())
      // A locked screen or a sleeping Mac sends no blur: stop looking then too (blur() does nothing
      // when Deck wasn't in front). Waking with a password first fires resume, then unlock-screen:
      // look again only once unlocked.
      let locked = false
      const away = () => watch.blur()
      const back = () => {
        if (!locked && !w.isDestroyed() && w.isFocused()) watch.focus()
      }
      powerMonitor.on('lock-screen', () => {
        locked = true
        away()
      })
      powerMonitor.on('unlock-screen', () => {
        locked = false
        back()
      })
      powerMonitor.on('suspend', away)
      powerMonitor.on('resume', back)
      if (w.isFocused()) watch.focus()
    },
    dispose() {
      watch.stop()
      temp.clear()
    },
  }
}
```

- [ ] **Step 7: Wire it into `src/main/index.ts`**

1. Imports: change `import { app, type BrowserWindow, clipboard, ipcMain, Menu, shell } from 'electron'` (still needed for `copyText`), and `import type { AppInfo, PtyCreateOptions } from '@shared/types'` to `import type { AppInfo, Platform, PtyCreateOptions } from '@shared/types'`. Add `import { registerClipboardIpc } from './clipboard/ipc'`.
2. Delete the line `ipcMain.handle(IPC.appReadText, () => clipboard.readText())`.
3. After `registerClaudeIpc()` add:

```ts
  const clip = registerClipboardIpc({ tempDir: join(app.getPath('temp'), 'Deck clipboard'), platform: process.platform as Platform })
```

4. After `win = createWindow()` add `clip.attach(win)`.
5. After `app.on('before-quit', () => ptys.killAll())` add `app.on('will-quit', () => clip.dispose())`.

- [ ] **Step 8: Run the main tests and typecheck**

Run: `npx vitest run src/main src/shared && npm run typecheck 2>&1 | grep -E "error TS" | sed -E 's/\(.*//' | sort -u`
Expected:
- All tests pass.
- Typecheck errors only in `src/renderer/src/terminal/TerminalView.tsx` (`readText`), which Task 6 fixes.

- [ ] **Step 9: Commit**

```bash
git add src/main
git -c user.email=franco@effektstudios.com commit -m "Clipboard: read the system clipboard, IPC, main process wiring" -m "Claude-Session: https://claude.ai/code/session_012Tidn9qVajMb9EYY5GyX8U"
```

---

### Task 6: Smart paste and drops in the terminal

**Files:**
- Create: `src/renderer/src/terminal/paste.ts`, `src/renderer/src/terminal/paste.test.ts`
- Modify: `src/renderer/src/terminal/TerminalView.tsx`

`TerminalView` itself has no unit test: it is DOM and xterm glue, and the renderer tests run in Node without a DOM. Task 8 checks it in the real app. The marker filter is pure and is tested.

- [ ] **Step 0a: Write the failing test** — `src/renderer/src/terminal/paste.test.ts`:

```ts
import { describe, expect, it } from 'vitest'
import { pasteSafe } from './paste'

describe('pasteSafe', () => {
  it("drops the bracketed-paste markers, so pasted text can't end the paste early", () => {
    expect(pasteSafe('ls\u001b[201~\u0015rm -rf ~\r')).toBe('ls\u0015rm -rf ~\r')
    expect(pasteSafe('a\u001b[200~b')).toBe('ab')
  })

  it('drops the one-character CSI form too', () => {
    expect(pasteSafe('a\u009b201~b')).toBe('ab')
  })

  it('also drops a marker that removing another one would put together', () => {
    expect(pasteSafe('\u001b[2\u001b[201~01~x')).toBe('x')
  })

  it('leaves other text alone', () => {
    expect(pasteSafe('plain text\nwith lines')).toBe('plain text\nwith lines')
  })
})
```

- [ ] **Step 0b: Run it to make sure it fails**

Run: `npx vitest run src/renderer/src/terminal/paste.test.ts`
Expected: FAIL, `./paste` can't be resolved.

- [ ] **Step 0c: Write `src/renderer/src/terminal/paste.ts`**

```ts
/** The bracketed-paste markers xterm wraps a paste in, also in their one-character CSI form
 *  (U+009B), which quotePath refuses too. */
const MARKER = /(?:\u001b\[|\u009b)20[01]~/g

/** Text ready for xterm's paste(). xterm wraps a paste in ESC[200~ … ESC[201~ and removes nothing,
 *  so a pasted ESC[201~ would end the paste early, and what follows would act as typed keys
 *  (Ctrl+U, Enter). Removing one marker can join two halves into another, hence the loop. */
export function pasteSafe(text: string): string {
  let out = text
  for (let before = ''; before !== out; ) {
    before = out
    out = out.replace(MARKER, '')
  }
  return out
}
```

- [ ] **Step 0d: Run it to make sure it passes**

Run: `npx vitest run src/renderer/src/terminal/paste.test.ts`
Expected: PASS, 4 tests.

- [ ] **Step 1: Props and refs** — in `TerminalView.tsx`:

Imports, change the first line to

```ts
import { memo, type MutableRefObject, useEffect, useRef, useState } from 'react'
```

and add

```ts
import { quotePaths } from '@shared/quote'
import { runsClaude } from '../tabs/title'
import { pasteSafe } from './paste'
```

In `interface Props`, add:

```ts
  /** Set while mounted: pastes text into this terminal (the clipboard card's Add) and focuses it. */
  pasteRef?: MutableRefObject<((text: string) => void) | null>
```

Change the component signature to destructure `pasteRef`:

```ts
export const TerminalView = memo(function TerminalView({ tab, active, findRequest, windowsBuild, pasteRef, onUpdate, onClose }: Props) {
```

Below `const callbacks = useRef({ onUpdate, onClose })` and its effect, add:

```ts
  // The paste handler, set up once per mount, needs the tab's latest process and title.
  const tabRef = useRef(tab)
  useEffect(() => {
    tabRef.current = tab
  })
```

- [ ] **Step 2: Smart paste, drops and the card's paste**

In the mount effect, change `const { platform, pty, app } = window.deck` to `const { platform, pty, app, clipboard } = window.deck`.

Replace the `'paste'` branch of the key handler:

```ts
      } else if (action === 'paste') {
        void app.readText().then((text) => {
          if (text && !disposed) term.paste(text)
        })
      } else {
```

with

```ts
      } else if (action === 'paste') {
        smartPaste()
      } else {
```

Just above `term.attachCustomKeyEventHandler(`, add:

```ts
    // Cmd/Ctrl+V: main reads the clipboard. Copied files paste as quoted paths and, with Claude
    // running, an image as a saved PNG's path (Claude attaches it); text pastes as it is.
    const paste = (text: string) => term.paste(pasteSafe(text))
    const smartPaste = () => {
      const { process: name, title: current } = tabRef.current
      clipboard.paste({ claude: runsClaude(name, current) }).then(
        (result) => {
          if (!result || disposed) return
          if ('text' in result) paste(result.text)
          else console.warn('paste:', result.error)
        },
        (err: unknown) => console.warn('paste failed', err),
      )
    }
    // macOS: the Edit menu's Paste arrives as a paste event on xterm's textarea; take it first.
    const onPaste = (e: ClipboardEvent) => {
      e.preventDefault()
      e.stopPropagation()
      smartPaste()
    }
    // Files dropped from Finder or Explorer: their quoted paths, like pasting copied files.
    const onDragOver = (e: DragEvent) => {
      if (!e.dataTransfer?.types.includes('Files')) return
      e.preventDefault()
      e.dataTransfer.dropEffect = 'copy'
    }
    const onDrop = (e: DragEvent) => {
      const files = Array.from(e.dataTransfer?.files ?? [])
      if (!files.length) return
      e.preventDefault()
      const paths = files.map((f) => app.pathForFile(f)).filter((p) => p !== '')
      const text = quotePaths(paths, platform) // null: none, or a name with control characters
      if (text === null) {
        if (paths.length) console.warn("drop: a file name has control characters, so it isn't pasted")
        return
      }
      if (!exited) {
        paste(text)
        term.focus()
      }
    }
    host.addEventListener('paste', onPaste, true)
    host.addEventListener('dragover', onDragOver)
    host.addEventListener('drop', onDrop)
    if (pasteRef) {
      pasteRef.current = (text) => {
        if (exited) return
        paste(text)
        term.focus()
      }
    }
```

In the effect's cleanup (the `return () => { … }`), add before `term.dispose()`:

```ts
      host.removeEventListener('paste', onPaste, true)
      host.removeEventListener('dragover', onDragOver)
      host.removeEventListener('drop', onDrop)
      if (pasteRef) pasteRef.current = null
```

- [ ] **Step 3: Typecheck, tests, build**

Run: `npm run typecheck && npm test 2>&1 | grep -E 'Test Files|Tests ' && npm run build >/dev/null && echo build ok`
Expected: typecheck clean (the last `readText` use is gone), all tests pass, `build ok`.

- [ ] **Step 4: Commit**

```bash
git add src/renderer/src/terminal/TerminalView.tsx src/renderer/src/terminal/paste.ts src/renderer/src/terminal/paste.test.ts
git -c user.email=franco@effektstudios.com commit -m "Terminal: smart paste and file drops through main" -m "Claude-Session: https://claude.ai/code/session_012Tidn9qVajMb9EYY5GyX8U"
```

---

### Task 7: The clipboard card

**Files:**
- Create: `src/renderer/src/clipboard/card.ts`, `src/renderer/src/clipboard/card.test.ts`, `src/renderer/src/clipboard/useClipboardItem.ts`, `src/renderer/src/clipboard/ClipboardCard.tsx`, `src/renderer/src/clipboard/clipboard.css`
- Modify: `src/renderer/src/App.tsx`

- [ ] **Step 1: Write the failing test** — `src/renderer/src/clipboard/card.test.ts`:

```ts
import { describe, expect, it } from 'vitest'
import { cardTitle, fileBadge } from './card'

describe('cardTitle', () => {
  it('names what the card holds', () => {
    expect(cardTitle({ id: '1', kind: 'image', width: 1440, height: 900, thumbnail: '' })).toBe('Image · 1440×900')
    expect(cardTitle({ id: '2', kind: 'image', width: 0, height: 0, thumbnail: '' })).toBe('Image')
    expect(cardTitle({ id: '3', kind: 'files', names: ['a.pdf'], more: 0, folder: '/x' })).toBe('1 file')
    expect(cardTitle({ id: '4', kind: 'files', names: ['a', 'b', 'c'], more: 4, folder: '/x' })).toBe('7 files')
    expect(cardTitle({ id: '5', kind: 'text', lines: ['hi'], lineCount: 1 })).toBe('1 line')
    expect(cardTitle({ id: '6', kind: 'text', lines: ['a', 'b', 'c'], lineCount: 12 })).toBe('12 lines')
  })
})

describe('fileBadge', () => {
  it('is the extension in capitals, up to four letters', () => {
    expect(fileBadge('spec.pdf')).toBe('PDF')
    expect(fileBadge('shot one.jpeg')).toBe('JPEG')
    expect(fileBadge('notes.markdown')).toBe('')
    expect(fileBadge('Makefile')).toBe('')
    expect(fileBadge('.env')).toBe('')
  })
})
```

- [ ] **Step 2: Run it to make sure it fails**

Run: `npx vitest run src/renderer/src/clipboard/card.test.ts`
Expected: FAIL, `Failed to resolve import "./card"`.

- [ ] **Step 3: Write `src/renderer/src/clipboard/card.ts`**

```ts
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
```

- [ ] **Step 4: Run it to make sure it passes**

Run: `npx vitest run src/renderer/src/clipboard/card.test.ts`
Expected: PASS, 2 tests.

- [ ] **Step 5: Write `src/renderer/src/clipboard/useClipboardItem.ts`**

```ts
import { useEffect, useState } from 'react'
import type { ClipboardPreview } from '@shared/types'

/** The item the clipboard card offers; one for the whole window. */
export function useClipboardItem(): ClipboardPreview | null {
  const [item, setItem] = useState<ClipboardPreview | null>(null)
  useEffect(() => {
    let live = true
    const off = window.deck.clipboard.onItem((next) => setItem(next))
    // Main sends its answer and its pushes in order, so whichever arrives last is the newest.
    window.deck.clipboard.current().then(
      (now) => {
        if (live) setItem(now)
      },
      () => {},
    )
    return () => {
      live = false
      off()
    }
  }, [])
  return item
}
```

- [ ] **Step 6: Write `src/renderer/src/clipboard/ClipboardCard.tsx`**

```tsx
import type { MouseEvent } from 'react'
import type { ClipboardPreview } from '@shared/types'
import { CloseIcon } from '../icons'
import { cardTitle, fileBadge } from './card'
import './clipboard.css'

interface ClipboardCardProps {
  item: ClipboardPreview
  /** Adding is under way. */
  busy: boolean
  /** Why the last Add failed. */
  error: string | null
  onAdd(id: string): void
  onDismiss(id: string): void
}

/** Clicking the card leaves the keyboard where it was: in the terminal. */
const keepFocus = (e: MouseEvent) => e.preventDefault()

/** What was just copied, with Add to Claude; under the Claude panel of a tab where Claude runs. */
export function ClipboardCard({ item, busy, error, onAdd, onDismiss }: ClipboardCardProps) {
  return (
    <section className="clip-card" aria-label="Clipboard" onMouseDown={keepFocus}>
      <div className="clip-head">
        <span className="clip-label">Clipboard</span>
        <span className="clip-title">{cardTitle(item)}</span>
        <span className="clip-spacer" />
        <button className="icon-button" title="Dismiss" aria-label="Dismiss" onClick={() => onDismiss(item.id)}>
          <CloseIcon size={10} />
        </button>
      </div>
      {item.kind === 'image' && item.thumbnail && <img className="clip-thumb" src={item.thumbnail} alt="Copied image" />}
      {item.kind === 'files' && (
        <ul className="clip-files">
          {item.names.map((name, i) => (
            <li key={`${i}:${name}`} title={name}>
              {fileBadge(name) && <span className="clip-badge">{fileBadge(name)}</span>}
              <span className="clip-name">{name}</span>
            </li>
          ))}
          {item.more > 0 && <li className="clip-more">+{item.more} more</li>}
          <li className="clip-folder" title={item.folder}>{item.folder}</li>
        </ul>
      )}
      {item.kind === 'text' && <pre className="clip-text">{item.lines.join('\n')}</pre>}
      {error && <div className="clip-error" role="alert">{error}</div>}
      <button className="button primary clip-add" disabled={busy} onClick={() => onAdd(item.id)}>
        Add to Claude
      </button>
    </section>
  )
}
```

- [ ] **Step 7: Write `src/renderer/src/clipboard/clipboard.css`**

```css
/* The clipboard card, under the Claude panel (App.tsx: Workspace). */
.clip-card {
  flex: none;
  display: flex;
  flex-direction: column;
  gap: 8px;
  margin: 0 8px 8px;
  padding: 8px 10px 10px;
  border: 1px solid var(--line-strong);
  border-radius: 8px;
  background: var(--surface);
  color: var(--text);
  font: 12px/1.4 var(--font-ui);
}
.clip-head { display: flex; align-items: center; gap: 8px; min-width: 0; }
.clip-label { color: var(--teal); font-size: 10px; font-weight: 600; letter-spacing: 0.06em; text-transform: uppercase; }
.clip-title { min-width: 0; overflow: hidden; color: var(--muted); text-overflow: ellipsis; white-space: nowrap; }
.clip-spacer { flex: 1; }
.clip-head .icon-button { width: 20px; height: 20px; }
.clip-thumb {
  align-self: flex-start;
  max-width: 100%;
  max-height: 140px;
  border: 1px solid var(--line);
  border-radius: 4px;
  background: var(--field);
  object-fit: contain;
}
.clip-files { display: flex; flex-direction: column; gap: 3px; min-width: 0; margin: 0; padding: 0; list-style: none; }
.clip-files li { display: flex; align-items: center; gap: 6px; min-width: 0; }
.clip-name, .clip-folder { overflow: hidden; text-overflow: ellipsis; white-space: nowrap; }
.clip-badge { flex: none; padding: 0 4px; border-radius: 3px; background: var(--tab-active); color: var(--muted); font: 600 9px/16px var(--font-mono); }
.clip-more { color: var(--faint); }
.clip-folder { color: var(--faint); font: 11px/1.4 var(--font-mono); }
.clip-text {
  max-height: 64px;
  margin: 0;
  padding: 6px 8px;
  overflow: hidden;
  border-radius: 4px;
  background: var(--field);
  color: var(--text);
  font: 11px/1.45 var(--font-mono);
  white-space: pre;
}
.clip-error { color: var(--red); }
.clip-add { align-self: flex-start; height: 26px; }
```

- [ ] **Step 8: Wire it into `src/renderer/src/App.tsx`**

1. Imports. Change line 2 to

   ```ts
   import type { AppInfo, ClipboardPreview, MenuCommand, ProjectAction } from '@shared/types'
   ```

   and add

   ```ts
   import { ClipboardCard } from './clipboard/ClipboardCard'
   import { useClipboardItem } from './clipboard/useClipboardItem'
   ```

2. In `App()`, below the `claudeToggles` state, add:

   ```ts
     /** What was just copied, offered under the Claude panel of tabs where Claude runs. */
     const clipItem = useClipboardItem()
   ```

3. In the `terminals.map(…)` JSX, add `clipItem={clipItem}` to `<Workspace …>`.

4. In `interface WorkspaceProps`, add:

   ```ts
     /** The clipboard card's item (one for the window). */
     clipItem: ClipboardPreview | null
   ```

5. In `Workspace`, change the first destructuring line to:

   ```ts
     const { tab, active, home, gitWidth, claudeWidth, findRequest, claudeToggle, windowsBuild, clipItem } = props
   ```

6. Below `const claudeRef = useRef<HTMLDivElement>(null)`, add:

   ```ts
     /** Pastes into this tab's terminal (TerminalView sets it). */
     const pasteRef = useRef<((text: string) => void) | null>(null)
     const [clip, setClip] = useState<{ busy: boolean; error: string | null }>({ busy: false, error: null })
     useEffect(() => setClip({ busy: false, error: null }), [clipItem?.id])
     // An Add answered after a newer item replaced its own: its error isn't the new card's.
     const clipIdRef = useRef(clipItem?.id)
     useLayoutEffect(() => {
       clipIdRef.current = clipItem?.id
     }, [clipItem?.id])
     const addClip = useCallback((id: string) => {
       setClip({ busy: true, error: null })
       const fail = (error: string) => setClip({ busy: false, error: clipIdRef.current === id ? error : null })
       window.deck.clipboard.add(id).then(
         (result) => {
           if ('text' in result) {
             pasteRef.current?.(result.text)
             setClip({ busy: false, error: null })
           } else fail(result.error)
         },
         (err: unknown) => fail(err instanceof Error ? err.message : String(err)),
       )
     }, [])
     const dismissClip = useCallback((id: string) => window.deck.clipboard.dismiss(id), [])
   ```

7. Pass the ref to the terminal. Change

   ```tsx
         <TerminalView tab={tab} active={active} windowsBuild={windowsBuild} findRequest={findRequest}
           onUpdate={onUpdate} onClose={onClose} />
   ```

   to

   ```tsx
         <TerminalView tab={tab} active={active} windowsBuild={windowsBuild} findRequest={findRequest}
           pasteRef={pasteRef} onUpdate={onUpdate} onClose={onClose} />
   ```

8. Render the card under the panel. In the `.claude-pane` div, after `<ClaudePanel … />`, add:

   ```tsx
             {claudeRuns && clipItem && (
               <ClipboardCard item={clipItem} busy={clip.busy} error={clip.error} onAdd={addClip} onDismiss={dismissClip} />
             )}
   ```

- [ ] **Step 9: Typecheck, tests, build**

Run: `npm run typecheck && npm test 2>&1 | grep -E 'Test Files|Tests ' && npm run build >/dev/null && echo build ok`
Expected: typecheck clean, all tests pass, `build ok`.

- [ ] **Step 10: Commit**

```bash
git add src/renderer/src/clipboard src/renderer/src/App.tsx
git -c user.email=franco@effektstudios.com commit -m "Clipboard card under the Claude panel, with Add to Claude" -m "Claude-Session: https://claude.ai/code/session_012Tidn9qVajMb9EYY5GyX8U"
```

---

### Task 8: Check it in the real app, then the docs

**Files:**
- Modify: `README.md`, `CLAUDE.md`, `docs/TESTING.md`, `docs/DECK.md`

The checks put things on the system clipboard. Before starting, tell Franco and save what's there.

**A save/restore helper** (scratchpad only, not the repo). It must stay running while it holds files, because macOS drops all but the first item once the writer quits. Build it with `swiftc -O pb.swift -o pb`:

```swift
import AppKit
// pb save <file> | pb restore <file> | pb hold-files <path>… (stays alive 60 s) | pb hold-png <file> (60 s)
let pb = NSPasteboard.general
let a = CommandLine.arguments
switch a[1] {
case "save":
  let items = (pb.pasteboardItems ?? []).map { i in Dictionary(uniqueKeysWithValues: i.types.compactMap { t in i.data(forType: t).map { (t.rawValue, $0) } }) }
  try! PropertyListSerialization.data(fromPropertyList: items, format: .binary, options: 0).write(to: URL(fileURLWithPath: a[2]))
case "restore":
  let items = try! PropertyListSerialization.propertyList(from: Data(contentsOf: URL(fileURLWithPath: a[2])), format: nil) as! [[String: Data]]
  pb.clearContents()
  _ = pb.writeObjects(items.map { d in let it = NSPasteboardItem(); d.forEach { it.setData($1, forType: .init($0)) }; return it })
case "hold-files":
  pb.clearContents(); _ = pb.writeObjects(a[2...].map { URL(fileURLWithPath: $0) as NSURL })
  RunLoop.main.run(until: Date().addingTimeInterval(60))
case "hold-png":
  pb.clearContents(); pb.setData(try! Data(contentsOf: URL(fileURLWithPath: a[2])), forType: .png)
  RunLoop.main.run(until: Date().addingTimeInterval(60))
default: break
}
```

- [ ] **Step 1: Start the dev app with the DevTools protocol**, and give it a tab where a fake "claude" echoes into a file. A copy of `cat` named `claude` makes Deck see Claude running, so the card shows. Its output goes to a file, which can be read (the terminal is a WebGL canvas):

```bash
pb save /tmp/deck-clip-saved.plist
mkdir -p /tmp/deckclip && cp /bin/cat /tmp/deckclip/claude
npx electron-vite dev --remoteDebuggingPort 9333 &        # wait until http://127.0.0.1:9333/json answers
node node_modules/electron/cli.js . --open /tmp/deckclip   # a shell tab in /tmp/deckclip
```

In that tab, type `./claude > out.txt` and press Return. Type it through the page, with CDP `Input.insertText` followed by a Return key event.

- [ ] **Step 2: A screenshot while Deck is in front shows the card.** Run `pb hold-png build/icon.png &`, wait 1.5 s, then read the card through CDP: `document.querySelector('.clip-card')?.textContent`.
  Expected: it contains `Clipboard` and `Image · 1024×1024`. Take a window screenshot (`screencapture -l <id>`) and look at it.

- [ ] **Step 3: Add to Claude inserts the saved PNG's path.** Click the card's button via CDP (`document.querySelector('.clip-add').click()`), send Return, and read `/tmp/deckclip/out.txt`.
  Expected:
  - a line `'<temp>/Deck clipboard/clipboard-<hash>.png'` (the quoted path);
  - that PNG file exists;
  - the card is gone.

- [ ] **Step 4: Copied files paste as quoted paths with Cmd+V.** Run `pb hold-files /tmp/deckclip/out.txt "/tmp/deckclip/a b.txt" &` (create `a b.txt` first). Then send a real Cmd+V: `osascript` System Events `keystroke "v" using command down`, only after checking that Electron is frontmost. Send Return, and read `out.txt`.
  Expected: `'/tmp/deckclip/out.txt' '/tmp/deckclip/a b.txt'`, and the card for those files is gone (paste used it up).

- [ ] **Step 5: Text copied while Deck is in front shows no card.** Run `pb restore` of a text-only plist, or `printf 'x' | pbcopy`, wait 1.5 s.
  Expected: no `.clip-card`.

- [ ] **Step 6: A drop inserts quoted paths.** Over the terminal, use CDP `Input.dispatchDragEvent`: `dragEnter`, `dragOver` and `drop` at its centre, with `data: { items: [], files: ['/tmp/deckclip/a b.txt'], dragOperationsMask: 1 }`. Send Return, and read `out.txt`.
  Expected: `'/tmp/deckclip/a b.txt'`.

- [ ] **Step 6a: More pastes.** Each one through Cmd+V into the fake claude:
  - a PNG and a PDF copied together: both quoted paths arrive;
  - a file whose name contains `'`: arrives as `'it'\''s.png'`.

  Then start a real `claude` in a scratch folder, paste the PNG and PDF pair, and check that the image shows as `[Image #N]`.

- [ ] **Step 6b: The cost of looking.** Keep Deck in front for 30 s each time and compare the main process's CPU with nothing new on the clipboard:
  - with a 100 MB text on the clipboard;
  - with a 5K screenshot PNG (`pb hold-png`).

  Each should stay well under 5% of a core. The git poll's 12% is the warning sign.

- [ ] **Step 6c: Lock and unlock.** With Deck in front, lock the screen (⌃⌘Q), wait 5 s, then unlock.
  - Polling stops while locked: no reads, which shows up in the CPU check of 6b.
  - It starts again after unlocking. A screenshot taken then shows a card at the next look.

  If no card appears, `w.isFocused()` was false at `unlock-screen`, and `back()` needs another signal (`focus` again after unlock).

- [ ] **Step 7: Clean up.** Stop the fake claude with Ctrl+D, quit the dev app, then run `pb restore /tmp/deck-clip-saved.plist` and `rm -rf /tmp/deckclip`. Compare the clipboard's checksum with the one from before; don't print its contents.

- [ ] **Step 8: Docs**

`README.md`, in the Claude panel bullets, after **Picker**:

```md
  - **Clipboard:** what you just copied in another app (an image, files, text) shows
    under the panel with **Add to Claude**, which puts it into the prompt without sending.
    Cmd/Ctrl+V does the same in any tab: copied files paste as quoted paths, and with
    Claude running an image pastes as `[Image #N]`. Dropping files on the terminal pastes
    their paths. Deck looks at the clipboard only while it's in front, never shows a
    password manager's copy, and keeps no history.
```

`CLAUDE.md`, in "Things that aren't obvious", add a bullet:

```md
- Clipboard (`src/main/clipboard/`):
  - **Electron 45's clipboard is async and web-like:** `read()` returns one item whose
    `types` are MIME types plus raw platform formats (`electron application/osclipboard;format="…"`).
    Copied files are in its `text/uri-list` (every file); the raw `NSFilenamesPboardType` holds only the first.
  - **When Deck looks:** only while its window is in front, on focus and once a second. Text
    that changes while Deck is in front is Deck's own copy and gets no card.
  - **Password managers:** their copies carry `org.nspasteboard.ConcealedType` (macOS) or
    `ExcludeClipboardContentFromMonitorProcessing` / `CanIncludeInClipboardHistory`=0 (Windows),
    and get no card.
  - **Images:** saved to `<temp>/Deck clipboard/` and pasted as a quoted path, which Claude
    Code turns into `[Image #N]`; cleared at start and quit.
  - **Testing on macOS:** a clipboard written by a process that has quit keeps only its first
    item, so test writers must stay running (Finder does).
  - **Known limits:**
    - **Text copied while Deck is in front shows no card**, even when it came from elsewhere: Universal Clipboard text, OCR overlays and other panels that don't take focus, Keyboard Maestro or Shortcuts. That's the price of not offering Deck's own copies; children of Deck that write the clipboard while it's in front (`pbcopy`, Claude's `/copy`) rightly show no card. Images and files always show.
    - **The same content twice gets no card:** A → B → A while away, or copying something you already used or dismissed. Electron offers no clipboard change counter.
    - **Polls back off when a read is slow** (about 5% of the time). A locked screen or a sleeping Mac stops them.
  - **Paste safety:**
    - Every paste goes through `pasteSafe()`, which removes the `ESC[200~`/`ESC[201~` markers.
      xterm wraps a paste in them and filters nothing, so a pasted `ESC[201~` would run the rest
      as typed keys.
    - `quotePath()` refuses paths with control characters, because no quoting makes them safe.
```

In the file table, change the `src/shared/` row to:

```md
| `src/shared/` | `DeckApi` IPC contract (`types.ts`), channel names, and `quote.ts` (shell quoting, used by main and the renderer); the only thing main and renderer share |
```

Also add a row to the `src/main` table:

```md
| `src/main/clipboard/` | reads the clipboard (files, text, images; concealed copies skipped), decides what the card offers, saves pasted images for Claude |
```

`docs/TESTING.md`, in "Claude panel" after step 18, add:

```md
18a. Copy two files in Explorer, come back to Deck: a Clipboard card under the Claude panel
     lists them. **Add to Claude** puts both quoted paths into the prompt. (If only the first
     file arrives, report it: Windows' file list needs another route.)
18b. Win+Shift+S a region, come back: the card shows the image; Ctrl+V in the Claude tab
     inserts `[Image #1]`. (If Claude shows the path as text instead, report it: Windows
     paths may need double quotes.)
18c. Copy a password from your password manager: no card, and Ctrl+V pastes it as before.
18d. Drag a PDF from Explorer onto the terminal: its quoted path appears.
18e. Copy a new screenshot and click **Add to Claude** several times quickly. Each click
     inserts the path, with no "Couldn't save the image" error. (Antivirus can hold a
     just-written file for a moment; Deck retries.)
18f. With Deck in front, copy in Excel or Word several times: no "clipboard in use" failures
     (Deck reads the clipboard about once a second while in front).
```

`docs/DECK.md`, in M5, add `(built 2026-10-31; Windows to test)` after the clipboard bullet's title.

- [ ] **Step 9: Full check and commit**

Run: `npm run typecheck && npm test 2>&1 | grep -E 'Test Files|Tests ' && npm run build >/dev/null && echo build ok`

```bash
git add README.md CLAUDE.md docs/TESTING.md docs/DECK.md
git -c user.email=franco@effektstudios.com commit -m "Clipboard: docs, Windows checks" -m "Claude-Session: https://claude.ai/code/session_012Tidn9qVajMb9EYY5GyX8U"
```
