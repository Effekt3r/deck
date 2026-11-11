# Images in the Claude panel: design

2026-11-10. Franco asked: "now using the claude app on desktop or mobile, I get to see images etc -
how is that done, do you have access to images in claude for display purposes? if so can we show
them?" The choices below were made without a round of questions; review them here.

## Goal

Today the panel turns a pasted image into the text "[image]" and drops the images that tool results
hold. Show them as the Claude app does: under the prompt they came with and under the tool call whose
result held them, with a larger view on a click.

## Where the images are

- **The Claude app** shows what Claude Code sends it over Remote Control (the `--remote-control` in
  the command Deck types), images included.
- **The session log:** Claude Code writes the same messages to its session log, with each image as
  base64 inside its JSON line. The panel already reads these logs and skips the images. So Deck can
  show them with nothing new to ask for: no network, and Claude's login is never touched.
- **Two places in the log:**
  - a prompt's content blocks: pasted images, which Claude Code shows as `[Image #N]`. The clipboard
    card's images and the device panel's screenshots arrive the same way, since Claude Code attaches
    the path Deck types;
  - a tool result's content list: Claude reading an image file, browser screenshots, and any MCP
    tool's images.

### Measured (2026-11-10)

All local logs, read only, with counts and sizes only (Claude Code 2.1.283 installed; the lines with
images were written by 2.1.258 to 2.1.293):

- **The logs:** 701 logs (153 sessions, 548 sub-agent logs), 344,004 lines, 1.9 GB. The lines holding
  images are 22% of those bytes.
- **1,087 images** in 80 of the 153 sessions and 16 of the 548 sub-agent logs:
  - 939 in sessions' tool results and 103 in sub-agents' tool results. By tool: `Read` 1,026;
    `claude-in-chrome:computer` 12; `claude-in-chrome:browser_batch` 3; another browser tool's
    `computer` 1. None of these results was an error;
  - 29 in 25 typed prompts: 22 with one image, 2 with two, 1 with three. The text beside them was the
    prompt itself, or pasted content;
  - 15 in prompts typed while Claude worked (`queued_command` attachments whose `prompt` is a list);
  - 1 pasted into an answer to AskUserQuestion, as an image block after the `tool_result` in the
    same entry. Today's parser makes a stray "[image]" prompt of it.
- **Formats:** every source is `{"type": "base64", "media_type", "data"}`: 963 PNG, 124 JPEG. The
  declared type matched the bytes every time. There are no GIF, WebP, URL or file sources, and no PDFs
  or other documents anywhere.
- **Sizes:** decoded, median 113 KB, 90th percentile 336 KB, largest 512 KB. Long side: median
  1,000 px, largest 2,000 px; at most 3.4 MP. Claude Code shrinks what it sends: 173 of the 991 Read
  results that record both sizes were smaller than their file, and the files went up to 3.9 MB.
- **Repeats:**
  - Read's lines hold each image twice: in the tool result and again in `toolUseResult.file.base64`
    (991 of 991 where that field exists). MCP results repeat it in `toolUseResult` too;
  - lines holding images: median 296 KB, largest 2.2 MB. Of all lines, 57 are over 1 MB and none
    over 5 MB;
  - `JSON.parse` takes about 0.55 ms per MB: 1.6 ms for the 2.2 MB line;
  - 1,056 of the 1,087 images are distinct.
- **Per session:**
  - sessions with images: median 5, 90th percentile 32, largest 106 (18 MB decoded);
  - in the newest 300 feed items, which is what the panel shows: median 4, 90th percentile 13,
    largest 32 (3.6 MB).
- **Numbering:**
  - pasted images are numbered per session (`[Image #16]` was the highest);
  - the prompt's entry lists the numbers in `imagePasteIds`, one per image block, in order:
    - every prompt with text has it (24 of 24), matching its `[Image #N]` texts;
    - the AskUserQuestion answer has it too;
    - the one image-only prompt has neither;
  - a queued prompt carries `imagePasteIds` in its attachment.
- **Headers:**
  - every JPEG's size marker (SOF) was within its first 39 KB; 22 of the 124 JPEGs are progressive;
  - 819 of the 963 PNGs have an alpha channel.

### Measured in Electron (2026-11-10)

Electron 45.2 (Chromium 156), in a hidden window with its own user data. Timings are medians of 5
runs on 12 images from these logs, with the images kept in memory only:

