# Clipboard card and smart paste: design

2026-10-31. Agreed with Franco in conversation; this is the written spec for review.

## Goal

Get what Franco copies (screenshots, documents, text) into the tab's Claude session in one step, and show it before it goes in.

**Today:**
- **Text** pastes fine.
- **Images:** Claude Code attaches a clipboard image with Ctrl+V on macOS (Alt+V on Windows), but nothing in Deck says so. Cmd+V with an image pastes nothing.
- **Files** copied in Finder or Explorer paste only their names, so Claude can't find them.
- **Dropping** a file on the terminal does nothing.

## What the user sees

### Clipboard card (Claude panel)

- **Where:** at the bottom of the Claude panel, in a tab where Claude is running (`runsClaude(tab.process, tab.title)`). It appears when the clipboard holds a new item; see [When an item is new](#when-an-item-is-new).
- **What it shows:**
  - **image:** a thumbnail (at most 240 px wide) and its size, e.g. "Image · 1440×900";
  - **files:** up to three names, each with a type badge from its extension ("PDF", "PNG"), "+N more", and the first file's folder;
  - **text:** the first three lines, each cut at 120 characters, and "N lines".
- **Add to Claude** inserts the item into the prompt as a bracketed paste. It never presses Enter.
- **×** dismisses the item.
- **When it goes away:** adding, pasting or dismissing an item hides its card in every tab, and a newer item replaces it.
- **Errors:** if adding fails (the image can't be saved, for example), the card shows the error and nothing is inserted.

### Smart paste (every terminal tab)

Cmd+V on macOS; Ctrl+V and Ctrl+Shift+V on Windows.

| Clipboard holds | Tab running Claude | Shell tab |
|---|---|---|
| Files (Finder/Explorer copy) | their quoted full paths, space-separated | same |
| An image, no text | the path of a saved PNG; Claude shows `[Image #N]` | nothing (as today) |
| Text | the text (as today) | the text (as today) |
| A concealed item (password manager) | plain text paste (as today) | same |

Pasting an item counts as using it, so its card goes away.

### Drop

Dropping files from Finder or Explorer onto the terminal inserts their quoted paths, the same as pasting copied files. Other drops, such as an image dragged out of a browser (no file behind it), are ignored.

## Rules

### Which item

When the clipboard holds several kinds of content, the item is chosen in this order:

1. **Files.**
2. **Text.** Cmd+V with text then behaves exactly as today, and copies from Excel or Word (text plus a picture of it) stay text.
3. **An image on its own**, such as a screenshot or Copy Image in a browser.

The card always shows what Cmd+V would paste, except concealed items, which get no card (see [Privacy](#privacy)).

### When an item is new

- **When Deck reads:** when its window gains focus, about once a second while it is in front, and one last time as it leaves. Never while it is in the background. A slow read (a large image) spaces the polls out to about 5% of the time, and a locked screen or a sleeping Mac stops them.
- **What counts as new:**
  - **On focus:** anything changed since Deck last looked. It was copied in another app.
  - **While Deck is in front:** only an image or files, e.g. a screenshot taken straight to the clipboard with ⌃⇧⌘4. Text that changes while Deck is in front is Deck's own copy (a terminal selection, Copy hash, Copy path) and never brings up a card.
- **Fingerprint:** a hash of the kind and the content (keyed per run, so it means nothing outside the process) decides whether anything changed. The formats are left out: copies of the same content can carry different raw formats. Reading the clipboard once a second while Deck is in front is the cost to watch, not the hashing: a screenshot-size PNG reads in about 6 ms.

### Privacy

- **Concealed items are skipped** (no card, plain paste):
  - macOS: `org.nspasteboard.ConcealedType`, `org.nspasteboard.TransientType`;
  - Windows: `ExcludeClipboardContentFromMonitorProcessing`, or `CanIncludeInClipboardHistory` set to 0.

  1Password, Bitwarden and KeePass set these.
- **No history.** The main process keeps only the current item; the renderer only ever gets its preview.
- **Images go to disk only when added or pasted.**

## Architecture

### Main process: `src/main/clipboard/`

| File | Role |
|---|---|
| `read.ts` | `readClipboard(): ClipboardContent \| null`, the only code that calls Electron's `clipboard`. It picks the content (files, then text, then image) and spots concealed copies. Electron 45's clipboard is async: one item whose `text/uri-list` lists every copied file. |
| `item.ts` (pure) | The content types, `text/uri-list` parsing, the preview, the fingerprint. |
| `image.ts` | Size and thumbnail of an image (Electron's `nativeImage`). |
| `watch.ts` | Window `focus`/`blur` and the 1 s poll while focused; fingerprint comparison and the "new" rules; holds the current item and whether it was used. |
| `insert.ts` | Turns an item into the text to insert: quoted paths (`src/shared/quote.ts`: `'…'` with `'\''` for zsh, `'…'` with `''` for PowerShell), the text, or an image's saved path. |
| `temp.ts` | `<app temp>/Deck clipboard/<sha1>.png`, written on first use; emptied at startup and on quit. |
| `ipc.ts` | Wires it to the window. |

### Contract (`src/shared/types.ts`, `channels.ts`)

```ts
type ClipboardPreview =
  | { id: string; kind: 'image'; width: number; height: number; thumbnail: string } // data: URL
  | { id: string; kind: 'files'; names: string[]; more: number; folder: string }
  | { id: string; kind: 'text'; lines: string[]; lineCount: number }

type InsertResult = { text: string } | { error: string }

interface DeckApi {
  clipboard: {
    /** The item the card offers now (for a renderer that starts listening late). */
    current(): Promise<ClipboardPreview | null>
    /** The current new item, or null when there is none (used, dismissed, replaced by nothing new). */
    onItem(cb: (item: ClipboardPreview | null) => void): () => void
    /** The text that inserts this item (the snapshot, even if the clipboard changed since). */
    add(id: string): Promise<InsertResult>
    /** What Cmd/Ctrl+V should insert now; null means paste nothing. Marks the item used. */
    paste(opts: { claude: boolean }): Promise<InsertResult | null>
    dismiss(id: string): void
  }
  app: {
    /** Absolute path of a dropped file (preload: webUtils.getPathForFile). Replaces readText,
     *  which nothing uses once paste goes through clipboard.paste. */
    pathForFile(file: File): string
  }
}
```

### Renderer

- **`clipboard/ClipboardCard.tsx` with a `useClipboardItem()` hook** (in `src/renderer/src/clipboard/`, rendered under the Claude panel by `App.tsx`'s Workspace): shows the preview. Add calls `clipboard.add(id)`, then pastes the text into the tab's terminal.
- **`terminal/TerminalView.tsx`:**
  - **Paste:** catches it before xterm, then calls `clipboard.paste({ claude })` and pastes the result with `term.paste()`, which wraps it in bracketed paste when the program asked for that.
    - macOS: the DOM `paste` event that the Edit menu's Paste fires, in the capture phase.
    - Windows: the existing `paste` key action.
  - **Drop:** `dragover`/`drop` give quoted paths through `app.pathForFile`.
- **Reaching the terminal:** each TerminalView registers a `paste(text)` handle for its tab, the way find requests reach it today, so the card can insert into its tab.

### Quoting

Quoting goes by platform: zsh on macOS, PowerShell on Windows.

Verified 2026-10-31: Claude Code 2.1.283 on macOS turns a pasted `'/path/shot one.png'` and `/path/shot\ one.png` into `[Image #1]` and `[Image #2]`.

## Verify first (the plan's first task)

1. **Windows, file lists:** read more than one copied file through Electron. `FileNameW` gives only the first. The fallback is Chromium's paste event (`clipboardData.files` with `webUtils.getPathForFile`).
2. **Windows, image paths:** Claude Code attaches an image from a pasted, quoted Windows path (`'C:\…\shot.png'`). If it doesn't, use double quotes there.
3. **macOS, concealed items:** verified 2026-10-31. Electron 45 has no `availableFormats()`; the concealed type is among the item's raw types, and `clipboard.has()` sees it.
4. **macOS, paste interception:** the Edit menu's Paste reaches the terminal as a DOM `paste` event that can be cancelled before xterm handles it.

## Testing

- **Unit (vitest, macOS and Windows in CI):**
  - item choice and order; concealed items skipped;
  - previews: three lines, 120-character cut, "+N more";
  - quoting for zsh and PowerShell: spaces, quotes, non-ASCII names;
  - the "new" rules: focus versus poll, fingerprints, text changing while focused;
  - the temp folder: written on first use, emptied at start and quit;
  - the card's state: shown, hidden after add, paste or ×, replaced, Claude not running.
- **Manual on macOS:**
  - a screenshot to the clipboard, then the card, then **Add**, giving `[Image #1]`;
  - two files copied in Finder, then Cmd+V, giving quoted paths;
  - a PDF dropped on the terminal;
  - a password-manager copy, which shows no card;
  - text copied in a browser shows a card; text selected in the terminal doesn't.
- **Windows:** new steps in `docs/TESTING.md` covering the same, plus checks 1 and 2 above.

## Out of scope

- Clipboard history.
- Images in plain shell tabs.
- Drops with no file behind them.
- Paste as plain text.
- The first-launch permissions guide. It's a separate M5 item in `docs/DECK.md`.
