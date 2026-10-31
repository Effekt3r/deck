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

## Current state

**Deck app: M3 done** (2026-10-31): Electron app with:
- the Projects tab, terminal tabs and shell integration (M1, merged in PR #1);
- the git panel (M2, PR #2);
- the Claude panel (M3, branch `m3-claude-panel` on top of `m2-git-panel`).

Signed builds (M4) and polish (M5) are next. Plans that built them:
`docs/superpowers/plans/2026-10-30-m1-electron-shell.md`, `…/2026-10-31-m2-git-panel.md`,
`…/2026-10-31-m3-claude-panel.md`.

| Path | Role |
|---|---|
| `src/shared/` | `DeckApi` IPC contract (`types.ts`) and channel names; the only thing main and renderer share |
| `src/preload/index.ts` | exposes `window.deck`; sandboxed, requires only `electron` |
| `src/main/index.ts` | lifecycle, single instance + `--open <folder>`, IPC wiring; `window.ts`, `menu.ts` (platform shortcuts → `MenuCommand`) |
| `src/main/shell/` | `shellLaunch()` (which shell/args/env, pure), zsh `ZDOTDIR` wrappers + `deck.zsh`, PowerShell `deck.ps1`, installed to userData |
| `src/main/pty/` | node-pty sessions, output batching, startup command typed when the line editor is ready |
| `src/main/projects/` | `projects.json` (userData), scan, `.git/HEAD` branch, dirty counts, native context menu |
| `src/main/git/` | the git runner (the only way Deck runs git), header summary, merge target, graph log, commit details, watcher + poll probe, merge-target overrides, `git:*` subscriptions |
| `src/main/claude/` | session-log locator, incremental tail, the parser (TS port of `claude_activity_pane.py`), status rules, sub-agent steps, `claude:*` subscriptions |
| `src/renderer/src/` | React: `tabs/` (model, titles, tab bar), `terminal/` (xterm view, OSC parsing, keys, search), `projects/`, `git/` (lane layout, canvas graph view, panel, details, splitter), `claude/` (panel, feed, markdown, session picker) |

Things that aren't obvious from the code:
- The app scrubs a parent Claude Code session's variables (`CLAUDECODE`, session
  ids, messaging socket, `GIT_EDITOR=true`) from shells, so starting Deck from a
  Claude shell doesn't make its `claude` a nested child.
- The tab's command is typed when zsh's line editor turns on bracketed paste
  (`ESC[?2004h`) after the prompt mark. Typing at the mark echoed it twice, and
  zsh gets no blind timeout because it would type into oh-my-zsh's update question.
- node-pty 1.1.0 publishes its macOS `spawn-helper` without the execute bit;
  `scripts/postinstall.mjs` fixes it, or every spawn fails with `posix_spawnp failed`.
- PowerShell loads the hook as `try { . 'deck.ps1' } catch {}`, not with
  `-ExecutionPolicy Bypass` (security tools flag it), so Windows PowerShell 5.1
  under its default Restricted policy runs without integration; pwsh 7 is fine.
- The second instance's `argv` can be reordered, so `--open` travels in
  `requestSingleInstanceLock` additionalData.
- At a prompt the tab title is the folder: the shell's own idle title (oh-my-zsh's
  `user@host:dir`) is dropped when `GIT_REPO` arrives.
- Off macOS, Electron menu accelerators only fire for keys the page leaves alone,
  so `terminal/keys.ts` returns `'menu'` for Deck's own Ctrl+Shift shortcuts and
  Ctrl+Tab. Never bind Ctrl+Alt (AltGr on German/French layouts); match keys by
  `e.code`. `menu.test.ts` enforces both for Windows.
- Flow control: the renderer acks output from xterm's write callback and main
  pauses a pty above 100k unacknowledged chars (resumes below 10k). Anything
  that writes to xterm must ack, or that tab freezes.
- `ipcMain.on` listeners check their arguments and pty calls are guarded: a throw
  in a listener shows a modal error dialog (node-pty throws on a pty whose shell
  just exited).
