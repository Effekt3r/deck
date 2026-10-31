# Changelog

Each version's section becomes the notes of its GitHub release
(`.github/workflows/release.yml`), so write it for the people installing Deck.
Headings are `## <version> — <date>`, with the version as in `package.json`.

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
