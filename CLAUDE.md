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
  the rest) for the tab's **active** pane. A repo change sends the old panes `q`
  and opens the new ones only once they've exited (`wezterm.time.call_after`
  polling); splitting earlier leaves the layout mis-sized.
- Tool panes mark themselves with user var `GIT_GRAPH_PANE=1` so they're never
  treated as shells. Side panes also set `SIDE_PANE=graph|activity` and
  `SIDE_REPO=<repo>`: a config reload (every `./install.sh` while WezTerm runs)
  resets the Lua tables, and `state()` re-adopts the open panes from these vars
  instead of opening duplicates. The dashboard's panes for non-git folders are
  found the same way. Closing one with `q` keeps it hidden for that repo/tab.
- Panes close by being sent `q` (`pane:send_text('q')`).
- `wezterm cli` must be the `wezterm` binary in `$WEZTERM_EXECUTABLE_DIR`:
  `$WEZTERM_EXECUTABLE` is `wezterm-gui`, which has no `cli` subcommand.
- Tab title: repo + Claude's own terminal title while Claude runs, else the
  branch. Claude is detected from the foreground process path (`…/claude-code/bin/claude.exe`
  for npm, `~/.local/share/claude/versions/<v>` native), not the title: Claude's
  title is `✳ <session title>` when idle but spinner glyphs (`◐ ◑ …`) while working.
  With a side pane focused, the title still describes the tab's shell.
- All git calls use `GIT_OPTIONAL_LOCKS=0` so the graph never takes `index.lock`
  while Claude commits. Keep this in Deck.
- Merge target: `git config branch.<b>.mergeTarget` override, else main/master →
  none; dev/develop → main/master; anything else → whichever of dev, develop,
  development, main, master the branch is fewest commits ahead of (ties go to
  dev). Each name resolves to the local branch, unless that's missing or just a
  stale copy of `origin/<name>` (an ancestor of it), then to `origin/<name>`:
  PRs merge on the remote, and a local main 75 commits behind made
  AccessControl_Guard show "76 to merge" instead of 1.

### Claude Code session logs (verified 2026-10-30: Claude Code 2.1.283, 145 sessions on Franco's Mac)
- Location: `$CLAUDE_CONFIG_DIR` or `~/.claude`, then `projects/<encoded>/<session-id>.jsonl`;
  `<encoded>` = cwd with every non-alphanumeric char replaced by `-`. The cwd is
  `process.cwd()`, i.e. **on-disk case**: `/Volumes/wyobi/AccessControl_Guard`
  logs to `-Volumes-Wyobi-AccessControl-Guard` (the volume is `Wyobi`, case-sensitive
  APFS), so match folder names case-insensitively. Worktrees
  (`<repo>/.claude/worktrees/<name>`) encode to `<encoded>--claude-worktrees-<name>`;
  match that exact prefix (a bare `<encoded>-` prefix also catches sibling repos).
- Next to the log: `<session-id>/subagents/agent-<agentId>.jsonl` plus
  `agent-<agentId>.meta.json` `{agentType, description, toolUseId, model}`;
  `<session-id>/tool-results/`; `memory/`. With `--remote-control` the log is
  created at startup, so the newest session may have no prompts yet.
- One JSON object per line. Types seen: `user`, `assistant`, `system`,
  `attachment`, `ai-title {aiTitle}`, `custom-title {customTitle}` (wins),
  `permission-mode {permissionMode}`, `pr-link {prNumber, prUrl}`, `queue-operation`,
  `last-prompt`, `mode`, `cost-state` (written as Claude exits), `bridge-session`,
  `agent-name`, `file-history-*`, `relocated`, `atis-latch`. **No `summary` entries.**
- Assistant: one content block per line (`message.id` repeats), `thinking`
  (text empty in 85% — signature only), `text`, `tool_use {id,name,input}`;
  `stop_reason: end_turn` on a turn's last block. `message.model`, `message.usage`
  (context = input + cache_read + cache_creation). `isApiErrorMessage` marks a
  synthetic reply (model `<synthetic>`, e.g. `error: rate_limit`).