- Git panel: Deck never writes to a repo or fetches. The merge-target override
  lives in userData (`git-targets.json`), never in `.git/config`. Every git call
  goes through `src/main/git/runner.ts`, which sets `GIT_NO_LAZY_FETCH` so a
  partial clone's commit details don't download blobs (they did, in review). `--exclude=refs/stash` must come **before**
  `--all`, or the stash is listed (likewise notes, prefetch and original refs, which aren't branches). The log asks for full ref names
  (`--decorate=full`), because a local branch can be called `origin/foo`. Git dirs
  go through realpath (`/Volumes/wyobi` vs `Wyobi`). A 3 s poll runs one probe
  (`git status` plus key git-dir file times) and rebuilds only when it changes:
  rebuilding the whole snapshot each poll cost ~12% of a core on
  AccessControl_Guard.
- Claude panel:
  - **Parser:** `claude_activity_pane.py` stays the reference;
    `src/main/claude/session.ts` ports it, and replaying all local logs through
    both must give the same final state.
  - **Which session:** the tab's folder is `tab.cwd` (where Claude was started;
    zsh also reports it on `cd`, so `cd x && claude` watches `x`; PowerShell
    reports only at the prompt). Each tab remembers the session its panel showed
    and whether it was pinned (`TerminalTab.claudeSession`), and sends it back with
    `claude.subscribe` on every tab switch: a pin stays pinned; an unpinned session
    stays until it has been quiet for 15 s while a newer one exists, so two
    sessions in one folder don't flip-flop. New tabs, and Claude starting in a tab,
    follow the newest. Known limit: with two Claudes in one folder, a newly started
    one takes over a tab only once the shown session has been quiet for 15 s.
  - **Ordering:** the renderer ignores updates that arrive before its subscribe
    answer, so a push still on its way for another tab can't win.
  - **Tools with no result:** they end as `interrupted` (interrupt, API error,
    exit) or `done` (normal turn end).
  - **Memory:** kept text is copied (`own()` in `describe.ts`). V8's string slices
    keep the whole original alive: 98 MB for 200 cut 500 KB texts.
  - **Updates:** a 1 s tick re-evaluates status from cached state without reading
    files, which is how "waiting on you?" appears without new log lines.
  - **Snapshot size:** capped at 300 feed items with long texts cut.
  - **Markdown:** becomes React elements, never HTML.
  - **Config dir:** `CLAUDE_CONFIG_DIR` is read from the main process's
    environment, so one set only in shell profiles isn't seen when Deck starts
    from Finder.

**WezTerm prototype (v0):** does 1–4 with text (TUI) panes. It's the behaviour
reference for M2/M3; keep it working until Deck replaces it.

| File | Role |
|---|---|
| `wezterm.lua` | Tabs, keys, opens/closes side panes per tab, dashboard tab on startup, tab titles |
| `git_graph_pane.py` | Left pane: header (branch, merge target, ahead/behind, upstream, work-tree status) + `git log --graph --all`; commits that will merge are highlighted |
| `claude_activity_pane.py` | Right pane: tails the newest Claude Code session log for the folder |
| `project_dashboard.py` | Dashboard TUI; launches tabs via `wezterm cli spawn` + `send-text` |
| `wezterm-git.zsh` / `wezterm-git.ps1` | Prompt hooks: emit `GIT_REPO`, `GIT_BRANCH` user vars (OSC 1337 SetUserVar) + OSC 7 cwd |
| `projects.json` / `projects.windows.json` | Dashboard config: `command`, `pinned`, `scan`, `depth` |
| `install.sh` / `install.ps1` | Install WezTerm, copy files to `~/.config/wezterm`, hook the shell profile |

