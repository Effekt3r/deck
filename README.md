# Deck

A terminal built around Claude Code, by Effekt Studios: every project in a tab,
its git history on the left and what Claude is doing on the right. Spec and plan:
[`docs/DECK.md`](docs/DECK.md).

**Status:** M1 — the Electron app has the Projects tab and terminal tabs with
shell integration. The git panel (M2) and Claude panel (M3) still live in the
WezTerm prototype below.

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

- **Projects tab:** pinned folders, then repos under the scan roots, newest
  first, with branch, changes and an "open" marker. Double-click (or Enter) opens
  a tab that runs the configured command; right-click for shell only, pin,
  reveal, copy path; Settings for the command, scan roots and depth. The first
  run imports `~/.config/wezterm/projects.json` from the prototype.
- **Terminal tabs:** xterm.js (WebGL) on node-pty. zsh and PowerShell get Deck's
  prompt hook automatically (no dotfile edits), so tabs show `repo ⎇ branch`, or
  `repo · <Claude's status title>` while Claude runs.
- **Keys** (Windows: Ctrl+Shift instead of Cmd): Cmd+T new tab, Cmd+W close,
  Cmd+1…9 select, Cmd+Shift+O projects, Cmd+F find, Shift+Enter newline in Claude.
  Windows copies/pastes with Ctrl+Shift+C/V (Ctrl+C copies only with a selection).
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
