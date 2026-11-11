# Images in the Claude panel Implementation Plan

> **For agentic workers:** REQUIRED SUB-SKILL: Use superpowers:subagent-driven-development (recommended) or superpowers:executing-plans to implement this plan task-by-task. Steps use checkbox (`- [ ]`) syntax for tracking.

**Goal:** Show the images in Claude's session log in the Claude panel, as the Claude app does: pasted
images under their prompt and a tool result's images under its tool call, as thumbnails, with a large
viewer, Open in the default image app, and a header switch that hides them in every tab. macOS and
Windows.

**Architecture:** The parser lists each image on its feed item (`ClaudeImage`: an id that is the
SHA-1 of its base64, format and size from its header, bytes, its `[Image #N]`) and keeps, in a
`WeakMap` beside the item, where the image's line is in the log (byte offset and length, which
`JsonlTail` now returns). Snapshots carry the list, never pixels. When a thumbnail comes near view the
renderer asks main for it: main reads that line again, finds the image by id and answers a `data:`
URL (the image itself, or a 480×360 thumbnail made with `nativeImage`), one request at a time with
full images first. Open saves a copy in the clipboard's temp folder and opens it.
`claude_activity_pane.py` gets the same rules and prints counts. Spec:
`docs/superpowers/specs/2026-11-10-claude-panel-images-design.md` (approved 2026-11-11).

**Tech Stack:** Electron 45 (`nativeImage`, `shell.openPath`, IPC), Node 22 (`fs/promises`, `crypto`,
`zlib`), React 19, TypeScript, vitest (node environment), Python 3 (the prototype), plain CSS with the
tokens in `src/renderer/src/styles.css`.

**Conventions:**
- Node 22: `export PATH="$HOME/.nvm/versions/node/v22.19.0/bin:$PATH"` before npm commands.
- Work in the worktree `~/.config/superpowers/worktrees/deck/m5-claude-images`
  (branch `m5-claude-images`, which has the spec and this plan). Every command below runs there.
- Commits use `git -c user.email=franco@effektstudios.com commit` and never carry `Co-Authored-By`.
  Each message ends with `Claude-Session: https://claude.ai/code/session_012TidnBvRYbxhSYqPzFZuph`
  (the second `-m` of every commit command below).
- Comments explain why, in the repo's plain style. Tests sit next to their source as `*.test.ts`.
- Never commit a session log, an image from one, or a screenshot of Deck showing one: they hold client
  code and prompts. Tests build logs with `src/main/claude/test-log.ts`.
- What main runs for the renderer checks its arguments and never throws: `ipcMain.handle` handlers
  answer `{ error }`, and the pixel queue answers every request it takes.
- Tests that need POSIX file modes are skipped on Windows (CI runs macOS and Windows); paths are built
  with `node:path`.

**Numbers this plan relies on.**

Measured (the spec, 2026-11-10: all local logs, Claude Code 2.1.258–2.1.293; Electron 45.2):
- 1,087 images: 963 PNG, 124 JPEG, all base64 sources; the declared type always matched the bytes;
  no GIF, WebP, URL or file sources. At most 3 in one item; the busiest 300-item window held 32.
- Decoded, median 113 KB and largest 512 KB; long side median 1,000 px, largest 2,000 px; at most
  3.4 MP.
- Lines holding images: median 296 KB, largest 2.2 MB; `JSON.parse` takes about 0.55 ms per MB.
- Every JPEG's size marker (SOF) was within its first 39 KB; 819 of the 963 PNGs have alpha.
- A thumbnail in main (decode, `resize` to fit 480×360 with quality `good`, encode): PNG 2.5–15.2 ms
  and 18–33 KB; a JPEG as JPEG at 85, 3.3–5.8 ms and 9–27 KB. Re-reading a line by its offset and
  checking the hash: 0.1–0.9 ms. SHA-1: 1.9 GB/s.
- `nativeImage` reads neither GIF nor WebP (both come back 0×0).

Measured while writing this plan (2026-11-11, with this plan's code in a throwaway copy of the
worktree, never in the repo): every test below passed, and so did `npm run typecheck`, `npm run build`
and `python3 -m py_compile`; the replay (Task 7) matched on all 678 local logs then (logs come and go);
the live check (Task 18) passed on a crafted log, run twice, with main spending 3.5–6.6 ms per
thumbnail made (423–793 ms for 120 while scrolling through them: about 3% of a core) and the renderer
at about 200 MB with 250 thumbnails shown.

Chosen, not measured: at most 10 images listed per item; base64 over 16 MiB of text is neither listed
nor read; a line over 64 MiB isn't read again; a JPEG's size marker is looked for in its first 96 KiB
when listing (in all of its bytes when its pixels are read); thumbnails fit 480×360 (twice the panel's
240×180 box) and a PNG or JPEG within that is its own thumbnail; an image whose header gives no size
gets a 120 px square box; a GIF or WebP thumbnail is the image itself up to 1 MiB; more than 16,384 px
a side or 40 MP is "Too large to show"; JPEG thumbnails at quality 85; the renderer keeps 24 MiB of
thumbnail URLs; a thumbnail is asked for within one feed-height of view; byte sizes in powers of
1,000.

**Decisions this plan makes where the spec is silent** (Task 19 records them in the spec):
1. An image beside several `tool_result`s in one entry goes with the last of them.
2. `SessionState` takes `maxFeed` (default 600), so the replay keeps every item and tests push items
   out cheaply.
3. `imageSource()` answers from the folder's followed log whichever renderer asks, not only a
   subscribed one: a tab coming to the front may ask before its subscribe has been answered.
4. Open has no pixel limit: it's how an image that is "Too large to show" can still be seen.
5. A header that gives no size even over all of the bytes is "Couldn't decode this image", for the
   thumbnail and the full image.
