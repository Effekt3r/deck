# Deck — project brief for Claude Code

Owner: Franco Landman (Effekt Studios). Repo: `github.com/Effekt3r/deck` (private).
Read this first, then `docs/DECK.md` for the product spec and build plan.

## What Deck is

A terminal app for working with Claude Code, shipped as a **signed Mac and Windows
app by Effekt Studios**. Franco keeps using Claude Code in a terminal, but wants:

1. **Tabs** — one app, many tabs, one project/Claude session per tab.
2. **Git graph on the left** whenever the tab is in a git repo — a Sourcetree-style
   view of all branches, the branch he's on, and **where it will merge next**
   (feature → dev, dev → main via PR), redrawing live as Claude commits/merges/tags.
3. **Claude activity on the right** — what Claude is doing: thinking, replies,
   tool calls, sub-agents and their current step, to-do list, status, context size.
4. **Projects dashboard** — quick access to folders; **double-click a folder** to
   open a new tab there and run:
   `claude --effort max --model claude-opus-5-5 --remote-control`
   (the command is configurable).

Name is **Deck** (not "Claude …" — Anthropic trademark; don't put "Claude" in the
product name, bundle id or icon). Description/copy is ours to write.

## Current state: working prototype (v0)

This repo is a WezTerm-based prototype that already does 1–4 with text (TUI)
panes. It's the behaviour reference for the real app — keep it working until
Deck replaces it.

| File | Role |
|---|---|
| `wezterm.lua` | Tabs, keys, opens/closes side panes per tab, dashboard tab on startup, tab titles |
| `git_graph_pane.py` | Left pane: header (branch, merge target, ahead/behind, upstream, work-tree status) + `git log --graph --all`; commits that will merge are highlighted |
| `claude_activity_pane.py` | Right pane: tails the newest Claude Code session log for the folder |
| `project_dashboard.py` | Dashboard TUI; launches tabs via `wezterm cli spawn` + `send-text` |
| `wezterm-git.zsh` / `wezterm-git.ps1` | Prompt hooks: emit `GIT_REPO`, `GIT_BRANCH` user vars (OSC 1337 SetUserVar) + OSC 7 cwd |
| `projects.json` / `projects.windows.json` | Dashboard config: `command`, `pinned`, `scan`, `depth` |
| `install.sh` / `install.ps1` | Install WezTerm, copy files to `~/.config/wezterm`, hook the shell profile |

### How the prototype fits together
- Shell prompt → hook sets `GIT_REPO`/`GIT_BRANCH` user vars → `user-var-changed`
  in `wezterm.lua` → `sync()` opens activity (right, 30%) then graph (left, 34% of
  the rest) for the tab's **active** pane; repo change closes and reopens them.
- Tool panes mark themselves with user var `GIT_GRAPH_PANE=1` so they're never
  treated as shells. Closing one with `q` keeps it hidden for that repo/tab.
- Panes close by being sent `q` (`pane:send_text('q')`).
- All git calls use `GIT_OPTIONAL_LOCKS=0` so the graph never takes `index.lock`
  while Claude commits. Keep this in Deck.
- Merge target: `git config branch.<b>.mergeTarget` override, else main/master →
  none; dev/develop → main/master; anything else → whichever of dev, develop,
  development, main, master (local first, then origin/) the branch is fewest
  commits ahead of (ties go to dev).

### Claude Code session logs (reverse-engineered — verify against real files)
- Location: `$CLAUDE_CONFIG_DIR` or `~/.claude`, then `projects/<encoded>/<session-id>.jsonl`;
  `<encoded>` = absolute path with every non-alphanumeric char replaced by `-`.
  Worktrees (`<repo>/.claude/worktrees/x`) encode to `<encoded>-…`, so prefix-match.
- One JSON object per line. `type: user|assistant|summary|…`. Assistant
  `message.content[]` blocks: `thinking` (text may be empty/redacted), `text`,
  `tool_use {id,name,input}`. User blocks: `text` or `tool_result {tool_use_id,is_error}`.
  `message.model`, `message.usage` (context = input + cache_read + cache_creation),
  `gitBranch`, `isSidechain`, `isMeta`.
- Sub-agents: `Task`/`Agent` tool_use; newer versions also write
  `<session-id>/subagents/*.jsonl`.
- To-dos: `TodoWrite` input `todos[]`, or `TaskCreate`/`TaskUpdate`.
- Status (working / tool running / waiting on you / idle) is inferred from
  pending tool_use ids + log mtime. It's a heuristic.

### Tested vs not
- Tested (Linux, pty): all three Python panes render, redraw within ~2 s on a new
  commit / new log line, mouse wheel + click parse, clean exit. Lua passes a
  Lua 5.4 syntax check.
- **Not yet tested:** WezTerm itself (pane auto-open/close, dashboard
  double-click → new tab, tab titles), anything on Windows, real Claude Code logs
  on Franco's Mac. Do this first: install with `./install.sh` and use it on
  `/Volumes/wyobi/AccessControl_Guard`.

## Next steps (in order)

1. Smoke-test the prototype on the Mac; fix what breaks. Check a real session log
   under `~/.claude/projects/` against the parser above.
2. Confirm open decisions with Franco (see `docs/DECK.md` → Open decisions).
   Default if he doesn't say: **Electron + xterm.js + node-pty**, unsigned CI
   builds with signing switched on by secrets.
3. Scaffold Deck per `docs/DECK.md`, porting the Python logic (merge-target rules,
   log parser, dashboard scan) to TypeScript with unit tests against fixtures.
4. CI for macOS (arm64 + x64) and Windows x64; signing + notarisation once
   certificates are in place.

## Conventions

- **Never add `Co-Authored-By` lines** to commits or PRs.
- Commit author: Franco Landman <franco.landman@wyobi.com> unless he says to use an
  Effekt Studios address.
- Everything must work on **macOS (Apple silicon) and Windows 11** — no Mac-only
  shortcuts in shared code; keep paths, shells and keys platform-aware.
- Franco's repos: Wyobi under `/Volumes/wyobi`, others under `~/Development`.
- Prefer fixing over only analysing; keep README and this file current when
  behaviour changes.

## Handy commands

```bash
# render panes once, no TTY needed
python3 git_graph_pane.py /path/to/repo --once --width 80 --height 30
CLAUDE_CONFIG_DIR=~/.claude python3 claude_activity_pane.py /path/to/repo --once --width 60 --height 40
python3 project_dashboard.py --once
python3 -m py_compile *.py
./install.sh   # re-install into ~/.config/wezterm after edits
```
