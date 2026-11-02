# Changelog

Each version's section becomes the notes of its GitHub release
(`.github/workflows/release.yml`), so write it for the people installing Deck.
Headings are `## <version> — <date>`, with the version as in `package.json`.

## 0.3.2 — 2026-11-02

See your Claude plan usage without typing `/usage`.

- **Usage card:** your weekly and 5-hour limits as a donut at the bottom of the
  Claude panel, above the clipboard card, with when each resets. It updates a
  second after any Claude reply, turns amber from 75% and red from 90%, and
  folds to one line.
- **Connect** on the card makes Deck Claude Code's status line, which is how
  Claude Code hands out these numbers. It adds a `statusLine` to
  `~/.claude/settings.json`, and Claude Code then hides its footer hints ("esc
  to interrupt"). **Disconnect** puts back what was there. Deck never reads your
  Claude login.

**Updating from 0.3.1:** quit Deck (your tabs close), open the new `.dmg` and drag
Deck to Applications, replacing the old one. Windows: the installer is still
unsigned; choose **More info → Run anyway**.

## 0.3.1 — 2026-11-02

- **Image previews in the clipboard card:** image files you copy in Finder now show
  a preview above their names, as a screenshot already did. Two or three images
  share a row. Any format Finder can preview works, HEIC included. On Windows the
  card still shows names only, for now.
- The first time you copy an image from Downloads, Desktop or an external drive,
  macOS may ask whether Deck can open files there: the preview needs it.

**Updating from 0.3.0:** quit Deck (your tabs close), open the new `.dmg` and drag
Deck to Applications, replacing the old one. Windows: the installer is still
unsigned; choose **More info → Run anyway**.

## 0.3.0 — 2026-11-01

Copy something, then add it to Claude in one click.

- **Clipboard card:** something you copy in another app (a screenshot, files, text)
  shows under the Claude panel with **Add to Claude**, which puts it into the
  prompt without sending it. A screenshot taken straight to the clipboard while
  Deck is in front (⌃⇧⌘4) shows too. **×** dismisses it.
- **Smart paste:** Cmd/Ctrl+V pastes copied files as their full paths and, with
  Claude running, an image as `[Image #1]`. Dropping files on the terminal pastes
  their paths.
- **Privacy:** Deck looks at the clipboard only while its window is in front,
  never shows a password manager's copy, and keeps no history.
- **Safer pasting:** pasted text can no longer break out of a paste and run
  commands in zsh, and keys you type during a paste wait for it.

**Updating from 0.2.0:** quit Deck (your tabs close), open the new `.dmg` and drag
Deck to Applications, replacing the old one. Automatic updates come later.
Windows: the installer is still unsigned; choose **More info → Run anyway**.

## 0.2.0 — 2026-10-31

The first build with all three parts of Deck: terminal tabs, the git panel and
the Claude panel.

- **Projects tab:** pinned folders, then the repos under your scan roots, newest
  first, with branch and changes. Double-click opens a tab that runs your
  command (Claude by default); right-click for a plain shell, pin, reveal or
  copy the path. The first run imports the WezTerm prototype's project list.
- **Terminal tabs:** zsh and PowerShell, with tab titles that follow the repo and
  branch, or Claude's status while it runs. No dotfile changes needed.
- **Git panel** (left; Cmd/Ctrl+Shift+G): branch, what it merges into and how far
  ahead and behind it is, upstream, changes, and a live graph of all branches.
  It redraws within about half a second of a commit, checkout or merge. Click a
  commit for its message and files.
- **Claude panel** (right; Cmd/Ctrl+Shift+A): what Claude is doing in the tab:
  working, running a tool, waiting on you or idle, with model, context size,
  to-dos, sub-agents and a live feed of prompts, replies and tool calls. It
  follows the newest session in the folder, or one you pin. Deck only reads
  Claude's files.

**Installing**

- **macOS** (Apple silicon; Intel Macs aren't supported): open
  `Deck-0.2.0-mac-arm64.dmg` and drag Deck to Applications. Signed by Effekt
  Studios Pty Ltd and notarised by Apple.
- **Windows** (x64): run the `.exe`. It isn't signed yet, so SmartScreen warns on
  first run: choose **More info → Run anyway**.

Not in this build yet: settings beyond the Projects tab's, notifications and
auto-update.