### Branding and packaging (ready for the Electron app)
| Path | Role |
|---|---|
| `branding/generate.py` | Regenerates every icon/installer image from SVG; see `branding/README.md` |
| `build/icon.icns` / `icon.ico` / `icon.png` / `icons/` | App icons (Mac full iconutil slot set, Windows 16–256, Linux PNGs) |
| `build/background*.png` | DMG window (app at x180, Applications at x480, y215) |
| `build/installer*.bmp`, `uninstallerSidebar.bmp`, `installer.nsh`, `license.txt` | NSIS installer art, "Open in Deck" folder context menu, EULA (have Franco review) |
| `build/trayTemplate*.png`, `tray.*` | Menu-bar / tray icons |
| `build/entitlements.mac.plist` | Hardened-runtime entitlements (JIT, node-pty, network) |
| `electron-builder.yml` | Mac dmg+zip (arm64/x64, notarised), Windows NSIS (x64; arm64 later), GitHub publish |
| `.github/workflows/release.yml` | Tag `v*` or manual run → one draft release (notes from `CHANGELOG.md`); signs when secrets exist |

The NSIS include passes `--open "<folder>"`: the app must handle that argument
(open a tab in that folder). Bundle id `com.effektstudios.deck` is confirmed.
`build/` is un-ignored in `.gitignore` because Franco's global gitignore
excludes every `build` folder.

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
2. ~~Confirm open decisions with Franco.~~ Done 2026-10-30, recorded in
   `docs/DECK.md` → Decisions: Electron + xterm.js + node-pty, Apple Developer ID
   (no Windows signing yet), GitHub Actions, `com.effektstudios.deck`, the
   branch + chevron icon in `branding/`.
3. ~~Scaffold Deck and build M1 (tabs, terminal, shell integration, Projects tab;
   the dashboard scan is ported).~~ Done 2026-10-30. ~~M2 git panel. M3 Claude
   panel.~~ Done 2026-10-31. Tests build session logs with
   `src/main/claude/test-log.ts`; never copy real session logs into the repo (they
   hold client code and prompts). On screen (macOS, 2026-10-31): both panels,
   splitter drags, View menu and ⌘⇧G / ⌘⇧A checked. **Next:** Windows 11 with
   `docs/TESTING.md` on v0.2.0, a Windows signing route (M4), then M5 (settings
   UI, notifications, auto-update).
4. CI for macOS (arm64 + x64) and Windows x64: `release.yml` signs and notarises
   the Mac build (secrets set 2026-10-31; first signed build v0.2.0). Windows stays
   unsigned until there's a signing route. `ci.yml` runs typecheck + tests on
   macOS and Windows for pull requests. **Releasing:** bump `version` in
   `package.json`, add its `CHANGELOG.md` section, merge, then
   `gh workflow run release.yml --ref main` (or push the tag `v<version>`), check
   the draft and publish it. The build jobs only upload artifacts; the release
   job makes the one draft (two builders publishing at once each made their own).
   A Keychain-exported `.p12` uses old ciphers: OpenSSL 3 reads it only with
   `openssl pkcs12 -legacy`.