- **A thumbnail in main**, fitted into 480×360 (`nativeImage.createFromBuffer`, `resize` with quality
  `good`):

  | Source | Size | Time | Thumbnail |
  |---|---|---|---|
  | PNG, encoded as PNG | 0.2 MP | 2.5 ms | 18 KB |
  | PNG, encoded as PNG | 0.5 MP | 4.0–4.4 ms | 22–33 KB |
  | PNG, encoded as PNG | 1.8 MP | 6.4–8.0 ms | 22–27 KB |
  | PNG, encoded as PNG | 3.4 MP, the largest here | 15.2 ms (16.4 ms the first time) | 33 KB |
  | JPEG photos, encoded as JPEG (quality 85) | 1.1–3.0 MP | 3.3–5.8 ms | 9–27 KB |
  | the same photos, encoded as PNG | 1.1–3.0 MP | 12.7–14.8 ms | 61–89 KB |

  Decoding is most of the time: 0.6 ms at 0.2 MP, 10.2 ms at 3.4 MP.
- **Re-reading an image's line** by its byte offset, parsing it and checking the image's hash:
  0.1–0.9 ms.
- **SHA-1:** 1.9 GB/s, so 0.3 ms for the largest image.
- **Decoding in the renderer** (`createImageBitmap` with a resize, on the same images) took
  3–30 ms. Turning the base64 into bytes (`atob`) is 1–15 ms of that, on the page's own thread.
- **`nativeImage` reads neither GIF nor WebP:** both came back 0×0.

## What the user sees

### In the feed

- **Prompts:**
  - pasted images show as thumbnails under the prompt's text, inside its teal block, in paste
    order;
  - a prompt that is only images shows just the thumbnails, without the "[image]" text;
  - the same goes for a screenshot added from the device panel or the clipboard card.
- **Tool calls:** a result that held images shows them under the tool's line, and under its error if
  it failed:
  - an image file Claude read;
  - a browser screenshot;
  - any MCP tool's images.
- **An answer with an image** (AskUserQuestion): under that question's row.
- **Size:**
  - each thumbnail fits 240×180 px and the row's width, keeps its shape and is never enlarged, so a
    32 px icon stays 32 px;
  - at the pane's default width (380 px) that's 240×150 for a 16:10 screenshot and 83×180 for a
    phone's;
  - several wrap, 6 px apart, with a 1 px border and 4 px corners like the clipboard card's. The
    field colour shows through transparent parts.
- **Before the pixels arrive:** each thumbnail's space is set from the start, since the snapshot
  carries its size, so the feed doesn't jump when the pictures arrive. Until then the box is plain,
  and a thumbnail takes a few milliseconds to make.
