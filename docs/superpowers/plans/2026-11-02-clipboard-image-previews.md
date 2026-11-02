# Image previews for copied files: implementation plan

> **For agentic workers:** REQUIRED SUB-SKILL: Use superpowers:subagent-driven-development (recommended) or superpowers:executing-plans to implement this plan task-by-task. Steps use checkbox (`- [ ]`) syntax for tracking.

**Goal:** the clipboard card shows thumbnails of copied image files, not just their names and folder.

**Architecture:**
- **Thumbnails:** the main process asks the OS for each one (`nativeImage.createThumbnailFromPath`:
  Quick Look on macOS, Explorer's thumbnail cache on Windows). It fits the image into the card's
  240×280 box and sends it as a data: URL.
- **When:** `ClipboardWatch` publishes the files item at once, then republishes the same item
  (same id) with `thumbnails` once they're made, unless the item has gone by then.
- **Card:** shows them in a row above the file list.

**Tech stack:** Electron 45 `nativeImage`, React 19, vitest.

**Spec:** `docs/superpowers/specs/2026-11-02-clipboard-image-previews-design.md`.
**Branch:** `m5-clipboard-previews`.

**Setup:**
- **Node 22:** run `export PATH="$HOME/.nvm/versions/node/v22.19.0/bin:$PATH"` first.
- **Commits:** use `git -c user.email=franco@effektstudios.com commit`, no `Co-Authored-By`. End
  each message with `Claude-Session: https://claude.ai/code/session_012Tidn9qVajMb9EYY5GyX8U`.

## Files

| File | Change |
|---|---|
| `src/main/clipboard/item.ts` | `isImageFile(path)`: does the card preview this file as an image (by extension) |
| `src/shared/types.ts` | `files` preview: `thumbnails?: string[]` |
| `src/main/clipboard/watch.ts` | `WatchDeps.fileThumbnail`; `addThumbnails()` publishes the item again with them |
| `src/main/clipboard/image.ts` | `fileThumbnail(path)`; the fit shared with `imageInfo` |
| `src/main/clipboard/ipc.ts` | passes `fileThumbnail` to the watch |
| `src/renderer/src/clipboard/ClipboardCard.tsx`, `clipboard.css` | the thumbnail row |
| `docs/TESTING.md`, `CLAUDE.md`, `docs/DECK.md` | Windows step 18l; notes |

---

### Task 1: `isImageFile`

**Files:** modify `src/main/clipboard/item.ts`, test `src/main/clipboard/item.test.ts`.

- [ ] **Step 1: failing test.** In `item.test.ts`, add `isImageFile` to the `./item` import and append:

```ts
describe('isImageFile', () => {
  it('knows image files by their extension, in any case', () => {
    for (const p of ['/a/shot.png', 'C:\\x\\Photo.JPG', '/a/b.jpeg', '/a/c.heic', '/a/d.HEIF', '/a/e.webp',
      '/a/f.gif', '/a/g.tif', '/a/h.tiff', '/a/i.bmp', '/a/j.avif', '/a/k.svg']) {
      expect(isImageFile(p), p).toBe(true)
    }
  })

  it('leaves out other files, and names that only contain an image extension', () => {
    for (const p of ['/a/spec.pdf', '/a/png', '/a/shot.png.txt', '/a/archive.tar.gz', '/a/Makefile', '/a/x.pngx']) {
      expect(isImageFile(p), p).toBe(false)
    }
  })
})
```

- [ ] **Step 2:** `npx vitest run src/main/clipboard/item.test.ts`. Expected: FAIL, `isImageFile` is not a function.

- [ ] **Step 3: implement.** In `item.ts`, after `filePathsFromUriList`:

```ts
/** Image formats Finder and Explorer can show a thumbnail of. */
const IMAGE_FILE = /\.(png|jpe?g|gif|webp|hei[cf]|avif|bmp|tiff?|svg)$/i

/** The card previews this file as an image (judged by its extension). */
export function isImageFile(path: string): boolean {
  return IMAGE_FILE.test(path)
}
```

- [ ] **Step 4:** the same command. Expected: PASS.
- [ ] **Step 5:** commit `item.ts` and `item.test.ts`: "Clipboard: isImageFile".

### Task 2: the contract and the watch

**Files:**
- modify `src/shared/types.ts` and `src/main/clipboard/watch.ts`;
- test `src/main/clipboard/watch.test.ts`.

- [ ] **Step 1: contract.** In `types.ts`, the `files` member of `ClipboardPreview`, after `folder: string`:

```ts
      /** Small PNGs of the named files that are images, as data: URLs, one per name ('' for the
       *  others). Absent until the OS has made them: they come in a second update of the item. */
      thumbnails?: string[]
```

- [ ] **Step 2: failing tests.** In `watch.test.ts`:
  - give `setup()` a default `fileThumbnail: async () => ''`, before `...overrides`, so existing
    tests see no second publish;
  - add these tests inside `describe('ClipboardWatch')`:

```ts
  it('follows a files card with thumbnails of its listed image files, as an update of the same item', async () => {
    const asked: string[] = []
    const { clip, watch, published } = setup({
      fileThumbnail: async (p) => {
        asked.push(p)
        return `data:${p}`
      },
    })
    await watch.baseline()
    clip.now = files('/x/a.png', '/x/b.pdf', '/x/c.PNG', '/x/d.png')
    watch.focus()
    await tick()
    expect(asked).toEqual(['/x/a.png', '/x/c.PNG']) // not the PDF, nor the fourth file, which isn't listed
    expect(published).toHaveLength(2)
    expect(published[0]).toMatchObject({ kind: 'files', names: ['a.png', 'b.pdf', 'c.PNG'], more: 1 })
    expect(published[0]).not.toHaveProperty('thumbnails')
    expect(published[1]).toEqual({ ...published[0], thumbnails: ['data:/x/a.png', '', 'data:/x/c.PNG'] })
    expect(watch.current()).toEqual(published[1])
    watch.stop()
  })

  it('asks for no thumbnails when no listed file is an image', async () => {
    const fileThumbnail = vi.fn(async () => 'data:x')
    const { clip, watch, published } = setup({ fileThumbnail })
    await watch.baseline()
    clip.now = files('/x/spec.pdf', '/x/notes.md')
    watch.focus()
    await tick()
    expect(fileThumbnail).not.toHaveBeenCalled()
    expect(published).toHaveLength(1)
    watch.stop()
  })

  it('leaves out a thumbnail that fails, and publishes nothing more when none is made', async () => {
    const { clip, watch, last } = setup({
      fileThumbnail: async (p) => {
        if (p.includes('bad')) throw new Error('no thumbnailer')
        return p.includes('none') ? '' : `data:${p}`
      },
    })
    await watch.baseline()
    clip.now = files('/x/bad.png', '/x/good.jpg')
    watch.focus()
    await tick()
    expect(last()).toMatchObject({ names: ['bad.png', 'good.jpg'], thumbnails: ['', 'data:/x/good.jpg'] })
    clip.now = files('/x/bad.png', '/x/none.gif')
    await tick(1000) // the next poll: files copied while Deck is in front are new
    expect(last()).toMatchObject({ names: ['bad.png', 'none.gif'] })
    expect(last()).not.toHaveProperty('thumbnails')
    watch.stop()
  })

  it.each(['dismissed', 'pasted', 'replaced'] as const)('drops thumbnails that arrive after the item was %s', async (how) => {
    const pending = new Map<string, (thumb: string) => void>()
    const { clip, watch, published } = setup({
      fileThumbnail: (p) => new Promise((resolve) => pending.set(p, resolve)),
    })
    await watch.baseline()
    clip.now = files('/x/a.png')
    watch.focus()
    await tick()
    const first = published.at(-1)!
    if (how === 'dismissed') watch.dismiss(first.id)
    if (how === 'pasted') await watch.paste(true)
    if (how === 'replaced') {
      clip.now = files('/x/b.png')
      await tick(1000)
    }
    const before = published.length
    pending.get('/x/a.png')!('data:late')
    await tick()
    expect(published).toHaveLength(before) // nothing republished for the old item
    expect(published.some((p) => p?.kind === 'files' && p.thumbnails)).toBe(false)
    if (how === 'replaced') {
      pending.get('/x/b.png')!('data:b')
      await tick()
      expect(published.at(-1)).toMatchObject({ names: ['b.png'], thumbnails: ['data:b'] })
    }
    watch.stop()
  })

  it('never holds up a paste while thumbnails are still being made', async () => {
    const { clip, watch } = setup({ fileThumbnail: () => new Promise<string>(() => {}) })
    await watch.baseline()
    clip.now = files('/x/a.png')
    watch.focus()
    await tick()
    await expect(watch.paste(true)).resolves.toEqual({ text: '/x/a.png' })
    watch.stop()
  })
```

- [ ] **Step 3:** `npx vitest run src/main/clipboard/watch.test.ts`. Expected: the new tests FAIL.
  `fileThumbnail` is never called, and there is no second publish.

- [ ] **Step 4: implement.** In `watch.ts`:
  - import `isImageFile` from `./item`;
  - add to `WatchDeps`, after `imageInfo`:

```ts
  /** A thumbnail of an image file as a data: URL, '' for none; never rejects. Can take a while:
   *  the OS makes it. */
  fileThumbnail(path: string): Promise<string>
```

  In `look()`, replace the final `this.set({ preview: previewOf(content, randomUUID(), image), fingerprint, content })` with:

```ts
        const item: Item = { preview: previewOf(content, randomUUID(), image), fingerprint, content }
        this.set(item)
        void this.addThumbnails(item)
```

  Then add this method after `dismiss()`:

```ts
  /** Thumbnails for a files item's listed image files: once the OS has made them, the item is
   *  published again (same id) with them, unless it has gone by then (pasted, added, dismissed or
   *  replaced). Runs beside the look/add/paste chain, not in it, so a slow volume never holds up a
   *  paste. */
  private async addThumbnails(item: Item): Promise<void> {
    const { preview, content } = item
    if (preview.kind !== 'files' || content.kind !== 'files') return
    const listed = content.paths.slice(0, preview.names.length)
    if (!listed.some(isImageFile)) return
    const thumbnails = await Promise.all(listed.map(async (path) => {
      if (!isImageFile(path)) return ''
      try {
        return await this.deps.fileThumbnail(path)
      } catch {
        return '' // it shouldn't reject, but this runs detached: a rejection would go unhandled
      }
    }))
    if (this.item !== item || !thumbnails.some(Boolean)) return
    item.preview = { ...preview, thumbnails }
    this.deps.publish(item.preview)
  }
```

- [ ] **Step 5:** `npx vitest run src/main/clipboard/` and `npm run typecheck`. Expected: PASS.
  `ipc.ts` doesn't pass `fileThumbnail` yet, so typecheck fails until Task 3; run it after Task 3
  if so.
- [ ] **Step 6:** commit: "Clipboard: publish thumbnails of copied image files".

### Task 3: `fileThumbnail` and the wiring

**Files:** modify `src/main/clipboard/image.ts` and `src/main/clipboard/ipc.ts`.

`image.ts` imports Electron, so it has no unit test. It's covered by the dev-app check (Task 5)
and the probe measurements in the spec.

- [ ] **Step 1: implement.** Replace `image.ts` with:

```ts
import { stat } from 'node:fs/promises'
import { type NativeImage, nativeImage } from 'electron'
import type { ImageInfo } from './item'

/** The card shows thumbnails at most 140 px tall, at 2×. */
const BOX = { width: 240, height: 280 }

/** `image` fitted into BOX (never enlarged) as a data: URL (the renderer's CSP allows data:
 *  images); '' for an image that decoded to nothing. */
function thumbnailOf(image: NativeImage): string {
  const { width, height } = image.getSize()
  if (!width || !height) return '' // guards the scale below against NaN/Infinity
  const scale = Math.min(1, BOX.width / width, BOX.height / height)
  const thumb = scale < 1 ? image.resize({ width: Math.max(1, Math.round(width * scale)), quality: 'good' }) : image
  return thumb.isEmpty() ? '' : thumb.toDataURL()
}

/** An image's size and a thumbnail that fits both the card's width and height. Built straight from
 *  the PNG bytes' own buffer (no copy). An image that fails to decode, or decodes to 0×0, gets a ''
 *  thumbnail. */
export function imageInfo(png: Uint8Array): ImageInfo {
  const image = nativeImage.createFromBuffer(Buffer.from(png.buffer, png.byteOffset, png.byteLength))
  const { width, height } = image.getSize()
  return { width, height, thumbnail: thumbnailOf(image) }
}

/** A thumbnail of an image file, fitted like imageInfo's; '' when there is none (a folder, a
 *  missing or unreadable file, no thumbnailer: Linux). Never rejects.
 *  The OS makes it: Quick Look on macOS, off the main thread, and Explorer's thumbnail cache on
 *  Windows, so every format Finder or Explorer previews works, HEIC included. On macOS, Electron
 *  45's result claims the whole requested box, and its 2× copy (which resize() also uses) is
 *  stretched to it. Its 1× PNG keeps the image's own shape, fitted inside the box and never
 *  enlarged, so that PNG is decoded and fitted again. Asking for twice the card's box makes this
 *  come out the same whether the PNG is the box at 1× or Quick Look's 2× image halved. */
export async function fileThumbnail(path: string): Promise<string> {
  try {
    if (!(await stat(path)).isFile()) return '' // Quick Look would make a folder icon
    const made = await nativeImage.createThumbnailFromPath(path, { width: BOX.width * 2, height: BOX.height * 2 })
    return thumbnailOf(nativeImage.createFromBuffer(made.toPNG()))
  } catch {
    return ''
  }
}
```

- [ ] **Step 2: wire it.** In `ipc.ts`:
  - import `{ fileThumbnail, imageInfo }` from `./image`;
  - pass `fileThumbnail,` after `imageInfo,` in `new ClipboardWatch({ … })`.
- [ ] **Step 3:** `npm test && npm run typecheck`. Expected: all pass.

  `ipc.test.ts` mocks `nativeImage` without `createThumbnailFromPath`. A files item that reached
  `fileThumbnail` there would throw inside its `try` and give `''`, so nothing is republished.
- [ ] **Step 4:** commit: "Clipboard: thumbnails of image files from Quick Look / Explorer".

### Task 4: the card

**Files:** modify `src/renderer/src/clipboard/ClipboardCard.tsx` and `clipboard.css`.

- [ ] **Step 1: implement.** In `CardBody`, between the image `<img>` line and the files `<ul>`:

```tsx
      {item.kind === 'files' && item.thumbnails?.some(Boolean) && (
        <div className="clip-thumbs">
          {item.thumbnails.map((src, i) =>
            src ? <img key={i} className="clip-thumb" src={src} alt={item.names[i] ?? ''} title={item.names[i]} /> : null)}
        </div>
      )}
```

In `clipboard.css`, after the `.clip-thumb` rule:

```css
/* Copied image files: one shows like a screenshot; two or three share the row, shrinking to fit. */
.clip-thumbs { display: flex; align-items: flex-start; gap: 6px; min-width: 0; }
.clip-thumbs .clip-thumb { min-width: 0; }
```

- [ ] **Step 2:** `npm run typecheck && npm run build`. Expected: pass.
- [ ] **Step 3:** commit: "Clipboard card: a row of thumbnails for copied image files".

### Task 5: check it in the dev app (macOS)

Next to the installed Deck, with its own userData:

```bash
npx electron-vite dev --remoteDebuggingPort 9333 -- --user-data-dir="$TMPDIR/deck-dev-previews"
```

1. Open a tab in a folder and start `claude` in it. The card shows only in a tab where Claude runs.
2. For each case, copy in Finder (Cmd+C), then click Deck:
   - one PNG; one HEIC; a 24 MP JPEG;
   - three images;
   - two images and a PDF;
   - a PDF alone: no row;
   - five images: three previews and "+2 more".
3. Each preview has the right shape, and two or three share the row.
4. **Add to Claude** still inserts the quoted paths.
5. Copying again while a card shows replaces it, with no stale thumbnails.
6. Read the card through DevTools (`Runtime.evaluate` on `.clip-thumbs img`): each image's
   `naturalWidth` and `naturalHeight` fit 240×280 and match the file's shape.

### Task 6: docs

- [ ] **`docs/TESTING.md`:** after 18k, add:

```
18l. Copy one photo in Explorer, then three, and come back: the card shows a preview of each
     above the names, the right way up and not black or blank. Copying a very large image
     (50 MB or more) doesn't make terminal output stall.
```

- [ ] **`CLAUDE.md`:** in the clipboard notes, add that copied image files get OS thumbnails
  (`fileThumbnail`), noting the 1×/2× shape quirk. Update the DECK.md M5 bullet to say "image
  files get previews".
- [ ] **Commit:** "Docs: image previews for copied files".