Deferred from the M1 review (`3f9feb6` fixed the important ones):
- **Windows, untested:**
  - PowerShell may decode the hook's git output in the console code page, which
    would garble non-ASCII repo paths; switch to UTF-8 around the calls.
  - Launch pwsh by absolute path (`where pwsh`): a `pwsh.exe` in the current folder wins.
  - The hook's `'` escaping misses `‘ ’`.
  - Dropping a folder on the Dock icon needs folder document types in `mac.extendInfo`.
- **Startup command:** zsh has no fallback when the hook never loads (`/etc/zshenv`
  setting ZDOTDIR, `exec tmux` in `.zshrc`); show a hint after ~10 s. Consider
  cancelling it when the user types first; xterm's own replies (DA, cursor
  reports) go through the same path, so filter those out.
- **Main:**
  - If shell-integration install fails, start without it rather than with no window.
  - Async `stat` in IPC.
  - Reload the window after a renderer crash.
- **Projects:**
  - An invalid `projects.json` is replaced by defaults on the next save (keep a backup).
  - The scan has no concurrency limit and refreshes can overlap.
  - Reftable repos show `.invalid` as the branch.
- **Renderer:** route pty events from one listener; memoize `ProjectsView`. Decide
  whether Shift+Enter → `ESC CR` should apply only in tabs running Claude, and add
  close confirmations (M5).
- **Tests:** a `deck.ps1` test with Homebrew `pwsh`; the zsh test covers `-i -c`, not `-l`.
- **Accepted risk (M2 review):** `git status` runs clean/filter drivers that a
  repo's own `.git/config` defines. It's used for the header counts, the 3 s poll
  probe and the Projects scan. That's the same exposure as a git-aware shell prompt
  (oh-my-zsh runs status at every prompt), and only a repo whose `.git` came from
  someone else (e.g. an archive) carries such drivers. Also, any program's output
  can set `GIT_REPO` with OSC 1337 and point the panel at another folder. For M4:
  a filter-free probe (`diff-files` + `ls-files -o`), and a per-session nonce on
  the shell-integration sequences, as VS Code does.
- **M2 follow-ups:**
  - **Rebuilds:** rebuild only what changed (a work-tree-only change needs just
    `git status`, not the log); resolve merge-target candidates with one `for-each-ref`.
  - **Tab switches and background:** keep a repo's watcher alive a few seconds after
    a tab switch; pause polls while the window is hidden.
  - **Paging:** an update re-reads at most 9 extra pages, so very deep scrolling
    resets. Move the paging logic into a tested module and the page constants into `@shared`.
  - **Graph data:** hundreds of long-lived lanes cost memory (pass-through lines per
    row). A `\x1e`/`\x1f` in commit text drops that commit (use NUL-separated records).
  - **Overrides:** keyed by work-tree root, so worktrees don't share pins; key by the common dir.
  - **Splitter drag:** resizes the pty on every column; check with Claude running and
    consider resizing at drag end.
  - **Code tidy:** two `countStatus` with different rules (projects vs git panel);
    `symbolic-ref` runs twice per snapshot.
  - **Windows:** a repo path with non-ASCII characters may hit the PowerShell
    code-page issue above as "Not a git repository".
- **Security (M4):**
  - Check the IPC sender frame.
  - Load the renderer from a custom protocol, not `file://`.
  - Deny permission requests.
  - Set Electron fuses, after moving node-pty into a `utilityProcess` (its Windows
    kill runs Electron as Node).

## Conventions

- **Never add `Co-Authored-By` lines** to commits or PRs.
- Commit author: Franco Landman <franco@effektstudios.com> (from 2026-10-30;
  the first three commits used franco.landman@wyobi.com). His global git email
  is the outlook.com one, so set it per commit: `git -c user.email=franco@effektstudios.com commit …`.
- Everything must work on **macOS (Apple silicon) and Windows 11** — no Mac-only
  shortcuts in shared code; keep paths, shells and keys platform-aware.
- Franco's repos: Wyobi under `/Volumes/wyobi`, others under `~/Development`.
- Prefer fixing over only analysing; keep README and this file current when
  behaviour changes.

## Handy commands

```bash
# Deck app (Node 22: export PATH="$HOME/.nvm/versions/node/v22.19.0/bin:$PATH" or `nvm use`)
npm test && npm run typecheck && npm run build
npm run dev                                   # the app, with renderer hot reload
npx electron-vite dev --remoteDebuggingPort 9333   # + DevTools protocol for scripted checks
# unsigned packaged app (never let it sign with whatever identity is in the keychain)
CSC_IDENTITY_AUTO_DISCOVERY=false npx electron-builder --mac --dir --arm64 -c.mac.notarize=false -c.mac.identity=null
```

Checking the running app from a shell: with `--remoteDebuggingPort`, fetch
`http://127.0.0.1:9333/json`, open the page's `webSocketDebuggerUrl` (Node 22 has
`WebSocket`) and send `Runtime.evaluate` to read tab titles or row counts. The
terminal itself is a WebGL canvas, so to read a shell's state, type a command
that writes to a file. The dev app runs as process "Electron", the packaged one as
"Deck"; both use the same userData, so quit one before starting the other.

```bash
# render prototype panes once, no TTY needed
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