6. Bad IPC arguments answer "No longer in the session log", as an unknown id does.
7. The images switch lives in App (`deck.claudeImages`, like the usage card's fold), so it hides images
   in every tab at once; ✻ (thinking) stays per panel as before.
8. Row keys move from `Feed` up to `ClaudePanel`, so the viewer names an image `<row key>:<index>` (the
   same picture twice is two entries, each with its place).
9. A string prompt queued while Claude works is now cleaned of `<pasted_content>` in the prototype too,
   as the TypeScript parser does.
10. CHANGELOG.md gets its section in the release commit, as every version so far has; Task 19 puts the
    draft in the spec.

---

## File structure

| File | Responsibility |
|---|---|
| `src/shared/types.ts`, `src/shared/channels.ts`, `src/preload/index.ts` (modify) | `ClaudeImageFormat`, `ClaudeImage`, `images`/`moreImages` on prompt and tool items, `ClaudeImageData`, `claude.image()` and `claude.openImage()`, `claude:image`, `claude:open-image` |
| `src/main/claude/test-log.ts` (modify), `test-log.test.ts` (create) | image blocks with real data: whole PNGs, JPEG/GIF/WebP headers; prompts with images and `imagePasteIds`; Read results; queued prompts with blocks; `readLines()` with each line's place |
| `src/main/claude/images.ts` (create) | pure: the format from the bytes, the size from the header, `imageRef`/`imagesOf` (what the panel lists), `findImageData` (an image by id in an entry), `IMAGE_EXT` |
| `src/main/claude/tail.ts` (modify) | `LinePlace`; `read()` returns each entry's place |
| `src/main/claude/session.ts` (modify) | the rules: images on prompts, tool results and answers; at most 10 per item; places in a `WeakMap`; `imagePlace(id)`; `maxFeed` |
| `claude_activity_pane.py` (modify) | the same rules, counted; `▣ N images` lines |
| `src/main/claude/snapshot.ts` (modify) | copies `images` and `moreImages` |
| `src/main/clipboard/temp.ts`, `ipc.ts` (modify) | `save(bytes, ext, prefix)`; `clear()` knows `image-<hash>.<ext>`; `saveImage` passes them on |
| `src/main/claude/pixels.ts` (create) | reading a line again, the thumbnail, the full image, the size guard, the one-at-a-time queue |
| `src/main/claude/subscriptions.ts` (modify) | places into `ingest()`; `imageSource(folder, id)` |
| `src/main/claude/ipc.ts` (modify), `src/main/index.ts` (modify) | `claude:image` and `claude:open-image` with their checks; Open's `saveImage` and `openPath` |
| `src/renderer/src/claude/images.ts` (create) | pure: thumbnail and viewer sizes, captions, the feed's images and stepping, `ThumbCache` |
| `src/renderer/src/claude/feedItems.ts` (modify) | `sameEntry` and `sameItem` compare images |
| `src/renderer/src/claude/useThumbnail.ts` (create) | `thumbs` (the window's cache), `NearView` (one IntersectionObserver per feed), `useThumbnail` |
| `src/renderer/src/claude/ImageTiles.tsx` (create) | an item's thumbnails, "+N more", or "▣ N images" |
| `src/renderer/src/claude/ImageViewer.tsx` (create) | the viewer, rendered into `<body>` |
| `src/renderer/src/claude/Feed.tsx`, `ClaudePanel.tsx`, `src/renderer/src/App.tsx`, `src/renderer/src/icons.tsx`, `src/renderer/src/claude/panel.css` (modify) | rows with images; keys, the viewer's state and the header's switch; the window-wide flag; `PictureIcon`; styles |
| `CLAUDE.md`, `README.md`, `docs/DECK.md`, `docs/TESTING.md`, the spec (modify) | docs |

---

### Task 1: The IPC contract

**Files:**
- Modify: `src/shared/types.ts` (`ClaudeFeedItem`; inside `DeckApi.claude`)
- Modify: `src/shared/channels.ts`
- Modify: `src/preload/index.ts`

- [ ] **Step 1: Types**

In `src/shared/types.ts`, replace the `ClaudeFeedItem` type:

```ts
export type ClaudeFeedItem =
  | { kind: 'prompt'; text: string }
  | { kind: 'thinking'; text: string } // '' when the log kept only the signature
  | { kind: 'reply'; text: string } // markdown
  | { kind: 'tool'; id: string; name: string; summary: string; state: 'running' | 'done' | 'error'; error?: string }
  | { kind: 'notice'; text: string; tone: 'info' | 'error' }
```

with:

```ts
export type ClaudeImageFormat = 'png' | 'jpeg' | 'gif' | 'webp'

/** An image in Claude's session log as the panel lists it: never its pixels (claude.image() reads
 *  those from the log when they're shown). */
export interface ClaudeImage {
  /** The first 16 hex digits of the SHA-1 of its base64 text: the same image always gets the same id. */
  id: string
  /** From its bytes, not the log's media_type. */
  format: ClaudeImageFormat
  /** In pixels, from its header; 0 when the header doesn't say. */
  width: number
  height: number
  /** Its size, decoded. */
  bytes: number
  /** Its [Image #N] number, for an image pasted into a prompt. */
  paste?: number
}

export type ClaudeFeedItem =
  /** images: pasted ones, in paste order (at most 10); moreImages: how many more it had. */
  | { kind: 'prompt'; text: string; images?: ClaudeImage[]; moreImages?: number }
  | { kind: 'thinking'; text: string } // '' when the log kept only the signature
  | { kind: 'reply'; text: string } // markdown
  /** images: what its result held (or an answer's pasted image), at most 10; moreImages: how many more. */
  | {
      kind: 'tool'; id: string; name: string; summary: string; state: 'running' | 'done' | 'error'; error?: string
      images?: ClaudeImage[]; moreImages?: number
    }
  | { kind: 'notice'; text: string; tone: 'info' | 'error' }

/** An image's pixels as a data: URL, or why there are none. */
export type ClaudeImageData = { url: string } | { error: string }
```

Inside `DeckApi`'s `claude: { … }`, after `follow(…): Promise<void>`, add:

```ts
    /** Image `id` of the session `folder` follows, read again from its log: 'thumb' fits 480×360 (a
     *  small PNG or JPEG is itself), 'full' is the image itself. { error } says why there's none:
     *  "No longer in the session log", "Too large to show", "Couldn't decode this image", "No preview". */
    image(folder: string, id: string, size: 'thumb' | 'full'): Promise<ClaudeImageData>
    /** Opens a copy of image `id` in the default image app (the copy is removed when Deck quits):
     *  null, or why it couldn't. */
    openImage(folder: string, id: string): Promise<{ error: string } | null>
```

- [ ] **Step 2: Channels**

In `src/shared/channels.ts`, after `claudeFollow: 'claude:follow',`, add:

```ts
  claudeImage: 'claude:image',
  claudeOpenImage: 'claude:open-image',
```

- [ ] **Step 3: Preload**

In `src/preload/index.ts`, in `claude: { … }`, after the `follow:` line, add:

```ts
    image: (folder, id, size) => ipcRenderer.invoke(IPC.claudeImage, folder, id, size),
    openImage: (folder, id) => ipcRenderer.invoke(IPC.claudeOpenImage, folder, id),
```

- [ ] **Step 4: Typecheck**

Run: `npm run typecheck`
Expected: PASS (nothing reads the new fields yet).

- [ ] **Step 5: Commit**

```bash
git add src/shared/types.ts src/shared/channels.ts src/preload/index.ts
git -c user.email=franco@effektstudios.com commit -m "Claude images: the IPC contract" -m "Claude-Session: https://claude.ai/code/session_012TidnBvRYbxhSYqPzFZuph"
```

---

### Task 2: Test logs with real image data

**Files:**
- Modify: `src/main/claude/test-log.ts`
- Test: `src/main/claude/test-log.test.ts` (create)

The parser and main's pixel code decide by the bytes, so tests need real ones: whole PNGs (built with
`zlib` and `zlib.crc32`, which any decoder reads), and JPEG, GIF and WebP headers built by hand (enough
to tell the format and size; nothing decodes them in tests). `readLines()` gives each line's place, as
the app's tail will (Task 4).

- [ ] **Step 1: Write the failing test**

Create `src/main/claude/test-log.test.ts`:

```ts
import { appendFileSync, readFileSync, writeFileSync } from 'node:fs'
import { join } from 'node:path'
import { crc32, inflateSync } from 'node:zlib'
import { afterAll, describe, expect, it } from 'vitest'
import { gifBytes, imageBlock, jpegBytes, makeFolder, pngBytes, pngHeaderBytes, readLines, removeClaudeHomes, webpBytes } from './test-log'

afterAll(removeClaudeHomes)

/** The PNG's chunks: type, data, and whether its CRC is right. */
function chunks(png: Buffer) {
  const out: { type: string; data: Buffer; crcOk: boolean }[] = []
  for (let at = 8; at < png.length;) {
    const length = png.readUInt32BE(at)
    const type = png.toString('latin1', at + 4, at + 8)
    const data = png.subarray(at + 8, at + 8 + length)
    const crcOk = png.readUInt32BE(at + 8 + length) === crc32(png.subarray(at + 4, at + 8 + length)) >>> 0
    out.push({ type, data, crcOk })
    at += 12 + length
  }
  return out
}

describe('test-log image builders', () => {
  it('pngBytes is a whole PNG: signature, IHDR, pixel rows that inflate, IEND, every CRC right', () => {
    const png = pngBytes(30, 20, { alpha: true })
    expect([...png.subarray(0, 8)]).toEqual([0x89, 0x50, 0x4e, 0x47, 0x0d, 0x0a, 0x1a, 0x0a])
    const list = chunks(png)
    expect(list.map((c) => c.type)).toEqual(['IHDR', 'IDAT', 'IEND'])
    expect(list.every((c) => c.crcOk)).toBe(true)
    expect([list[0].data.readUInt32BE(0), list[0].data.readUInt32BE(4), list[0].data[9]]).toEqual([30, 20, 6])
    expect(inflateSync(list[1].data).length).toBe(20 * (1 + 30 * 4))
  })

  it('pngHeaderBytes has a header and no pixels; the others carry their sizes where decoders look', () => {
    expect(chunks(pngHeaderBytes(20_000, 10)).map((c) => c.type)).toEqual(['IHDR', 'IEND'])
    const jpeg = jpegBytes(923, 2000, { app1Bytes: 70_000 })
    const sof = jpeg.indexOf(Buffer.from([0xff, 0xc0]))
    expect(sof).toBeGreaterThan(70_000)
    expect([jpeg.readUInt16BE(sof + 5), jpeg.readUInt16BE(sof + 7)]).toEqual([2000, 923])
    expect(gifBytes(100, 50).toString('latin1', 0, 6)).toBe('GIF89a')
    expect(webpBytes(640, 480, 'VP8X').toString('latin1', 12, 16)).toBe('VP8X')
  })

  it('imageBlock is a base64 image block', () => {
    expect(imageBlock(Buffer.from([1, 2, 3]), 'image/jpeg')).toEqual({ type: 'image', source: { type: 'base64', media_type: 'image/jpeg', data: 'AQID' } })
  })
})

describe('readLines', () => {
  it("each whole line's entry and place in bytes; broken and blank lines skipped, a last line without its newline too", () => {
    const path = join(makeFolder('deck-lines-'), 'log.jsonl')
    writeFileSync(path, '{"a":"héllo ✻"}\n\nnot json\r\n{"b":2}\r\n')
    appendFileSync(path, '{"c":')
    const bytes = readFileSync(path)
    const lines = readLines(path)
    expect(lines.map((l) => l.entry)).toEqual([{ a: 'héllo ✻' }, { b: 2 }])
    for (const l of lines) expect(JSON.parse(bytes.toString('utf8', l.offset, l.offset + l.length))).toEqual(l.entry)
    expect(lines[0]).toMatchObject({ offset: 0, length: Buffer.byteLength('{"a":"héllo ✻"}') })
  })
})
```

- [ ] **Step 2: Run it to make sure it fails**

Run: `npx vitest run src/main/claude/test-log.test.ts`
Expected: FAIL: `pngBytes`, `readLines` and the other new exports don't exist (`is not a function`).

- [ ] **Step 3: The builders**

In `src/main/claude/test-log.ts`:

Replace the imports' last three lines:

```ts
import { tmpdir } from 'node:os'
import { dirname, join } from 'node:path'
import { encodeFolder } from './locator'
```

with:

```ts
import { tmpdir } from 'node:os'
import { dirname, join } from 'node:path'
import { crc32, deflateSync } from 'node:zlib'
import { encodeFolder } from './locator'
```

Before `/** The log's lines, parsed (lines that aren't JSON are left out). */`, add:

```ts
/** A log line that is JSON, and where it is in the file: bytes, without its newline. */
export interface LogLine {
  entry: unknown
  offset: number
  length: number
}

/** The log's whole lines (ended by a newline) that are JSON, with their places, as JsonlTail reads them. */
export function readLines(path: string): LogLine[] {
  const bytes = readFileSync(path)
  const lines: LogLine[] = []
  for (let start = 0, end = bytes.indexOf(0x0a); end >= 0; start = end + 1, end = bytes.indexOf(0x0a, start)) {
    const text = bytes.toString('utf8', start, end)
    if (!text.trim()) continue
    try {
      lines.push({ entry: JSON.parse(text), offset: start, length: end - start })
    } catch {
      // a deliberately broken line
    }
  }
  return lines
}
```

Replace `PromptOptions`:

```ts
export interface PromptOptions {
  /** origin.kind; null leaves `origin` out, as older logs do. Default 'human'. */
  origin?: string | null
  isMeta?: boolean
  /** Pasted images before the text. */
  images?: number
}
```

with:

```ts
export interface PromptOptions {
  /** origin.kind; null leaves `origin` out, as older logs do. Default 'human'. */
  origin?: string | null
  isMeta?: boolean
  /** Pasted images before the text: each image's bytes, or a count of blocks with empty data (which
   *  the panel doesn't show). */
  images?: number | Uint8Array[]
  /** The entry's imagePasteIds: Claude Code's [Image #N] numbers, one per image block. */
  pasteIds?: unknown
}
```

Replace the `prompt()` method:

```ts
  /** A typed prompt: content string, or image blocks then a text block. */
  prompt(text: string, opts: PromptOptions = {}): this {
    const { origin = 'human', isMeta, images = 0 } = opts
    const content = images
      ? [
          ...Array.from({ length: images }, () => ({ type: 'image', source: { type: 'base64', media_type: 'image/png', data: '' } })),
          ...(text ? [{ type: 'text', text }] : []),
        ]
      : text
    return this.line('user', {
      promptId: randomUUID(),
      message: { role: 'user', content },
      ...(origin === null ? {} : { origin: { kind: origin } }),
      ...(isMeta ? { isMeta: true } : {}),
    })
  }
```

with:

```ts
  /** A typed prompt: content string, or image blocks then a text block. */
  prompt(text: string, opts: PromptOptions = {}): this {
    const { origin = 'human', isMeta, images = 0, pasteIds } = opts
    const blocks = typeof images === 'number'
      ? Array.from({ length: images }, () => ({ type: 'image', source: { type: 'base64', media_type: 'image/png', data: '' } }))
      : images.map((bytes) => imageBlock(bytes))
    const content = blocks.length ? [...blocks, ...(text ? [{ type: 'text', text }] : [])] : text
    return this.line('user', {
      promptId: randomUUID(),
      message: { role: 'user', content },
      ...(pasteIds === undefined ? {} : { imagePasteIds: pasteIds }),
      ...(origin === null ? {} : { origin: { kind: origin } }),
      ...(isMeta ? { isMeta: true } : {}),
    })
  }
```

Before the `system(subtype: string, …)` method, add:

```ts
  /** Claude reading an image file: a Read call whose result holds the image, which the line's
   *  toolUseResult repeats (file.base64), as Claude Code writes it. */
  readImage(id: string, filePath: string, bytes: Uint8Array, mediaType = 'image/png'): this {
    const block = imageBlock(bytes, mediaType)
    return this.toolUse(id, 'Read', { file_path: filePath }).toolResult(id, {
      content: [block],
      toolUseResult: { type: 'image', file: { base64: block.source.data, type: mediaType, originalSize: bytes.length } },
    })
  }
```

Before the `notification(…)` method's doc comment (`/** A background agent or shell task ended: …`), add:

```ts
  /** A prompt with content blocks (text, pasted images) typed while Claude was busy. */
  queuedBlocks(content: unknown[], opts: { pasteIds?: unknown; origin?: string | null } = {}): this {
    const { pasteIds, origin = 'human' } = opts
    return this.attachment({
      type: 'queued_command',
      prompt: content,
      commandMode: 'prompt',
      ...(pasteIds === undefined ? {} : { imagePasteIds: pasteIds }),
      ...(origin === null ? {} : { origin: { kind: origin } }),
      source_uuid: randomUUID(),
      timestamp: new Date(clock).toISOString(),
    })
  }
```

At the end of the file, before the doc comment of `sessionLog()` (the file's last function), add:

```ts
// Images, as Claude Code logs them: base64 in the line. The PNGs are whole (any decoder reads them);
// the JPEG, GIF and WebP builders write headers only, enough to tell the format and size.

/** An image content block holding `bytes`. The panel goes by the bytes, so `mediaType` may lie. */
export function imageBlock(bytes: Uint8Array, mediaType = 'image/png') {
  return { type: 'image', source: { type: 'base64', media_type: mediaType, data: Buffer.from(bytes).toString('base64') } }
}

const PNG_SIGNATURE = Buffer.from([0x89, 0x50, 0x4e, 0x47, 0x0d, 0x0a, 0x1a, 0x0a])

function pngChunk(type: string, data: Buffer): Buffer {
  const head = Buffer.alloc(8)
  head.writeUInt32BE(data.length, 0)
  head.write(type, 4, 'latin1')
  const crc = Buffer.alloc(4)
  crc.writeUInt32BE(crc32(Buffer.concat([head.subarray(4), data])) >>> 0, 0)
  return Buffer.concat([head, data, crc])
}

function ihdr(width: number, height: number, alpha: boolean): Buffer {
  const data = Buffer.alloc(13)
  data.writeUInt32BE(width, 0)
  data.writeUInt32BE(height, 4)
  data[8] = 8 // bits per channel
  data[9] = alpha ? 6 : 2 // RGBA or RGB
  return pngChunk('IHDR', data)
}

/** A whole PNG: a gradient, and with `alpha` its right half see-through. Different sizes make
 *  different images (different ids). */
export function pngBytes(width: number, height: number, opts: { alpha?: boolean } = {}): Buffer {
  const alpha = Boolean(opts.alpha)
  const channels = alpha ? 4 : 3
  const stride = 1 + width * channels // each row starts with its filter byte (0: none)
  const raw = Buffer.alloc(stride * height)
  for (let y = 0; y < height; y++) {
    for (let x = 0; x < width; x++) {
      const at = y * stride + 1 + x * channels
      raw[at] = Math.round((x * 255) / Math.max(1, width - 1))
      raw[at + 1] = Math.round((y * 255) / Math.max(1, height - 1))
      raw[at + 2] = 160
      if (alpha) raw[at + 3] = x < width / 2 ? 255 : 96
    }
  }
  return Buffer.concat([PNG_SIGNATURE, ihdr(width, height, alpha), pngChunk('IDAT', deflateSync(raw)), pngChunk('IEND', Buffer.alloc(0))])
}

/** A PNG's signature and header with no pixels: any size, for checks that never decode. */
export function pngHeaderBytes(width: number, height: number): Buffer {
  return Buffer.concat([PNG_SIGNATURE, ihdr(width, height, false), pngChunk('IEND', Buffer.alloc(0))])
}

/** A JPEG's markers without its picture: SOI, `app1Bytes` of APP1 (EXIF) segments before the size
 *  marker, SOF0 (baseline) or SOF2 (progressive), EOI. */
export function jpegBytes(width: number, height: number, opts: { progressive?: boolean; app1Bytes?: number } = {}): Buffer {
  const parts: Buffer[] = [Buffer.from([0xff, 0xd8])]
  for (let left = opts.app1Bytes ?? 0; left > 0; left -= 65_533) {
    const n = Math.min(left, 65_533) // a segment's length field counts itself: at most 65,535
    const segment = Buffer.alloc(4 + n)
    segment[0] = 0xff
    segment[1] = 0xe1
    segment.writeUInt16BE(n + 2, 2)
    parts.push(segment)
  }
  const sof = Buffer.alloc(19)
  sof[0] = 0xff
  sof[1] = opts.progressive ? 0xc2 : 0xc0
  sof.writeUInt16BE(17, 2)
  sof[4] = 8
  sof.writeUInt16BE(height, 5)
  sof.writeUInt16BE(width, 7)
  sof[9] = 3
  parts.push(sof, Buffer.from([0xff, 0xd9]))
  return Buffer.concat(parts)
}

/** A GIF's header and logical screen, then its trailer. */
export function gifBytes(width: number, height: number): Buffer {
  const head = Buffer.alloc(13)
  head.write('GIF89a', 0, 'latin1')
  head.writeUInt16LE(width, 6)
  head.writeUInt16LE(height, 8)
  return Buffer.concat([head, Buffer.from([0x3b])])
}

/** A WebP's RIFF header and first chunk, in each of its three forms: lossy (VP8), lossless (VP8L) and
 *  extended (VP8X). */
export function webpBytes(width: number, height: number, kind: 'VP8' | 'VP8L' | 'VP8X' = 'VP8'): Buffer {
  let body: Buffer
  if (kind === 'VP8') {
    body = Buffer.alloc(10) // frame tag, start code, 14-bit width and height
    body[3] = 0x9d
    body[4] = 0x01
    body[5] = 0x2a
    body.writeUInt16LE(width & 0x3fff, 6)
    body.writeUInt16LE(height & 0x3fff, 8)
  } else if (kind === 'VP8L') {
    body = Buffer.alloc(5) // signature, then width-1 and height-1 in 14 bits each
    body[0] = 0x2f
    body.writeUInt32LE((((width - 1) & 0x3fff) | (((height - 1) & 0x3fff) << 14)) >>> 0, 1)
  } else {
    body = Buffer.alloc(10) // flags, reserved, then canvas width-1 and height-1 in 24 bits each
    body.writeUIntLE(width - 1, 4, 3)
    body.writeUIntLE(height - 1, 7, 3)
  }
  const head = Buffer.alloc(20)
  head.write('RIFF', 0, 'latin1')
  head.writeUInt32LE(12 + body.length, 4)
  head.write('WEBP', 8, 'latin1')
  head.write(kind === 'VP8' ? 'VP8 ' : kind, 12, 'latin1')
  head.writeUInt32LE(body.length, 16)
  return Buffer.concat([head, body])
}
```

- [ ] **Step 4: Run the tests**

Run: `npx vitest run src/main/claude/`
Expected: PASS, the existing session tests too (`prompt('', { images: 2 })` still writes blocks with
empty data).

- [ ] **Step 5: Commit**

```bash
git add src/main/claude/test-log.ts src/main/claude/test-log.test.ts
git -c user.email=franco@effektstudios.com commit -m "Claude images: test logs with real image data" -m "Claude-Session: https://claude.ai/code/session_012TidnBvRYbxhSYqPzFZuph"
```

---

### Task 3: Image headers, ids and lookups

**Files:**
- Create: `src/main/claude/images.ts`
- Test: `src/main/claude/images.test.ts`

Pure functions over the log's image blocks. Listing an image decodes only the start of its base64
(128 characters, or 96 KiB for a JPEG) and hashes all of it: 0.3 ms for the largest image measured.

- [ ] **Step 1: Write the failing test**

Create `src/main/claude/images.test.ts`:

```ts
import { createHash } from 'node:crypto'
import { describe, expect, it } from 'vitest'
import { findImageData, IMAGE_EXT, imageId, imageRef, imageSize, imagesOf, MAX_BASE64, sniffFormat } from './images'
import { gifBytes, imageBlock, jpegBytes, pngBytes, pngHeaderBytes, webpBytes } from './test-log'

const b64 = (bytes: Uint8Array) => Buffer.from(bytes).toString('base64')
const block = (data: string) => ({ type: 'image', source: { type: 'base64', media_type: 'image/png', data } })

describe('sniffFormat', () => {
  it('tells PNG, JPEG, GIF and WebP from their first bytes', () => {
    expect(sniffFormat(pngBytes(2, 2))).toBe('png')
    expect(sniffFormat(jpegBytes(2, 2))).toBe('jpeg')
    expect(sniffFormat(gifBytes(2, 2))).toBe('gif')
    expect(sniffFormat(Buffer.from('GIF87a....'))).toBe('gif')
    expect(sniffFormat(webpBytes(2, 2))).toBe('webp')
  })

  it('anything else, or too few bytes, is no format', () => {
    for (const bytes of [Buffer.from('%PDF-1.7'), Buffer.from('BM6\x00'), Buffer.from([0x89, 0x50]), Buffer.from('RIFF\x00\x00\x00\x00WAVE'), Buffer.alloc(0)]) {
      expect(sniffFormat(bytes)).toBeNull()
    }
  })
})

describe('imageSize', () => {
  it("PNG: IHDR's width and height", () => {
    expect(imageSize('png', pngBytes(1440, 900))).toEqual({ width: 1440, height: 900 })
    expect(imageSize('png', pngHeaderBytes(20_000, 10))).toEqual({ width: 20_000, height: 10 })
  })

  it('JPEG: the first SOF, baseline or progressive, behind a large APP1 segment', () => {
    expect(imageSize('jpeg', jpegBytes(923, 2000))).toEqual({ width: 923, height: 2000 })
    expect(imageSize('jpeg', jpegBytes(1600, 1200, { progressive: true, app1Bytes: 60_000 }))).toEqual({ width: 1600, height: 1200 })
  })

  it('GIF and WebP in its three forms', () => {
    expect(imageSize('gif', gifBytes(100, 50))).toEqual({ width: 100, height: 50 })
    expect(imageSize('webp', webpBytes(640, 480, 'VP8'))).toEqual({ width: 640, height: 480 })
    expect(imageSize('webp', webpBytes(641, 481, 'VP8L'))).toEqual({ width: 641, height: 481 })
    expect(imageSize('webp', webpBytes(5000, 3000, 'VP8X'))).toEqual({ width: 5000, height: 3000 })
  })

  it('0×0 when the header is cut short or makes no sense', () => {
    const none = { width: 0, height: 0 }
    expect(imageSize('png', pngBytes(10, 10).subarray(0, 20))).toEqual(none)
    expect(imageSize('jpeg', jpegBytes(800, 600).subarray(0, 8))).toEqual(none)
    expect(imageSize('jpeg', jpegBytes(800, 600, { app1Bytes: 1000 }).subarray(0, 500))).toEqual(none)
    expect(imageSize('jpeg', Buffer.from([0xff, 0xd8, 0xff, 0xe0, 0x00, 0x01, 0x00]))).toEqual(none) // length < 2
    expect(imageSize('jpeg', Buffer.from([0xff, 0xd8, 0x12, 0x34, 0x56]))).toEqual(none) // lost sync
    expect(imageSize('jpeg', Buffer.from([0xff, 0xd8, 0xff, 0xda, 0x00, 0x08, 0, 0, 0, 0, 0, 0]))).toEqual(none) // the scan before any SOF
    expect(imageSize('gif', gifBytes(1, 1).subarray(0, 8))).toEqual(none)
    expect(imageSize('webp', webpBytes(10, 10).subarray(0, 24))).toEqual(none)
    expect(imageSize('webp', Buffer.from('RIFF\x10\x00\x00\x00WEBPABCD\x00\x00\x00\x00......'))).toEqual(none)
  })
})

describe('imageRef', () => {
  it("id, format, size, bytes and paste number; the id is the SHA-1 of the base64 text, cut to 16 hex digits", () => {
    const png = pngBytes(64, 48)
    const data = b64(png)
    expect(imageRef(block(data), 3)).toEqual({
      id: createHash('sha1').update(data).digest('hex').slice(0, 16), format: 'png', width: 64, height: 48, bytes: png.length, paste: 3,
    })
    expect(imageRef(block(data))).not.toHaveProperty('paste')
    expect(imageId(data)).toMatch(/^[0-9a-f]{16}$/)
  })

  it('the bytes decide the format, not media_type', () => {
    expect(imageRef(imageBlock(jpegBytes(320, 240), 'image/png'))).toMatchObject({ format: 'jpeg', width: 320, height: 240 })
    expect(imageRef(imageBlock(gifBytes(7, 9), 'image/jpeg'))).toMatchObject({ format: 'gif', width: 7, height: 9 })
    expect(imageRef(imageBlock(webpBytes(30, 20, 'VP8L'), 'image/png'))).toMatchObject({ format: 'webp', width: 30, height: 20 })
  })

  it("a JPEG whose size marker is past its first 96 KiB is listed without a size", () => {
    expect(imageRef(imageBlock(jpegBytes(1600, 1200, { app1Bytes: 120_000 }), 'image/jpeg'))).toMatchObject({ format: 'jpeg', width: 0, height: 0 })
  })

  it('skips URL and file sources, empty data, text over 16 MiB, other formats and non-blocks', () => {
    const png = b64(pngBytes(2, 2))
    for (const bad of [
      { type: 'image', source: { type: 'url', url: 'https://example.com/a.png' } },
      { type: 'image', source: { type: 'file', file_id: 'file_123' } },
      block(''),
      block(png + 'A'.repeat(MAX_BASE64)),
      block(b64(Buffer.from('%PDF-1.7 not an image'))),
      { type: 'image', source: { type: 'base64', data: 42 } },
      { type: 'image' },
      { type: 'text', text: png },
      null, 'image', 42,
    ]) {
      expect(imageRef(bad)).toBeNull()
    }
  })
})

describe('imagesOf', () => {
  const a = imageBlock(pngBytes(4, 4))
  const b = imageBlock(pngBytes(5, 4))
  const url = { type: 'image', source: { type: 'url', url: 'https://example.com/x.png' } }

  it('the image blocks in order, numbered by imagePasteIds when it has one positive integer per image block', () => {
    const blocks = [a, { type: 'text', text: 'look' }, url, b]
    expect(imagesOf(blocks, [1, 2, 3]).map((r) => [r.width, r.paste])).toEqual([[4, 1], [5, 3]])
    for (const ids of [undefined, [1, 2], [1, 2, 3, 4], [1, 0, 3], [1, '2', 3], [1.5, 2, 3], 'x']) {
      expect(imagesOf(blocks, ids).map((r) => r.paste)).toEqual([undefined, undefined])
    }
  })

  it('the same image twice gets one id', () => {
    const [x, y] = imagesOf([a, imageBlock(pngBytes(4, 4))])
    expect(x.id).toBe(y.id)
  })
})

describe('findImageData', () => {
  const png = b64(pngBytes(8, 8))
  const other = b64(pngBytes(9, 8))
  const id = imageId(png)

  it("finds the image in a prompt's content, a tool result's content or a queued prompt's blocks", () => {
    expect(findImageData({ type: 'user', message: { content: [block(other), block(png), { type: 'text', text: 'x' }] } }, id)).toBe(png)
    expect(findImageData({ type: 'user', message: { content: [{ type: 'tool_result', tool_use_id: 't1', content: [{ type: 'text', text: 'ok' }, block(png)] }] } }, id)).toBe(png)
    expect(findImageData({ type: 'attachment', attachment: { type: 'queued_command', prompt: [block(png)] } }, id)).toBe(png)
  })

  it("never looks in toolUseResult, and answers null for an id the entry doesn't hold", () => {
    expect(findImageData({ type: 'user', message: { content: [{ type: 'tool_result', content: [block(other)] }] }, toolUseResult: { file: { base64: png } } }, id)).toBeNull()
    expect(findImageData({ type: 'user', message: { content: [block(other)] } }, id)).toBeNull()
    for (const bad of [null, 42, {}, { message: { content: 'text' } }, { attachment: { prompt: 'text' } }]) expect(findImageData(bad, id)).toBeNull()
  })
})

describe('IMAGE_EXT', () => {
  it('names the file Open writes', () => {
    expect(IMAGE_EXT).toEqual({ png: 'png', jpeg: 'jpg', gif: 'gif', webp: 'webp' })
  })
})
```

- [ ] **Step 2: Run it to make sure it fails**

Run: `npx vitest run src/main/claude/images.test.ts`
Expected: FAIL: `./images` can't be resolved.

- [ ] **Step 3: The module**

Create `src/main/claude/images.ts`:

```ts
import { createHash } from 'node:crypto'
import type { ClaudeImage, ClaudeImageFormat } from '@shared/types'
import { isRecord } from './describe'

/** Base64 text longer than this (12 MiB decoded) isn't listed or read: the largest image in the
 *  measured logs was 512 KB. */
export const MAX_BASE64 = 16 * 1024 * 1024
/** A JPEG's size marker is looked for in its first 96 KiB: every one measured was within 39 KB. */
const JPEG_HEAD = 96 * 1024
/** Base64 characters decoded to tell the format and read a PNG, GIF or WebP header: 96 bytes. */
const HEAD_CHARS = 128

/** The files Open writes, by format. */
export const IMAGE_EXT: Record<ClaudeImageFormat, 'png' | 'jpg' | 'gif' | 'webp'> = { png: 'png', jpeg: 'jpg', gif: 'gif', webp: 'webp' }

export interface ImageSize {
  width: number
  height: number
}

const NONE: ImageSize = { width: 0, height: 0 }

const ascii = (b: Uint8Array, at: number, text: string): boolean => {
  for (let i = 0; i < text.length; i++) if (b[at + i] !== text.charCodeAt(i)) return false
  return true
}
const u16be = (b: Uint8Array, i: number) => (b[i] << 8) | b[i + 1]
const u16le = (b: Uint8Array, i: number) => b[i] | (b[i + 1] << 8)
const u24le = (b: Uint8Array, i: number) => b[i] | (b[i + 1] << 8) | (b[i + 2] << 16)
const u32be = (b: Uint8Array, i: number) => ((b[i] << 24) | (b[i + 1] << 16) | (b[i + 2] << 8) | b[i + 3]) >>> 0
const u32le = (b: Uint8Array, i: number) => (b[i] | (b[i + 1] << 8) | (b[i + 2] << 16) | (b[i + 3] << 24)) >>> 0

/** The format the bytes start with; null for anything else. */
export function sniffFormat(b: Uint8Array): ClaudeImageFormat | null {
  if (b.length >= 8 && b[0] === 0x89 && ascii(b, 1, 'PNG\r\n\x1a\n')) return 'png'
  if (b.length >= 3 && b[0] === 0xff && b[1] === 0xd8 && b[2] === 0xff) return 'jpeg'
  if (b.length >= 6 && (ascii(b, 0, 'GIF87a') || ascii(b, 0, 'GIF89a'))) return 'gif'
  if (b.length >= 12 && ascii(b, 0, 'RIFF') && ascii(b, 8, 'WEBP')) return 'webp'
  return null
}

/** IHDR, the first chunk: width and height at bytes 16 and 20. */
function pngSize(b: Uint8Array): ImageSize {
  return b.length >= 24 && ascii(b, 12, 'IHDR') ? { width: u32be(b, 16), height: u32be(b, 20) } : NONE
}

// SOF0–SOF15 carry the frame's size, except DHT (C4), JPG (C8) and DAC (CC).
const isSof = (marker: number) => marker >= 0xc0 && marker <= 0xcf && marker !== 0xc4 && marker !== 0xc8 && marker !== 0xcc

/** The first SOF marker's size, walking the segments from the start; none once the scan starts
 *  (the picture's data follows), or when the bytes stop making sense. */
function jpegSize(b: Uint8Array): ImageSize {
  let i = 2
  while (i + 1 < b.length) {
    if (b[i] !== 0xff) return NONE
    const marker = b[i + 1]
    if (marker === 0xff) {
      i++ // a fill byte
      continue
    }
    i += 2
    if (marker === 0xd8 || marker === 0x01 || (marker >= 0xd0 && marker <= 0xd7)) continue // no length
    if (marker === 0xd9 || marker === 0xda || i + 1 >= b.length) return NONE
    const length = u16be(b, i)
    if (length < 2) return NONE
    if (isSof(marker)) return i + 6 < b.length ? { width: u16be(b, i + 5), height: u16be(b, i + 3) } : NONE
    i += length
  }
  return NONE
}

/** The logical screen's size. */
function gifSize(b: Uint8Array): ImageSize {
  return b.length >= 10 ? { width: u16le(b, 6), height: u16le(b, 8) } : NONE
}

/** From the first chunk: lossy (VP8), lossless (VP8L) or extended (VP8X). */
function webpSize(b: Uint8Array): ImageSize {
  if (ascii(b, 12, 'VP8 ') && b.length >= 30 && b[23] === 0x9d && b[24] === 0x01 && b[25] === 0x2a) {
    return { width: u16le(b, 26) & 0x3fff, height: u16le(b, 28) & 0x3fff }
  }
  if (ascii(b, 12, 'VP8L') && b.length >= 25 && b[20] === 0x2f) {
    const bits = u32le(b, 21)
    return { width: (bits & 0x3fff) + 1, height: ((bits >>> 14) & 0x3fff) + 1 }
  }
  if (ascii(b, 12, 'VP8X') && b.length >= 30) return { width: u24le(b, 24) + 1, height: u24le(b, 27) + 1 }
  return NONE
}

/** The size an image's header gives, which is what a decoder goes by; 0×0 when it doesn't say. */
export function imageSize(format: ClaudeImageFormat, b: Uint8Array): ImageSize {
  switch (format) {
    case 'png':
      return pngSize(b)
    case 'jpeg':
      return jpegSize(b)
    case 'gif':
      return gifSize(b)
    case 'webp':
      return webpSize(b)
  }
}

/** The base64 text of an image block with a base64 source: non-empty and at most MAX_BASE64. null
 *  for anything else: a URL or file source (Deck never fetches one), empty or oversized data. */
function base64Of(block: unknown): string | null {
  if (!isRecord(block) || block.type !== 'image' || !isRecord(block.source)) return null
  const { type, data } = block.source
  return type === 'base64' && typeof data === 'string' && data.length > 0 && data.length <= MAX_BASE64 ? data : null
}

/** The first 16 hex digits of the SHA-1 of an image's base64 text: a fresh string that keeps nothing
 *  of the line alive, and says nothing about the session. */
export const imageId = (base64: string): string => createHash('sha1').update(base64).digest('hex').slice(0, 16)

/** What the panel lists for an image block: null when it isn't one it shows (see base64Of), or its
 *  bytes aren't PNG, JPEG, GIF or WebP. Only the start of the base64 is decoded; the hash reads it all. */
export function imageRef(block: unknown, paste?: number): ClaudeImage | null {
  const data = base64Of(block)
  if (data === null) return null
  const head = Buffer.from(data.slice(0, HEAD_CHARS), 'base64')
  const format = sniffFormat(head)
  if (!format) return null
  const size = imageSize(format, format === 'jpeg' ? Buffer.from(data.slice(0, (JPEG_HEAD / 3) * 4), 'base64') : head)
  return {
    id: imageId(data), format, width: size.width, height: size.height, bytes: Buffer.byteLength(data, 'base64'),
    ...(paste ? { paste } : {}),
  }
}

/** The images among `blocks` that the panel shows, in order. `pasteIds` (an entry's imagePasteIds)
 *  numbers them when it holds one positive integer per image block, skipped ones included. */
export function imagesOf(blocks: readonly unknown[], pasteIds?: unknown): ClaudeImage[] {
  const images = blocks.filter((b) => isRecord(b) && b.type === 'image')
  const numbers = Array.isArray(pasteIds) && pasteIds.length === images.length
    && pasteIds.every((n) => Number.isInteger(n) && (n as number) > 0) ? (pasteIds as number[]) : null
  const refs: ClaudeImage[] = []
  images.forEach((block, i) => {
    const ref = imageRef(block, numbers?.[i])
    if (ref) refs.push(ref)
  })
  return refs
}

/** The base64 text of the image block in `entry` whose id is `id`: in a prompt's content, a
 *  tool_result's content or a queued prompt's blocks, never toolUseResult (which repeats Read's
 *  image). null when there's none, e.g. the log was rewritten since the id was listed. */
export function findImageData(entry: unknown, id: string): string | null {
  if (!isRecord(entry)) return null
  const lists: unknown[][] = []
  const message = isRecord(entry.message) ? entry.message : null
  if (message && Array.isArray(message.content)) {
    lists.push(message.content)
    for (const b of message.content) if (isRecord(b) && b.type === 'tool_result' && Array.isArray(b.content)) lists.push(b.content)
  }
  const attachment = isRecord(entry.attachment) ? entry.attachment : null
  if (attachment && Array.isArray(attachment.prompt)) lists.push(attachment.prompt)
  for (const list of lists) {
    for (const block of list) {
      const data = base64Of(block)
      if (data !== null && imageId(data) === id) return data
    }
  }
  return null
}
```

- [ ] **Step 4: Run it**

Run: `npx vitest run src/main/claude/images.test.ts`
Expected: PASS (15 tests).

- [ ] **Step 5: Commit**

```bash
git add src/main/claude/images.ts src/main/claude/images.test.ts
git -c user.email=franco@effektstudios.com commit -m "Claude images: headers, ids and lookups" -m "Claude-Session: https://claude.ai/code/session_012TidnBvRYbxhSYqPzFZuph"
```

---
### Task 4: Each log entry's place in the file

**Files:**
- Modify: `src/main/claude/tail.ts`
- Test: `src/main/claude/tail.test.ts`

Main keeps no image data: it reads an image's line again when the image is shown, so it needs where
each line is. The tail now splits the bytes on newlines and decodes each line on its own, so offsets
stay exact in bytes whatever multi-byte text came before, and a line split between two reads keeps the
offset where it began.

- [ ] **Step 1: Write the failing tests**

In `src/main/claude/tail.test.ts`, change the first import to:

```ts
import { appendFileSync, readFileSync, truncateSync, writeFileSync } from 'node:fs'
```

and the tail's import to:

```ts
import { JsonlTail, type LinePlace } from './tail'
```

In "returns the complete lines, then only what was appended", replace:

```ts
    expect(await tail.read()).toEqual({ entries: [{ a: 1 }, { a: 2 }], reset: false, more: false })
    expect(await tail.read()).toEqual({ entries: [], reset: false, more: false })
```

with:

```ts
    expect(await tail.read()).toEqual({
      entries: [{ a: 1 }, { a: 2 }], places: [{ offset: 0, length: 7 }, { offset: 8, length: 7 }], reset: false, more: false,
    })
    expect(await tail.read()).toEqual({ entries: [], places: [], reset: false, more: false })
```

In "reads a file that shrank again from the start, with reset", replace:

```ts
    expect(await tail.read()).toEqual({ entries: [{ b: 1 }], reset: true, more: false })
```

with:

```ts
    expect(await tail.read()).toEqual({ entries: [{ b: 1 }], places: [{ offset: 0, length: 7 }], reset: true, more: false })
```

In "a missing file reads as nothing, and is read once it appears", replace:

```ts
    expect(await tail.read()).toEqual({ entries: [], reset: false, more: false })
```

with:

```ts
    expect(await tail.read()).toEqual({ entries: [], places: [], reset: false, more: false })
```

Before the test "remembers the size and modification time it last saw", add:

```ts
  it("each entry's place: its line's offset and length in bytes, exact around multi-byte text, blank and broken lines", async () => {
    const path = file()
    writeFileSync(path, '{"t":"héllo ✻ 😀"}\n\nnot json\n{"t":"wörld"}\r\n')
    const { entries, places } = await new JsonlTail(path).read()
    expect(entries).toEqual([{ t: 'héllo ✻ 😀' }, { t: 'wörld' }])
    expect(places).toEqual([
      { offset: 0, length: Buffer.byteLength('{"t":"héllo ✻ 😀"}') },
      { offset: Buffer.byteLength('{"t":"héllo ✻ 😀"}\n\nnot json\n'), length: Buffer.byteLength('{"t":"wörld"}\r') },
    ])
    const bytes = readFileSync(path)
    places.forEach((p, i) => expect(JSON.parse(bytes.toString('utf8', p.offset, p.offset + p.length))).toEqual(entries[i]))
  })

  it('a line split between two reads keeps the offset where it began', async () => {
    const path = file()
    writeFileSync(path, '{"a":1}\n{"b":"ü')
    const tail = new JsonlTail(path)
    expect((await tail.read()).places).toEqual([{ offset: 0, length: 7 }])
    appendFileSync(path, 'ber"}')
    expect((await tail.read()).places).toEqual([])
    appendFileSync(path, '\n{"c":3}\n')
    expect(await tail.read()).toMatchObject({
      entries: [{ b: 'über' }, { c: 3 }],
      places: [{ offset: 8, length: Buffer.byteLength('{"b":"über"}') }, { offset: 8 + Buffer.byteLength('{"b":"über"}\n'), length: 7 }],
    })
  })

  it('places stay exact when every read is cut short, through lines and characters', async () => {
    const path = file()
    const lines = Array.from({ length: 40 }, (_, i) => JSON.stringify({ i, text: `héllo ✻ ${'x'.repeat(i * 3)}` }))
    writeFileSync(path, `${lines.join('\n')}\n`)
    const tail = new JsonlTail(path)
    const places: LinePlace[] = []
    for (;;) {
      const read = await tail.read(53)
      places.push(...read.places)
      if (!read.more) break
    }
    const bytes = readFileSync(path)
    expect(places.map((p) => bytes.toString('utf8', p.offset, p.offset + p.length))).toEqual(lines)
  })
```

- [ ] **Step 2: Run them to make sure they fail**

Run: `npx vitest run src/main/claude/tail.test.ts`
Expected: FAIL: `read()` returns no `places`, so the changed `toEqual`s fail and the new tests read
`places` of undefined.

- [ ] **Step 3: The tail**

Replace `src/main/claude/tail.ts` with:

```ts
import { open, stat } from 'node:fs/promises'

const NL = 0x0a

/** Where a line is in its file, in bytes (its newline not included). */
export interface LinePlace {
  offset: number
  length: number
}

/**
 * Reads a JSONL file incrementally: each read() returns the lines appended since the last one.
 * Claude appends to its logs, so only the new bytes are read; a 15 MB log is read once.
 */
export class JsonlTail {
  /** Bytes consumed (complete lines plus the pending partial line). */
  private pos = 0
  /** The start of a line whose newline hasn't been written yet, as raw bytes: a UTF-8 character
   *  may be cut in half at the end of what's been read. */
  private partial: Buffer[] = []
  /** Where that line starts in the file. */
  private partialStart = 0
  /** Size and modification time (ms) at the last read; 0 before the first. */
  size = 0
  modified = 0

  constructor(readonly path: string) {}

  /**
   * Entries appended since the last call (parsed objects; bad lines skipped; a partial last line
   * waits for its newline; a file that shrank is read again from the start and `reset` is true),
   * and each entry's place in the file, at the same index. At most `maxBytes` are read per call;
   * `more` says there is more to read already.
   */
  async read(maxBytes = Number.POSITIVE_INFINITY): Promise<{ entries: unknown[]; places: LinePlace[]; reset: boolean; more: boolean }> {
    let size: number
    try {
      const st = await stat(this.path)
      size = st.size
      this.modified = st.mtimeMs
    } catch {
      return { entries: [], places: [], reset: false, more: false } // not written yet, or deleted
    }
    let reset = false
    if (size < this.pos) {
      // Rewritten: start again (the caller drops what it parsed).
      this.pos = 0
      this.partial = []
      this.partialStart = 0
      reset = true
    }
    this.size = size
    if (size === this.pos) return { entries: [], places: [], reset, more: false }

    const want = Math.min(size - this.pos, Math.max(1, maxBytes))
    const chunk = Buffer.allocUnsafe(want)
    let got = 0
    try {
      const fh = await open(this.path, 'r')
      try {
        while (got < want) {
          const { bytesRead } = await fh.read(chunk, got, want - got, this.pos + got)
          if (bytesRead === 0) break // truncated while reading; the next read sees the new size
          got += bytesRead
        }
      } finally {
        await fh.close()
      }
    } catch {
      return { entries: [], places: [], reset, more: false }
    }
    const start = this.pos
    this.pos += got
    const data = chunk.subarray(0, got)
    const entries: unknown[] = []
    const places: LinePlace[] = []
    // Each line is decoded on its own (a newline byte never sits inside a multi-byte character), so
    // its place is exact in bytes whatever text comes before it.
    let from = 0
    for (let nl = data.indexOf(NL); nl >= 0; nl = data.indexOf(NL, from)) {
      const offset = this.partial.length ? this.partialStart : start + from
      const line = this.partial.length ? Buffer.concat([...this.partial, data.subarray(from, nl)]) : data.subarray(from, nl)
      this.partial = []
      from = nl + 1
      const text = line.toString('utf8')
      if (!text.trim()) continue
      try {
        entries.push(JSON.parse(text))
        places.push({ offset, length: line.length })
      } catch {
        // A broken line (a crash mid-write, a different program); the rest still counts.
      }
    }
    if (from < data.length) {
      if (!this.partial.length) this.partialStart = start + from
      // Copied, so the rest of the chunk can be freed (unless it's all of it).
      this.partial.push(from === 0 ? data : Buffer.from(data.subarray(from)))
    }
    return { entries, places, reset, more: this.pos < size }
  }
}
```

- [ ] **Step 4: Run them**

Run: `npx vitest run src/main/claude/tail.test.ts src/main/claude/subscriptions.test.ts src/main/claude/ipc.test.ts`
Expected: PASS (subscriptions' `LogReader` still accepts a read result with extra fields).

- [ ] **Step 5: Commit**

```bash
git add src/main/claude/tail.ts src/main/claude/tail.test.ts
git -c user.email=franco@effektstudios.com commit -m "Claude panel: each log entry's place in the file" -m "Claude-Session: https://claude.ai/code/session_012TidnBvRYbxhSYqPzFZuph"
```

---

**After review (Tasks 1-4, built in `ef5799f`..`cb69583`):** what later tasks must know, since
their snippets were written before it:
- `findImageData(line, id, bytes)` now takes the image's listed byte count (third argument) and
  compares the decoded length before hashing a candidate. Every call in Tasks 10-12 passes the
  `bytes` of the `ClaudeImage` being looked up.
- `imageSize` follows the decoders: JPEG sizes come from a libjpeg-style marker walk, a GIF's size is
  its screen grown to cover the first frame, and a JPEG with an EXIF orientation of 5-8 reports its
  upright (swapped) size. `jpegOrientation(bytes)` (1 when absent) is exported.
- Task 10: a JPEG whose `jpegOrientation` isn't 1 is passed through as is for its thumbnail (as GIF and
  WebP are, under the same 1 MiB limit), since Chromium honours EXIF orientation and `nativeImage`
  doesn't; beyond the limit it gets the "Too large to show" placeholder like them.
- The tail treats a changed inode like a shrink (a replaced log is read again from the start); the
  docs task's "Rewritten logs" line says so.
- Ids are `digest().toString('hex', 0, 8)` (16 hex characters, as before).

---

### Task 5: Images on prompts and tool calls

**Files:**
- Modify: `src/main/claude/session.ts`
- Test: `src/main/claude/session.test.ts`

The spec's rules (in `session.ts` here, in the prototype in Task 6):
1. A `tool_result`'s images go with that tool call's item, error or not; a result whose item has left
   the feed adds nothing.
2. A typed prompt's images go with the last prompt item its entry added; an entry with images and no
   text block is "[image]" with them; text that added no prompt (a slash command) drops them.
3. An image beside a `tool_result` in one entry (an AskUserQuestion answer) goes with that tool call's
   item and makes no "[image]" prompt. With several `tool_result`s, the last one's.
4. A prompt queued while Claude worked (`queued_command` with a list `prompt`) is like a typed one, its
   numbers in `attachment.imagePasteIds`.
5. Never read: `toolUseResult`, sidechain lines, entries the panel skips (other origins, `isMeta`, the
   compact summary).
6. At most 10 listed per item; more are counted in `moreImages`.

Each listed image remembers the line it came from (the place `ingest()` was given) in a `WeakMap`
keyed by its item, so the place goes when the item does and never reaches a snapshot.

- [ ] **Step 1: Write the failing tests**

In `src/main/claude/session.test.ts`, replace the imports:

```ts
import { join, resolve, sep } from 'node:path'
import { afterAll, beforeAll, describe, expect, it } from 'vitest'
import type { ClaudeFeedItem } from '@shared/types'
import { SessionState } from './session'
import { type LogWriter, makeClaudeHome, readEntries, removeClaudeHomes, sessionLog } from './test-log'
```

with:

```ts
import { readFileSync } from 'node:fs'
import { join, resolve, sep } from 'node:path'
import { afterAll, beforeAll, describe, expect, it } from 'vitest'
import type { ClaudeFeedItem, ClaudeImage } from '@shared/types'
import { imageId } from './images'
import { SessionState } from './session'
import { imageBlock, jpegBytes, type LogWriter, makeClaudeHome, pngBytes, readEntries, readLines, removeClaudeHomes, sessionLog } from './test-log'
```

Append to the file:

```ts
/** Parses the log with each line's place, as the app's tail gives them. */
function parsePlaced(log: LogWriter, maxFeed?: number): SessionState {
  const s = new SessionState(FOLDER, FOLDER, maxFeed)
  for (const line of readLines(log.path)) s.ingest(line.entry, { offset: line.offset, length: line.length })
  return s
}
const id = (bytes: Uint8Array) => imageId(Buffer.from(bytes).toString('base64'))
const ref = (bytes: Uint8Array, width: number, height: number, paste?: number): ClaudeImage =>
  ({ id: id(bytes), format: 'png', width, height, bytes: bytes.length, ...(paste ? { paste } : {}) })
const imagesOn = (item: ClaudeFeedItem | undefined) => (item && 'images' in item ? item.images : undefined)

describe('SessionState: images', () => {
  const a = pngBytes(64, 48)
  const b = pngBytes(32, 32)

  it('a prompt with text and two pasted images: the images, numbered by imagePasteIds, in paste order', () => {
    const s = parsePlaced(newLog().prompt('what are these?', { images: [a, b], pasteIds: [3, 4] }))
    expect(s.feed).toEqual([{ kind: 'prompt', text: 'what are these?', images: [ref(a, 64, 48, 3), ref(b, 32, 32, 4)] }])
  })

  it('an image-only prompt is "[image]" with its images; without imagePasteIds they have no number', () => {
    const s = parsePlaced(newLog().prompt('', { images: [a] }))
    expect(s.feed).toEqual([{ kind: 'prompt', text: '[image]', images: [ref(a, 64, 48)] }])
    expect(s.firstPrompt).toBe('')
  })

  it('a prompt typed while Claude worked: its images and the numbers in its attachment', () => {
    const s = parsePlaced(newLog().prompt('go').queuedBlocks([{ type: 'text', text: 'and this' }, imageBlock(a)], { pasteIds: [2] })
      .queuedBlocks([imageBlock(b)]))
    expect(s.feed.slice(1)).toEqual([
      { kind: 'prompt', text: 'and this', images: [ref(a, 64, 48, 2)] },
      { kind: 'prompt', text: '[image]', images: [ref(b, 32, 32)] },
    ])
  })

  it("a Read result, an MCP result with text and an image, and an error result with an image go on their tool's item", () => {
    const jpeg = jpegBytes(923, 2000)
    const s = parsePlaced(newLog().prompt('go')
      .readImage('t1', join(FOLDER, 'docs', 'shot.png'), a)
      .toolUse('t2', 'mcp__claude-in-chrome__computer', { action: 'screenshot' })
      .toolResult('t2', { content: [{ type: 'text', text: 'Took a screenshot' }, imageBlock(jpeg, 'image/jpeg')] })
      .toolUse('t3', 'mcp__browser__shot', { url: 'https://example.com' })
      .toolResult('t3', { isError: true, content: [{ type: 'text', text: 'Page crashed' }, imageBlock(b)] }))
    expect(s.feed.slice(1)).toEqual([
      { kind: 'tool', id: 't1', name: 'Read', summary: join('docs', 'shot.png'), state: 'done', images: [ref(a, 64, 48)] },
      {
        kind: 'tool', id: 't2', name: 'claude-in-chrome:computer', summary: '', state: 'done',
        images: [{ id: id(jpeg), format: 'jpeg', width: 923, height: 2000, bytes: jpeg.length }],
      },
      { kind: 'tool', id: 't3', name: 'browser:shot', summary: 'https://example.com', state: 'error', error: 'Page crashed', images: [ref(b, 32, 32)] },
    ])
  })

  it("Read's toolUseResult, which repeats the image, isn't read", () => {
    const s = parsePlaced(newLog().toolUse('t1', 'Read', { file_path: join(FOLDER, 'a.png') })
      .toolResult('t1', { content: [imageBlock(a)], toolUseResult: { type: 'image', file: { base64: Buffer.from(b).toString('base64') } } }))
    expect(imagesOn(s.feed[0])).toEqual([ref(a, 64, 48)])
  })

  it("an image pasted into an answer (AskUserQuestion) goes on the question's item, with no [image] prompt", () => {
    const s = parsePlaced(newLog().prompt('go')
      .toolUse('t1', 'AskUserQuestion', { questions: [{ question: 'Which layout?' }] })
      .userBlocks([{ type: 'tool_result', tool_use_id: 't1', content: 'User answered: like this' }, imageBlock(a)], { imagePasteIds: [1] }))
    expect(s.feed).toEqual([
      { kind: 'prompt', text: 'go' },
      { kind: 'tool', id: 't1', name: 'AskUserQuestion', summary: 'Which layout?', state: 'done', images: [ref(a, 64, 48, 1)] },
    ])
  })

  it('a result for an item that has left the feed adds nothing', () => {
    const log = newLog().toolUse('t1', 'Read', { file_path: join(FOLDER, 'a.png') })
    for (let i = 0; i < 4; i++) log.reply(`r${i}`, { stopReason: 'tool_use' })
    log.toolResult('t1', { content: [imageBlock(a)] })
    const s = parsePlaced(log, 2)
    expect(s.feed.some((item) => 'images' in item)).toBe(false)
    expect(s.imagePlace(id(a))).toBeNull()
  })

  it('12 images in one item: 10 listed, 2 more counted', () => {
    const many = Array.from({ length: 12 }, (_, i) => pngBytes(10 + i, 10))
    const [item] = parsePlaced(newLog().prompt('all of them', { images: many })).feed
    expect(item).toMatchObject({ kind: 'prompt', moreImages: 2 })
    expect(imagesOn(item)?.map((im) => im.width)).toEqual([10, 11, 12, 13, 14, 15, 16, 17, 18, 19])
  })

  it("images from other origins, meta entries, the compact summary and sub-agents' lines aren't listed", () => {
    const s = parsePlaced(newLog()
      .prompt('from a peer', { origin: 'peer', images: [a] })
      .prompt('skill text', { isMeta: true, images: [a] })
      .userBlocks([{ type: 'text', text: 'summary' }, imageBlock(a)], { isCompactSummary: true })
      .raw({ type: 'user', isSidechain: true, sessionId: 's', message: { role: 'user', content: [imageBlock(a)] } })
      .prompt('mine', { images: [b] }))
    expect(s.feed).toEqual([{ kind: 'prompt', text: 'mine', images: [ref(b, 32, 32)] }])
  })

  it('a slash command with an image drops it; skipped sources still make "[image]"', () => {
    const s = parsePlaced(newLog()
      .userBlocks([imageBlock(a), { type: 'text', text: '<command-name>/clear</command-name>' }])
      .userBlocks([{ type: 'image', source: { type: 'url', url: 'https://example.com/a.png' } }]))
    expect(s.feed).toEqual([{ kind: 'notice', text: '/clear', tone: 'info' }, { kind: 'prompt', text: '[image]' }])
  })

  it('the same image twice gets one id', () => {
    const s = parsePlaced(newLog().prompt('one', { images: [a] }).prompt('again', { images: [pngBytes(64, 48)] }))
    expect(imagesOn(s.feed[0])?.[0].id).toBe(imagesOn(s.feed[1])?.[0].id)
  })

  it("imagePlace: the line holding an image, found by id; null for an id no item lists, or a place that wasn't given", () => {
    const log = newLog().prompt('first', { images: [a] }).readImage('t1', join(FOLDER, 'b.png'), b)
    const s = parsePlaced(log)
    const bytes = readFileSync(log.path)
    for (const image of [a, b]) {
      const place = s.imagePlace(id(image))
      expect(place).not.toBeNull()
      const line = bytes.toString('utf8', place!.offset, place!.offset + place!.length)
      expect(line).toContain(Buffer.from(image).toString('base64'))
    }
    expect(s.imagePlace('0123456789abcdef')).toBeNull()
    expect(parse(log).imagePlace(id(a))).toBeNull() // ingested without places
  })

  it('a place goes with its item when the item leaves the feed', () => {
    const log = newLog().prompt('old', { images: [a] })
    const s = new SessionState(FOLDER, FOLDER, 2)
    const lines = () => readLines(log.path)
    for (const line of lines()) s.ingest(line.entry, line)
    expect(s.imagePlace(id(a))).not.toBeNull()
    log.reply('x', { stopReason: 'tool_use' }).reply('y', { stopReason: 'tool_use' })
    for (const line of lines().slice(1)) s.ingest(line.entry, line)
    expect(s.imagePlace(id(a))).toBeNull()
  })
})
```

- [ ] **Step 2: Run them to make sure they fail**

Run: `npx vitest run src/main/claude/session.test.ts`
Expected: FAIL: the new tests find no `images` on the items, and `s.imagePlace is not a function`; the
existing tests still pass.

- [ ] **Step 3: The rules**

In `src/main/claude/session.ts`:

Replace the first lines:

```ts
import type { ClaudeFeedItem, ClaudeTodo } from '@shared/types'
import { AGENT_TOOLS, asText, describeTool, firstLine, head, isRecord, own, tag, toolLabel } from './describe'

/** Feed items kept (oldest dropped), as the prototype's MAX_EVENTS. */
export const MAX_FEED = 600
```

with:

```ts
import type { ClaudeFeedItem, ClaudeImage, ClaudeTodo } from '@shared/types'
import { AGENT_TOOLS, asText, describeTool, firstLine, head, isRecord, own, tag, toolLabel } from './describe'
import { imagesOf } from './images'
import type { LinePlace } from './tail'

/** Feed items kept (oldest dropped), as the prototype's MAX_EVENTS. */
export const MAX_FEED = 600
/** Images listed per item; more are only counted (3 was the most seen in one item). */
export const MAX_IMAGES = 10
```

After `type ToolItem = Extract<ClaudeFeedItem, { kind: 'tool' }>`, add:

```ts
type PromptItem = Extract<ClaudeFeedItem, { kind: 'prompt' }>
```

After the `tools` field (`private readonly tools = new Map<string, ToolItem>()`), add:

```ts
  /** Where each listed image's line is in the log, by item and image id: its pixels are read from
   *  there again. Gone with the item; never part of a snapshot. */
  private readonly places = new WeakMap<ClaudeFeedItem, Map<string, LinePlace>>()
  /** The line of the entry being ingested, while it is. */
  private place: LinePlace | null = null
```

Replace the constructor and the `feed` getter's doc comment:

```ts
  /** `realProject`: the project's real path, which tool paths in the log start with (describeTool). */
  constructor(readonly project: string, readonly realProject = project) {}

  /** Oldest first, at most MAX_FEED items. */
```

with:

```ts
  /** `realProject`: the project's real path, which tool paths in the log start with (describeTool).
   *  `maxFeed`: items kept (MAX_FEED; the replay check over all logs keeps them all). */
  constructor(readonly project: string, readonly realProject = project, private readonly maxFeed = MAX_FEED) {}

  /** Oldest first, at most `maxFeed` items. */
```

Replace `ingest()`:

```ts
  ingest(entry: unknown): void {
    if (!isRecord(entry)) return
    this.version++
    try {
      this.apply(entry)
    } catch {
      // A shape this parser doesn't know; the prototype skips such a line too.
    }
  }
```

with:

```ts
  /** `place`: where the entry's line is in the log, so the images it adds can be read again. */
  ingest(entry: unknown, place?: LinePlace): void {
    if (!isRecord(entry)) return
    this.version++
    this.place = place ?? null
    try {
      this.apply(entry)
    } catch {
      // A shape this parser doesn't know; the prototype skips such a line too.
    } finally {
      this.place = null
    }
  }

  /** Where the line holding image `id` is, for an item still in the feed that lists it; null when
   *  no item does (it left the feed) or its line's place wasn't given. */
  imagePlace(id: string): LinePlace | null {
    const feed = this.feed
    for (let i = feed.length - 1; i >= 0; i--) {
      const place = this.places.get(feed[i])?.get(id)
      if (place) return place
    }
    return null
  }
```

In `add()` and `trim()`, use the instance's limit: replace

```ts
    if (this.items.length >= 2 * MAX_FEED) this.trim()
```

with

```ts
    if (this.items.length >= 2 * this.maxFeed) this.trim()
```

and replace

```ts
    if (this.items.length <= MAX_FEED) return
    for (const item of this.items.splice(0, this.items.length - MAX_FEED)) {
```

with

```ts
    if (this.items.length <= this.maxFeed) return
    for (const item of this.items.splice(0, this.items.length - this.maxFeed)) {
```

In `attachment()`, replace the list branch:

```ts
      } else if (Array.isArray(a.prompt)) {
        // A prompt with a pasted image comes as content blocks.
        const blocks = a.prompt.filter(isRecord)
        const text = blocks.filter((b) => b.type === 'text').map((b) => str(b.text)).join('\n')
        this.prompt(cleanPrompt(text) || (blocks.some((b) => b.type === 'image') ? '[image]' : ''))
      }
```

with:

```ts
      } else if (Array.isArray(a.prompt)) {
        // A prompt with a pasted image comes as content blocks; its numbers are the attachment's.
        const blocks = a.prompt.filter(isRecord)
        const text = blocks.filter((b) => b.type === 'text').map((b) => str(b.text)).join('\n')
        const hasImage = blocks.some((b) => b.type === 'image')
        const item = this.prompt(cleanPrompt(text) || (hasImage ? '[image]' : ''))
        if (item && hasImage) this.attach(item, imagesOf(blocks, a.imagePasteIds))
      }
```

In `user()`, replace:

```ts
    const texts: string[] = []
    let images = 0
    for (const b of blocks) {
      if (!isRecord(b)) continue
      if (b.type === 'tool_result') {
        this.result(b, e.toolUseResult)
      } else if (b.type === 'text') {
```

with:

```ts
    const texts: string[] = []
    let images = 0
    /** The last tool_result's tool_use id: an image beside it was pasted into that answer. */
    let answered: string | null = null
    for (const b of blocks) {
      if (!isRecord(b)) continue
      if (b.type === 'tool_result') {
        this.result(b, e.toolUseResult)
        answered = str(b.tool_use_id)
      } else if (b.type === 'text') {
```

Then replace the end of `user()`, all of `userText()` and all of `prompt()`:

```ts
    const legacy = e.origin === undefined || e.origin === null
    for (const text of texts) this.userText(text, legacy)
    if (images && !texts.length) this.prompt('[image]')
  }

  private userText(raw: string, legacy: boolean): void {
    const text = raw.trim()
    if (!text || NOT_PROMPTS.some((p) => text.startsWith(p))) return
    if (text.startsWith('<command-name>')) {
      this.notice(tag(text, 'command-name') || head(text, 60), 'info')
    } else if (text.startsWith('<bash-input>')) {
      this.add({ kind: 'prompt', text: clip(`! ${tag(text, 'bash-input')}`) }) // runs in the shell, no turn
    } else if (text.startsWith('[Request interrupted')) {
      this.notice('interrupted', 'error')
      this.endTurn(true)
    } else if (legacy && text.startsWith('<') && text.slice(0, 40).includes('>') && !text.startsWith('<pasted')) {
      // Older logs: hook output and reminders arrived as user text.
    } else {
      this.prompt(cleanPrompt(text))
    }
  }

  private prompt(text: string): void {
    if (!text) return
    this.add({ kind: 'prompt', text: clip(text) })
    if (!this.firstPrompt && text !== '[image]') this.firstPrompt = own(firstLine(text, 80))
    this.inTurn = true
    this.error = ''
  }
```

with:

```ts
    const legacy = e.origin === undefined || e.origin === null
    let last: PromptItem | null = null
    for (const text of texts) last = this.userText(text, legacy) ?? last
    if (!images) return
    if (answered !== null) {
      // Pasted into an answer (AskUserQuestion): the images go with that tool call, not a prompt.
      const tool = this.tools.get(answered)
      if (tool) this.attach(tool, imagesOf(blocks, e.imagePasteIds))
      return
    }
    // With the last prompt the entry added; an entry with no text is "[image]". Text that added no
    // prompt (a slash command) drops them.
    if (!texts.length) last = this.prompt('[image]')
    if (last) this.attach(last, imagesOf(blocks, e.imagePasteIds))
  }

  /** The prompt item the text added, if it added one. */
  private userText(raw: string, legacy: boolean): PromptItem | null {
    const text = raw.trim()
    if (!text || NOT_PROMPTS.some((p) => text.startsWith(p))) return null
    if (text.startsWith('<command-name>')) {
      this.notice(tag(text, 'command-name') || head(text, 60), 'info')
    } else if (text.startsWith('<bash-input>')) {
      const item: PromptItem = { kind: 'prompt', text: clip(`! ${tag(text, 'bash-input')}`) } // runs in the shell, no turn
      this.add(item)
      return item
    } else if (text.startsWith('[Request interrupted')) {
      this.notice('interrupted', 'error')
      this.endTurn(true)
    } else if (legacy && text.startsWith('<') && text.slice(0, 40).includes('>') && !text.startsWith('<pasted')) {
      // Older logs: hook output and reminders arrived as user text.
    } else {
      return this.prompt(cleanPrompt(text))
    }
    return null
  }

  /** The prompt item added; null for no text. */
  private prompt(text: string): PromptItem | null {
    if (!text) return null
    const item: PromptItem = { kind: 'prompt', text: clip(text) }
    this.add(item)
    if (!this.firstPrompt && text !== '[image]') this.firstPrompt = own(firstLine(text, 80))
    this.inTurn = true
    this.error = ''
    return item
  }

  /** Lists `images` on `item`: at most MAX_IMAGES, the rest counted. Each one listed remembers the
   *  line being ingested, where its pixels are read from again. */
  private attach(item: PromptItem | ToolItem, images: ClaudeImage[]): void {
    if (!images.length) return
    const listed = item.images ?? []
    let more = item.moreImages ?? 0
    let places = this.places.get(item)
    for (const image of images) {
      if (listed.length >= MAX_IMAGES) {
        more++
        continue
      }
      listed.push(image)
      if (this.place) {
        if (!places) this.places.set(item, (places = new Map()))
        places.set(image.id, this.place)
      }
    }
    item.images = listed
    if (more) item.moreImages = more
  }
```

At the end of `result()`, replace:

```ts
    } else if (item) {
      item.state = 'done'
      delete item.error // 'interrupted' by a turn end that came before this result
    }
  }
```

with:

```ts
    } else if (item) {
      item.state = 'done'
      delete item.error // 'interrupted' by a turn end that came before this result
    }
    // What the result held: an image file Claude read, a screenshot, an MCP tool's images. A result
    // whose item has left the feed adds nothing.
    if (item && Array.isArray(b.content)) this.attach(item, imagesOf(b.content))
  }
```

- [ ] **Step 4: Run them**

Run: `npx vitest run src/main/claude/`
Expected: PASS: the new tests, and every existing one (images with empty data still make "[image]"
and list nothing).

- [ ] **Step 5: Commit**

```bash
git add src/main/claude/session.ts src/main/claude/session.test.ts
git -c user.email=franco@effektstudios.com commit -m "Claude panel: images on prompts and tool calls" -m "Claude-Session: https://claude.ai/code/session_012TidnBvRYbxhSYqPzFZuph"
```

---

### Task 6: The prototype counts images the same way

**Files:**
- Modify: `claude_activity_pane.py`

The Python parser stays the reference: it gets rules 1–5 and counts what it can't show. An event
becomes a list `[kind, text, images]`; `self.tool_events` finds a result's tool event; the TUI prints a
dim `▣ N images` under such an event. An image counts when its source is base64 with non-empty data
(Deck also checks the format; every image measured passed both).

- [ ] **Step 1: Helpers**

After `first_line()` (near the top), add:

```python
def text_of(x):
    """A log value that should be text: itself, else "" (the TypeScript parser's str())."""
    return x if isinstance(x, str) else ""


def clean_prompt(text):
    """<pasted_content …> wrappers removed (the paste itself stays)."""
    return re.sub(r"</?pasted_content[^>]*>", "", text).strip()


def count_images(blocks):
    """Images among content blocks that Deck's panel shows: base64 sources with data. (Deck also
    checks that the bytes are PNG, JPEG, GIF or WebP and at most 16 MiB of text; every image in
    the logs measured was.)"""
    n = 0
    for b in blocks:
        src = b.get("source") if isinstance(b, dict) and b.get("type") == "image" else None
        if isinstance(src, dict) and src.get("type") == "base64" and text_of(src.get("data")):
            n += 1
    return n
```

- [ ] **Step 2: Events with images, and tool events by id**

In `Session.__init__`, replace:

```python
        self.events = []          # (kind, text) — kind: user/think/text/tool/err/sys
        self.pending = {}         # tool_use_id -> (name, summary), until its result arrives
```

with:

```python
        self.events = []          # [kind, text, images] — kind: user/think/text/tool/err/sys
        self.tool_events = {}     # tool_use_id -> its "tool" event, while it's in self.events
        self.pending = {}         # tool_use_id -> (name, summary), until its result arrives
```

At the end of `poll()` and in `add()`, replace:

```python
        del self.events[:-MAX_EVENTS]
        return True

    def add(self, kind, text):
        self.events.append((kind, text))
```

with:

```python
        self.trim()
        return True

    def trim(self):
        """Keeps the newest MAX_EVENTS events; a result for a tool that left adds nothing."""
        cut = len(self.events) - MAX_EVENTS
        if cut <= 0:
            return
        gone = {id(ev) for ev in self.events[:cut]}
        del self.events[:cut]
        self.tool_events = {k: ev for k, ev in self.tool_events.items() if id(ev) not in gone}

    def add(self, kind, text):
        ev = [kind, text, 0]  # the 0 counts the images that came with it
        self.events.append(ev)
        return ev
```

- [ ] **Step 3: Queued prompts with images**

In `ingest()`, replace the attachment branch:

```python
        elif t == "attachment":
            # Input that arrived while Claude was busy and was taken in mid-turn:
            # prompts you typed, or notifications that a background task ended.
            a = e.get("attachment") or {}
            if a.get("type") == "queued_command" and isinstance(a.get("prompt"), str):
                if a.get("commandMode") == "task-notification":
                    self.notification(a["prompt"])
                elif (a.get("origin") or {}).get("kind", "human") == "human":
                    self.prompt(a["prompt"])
        elif t == "user":
```

with:

```python
        elif t == "attachment":
            self.attachment(e)
        elif t == "user":
```

and add this method before `def system(self, e):`:

```python
    def attachment(self, e):
        """Input that arrived while Claude was busy and was taken in mid-turn: prompts you
        typed, or notifications that a background task ended."""
        a = e.get("attachment") or {}
        p = a.get("prompt")
        if a.get("type") != "queued_command":
            return
        if a.get("commandMode") == "task-notification":
            if isinstance(p, str):
                self.notification(p)
        elif (a.get("origin") or {}).get("kind", "human") == "human":
            if isinstance(p, str):
                self.prompt(clean_prompt(p))
            elif isinstance(p, list):
                # A prompt with a pasted image comes as content blocks.
                blocks = [b for b in p if isinstance(b, dict)]
                text = "\n".join(text_of(b.get("text")) for b in blocks if b.get("type") == "text")
                has_image = any(b.get("type") == "image" for b in blocks)
                ev = self.prompt(clean_prompt(text) or ("[image]" if has_image else ""))
                if ev and has_image:
                    ev[2] += count_images(blocks)
```

- [ ] **Step 4: Prompts, answers and results**

In `user()`, replace:

```python
        texts, images = [], 0
        for b in blocks:
            if not isinstance(b, dict):
                continue
            if b.get("type") == "tool_result":
                self.result(b, e.get("toolUseResult"))
            elif b.get("type") == "text":
```

with:

```python
        texts, images = [], 0
        answered = None  # the last tool_result's id: an image beside it was pasted into that answer
        for b in blocks:
            if not isinstance(b, dict):
                continue
            if b.get("type") == "tool_result":
                self.result(b, e.get("toolUseResult"))
                answered = text_of(b.get("tool_use_id"))
            elif b.get("type") == "text":
```

Replace the end of `user()`, all of `user_text()` and all of `prompt()`:

```python
        for text in texts:
            self.user_text(text, legacy=e.get("origin") is None)
        if images and not texts:
            self.prompt("[image]")

    def user_text(self, text, legacy):
        text = text.strip()
        if not text or text.startswith(NOT_PROMPTS):
            return
        if text.startswith("<command-name>"):
            self.add("sys", tag(text, "command-name") or text[:60])
        elif text.startswith("<bash-input>"):
            self.add("user", "! " + tag(text, "bash-input"))
        elif text.startswith("[Request interrupted"):
            self.add("err", "✗ interrupted")
            self.end_turn()
        elif legacy and text.startswith("<") and ">" in text[:40] and not text.startswith("<pasted"):
            return  # older logs: hook output and reminders arrived as user text
        else:
            self.prompt(re.sub(r"</?pasted_content[^>]*>", "", text).strip())

    def prompt(self, text):
        if text:
            self.add("user", text)
            self.in_turn, self.error = True, ""
```

with:

```python
        last = None
        for text in texts:
            last = self.user_text(text, legacy=e.get("origin") is None) or last
        if not images:
            return
        if answered is not None:
            # Pasted into an answer (AskUserQuestion): the images go with that tool call.
            target = self.tool_events.get(answered)
        else:
            # With the last prompt the entry added; no text: an "[image]" prompt.
            target = last if texts else self.prompt("[image]")
        if target:
            target[2] += count_images(blocks)

    def user_text(self, text, legacy):
        """Returns the prompt event the text added, if it added one."""
        text = text.strip()
        if not text or text.startswith(NOT_PROMPTS):
            return None
        if text.startswith("<command-name>"):
            self.add("sys", tag(text, "command-name") or text[:60])
        elif text.startswith("<bash-input>"):
            return self.add("user", "! " + tag(text, "bash-input"))
        elif text.startswith("[Request interrupted"):
            self.add("err", "✗ interrupted")
            self.end_turn()
        elif legacy and text.startswith("<") and ">" in text[:40] and not text.startswith("<pasted"):
            return None  # older logs: hook output and reminders arrived as user text
        else:
            return self.prompt(clean_prompt(text))
        return None

    def prompt(self, text):
        if text:
            ev = self.add("user", text)
            self.in_turn, self.error = True, ""
            return ev
        return None
```

At the end of `result()`, after the `if b.get("is_error"):` block (whose last line is
`self.add("err", f"✗ {name}: {first_line(str(txt), 300)}")`), add:

```python
        # What the result held (an image file Claude read, a screenshot, an MCP tool's images)
        # goes with its tool call, error or not.
        ev = self.tool_events.get(text_of(tid))
        if ev and isinstance(b.get("content"), list):
            ev[2] += count_images(b["content"])
```

In `assistant()`, replace:

```python
                self.pending[b.get("id")] = (name, summ)
                self.add("tool", (name, summ))
```

with:

```python
                self.pending[b.get("id")] = (name, summ)
                self.tool_events[text_of(b.get("id"))] = self.add("tool", (name, summ))
```

- [ ] **Step 5: The TUI's lines**

Replace the start of `feed_lines()`:

```python
def feed_lines(sess, width, show_thinking):
    out = []
    for kind, val in sess.events:
        if kind == "user":
            out.append("")
            out += [bold(cyan(l)) for l in wrap(val, width, "› ")[:6]]
```

with:

```python
def images_line(n):
    return dim(f"  ▣ {n} image{'s' * (n != 1)}")


def feed_lines(sess, width, show_thinking):
    out = []
    for kind, val, images in sess.events:
        if kind == "user":
            out.append("")
            out += [bold(cyan(l)) for l in wrap(val, width, "› ")[:6]]
            if images:
                out.append(images_line(images))
```

and in its `tool` branch, replace:

```python
            label = name[5:].replace("__", ":", 1) if name.startswith("mcp__") else name
            out.append(f"  {color('⏺ ' + label)} {dim(summ)}")
```

with:

```python
            label = name[5:].replace("__", ":", 1) if name.startswith("mcp__") else name
            out.append(f"  {color('⏺ ' + label)} {dim(summ)}")
            if images:
                out.append(images_line(images))
```

- [ ] **Step 6: Compile, and run it once on a hand-made log**

Run:

```bash
python3 -m py_compile claude_activity_pane.py && echo compiled
T=$(mktemp -d) && mkdir -p "$T/app" "$T/home/projects" && python3 - "$T" <<'EOF'
import json, os, re, sys
t = sys.argv[1]
app = os.path.realpath(os.path.join(t, "app"))
logs = os.path.join(t, "home", "projects", re.sub(r"[^A-Za-z0-9]", "-", app))
os.makedirs(logs)
png = "iVBORw0KGgoAAAANSUhEUgAAAAEAAAABCAYAAAAfFcSJAAAADUlEQVR42mNkYPhfDwAChwGA60e6kgAAAABJRU5ErkJggg=="
img = {"type": "image", "source": {"type": "base64", "media_type": "image/png", "data": png}}
lines = [
    {"type": "user", "origin": {"kind": "human"}, "imagePasteIds": [1, 2],
     "message": {"role": "user", "content": [img, img, {"type": "text", "text": "look at these"}]}},
    {"type": "assistant", "message": {"model": "claude-opus-5-5", "content": [
        {"type": "tool_use", "id": "t1", "name": "Read", "input": {"file_path": os.path.join(app, "shot.png")}}]}},
    {"type": "user", "message": {"role": "user", "content": [{"type": "tool_result", "tool_use_id": "t1", "content": [img]}]},
     "toolUseResult": {"type": "image", "file": {"base64": png}}},
    {"type": "assistant", "message": {"content": [
        {"type": "tool_use", "id": "t2", "name": "AskUserQuestion", "input": {"questions": [{"question": "Which one?"}]}}]}},
    {"type": "user", "imagePasteIds": [3],
     "message": {"role": "user", "content": [{"type": "tool_result", "tool_use_id": "t2", "content": "this one"}, img]}},
    {"type": "user", "origin": {"kind": "human"}, "message": {"role": "user", "content": [img]}},
]
with open(os.path.join(logs, "s1.jsonl"), "w") as fh:
    for line in lines:
        fh.write(json.dumps(line) + "\n")
EOF
CLAUDE_CONFIG_DIR="$T/home" python3 claude_activity_pane.py "$T/app" --once --width 70 --height 40 | sed 's/\x1b\[[0-9;]*m//g'
rm -rf "$T"
```

Expected (escape codes stripped), after the header:

```
› look at these
  ▣ 2 images
  ⏺ Read shot.png
  ▣ 1 image
  ⏺ AskUserQuestion Which one?
  ▣ 1 image

› [image]
  ▣ 1 image
```

No "[image]" prompt after the AskUserQuestion line: the answer's image went with the question.

- [ ] **Step 7: Commit**

```bash
git add claude_activity_pane.py
git -c user.email=franco@effektstudios.com commit -m "Prototype: count Claude's images like the panel" -m "Claude-Session: https://claude.ai/code/session_012TidnBvRYbxhSYqPzFZuph"
```

---

### Task 7: Replay every local log through both parsers

**Files:**
- Create (outside the repo, never committed): `$TMPDIR/deck-images-replay/replay.ts`,
  `$TMPDIR/deck-images-replay/replay.py`

A throwaway check, as the spec asks: both parsers over every local log (sessions and sub-agents),
comparing per log the images on prompts, the images on tool calls, and the "[image]" prompts. Both
keep every item (`maxFeed` Infinity; `MAX_EVENTS` patched), so the windows can't differ. It reads
Franco's logs, read-only, and prints counts only: never a path, a prompt or an image. It runs TypeScript
through `node_modules/.bin/jiti` (2.7.0, installed with vite and electron-builder).

- [ ] **Step 1: The Python side**

```bash
R="$TMPDIR/deck-images-replay" && mkdir -p "$R"
cat > "$R/replay.py" <<'EOF'
# The prototype's side of the replay: each log's three counts, as JSON on stdout. Never prints content.
import json
import sys

sys.path.insert(0, sys.argv[1])
import claude_activity_pane as cap  # noqa: E402

cap.MAX_EVENTS = 10 ** 9  # keep every event, as the TypeScript side keeps every item
out = {}
for path in json.load(open(sys.argv[2], encoding="utf-8")):
    s = cap.Session(path, "/")
    s.poll()
    prompt_images = sum(n for kind, _, n in s.events if kind == "user")
    tool_images = sum(n for kind, _, n in s.events if kind == "tool")
    image_prompts = sum(1 for kind, text, _ in s.events if kind == "user" and text == "[image]")
    out[path] = [prompt_images, tool_images, image_prompts]
json.dump(out, sys.stdout)
EOF
```

- [ ] **Step 2: The TypeScript side, which compares**

```bash
cat > "$TMPDIR/deck-images-replay/replay.ts" <<'EOF'
// Replays every local Claude Code log (sessions and sub-agents) through both parsers and compares,
// per log, the images on prompts, the images on tool calls and the "[image]" prompts. Prints counts
// only: never a path, a prompt or an image. Throwaway: never committed.
// Run from the worktree: node_modules/.bin/jiti "$TMPDIR/deck-images-replay/replay.ts" "$PWD"
import { execFileSync } from 'node:child_process'
import { readdirSync, readFileSync, writeFileSync } from 'node:fs'
import { homedir } from 'node:os'
import { dirname, join } from 'node:path'
import { fileURLToPath } from 'node:url'

const worktree = process.argv[2]
const here = dirname(fileURLToPath(import.meta.url))
const { SessionState } = await import(join(worktree, 'src', 'main', 'claude', 'session.ts'))
const projects = join(process.env.CLAUDE_CONFIG_DIR || join(homedir(), '.claude'), 'projects')

const list = (dir: string) => {
  try {
    return readdirSync(dir)
  } catch {
    return []
  }
}
const logs: string[] = []
for (const project of list(projects)) {
  for (const name of list(join(projects, project))) {
    if (name.endsWith('.jsonl')) logs.push(join(projects, project, name))
    for (const agent of list(join(projects, project, name, 'subagents'))) {
      if (agent.endsWith('.jsonl')) logs.push(join(projects, project, name, 'subagents', agent))
    }
  }
}

type Counts = [promptImages: number, toolImages: number, imagePrompts: number]
const ts = new Map<string, Counts>()
for (const path of logs) {
  const s = new SessionState('/', '/', Number.POSITIVE_INFINITY) // every item kept, as the Python side
  for (const line of readFileSync(path, 'utf8').split('\n')) {
    if (!line.trim()) continue
    let entry: unknown
    try {
      entry = JSON.parse(line)
    } catch {
      continue
    }
    s.ingest(entry)
  }
  const counts: Counts = [0, 0, 0]
  for (const item of s.feed) {
    const n = ('images' in item ? item.images?.length ?? 0 : 0) + ('moreImages' in item ? item.moreImages ?? 0 : 0)
    if (item.kind === 'prompt') {
      counts[0] += n
      if (item.text === '[image]') counts[2]++
    } else if (item.kind === 'tool') counts[1] += n
  }
  ts.set(path, counts)
}

const listFile = join(here, 'logs.json')
writeFileSync(listFile, JSON.stringify(logs))
const py = JSON.parse(execFileSync('python3', [join(here, 'replay.py'), worktree, listFile], { maxBuffer: 1 << 28 }).toString()) as Record<string, Counts>

const total = (m: Iterable<Counts>) => [...m].reduce((a, c) => [a[0] + c[0], a[1] + c[1], a[2] + c[2]], [0, 0, 0])
let differ = 0
logs.forEach((path, i) => {
  const a = ts.get(path)!
  const b = py[path] ?? [-1, -1, -1]
  if (a.join() !== b.join()) {
    differ++
    console.log(`log #${i}: TypeScript ${a.join(' / ')}, Python ${b.join(' / ')}`)
  }
})
console.log(`${logs.length} logs. Images on prompts / on tool calls / "[image]" prompts:`)
console.log(`  TypeScript ${total(ts.values()).join(' / ')}`)
console.log(`  Python     ${total(Object.values(py)).join(' / ')}`)
console.log(differ ? `${differ} logs differ` : 'every log matches')
EOF
```

- [ ] **Step 3: Run it**

Run: `./node_modules/.bin/jiti "$TMPDIR/deck-images-replay/replay.ts" "$PWD"`
Expected: about ten seconds, then the number of logs, the two lines of totals and
`every log matches`. On 2026-11-11 that was `678 logs`, `TypeScript 48 / 942 / 1` and
`Python 48 / 942 / 1`; the numbers move as logs come and go. A log that differs is printed by its
index with its counts; the two parsers may only differ on images TypeScript skips (another format, or
over 16 MiB of text): if a differing log has none of those, the rules differ, so fix the parser at
fault (with a test built in `test-log.ts`) and run it again.

Keep the printed lines for the pull request's description. Then delete the folder (`logs.json` lists
the logs' paths):

```bash
rm -rf "$TMPDIR/deck-images-replay"
```

Nothing to commit.

---
### Task 8: Images in snapshots

**Files:**
- Modify: `src/main/claude/snapshot.ts`
- Test: `src/main/claude/snapshot.test.ts`

Snapshots carry each item's images (about 100 bytes of JSON each) and never their pixels or places:
they're pushed several times a second during a turn and compared as JSON.

- [ ] **Step 1: Write the failing tests**

In `src/main/claude/snapshot.test.ts`, replace the test-log import:

```ts
import { type LogWriter, makeClaudeHome, readEntries, removeClaudeHomes, sessionLog } from './test-log'
```

with:

```ts
import { type LogWriter, makeClaudeHome, pngBytes, readEntries, readLines, removeClaudeHomes, sessionLog } from './test-log'
```

Before `describe('sessionTitle', () => {`, add:

```ts
describe('buildSnapshot: images', () => {
  it('copies the images and their count beyond ten; where their lines are stays out', () => {
    const many = Array.from({ length: 11 }, (_, i) => pngBytes(20 + i, 10))
    const log = sessionLog(home, FOLDER).prompt('see', { images: many, pasteIds: many.map((_, i) => i + 1) })
      .readImage('t1', resolve(FOLDER, 'a.png'), pngBytes(8, 8))
    const s = new SessionState(FOLDER)
    for (const line of readLines(log.path)) s.ingest(line.entry, { offset: line.offset, length: line.length })
    const snap = buildSnapshot(summary(log), s, 0, new Map(), 'newest')
    expect(snap.feed[0]).toMatchObject({ kind: 'prompt', text: 'see', moreImages: 1 })
    expect(snap.feed[0]).toEqual(s.feed[0])
    expect(snap.feed[1]).toMatchObject({ kind: 'tool', id: 't1', images: [{ format: 'png', width: 8, height: 8 }] })
    const json = JSON.stringify(snap)
    expect(json).not.toContain('offset')
    expect(json).not.toContain(Buffer.from(pngBytes(8, 8)).toString('base64'))
  })

  it("shares nothing with the state: images a tool's result adds later don't change an earlier snapshot", () => {
    const log = sessionLog(home, FOLDER).toolUse('t1', 'Read', { file_path: resolve(FOLDER, 'a.png') })
    const s = parse(log)
    const before = buildSnapshot(summary(log), s, 0, new Map(), 'newest')
    s.ingest(readEntries(log.toolResult('t1', { content: [{ type: 'image', source: { type: 'base64', data: Buffer.from(pngBytes(8, 8)).toString('base64') } }] }).path).at(-1))
    expect(before.feed[0]).not.toHaveProperty('images')
    expect(buildSnapshot(summary(log), s, 0, new Map(), 'newest').feed[0]).toMatchObject({ images: [{ width: 8 }] })
    const again = buildSnapshot(summary(log), s, 0, new Map(), 'newest')
    if (again.feed[0].kind === 'tool') again.feed[0].images![0].width = 99
    expect(s.feed[0]).toMatchObject({ images: [{ width: 8 }] })
  })
})
```

- [ ] **Step 2: Run them to make sure they fail**

Run: `npx vitest run src/main/claude/snapshot.test.ts`
Expected: FAIL: the snapshot's items have no `images` or `moreImages`.

- [ ] **Step 3: The copy**

In `src/main/claude/snapshot.ts`, replace the types import:

```ts
import type { ClaudeFeedItem, ClaudeSessionSummary, ClaudeSnapshot } from '@shared/types'
```

with:

```ts
import type { ClaudeFeedItem, ClaudeImage, ClaudeSessionSummary, ClaudeSnapshot } from '@shared/types'
```

Replace the start of `feedItem()`:

```ts
/** A capped copy: the state updates its tool items in place, a snapshot must not change. */
function feedItem(i: ClaudeFeedItem): ClaudeFeedItem {
  switch (i.kind) {
    case 'prompt':
      return { kind: 'prompt', text: cut(i.text, CAP.prompt) }
```

with:

```ts
/** Copies of an item's images and their count beyond them: ids, sizes and numbers, never pixels (the
 *  renderer asks for those), and never where their lines are. */
function imageFields(i: { images?: ClaudeImage[]; moreImages?: number }): { images?: ClaudeImage[]; moreImages?: number } {
  return {
    ...(i.images?.length ? { images: i.images.map((image) => ({ ...image })) } : {}),
    ...(i.moreImages ? { moreImages: i.moreImages } : {}),
  }
}

/** A capped copy: the state updates its tool items in place, a snapshot must not change. */
function feedItem(i: ClaudeFeedItem): ClaudeFeedItem {
  switch (i.kind) {
    case 'prompt':
      return { kind: 'prompt', text: cut(i.text, CAP.prompt), ...imageFields(i) }
```

and in its `tool` case, replace:

```ts
        ...(i.error === undefined ? {} : { error: cut(i.error, CAP.error) }),
      }
```

with:

```ts
        ...(i.error === undefined ? {} : { error: cut(i.error, CAP.error) }),
        ...imageFields(i),
      }
```

- [ ] **Step 4: Run them**

Run: `npx vitest run src/main/claude/snapshot.test.ts`
Expected: PASS.

- [ ] **Step 5: Commit**

```bash
git add src/main/claude/snapshot.ts src/main/claude/snapshot.test.ts
git -c user.email=franco@effektstudios.com commit -m "Claude panel: images in snapshots" -m "Claude-Session: https://claude.ai/code/session_012TidnBvRYbxhSYqPzFZuph"
```

---

### Task 9: The temp folder keeps copies of Claude's images

**Files:**
- Modify: `src/main/clipboard/temp.ts`
- Modify: `src/main/clipboard/ipc.ts` (`ClipboardIpc.saveImage`)
- Test: `src/main/clipboard/temp.test.ts`

Open saves a copy beside the clipboard's pasted images, as `image-<hash>.<png|jpg|gif|webp>`, in the
same `<temp>/Deck clipboard/<instance>/` folder (0700; files 0600), cleared at start and quit.

- [ ] **Step 1: Write the failing tests**

In `src/main/clipboard/temp.test.ts`, before the test
`it.skipIf(process.platform === 'win32')('a new folder gets mode 0700 and a new file 0600', …`, add:

```ts
  it("an opened copy of Claude's image: image-<hash>.<ext>, kept apart from a pasted PNG of the same bytes", async () => {
    const dir = join(root, 'opened')
    const temp = new TempImages(dir)
    const jpg = await temp.save(new Uint8Array([0xff, 0xd8, 0xff]), 'jpg', 'image')
    expect(jpg).toMatch(/[\\/]image-[0-9a-f]{16}\.jpg$/)
    expect(await temp.save(new Uint8Array([0xff, 0xd8, 0xff]), 'jpg', 'image')).toBe(jpg)
    const png = await temp.save(new Uint8Array([0xff, 0xd8, 0xff]))
    expect(png).toMatch(/[\\/]clipboard-[0-9a-f]{16}\.png$/)
    expect(readdirSync(dir).sort()).toHaveLength(2)
  })

  it('refuses a name it would not clear', async () => {
    const temp = new TempImages(join(root, 'refuse'))
    await expect(temp.save(new Uint8Array([1]), 'exe' as never)).rejects.toThrow('Not an image Deck saves')
    await expect(temp.save(new Uint8Array([1]), 'png', '../x' as never)).rejects.toThrow('Not an image Deck saves')
    expect(existsSync(join(root, 'refuse'))).toBe(false)
  })

  it('clear() removes every kind save() writes, and their leftover .tmp files, and nothing else', async () => {
    const dir = join(root, 'kinds')
    const temp = new TempImages(dir)
    for (const ext of ['png', 'jpg', 'gif', 'webp'] as const) await temp.save(new Uint8Array([ext.length, 1]), ext, 'image')
    await temp.save(new Uint8Array([7]))
    writeFileSync(join(dir, 'image-0123456789abcdef.webp.00000000-0000-4000-8000-000000000000.tmp'), 'half')
    writeFileSync(join(dir, 'image-0123456789abcdef.exe'), 'not ours')
    writeFileSync(join(dir, 'photo-0123456789abcdef.png'), 'not ours')
    temp.clear()
    expect(readdirSync(dir).sort()).toEqual(['image-0123456789abcdef.exe', 'photo-0123456789abcdef.png'])
  })
```

and in that last (POSIX-only) test, after `expect(statSync(file).mode & 0o777).toBe(0o600)`, add:

```ts
    expect(statSync(await temp.save(new Uint8Array([4]), 'webp', 'image')).mode & 0o777).toBe(0o600)
```

- [ ] **Step 2: Run them to make sure they fail**

Run: `npx vitest run src/main/clipboard/temp.test.ts`
Expected: FAIL: the copy is named `clipboard-….png` whatever the arguments, nothing is refused, and
`clear()` leaves the `image-*` files.

- [ ] **Step 3: Names by kind and format**

Replace `src/main/clipboard/temp.ts` with:

```ts
import { createHash, randomUUID } from 'node:crypto'
import { readdirSync, rmdirSync, unlinkSync } from 'node:fs'
import { mkdir, rename, stat, unlink, writeFile } from 'node:fs/promises'
import { join } from 'node:path'

/** The kinds of file save() writes: pasted clipboard images and screenshots ('clipboard', PNG), and
 *  copies of Claude's images that the panel's viewer opens ('image'). */
export type TempImageExt = 'png' | 'jpg' | 'gif' | 'webp'
export type TempImagePrefix = 'clipboard' | 'image'
const EXTS: readonly string[] = ['png', 'jpg', 'gif', 'webp'] satisfies TempImageExt[]
const PREFIXES: readonly string[] = ['clipboard', 'image'] satisfies TempImagePrefix[]

/** What save() writes (and a write in progress). clear() removes only these. */
const OURS = /^(clipboard|image)-[0-9a-f]{16}\.(png|jpg|gif|webp)(\.[0-9a-f-]{36}\.tmp)?$/

/** Windows can hold a just-written file for a moment (Defender, the indexer): retry briefly. */
async function renameRetrying(from: string, to: string): Promise<void> {
  for (let attempt = 0; ; attempt++) {
    try {
      return await rename(from, to)
    } catch (err) {
      const code = (err as NodeJS.ErrnoException).code
      if (attempt >= 4 || (code !== 'EPERM' && code !== 'EBUSY' && code !== 'EACCES')) throw err
      await new Promise((r) => setTimeout(r, 50 * (attempt + 1)))
    }
  }
}

/** Clipboard images pasted into a terminal, as files Claude Code can read, and copies of Claude's
 *  images opened from the panel. They stay until Deck quits (Claude may read one only when the prompt
 *  is sent); the next start clears what a crash left. */
export class TempImages {
  constructor(readonly dir: string) {}

  /** The image's file, `<prefix>-<hash>.<ext>`, named by its content. An existing file is the same
   *  image and stays as it is; a new one is written under its own temp name (so two saves of the same
   *  new image can't collide on one) and renamed, so a reader never sees half a file. */
  async save(bytes: Uint8Array, ext: TempImageExt = 'png', prefix: TempImagePrefix = 'clipboard'): Promise<string> {
    // Checked here too: the name is built from them, and clear() only knows these.
    if (!EXTS.includes(ext) || !PREFIXES.includes(prefix)) throw new Error(`Not an image Deck saves: ${prefix} .${ext}`)
    const file = join(this.dir, `${prefix}-${createHash('sha1').update(bytes).digest('hex').slice(0, 16)}.${ext}`)
    if (await stat(file).then((s) => s.isFile() && s.size === bytes.length, () => false)) return file
    await mkdir(this.dir, { recursive: true, mode: 0o700 })
    const tmp = `${file}.${randomUUID()}.tmp`
    await writeFile(tmp, bytes, { mode: 0o600 })
    try {
      await renameRetrying(tmp, file)
    } catch (err) {
      await unlink(tmp).catch(() => {})
      throw err
    }
    return file
  }

  /** Removes the images save() wrote, then the folder if that empties it. Never throws: it runs at
   *  startup, before the window opens, and at quit; whatever stays, the next start tries again. */
  clear(): void {
    let names: string[]
    try {
      names = readdirSync(this.dir)
    } catch {
      return // no folder (or unreadable)
    }
    for (const name of names) {
      if (!OURS.test(name)) continue
      try {
        unlinkSync(join(this.dir, name))
      } catch {
        // held by another process (Windows) or not ours to delete
      }
    }
    try {
      rmdirSync(this.dir)
    } catch {
      // not empty, or held
    }
  }
}
```

In `src/main/clipboard/ipc.ts`, replace the import `import { TempImages } from './temp'` with:

```ts
import { type TempImageExt, TempImages, type TempImagePrefix } from './temp'
```

replace the interface member:

```ts
  /** Saves a PNG beside the pasted images (cleared at start and quit): the device panel's
   *  screenshots for Claude. Resolves with its path. */
  saveImage(png: Uint8Array): Promise<string>
```

with:

```ts
  /** Saves an image beside the pasted images (cleared at start and quit): the device panel's
   *  screenshots for Claude (a PNG), and the copies the Claude panel's viewer opens ('image').
   *  Resolves with its path. */
  saveImage(bytes: Uint8Array, ext?: TempImageExt, prefix?: TempImagePrefix): Promise<string>
```

and in the returned object replace `saveImage: (png) => temp.save(png),` with:

```ts
    saveImage: (bytes, ext, prefix) => temp.save(bytes, ext, prefix),
```

- [ ] **Step 4: Run them**

Run: `npx vitest run src/main/clipboard/ && npm run typecheck`
Expected: PASS (the device panel's `saveImage(png)` still saves `clipboard-<hash>.png`).

- [ ] **Step 5: Commit**

```bash
git add src/main/clipboard/temp.ts src/main/clipboard/temp.test.ts src/main/clipboard/ipc.ts
git -c user.email=franco@effektstudios.com commit -m "Clipboard temp folder: copies of Claude's images" -m "Claude-Session: https://claude.ai/code/session_012TidnBvRYbxhSYqPzFZuph"
```

---

### Task 10: Pixels, read again from the log

**Files:**
- Create: `src/main/claude/pixels.ts`
- Test: `src/main/claude/pixels.test.ts`

Main keeps no image data. When the renderer asks for an image, `ImagePixels` reads its line again (at
most 64 MiB), parses it, takes the block whose SHA-1 is the id (so a log rewritten meanwhile can't hand
back another image), decodes the base64 and answers:
- **thumbnail:** a PNG or JPEG within 480×360 is itself; a larger one is decoded with `nativeImage`,
  fitted into 480×360 and encoded as its source was (PNG as PNG, JPEG as JPEG at 85); a GIF or WebP
  (which `nativeImage` can't decode) is itself up to 1 MiB, else "No preview";
- **full image:** the bytes, re-encoded as base64 under the type sniffed from them;
- **Open's bytes**, with no size limit;
- **size guard:** more than 16,384 px a side or 40 MP by the header is "Too large to show", before
  anything is decoded; a header that gives no size is "Couldn't decode this image".

Requests run one at a time, full images and Open ahead of thumbnails, with `setImmediate` between two.
Every request answers; nothing throws out of the queue.

- [ ] **Step 1: Write the failing test**

Create `src/main/claude/pixels.test.ts`:

```ts
import { writeFileSync } from 'node:fs'
import { join } from 'node:path'
import { afterAll, beforeEach, describe, expect, it, vi } from 'vitest'
import { imageId } from './images'
import { GONE, type ImageSource, ImagePixels, MAX_LINE, NO_PREVIEW, THUMB, TOO_LARGE, UNDECODABLE } from './pixels'
import { gifBytes, imageBlock, jpegBytes, makeFolder, pngBytes, pngHeaderBytes, removeClaudeHomes, webpBytes } from './test-log'

/** A stand-in for Electron's nativeImage: it "decodes" an image to its header's size; its PNG and JPEG
 *  are text naming their size, so a test can read what was made. `fail` makes every decode empty. */
const native = vi.hoisted(() => ({ fail: false, decoded: 0 }))
vi.mock('electron', async () => {
  const { imageSize, sniffFormat } = await import('./images')
  interface Fake {
    isEmpty(): boolean
    getSize(): { width: number; height: number }
    resize(o: { width: number; height: number; quality?: string }): Fake
    toPNG(): Buffer
    toJPEG(quality: number): Buffer
  }
  const fake = (width: number, height: number): Fake => ({
    isEmpty: () => width === 0 || height === 0,
    getSize: () => ({ width, height }),
    resize: (o) => fake(o.width, o.height),
    toPNG: () => Buffer.from(`png ${width}x${height}`),
    toJPEG: (quality) => Buffer.from(`jpeg ${width}x${height} q${quality}`),
  })
  return {
    nativeImage: {
      createFromBuffer: (bytes: Buffer) => {
        native.decoded++
        const format = sniffFormat(bytes)
        const size = format && !native.fail ? imageSize(format, bytes) : { width: 0, height: 0 }
        return fake(size.width, size.height)
      },
    },
  }
})

beforeEach(() => {
  native.fail = false
  native.decoded = 0
})
afterAll(removeClaudeHomes)

const b64 = (bytes: Uint8Array) => Buffer.from(bytes).toString('base64')
/** A one-line log holding `bytes` as a pasted image: the source pointing at that line, and its id. */
function logWith(bytes: Uint8Array, mediaType = 'image/png'): { source: ImageSource; id: string } {
  const path = join(makeFolder('deck-pixels-'), 'log.jsonl')
  const line = JSON.stringify({ type: 'user', message: { role: 'user', content: [imageBlock(bytes, mediaType), { type: 'text', text: 'see' }] } })
  writeFileSync(path, `${line}\n`)
  return { source: { path, offset: 0, length: Buffer.byteLength(line) }, id: imageId(b64(bytes)) }
}
/** What a data: URL holds: its type and its bytes as text. */
const decode = (data: { url?: string; error?: string }) => {
  const m = /^data:image\/([a-z]+);base64,(.*)$/.exec(data.url ?? '')
  return m ? { type: m[1], text: Buffer.from(m[2], 'base64').toString('latin1') } : data
}

describe('ImagePixels: thumbnails and full images', () => {
  it('a PNG or JPEG within 480×360 is its own thumbnail, and nothing is decoded', async () => {
    const pixels = new ImagePixels()
    for (const [bytes, type] of [[pngBytes(320, 200), 'png'], [jpegBytes(480, 360), 'jpeg']] as const) {
      const { source, id } = logWith(bytes)
      expect(await pixels.get(source, id, 'thumb')).toEqual({ url: `data:image/${type};base64,${b64(bytes)}` })
      expect(await pixels.get(source, id, 'full')).toEqual({ url: `data:image/${type};base64,${b64(bytes)}` })
    }
    expect(native.decoded).toBe(0)
  })

  it('a larger one is fitted into 480×360, never enlarged: a PNG as PNG, a JPEG as JPEG at 85', async () => {
    const pixels = new ImagePixels()
    const cases = [
      [pngBytes(1440, 900), { type: 'png', text: 'png 480x300' }],
      [pngHeaderBytes(1080, 2340), { type: 'png', text: 'png 166x360' }],
      [jpegBytes(1600, 1200), { type: 'jpeg', text: 'jpeg 480x360 q85' }],
      [jpegBytes(4000, 300), { type: 'jpeg', text: 'jpeg 480x36 q85' }],
    ] as const
    for (const [bytes, made] of cases) {
      const { source, id } = logWith(bytes)
      expect(decode(await pixels.get(source, id, 'thumb'))).toEqual(made)
    }
    expect(THUMB).toEqual({ width: 480, height: 360 })
  })

  it('the full image is the bytes themselves, re-encoded, under the type sniffed from them', async () => {
    const jpeg = jpegBytes(1600, 1200)
    const { source, id } = logWith(jpeg, 'image/png')
    expect(await new ImagePixels().get(source, id, 'full')).toEqual({ url: `data:image/jpeg;base64,${b64(jpeg)}` })
    expect(native.decoded).toBe(0)
  })

  it("GIF and WebP: the image itself up to 1 MiB, else No preview; their full image either way", async () => {
    const pixels = new ImagePixels()
    const gif = logWith(gifBytes(100, 50))
    expect(await pixels.get(gif.source, gif.id, 'thumb')).toEqual({ url: `data:image/gif;base64,${b64(gifBytes(100, 50))}` })
    const big = Buffer.concat([webpBytes(800, 600, 'VP8X'), Buffer.alloc(1024 * 1024)])
    const webp = logWith(big)
    expect(await pixels.get(webp.source, webp.id, 'thumb')).toEqual({ error: NO_PREVIEW })
    expect(await pixels.get(webp.source, webp.id, 'full')).toEqual({ url: `data:image/webp;base64,${b64(big)}` })
    expect(native.decoded).toBe(0)
  })

  it('more than 16,384 px a side or 40 MP is Too large to show, before anything is decoded', async () => {
    const pixels = new ImagePixels()
    for (const bytes of [pngHeaderBytes(16_385, 10), pngHeaderBytes(10, 20_000), pngHeaderBytes(8000, 6000), gifBytes(16_000, 16_000)]) {
      const { source, id } = logWith(bytes)
      expect(await pixels.get(source, id, 'thumb')).toEqual({ error: TOO_LARGE })
      expect(await pixels.get(source, id, 'full')).toEqual({ error: TOO_LARGE })
    }
    expect(native.decoded).toBe(0)
  })

  it("a decode that fails, or a header that gives no size, is Couldn't decode this image", async () => {
    const pixels = new ImagePixels()
    native.fail = true
    const png = logWith(pngBytes(1440, 900))
    expect(await pixels.get(png.source, png.id, 'thumb')).toEqual({ error: UNDECODABLE })
    const broken = logWith(Buffer.from([0xff, 0xd8, 0xff, 0xda, 0, 8, 1, 2, 3, 4, 5, 6]))
    expect(await pixels.get(broken.source, broken.id, 'thumb')).toEqual({ error: UNDECODABLE })
    expect(await pixels.get(broken.source, broken.id, 'full')).toEqual({ error: UNDECODABLE })
  })

  it('a line that no longer holds the image, a missing log or a line cut short is No longer in the session log', async () => {
    const pixels = new ImagePixels()
    const { source, id } = logWith(pngBytes(8, 8))
    const other = logWith(pngBytes(9, 8))
    expect(await pixels.get(other.source, id, 'thumb')).toEqual({ error: GONE })
    expect(await pixels.get({ ...source, path: `${source.path}.gone` }, id, 'thumb')).toEqual({ error: GONE })
    expect(await pixels.get({ ...source, length: source.length - 5 }, id, 'thumb')).toEqual({ error: GONE })
    expect(await pixels.get({ ...source, offset: source.offset + 3 }, id, 'full')).toEqual({ error: GONE })
  })

  it('a line too long to read again is refused before it is read', async () => {
    const read = vi.fn(async () => Buffer.alloc(0))
    const pixels = new ImagePixels(read)
    for (const length of [MAX_LINE + 1, 0, -1, Number.NaN]) {
      expect(await pixels.get({ path: 'x', offset: 0, length }, '0123456789abcdef', 'thumb')).toEqual({ error: TOO_LARGE })
    }
    expect(read).not.toHaveBeenCalled()
  })
})

describe('ImagePixels: Open', () => {
  it("bytes(): the image's own bytes and format, with no size limit", async () => {
    const bytes = pngHeaderBytes(20_000, 20_000)
    const { source, id } = logWith(bytes)
    const got = await new ImagePixels().bytes(source, id)
    expect(got).toMatchObject({ format: 'png' })
    expect('bytes' in got && Buffer.compare(got.bytes, bytes)).toBe(0)
    expect(await new ImagePixels().bytes(source, '0123456789abcdef')).toEqual({ error: GONE })
  })
})

describe('ImagePixels: the queue', () => {
  it('runs one request at a time, full images and Open first, and a failure does not stop the next', async () => {
    const order: string[] = []
    let running = 0
    let most = 0
    const files = new Map<string, Buffer>()
    const pixels = new ImagePixels(async (source) => {
      running++
      most = Math.max(most, running)
      order.push(source.path)
      await new Promise((r) => setTimeout(r, 5))
      running--
      if (source.path === 'broken') throw new Error('EIO')
      return files.get(source.path)!
    })
    const add = (name: string, bytes: Uint8Array) => {
      const line = Buffer.from(JSON.stringify({ message: { content: [imageBlock(bytes)] } }))
      files.set(name, line)
      return { source: { path: name, offset: 0, length: line.length }, id: imageId(b64(bytes)) }
    }
    const a = add('thumb a', pngBytes(8, 8))
    const b = add('thumb b', pngBytes(9, 8))
    const c = add('full c', pngBytes(10, 8))
    const d = add('open d', pngBytes(11, 8))
    const answers = Promise.all([
      pixels.get(a.source, a.id, 'thumb'),
      pixels.get(b.source, b.id, 'thumb'),
      pixels.get({ ...c.source, path: 'broken' }, c.id, 'full'),
      pixels.bytes(d.source, d.id),
      pixels.get(c.source, c.id, 'full'),
    ])
    const [ta, tb, broken, opened, full] = await answers
    expect(order).toEqual(['thumb a', 'broken', 'open d', 'full c', 'thumb b'])
    expect(most).toBe(1)
    expect(ta).toHaveProperty('url')
    expect(tb).toHaveProperty('url')
    expect(broken).toEqual({ error: GONE })
    expect(opened).toMatchObject({ format: 'png' })
    expect(full).toHaveProperty('url')
  })

  it('a request after the queue ran dry starts it again', async () => {
    const pixels = new ImagePixels()
    const one = logWith(pngBytes(8, 8))
    expect(await pixels.get(one.source, one.id, 'thumb')).toHaveProperty('url')
    await new Promise((r) => setImmediate(r))
    const two = logWith(pngBytes(9, 8))
    expect(await pixels.get(two.source, two.id, 'thumb')).toHaveProperty('url')
  })
})
```

- [ ] **Step 2: Run it to make sure it fails**

Run: `npx vitest run src/main/claude/pixels.test.ts`
Expected: FAIL: `./pixels` can't be resolved.

- [ ] **Step 3: The module**

Create `src/main/claude/pixels.ts`:

```ts
import { open } from 'node:fs/promises'
import { nativeImage } from 'electron'
import type { ClaudeImageData, ClaudeImageFormat } from '@shared/types'
import { findImageData, imageSize, type ImageSize, sniffFormat } from './images'

/** Where an image's line is: the followed log, and the line's place in it. */
export interface ImageSource {
  path: string
  offset: number
  length: number
}

/** Why an image can't be shown, as the panel says it. */
export const GONE = 'No longer in the session log'
export const TOO_LARGE = 'Too large to show'
export const UNDECODABLE = "Couldn't decode this image"
export const NO_PREVIEW = 'No preview'

/** A line longer than this isn't read again (the longest measured was 2.2 MB). */
export const MAX_LINE = 64 * 1024 * 1024
/** Thumbnails fit 480×360: twice the panel's 240×180 box, for Retina screens. */
export const THUMB = { width: 480, height: 360 }
/** Larger than this, by the header (which is what a decoder goes by), isn't decoded or shown: the
 *  largest measured was 3.4 MP. */
const MAX_SIDE = 16_384
const MAX_PIXELS = 40_000_000
/** GIF and WebP can't be decoded here (nativeImage reads neither), so their thumbnail is the image
 *  itself, up to this size. */
const MAX_PASSTHROUGH = 1024 * 1024
/** JPEG thumbnails' quality: 9–27 KB at 480×360 (measured). */
const JPEG_QUALITY = 85

interface Loaded {
  bytes: Buffer
  format: ClaudeImageFormat
  size: ImageSize
}

type Job = () => Promise<void>

const nextTurn = () => new Promise<void>((resolve) => setImmediate(resolve))
const dataUrl = (format: ClaudeImageFormat, bytes: Uint8Array) => `data:image/${format};base64,${Buffer.from(bytes).toString('base64')}`
const tooLarge = (size: ImageSize) => size.width > MAX_SIDE || size.height > MAX_SIDE || size.width * size.height > MAX_PIXELS

/** `size` fitted into `box`, never enlarged. */
export function fitInto(size: ImageSize, box: ImageSize): ImageSize {
  const scale = Math.min(1, box.width / size.width, box.height / size.height)
  return { width: Math.max(1, Math.round(size.width * scale)), height: Math.max(1, Math.round(size.height * scale)) }
}

/** The line's bytes, read again: fewer when the file has shrunk since. */
async function readLine(source: ImageSource): Promise<Buffer> {
  const fh = await open(source.path, 'r')
  try {
    const buffer = Buffer.allocUnsafe(source.length)
    let got = 0
    while (got < source.length) {
      const { bytesRead } = await fh.read(buffer, got, source.length - got, source.offset + got)
      if (bytesRead === 0) break
      got += bytesRead
    }
    return buffer.subarray(0, got)
  } finally {
    await fh.close()
  }
}

/**
 * Images' pixels, read again from their lines in the session log when the panel shows them: main
 * keeps none. One request at a time, a full image (or an Open) ahead of thumbnails, with a turn of
 * the event loop between two, so terminal output and other IPC go on (the longest step measured was
 * 16 ms). Nothing here throws: every request answers, with { error } when it must.
 */
export class ImagePixels {
  private readonly first: Job[] = []
  private readonly thumbs: Job[] = []
  private running = false

  constructor(private readonly read: (source: ImageSource) => Promise<Buffer> = readLine) {}

  /** 'thumb': fits 480×360 (PNG or JPEG as its source; GIF or WebP itself); 'full': the image itself. */
  get(source: ImageSource, id: string, size: 'thumb' | 'full'): Promise<ClaudeImageData> {
    return this.queue(size === 'full' ? this.first : this.thumbs, async () => {
      const loaded = await this.load(source, id)
      if ('error' in loaded) return loaded
      return size === 'full' ? this.full(loaded) : this.thumb(loaded)
    }, { error: UNDECODABLE })
  }

  /** The image's own bytes and format, for Open. No size limit: Open is how a large one is seen. */
  bytes(source: ImageSource, id: string): Promise<{ bytes: Buffer; format: ClaudeImageFormat } | { error: string }> {
    return this.queue(this.first, async () => {
      const loaded = await this.load(source, id)
      return 'error' in loaded ? loaded : { bytes: loaded.bytes, format: loaded.format }
    }, { error: GONE })
  }

  private queue<T>(lane: Job[], work: () => Promise<T>, failed: T): Promise<T> {
    return new Promise<T>((resolve) => {
      lane.push(async () => {
        try {
          resolve(await work())
        } catch {
          resolve(failed)
        }
      })
      void this.pump()
    })
  }

  private async pump(): Promise<void> {
    if (this.running) return
    this.running = true
    try {
      for (;;) {
        const job = this.first.shift() ?? this.thumbs.shift()
        if (!job) break
        await job()
        await nextTurn()
      }
    } finally {
      // As the loop ends, synchronously: a job queued after the last shift() starts its own pump.
      this.running = false
    }
  }

  /** The line read again and the image in it whose id is `id`, decoded from base64 (its header
   *  read over all of its bytes). Bounded before each step: the line's length, then (findImageData)
   *  the base64's. */
  private async load(source: ImageSource, id: string): Promise<Loaded | { error: string }> {
    if (!(source.length > 0) || source.length > MAX_LINE) return { error: TOO_LARGE }
    let entry: unknown
    try {
      entry = JSON.parse((await this.read(source)).toString('utf8'))
    } catch {
      return { error: GONE } // deleted, cut short, or rewritten so the place holds something else
    }
    const data = findImageData(entry, id)
    if (data === null) return { error: GONE }
    const bytes = Buffer.from(data, 'base64')
    const format = sniffFormat(bytes)
    if (!format) return { error: UNDECODABLE }
    return { bytes, format, size: imageSize(format, bytes) }
  }

  private full({ bytes, format, size }: Loaded): ClaudeImageData {
    if (!size.width || !size.height) return { error: UNDECODABLE }
    if (tooLarge(size)) return { error: TOO_LARGE }
    // Encoded again from the decoded bytes: the URL holds only base64 and the type sniffed here.
    return { url: dataUrl(format, bytes) }
  }

  private thumb({ bytes, format, size }: Loaded): ClaudeImageData {
    if (!size.width || !size.height) return { error: UNDECODABLE }
    if (tooLarge(size)) return { error: TOO_LARGE }
    if (format === 'gif' || format === 'webp') return bytes.length <= MAX_PASSTHROUGH ? { url: dataUrl(format, bytes) } : { error: NO_PREVIEW }
    if (size.width <= THUMB.width && size.height <= THUMB.height) return { url: dataUrl(format, bytes) }
    const image = nativeImage.createFromBuffer(bytes)
    if (image.isEmpty()) return { error: UNDECODABLE }
    const fit = fitInto(image.getSize(), THUMB)
    const small = image.resize({ width: fit.width, height: fit.height, quality: 'good' })
    if (small.isEmpty()) return { error: UNDECODABLE }
    // PNG stays PNG (85% of them have alpha); a JPEG photo as JPEG is a third of the size and time.
    return format === 'png' ? { url: dataUrl('png', small.toPNG()) } : { url: dataUrl('jpeg', small.toJPEG(JPEG_QUALITY)) }
  }
}
```

- [ ] **Step 4: Run it**

Run: `npx vitest run src/main/claude/pixels.test.ts && npm run typecheck`
Expected: PASS (11 tests).

- [ ] **Step 5: Commit**

```bash
git add src/main/claude/pixels.ts src/main/claude/pixels.test.ts
git -c user.email=franco@effektstudios.com commit -m "Claude images: pixels read again from the log" -m "Claude-Session: https://claude.ai/code/session_012TidnBvRYbxhSYqPzFZuph"
```

---

### Task 11: Where an image's line is

**Files:**
- Modify: `src/main/claude/subscriptions.ts`
- Test: `src/main/claude/subscriptions.test.ts`

The hub passes each entry's place into `ingest()`, and `imageSource(folder, id)` answers with the
followed log's path and the line's place, only for an image an item of that session's feed lists. It
answers whichever renderer asks (decision 3): a tab coming to the front may ask before its subscribe
has been answered. Nobody following the folder: null.

- [ ] **Step 1: Write the failing tests**

In `src/main/claude/subscriptions.test.ts`:

Replace the first import with:

```ts
import { existsSync, readFileSync, rmSync, writeFileSync } from 'node:fs'
```

and the test-log import with:

```ts
import { imageId } from './images'
import { type LogWriter, makeClaudeHome, pngBytes, readLines, removeClaudeHomes, sessionLog } from './test-log'
```

In `setup()`, the fake reader returns places too. Replace:

```ts
      // As JsonlTail: what was appended since the last read; a deleted log has nothing new; one
      // that got shorter was rewritten and is read again from the start (reset).
      const reader = {
        modified: 0, // the time seen at the last read
        async read(maxBytes?: number) {
          reads.count++
          reads.maxBytes.push(maxBytes)
          if (!existsSync(path)) return { entries: [], reset: false, more: false }
          reader.modified = mtime.get(path) ?? 0
          const all = readEntries(path)
          const reset = all.length < seen
          if (reset) seen = 0
          const entries = all.slice(seen, seen + chunk.entries)
          seen += entries.length
          return { entries, reset, more: seen < all.length }
        },
      }
```

with:

```ts
      // As JsonlTail: what was appended since the last read, with each line's place; a deleted log
      // has nothing new; one that got shorter was rewritten and is read again from the start (reset).
      const reader = {
        modified: 0, // the time seen at the last read
        async read(maxBytes?: number) {
          reads.count++
          reads.maxBytes.push(maxBytes)
          if (!existsSync(path)) return { entries: [], places: [], reset: false, more: false }
          reader.modified = mtime.get(path) ?? 0
          const all = readLines(path)
          const reset = all.length < seen
          if (reset) seen = 0
          const lines = all.slice(seen, seen + chunk.entries)
          seen += lines.length
          return { entries: lines.map((l) => l.entry), places: lines.map(({ offset, length }) => ({ offset, length })), reset, more: seen < all.length }
        },
      }
```

Before the test `it('a scan that fails keeps what it had', …`, add:

```ts
  it("imageSource(): an image of the followed session is found in its log's line, and only there", async () => {
    const { hub, session, write, change, client } = setup()
    const shot = pngBytes(12, 8)
    const id = imageId(Buffer.from(shot).toString('base64'))
    const s1 = session('s1', (l) => l.prompt('first'))
    await hub.subscribe(client(1), FOLDER)
    expect(hub.imageSource(FOLDER, id)).toBeNull()
    write(s1, (l) => l.prompt('look', { images: [shot] }))
    await change(basename(s1.path))
    const source = hub.imageSource(FOLDER, id)
    expect(source).toMatchObject({ path: s1.path })
    const line = readFileSync(s1.path).toString('utf8', source!.offset, source!.offset + source!.length)
    expect(JSON.parse(line)).toMatchObject({ message: { content: [{ type: 'image' }, { type: 'text', text: 'look' }] } })
    expect(hub.imageSource(FOLDER, '0123456789abcdef')).toBeNull()
    expect(hub.imageSource(resolve(sep, 'Users', 'me', 'other'), id)).toBeNull()
    hub.unsubscribe(1, FOLDER)
    expect(hub.imageSource(FOLDER, id)).toBeNull() // nobody follows the folder now
  })

  it('imageSource(): a rewritten log gives the same image its new place', async () => {
    const { hub, session, rewrite, change, client } = setup()
    const shot = pngBytes(12, 8)
    const id = imageId(Buffer.from(shot).toString('base64'))
    const s1 = session('s1', (l) => l.prompt('before').prompt('look', { images: [shot] }))
    await hub.subscribe(client(1), FOLDER)
    expect(hub.imageSource(FOLDER, id)?.offset).toBe(readLines(s1.path)[1].offset)
    rewrite(s1, (l) => l.prompt('look', { images: [shot] })) // shorter: parsed again from the start
    await change(basename(s1.path))
    expect(hub.imageSource(FOLDER, id)).toMatchObject({ offset: 0, length: readLines(s1.path)[0].length })
  })
```

- [ ] **Step 2: Run them to make sure they fail**

Run: `npx vitest run src/main/claude/subscriptions.test.ts`
Expected: FAIL: `hub.imageSource is not a function` (the existing tests pass with the new fake reader).

- [ ] **Step 3: Places in, sources out**

In `src/main/claude/subscriptions.ts`:

Replace:

```ts
import type { SessionFile } from './locator'
import { SessionState } from './session'
```

with:

```ts
import type { SessionFile } from './locator'
import type { ImageSource } from './pixels'
import { SessionState } from './session'
```

and after `import { StepCache, subagentsDir } from './subagents'` add:

```ts
import type { LinePlace } from './tail'
```

Replace the `LogReader` interface's `read`:

```ts
/** Reads a log incrementally (JsonlTail). */
export interface LogReader {
  read(maxBytes?: number): Promise<{ entries: unknown[]; reset: boolean; more?: boolean }>
```

with:

```ts
/** Reads a log incrementally (JsonlTail). */
export interface LogReader {
  /** `places`: each entry's line in the log, at the same index (without them, images can't be shown). */
  read(maxBytes?: number): Promise<{ entries: unknown[]; places?: LinePlace[]; reset: boolean; more?: boolean }>
```

Before the doc comment of `follow()` (`/** Follow one session of a subscribed folder …`), add:

```ts
  /** Where image `id` of the session `folder` follows is in its log: the line to read it from again.
   *  Only an image an item of that session's feed lists; null otherwise, or when nobody follows the
   *  folder. */
  imageSource(folder: string, id: string): ImageSource | null {
    const w = this.folders.get(folderKey(folder))
    const log = w && !w.closed ? w.log : null
    const place = log?.state.imagePlace(id)
    return log && place ? { path: log.path, offset: place.offset, length: place.length } : null
  }

```

In `catchUp()`, replace:

```ts
        const { entries, reset, more } = await p.reader.read(this.timing.chunkBytes)
        if (reset) {
          p.state = new SessionState(p.project, p.real)
          p.stepCache = new StepCache()
        }
        for (const e of entries) p.state.ingest(e)
```

with:

```ts
        const { entries, places, reset, more } = await p.reader.read(this.timing.chunkBytes)
        if (reset) {
          p.state = new SessionState(p.project, p.real)
          p.stepCache = new StepCache()
        }
        entries.forEach((e, i) => p.state.ingest(e, places?.[i]))
```

- [ ] **Step 4: Run them**

Run: `npx vitest run src/main/claude/ && npm run typecheck`
Expected: PASS.

- [ ] **Step 5: Commit**

```bash
git add src/main/claude/subscriptions.ts src/main/claude/subscriptions.test.ts
git -c user.email=franco@effektstudios.com commit -m "Claude panel: where an image's line is" -m "Claude-Session: https://claude.ai/code/session_012TidnBvRYbxhSYqPzFZuph"
```

---

### Task 12: Thumbnails, full images and Open over IPC

**Files:**
- Modify: `src/main/claude/ipc.ts`
- Modify: `src/main/index.ts`
- Test: `src/main/claude/ipc.test.ts`

`claude:image` checks that the folder is absolute, the id is 16 lowercase hex digits and the size
`thumb` or `full`; anything else, or an image the followed session doesn't list, is "No longer in the
session log". `claude:open-image` saves a copy named by the bytes' own format (so only an image viewer
ever opens it) with the clipboard's `saveImage`, and opens it with `shell.openPath`; each failure says
why. Neither handler throws.

- [ ] **Step 1: Write the failing tests**

In `src/main/claude/ipc.test.ts`, replace the imports' last three lines:

```ts
import type { ClaudeSessionSummary, ClaudeSnapshot } from '@shared/types'
import { registerClaudeIpc } from './ipc'
import { makeClaudeHome, makeFolder, removeClaudeHomes, sessionLog } from './test-log'
```

with:

```ts
import type { ClaudeImage, ClaudeSessionSummary, ClaudeSnapshot } from '@shared/types'
import { registerClaudeIpc } from './ipc'
import { gifBytes, makeClaudeHome, makeFolder, pngBytes, removeClaudeHomes, sessionLog } from './test-log'
```

Replace the electron mock:

```ts
vi.mock('electron', () => ({
  ipcMain: {
    handle: (channel: string, fn: (...args: unknown[]) => unknown) => ipc.handlers.set(channel, fn),
    on: (channel: string, fn: (...args: unknown[]) => void) => ipc.listeners.set(channel, fn),
  },
}))
```

with:

```ts
vi.mock('electron', () => ({
  ipcMain: {
    handle: (channel: string, fn: (...args: unknown[]) => unknown) => ipc.handlers.set(channel, fn),
    on: (channel: string, fn: (...args: unknown[]) => void) => ipc.listeners.set(channel, fn),
  },
  // These tests' images are small enough to be their own thumbnails: nothing is decoded or opened.
  nativeImage: {
    createFromBuffer: () => {
      throw new Error('nothing is decoded in these tests')
    },
  },
  shell: {
    openPath: async () => {
      throw new Error('tests pass their own openPath')
    },
  },
}))
/** Open's copies and what it opened: saveImage and openPath, as main/index.ts passes them. */
const open = vi.hoisted(() => ({
  saved: [] as { bytes: Uint8Array; ext: string }[],
  opened: [] as string[],
  saveFails: false,
  problem: '',
}))
```

Replace the `beforeAll`:

```ts
beforeAll(() => {
  home = makeClaudeHome()
  registerClaudeIpc({ env: { CLAUDE_CONFIG_DIR: home } })
})
```

with:

```ts
beforeAll(() => {
  home = makeClaudeHome()
  registerClaudeIpc({
    env: { CLAUDE_CONFIG_DIR: home },
    saveImage: async (bytes, ext) => {
      if (open.saveFails) throw new Error('ENOSPC: no space left on device')
      open.saved.push({ bytes, ext })
      return `/tmp/Deck clipboard/x/image-0123456789abcdef.${ext}`
    },
    openPath: async (path) => {
      open.opened.push(path)
      return open.problem
    },
  })
})
```

Before the test `it('a destroyed or reloading webContents loses its subscriptions', …`, add:

```ts
  it('claude:image answers bad arguments with an error, never a throw', async () => {
    const wc = new FakeContents()
    const folder = makeFolder()
    sessionLog(home, folder).prompt('look', { images: [pngBytes(8, 8)] })
    const snapshot = (await invoke(wc, IPC.claudeSubscribe, folder)) as ClaudeSnapshot
    const id = (snapshot.feed[0] as { images: ClaudeImage[] }).images[0].id
    const gone = { error: 'No longer in the session log' }
    for (const [f, i, size] of [
      [undefined, id, 'thumb'], ['relative', id, 'thumb'], [folder, undefined, 'thumb'], [folder, id.toUpperCase(), 'thumb'],
      [folder, id.slice(1), 'thumb'], [folder, `${id}0`, 'thumb'], [folder, '../../etc/passwd', 'full'], [folder, 42, 'full'],
      [folder, id, 'huge'], [folder, id, undefined], [folder, { id }, 'thumb'],
    ]) {
      expect(await invoke(wc, IPC.claudeImage, f, i, size)).toEqual(gone)
    }
    for (const [f, i] of [[undefined, id], [folder, 'abc'], [42, id]]) expect(await invoke(wc, IPC.claudeOpenImage, f, i)).toEqual(gone)
    emit(wc, IPC.claudeUnsubscribe, folder)
  })

  it("claude:image reads an image the followed session lists from its line; anything else is gone", async () => {
    const wc = new FakeContents()
    const folder = makeFolder()
    const png = pngBytes(64, 48)
    const gif = gifBytes(20, 10)
    sessionLog(home, folder).prompt('look', { images: [png, gif], pasteIds: [1, 2] })
    const snapshot = (await invoke(wc, IPC.claudeSubscribe, folder)) as ClaudeSnapshot
    const [pngRef, gifRef] = (snapshot.feed[0] as { images: ClaudeImage[] }).images
    expect([pngRef, gifRef].map((r) => [r.format, r.paste])).toEqual([['png', 1], ['gif', 2]])
    const url = `data:image/png;base64,${Buffer.from(png).toString('base64')}`
    expect(await invoke(wc, IPC.claudeImage, folder, pngRef.id, 'thumb')).toEqual({ url })
    expect(await invoke(wc, IPC.claudeImage, folder, pngRef.id, 'full')).toEqual({ url })
    expect(await invoke(wc, IPC.claudeImage, folder, gifRef.id, 'thumb')).toEqual({ url: `data:image/gif;base64,${Buffer.from(gif).toString('base64')}` })
    expect(await invoke(wc, IPC.claudeImage, folder, '0123456789abcdef', 'thumb')).toEqual({ error: 'No longer in the session log' })
    expect(await invoke(wc, IPC.claudeImage, makeFolder(), pngRef.id, 'thumb')).toEqual({ error: 'No longer in the session log' })
    emit(wc, IPC.claudeUnsubscribe, folder)
    expect(await invoke(wc, IPC.claudeImage, folder, pngRef.id, 'thumb')).toEqual({ error: 'No longer in the session log' })
  })

  it('claude:open-image saves a copy named by its format and opens it; a failure says why', async () => {
    const wc = new FakeContents()
    const folder = makeFolder()
    const png = pngBytes(30, 20)
    sessionLog(home, folder).prompt('look', { images: [png] })
    const snapshot = (await invoke(wc, IPC.claudeSubscribe, folder)) as ClaudeSnapshot
    const { id } = (snapshot.feed[0] as { images: ClaudeImage[] }).images[0]
    open.saved = []
    open.opened = []
    expect(await invoke(wc, IPC.claudeOpenImage, folder, id)).toBeNull()
    expect(open.saved).toHaveLength(1)
    expect(open.saved[0].ext).toBe('png')
    expect(Buffer.compare(Buffer.from(open.saved[0].bytes), png)).toBe(0)
    expect(open.opened).toEqual(['/tmp/Deck clipboard/x/image-0123456789abcdef.png'])
    open.problem = 'No application knows how to open this'
    expect(await invoke(wc, IPC.claudeOpenImage, folder, id)).toEqual({ error: "Couldn't open the copy: No application knows how to open this" })
    open.problem = ''
    open.saveFails = true
    expect(await invoke(wc, IPC.claudeOpenImage, folder, id)).toEqual({ error: "Couldn't save a copy to open: ENOSPC: no space left on device" })
    open.saveFails = false
    expect(await invoke(wc, IPC.claudeOpenImage, folder, '0123456789abcdef')).toEqual({ error: 'No longer in the session log' })
    emit(wc, IPC.claudeUnsubscribe, folder)
  })
```

- [ ] **Step 2: Run them to make sure they fail**

Run: `npx vitest run src/main/claude/ipc.test.ts`
Expected: FAIL: no handler is registered for `claude:image` or `claude:open-image` (`invoke` answers
`undefined`).

- [ ] **Step 3: The handlers**

Replace `src/main/claude/ipc.ts` with:

```ts
import { isAbsolute } from 'node:path'
import { ipcMain, shell, type WebContents } from 'electron'
import { IPC } from '@shared/channels'
import type { ClaudeImageData, ClaudeResume, ClaudeSessionSummary, ClaudeSnapshot } from '@shared/types'
import type { TempImageExt } from '../clipboard/temp'
import { IMAGE_EXT } from './images'
import { scanFolder } from './locator'
import { GONE, ImagePixels } from './pixels'
import { agentSteps } from './subagents'
import { type Client, ClaudeSubscriptions } from './subscriptions'
import { JsonlTail } from './tail'
import { readTitle } from './titles'
import { watchDirs } from './watch'

// The renderer sends the tab's folder, so it is absolute; a relative one would be resolved against
// the app's own working directory.
const isFolder = (x: unknown): x is string => typeof x === 'string' && x !== '' && x.length < 4096 && isAbsolute(x)
// Session ids are log file names (UUIDs); they're looked up in the folder's list, never joined into a path.
const isSessionId = (x: unknown): x is string => typeof x === 'string' && /^[A-Za-z0-9][A-Za-z0-9._-]{0,127}$/.test(x)
// Image ids are what main listed: 16 hex digits of a SHA-1. They're looked up, never part of a path.
const isImageId = (x: unknown): x is string => typeof x === 'string' && /^[0-9a-f]{16}$/.test(x)
const isSize = (x: unknown): x is 'thumb' | 'full' => x === 'thumb' || x === 'full'
/** The tab's session to resume; anything else is none (the newest). Only the two fields are kept. */
function resumeOf(x: unknown): ClaudeResume | null {
  if (typeof x !== 'object' || x === null) return null
  const { sessionId, pinned } = x as Record<string, unknown>
  return isSessionId(sessionId) && typeof pinned === 'boolean' ? { sessionId, pinned } : null
}
const message = (err: unknown) => (err instanceof Error ? err.message : String(err))

export interface ClaudeIpcOptions {
  /** Where Claude's home is ($CLAUDE_CONFIG_DIR); tests pass their own. */
  env?: NodeJS.ProcessEnv
  /** Saves a copy of an image for Open (beside the clipboard's pasted images, cleared at start and
   *  quit); resolves with its path. Without it, Open says it can't. */
  saveImage?(bytes: Uint8Array, ext: TempImageExt): Promise<string>
  /** Opens a file in its default app: '' when it did, else why not (shell.openPath). */
  openPath?(path: string): Promise<string>
}

/** `claude:*` handlers. Read-only: Deck never writes to Claude's files. Images are read again from
 *  the log of the session a folder follows, and only those its feed lists. */
export function registerClaudeIpc(opts: ClaudeIpcOptions = {}): void {
  const env = opts.env ?? process.env
  const openPath = opts.openPath ?? ((path: string) => shell.openPath(path))
  const hub = new ClaudeSubscriptions({
    scan: (folder) => scanFolder(folder, env),
    open: (path) => new JsonlTail(path),
    steps: agentSteps,
    title: readTitle,
    watch: watchDirs,
    now: Date.now,
  })
  const pixels = new ImagePixels()

  const seen = new Set<number>()
  const client = (wc: WebContents): Client => {
    const id = wc.id
    if (!seen.has(id)) {
      seen.add(id)
      wc.once('destroyed', () => {
        seen.delete(id)
        hub.drop(id)
      })
      // A reload starts a renderer that has subscribed to nothing yet.
      wc.on('did-start-loading', () => hub.drop(id))
      wc.on('render-process-gone', () => hub.drop(id))
    }
    return {
      id,
      send: (folder, snapshot) => {
        if (!wc.isDestroyed()) wc.send(IPC.claudeUpdate, folder, snapshot)
      },
    }
  }

  ipcMain.handle(IPC.claudeSubscribe, (e, folder: unknown, resume: unknown): Promise<ClaudeSnapshot | null> | null =>
    isFolder(folder) ? hub.subscribe(client(e.sender), folder, resumeOf(resume)).catch(() => null) : null)
  // An `on` listener that throws shows an error dialog, so this one only acts on valid arguments.
  ipcMain.on(IPC.claudeUnsubscribe, (e, folder: unknown) => {
    if (isFolder(folder)) hub.unsubscribe(e.sender.id, folder)
  })
  ipcMain.handle(IPC.claudeSessions, async (_e, folder: unknown): Promise<ClaudeSessionSummary[]> =>
    isFolder(folder) ? hub.sessions(folder).catch(() => []) : [])
  ipcMain.handle(IPC.claudeFollow, async (_e, folder: unknown, sessionId: unknown): Promise<void> => {
    if (!isFolder(folder) || !(sessionId === null || isSessionId(sessionId))) return
    await hub.follow(folder, sessionId).catch(() => {})
  })
  ipcMain.handle(IPC.claudeImage, async (_e, folder: unknown, id: unknown, size: unknown): Promise<ClaudeImageData> => {
    if (!isFolder(folder) || !isImageId(id) || !isSize(size)) return { error: GONE }
    const source = hub.imageSource(folder, id)
    if (!source) return { error: GONE }
    return pixels.get(source, id, size) // never rejects
  })
  ipcMain.handle(IPC.claudeOpenImage, async (_e, folder: unknown, id: unknown): Promise<{ error: string } | null> => {
    if (!isFolder(folder) || !isImageId(id)) return { error: GONE }
    const source = hub.imageSource(folder, id)
    if (!source) return { error: GONE }
    const image = await pixels.bytes(source, id)
    if ('error' in image) return image
    if (!opts.saveImage) return { error: "Deck can't save a copy to open." }
    let file: string
    try {
      // Named by the bytes' own format, so only an image viewer ever opens it.
      file = await opts.saveImage(image.bytes, IMAGE_EXT[image.format])
    } catch (err) {
      return { error: `Couldn't save a copy to open: ${message(err)}` }
    }
    try {
      const problem = await openPath(file)
      return problem ? { error: `Couldn't open the copy: ${problem}` } : null
    } catch (err) {
      return { error: `Couldn't open the copy: ${message(err)}` }
    }
  })
}
```

- [ ] **Step 4: Wire it in main**

In `src/main/index.ts`, delete the line `registerClaudeIpc()` (after `registerGitIpc(…)`), and after the
`const clip = registerClipboardIpc({ … })` statement add:

```ts
  // The Claude panel's viewer opens copies of Claude's images from the same temp folder.
  registerClaudeIpc({ saveImage: (bytes, ext) => clip.saveImage(bytes, ext, 'image') })
```

(The IPC handlers only need registering before the window loads, which comes later in `start()`.)

- [ ] **Step 5: Run everything**

Run: `npm test && npm run typecheck`
Expected: PASS.

- [ ] **Step 6: Commit**

```bash
git add src/main/claude/ipc.ts src/main/claude/ipc.test.ts src/main/index.ts
git -c user.email=franco@effektstudios.com commit -m "Claude images: IPC for thumbnails, full images and Open" -m "Claude-Session: https://claude.ai/code/session_012TidnBvRYbxhSYqPzFZuph"
```

---
### Task 13: Sizes, captions, the feed's images and the thumbnail cache

**Files:**
- Create: `src/renderer/src/claude/images.ts`
- Test: `src/renderer/src/claude/images.test.ts`

The renderer's pure parts:
- **sizes:** a thumbnail's box fits 240×180, keeps its shape and is never enlarged (a 32 px icon stays
  32 px; 240×150 for a 16:10 screenshot, 83×180 for a phone's); no size in the header gives a 120 px
  square. The viewer's image is as large as fits with 24 px around it, at no more than one image pixel
  per CSS pixel;
- **captions:** "Image #3 · 1440 × 900 · PNG · 212 KB", "Read · docs/shot.png · 923 × 2000 · PNG · 284 KB";
- **the feed's images**, oldest to newest, keyed `<row key>:<index>`, and stepping through them;
- **`ThumbCache`:** thumbnails by id, least recently used out first past 24 MiB of URL text; a request
  on its way is shared; a failure isn't kept; only `data:image/` URLs are taken from main.

- [ ] **Step 1: Write the failing test**

Create `src/renderer/src/claude/images.test.ts`:

```ts
import { describe, expect, it, vi } from 'vitest'
import type { ClaudeFeedItem, ClaudeImage } from '@shared/types'
import { COULD_NOT_LOAD, feedImages, formatBytes, imageCaption, imageCount, isImageData, itemImages, stepImage, ThumbCache, thumbSize, viewerSize } from './images'

const image = (over: Partial<ClaudeImage> = {}): ClaudeImage => ({ id: 'a1b2c3d4e5f60718', format: 'png', width: 1440, height: 900, bytes: 212_000, ...over })

describe('sizes', () => {
  it('a thumbnail fits 240×180, keeps its shape and is never enlarged; no size gives a 120 px square', () => {
    expect(thumbSize({ width: 1440, height: 900 })).toEqual({ width: 240, height: 150 })
    expect(thumbSize({ width: 1080, height: 2340 })).toEqual({ width: 83, height: 180 })
    expect(thumbSize({ width: 32, height: 32 })).toEqual({ width: 32, height: 32 })
    expect(thumbSize({ width: 5000, height: 1 })).toEqual({ width: 240, height: 1 })
    expect(thumbSize({ width: 0, height: 0 })).toEqual({ width: 120, height: 120 })
  })

  it('the viewer: as large as fits with 24 px around it, never above one image pixel per CSS pixel', () => {
    expect(viewerSize({ width: 2880, height: 1800 }, { width: 1048, height: 748 })).toEqual({ width: 1000, height: 625 })
    expect(viewerSize({ width: 1080, height: 2340 }, { width: 1048, height: 748 })).toEqual({ width: 323, height: 700 })
    expect(viewerSize({ width: 300, height: 200 }, { width: 1048, height: 748 })).toEqual({ width: 300, height: 200 })
    expect(viewerSize({ width: 0, height: 0 }, { width: 1048, height: 748 })).toBeNull()
    expect(viewerSize({ width: 100, height: 100 }, { width: 0, height: 0 })).toEqual({ width: 1, height: 1 })
  })
})

describe('captions', () => {
  it('a pasted image by its number; a tool image by its tool and summary; then size, format and bytes', () => {
    expect(imageCaption(image({ paste: 3 }), { kind: 'prompt', text: 'see' })).toBe('Image #3 · 1440 × 900 · PNG · 212 KB')
    expect(imageCaption(image({ width: 923, height: 2000, bytes: 284_312 }), { kind: 'tool', id: 't1', name: 'Read', summary: 'docs/shot.png', state: 'done' }))
      .toBe('Read · docs/shot.png · 923 × 2000 · PNG · 284 KB')
    expect(imageCaption(image({ format: 'jpeg', width: 0, height: 0, bytes: 512 }), { kind: 'prompt', text: '[image]' })).toBe('Image · JPEG · 512 B')
    expect(imageCaption(image({ format: 'webp' }), { kind: 'tool', id: 't2', name: 'browser:shot', summary: '', state: 'done' })).toBe('browser:shot · 1440 × 900 · WebP · 212 KB')
  })

  it('bytes in B, KB and MB, powers of 1,000', () => {
    expect([999, 1000, 212_499, 999_499, 999_500, 2_400_000].map(formatBytes)).toEqual(['999 B', '1 KB', '212 KB', '999 KB', '1.0 MB', '2.4 MB'])
  })
})

describe("the feed's images", () => {
  const items: ClaudeFeedItem[] = [
    { kind: 'prompt', text: 'see', images: [image({ id: 'p0' }), image({ id: 'p1' })] },
    { kind: 'reply', text: 'ok' },
    { kind: 'tool', id: 't1', name: 'Read', summary: 'a.png', state: 'done', images: [image({ id: 'p0' })], moreImages: 2 },
    { kind: 'tool', id: 't2', name: 'Bash', summary: 'ls', state: 'done', images: 'nonsense' as never },
  ]

  it('are listed oldest to newest, keyed by row and place, the same picture twice too', () => {
    expect(feedImages(items, [7, 8, 9, 10]).map((e) => [e.key, e.image.id])).toEqual([['7:0', 'p0'], ['7:1', 'p1'], ['9:0', 'p0']])
    expect(feedImages(items, [7, 8, 9, 10])[2].caption).toBe('Read · a.png · 1440 × 900 · PNG · 212 KB')
  })

  it("count what an item lists and what it only counted; anything that isn't a list is none", () => {
    expect(items.map(imageCount)).toEqual([2, 0, 3, 0])
    expect(itemImages(items[3])).toEqual([])
  })

  it('step to the next and previous image, stopping at the ends; from one that has gone, forward to the oldest', () => {
    const list = feedImages(items, [7, 8, 9, 10])
    expect(stepImage(list, '7:1', 1)?.key).toBe('9:0')
    expect(stepImage(list, '7:1', -1)?.key).toBe('7:0')
    expect(stepImage(list, '7:0', -1)).toBeNull()
    expect(stepImage(list, '9:0', 1)).toBeNull()
    expect(stepImage(list, '3:0', 1)?.key).toBe('7:0')
    expect(stepImage(list, '3:0', -1)).toBeNull()
    expect(stepImage([], '3:0', 1)).toBeNull()
  })
})

describe('isImageData', () => {
  it('takes a data: URL of an image or a reason, nothing else', () => {
    expect(isImageData({ url: 'data:image/png;base64,AA==' })).toBe(true)
    expect(isImageData({ error: 'No preview' })).toBe(true)
    for (const bad of [null, 'data:image/png;base64,AA==', { url: 'https://example.com/a.png' }, { url: 'data:text/html,<b>' }, { url: 42 }, {}]) {
      expect(isImageData(bad)).toBe(false)
    }
  })
})

describe('ThumbCache', () => {
  const url = (n: number) => `data:image/png;base64,${'A'.repeat(n - 22)}`

  it('asks once for a thumbnail on its way, and keeps it', async () => {
    const cache = new ThumbCache()
    const load = vi.fn(async () => ({ url: url(100) }))
    const [a, b] = await Promise.all([cache.get('x', load), cache.get('x', load)])
    expect(a).toEqual({ url: url(100) })
    expect(b).toEqual(a)
    expect(await cache.get('x', load)).toEqual(a)
    expect(load).toHaveBeenCalledTimes(1)
    expect(cache.peek('x')).toBe(url(100))
  })

  it("doesn't keep a failure, a rejection or an answer that isn't image data", async () => {
    const cache = new ThumbCache()
    expect(await cache.get('x', async () => ({ error: 'Too large to show' }))).toEqual({ error: 'Too large to show' })
    expect(await cache.get('x', async () => {
      throw new Error('IPC closed')
    })).toEqual({ error: COULD_NOT_LOAD })
    expect(await cache.get('x', () => {
      throw new Error('synchronous')
    })).toEqual({ error: COULD_NOT_LOAD })
    expect(await cache.get('x', async () => ({ url: 'javascript:alert(1)' }))).toEqual({ error: COULD_NOT_LOAD })
    expect(cache.peek('x')).toBeUndefined()
    const load = vi.fn(async () => ({ url: url(50) }))
    expect(await cache.get('x', load)).toEqual({ url: url(50) })
    expect(load).toHaveBeenCalledTimes(1)
  })

  it('drops the least recently used past its limit, and never keeps one larger than the limit', async () => {
    const cache = new ThumbCache(300)
    for (const id of ['a', 'b', 'c']) await cache.get(id, async () => ({ url: url(100) }))
    cache.peek('a') // used: b is now the oldest
    await cache.get('d', async () => ({ url: url(100) }))
    expect(['a', 'b', 'c', 'd'].map((id) => cache.peek(id) !== undefined)).toEqual([true, false, true, true])
    expect(await cache.get('huge', async () => ({ url: url(301) }))).toEqual({ url: url(301) })
    expect(cache.peek('huge')).toBeUndefined()
  })
})
```

- [ ] **Step 2: Run it to make sure it fails**

Run: `npx vitest run src/renderer/src/claude/images.test.ts`
Expected: FAIL: `./images` can't be resolved.

- [ ] **Step 3: The module**

Create `src/renderer/src/claude/images.ts`:

```ts
import type { ClaudeFeedItem, ClaudeImage, ClaudeImageData } from '@shared/types'

export interface Size {
  width: number
  height: number
}

/** A feed item that can have images. */
export type ImageItem = Extract<ClaudeFeedItem, { kind: 'prompt' | 'tool' }>

/** Thumbnails fit this box (main makes them at twice it, for Retina screens)… */
export const THUMB_BOX: Size = { width: 240, height: 180 }
/** …and an image whose header gave no size gets a square this big. */
const UNKNOWN_SIDE = 120
/** The viewer leaves this much around its image. */
export const VIEWER_MARGIN = 24
/** Thumbnails kept, by the length of their data: URLs: about 1,000 of the sizes measured. */
export const THUMB_CACHE_CHARS = 24 * 1024 * 1024
export const COULD_NOT_LOAD = "Couldn't load this image"
export const UNDECODABLE = "Couldn't decode this image"

const FORMAT_LABEL: Record<string, string> = { png: 'PNG', jpeg: 'JPEG', gif: 'GIF', webp: 'WebP' }

/** An item's images, or none (whatever main sent that isn't a list). */
export function itemImages(item: ClaudeFeedItem): ClaudeImage[] {
  return (item.kind === 'prompt' || item.kind === 'tool') && Array.isArray(item.images) ? item.images : []
}

/** Its images and the ones only counted. */
export function imageCount(item: ClaudeFeedItem): number {
  if (item.kind !== 'prompt' && item.kind !== 'tool') return 0
  return itemImages(item).length + (typeof item.moreImages === 'number' && item.moreImages > 0 ? item.moreImages : 0)
}

/** `size` fitted into `box` and never enlarged, in whole pixels. */
function fit(size: Size, box: Size): Size {
  const scale = Math.min(1, box.width / size.width, box.height / size.height)
  return { width: Math.max(1, Math.round(size.width * scale)), height: Math.max(1, Math.round(size.height * scale)) }
}

/** A thumbnail's box: the image fitted into 240×180, never enlarged (a 32 px icon stays 32 px); a
 *  square when its header gave no size. CSS narrows it further to the row's width. */
export function thumbSize(image: Size): Size {
  if (!(image.width > 0) || !(image.height > 0)) return { width: UNKNOWN_SIDE, height: UNKNOWN_SIDE }
  return fit(image, THUMB_BOX)
}

/** The viewer's image: as large as `area` allows with 24 px around it, at no more than one image
 *  pixel per CSS pixel. null when its header gave no size: then it sizes itself. */
export function viewerSize(image: Size, area: Size): Size | null {
  if (!(image.width > 0) || !(image.height > 0)) return null
  const room = { width: Math.max(1, area.width - 2 * VIEWER_MARGIN), height: Math.max(1, area.height - 2 * VIEWER_MARGIN) }
  return fit(image, room)
}

/** 512 B, 212 KB, 2.4 MB (powers of 1,000, as Finder counts). */
export function formatBytes(n: number): string {
  if (n < 1000) return `${n} B`
  if (n < 999_500) return `${Math.round(n / 1000)} KB`
  return `${(n / 1_000_000).toFixed(1)} MB`
}

/** What the image is and its size: "Image #3 · 1440 × 900 · PNG · 212 KB", or for a tool's
 *  "Read · docs/shot.png · 923 × 2000 · PNG · 284 KB". */
export function imageCaption(image: ClaudeImage, item: ImageItem): string {
  const what = item.kind === 'prompt'
    ? [image.paste ? `Image #${image.paste}` : 'Image']
    : [item.name, item.summary].filter(Boolean)
  const size = image.width > 0 && image.height > 0 ? [`${image.width} × ${image.height}`] : []
  return [...what, ...size, FORMAT_LABEL[image.format] ?? String(image.format).toUpperCase(), formatBytes(image.bytes)].join(' · ')
}

/** One of the feed's images, for the viewer. */
export interface FeedImage {
  /** `<row key>:<index>`: the same while its item stays in the feed, even when the same picture shows
   *  twice. */
  key: string
  image: ClaudeImage
  caption: string
}

/** The feed's images, oldest to newest: what the viewer steps through. `keys`: the rows' keys. */
export function feedImages(items: readonly ClaudeFeedItem[], keys: readonly number[]): FeedImage[] {
  const list: FeedImage[] = []
  items.forEach((item, i) => {
    if (item.kind !== 'prompt' && item.kind !== 'tool') return
    itemImages(item).forEach((image, j) => list.push({ key: `${keys[i]}:${j}`, image, caption: imageCaption(image, item) }))
  })
  return list
}

/** The image `delta` steps from the one with `key`; null past either end. One that has gone (its
 *  item left the feed's window, so it was older than every image left) steps forward to the oldest. */
export function stepImage(list: readonly FeedImage[], key: string, delta: -1 | 1): FeedImage | null {
  const at = list.findIndex((e) => e.key === key)
  if (at < 0) return delta > 0 ? (list[0] ?? null) : null
  return list[at + delta] ?? null
}

/** An answer from main, checked: a data: URL of an image, or a reason. */
export function isImageData(x: unknown): x is ClaudeImageData {
  if (typeof x !== 'object' || x === null) return false
  const { url, error } = x as Record<string, unknown>
  return (typeof url === 'string' && url.startsWith('data:image/')) || typeof error === 'string'
}

/**
 * Thumbnails by image id, for the window's life: least recently used out first, past `limit`
 * characters of data: URL. A request already on its way is shared. A failure is answered but not
 * kept, so a thumbnail asks again when it's shown again.
 */
export class ThumbCache {
  private readonly urls = new Map<string, string>()
  private readonly loading = new Map<string, Promise<ClaudeImageData>>()
  private chars = 0

  constructor(private readonly limit = THUMB_CACHE_CHARS) {}

  /** The cached URL (now the most recently used), or undefined. */
  peek(id: string): string | undefined {
    const url = this.urls.get(id)
    if (url !== undefined) {
      this.urls.delete(id)
      this.urls.set(id, url)
    }
    return url
  }

  /** The thumbnail: cached, on its way, or asked for with `load`. Never rejects. */
  get(id: string, load: () => Promise<unknown>): Promise<ClaudeImageData> {
    const url = this.peek(id)
    if (url !== undefined) return Promise.resolve({ url })
    let pending = this.loading.get(id)
    if (!pending) {
      pending = Promise.resolve()
        .then(load)
        .then((data): ClaudeImageData => (isImageData(data) ? data : { error: COULD_NOT_LOAD }), (): ClaudeImageData => ({ error: COULD_NOT_LOAD }))
        .then((data) => {
          this.loading.delete(id)
          if ('url' in data) this.keep(id, data.url)
          return data
        })
      this.loading.set(id, pending)
    }
    return pending
  }

  private keep(id: string, url: string): void {
    if (url.length > this.limit) return
    const old = this.urls.get(id)
    if (old !== undefined) this.chars -= old.length
    this.urls.delete(id)
    this.urls.set(id, url)
    this.chars += url.length
    for (const [key, value] of this.urls) {
      if (this.chars <= this.limit) break
      this.urls.delete(key)
      this.chars -= value.length
    }
  }
}
```

- [ ] **Step 4: Run it**

Run: `npx vitest run src/renderer/src/claude/images.test.ts && npm run typecheck`
Expected: PASS (11 tests).

- [ ] **Step 5: Commit**

```bash
git add src/renderer/src/claude/images.ts src/renderer/src/claude/images.test.ts
git -c user.email=franco@effektstudios.com commit -m "Claude panel: image sizes, captions and the thumbnail cache" -m "Claude-Session: https://claude.ai/code/session_012TidnBvRYbxhSYqPzFZuph"
```

---

### Task 14: Feed items compare their images

**Files:**
- Modify: `src/renderer/src/claude/feedItems.ts`
- Test: `src/renderer/src/claude/feedItems.test.ts`

Two image-only prompts are both "[image]": `feedKeys` must tell them apart by their images, or it can
line the feed up at the wrong shift. A tool renders again when its result brings images.

- [ ] **Step 1: Write the failing tests**

In `src/renderer/src/claude/feedItems.test.ts`, replace the imports:

```ts
import type { ClaudeFeedItem } from '@shared/types'
import { feedKeys, NO_KEYS, sameItem, toolKind, toolLabel } from './feedItems'
```

with:

```ts
import type { ClaudeFeedItem, ClaudeImage } from '@shared/types'
import { feedKeys, NO_KEYS, sameEntry, sameItem, toolKind, toolLabel } from './feedItems'
```

Before `describe('tools', () => {`, add:

```ts
describe('items with images', () => {
  type Prompt = Extract<ClaudeFeedItem, { kind: 'prompt' }>
  type Tool = Extract<ClaudeFeedItem, { kind: 'tool' }>
  const image = (id: string): ClaudeImage => ({ id, format: 'png', width: 10, height: 10, bytes: 100 })
  const shot = (...ids: string[]): Prompt => ({ kind: 'prompt', text: '[image]', images: ids.map(image) })

  it("two image-only prompts are the same entry only with the same images", () => {
    expect(sameEntry(shot('a'), shot('a'))).toBe(true)
    expect(sameEntry(shot('a'), shot('b'))).toBe(false)
    expect(sameEntry(shot('a'), prompt('[image]'))).toBe(false)
    expect(sameEntry(shot('a', 'b'), shot('a'))).toBe(false)
    expect(sameEntry({ ...shot('a'), moreImages: 2 }, shot('a'))).toBe(false)
  })

  it('so the keys of two image-only prompts in a row follow the right one', () => {
    const one = feedKeys(NO_KEYS, [shot('a'), shot('b')])
    expect(feedKeys(one, [shot('b'), shot('c')]).keys).toEqual([1, 2])
  })

  it("a tool renders again when its result brings images; its key stays", () => {
    const running: Tool = { kind: 'tool', id: 't1', name: 'Read', summary: 'a.png', state: 'running' }
    const done: Tool = { ...running, state: 'done', images: [image('a')] }
    expect(sameItem(done, { ...running, state: 'done' })).toBe(false)
    expect(sameItem(done, { ...done, images: [image('a')] })).toBe(true)
    expect(sameItem(done, { ...done, moreImages: 1 })).toBe(false)
    const one = feedKeys(NO_KEYS, [prompt('go'), running])
    expect(feedKeys(one, [prompt('go'), done]).keys).toEqual([0, 1])
  })
})
```

- [ ] **Step 2: Run them to make sure they fail**

Run: `npx vitest run src/renderer/src/claude/feedItems.test.ts`
Expected: FAIL: `sameEntry` isn't exported (`is not a function`); with it exported, the keys test gets
`[0, 1]` and the tool test sees equal items.

- [ ] **Step 3: Compare images**

In `src/renderer/src/claude/feedItems.ts`, after `import type { ClaudeFeedItem } from '@shared/types'` add:

```ts
import { imageCount, itemImages } from './images'
```

and replace `sameEntry()` and `sameItem()`:

```ts
/** The same entry of the log: a tool by its id (its state changes in place), anything else by content. */
function sameEntry(a: ClaudeFeedItem, b: ClaudeFeedItem): boolean {
  if (a.kind !== b.kind) return false
  if (a.kind === 'tool') return a.id === (b as Tool).id
  if (a.kind === 'notice') return a.text === (b as Notice).text && a.tone === (b as Notice).tone
  return a.text === (b as { text: string }).text
}

/** Renders the same: every field equal (snapshots bring new objects with the same strings). */
export function sameItem(a: ClaudeFeedItem, b: ClaudeFeedItem): boolean {
  if (a === b) return true
  if (!sameEntry(a, b)) return false
  if (a.kind !== 'tool') return true
  const t = b as Tool
  return a.name === t.name && a.summary === t.summary && a.state === t.state && a.error === t.error
}
```

with:

```ts
/** The same images (ids are content hashes) and as many more. */
function sameImages(a: ClaudeFeedItem, b: ClaudeFeedItem): boolean {
  const x = itemImages(a)
  const y = itemImages(b)
  return x.length === y.length && x.every((image, i) => image.id === y[i].id) && imageCount(a) === imageCount(b)
}

/** The same entry of the log: a tool by its id (its state changes in place), a prompt by its text and
 *  images (two image-only prompts are both "[image]"), anything else by content. */
export function sameEntry(a: ClaudeFeedItem, b: ClaudeFeedItem): boolean {
  if (a.kind !== b.kind) return false
  if (a.kind === 'tool') return a.id === (b as Tool).id
  if (a.kind === 'notice') return a.text === (b as Notice).text && a.tone === (b as Notice).tone
  if (a.kind === 'prompt') return a.text === (b as { text: string }).text && sameImages(a, b)
  return a.text === (b as { text: string }).text
}

/** Renders the same: every field equal (snapshots bring new objects with the same strings). A tool
 *  renders again when its result brings images. */
export function sameItem(a: ClaudeFeedItem, b: ClaudeFeedItem): boolean {
  if (a === b) return true
  if (!sameEntry(a, b)) return false
  if (a.kind !== 'tool') return true
  const t = b as Tool
  return a.name === t.name && a.summary === t.summary && a.state === t.state && a.error === t.error && sameImages(a, t)
}
```

- [ ] **Step 4: Run them**

Run: `npx vitest run src/renderer/src/claude/ && npm run typecheck`
Expected: PASS (the old `feedKeys` tests too, including the timing one).

- [ ] **Step 5: Commit**

```bash
git add src/renderer/src/claude/feedItems.ts src/renderer/src/claude/feedItems.test.ts
git -c user.email=franco@effektstudios.com commit -m "Claude panel: feed items compare their images" -m "Claude-Session: https://claude.ai/code/session_012TidnBvRYbxhSYqPzFZuph"
```

---

### Task 15: Thumbnails

**Files:**
- Create: `src/renderer/src/claude/useThumbnail.ts`
- Create: `src/renderer/src/claude/ImageTiles.tsx`
- Modify: `src/renderer/src/icons.tsx` (`PictureIcon`)
- Modify: `src/renderer/src/claude/panel.css`
- Test: `src/renderer/src/claude/useThumbnail.test.ts`

The components; Task 17 puts them in the feed. A thumbnail is asked for when its box comes within one
feed-height of the visible part, through one `IntersectionObserver` per feed (`NearView`) whose root is
the feed's scroller: opening a session asks only for what's near the end, scrolling up asks for more,
and a hidden tab (`display: none`) asks for nothing. Its box is sized from the start (the snapshot
carries the size), so the feed doesn't jump when the picture arrives. Pressing one doesn't take the
keyboard from the terminal; they can't be dragged, and selecting the feed's text skips them.

The components have no tests (the renderer's tests run in node, without a DOM), but the observer's
bookkeeping does: an element is told once and then unwatched, and stopping or disposing leaves
nothing watched.

- [ ] **Step 1: Write the failing test**

Create `src/renderer/src/claude/useThumbnail.test.ts`:

```ts
import { afterEach, beforeEach, describe, expect, it, vi } from 'vitest'
import { NearView } from './useThumbnail'

/** A stand-in for the browser's IntersectionObserver (the tests run in node): it records what it
 *  watches, and `fire` tells it an element came into (or left) its margin. */
class FakeObserver {
  static last: FakeObserver | null = null
  readonly watched = new Set<object>()
  disconnected = false
  constructor(readonly callback: (entries: { target: object; isIntersecting: boolean }[]) => void, readonly options: { root: object; rootMargin: string }) {
    FakeObserver.last = this
  }
  observe(el: object) {
    this.watched.add(el)
  }
  unobserve(el: object) {
    this.watched.delete(el)
  }
  disconnect() {
    this.disconnected = true
    this.watched.clear()
  }
  fire(target: object, isIntersecting = true) {
    this.callback([{ target, isIntersecting }])
  }
}

beforeEach(() => {
  vi.stubGlobal('IntersectionObserver', FakeObserver)
})
afterEach(() => {
  vi.unstubAllGlobals()
})

describe('NearView', () => {
  it("watches with the feed's scroller as the root and one feed-height above and below", () => {
    const root = {}
    new NearView(root as Element)
    expect(FakeObserver.last?.options).toEqual({ root, rootMargin: '100% 0px' })
  })

  it('tells an element once when it comes near, and stops watching it', () => {
    const view = new NearView({} as Element)
    const observer = FakeObserver.last!
    const el = {} as Element
    const near = vi.fn()
    view.watch(el, near)
    observer.fire(el, false)
    expect(near).not.toHaveBeenCalled()
    observer.fire(el)
    observer.fire(el)
    expect(near).toHaveBeenCalledTimes(1)
    expect(observer.watched.has(el)).toBe(false)
  })

  it('stop() and dispose() leave nothing watched, and a late callback calls nobody', () => {
    const view = new NearView({} as Element)
    const observer = FakeObserver.last!
    const a = {} as Element
    const b = {} as Element
    const nearA = vi.fn()
    const nearB = vi.fn()
    const stopA = view.watch(a, nearA)
    view.watch(b, nearB)
    stopA()
    stopA() // twice is fine
    expect(observer.watched.has(a)).toBe(false)
    observer.fire(a)
    expect(nearA).not.toHaveBeenCalled()
    view.dispose()
    expect(observer.disconnected).toBe(true)
    observer.fire(b)
    expect(nearB).not.toHaveBeenCalled()
  })
})
```

- [ ] **Step 2: Run it to make sure it fails**

Run: `npx vitest run src/renderer/src/claude/useThumbnail.test.ts`
Expected: FAIL: `./useThumbnail` can't be resolved.

- [ ] **Step 3: The icon**

In `src/renderer/src/icons.tsx`, before `/** A section's fold marker (panel.css: .cp-caret turns it while folded). */`, add:

```tsx
/** A picture: the Claude panel's images button, and a thumbnail that can't be shown. */
export const PictureIcon = ({ size = 13 }: { size?: number }) => (
  <Svg size={size}>
    <rect x="2" y="3" width="12" height="10" rx="1.5" />
    <circle cx="6" cy="6.5" r="1.2" />
    <path d="M2.5 12l3.5-3.5 2.5 2.5 2-2 3 3" />
  </Svg>
)
```

- [ ] **Step 4: Asking when near view**

Create `src/renderer/src/claude/useThumbnail.ts`:

```ts
import { useEffect, useState } from 'react'
import type { ClaudeImageData } from '@shared/types'
import { ThumbCache } from './images'

/** The window's thumbnails, like the markdown cache: a tab switch or another session reuses them. */
export const thumbs = new ThumbCache()

/** Calls `near` once `el` comes near the feed's visible part; the function stops watching. */
export type Observe = (el: Element, near: () => void) => () => void

/**
 * One IntersectionObserver for a feed, with its scroller as the root: it tells each element it
 * watches, once, when it comes within one feed-height of the visible part. Opening a session asks
 * only for what's near the end; scrolling up asks for more. A hidden tab's feed (display: none)
 * intersects nothing, so it asks for nothing.
 */
export class NearView {
  private readonly calls = new Map<Element, () => void>()
  private readonly observer: IntersectionObserver

  constructor(root: Element) {
    this.observer = new IntersectionObserver((entries) => {
      for (const entry of entries) {
        const near = entry.isIntersecting ? this.calls.get(entry.target) : undefined
        if (!near) continue
        this.unwatch(entry.target)
        near()
      }
    }, { root, rootMargin: '100% 0px' })
  }

  watch(el: Element, near: () => void): () => void {
    this.calls.set(el, near)
    this.observer.observe(el)
    return () => this.unwatch(el)
  }

  dispose(): void {
    this.observer.disconnect()
    this.calls.clear()
  }

  private unwatch(el: Element): void {
    if (this.calls.delete(el)) this.observer.unobserve(el)
  }
}

/** Image `id`'s thumbnail: from the cache, else asked for from `folder`'s session once its box (the
 *  ref) comes near view. null until then. */
export function useThumbnail(folder: string, id: string, observe: Observe): { ref: (el: HTMLElement | null) => void; data: ClaudeImageData | null } {
  const [data, setData] = useState<ClaudeImageData | null>(() => {
    const url = thumbs.peek(id)
    return url === undefined ? null : { url }
  })
  const [el, setEl] = useState<HTMLElement | null>(null)
  const waiting = data === null
  useEffect(() => {
    if (!el || !waiting) return
    let live = true
    const stop = observe(el, () => {
      void thumbs.get(id, () => window.deck.claude.image(folder, id, 'thumb')).then((got) => {
        if (live) setData(got)
      })
    })
    return () => {
      live = false
      stop()
    }
  }, [el, folder, id, observe, waiting])
  return { ref: setEl, data }
}
```

- [ ] **Step 5: The tiles**

Create `src/renderer/src/claude/ImageTiles.tsx`:

```tsx
import { useState, type MouseEvent } from 'react'
import type { ClaudeImage } from '@shared/types'
import { PictureIcon } from '../icons'
import { imageCaption, imageCount, type ImageItem, itemImages, thumbSize, UNDECODABLE } from './images'
import { type Observe, useThumbnail } from './useThumbnail'

interface ImageTilesProps {
  item: ImageItem
  /** The item's row key: its images are `<rowKey>:<index>` to the viewer. */
  rowKey: number
  /** The folder the snapshot came from: thumbnails are asked for there. */
  folder: string
  /** Off: no thumbnails are made; a dim "▣ N images" opens the viewer instead. */
  show: boolean
  onOpen(key: string): void
  observe: Observe
}

/** Pressing one leaves the keyboard where it was: in the terminal. */
const keepFocus = (e: MouseEvent) => e.preventDefault()

/** An item's images: thumbnails in the order they came (at most 10, then "+N more"), or "▣ N images"
 *  while images are hidden. Each opens the viewer. */
export function ImageTiles({ item, rowKey, folder, show, onOpen, observe }: ImageTilesProps) {
  const images = itemImages(item)
  const total = imageCount(item)
  if (!total) return null
  if (!show) {
    return (
      <button className="fi-images-hidden" disabled={!images.length} onMouseDown={keepFocus} onClick={() => onOpen(`${rowKey}:0`)}
        title="Images are hidden: open this one in the viewer">
        <span aria-hidden="true">▣</span> {total} image{total === 1 ? '' : 's'}
      </button>
    )
  }
  return (
    <div className="fi-images">
      {images.map((image, i) => (
        <Thumb key={`${i}:${image.id}`} image={image} caption={imageCaption(image, item)} folder={folder} observe={observe}
          onOpen={() => onOpen(`${rowKey}:${i}`)} />
      ))}
      {item.moreImages ? <span className="fi-images-more">+{item.moreImages} more</span> : null}
    </div>
  )
}

function Thumb({ image, caption, folder, observe, onOpen }: { image: ClaudeImage; caption: string; folder: string; observe: Observe; onOpen(): void }) {
  const { ref, data } = useThumbnail(folder, image.id, observe)
  // The browser couldn't draw what main sent.
  const [broken, setBroken] = useState(false)
  const box = thumbSize(image)
  const error = broken ? UNDECODABLE : data && 'error' in data ? data.error : null
  const url = !error && data && 'url' in data ? data.url : null
  return (
    // Its box is set from the start (the snapshot carries the size), so the feed doesn't jump when
    // the picture arrives; CSS narrows it to the row.
    <button ref={ref} className={error ? 'fi-thumb failed' : 'fi-thumb'} draggable={false} aria-label={caption}
      title={error ?? caption} style={{ width: box.width, aspectRatio: `${box.width} / ${box.height}` }}
      onMouseDown={keepFocus} onClick={onOpen}>
      {url && <img src={url} alt="" draggable={false} onError={() => setBroken(true)} />}
      {error && <PictureIcon size={16} />}
    </button>
  )
}
```

- [ ] **Step 6: Styles**

In `src/renderer/src/claude/panel.css`:

Replace the first line's comment with:

```css
/* Claude panel: header, to-do, agents, feed (with markdown replies and images), session menu, image viewer. */
```

Replace:

```css
.cp-thinking[aria-pressed='true'] { color: var(--violet); }
.cp-thinking[aria-pressed='false']::after {
```

with:

```css
.cp-thinking[aria-pressed='true'] { color: var(--violet); }
.cp-images[aria-pressed='true'] { color: var(--teal); }
.cp-thinking[aria-pressed='false']::after, .cp-images[aria-pressed='false']::after {
```

Before `/* Clamped text with "more": the button sits on the last line, over a fade. */`, add:

```css
/* Images under a prompt's text or a tool's line (and its error): thumbnails in boxes sized from the
   start (ImageTiles sets width and aspect-ratio), narrowed to the row, never dragged or selected. */
.fi-images { display: flex; flex-wrap: wrap; align-items: flex-end; gap: 6px; min-width: 0; margin-top: 6px; user-select: none; }
.fi-tool .fi-images { grid-column: 2; margin: 3px 0 5px; }
.fi-thumb {
  position: relative;
  display: block;
  max-width: 100%;
  height: auto;
  padding: 0;
  overflow: hidden;
  border: 1px solid var(--line);
  border-radius: 4px;
  background: var(--field); /* shows through transparent parts */
  color: var(--faint);
}
.fi-thumb:hover { border-color: var(--line-strong); }
.fi-thumb img { position: absolute; inset: 0; width: 100%; height: 100%; object-fit: contain; }
.fi-thumb.failed { display: grid; place-items: center; opacity: 0.7; }
.fi-images-more { align-self: center; color: var(--faint); font-size: 11px; }
.fi-images-hidden {
  display: inline-flex;
  align-items: center;
  gap: 5px;
  height: 20px;
  margin-top: 5px;
  padding: 0 7px;
  border: 1px solid var(--line);
  border-radius: 4px;
  background: none;
  color: var(--faint);
  font-size: 11px;
  user-select: none;
}
.fi-tool .fi-images-hidden { grid-column: 2; justify-self: start; margin: 2px 0 4px; }
.fi-images-hidden:hover:not(:disabled) { border-color: var(--line-strong); color: var(--text); }

```

- [ ] **Step 7: Run it, and typecheck**

Run: `npx vitest run src/renderer/src/claude/useThumbnail.test.ts && npm run typecheck`
Expected: PASS (3 tests).

- [ ] **Step 8: Commit**

```bash
git add src/renderer/src/claude/useThumbnail.ts src/renderer/src/claude/useThumbnail.test.ts src/renderer/src/claude/ImageTiles.tsx src/renderer/src/icons.tsx src/renderer/src/claude/panel.css
git -c user.email=franco@effektstudios.com commit -m "Claude panel: thumbnails" -m "Claude-Session: https://claude.ai/code/session_012TidnBvRYbxhSYqPzFZuph"
```

---

### Task 16: The image viewer

**Files:**
- Create: `src/renderer/src/claude/ImageViewer.tsx`
- Modify: `src/renderer/src/claude/panel.css`

Over the whole window below the tab bar (so the tabs and the window's own buttons stay usable), on a
dark backdrop: the image as large as fits with 24 px around it, never past one image pixel per CSS
pixel, centred over a checkerboard. The caption line: what the image is, "3 of 12", Open and ×. ← and →
(or ‹ ›) step through the feed's images; Esc, × or a click on the backdrop closes it. Tab moves
between its buttons and stays inside; it takes only Esc, ←, →, Tab (and Enter or Space on a button),
so Deck's own shortcuts still work. The thumbnail, scaled up, stands in until the full image has
loaded; an image that can't be shown says why in its place. It renders into `<body>`; ClaudePanel owns
its state (Task 17).

- [ ] **Step 1: The component**

Create `src/renderer/src/claude/ImageViewer.tsx`:

```tsx
import { useEffect, useLayoutEffect, useRef, useState, type KeyboardEvent, type MouseEvent } from 'react'
import { createPortal } from 'react-dom'
import type { ClaudeImageData } from '@shared/types'
import { errorText } from '../git/format'
import { CloseIcon, PictureIcon } from '../icons'
import { COULD_NOT_LOAD, type FeedImage, isImageData, type Size, stepImage, UNDECODABLE, VIEWER_MARGIN, viewerSize } from './images'
import { thumbs } from './useThumbnail'

interface ImageViewerProps {
  /** The folder the snapshot came from: the image is asked for there. */
  folder: string
  /** The feed's images, oldest first: ← and → step through them. */
  list: FeedImage[]
  /** The one shown (kept even when its item has left the feed). */
  entry: FeedImage
  onStep(entry: FeedImage): void
  onClose(): void
}

/** Where the tab bar ends (styles.css: .tabbar is 36 px): the viewer covers the window below it, so
 *  the tabs and the window's own buttons stay usable. */
const tabBarBottom = () => document.querySelector('.tabbar')?.getBoundingClientRect().bottom ?? 36

/** Moves the keyboard to the next (or previous) enabled button inside `root`, round and round. */
function cycleFocus(root: HTMLElement | null, back: boolean): void {
  const buttons = root ? [...root.querySelectorAll<HTMLButtonElement>('button:not(:disabled)')] : []
  if (!buttons.length) return
  const at = buttons.indexOf(document.activeElement as HTMLButtonElement)
  const next = at < 0 ? (back ? buttons.length - 1 : 0) : (at + (back ? -1 : 1) + buttons.length) % buttons.length
  buttons[next].focus()
}

/** An image of the feed, large, over the window below the tab bar: as large as fits with 24 px around
 *  it and never past one image pixel per CSS pixel, over a checkerboard. Esc, ×, or a click on the
 *  backdrop closes it; ← and → step through the feed's images; Open shows a copy in the default image
 *  app. It takes only Esc, ←, → and Tab, so Deck's own shortcuts still work. Rendered into <body>. */
export function ImageViewer({ folder, list, entry, onStep, onClose }: ImageViewerProps) {
  const rootRef = useRef<HTMLDivElement>(null)
  const stageRef = useRef<HTMLDivElement>(null)
  const [top] = useState(tabBarBottom)
  const [area, setArea] = useState<Size>({ width: 0, height: 0 })
  const [full, setFull] = useState<{ id: string; data: ClaudeImageData } | null>(null)
  const [broken, setBroken] = useState<string | null>(null)
  const [opening, setOpening] = useState<{ id: string; busy: boolean; error: string | null } | null>(null)
  const { image } = entry
  const id = image.id

  useLayoutEffect(() => {
    rootRef.current?.focus()
  }, [])

  useLayoutEffect(() => {
    const stage = stageRef.current
    if (!stage) return
    const measure = () => setArea({ width: stage.clientWidth, height: stage.clientHeight })
    measure()
    const observer = new ResizeObserver(measure)
    observer.observe(stage)
    return () => observer.disconnect()
  }, [])

  // The full image, one at a time: stepping on drops an answer still on its way.
  useEffect(() => {
    let live = true
    window.deck.claude.image(folder, id, 'full').then(
      (data) => {
        if (live) setFull({ id, data: isImageData(data) ? data : { error: COULD_NOT_LOAD } })
      },
      (err: unknown) => {
        if (live) setFull({ id, data: { error: errorText(err) } })
      },
    )
    return () => {
      live = false
    }
  }, [folder, id])

  const shown = full?.id === id ? full.data : null
  const error = broken === id ? UNDECODABLE : shown && 'error' in shown ? shown.error : null
  const url = !error && shown && 'url' in shown ? shown.url : null
  // Until the full image is here, its thumbnail stands in, scaled up.
  const stand = !url && !error ? thumbs.peek(id) : undefined
  const box = viewerSize(image, area)
  const room = { maxWidth: Math.max(1, area.width - 2 * VIEWER_MARGIN), maxHeight: Math.max(1, area.height - 2 * VIEWER_MARGIN) }
  const at = list.findIndex((e) => e.key === entry.key)
  const prev = stepImage(list, entry.key, -1)
  const next = stepImage(list, entry.key, 1)
  const open = opening?.id === id ? opening : null

  const openCopy = () => {
    setOpening({ id, busy: true, error: null })
    window.deck.claude.openImage(folder, id).then(
      (r) => setOpening({ id, busy: false, error: r && typeof r.error === 'string' ? r.error : null }),
      (err: unknown) => setOpening({ id, busy: false, error: errorText(err) }),
    )
  }

  const onKeyDown = (e: KeyboardEvent<HTMLDivElement>) => {
    if (e.metaKey || e.ctrlKey || e.altKey) return // Deck's shortcuts (Ctrl+Tab is the next tab)
    if (e.key === 'Escape') onClose()
    else if (e.key === 'ArrowLeft') {
      if (prev) onStep(prev)
    } else if (e.key === 'ArrowRight') {
      if (next) onStep(next)
    } else if (e.key === 'Tab') cycleFocus(rootRef.current, e.shiftKey)
    else return
    e.preventDefault()
    e.stopPropagation()
  }

  const onBackdrop = (e: MouseEvent) => {
    if (e.target === e.currentTarget || e.target === stageRef.current) onClose()
  }

  return createPortal(
    <div className="iv" ref={rootRef} style={{ top }} role="dialog" aria-modal="true" aria-label={entry.caption} tabIndex={-1}
      onKeyDown={onKeyDown} onClick={onBackdrop}>
      <div className="iv-stage" ref={stageRef}>
        <div className={box ? 'iv-frame' : 'iv-frame auto'} style={box ?? undefined}>
          {url && <img src={url} alt={entry.caption} draggable={false} style={box ? undefined : room} onError={() => setBroken(id)} />}
          {stand && <img src={stand} alt="" draggable={false} style={box ? undefined : room} />}
          {error && (
            <span className="iv-error" role="status">
              <PictureIcon size={22} />
              {error}
            </span>
          )}
        </div>
        <button className="iv-step prev" aria-label="Previous image" title="Previous image (←)" disabled={!prev}
          onClick={() => prev && onStep(prev)}>‹</button>
        <button className="iv-step next" aria-label="Next image" title="Next image (→)" disabled={!next}
          onClick={() => next && onStep(next)}>›</button>
      </div>
      <div className="iv-bar">
        <span className="iv-caption" title={entry.caption}>{entry.caption}</span>
        {list.length > 1 && at >= 0 && <span className="iv-count">{at + 1} of {list.length}</span>}
        {open?.error && <span className="iv-open-error" role="alert" title={open.error}>{open.error}</span>}
        <button className="button iv-open" disabled={open?.busy === true} title="Open a copy in your image app" onClick={openCopy}>
          Open
        </button>
        <button className="icon-button" aria-label="Close" title="Close (Esc)" onClick={onClose}>
          <CloseIcon size={12} />
        </button>
      </div>
    </div>,
    document.body,
  )
}
```

- [ ] **Step 2: Styles**

In `src/renderer/src/claude/panel.css`, before `@media (prefers-reduced-motion: reduce) {`, add:

```css
/* ------------------------------------------------------------ image viewer */

/* Over the window below the tab bar (ImageViewer sets `top`), on a dark backdrop. */
.iv {
  position: fixed;
  left: 0;
  right: 0;
  bottom: 0;
  z-index: 70;
  display: flex;
  flex-direction: column;
  background: rgb(5 6 16 / 0.92);
  color: var(--text);
  font-size: 12px;
  outline: none;
  user-select: none;
}
.iv-stage { position: relative; flex: 1; min-height: 0; display: grid; place-items: center; overflow: hidden; }
/* The image's box, over a checkerboard so transparent parts can be seen. */
.iv-frame {
  position: relative;
  display: grid;
  place-items: center;
  background-color: #23264a;
  background-image: conic-gradient(#30345e 25%, transparent 0 50%, #30345e 0 75%, transparent 0);
  background-size: 16px 16px;
  box-shadow: 0 12px 44px rgb(0 0 0 / 0.55);
}
.iv-frame img { position: absolute; inset: 0; display: block; width: 100%; height: 100%; object-fit: contain; }
.iv-frame.auto img { position: static; width: auto; height: auto; }
.iv-frame.auto:has(.iv-error) { min-width: 240px; min-height: 160px; }
.iv-error { display: flex; flex-direction: column; align-items: center; gap: 8px; max-width: 100%; padding: 16px; color: var(--muted); text-align: center; }
.iv-step {
  position: absolute;
  top: 50%;
  width: 34px;
  height: 34px;
  margin-top: -17px;
  display: grid;
  place-items: center;
  padding: 0 0 3px;
  border: 1px solid var(--line-strong);
  border-radius: 50%;
  background: rgb(18 20 42 / 0.85);
  color: var(--text);
  font-size: 22px;
  line-height: 1;
}
.iv-step.prev { left: 12px; }
.iv-step.next { right: 12px; }
.iv-step:hover:not(:disabled) { background: var(--tab-active); color: var(--ink); }
.iv-step:disabled { opacity: 0.25; }
.iv-bar { flex: none; display: flex; align-items: center; gap: 10px; height: 42px; padding: 0 10px 0 16px; border-top: 1px solid var(--line); background: var(--chrome); }
.iv-caption { flex: 1; min-width: 0; overflow: hidden; text-overflow: ellipsis; white-space: nowrap; color: var(--text); user-select: text; }
.iv-count { flex: none; color: var(--muted); font-variant-numeric: tabular-nums; }
.iv-open-error { flex: 0 1 auto; min-width: 0; max-width: 40%; overflow: hidden; text-overflow: ellipsis; white-space: nowrap; color: var(--red); }
.iv-bar .button { height: 26px; }

```

- [ ] **Step 3: Typecheck**

Run: `npm run typecheck`
Expected: PASS.

- [ ] **Step 4: Commit**

```bash
git add src/renderer/src/claude/ImageViewer.tsx src/renderer/src/claude/panel.css
git -c user.email=franco@effektstudios.com commit -m "Claude panel: the image viewer" -m "Claude-Session: https://claude.ai/code/session_012TidnBvRYbxhSYqPzFZuph"
```

---

### Task 17: Images in the feed, the viewer and the header's switch

**Files:**
- Modify: `src/renderer/src/claude/Feed.tsx`
- Modify: `src/renderer/src/claude/ClaudePanel.tsx`
- Modify: `src/renderer/src/App.tsx`

Rows show their images; the feed makes one `NearView` and hands its folder, switch, observer and the
viewer's opener down through `FeedContext`. The rows' keys move up to `ClaudePanel`, which keys each
image `<row key>:<index>` for the viewer and owns the viewer's state: it closes when the tab leaves the
front or the panel shows another session, and gives the keyboard back where it was when it opened (the
terminal after a click, the thumbnail after Enter; the terminal when that's gone). The header gets a
picture button beside ✻; App keeps its flag (`deck.claudeImages`) so it hides images in every tab.

- [ ] **Step 1: The feed**

In `src/renderer/src/claude/Feed.tsx`:

Replace the imports and everything down to `const FeedContext = …`:

```tsx
import { createContext, memo, useCallback, useContext, useEffect, useLayoutEffect, useMemo, useRef, useState, type KeyboardEvent, type ReactNode } from 'react'
import type { ClaudeFeedItem } from '@shared/types'
import { feedKeys, NO_KEYS, sameItem, toolKind, toolLabel, type ToolKind } from './feedItems'
import { MarkdownView } from './MarkdownView'

interface FeedProps {
  /** Oldest first. */
  items: ClaudeFeedItem[]
  showThinking: boolean
  /** A turn is open: running tools pulse. (One a killed Claude left running doesn't.) */
  live: boolean
}

/** This close to the end counts as at the end (px). */
const AT_END = 24

const FeedContext = createContext<{ pause(): void }>({ pause: () => {} })
```

with:

```tsx
import { createContext, memo, useCallback, useContext, useEffect, useLayoutEffect, useMemo, useRef, useState, type KeyboardEvent, type ReactNode } from 'react'
import type { ClaudeFeedItem } from '@shared/types'
import { sameItem, toolKind, toolLabel, type ToolKind } from './feedItems'
import { ImageTiles } from './ImageTiles'
import { MarkdownView } from './MarkdownView'
import { NearView, type Observe } from './useThumbnail'

interface FeedProps {
  /** Oldest first. */
  items: ClaudeFeedItem[]
  /** Each item's React key, kept from snapshot to snapshot (feedKeys). */
  keys: number[]
  showThinking: boolean
  /** A turn is open: running tools pulse. (One a killed Claude left running doesn't.) */
  live: boolean
  /** The folder the snapshot came from: its images are asked for there. */
  folder: string
  /** Thumbnails, or "▣ N images" while they're hidden. */
  showImages: boolean
  /** Opens the viewer on image `<row key>:<index>`. */
  onOpenImage(key: string): void
}

/** This close to the end counts as at the end (px). */
const AT_END = 24

interface FeedContextValue {
  pause(): void
  folder: string
  showImages: boolean
  openImage(key: string): void
  observe: Observe
}

const FeedContext = createContext<FeedContextValue>({
  pause: () => {},
  folder: '',
  showImages: true,
  openImage: () => {},
  observe: () => () => {},
})
```

Replace the start of `Feed()`:

```tsx
export function Feed({ items, showThinking, live }: FeedProps) {
  const scrollRef = useRef<HTMLDivElement>(null)
  const contentRef = useRef<HTMLDivElement>(null)
  const keysRef = useRef(NO_KEYS)
  const keys = useMemo(() => (keysRef.current = feedKeys(keysRef.current, items)).keys, [items])
```

with:

```tsx
export function Feed({ items, keys, showThinking, live, folder, showImages, onOpenImage }: FeedProps) {
  const scrollRef = useRef<HTMLDivElement>(null)
  const contentRef = useRef<HTMLDivElement>(null)
```

Replace:

```tsx
  const context = useMemo(() => ({ pause }), [pause])
```

with:

```tsx
  // Thumbnails ask for their pixels when they come near view: one observer for the feed, made once
  // the scroller is there (a child's effect runs after the refs are set).
  const nearRef = useRef<NearView | null>(null)
  const observe = useCallback<Observe>((el, near) => {
    const root = scrollRef.current
    if (!root) return () => {}
    nearRef.current ??= new NearView(root)
    return nearRef.current.watch(el, near)
  }, [])
  useEffect(() => () => {
    nearRef.current?.dispose()
    nearRef.current = null
  }, [])
  const context = useMemo(() => ({ pause, folder, showImages, openImage: onOpenImage, observe }), [pause, folder, showImages, onOpenImage, observe])
```

Replace:

```tsx
    if (showThinking || items[i].kind !== 'thinking') rows.push(<Row key={keys[i]} item={items[i]} />)
```

with:

```tsx
    if (showThinking || items[i].kind !== 'thinking') rows.push(<Row key={keys[i]} rowKey={keys[i]} item={items[i]} />)
```

Replace the start of `Row`:

```tsx
const Row = memo(function Row({ item }: { item: ClaudeFeedItem }) {
  switch (item.kind) {
    case 'prompt':
      return (
        <div className={item.text.startsWith('! ') ? 'fi-prompt shell' : 'fi-prompt'}>
          <Clamp lines={8}>{item.text}</Clamp>
        </div>
      )
```

with:

```tsx
const Row = memo(function Row({ item, rowKey }: { item: ClaudeFeedItem; rowKey: number }) {
  switch (item.kind) {
    case 'prompt':
      return (
        <div className={item.text.startsWith('! ') ? 'fi-prompt shell' : 'fi-prompt'}>
          {/* A prompt that is only images shows just them, not "[image]". */}
          {!(item.text === '[image]' && item.images?.length) && <Clamp lines={8}>{item.text}</Clamp>}
          <Images item={item} rowKey={rowKey} />
        </div>
      )
```

Replace `      return <Tool item={item} />` with:

```tsx
      return <Tool item={item} rowKey={rowKey} />
```

Replace:

```tsx
}, (a, b) => sameItem(a.item, b.item))

function Tool({ item }: { item: Extract<ClaudeFeedItem, { kind: 'tool' }> }) {
```

with:

```tsx
}, (a, b) => a.rowKey === b.rowKey && sameItem(a.item, b.item))

/** The item's thumbnails, with the feed's folder, switch and viewer. */
function Images({ item, rowKey }: { item: Extract<ClaudeFeedItem, { kind: 'prompt' | 'tool' }>; rowKey: number }) {
  const { folder, showImages, openImage, observe } = useContext(FeedContext)
  return <ImageTiles item={item} rowKey={rowKey} folder={folder} show={showImages} onOpen={openImage} observe={observe} />
}

function Tool({ item, rowKey }: { item: Extract<ClaudeFeedItem, { kind: 'tool' }>; rowKey: number }) {
```

and at the end of `Tool`'s markup, replace:

```tsx
      {item.state === 'error' && item.error && <span className="fi-tool-error">{item.error}</span>}
    </div>
```

with:

```tsx
      {item.state === 'error' && item.error && <span className="fi-tool-error">{item.error}</span>}
      <Images item={item} rowKey={rowKey} />
    </div>
```

- [ ] **Step 2: The panel**

In `src/renderer/src/claude/ClaudePanel.tsx`:

Replace the imports' first lines:

```tsx
import { Component, memo, useCallback, useEffect, useLayoutEffect, useRef, useState, type ErrorInfo, type MouseEvent, type ReactNode } from 'react'
import type { ClaudeAgent, ClaudeSnapshot, ClaudeStatus, ClaudeTodo } from '@shared/types'
import { baseName, displayPath } from '../git/format'
import { useStoredFlag, useTick } from '../hooks'
import { Caret } from '../icons'
import { Feed } from './Feed'
```

with:

```tsx
import { Component, memo, useCallback, useEffect, useLayoutEffect, useMemo, useRef, useState, type ErrorInfo, type MouseEvent, type ReactNode } from 'react'
import type { ClaudeAgent, ClaudeFeedItem, ClaudeSnapshot, ClaudeStatus, ClaudeTodo } from '@shared/types'
import { baseName, displayPath } from '../git/format'
import { useStoredFlag, useTick } from '../hooks'
import { Caret, PictureIcon } from '../icons'
import { Feed } from './Feed'
import { feedKeys, NO_KEYS } from './feedItems'
import { type FeedImage, feedImages } from './images'
import { ImageViewer } from './ImageViewer'
```

In `ClaudePanelProps`, after `folder: string` add:

```tsx
  /** The folder `snapshot` came from (useClaudeSession's): its images are asked for there. */
  imageFolder: string
```

and after `onRetry(): void` add:

```tsx
  /** Images show in the feed (one switch for every tab, App's). */
  showImages: boolean
  onImagesToggle(): void
```

After the `LIVE` constant, add:

```tsx
const NO_FEED: ClaudeFeedItem[] = []
const NO_IMAGES: FeedImage[] = []

/** The image the viewer shows, where the keyboard was when it opened, and the session it's of. */
interface Viewing {
  entry: FeedImage
  restore: Element | null
  session: string
}
```

Replace the start of `PanelBody`:

```tsx
function PanelBody({ folder, snapshot, phase, error, claudeRuns, active, home, onRetry }: ClaudePanelProps) {
  const platform = window.deck.platform
  const [showThinking, toggleThinking] = useStoredFlag(THINKING_KEY, true)
  const [menuAnchor, setMenuAnchor] = useState<HTMLElement | null>(null)
```

with:

```tsx
function PanelBody(props: ClaudePanelProps) {
  const { folder, imageFolder, snapshot, phase, error, claudeRuns, active, home, onRetry, showImages, onImagesToggle } = props
  const platform = window.deck.platform
  const [showThinking, toggleThinking] = useStoredFlag(THINKING_KEY, true)
  const [menuAnchor, setMenuAnchor] = useState<HTMLElement | null>(null)
  const panelRef = useRef<HTMLDivElement>(null)

  // The rows' keys, kept from snapshot to snapshot: the feed's, and the viewer's way to an image.
  const keysRef = useRef(NO_KEYS)
  const feed = snapshot?.feed ?? NO_FEED
  const keys = useMemo(() => (keysRef.current = feedKeys(keysRef.current, feed)).keys, [feed])
  const images = useMemo(() => (feed.length ? feedImages(feed, keys) : NO_IMAGES), [feed, keys])
  const sessionId = snapshot?.session.id ?? ''

  const [viewing, setViewing] = useState<Viewing | null>(null)
  const latest = useRef({ images, sessionId, viewing })
  useLayoutEffect(() => {
    latest.current = { images, sessionId, viewing }
  })
  const openImage = useCallback((key: string) => {
    const entry = latest.current.images.find((e) => e.key === key)
    if (entry) setViewing({ entry, restore: document.activeElement, session: latest.current.sessionId })
  }, [])
  /** Closes the viewer and gives the keyboard back where it was when it opened (the terminal after a
   *  click, the thumbnail after Enter), or to the terminal when that's gone. */
  const closeViewer = useCallback(() => {
    const restore = latest.current.viewing?.restore
    setViewing(null)
    if (restore instanceof HTMLElement && restore !== document.body && restore.isConnected) restore.focus()
    else panelRef.current?.closest('.workspace')?.querySelector<HTMLElement>('.xterm-helper-textarea')?.focus()
  }, [])
  // It lives in <body>: it goes when the tab leaves the front (the keyboard goes with the tab), or the
  // panel shows another session.
  useEffect(() => {
    if (!viewing) return
    if (!active) setViewing(null)
    else if (viewing.session !== sessionId) closeViewer()
  }, [active, sessionId, viewing, closeViewer])
```

Both `<div className="claude-panel">` that `PanelBody` returns (the one without a snapshot and the one
with) become:

```tsx
      <div className="claude-panel" ref={panelRef}>
```

(indented as they were; `Boundary`'s own `claude-panel` stays as it is).

In the header row, replace:

```tsx
          <span className="cp-spacer" />
          <button className="cp-icon-button cp-thinking" aria-pressed={showThinking}
```

with:

```tsx
          <span className="cp-spacer" />
          {/* Hides images in every tab, e.g. before sharing the screen. */}
          <button className="cp-icon-button cp-images" aria-pressed={showImages}
            title={showImages ? 'Hide images (in every tab)' : 'Show images'} aria-label="Show images" onClick={onImagesToggle}>
            <PictureIcon size={13} />
          </button>
          <button className="cp-icon-button cp-thinking" aria-pressed={showThinking}
```

Replace:

```tsx
      <Feed key={session.id} items={snapshot.feed} showThinking={showThinking} live={LIVE.has(status.state)} />
      {menuAnchor && (
        <SessionPicker folder={folder} current={session.id} following={snapshot.following} anchor={menuAnchor} onClose={closeMenu} />
      )}
```

with:

```tsx
      <Feed key={session.id} items={snapshot.feed} keys={keys} showThinking={showThinking} live={LIVE.has(status.state)}
        folder={imageFolder} showImages={showImages} onOpenImage={openImage} />
      {menuAnchor && (
        <SessionPicker folder={folder} current={session.id} following={snapshot.following} anchor={menuAnchor} onClose={closeMenu} />
      )}
      {viewing && active && viewing.session === session.id && (
        <ImageViewer folder={imageFolder} list={images} entry={viewing.entry}
          onStep={(entry) => setViewing((v) => (v ? { ...v, entry } : v))} onClose={closeViewer} />
      )}
```

- [ ] **Step 3: One switch for every tab**

In `src/renderer/src/App.tsx`:

After `const USAGE_OPEN_KEY = 'deck.usageOpen'` add:

```tsx
/** The Claude panel's images, shown or hidden in every tab at once (e.g. before sharing the screen). */
const CLAUDE_IMAGES_KEY = 'deck.claudeImages'
```

After `const [usageOpen, toggleUsage] = useStoredFlag(USAGE_OPEN_KEY, true)` add:

```tsx
  const [showImages, toggleImages] = useStoredFlag(CLAUDE_IMAGES_KEY, true)
```

In the `<Workspace …>` element, replace `usageOpen={usageOpen} onUsageToggle={toggleUsage}` with:

```tsx
usageOpen={usageOpen} onUsageToggle={toggleUsage} showImages={showImages} onImagesToggle={toggleImages}
```

In `WorkspaceProps`, after `onUsageToggle(): void` add:

```tsx
  /** The Claude panel shows images (one flag for the window). */
  showImages: boolean
  onImagesToggle(): void
```

In `Workspace`, replace:

```tsx
  const { usage, usageOpen, onUsageToggle, onGitWidth, onClaudeWidth, onUpdate, onClose } = props
```

with:

```tsx
  const { usage, usageOpen, onUsageToggle, showImages, onImagesToggle, onGitWidth, onClaudeWidth, onUpdate, onClose } = props
```

and replace the `ClaudePanel` element:

```tsx
            <ClaudePanel folder={folder} snapshot={claude.snapshot} phase={claude.phase} error={claude.error}
              claudeRuns={claudeRuns} active={active} home={home} onRetry={claude.retry} />
```

with:

```tsx
            <ClaudePanel folder={folder} imageFolder={claude.folder} snapshot={claude.snapshot} phase={claude.phase} error={claude.error}
              claudeRuns={claudeRuns} active={active} home={home} onRetry={claude.retry}
              showImages={showImages} onImagesToggle={onImagesToggle} />
```

- [ ] **Step 4: Run everything**

Run: `npm test && npm run typecheck && npm run build`
Expected: all PASS; the build writes `out/`.

- [ ] **Step 5: Commit**

```bash
git add src/renderer/src/claude/Feed.tsx src/renderer/src/claude/ClaudePanel.tsx src/renderer/src/App.tsx
git -c user.email=franco@effektstudios.com commit -m "Claude panel: images in the feed, the viewer and the header's switch" -m "Claude-Session: https://claude.ai/code/session_012TidnBvRYbxhSYqPzFZuph"
```

---
### Task 18: In the app, with a crafted log

**Files:**
- Create (outside the repo, never committed): `$TMPDIR/deck-images-check/make-log.ts`,
  `$TMPDIR/deck-images-check/cdp.mjs`
- Modify: whatever the checks show is wrong, each fix with a test where one can be written

A dev build with its own user data, a temp `CLAUDE_CONFIG_DIR` holding a session log made here with
synthetic images, and the DevTools protocol (`--remoteDebuggingPort 9333`, and `--inspect 9229` for
main), as CLAUDE.md's "Checking the running app" describes. Never Franco's real logs, and no prompt goes
to Claude: nothing here starts `claude`. The JPEGs are real ones made with macOS's `sips` (macOS only).
Screenshots stay in `$TMPDIR/deck-images-check` and are deleted at the end.

- [ ] **Step 1: The log builder**

```bash
L="$TMPDIR/deck-images-check" && rm -rf "$L" && mkdir -p "$L/home/projects" "$L/app"
cat > "$L/make-log.ts" <<'EOF'
// Writes a crafted Claude Code session log with synthetic images, for checking the Claude panel's
// images in a dev build: never a real log, and nothing is sent to Claude.
// Run: node_modules/.bin/jiti make-log.ts <worktree> <claude home> <project folder> [start|append|many|many2…]
import { execFileSync } from 'node:child_process'
import { mkdtempSync, readFileSync, realpathSync, writeFileSync } from 'node:fs'
import { tmpdir } from 'node:os'
import { join } from 'node:path'

const [worktree, home, folderArg, mode = 'start'] = process.argv.slice(2)
const log = await import(join(worktree, 'src', 'main', 'claude', 'test-log.ts'))
const folder = realpathSync(folderArg) // Claude logs under the real path of its cwd
const SESSION = '5f0c2a8e-3b1d-4c6e-9a7f-1e2d3c4b5a69'
const writer = log.sessionLog(home, folder, SESSION)

/** A real JPEG (macOS's sips encodes it), from one of test-log's PNGs. */
function jpeg(width: number, height: number): Buffer {
  const dir = mkdtempSync(join(tmpdir(), 'deck-jpeg-'))
  writeFileSync(join(dir, 'in.png'), log.pngBytes(width, height))
  execFileSync('sips', ['-s', 'format', 'jpeg', '-s', 'formatOptions', '85', join(dir, 'in.png'), '--out', join(dir, 'out.jpg')], { stdio: 'ignore' })
  return readFileSync(join(dir, 'out.jpg'))
}

if (mode === 'start') {
  writer.permissionMode('default').aiTitle('Images check')
    .prompt('Here are two screenshots', { images: [log.pngBytes(1440, 900), log.pngBytes(1080, 2340)], pasteIds: [1, 2] })
    .thinking('').reply('Let me look at the files too.', { stopReason: 'tool_use' })
    .readImage('t1', join(folder, 'docs', 'diagram.png'), log.pngBytes(600, 400, { alpha: true }))
    .readImage('t2', join(folder, 'photo.jpg'), jpeg(1600, 1200), 'image/jpeg')
    .toolUse('t3', 'mcp__claude-in-chrome__computer', { action: 'screenshot' })
    .toolResult('t3', { content: [{ type: 'text', text: 'Took a screenshot' }, log.imageBlock(jpeg(1280, 800), 'image/jpeg')] })
    .toolUse('t4', 'AskUserQuestion', { questions: [{ question: 'Which layout?' }] })
    .userBlocks([{ type: 'tool_result', tool_use_id: 't4', content: 'User answered: like this one' }, log.imageBlock(log.pngBytes(320, 240))], { imagePasteIds: [3] })
    .readImage('t5', join(folder, 'broken.jpg'), log.jpegBytes(900, 700), 'image/jpeg')
    .reply('Done looking.')
    .prompt('', { images: [log.pngBytes(64, 64, { alpha: true })], pasteIds: [4] })
    .reply('A small icon.')
} else if (mode === 'append') {
  writer.prompt('One more').readImage('t6', join(folder, 'later.png'), log.pngBytes(800, 500)).reply('Got it.')
} else if (mode.startsWith('many')) {
  // many, many2, many3…: 120 more image reads, each batch with images of its own (other sizes)
  const batch = Number(mode.slice(4) || 1)
  writer.prompt(`Read every icon (${batch})`)
  for (let i = 0; i < 120; i++) writer.readImage(`m${batch}-${i}`, join(folder, 'icons', `icon-${batch}-${i}.png`), log.pngBytes(500 + i, 380 + batch))
  writer.reply('Read them all.')
}
console.log(`${mode}: written`)
EOF
```

- [ ] **Step 2: A way to look inside**

```bash
cat > "$TMPDIR/deck-images-check/cdp.mjs" <<'EOF'
// node cdp.mjs '<expression>'          evaluates in Deck's page (port 9333) and prints the value
// node cdp.mjs --shot <file.png>       saves a screenshot of the page
// node cdp.mjs --key <key>             presses a key (Escape, ArrowRight, ArrowLeft, Tab, Enter) in the page
// node cdp.mjs --main '<expression>'   evaluates in the main process (--inspect 9229)
import { writeFileSync } from 'node:fs'

const [first, second] = process.argv.slice(2)
const main = first === '--main'
const port = main ? 9229 : 9333
const targets = await (await fetch(`http://127.0.0.1:${port}/json`)).json()
const target = main ? targets[0] : targets.find((p) => p.type === 'page' && !p.url.startsWith('devtools'))
const ws = new WebSocket(target.webSocketDebuggerUrl)
await new Promise((resolve) => ws.addEventListener('open', resolve))
let next = 0
const call = (method, params) => new Promise((resolve) => {
  const id = ++next
  const onMessage = (e) => {
    const message = JSON.parse(e.data)
    if (message.id !== id) return
    ws.removeEventListener('message', onMessage)
    resolve(message)
  }
  ws.addEventListener('message', onMessage)
  ws.send(JSON.stringify({ id, method, params }))
})
const KEYS = { Escape: 27, ArrowLeft: 37, ArrowRight: 39, Tab: 9, Enter: 13 }
if (first === '--shot') {
  const { result } = await call('Page.captureScreenshot', { format: 'png' })
  writeFileSync(second, Buffer.from(result.data, 'base64'))
  console.log(second)
} else if (first === '--key') {
  // Enter needs its character too, or a focused button isn't pressed.
  const text = second === 'Enter' ? '\r' : undefined
  await call('Input.dispatchKeyEvent', { type: 'keyDown', key: second, code: second, windowsVirtualKeyCode: KEYS[second], ...(text ? { text } : {}) })
  await call('Input.dispatchKeyEvent', { type: 'keyUp', key: second, code: second, windowsVirtualKeyCode: KEYS[second] })
  console.log(`pressed ${second}`)
} else {
  const expression = main ? second : first
  const reply = await call('Runtime.evaluate', { expression, awaitPromise: true, returnByValue: true, includeCommandLineAPI: true })
  console.log(JSON.stringify(reply.result?.result?.value ?? reply.result))
}
ws.close()
EOF
```

- [ ] **Step 3: Write the log and start the dev build on its own data**

```bash
W=~/.config/superpowers/worktrees/deck/m5-claude-images; L="$TMPDIR/deck-images-check"
cd "$W" && ./node_modules/.bin/jiti "$L/make-log.ts" "$W" "$L/home" "$L/app" start
lsof -nP -iTCP:9333 -sTCP:LISTEN; lsof -nP -iTCP:9229 -sTCP:LISTEN
```

Expected: `start: written`, and `lsof` prints nothing (exit status 1): neither port is in use (else
quit what holds it). Then start the dev build in the background:

```bash
W=~/.config/superpowers/worktrees/deck/m5-claude-images; L="$TMPDIR/deck-images-check"
cd "$W" && CLAUDE_CONFIG_DIR="$L/home" npx electron-vite dev --remoteDebuggingPort 9333 --inspect 9229 -- --user-data-dir="$L/user-data" --open "$L/app" > "$L/dev.log" 2>&1
```

and wait until `curl -s http://127.0.0.1:9333/json` answers. The window opens on a tab in `app` with
the Claude panel showing "Images check". The `--user-data-dir` keeps it apart from Franco's installed
Deck. Each command block below starts with `C="node $TMPDIR/deck-images-check/cdp.mjs"`, so it runs
from any folder.

- [ ] **Step 4: Thumbnails under prompts and tools, with no jump**

```bash
C="node $TMPDIR/deck-images-check/cdp.mjs"
$C "(() => { const ws = document.querySelector('.workspace:not(.is-hidden)'); const p = ws.querySelector('.claude-panel'); return { title: p.querySelector('.cp-title')?.textContent, thumbs: ws.querySelectorAll('.fi-thumb').length, failed: [...ws.querySelectorAll('.fi-thumb.failed')].map((b) => b.title), prompts: [...ws.querySelectorAll('.fi-prompt')].map((p) => p.textContent) } })()"
$C "(() => { const feed = document.querySelector('.workspace:not(.is-hidden) .feed'); window.before = feed.scrollHeight; feed.scrollTop = 0; return window.before })()"
sleep 2
$C "(() => { const ws = document.querySelector('.workspace:not(.is-hidden)'); return { sameHeight: ws.querySelector('.feed').scrollHeight === window.before, thumbs: [...ws.querySelectorAll('.fi-thumb')].map((b) => { const r = b.getBoundingClientRect(); const img = b.querySelector('img'); return [b.title.slice(0, 22), Math.round(r.width), Math.round(r.height), img ? img.naturalWidth + 'x' + img.naturalHeight : 'none'] }) } })()"
$C --shot "$TMPDIR/deck-images-check/top.png"
```

Expected:
- `title` "Images check", 8 thumbnails, `failed` `["Couldn't decode this image"]` (broken.jpg is a
  header with no picture), and the prompts `["Here are two screenshots", ""]` (the image-only prompt
  shows no "[image]").
- After scrolling to the top: `sameHeight: true`, and the boxes (at the default 380 px pane) with
  their thumbnails: Image #1 240×150 (480x300), Image #2 83×180 (166x360), diagram.png 240×160
  (480x320), photo.jpg 240×180 (480x360), the browser screenshot 240×150 (480x300), the
  AskUserQuestion answer 240×180 (320x240), broken.jpg 231×180 (none), Image #4 64×64 (64x64).
- `top.png`: the two pasted images inside the prompt's teal block, diagram.png's see-through half
  showing the field colour, the picture button teal beside ✻.

- [ ] **Step 5: The viewer**

```bash
C="node $TMPDIR/deck-images-check/cdp.mjs"
$C "document.activeElement?.className"
$C "document.querySelector('.workspace:not(.is-hidden) .fi-thumb').click()"
sleep 1
$C "(() => { const v = document.querySelector('.iv'); const img = v.querySelector('.iv-frame img'); return { top: v.style.top, focused: document.activeElement === v, caption: v.querySelector('.iv-caption').textContent, count: v.querySelector('.iv-count')?.textContent, natural: img && [img.naturalWidth, img.naturalHeight], prevDisabled: v.querySelector('.iv-step.prev').disabled } })()"
$C --shot "$TMPDIR/deck-images-check/viewer.png"
S="(() => { const v = document.querySelector('.iv'); if (!v) return { open: false, focus: document.activeElement?.className }; const img = v.querySelector('.iv-frame img'); return { count: v.querySelector('.iv-count')?.textContent, error: v.querySelector('.iv-error')?.textContent ?? null, img: img && [img.naturalWidth, img.naturalHeight] } })()"
$C --key ArrowRight; sleep 0.5; $C "$S"
for i in 1 2 3 4 5; do $C --key ArrowRight; done; sleep 0.8; $C "$S"
$C --key ArrowRight; $C --key ArrowRight; sleep 0.5; $C "$S"
$C --key Escape; sleep 0.3; $C "$S"
```

Expected: `xterm-helper-textarea` first. Then `top` "36px", `focused` true, caption
`Image #1 · 1440 × 900 · PNG · …`, count `1 of 8`, natural `[1440, 900]`, `prevDisabled` true;
`viewer.png` shows the gradient fitted below the tab bar with the caption line, `1 of 8`, Open and ×.
Stepping: `2 of 8` with `[1080, 2340]`; `7 of 8` with error "Couldn't decode this image"; `8 of 8`
(another → stays at 8); after Esc `{ open: false, focus: "xterm-helper-textarea" }`.

```bash
C="node $TMPDIR/deck-images-check/cdp.mjs"
$C "(() => { const t = document.querySelectorAll('.workspace:not(.is-hidden) .fi-thumb')[2]; t.focus(); return document.activeElement === t })()"
$C --key Enter; sleep 0.5
$C "document.querySelector('.iv .iv-caption')?.textContent"
$C --key Tab; $C "document.activeElement?.getAttribute('aria-label')"
for i in 1 2 3 4; do $C --key Tab; done; $C "document.activeElement?.getAttribute('aria-label')"
$C --key Escape; sleep 0.3
$C "document.activeElement?.title?.slice(0, 30)"
$C "document.querySelectorAll('.workspace:not(.is-hidden) .fi-thumb')[0].click()"; sleep 0.4
$C "document.querySelector('.iv .iv-stage').dispatchEvent(new MouseEvent('click', { bubbles: true }))"; sleep 0.3
$C "Boolean(document.querySelector('.iv'))"
```

Expected: `true`; Enter opens `Read · docs/diagram.png · …`; Tab lands on "Previous image", and four
more Tabs come back round to it (‹, ›, Open, ×: the keyboard stays inside); Esc gives the keyboard back
to the diagram's thumbnail (`Read · docs/diagram.png · 600`); a click on the backdrop closes the viewer
(`false`).

- [ ] **Step 6: Open, without starting Preview**

`shell.openPath` is swapped in main for one that records the path (the handler calls it at click time),
so the check opens nothing on the Mac:

```bash
C="node $TMPDIR/deck-images-check/cdp.mjs"
$C --main "(() => { const { shell } = process.mainModule.require('electron'); globalThis.opened = []; shell.openPath = async (p) => { globalThis.opened.push(p); return '' }; return 'swapped' })()"
$C "document.querySelectorAll('.workspace:not(.is-hidden) .fi-thumb')[3].click()"; sleep 0.5
$C "document.querySelector('.iv .iv-open').click()"; sleep 0.8
$C "document.querySelector('.iv .iv-open-error')?.textContent ?? 'no error'"
F=$($C --main "globalThis.opened[0]" | tr -d '"'); echo "$F" | tee "$TMPDIR/deck-images-check/opened-path"
stat -f '%Lp %N' "$(dirname "$F")" "$F"; sips -g format -g pixelWidth "$F" | tail -2
$C "document.querySelector('.iv [aria-label=Close]').click()"
```

Expected: `no error`; the path ends in `Deck clipboard/<8 hex>/image-<16 hex>.jpg`; modes `700` (the
folder) and `600` (the file); `format: jpeg`, `pixelWidth: 1600`. The path is kept in `opened-path` for
Step 10.

- [ ] **Step 7: Hiding images**

```bash
C="node $TMPDIR/deck-images-check/cdp.mjs"
$C "document.querySelector('.workspace:not(.is-hidden) .cp-images').click()"; sleep 0.3
$C "(() => { const ws = document.querySelector('.workspace:not(.is-hidden)'); return { pressed: ws.querySelector('.cp-images').getAttribute('aria-pressed'), stored: localStorage.getItem('deck.claudeImages'), thumbs: ws.querySelectorAll('.fi-thumb').length, hidden: [...ws.querySelectorAll('.fi-images-hidden')].map((b) => b.textContent) } })()"
$C "document.querySelector('.workspace:not(.is-hidden) .fi-images-hidden').click()"; sleep 0.4
$C "document.querySelector('.iv .iv-caption')?.textContent"
$C --key Escape
$C "document.querySelector('.workspace:not(.is-hidden) .cp-images').click()"
```

Expected: `pressed` "false", `stored` "0", no thumbnails, `hidden` `["▣ 2 images", "▣ 1 image", …]`
(seven); "▣ 2 images" opens the viewer on `Image #1 · …`; the last click shows the thumbnails again.

- [ ] **Step 8: Lines appended while the panel shows the session, and a tab switch**

```bash
W=~/.config/superpowers/worktrees/deck/m5-claude-images; L="$TMPDIR/deck-images-check"; C="node $L/cdp.mjs"
(cd "$W" && ./node_modules/.bin/jiti "$L/make-log.ts" "$W" "$L/home" "$L/app" append)
sleep 2.5
$C "(() => { const t = [...document.querySelectorAll('.workspace:not(.is-hidden) .fi-thumb')]; return { thumbs: t.length, last: t.at(-1)?.title, loaded: Boolean(t.at(-1)?.querySelector('img')) } })()"
$C "document.querySelectorAll('.workspace:not(.is-hidden) .fi-thumb')[1].click()"; sleep 0.3
$C "[...document.querySelectorAll('.tabbar .tab')].find((t) => t.textContent.includes('Projects')).click()"; sleep 0.4
$C "Boolean(document.querySelector('.iv'))"
$C "[...document.querySelectorAll('.tabbar .tab')].find((t) => t.textContent.includes('app')).click()"
```

Expected: 9 thumbnails, the last
`Read · later.png · 800 × 500 · PNG · …` and loaded; the viewer closes when the Projects tab comes to
the front (`false`).

- [ ] **Step 9: A long session, scrolled from end to start**

```bash
W=~/.config/superpowers/worktrees/deck/m5-claude-images; L="$TMPDIR/deck-images-check"; C="node $L/cdp.mjs"
(cd "$W" && ./node_modules/.bin/jiti "$L/make-log.ts" "$W" "$L/home" "$L/app" many)
sleep 3
$C "(() => { const t = [...document.querySelectorAll('.workspace:not(.is-hidden) .fi-thumb')]; return { thumbs: t.length, loaded: t.filter((b) => b.querySelector('img')).length } })()"
$C --main "(() => { globalThis.cpu0 = process.cpuUsage(); globalThis.t0 = Date.now(); return 'start' })()"
$C "(async () => { const ws = document.querySelector('.workspace:not(.is-hidden)'); const feed = ws.querySelector('.feed'); feed.scrollTop = feed.scrollHeight; await new Promise((r) => setTimeout(r, 400)); while (feed.scrollTop > 0) { feed.scrollTop = Math.max(0, feed.scrollTop - feed.clientHeight); await new Promise((r) => setTimeout(r, 250)) } await new Promise((r) => setTimeout(r, 2500)); const t = [...ws.querySelectorAll('.fi-thumb')]; return { thumbs: t.length, loaded: t.filter((b) => b.querySelector('img')).length, heapMB: Math.round(performance.memory.usedJSHeapSize / 1e6) } })()"
$C --main "(() => { const u = process.cpuUsage(globalThis.cpu0); const s = (Date.now() - globalThis.t0) / 1000; const m = process.mainModule.require('electron').app.getAppMetrics(); return { seconds: s, mainCpuMs: Math.round((u.user + u.system) / 1000), share: ((u.user + u.system) / 1e6 / s * 100).toFixed(1) + '%', memoryMB: m.map((p) => [p.type, Math.round(p.memory.workingSetSize / 1024)]) } })()"
```

Expected: 129 thumbnails with only those near the end loaded at first (14–15 at a 900 px window);
after the scroll every one but broken.jpg is loaded (128). Main's CPU: a few milliseconds per
thumbnail made (423–793 ms for the 120 in two runs on 2026-11-11, 3.1–3.2% of a core over the scroll);
the renderer (`Tab`) about 200 MB. Write the numbers down for Task 19. Far more than that on main
means a decode outside the queue, or one made twice.

- [ ] **Step 10: Quitting removes Open's copy**

```bash
C="node $TMPDIR/deck-images-check/cdp.mjs"; F=$(cat "$TMPDIR/deck-images-check/opened-path")
ls -la "$F"
$C --main "(() => { setTimeout(() => process.mainModule.require('electron').app.quit(), 100); return 'quitting' })()"
sleep 3
ls "$F" 2>&1 | tail -1; ls "$(dirname "$F")" 2>&1 | tail -1
```

Expected: the file before; after quitting, `No such file or directory` for both the file and its folder
(other folders beside it belong to other Deck instances: leave them).

- [ ] **Step 11: Fix what broke**

For each check that failed, use superpowers:systematic-debugging, fix the module at fault (with a test
where the fault can be reproduced in one), run `npm test && npm run typecheck`, and commit:

```bash
git -c user.email=franco@effektstudios.com commit -m "Claude panel images: <what was wrong>" -m "Claude-Session: https://claude.ai/code/session_012TidnBvRYbxhSYqPzFZuph"
```

Then delete everything the check made:

```bash
rm -rf "$TMPDIR/deck-images-check"
```

- [ ] **Step 12: Hand the rest to Franco**

These need his sessions or his hands; list them in the final message:
1. His own sessions with images, read only: a session where he pasted screenshots, and one where Claude
   read images or took browser screenshots. Thumbnails under the right prompts and calls; the viewer
   steps through them.
2. With real mouse clicks: pressing a thumbnail leaves the keyboard in the terminal (type right after
   closing the viewer); thumbnails can't be dragged; selecting the feed's text skips them.
3. Open with a real click: Preview shows the copy; after quitting Deck it's gone from
   `$TMPDIR/Deck clipboard/`.
4. A portrait photo from a phone read by Claude: the thumbnail and the viewer show it the same way up
   (EXIF orientation is unverified).
5. The picture button before a screen share: every tab's thumbnails turn into "▣ N images".
6. Windows: `docs/TESTING.md` 18z–18ab.

---

### Task 19: Docs

**Files:**
- Modify: `CLAUDE.md` ("Current state", the paths table, the Claude panel section, the session-log
  notes, Tested vs not, Security (M4))
- Modify: `README.md` (the Claude panel's Feed item)
- Modify: `docs/DECK.md` (M5)
- Modify: `docs/TESTING.md` (Windows steps)
- Modify: `docs/superpowers/specs/2026-11-10-claude-panel-images-design.md` (decisions, release notes)

- [ ] **Step 0: What the reviews and Task 18 changed**

Anything the task reviews or the live check changed from this plan goes into the text below before it
is written: CLAUDE.md where it explains code, the spec where it changes behaviour, TESTING.md where
Windows needs a check. Replace this plan's measurements (3.5–6.6 ms per thumbnail, about 200 MB, 678
logs, the replay's totals) with Task 7's and Task 18's own numbers when they differ.

- [ ] **Step 1: CLAUDE.md**

Under "Current state", after the device panel's paragraph (it ends "Simulators and iPhones are steps 2
and 3."), add, with the date it was built:

```markdown
Images in the Claude panel (spec `…/2026-11-10-claude-panel-images-design.md`, plan
`docs/superpowers/plans/2026-11-11-claude-panel-images.md`, built 2026-11-11): pasted images and the
images tool results held, as thumbnails in the feed, with a viewer, Open and a switch that hides them.
Checked on macOS with a crafted log; Franco's own sessions and Windows are still to do.
```

In the paths table, replace the `src/main/claude/` row with:

```markdown
| `src/main/claude/` | session-log locator, incremental tail (with each line's place), the parser (TS port of `claude_activity_pane.py`), status rules, sub-agent steps, `claude:*` subscriptions, images (`images.ts`: formats, sizes, ids, lookups; `pixels.ts`: thumbnails and full images read again from the log) |
```

and in the `src/renderer/src/` row replace `claude/` (panel, feed, markdown, session picker) with
`claude/` (panel, feed, markdown, session picker, images: thumbnails, viewer).

In the Claude panel section of "Things that aren't obvious from the code", after the **Config dir**
bullet, add:

```markdown
  - **Images** (`images.ts`, `pixels.ts`; the renderer's `claude/images.ts`, `ImageTiles.tsx`,
    `ImageViewer.tsx`):
    - **Which item:** a prompt's image blocks go on the prompt item its entry added (an entry with no
      text is "[image]"), numbered by `imagePasteIds`; a `tool_result`'s images on its tool's item,
      error or not; an image beside a `tool_result` in one entry (an AskUserQuestion answer) on that
      tool's item, with no "[image]" prompt; a queued prompt's on its prompt. Never `toolUseResult`
      (Read repeats the image there), sidechain lines or other origins. At most 10 per item, the rest
      counted (`moreImages`). The bytes decide the format: base64 PNG, JPEG, GIF and WebP up to 16 MiB
      of text.
    - **Main keeps no pixels:** an image is listed by id (the first 16 hex digits of the SHA-1 of its
      base64), format, size from its header, bytes and paste number. Its line's place (byte offset
      and length, from `JsonlTail`) sits in a `WeakMap` beside its item and never reaches a snapshot.
      `claude:image` reads the line again (at most 64 MiB) and finds the image by its hash, so a
      rewritten log can't hand back another; it answers a `data:` URL: the image itself, or a 480×360
      thumbnail made with `nativeImage` (PNG as PNG, JPEG as JPEG at 85). `nativeImage` reads neither
      GIF nor WebP, so those are themselves up to 1 MiB, else "No preview". Over 16,384 px a side or
      40 MP by the header: "Too large to show". One request at a time, full images and Open first,
      `setImmediate` between two. Only images the folder's followed session lists, for whichever
      renderer asks.
    - **Renderer:** a thumbnail is asked for within one feed-height of view (`NearView`, one
      IntersectionObserver per feed; a hidden tab asks for nothing), cached by id up to 24 MiB of URLs
      with failures not kept, in a box sized from the snapshot so the feed doesn't jump. Row keys live
      in ClaudePanel; the viewer names an image `<row key>:<index>`.
    - **Open** saves `image-<hash>.<ext>` (the sniffed format) beside the clipboard's pasted images and
      opens it with `shell.openPath`; cleared at quit and start.
    - **The switch** (`deck.claudeImages`) is App's, so it hides images in every tab at once.
    - **Cost** (2026-11-11, dev build, crafted log): 3.5–6.6 ms of main's CPU per thumbnail made (120
      made while scrolling cost 423–793 ms, about 3% of a core); the renderer at about 200 MB with 250
      thumbnails shown.
```

In "Claude Code session logs", after the bullet that starts "User: content string or blocks", add:

```markdown
- Images: `image` blocks with `source {type: "base64", media_type, data}`, base64 in the line. A
  pasted image is a block in its prompt's content, numbered by the entry's `imagePasteIds` (one per
  image block, in order; a queued prompt has them in its attachment). Read's result holds the image and
  its `toolUseResult.file.base64` holds it again, so the line is about twice the image; MCP tools repeat
  theirs in `toolUseResult` too. An image pasted into an AskUserQuestion answer is a block after the
  `tool_result` in the same entry. Measured 2026-11-10: 1,087 images, all PNG or JPEG, at most 512 KB
  and 3.4 MP; lines up to 2.2 MB.
```

In "Tested vs not", after the sentence that ends "no turn, agent or background task left open in
finished sessions.", add:

```markdown
  The image rules were replayed the same way through both parsers (2026-11-11: 678 logs, every one
  matching; 48 images on prompts, 942 on tool calls, 1 "[image]" prompt).
```

In "Security (M4)", replace the first bullet with:

```markdown
  - Check the IPC sender frame (`clipboard:paste` hands password-manager text to the renderer;
    `devices:input` taps and types on a phone; `claude:image` and `claude:open-image` read images
    from Claude's session logs).
```

- [ ] **Step 2: README**

In the Claude panel's **Feed** item, after "It follows the end, pauses when you scroll up, and resumes
from "↓ N new".", add:

```markdown
    Images show as thumbnails: pasted ones under their prompt, and what a tool's result held (an image
    Claude read, a browser screenshot) under its call. Click one to see it large (← and → step through
    the session's images, Esc closes, **Open** shows a copy in your image app); the picture button in
    the panel's header hides them in every tab, say before sharing your screen. Deck reads them from
    the session log: nothing goes over the network.
```

- [ ] **Step 3: DECK.md**

In the M5 list, after the **Device panel** item, add:

```markdown
   - **Images in the Claude panel** (built 2026-11-11; Windows to test): pasted images and tool
     results' images as thumbnails in the feed, a viewer and Open, read from the session log (no
     network). Spec: `docs/superpowers/specs/2026-11-10-claude-panel-images-design.md`.
```

- [ ] **Step 4: TESTING.md**

After step 18y, add (no prompt to Claude is needed: use a session that already has images):

```markdown
18z. Claude panel images: open Deck in a folder whose Claude session has images (one where you pasted a
     screenshot into a prompt, or Claude read an image file). Thumbnails show under the prompt and under
     the Read call. Click one: the viewer covers the window below the tab bar; ← and → step, Esc
     closes, and typing goes to the terminal again.
18aa. In the viewer, click **Open**: Photos shows the image. Close Photos and quit Deck: the copy in
     `%TEMP%\Deck clipboard\<8 characters>\image-….png` is gone. Again, leaving Photos open while
     quitting: the copy stays until Deck's next start removes it.
18ab. The picture button in the Claude panel's header turns every tab's thumbnails into "▣ N images";
     click it again to show them.
```

- [ ] **Step 5: The spec**

At the end of `docs/superpowers/specs/2026-11-10-claude-panel-images-design.md`, add:

```markdown
## Decided while planning (2026-11-11)

- An image beside several `tool_result`s in one entry goes with the last of them.
- `SessionState` takes `maxFeed` (600 by default), so the replay keeps every item.
- `imageSource()` answers from the folder's followed log for whichever renderer asks: a tab coming to
  the front may ask before its subscribe has been answered. Still only images that session lists.
- Open has no pixel limit: it's how an image that is "Too large to show" can still be seen.
- A header that gives no size even over all of the bytes is "Couldn't decode this image".
- Bad IPC arguments answer "No longer in the session log", as an unknown id does.
- The images switch is App's (`deck.claudeImages`), so it hides images in every tab at once; ✻ stays
  per panel.
- Row keys moved from `Feed` to `ClaudePanel`: the viewer names an image `<row key>:<index>`, so the
  same picture twice is two entries.
- The prototype now also cleans a queued string prompt of `<pasted_content>`, as the TypeScript parser
  does.
- Sizes are shown in powers of 1,000 (212 KB), as Finder does.

## Release notes (for the next version's CHANGELOG)

- **Images in the Claude panel:** pasted images show under their prompt, and what a tool's result
  held (an image Claude read, a browser screenshot) under its call, as thumbnails. Click one to see it
  large; ← and → step through the session's images, and **Open** shows a copy in your image app. The
  picture button in the panel's header hides them in every tab, say before you share your screen. Deck
  reads them from Claude's session log: nothing goes over the network.
```

- [ ] **Step 6: Commit**

```bash
git add CLAUDE.md README.md docs/DECK.md docs/TESTING.md docs/superpowers/specs/2026-11-10-claude-panel-images-design.md
git -c user.email=franco@effektstudios.com commit -m "Docs: images in the Claude panel" -m "Claude-Session: https://claude.ai/code/session_012TidnBvRYbxhSYqPzFZuph"
```

- [ ] **Step 7: Review the branch**

Use superpowers:requesting-code-review on `main...m5-claude-images`, then
superpowers:finishing-a-development-branch. The pull request's description gives Task 7's counts (and
only counts) and Task 18's measurements. A release is a separate step (version bump and CHANGELOG, as
CLAUDE.md describes; the spec has the draft).