- **A thumbnail that can't be shown:** a dim picture icon in its box, with the reason as its tooltip:
  - "No longer in the session log";
  - "Too large to show";
  - "Couldn't decode this image";
  - "No preview" (a large GIF, WebP or turned JPEG; it still opens);
  - "Couldn't read the session log" (its line didn't come back within 15 s; see
    [After review](#after-review-2026-11-11)).
- **Tooltip:** what the image is and its size:
  - "Image #3 · 1440 × 900 · PNG · 212 KB";
  - "Read · docs/shot.png · 923 × 2000 · PNG · 284 KB".
- **At most 10 per item**, then "+N more" (3 is the most seen in one item).
- **Keyboard and mouse:**
  - thumbnails are buttons in the tab order, and Enter or Space opens one;
  - pressing one with the mouse doesn't take the keyboard from the terminal;
  - they can't be dragged, and selecting the feed's text skips them.

### Hiding them

- **The button:** a picture button in the header, beside ✻ (thinking), hides images in every tab. It
  is remembered, like thinking, and struck through when off.
- **Hidden:** an item with images shows a dim "▣ 2 images" instead, which opens the viewer, and no
  thumbnails are made.
- **Why it exists:** a quick switch before sharing the screen (screenshots can show client data), and
  a shorter feed when Claude has been reading a folder of icons.

### The viewer

A click on a thumbnail opens it large, inside Deck.

- **Where:** over the whole window below the tab bar, on a dark backdrop. The tab bar stays usable:
  macOS's traffic lights and Windows' caption buttons sit in it, and clicking another tab closes the
  viewer.
- **The image:**
  - as large as fits, with 24 px around it, at no more than one image pixel per CSS pixel;
  - centred, over a checkerboard, so transparent parts can be seen.
- **Caption line:**
  - what the image is, with its size, type and bytes: "Image #3 · 1440 × 900 · PNG · 212 KB";
  - "3 of 12" when the feed has several images;
  - **Open** and ×.
- **Moving:** ← and →, or the ‹ › buttons at the sides, step through the feed's images, oldest to
  newest.
- **Open:**
  - opens a copy in the default image app (Preview on most Macs, Photos on Windows), for zooming
    or copying;
  - the copy is temporary: it goes in Deck's temp image folder and is removed when Deck quits;
  - if it fails, the caption line says why.
- **Closing:**
  - Esc, ×, or a single click that started and ended on the backdrop: a double-click on a thumbnail
    (whose second click lands on the viewer) and a drag between the backdrop and the image or caption
    leave it open;
  - it also closes when the tab leaves the front or the panel shows another session;
  - and when the keyboard goes elsewhere in Deck (Cmd+F's search), leaving it there: up without the
    keyboard, the next Esc would reach the terminal (Claude's interrupt);
  - the keyboard goes back where it was when the viewer opened: the terminal after a click, the
    thumbnail after Enter.
- **Keyboard:** Tab moves between the viewer's buttons and stays inside. The viewer takes only Esc,
  ←, → and Tab, so Deck's own shortcuts still work.
- **While it's open:**
  - the feed keeps updating underneath, and new images join the count;
  - the thumbnail, scaled up, stands in until the full image has loaded;
  - an image that can't be shown says why, in the image's place.

## How

### Which item an image belongs to

The parser's rules, in `session.ts` and in `claude_activity_pane.py`:

1. **Tool results:** the images in a `tool_result`'s content list go with that tool call's item,
   whether the result is an error or not. A result whose item has left the feed (600 items back)
   adds nothing.
2. **Typed prompts** (`origin.kind` human, not `isMeta`):
   - the entry's images go with the last prompt item it added;
   - an entry with images and no text block becomes "[image]" with them, as now;
   - an entry whose text added no prompt (a slash command, say) drops them, as now. None did here.
3. **An image beside a `tool_result` in one entry** is an attachment to that answer (AskUserQuestion,
   seen once). It goes with that tool call's item and makes no "[image]" prompt.
4. **Prompts typed while Claude worked** (`queued_command` with a list `prompt`): as typed prompts.
   Their numbers come from `attachment.imagePasteIds`.
5. **Never read:**
   - `toolUseResult`: the same image again;
   - sub-agent traffic (`isSidechain`);
   - images in entries whose text the panel skips too: other origins (peer, coordinator, task
     notifications), `isMeta` entries and the compact summary.
6. **Which images count:**
   - a base64 source, at most 16 MiB of text, whose bytes are PNG, JPEG, GIF or WebP. The bytes
     decide the format, not `media_type`;
   - anything else is skipped: a URL or file source, another format, empty data;
   - none of those were in the logs, and Deck never fetches a URL source.
7. **At most 10 per item:** more are only counted.

### What main keeps

- **For each image** (`ClaudeImage`, on its item):
  - `id`: the first 16 hex digits of the SHA-1 of its base64 text. The same image gets the same id,
    so it's never made twice, and the id says nothing about the session;
  - `format`: png, jpeg, gif or webp;
  - `width` and `height`, from its header: PNG's IHDR; GIF's screen descriptor, grown to cover its
    first frame, as Chromium sizes one; WebP's VP8, VP8L or VP8X; or JPEG's first SOF within the
    first 96 KiB, found by a libjpeg-style marker walk (fill bytes, stray bytes between segments and
    FF 00 are skipped, and a decoy SOF inside another segment's data isn't read as one). They are 0
    when the header doesn't say. A JPEG with an EXIF orientation of 5–8 has them swapped, so it's
    listed upright;
  - `bytes`;
  - `paste`: its `[Image #N]` number, from `imagePasteIds` when that has one positive integer per
    image.
- **Never its base64.** Beside each item that has images, main keeps where its line is in the log
  (byte offset and length). This is kept in a `WeakMap` keyed by the item, so it goes when the item
  does, and it never reaches the snapshot.
- **The tail:** `JsonlTail.read()` returns each entry's place. It splits the bytes on newlines and
  decodes each line on its own, so offsets stay exact around multi-byte text. A line split between two
  reads keeps the offset where it began.
- **Cost:**
  - a hash and a header read per image: 0.3 ms for the largest here;
  - the busiest session's 106 images (24 MB of base64) add about 13 ms to its first read, which runs
    1 MB at a time with other work in between.
- **Rewritten logs:** a log that's rewritten (it shrank) or replaced by another file (another inode,
  e.g. renamed over it) is parsed again from the start. The places are new and the ids stay the same.

### The snapshot

- **On the items:** prompt and tool items gain `images?` and `moreImages?`.
- **Size:** about 100 bytes of JSON per image, so the 32 images of the busiest window here add about
  3 KB to a snapshot.
- **No pixels, ever:** snapshots are pushed several times a second during a turn and compared as JSON.
- **`feedItems.ts`:**
  - two prompts are the same entry when their text and image ids match, so two image-only prompts
    aren't mistaken for one;
  - an item renders again when its images change, as a tool's do when its result arrives.

### Pixels on request

- **`claude.image(folder, id, size)`**, with size `'thumb'` or `'full'`, answers `{ url }` (a `data:`
  URL, which the page's CSP already allows) or `{ error }`.
- **Arguments:** main checks that the folder is absolute (as subscribe does), that the id is 16 hex
  digits and the size one of the two.
- **Where main looks:**
  - only in the folder's followed log, the one the panel's snapshot came from. The renderer never
    names a file;
  - it finds the item holding the id and reads that line again, at most 64 MiB;
  - it parses the line and takes the image block whose decoded size is the one listed and whose SHA-1
    is the id (the size first: it's cheap and rules out most blocks), so a log rewritten meanwhile
    can't hand back another image ("No longer in the session log").
- **Waiting for the log:** both handlers first wait for an update a subscribe of the folder is waiting
  on. A tab coming back to the front asks for its thumbnails before its subscribe is answered, when its
  log may not be read yet.
- **One at a time:** requests are queued, a full image ahead of thumbnails. Between two, main yields
  (`setImmediate`), so terminal output and other IPC go on. The longest single step measured was
  16 ms. A request still unanswered 15 s after it started (its read hung: a network volume under
  `CLAUDE_CONFIG_DIR`, say) answers "Couldn't read the session log" and the next starts; whatever it
  gets later is dropped.
- **Thumbnails:**
  - **PNG and JPEG within 480×360** (twice the 240×180 box): the image itself;
  - **larger ones:** decoded with `nativeImage`, resized to fit 480×360, then encoded:
    - PNG sources as PNG, since 85% have alpha: 2.5–15.2 ms, 18–33 KB;
    - JPEG sources as JPEG at quality 85: 3–6 ms, 9–27 KB. As PNG they cost 13–15 ms and 61–89 KB;
  - **GIF and WebP:** `nativeImage` can't decode them, so the thumbnail is the image itself when it is
    at most 1 MiB, else "No preview". An animated GIF moves in its thumbnail. None were in the logs.
  - **A turned JPEG (any EXIF orientation but 1):** its size is listed upright (5–8 swap width and
    height, above), but `nativeImage` ignores EXIF orientation, which Chromium honours, so a thumbnail
    made with it would come out turned back: sideways, upside down or mirrored. So its bytes are
    passed through, as GIF and WebP are, up to 1 MiB; a larger one is "No preview" and still opens
    upright in the viewer.
  - **Size guard:** more than 16,384 px a side or 40 MP (from the header, which is what the decoder
    uses) is "Too large to show", before anything is decoded. The largest here was 3.4 MP.
- **Full images:**
  - the image's own bytes, as `data:image/<format>;base64,…`;
  - re-encoded from the decoded bytes, so the URL holds nothing but base64 and the type main sniffed;
  - no decoding in main, and 512 KB at most here;
  - the same size guard applies.
- **Open** (`claude.openImage(folder, id)` answers null, or `{ error }`):
  - main finds the image the same way and saves its bytes beside the clipboard's pasted images, as
    `image-<hash>.<png|jpg|gif|webp>`, in `<temp>/Deck clipboard/<instance>/`. The file is 0600 in a
    0700 folder and is removed at quit and at the next start;
  - then `shell.openPath`. The extension comes from the sniffed bytes, so only an image viewer ever
    opens;
  - `TempImages.save()` takes the extension and name prefix, and its cleanup matches the new names.

### The renderer

- **Asking late:** a thumbnail is asked for when its item comes within one feed-height of the visible
  part, through one `IntersectionObserver` per feed with the feed's scroller as its root. Opening a
  session asks only for the images near the end, scrolling up asks for more, and a hidden tab asks for
  nothing. Nor does a window behind other windows: Chromium draws it no frames, and the observer runs
  with them, so its thumbnails come once it's seen.
- **Cache:**
  - thumbnails by id, least recently used out first, up to 24 MB of URL text (about 1,000 thumbnails
    of the sizes measured);
  - the cache belongs to the module, like the markdown cache, so a tab switch or another session
    reuses it;
  - a request already in flight is shared;
  - failures aren't kept: a thumbnail asks again when it's mounted again, or when its panel is shown
    again (its tab comes to the front, or the subscribe answers again).
- **No cache in main:** the window's one renderer has it, and a thumbnail costs at most 16 ms to make
  again.
- **Pure helpers:**
  - each thumbnail's size: fitted into 240×180 and never enlarged. An image whose header gave no
    size gets a 120×120 box;
  - the viewer's size;
  - captions;
  - the feed's list of images, for the viewer's steps.
- **The viewer's state** lives in `ClaudePanel`, which closes it when the tab isn't active or the
  session changes, as it does the session menu.

### Privacy

- **Nothing new is read:** Deck reads only the logs the panel already reads. Nothing goes over the
  network, and Claude's login isn't touched.
- **Memory only:**
  - main keeps no image data, only ids, sizes and places;
  - the renderer keeps thumbnails while Deck runs, and one full image while the viewer shows it.
- **One file, on request:** Open's copy is the only file Deck writes, and only when asked, in the
  temp folder that's cleared at start and quit. This is the same rule as the device panel's
  screenshots.
- **Hiding:** the header's button hides images before a screen share.
- **IPC:** the renderer can only ask for images main has listed for the folder it follows.
  `claude:image` and `claude:open-image` join the M4 security list's sender-frame check.

### Memory

- **Main:**
  - about 100 bytes per image, for at most 10 images per item and 600 items. The busiest session here
    has 106;
  - nothing taken from the line stays alive, so no V8 slice keeps a 2 MB line. The id is a fresh
    string from the digest, the format a literal, and the paste number a number. `own()` isn't
    needed: nothing is cut from the line;
  - the base64 met while parsing goes with the parsed entry, as it does today.
- **Renderer:**
  - at most 24 MB of thumbnail URLs;
  - Chromium's decoded pixels for the thumbnails on screen: 0.7 MB each at 480×360;
  - 13.5 MB for the largest image here while the viewer shows it.

### Rejected

- **Base64 in the snapshot:** every push, several a second during a turn, would carry every image
  again: 3.6 MB for the busiest window here, compared as JSON each time.
- **Thumbnails in the snapshot, made while parsing:**
  - every image in a log would be decoded whether it's ever shown or not. The busiest session's 106
    would cost up to 1.5 s of main's thread on its first read;
  - each push would still carry them.
- **Keeping the base64 in main:**
  - 24 MB of text for the busiest session here, in every parsed log main keeps (the followed ones
    and four more), and unbounded for a session that takes hundreds of screenshots;
  - the log already holds the image, and reading its line again costs under 1 ms.
- **Decoding in the renderer** (`createImageBitmap`): the base64-to-bytes step runs on the page's
  thread (1–15 ms), which is as long as main's whole thumbnail, and the full image would cross IPC
  for every thumbnail.
- **Full images as thumbnails** (`<img>` scaled by CSS): Chromium keeps the decoded pixels at full
  size. That's 13.5 MB for the largest image here, and 236 MB for 32 phone screenshots of 1.8 MP.
- **A custom protocol** (`<img src="deck-image://…" loading="lazy">`): it would bring Chromium's lazy
  loading and cache, but:
  - it adds a privileged scheme with no sender to check;
  - it puts folders in URLs;
  - its CSP change would land before M4 settles the renderer's own protocol.
- **The files Claude read** (Read's `file_path`): a file may have changed or gone, and Claude saw a
  smaller copy for 173 of the 991 Read results that record both sizes.
- **Thumbnails on disk between runs:** they would keep client screenshots outside the log, which
  already holds them.
- **Opening every click in Preview:** it leaves Deck and writes a file for every look. The viewer is
  immediate and leaves nothing behind.
- **Leaving the prototype alone:** which item an image belongs to is parser behaviour, and the
  reference exists so such rules are checked against every local log. Rule 3 also changes what both
  parsers show.

### Parity with claude_activity_pane.py

The Python stays the reference, so it gets the same rules and counts what it can't show:

- an event becomes `[kind, text, images]`;
- `self.tool_events` maps tool_use ids to their events, so a result's images find their tool;
- `user()` follows rules 1–3;
- the `queued_command` branch handles a list `prompt` as text, or "[image]" with its images. The
  TypeScript parser already does this, so it closes a gap that exists today;
- an image counts when its source is base64 with non-empty data;
- the TUI prints a dim `▣ 2 images` under such an event.

**The replay check:** a throwaway script (not committed) runs both parsers over every local log. For
each whole log it compares three counts, which must match: images on prompts, images on tool calls,
and "[image]" prompts. The pull request reports the counts only. The two can differ only on base64
images that TypeScript skips (another format, or over 16 MiB), and there were none here.

### Code

- `src/shared/types.ts`:
  - `ClaudeImage`;
  - `images?` and `moreImages?` on the prompt and tool items;
  - `ClaudeImageData` (`{ url } | { error }`);
  - `DeckApi.claude.image()` and `.openImage()`.
- `src/shared/channels.ts`: `claude:image`, `claude:open-image`.
- `src/preload/index.ts`: the two calls.
- `src/main/claude/`:
  - `images.ts` (pure): reading an image's header (format and size), making its `ClaudeImage`,
    finding an image block by id in an entry (prompt content, tool_result content, attachment
    prompt);
  - `tail.ts`: each entry's offset and length;
  - `session.ts`: the rules, the refs, the places and `imagePlace(id)`;
  - `snapshot.ts`: copies `images` and `moreImages`;
  - `subscriptions.ts`: passes places to `ingest()`; `imageSource(folder, id)` returns the followed
    log's path, offset and length;
  - `pixels.ts`: reading the line, the thumbnail (`nativeImage`), the full image, the size guard and
    the one-at-a-time queue;
  - `ipc.ts`: the handlers and their checks. Open uses the clipboard's `saveImage`, passed in from
    `main/index.ts`, and `shell.openPath`.
- `src/main/clipboard/temp.ts`: `save(bytes, ext, prefix)` and the cleanup's names.
- `src/renderer/src/claude/`:
  - `images.ts` (pure): sizes, captions, the feed's image list and the thumbnail cache;
  - `useThumbnail.ts`: asking when near view, through the feed's observer;
  - `ImageTiles.tsx`: the thumbnails, or "▣ N images";
  - `ImageViewer.tsx`: the viewer, rendered into `<body>`;
  - `Feed.tsx`: rows with thumbnails, and the observer and `openImage` in `FeedContext`;
  - `feedItems.ts`: `sameEntry` and `sameItem` with images;
  - `ClaudePanel.tsx`: the header's button (`deck.claudeImages`) and the viewer's state;
  - `panel.css`.
- `claude_activity_pane.py`: as above.
- `src/main/claude/test-log.ts`: image blocks with real data. `pngData(width, height)` builds a small
  valid PNG with zlib and `zlib.crc32`; JPEG, GIF and WebP headers are built by hand. Prompts take
  `images` as data, and results take image content.
- **Docs:**
  - CLAUDE.md: the panel's images, and the log notes (`imagePasteIds`; Read's image appears twice in
    its line);
  - README, TESTING.md, CHANGELOG, and DECK.md's M5 list.

### Build order

One plan and one pull request, in this order, each step tested before the next:

1. shared types and the pure `images.ts`;
2. the tail's places and the parser's rules, then the Python and the replay check;
3. the snapshot, `pixels.ts` and the IPC;
4. the renderer's thumbnails, the late asking and the cache;
5. the viewer, Open and the header's button;
6. docs, and the checks in the app.

## Testing

- **Unit, main:**
  - headers: PNG, baseline and progressive JPEG with the SOF behind a large APP1 segment, GIF, and
    WebP in its three forms; truncated and garbage data;
  - refs: id, format, size, bytes and paste number. URL and file sources, empty data, text over
    16 MiB and unknown formats are skipped;
  - the parser, on logs built with `test-log.ts` (never real logs):
    - a prompt with text and two images, with its `imagePasteIds`;
    - an image-only prompt;
    - a queued prompt with an image;
    - a Read result, an MCP result with text and an image, and an error result with an image;
    - an AskUserQuestion answer with a pasted image: the image is on the question's item, with no
      "[image]" prompt;
    - a result for an item that left the feed;
    - 12 images in one item (10 kept, 2 more);
    - peer, `isMeta` and sidechain images ignored;
    - the same image twice gets one id;
    - places found by id, and gone with their item;
  - the tail: offsets and lengths across multi-byte text, a line split between two reads, blank
    lines, and a rewritten file;
  - the snapshot: images copied, places left out;
  - `pixels.ts` with a stand-in `nativeImage`, as `clipboard/image.test.ts` does:
    - the fit, never enlarged, and PNG or JPEG chosen by the source;
    - small PNG and JPEG and GIF/WebP passed through, and large GIF/WebP refused;
    - the size guard, and a decode that fails;
    - a line whose image no longer matches;
    - the queue runs one at a time, full images first, and one failure doesn't stop the next;
  - IPC: argument checks, a folder that isn't followed, and an unknown id;
  - `TempImages`: the new names saved and cleared.
- **Unit, renderer:**
  - `sameEntry` and `sameItem` with images;
  - thumbnail and viewer sizes;
  - captions;
  - the image list and stepping through it when the current id has gone;
  - the cache's size limit, shared in-flight requests and failures not kept.
- **Python:** `python3 -m py_compile`, and `--once` on a hand-made log with images.
- **Replay:** both parsers over every local log, as above.
- **In the app** (a dev build with its own user data):
  - **A hand-made log**, in a temp `CLAUDE_CONFIG_DIR` (as the usage card was tested). It holds a
    prompt with two pasted PNGs, a Read of a PNG and of a JPEG, a browser screenshot, and an
    AskUserQuestion answer with an image. Lines are then appended while the panel shows it. No prompt
    goes to the model;
  - **Franco's own sessions** with images, read only;
  - **Check:**
    - thumbnails under prompts and tools, with no jump as they arrive;
    - the viewer: Esc, the arrows, a backdrop click, the keyboard going back, and a tab click;
    - Open: Preview shows the copy, and quitting removes it;
    - hiding images;
    - a long session scrolled from end to start;
    - main's CPU while thumbnails are made, and the renderer's memory with the window's 300 items
      full of images.
- **Windows:** new steps after 18y in `docs/TESTING.md`:
  - thumbnails and the viewer;
  - Open with Photos;
  - the copy gone after quitting, or after the next start if Photos still had it open.

## Known limits

- **Claude's copy, not the file:**
  - Claude Code shrinks images before sending them, and the log keeps the shrunk copy. Here 173 of the
    991 Read results that record both sizes were smaller than their file, and every image was at most
    2,000 px;
  - the panel, the viewer and Open show what Claude saw.
- **GIF and WebP:** `nativeImage` can't decode them, so their thumbnail is the image itself up to
  1 MiB (an animated GIF moves), and larger ones say "No preview". The viewer shows them all. None were
  in the logs.
- **Images not stored in the log** (a URL or file source, which the API allows) aren't shown. None
  were in the logs.
- **Sub-agents' images aren't shown:** 103 of the 1,087 here, in 16 of 548 sub-agent logs. Their rows
  show the current step only, as now.
- **The window:** only items among the feed's newest 300 can show their images, like the items
  themselves.
- **Cost:**
  - a long session's thumbnails cost main up to 16 ms each, one at a time;
  - opening the busiest window here, scrolled through, comes to about 0.3 s of main's time, spread
    out;
  - the size guard still lets a 20–40 MP PNG be decoded for its thumbnail, on main's thread: an
    estimated 100–300 ms stall for every terminal (the largest here was 3.4 MP).
- **A read that hangs** (a network volume): if it stays hung, every request queued behind it takes its
  own 15 s in turn (N thumbnails, N × 15 s) before it says "Couldn't read the session log", each holding
  a file handle open until the volume answers.
- **The renderer's memory:** 24 MB is the cache's limit, not the renderer's. A mounted thumbnail keeps
  the URL it shows after the cache has dropped it, and inactive tabs stay mounted.
- **A rewritten log:** an image whose line moved shows "No longer in the session log" until the panel
  is shown again.
- **Open's copy:** removed at quit. On Windows an app that still has it open keeps it until the next
  start.
- **Zoom:** the viewer fits the window and goes no further. Open is the way to zoom.
- **Hiding is Deck's only:** Claude Code and the Claude app still show the images.
- **Windows:** untested.

## Not in this design

- Sub-agents' images, from their own logs.
- Zooming and panning in Deck, copying an image, dragging it out, or Save As.
- Thumbnails in the session picker.
- PDFs and other documents: none were in the logs.
- Images Claude makes: Claude Code's replies carry none.
- Pictures in the WezTerm prototype, which shows counts.
- Thumbnails kept between runs.

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

## After review (2026-11-11)

Code reviews of the build changed these; the sections above say what was built:
- **Sizes as the decoders read them:** a JPEG's size comes from a libjpeg-style marker walk, a GIF's is
  its screen grown to cover its first frame, and a JPEG with an EXIF orientation of 5–8 is listed
  upright.
- **Turned JPEGs** are their own thumbnail, as GIF and WebP are, up to 1 MiB, else "No preview":
  `nativeImage` ignores EXIF orientation.
- **Finding an image again:** main keeps each image's listed byte count with its place, and compares a
  block's decoded length before hashing it.
- **A replaced log** (another inode) is read again from the start, like one that shrank.
- **Waiting for the log:** a tab coming back to the front asked for its thumbnails before its subscribe
  was answered, and got "No longer in the session log". Both handlers now wait for that update.
- **A read that hangs** answers a fifth reason, "Couldn't read the session log", 15 s after its request
  started, and the queue moves on. The reasons are in `src/shared/claude-images.ts`.
- **Asking again:** a thumbnail whose answer was an error asks again when its panel is shown again, so
  a moved image's message lasts until then, as Known limits says, and not until the tile remounts.
- **The viewer's backdrop:** only a single click that started and ended there closes the viewer. A
  double-click on a thumbnail opened it under the first click and closed it with the second, and a drag
  that ended on the backdrop (selecting the caption, say) closed it.
- **The viewer's keyboard:** the viewer closes when the keyboard goes elsewhere in Deck (Cmd+F's
  search) and leaves it there: up without the keyboard, the next Esc would reach the terminal and
  interrupt Claude. A button that turns disabled while it has the keyboard (› onto the last image, Open
  while it works) drops it to the page, so the viewer takes it back.
- **Known limits** gained the large PNG decode, the read that hangs and the renderer's memory.

## Checked in the app (2026-11-11)

A dev build on macOS (a 1400×900 window at 1× scale, the right pane at its default 380 px) with its
own user data and a temp `CLAUDE_CONFIG_DIR` holding one crafted log: synthetic PNGs, and JPEGs made
from them with `sips`. Never a real log, and no prompt went to Claude. Clicks and keys were trusted
input over the DevTools protocol, and `shell.openPath` was swapped in main for a recorder, so nothing
opened.

- **The feed:** the 8 thumbnails had the boxes this design gives (240×150, 83×180, 240×160, 240×180,
  240×150, 240×180, 64×64, and broken.jpg's 231×180 saying "Couldn't decode this image"), the
  image-only prompt showed no "[image]", and the feed's height didn't change as pictures arrived, also
  while 111 and then 119 more loaded during a scroll (25,114 and 48,399 px before and after). At the
  pane's 260 px minimum (208 px rows) every tile kept its shape, within 0.31% (the boxes' rounding).
- **The viewer:** below the tab bar, 1440×900 fitted to 1238×774, "1 of 8" with ‹ disabled; → stepped
  to "7 of 8" (the reason in the image's place) and stopped at "8 of 8"; Esc gave the keyboard back to
  the terminal, or to the thumbnail after Enter. Tab went round its four buttons. A double-click on a
  thumbnail, and drags from the caption or the image onto the backdrop, left it open; a click on the
  backdrop closed it. Esc still closed it after › onto the last image (with the mouse and with Enter),
  after Open, and while Open was busy. The menu's Find (what Cmd+F does) closed it and left the keyboard
  in the terminal's search; Esc then closed the search, and the shell received no key at all. A 120-image
  append while it showed "9 of 9" made it "9 of 129". Clicking the Projects tab closed it.
- **Open:** `Deck clipboard/<8 hex>/image-<16 hex>.jpg`, the folder 0700 and the file 0600, a 1600×1200
  JPEG. A failing open said "Couldn't open the copy: …" in the caption line. Quitting removed the copies
  and the instance's folder, and left another instance's folder alone.
- **Hiding:** the switch turned the 7 image items into "▣ N images" ("▣ 2 images" opened the viewer on
  Image #1), did the same in a second tab, and was remembered across a restart.
- **A moved line:** a line blanked in place gave its tile "No longer in the session log"; after the log
  was renamed over with every line moved (main read its 66 MB again), the tile kept the message until
  its tab came back to the front, then showed its picture.
- **Cost:** main made a thumbnail of these PNGs (500 to 619 × 382 px) for 3.3 ms of CPU (120 asked one
  at a time: 400 ms; round trips 2.5 ms median, 4.1 ms at most). Scrolling a feed from end to start,
  main spent 691 ms on 111 thumbnails over 14 s (4.9% of a core), and 693 ms on 119 over 25 s (2.8%).
  The renderer was at 158 MB with 128 thumbnails loaded and 169 MB with 247. These synthetic thumbnails
  were about 1 KB each, a fraction of real screenshots', so that's mostly decoded pixels, not the cache.
- **Two fixes came of it**, each with its own commit:
  - a press on the backdrop released on the image closed the viewer: the click goes to the nearest
    common ancestor of where it started and ended, the backdrop whenever either end is on it, so where
    it ended now comes from pointerup;
  - turning images on, the first time after a start, left the feed paused 1,001–1,451 px above the end:
    scroll anchoring kept a row in place, and its scroll event came before the ResizeObserver that
    follows the end. The switch now goes to the end in the same layout effect as thinking's.
- **Seen too:** a window behind other windows draws no frames, so its thumbnails wait until it's seen;
  they came as soon as frames did.

Not checked: Franco's own sessions; real mouse clicks (a press leaving the keyboard in the terminal,
thumbnails that can't be dragged, selecting the feed's text around them); Preview showing Open's copy; a
portrait photo from a phone, whose EXIF orientation is unverified; Windows (`docs/TESTING.md`
18z–18ab).

## Release notes (for the next version's CHANGELOG)

- **Images in the Claude panel:** pasted images show under their prompt, and what a tool's result
  held (an image Claude read, a browser screenshot) under its call, as thumbnails. Click one to see it
  large; ← and → step through the session's images, and **Open** shows a copy in your image app. The
  picture button in the panel's header hides them in every tab, say before you share your screen. Deck
  reads them from Claude's session log: nothing goes over the network.
