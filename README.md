# Deck

A terminal built around Claude Code, by Effekt Studios: every project in a tab,
its git history on the left and what Claude is doing on the right. Spec and plan:
[`docs/DECK.md`](docs/DECK.md).

**Status:** M3 — the Electron app has the Projects tab, terminal tabs with
shell integration, the git panel and the Claude panel; the Mac build is signed
and notarised (M4, Windows signing to follow). Next: polish (M5). The WezTerm
prototype below is the reference it replaces.

## Deck app (Electron)

Needs Node 22 (`nvm use` reads `.nvmrc`).

```bash
npm install          # postinstall fixes node-pty's spawn-helper permissions
npm run dev          # app with hot reload
npm test             # unit tests (vitest)
npm run typecheck
npm run build        # out/
npm run dist:mac     # dist/ (dmg + zip; unsigned unless signing secrets are set)
```

If `npm run dev` says Electron failed to install, run `node node_modules/electron/install.js`.

**Releases:** bump `version` in `package.json` and add its section to
[`CHANGELOG.md`](CHANGELOG.md), then run the **release** workflow on `main`
(`gh workflow run release.yml --ref main`) or push the tag `v<version>`. It makes
one draft GitHub release with the Mac dmg + zip (signed and notarised) and the
Windows installer; publish it once it looks right.

- **Projects tab:** pinned folders, then repos under the scan roots, newest
  first, with branch, changes and an "open" marker. Double-click (or Enter) opens
  a tab that runs the configured command; right-click for shell only, pin,
  reveal, copy path; Settings for the command, scan roots and depth. The first
  run imports `~/.config/wezterm/projects.json` from the prototype.
- **Terminal tabs:** xterm.js (WebGL) on node-pty. zsh and PowerShell get Deck's
  prompt hook automatically (no dotfile edits), so tabs show `repo ⎇ branch`, or
  `repo · <Claude's status title>` while Claude runs.
