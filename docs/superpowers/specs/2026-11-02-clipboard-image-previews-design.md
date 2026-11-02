# Image previews for copied files: design

2026-11-02. Franco asked: "for the smart clipboard, instead of just showing the file path
for images, lets show a preview of the image as well". The choices below were made without
a round of questions; review them here.

## Goal

Today:
- **Screenshots:** an image on the clipboard already gets a thumbnail in the clipboard card.
- **Image files:** files copied in Finder or Explorer show only names, type badges and the folder.

Show a preview of image files too, and keep the names and the folder.

## What the user sees

- **Which files:** of the (up to three) files the card lists, those with an image extension,
  in any case: png, jpg, jpeg, gif, webp, heic, heif, avif, bmp, tif, tiff, svg. Only regular
  files: a folder named `x.png` gets none.
- **Where:** a row of thumbnails between the card's heading and its file list.
  - **One image:** looks like a screenshot's thumbnail (fits 240×280 px, shown at most 140 px tall).
  - **Two or three:** they share the row, each shrinking to fit.
  - **Labels:** each shows the file's name as its tooltip and alt text.
  - **Unchanged:** names, badges, "+N more" and the folder line.
- **When:** the card appears at once, as now. The thumbnails follow once the OS has made them:
  - Quick Look takes 14–170 ms for a file it hasn't seen (a 25 MP PNG: 166 ms; HEIC: 126 ms) and
    about 3 ms after that.
  - A file that can't be previewed has no thumbnail: unreadable, not really an image, or no
    thumbnailer on that OS. On macOS, Quick Look answers such a file with its type's icon
    (1024×1024); a result larger than the requested box is taken for that icon and dropped.
- **Windows:** off for now (see [After review](#after-review)); the card shows names, as today.
- **Nothing else changes:**
  - what Add to Claude and Cmd/Ctrl+V insert;
  - the title ("1 file");
  - when the card appears or goes.

## How

### Thumbnails come from the OS

`nativeImage.createThumbnailFromPath` uses Quick Look on macOS and Explorer's thumbnail cache on
Windows. So:
- **Formats:** every format Finder or Explorer previews works, HEIC included.
- **Threads:** on macOS the thumbnail is made off the main thread.
- **Linux:** has no thumbnailer, so no previews there.

### Its shape

Measured with Electron 45.2 on this Mac (Retina main screen):
- The image it returns claims the whole requested box (`getSize()`).
- Its 2× copy is stretched to that box: a 3:2 photo comes out 480×560 from
  `toPNG({ scaleFactor: 2 })`, and `resize()` uses it too.
- Its 1× PNG (`toPNG()`) keeps the image's own shape, fits inside the box and is never enlarged:
  - 6000×4000 → 480×320;
  - 164×314 → 164×314;
  - 50×30 → 50×30.

So Deck asks for twice the card's box (480×560), decodes the 1× PNG and fits it into 240×280,
like a clipboard image's thumbnail. A Swift copy of Quick Look's part gave the right shape at both
1× and 2× screen scales. Asking for twice the box gives the same result whether that 1× PNG is
the box at 1× or Quick Look's 2× image halved. A non-Retina main screen is untested in Electron
itself.

### Alternatives turned down

- **Decoding in main** (`nativeImage.createFromPath`, then resize):
  - reads only PNG and JPEG;
  - blocks the main process: 31 ms for a 24 MP JPEG, 98 ms for a 25 MP PNG.
- **Loading the file in the renderer** (`<img src="file://…">` or a custom protocol):
  - gives the page access to files by path;
  - shows no HEIC;
  - stops working when the renderer moves off `file://` (M4).

### When the thumbnails are made

1. `ClipboardWatch` publishes a new files item as now.
2. It then asks for thumbnails of the listed image files. This runs outside the look/add/paste
   chain, so a slow volume never holds up a paste (the renderer's paste queue releases typed
   keys after 1 s).
3. When they are ready, it publishes the same item again (same id) with them, provided that:
   - the item is still the current one: not pasted, added, dismissed or replaced;
   - and at least one thumbnail was made.
4. From then on, `current()` returns the item with its thumbnails.

### Contract

The `files` preview gains `thumbnails?: string[]`:
- one data: URL per listed name, `''` for a file without one;
- absent until made.

The renderer already keys Add state by id, so the second update changes nothing else.

### Code

- **`src/main/clipboard/item.ts`:** `isImageFile(path)`, which is pure and tested.
- **`src/main/clipboard/image.ts`:** `fileThumbnail(path): Promise<string>`.
  - It returns `''` on any failure and never rejects.
  - It shares the fit with `imageInfo`.
- **`src/main/clipboard/watch.ts`:** `WatchDeps.fileThumbnail`, and the second publish.
- **`src/main/clipboard/ipc.ts`:** passes `fileThumbnail` in.
- **`src/shared/types.ts`:** the new field.
- **Renderer:** `ClipboardCard.tsx` renders the row (`.clip-thumbs`), styled in `clipboard.css`.

## Testing

- **Unit:**
  - `isImageFile`.
  - The watch:
    - the item is published at once, then again with the same id and its thumbnails;
    - only listed image files are thumbnailed;
    - thumbnails are dropped for an item pasted, dismissed or replaced in the meantime;
    - a failing or rejecting thumbnail is left out;
    - none made means no second publish;
    - a paste isn't held up by a thumbnail that never finishes.
- **Manual on macOS (dev app):** copy each of these in Finder:
  - one PNG, one HEIC, one large JPEG;
  - three images;
  - two images and a PDF;
  - a PDF alone (no row);
  - five images (three previews, "+2 more").

  Then check that Add to Claude still inserts the paths.
- **Windows** (`docs/TESTING.md`, new step 18l):
  - copy one image, then three, in Explorer: the previews are the right way up and not black;
  - copying a large image doesn't make the terminal stall.

## Out of scope

- Previews of PDFs and other documents. Quick Look can make them; this is a small follow-up if
  wanted.
- Previews in the Claude panel feed for prompts with `[Image #N]`.
- The image's size in the card title: the OS thumbnail doesn't give it.

## After review

A code review on 2026-11-02 found three things. The changes:
- **Icons:** on macOS, a corrupt, empty, unreadable or unknown image file got Quick Look's
  generic document icon as its "preview". Empty files are now skipped, and a result larger
  than the requested box is dropped (macOS only, since Windows' cache can return thumbnails
  larger than asked).
- **Windows:** off by default. Electron's Windows `createThumbnailFromPath` runs the thumbnail
  cache synchronously on the main thread. A slow file stalls every terminal, and a stall over
  1 s can lose a Ctrl+V: the renderer gives up while main still uses the item. Electron also
  turns the bitmap into an icon masked by itself, which may make white transparent.
  `DECK_FILE_THUMBNAILS=1` turns previews on so `docs/TESTING.md` step 18l can decide.
- **Tests:** a test now pins the in-place update that `add()` depends on, with a mocked
  `nativeImage` for `fileThumbnail`, and an IPC test for the Windows switch.