- User: content string or blocks (`text`, `tool_result {tool_use_id,is_error}`, `image`),
  structured `toolUseResult`, `isMeta`, `isCompactSummary`. `origin.kind` says who
  wrote it: `human` (absent in older logs), `task-notification`, `peer` (another
  session/agent), `auto-continuation`, `coordinator`. Only `human` is a prompt;
  human prompts can start with `<pasted_content …>`.
- Turn end: `end_turn`, then `system` `stop_hook_summary` + `turn_duration`.
  Other `system` subtypes: `compact_boundary`, `informational` (usage limits),
  `local_command`, `bridge_status`, `away_summary`, `scheduled_task_fire`,
  `model_refusal_fallback`.
- Sub-agents: tool `Agent` (`Task` before). 94% return at once with
  `toolUseResult {status: "async_launched", agentId}`, even without
  `run_in_background`; the end is a `<task-notification>` (`<task-id>`=agentId,
  `<tool-use-id>`, `<status>` completed|failed, `<summary>`). It arrives as a user
  entry, or, while Claude is busy, as `attachment` `queued_command` with
  `commandMode: "task-notification"`. Background Bash works the same way
  (`toolUseResult.backgroundTaskId`). `SendMessage {to: agentId}` resumes an
  agent; `TaskStop {task_id}` stops one; tasks still running at exit get no
  notification.
- Prompts typed while Claude works: `attachment` `queued_command`
  (`commandMode: "prompt"`) when taken in mid-turn, else a later user entry.
- To-dos: `TodoWrite` `todos[]` / `TaskCreate`+`TaskUpdate` — **not seen in any of
  these logs**, so that handling is still unverified.
- Status: working = turn open; tool running = pending tool_use; waiting on you =
  pending `AskUserQuestion`/`ExitPlanMode` (certain) or any pending tool after 8 s
  of silence outside bypass mode (heuristic: permission prompts aren't logged);
  idle = turn ended; exited = `cost-state`.

### Tested vs not
- Tested on Franco's Mac (macOS, WezTerm 20240203, Claude Code 2.1.283), against
  `/Volumes/wyobi/AccessControl_Guard`: dashboard on startup, real double-click →
  Claude tab with both side panes, panes closing on `cd` out and reopening on
  `cd` back or into another repo, `q`, Cmd+Shift+G/A, config reload without
  duplicates, tab titles (idle, working, after exit, side pane focused), and the
  activity pane live through prompt → thinking → Bash → reply → idle → exited.
  The parser was replayed over all 145 local session logs: no exceptions, and no
  turn, agent or background task left open in finished sessions.
- **Not yet tested:** anything on Windows; `TodoWrite`/`TaskCreate` logs; the
  "waiting on you?" guess outside bypass mode.

## Next steps (in order)

1. ~~Smoke-test the prototype on the Mac; fix what breaks. Check a real session log
   under `~/.claude/projects/` against the parser above.~~ Done (M0, 2026-10-30).
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

Driving WezTerm from a Claude Code shell (for testing):
- `open -a WezTerm` passes your environment on, including `CLAUDECODE=1` and the
  session ids, so a `claude` started inside would act as a nested child. Launch it
  clean: `env -i HOME="$HOME" USER="$USER" SHELL="$SHELL" TMPDIR="$TMPDIR" PATH=/usr/bin:/bin open -a WezTerm`.
- Outside WezTerm, `wezterm cli` auto-starts a separate mux server if it can't
  reach the GUI. Use `WEZTERM_UNIX_SOCKET=~/.local/share/wezterm/gui-sock-<pid> wezterm cli --no-auto-start …`.
- `cliclick dc:x,y` gives a real double-click; `screencapture -l <window id>` grabs
  the window (Terminal has Accessibility + Screen Recording). Text sent to Claude
  in one burst counts as a paste, so press Return as a real key
  (`osascript -e 'tell app "System Events" to key code 36'`).