- **Keys** (Windows: Ctrl+Shift instead of Cmd): Cmd+T new tab, Cmd+W close,
  Cmd+1…9 select, Cmd+Shift+O projects, Cmd+F find, Cmd+Shift+D device panel, Shift+Enter newline
  in Claude.
  Next/previous tab: Cmd+Shift+] / [ (Windows: Ctrl+Tab / Ctrl+Shift+Tab).
  Windows copies/pastes with Ctrl+Shift+C/V (Ctrl+C copies only with a selection).
  Nothing uses Ctrl+Alt, which is AltGr on many keyboard layouts.
- **Git panel** (left of every tab in a git repo; Cmd/Ctrl+Shift+G hides it for
  that repo): branch, merge target with commits to merge and behind (pick another
  target from the ▾ menu; Deck remembers it without touching the repo), upstream,
  work-tree counts and merge/rebase in progress, then the graph of all branches
  with the commits that will merge highlighted. It redraws within about half a
  second of a commit, checkout or merge. Click a commit for its message and files;
  Copy hash. Drag the edge to resize.
- **Claude panel** (right of every tab where Claude runs or has a session;
  Cmd/Ctrl+Shift+A hides it): what Claude is doing, read from its session log.
  - **Status:** working, a running tool, waiting on you, idle, quiet, exited or an
    API error, with running agents and background tasks.
  - **Session:** model, context size, branch, permission mode, PR and title.
  - **Work:** the to-do list and sub-agents with their current step.
  - **Feed:** prompts, collapsible thinking, replies as markdown and tool calls.
    It follows the end, pauses when you scroll up, and resumes from "↓ N new".
    Images show as thumbnails: pasted ones under their prompt, and what a tool's result
    held (an image Claude read, a browser screenshot) under its call. Click one to see it
    large (← and → step through the session's images, Esc closes, **Open** shows a copy
    in your image app); the picture button in the panel's header hides them in every
    tab, say before sharing your screen. Deck reads them from the session log: nothing
    goes over the network.
  - **Picker:** follows the folder's newest session; ▾ pins another one. Deck only
    reads Claude's files, apart from the status line the usage card's Connect adds.
  - **Clipboard:** what you just copied in another app (an image, files, text) shows
    under the panel with **Add to Claude**, which puts it into the prompt without
    sending. Cmd/Ctrl+V does the same in any tab: copied files paste as quoted paths
    with a trailing space (several at once arrive as paths Claude can read), and with
    Claude running, a copied image instead pastes as `[Image #N]`. Dropping files on
    the terminal pastes their paths the same way. Deck looks at the clipboard only
    while it's in front, never shows a password manager's copy, and keeps no history.
  - **Usage:** your plan's weekly and 5-hour limits as a donut above the clipboard card,
    with when each resets. It updates whenever Claude replies. **Connect** on the card
    makes Deck Claude Code's status line, which is how Claude Code hands out these
    numbers: it adds a `statusLine` to `~/.claude/settings.json`, and Claude Code then
    hides its footer hints. **Disconnect** puts back what was there and forgets the
    numbers.
- **Device panel** (top of the right pane in an Android app's tabs; Cmd/Ctrl+Shift+D hides it, or
  shows it in any other tab): the phone or emulator the app runs on, live. Click to tap, drag to
  swipe, scroll with the wheel, and type and paste with the screen selected (Option and Cmd editing
  keys work as on a Mac); Back, Home, Recent apps and Power in its header and, while Claude runs, a
  camera that adds a screenshot to Claude's prompt. Each project remembers the devices picked in it
  and opens only on those (the ▾ menu picks another, per tab). It streams only while you can see it. Needs adb (Android Studio or
  Android's platform tools). Deck runs scrcpy's server on the device over adb; the server deletes
  itself, and the screen setting it changes while shown is put back. A paste goes through the
  device's clipboard and stays there.
- **Open in Deck:** `Deck --open <folder>` (the Windows folder menu uses it) opens a
  tab in the running window.

# Claude workspace for WezTerm (prototype)

One terminal app, many tabs. Each tab opened in a git repo becomes:

```
┌ git graph ──────────┬ shell / claude ─────────────┬ Claude activity ──────┐
│ ⎇ feature/X         │ $ claude …                  │ ✻ working · ctx 84k   │
│ ↳ merges into dev   │                             │ To-do 1/3             │
│   2 to merge        │                             │ Agents 1 running      │
│ * a1b2 ◉ feature/X  │                             │ › your prompt         │
│ | * c3d4 main       │                             │ ✻ thinking…           │
│ …                   │                             │   ⏺ Bash Run tests    │
└─────────────────────┴─────────────────────────────┴───────────────────────┘
```

Tab 1 is the **⌂ Projects** dashboard: double-click a folder (or Enter) to open
it in a new tab and run the command in `projects.json`
(default `claude --effort max --model claude-opus-5-5 --remote-control`).

## Install

macOS: `./install.sh` · Windows: `powershell -ExecutionPolicy Bypass -File install.ps1`

Installs WezTerm (Homebrew / winget) if missing, copies the files to
`~/.config/wezterm`, and adds a one-line prompt hook to `~/.zshrc` / `$PROFILE`.
Needs `python3` (Mac: Xcode command line tools; Windows: installed by winget).

## Keys (Windows: Ctrl+Shift instead of Cmd)

| Key | Action |
|---|---|
| Cmd+Shift+G / A | show/hide git graph / Claude activity in this tab |
| Cmd+Shift+O | go to the Projects dashboard |
| Cmd+T, Cmd+D, Cmd+Shift+D | new tab, split right, split down |
| Cmd+Opt+arrows | move between panes |
| Shift+Enter | newline in Claude's prompt |

Inside the panes: `q` close · wheel/`j`/`k` scroll · graph: `a` all branches ↔
focus, `r` refresh · activity: `f` follow, `t` hide thinking, `n` older session ·
dashboard: `o` shell only, `p` pin, `/` filter, `e` edit projects.json.

## How it works

- **Git graph** (`git_graph_pane.py`): polls refs + status every 1.5 s with
  `GIT_OPTIONAL_LOCKS=0`, so it never fights Claude for `index.lock`. Merge
  target is detected (feature → dev, dev → main), counted against
  `origin/<target>` when your local copy is only behind it; override with
  `git config branch.<name>.mergeTarget origin/dev`. Highlighted hashes are the
  commits that will land in the target.
- **Claude activity** (`claude_activity_pane.py`): tails the newest session log
  in `~/.claude/projects/<folder>/` (worktrees included). Read-only. Status is
  working / running a tool / waiting on you / idle / exited; sub-agents show
  their current step. If two sessions run in the folder it stays on the one it
  follows until that's been quiet for 15 s (`n` cycles). Thinking is shown when
  Claude Code records it in the log; otherwise "✻ thinking…".
- **Prompt hook** (`wezterm-git.zsh` / `.ps1`): reports the repo and branch to
  WezTerm; `wezterm.lua` opens/closes the side panes when that changes. Re-running
  `install.sh` while WezTerm is open reloads the config without duplicating panes.
