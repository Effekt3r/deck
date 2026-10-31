# Deck M3 — Claude panel Implementation Plan

> **For agentic workers:** REQUIRED SUB-SKILL: Use superpowers:subagent-driven-development (recommended) or superpowers:executing-plans to implement this plan task-by-task. Steps use checkbox (`- [ ]`) syntax for tracking.

**Goal:** A Claude panel on the right of every terminal tab where Claude Code runs or has run: status (working / running a tool / waiting on you / idle / exited), model, context size, branch, session title, the to-do list, sub-agents with their current step, and a feed of prompts, thinking, replies and tool calls — milestone M3 in `docs/DECK.md`.

**Architecture:** The main process finds a folder's session logs, tails the newest one incrementally, and parses it with a TypeScript port of the M0-verified parser in `claude_activity_pane.py`; it pushes snapshots to the renderer when the log changes or the status ages. The renderer draws the panel. Read-only: Deck never writes to Claude's files or sends Claude input.

**Tech Stack:** as M1/M2.

## Ground rules

Everything in the M1/M2 plans' ground rules applies (macOS + Windows 11, sandboxed renderer, Node 22 via `export PATH="$HOME/.nvm/versions/node/v22.19.0/bin:$PATH"`, implementers don't commit, branch `m3-claude-panel` on top of `m2-git-panel`). Also:

- **The log format is documented in `CLAUDE.md` → "Claude Code session logs (verified …)". `claude_activity_pane.py` is the reference implementation** (it was replayed over 145 real sessions with no stale turns, agents or background tasks). Port its behaviour; where this plan and the Python disagree, the Python wins unless the plan says why.
- **Never copy real session logs into the repo or the tests** — they hold client code and prompts. Tests build JSONL with the fixture builder (Task 2, Step 1) in the shapes CLAUDE.md documents.
- Deck never writes under `~/.claude` (or `$CLAUDE_CONFIG_DIR`).

## Spec coverage (DECK.md → Claude panel)

| Requirement | Task |
|---|---|
| Follows the newest session for the folder (and its worktrees); session picker | 2, 4 |
| Status, model, context size, git branch, session title | 2, 4 |
| To-do list, sub-agents with live current step | 2, 4 |
| Feed: prompts, thinking (collapsible), replies (markdown), tool calls with icons and one-line summaries, errors; follow/pause on scroll | 2, 3, 4 |
| Read-only | all |

## File structure

| Path | Responsibility |
|---|---|
| `src/shared/types.ts`, `channels.ts`, `src/preload/index.ts` | `claude` part of the contract (Task 1) |
| `src/main/claude/locator.ts` | Claude's home, folder encoding, a folder's session logs |
| `src/main/claude/tail.ts` | incremental JSONL reading |
| `src/main/claude/session.ts` | the parser: entries → state (port of `Session`) |
| `src/main/claude/describe.ts` | one-line tool summaries (port of `describe_tool`) |
| `src/main/claude/status.ts` | status rules (port of `status()`) |
| `src/main/claude/subagents.ts` | running sub-agents' current step |
| `src/main/claude/snapshot.ts` | state → `ClaudeSnapshot` (caps) |
| `src/main/claude/subscriptions.ts`, `ipc.ts` | follow/pin, watching, status ticks, pushes |
| `src/main/claude/test-log.ts` | fixture builder for tests |
| `src/renderer/src/claude/*` | panel, feed, markdown, session picker |

## Execution waves

- **Wave 1 (coordinator):** Task 1.
- **Wave 2 (parallel):** Agent A: Task 2 (main). Agent B: Tasks 3 → 4 (renderer).
- **Wave 3 (coordinator):** Task 5.

---

### Task 1: Contract (coordinator)

Add to `src/shared/types.ts`:

```ts
export type ClaudeState =
  | 'working'        // a turn is open, no tool pending
  | 'tool'           // a tool is running (detail: its name)
  | 'waiting'        // AskUserQuestion / ExitPlanMode pending (detail: tool name)
  | 'maybe-waiting'  // a tool pending and the log silent > 8 s outside bypass mode (a permission prompt?)
  | 'idle'           // the turn ended
  | 'quiet'          // a turn open but the log silent > 10 min (killed? stuck?)
  | 'exited'         // Claude quit (cost-state)
  | 'error'          // the last thing was an API error (detail: its text)

export interface ClaudeStatus {
  state: ClaudeState
  detail?: string
  /** Sub-agents still running. */
  agents: number
  /** Background shell tasks still running. */
  background: number
}

export interface ClaudeSessionSummary {
  id: string
  /** Absolute path of the .jsonl log. */
  path: string
  /** Custom title (/rename) > AI title > first prompt (first line, 80 chars) > ''. */
  title: string
  /** Log last written, ms since epoch. */
  modified: number
}

export interface ClaudeTodo {
  status: string // 'pending' | 'in_progress' | 'completed' | …
  text: string
}

export interface ClaudeAgent {
  toolUseId: string
  type: string
  description: string
  done: boolean
  failed: boolean
  /** Its latest tool call or reply, while running. */
  step?: string
}

export type ClaudeFeedItem =
  | { kind: 'prompt'; text: string }
  | { kind: 'thinking'; text: string } // '' when the log kept only the signature
  | { kind: 'reply'; text: string } // markdown
  | { kind: 'tool'; id: string; name: string; summary: string; state: 'running' | 'done' | 'error'; error?: string }
  | { kind: 'notice'; text: string; tone: 'info' | 'error' }

export interface ClaudeSnapshot {
  session: ClaudeSessionSummary & {
    model: string // e.g. 'claude-opus-5-5' ('' until the first reply)
    contextTokens: number
    branch: string
    /** Permission mode: 'default', 'bypassPermissions', 'plan', 'acceptEdits', 'auto' or ''. */
    mode: string
    /** e.g. 'PR #31', or null. */
    pr: string | null
  }
  status: ClaudeStatus
  todos: ClaudeTodo[]
  agents: ClaudeAgent[]
  /** Oldest first, at most 300 items; long texts are cut (Task 2). */
  feed: ClaudeFeedItem[]
  /** 'newest' follows the folder's newest session; 'pinned' stays on the one picked. */
  following: 'newest' | 'pinned'
}
```

`DeckApi`:

```ts
  claude: {
    /** Follows the newest session for `folder` (and its worktrees). null: none yet; updates follow when one starts. */
    subscribe(folder: string): Promise<ClaudeSnapshot | null>
    unsubscribe(folder: string): void
    onUpdate(cb: (folder: string, snapshot: ClaudeSnapshot | null) => void): () => void
    /** The folder's sessions, newest first (for the picker). */
    sessions(folder: string): Promise<ClaudeSessionSummary[]>
    /** Follow one session (by id), or the newest again (null). */
    follow(folder: string, sessionId: string | null): Promise<void>
  }
```

`MenuCommand` gains `| { type: 'toggle-claude' }`; channels `claudeSubscribe`, `claudeUnsubscribe`, `claudeUpdate`, `claudeSessions`, `claudeFollow`; preload; View → **Claude Panel** `Cmd+Shift+A` / `Ctrl+Shift+A` (+ `a` in `keys.ts` `MENU_LETTERS`, tests); `TerminalTab.claudeHidden?: boolean`.

---

### Task 2: Main-process Claude backend (Agent A)

**Interfaces:**

```ts
// locator.ts
export function claudeHome(env?: NodeJS.ProcessEnv): string                    // $CLAUDE_CONFIG_DIR or ~/.claude
export function encodeFolder(path: string): string                              // every non-alphanumeric → '-'
/** Logs for `folder` and its Claude worktrees (<encoded>--claude-worktrees-*), newest first. Folder names
 *  are compared case-insensitively (Claude encodes process.cwd(), i.e. on-disk case). */
export function findSessions(folder: string, env?: NodeJS.ProcessEnv): Promise<{ id: string; path: string; modified: number }[]>
/** The project folders that can hold `folder`'s logs (to watch for new sessions). */
export function projectDirs(folder: string, env?: NodeJS.ProcessEnv): Promise<string[]>

// tail.ts
export class JsonlTail {
  constructor(path: string)
  /** Entries appended since the last call (parsed objects; bad lines skipped; a partial last line
   *  waits for its newline; a file that shrank is read again from the start and `reset` is true). */
  read(): Promise<{ entries: unknown[]; reset: boolean }>
}

// session.ts — port of Session in claude_activity_pane.py
export class SessionState {
  constructor(project: string)
  ingest(entry: unknown): void
  // read-only views used by snapshot/status:
  readonly feed: ClaudeFeedItem[]                  // capped at 600 internally (oldest dropped)
  readonly agents: Map<string, { type: string; description: string; id: string | null; done: boolean; failed: boolean }>
  readonly background: Set<string>
  readonly pending: Map<string, string>            // tool_use id → tool name
  todos(): ClaudeTodo[]                            // TodoWrite list, else TaskCreate/TaskUpdate
  model: string; contextTokens: number; branch: string; mode: string; pr: string | null
  customTitle: string; aiTitle: string; firstPrompt: string
  inTurn: boolean; error: string; exited: boolean
}

// describe.ts — port of describe_tool + short_path
export function describeTool(name: string, input: unknown, project: string): string

// status.ts — port of status()
export function claudeStatus(s: SessionState, quietMs: number): ClaudeStatus

// subagents.ts — port of subagent_steps/last_step
export function agentSteps(sessionPath: string, s: SessionState, project: string): Promise<Map<string, string>>

// snapshot.ts
export function buildSnapshot(summary: ClaudeSessionSummary, s: SessionState, quietMs: number,
  steps: Map<string, string>, following: 'newest' | 'pinned'): ClaudeSnapshot

// ipc.ts
export function registerClaudeIpc(): void
```

**Behaviour (port, with the reasons recorded in CLAUDE.md):**
- **Feed** (from `ingest`): human prompts (origin.kind absent or `human`, not `isMeta`; `<pasted_content>` tags stripped; image-only → `[image]`; `<bash-input>` → `! cmd`; `<command-name>` → notice); `queued_command` attachments with `commandMode: 'prompt'` and a human origin → prompt; thinking blocks (empty text kept as `''`); text blocks → reply; `tool_use` → tool item `running` with `describeTool` summary, updated in place to `done`/`error` (with the first line of the error) when its `tool_result` arrives; `[Request interrupted…` → notice (error tone) and the turn ends; `isCompactSummary` skipped, `system/compact_boundary` → notice "conversation compacted"; `system` `informational`/`model_refusal_fallback`/`scheduled_task_fire` → notice; `<task-notification>` (user entry or `queued_command` with `commandMode: 'task-notification'`) → its `<summary>` as a notice (error tone when `failed`) and the agent/background task done; API errors (`isApiErrorMessage`) → notice (error) and `error` set; MCP tool names `mcp__server__tool` shown as `server:tool`.
- **Turn / status:** exactly the Python rules — `inTurn` set by prompts and assistant entries, cleared by `stop_reason: end_turn`, `system/turn_duration`, interrupts, API errors and `cost-state` (which also sets `exited` and clears agents/background); pending tools cleared at turn end. `claudeStatus`: pending `AskUserQuestion`/`ExitPlanMode` → `waiting`; other pending tool → `maybe-waiting` if quiet > 8 s and not an agent tool and mode ≠ `bypassPermissions`, else `tool`; inTurn → `quiet` if quiet > 600 s else `working`; exited → `exited`; error → `error`; else `idle`. `agents`/`background` counts always filled.
- **Agents:** async launches (`toolUseResult.status === 'async_launched'`) stay running until their `<task-notification>`; `SendMessage {to: agentId}` reopens; `TaskStop {task_id}` closes. Steps come from `<session>/subagents/agent-<id>.jsonl`, matched via `agent-<id>.meta.json` `toolUseId` or the agentId.
- **Titles:** custom-title wins over ai-title (`aiTitle`, or `title` for older logs; `summary` entries for pre-2.1 logs), then the first prompt.
- **Context:** input + cache_read + cache_creation tokens of the latest real assistant entry (not `<synthetic>` API errors).
- **Caps for the snapshot:** last 300 feed items; prompt text ≤ 2,000 chars, thinking ≤ 2,000, reply ≤ 8,000, tool summary ≤ 300, error ≤ 300 (cut with `…`).
- **Subscriptions (`subscriptions.ts`, Electron-free and tested with fakes like `src/main/git/subscriptions.ts`):** one watcher per folder, ref-counted per webContents; follows the newest session — when a newer one appears it switches only once the followed log has been quiet for 15 s (two Claude sessions in one folder mustn't flip-flop; the Python's rule) — or the pinned one (`follow(id)`; `follow(null)` back to newest). Re-reads the followed log on change (fs.watch on its project folders, debounced 150 ms) plus a 2 s rescan for new sessions/project folders; a **1 s status tick** recomputes `claudeStatus` from the cached state (no file reading) so `maybe-waiting` / `quiet` / running-agent steps appear without new log lines; pushes only when the snapshot changed (JSON compare). Keep a parsed `SessionState` per log path (≤ 4 cached) so switching back doesn't re-read a 15 MB log. Drop on `destroyed`, `did-start-loading`, `render-process-gone`. Validate arguments; handlers never throw.

- [ ] **Step 1: fixture builder `test-log.ts`.** `makeClaudeHome()` → temp dir to pass as `CLAUDE_CONFIG_DIR`; `sessionLog(home, folder, id?)` returns a writer with methods that append one JSONL line each, in the documented shapes: `prompt(text, opts?)`, `thinking(text?)`, `reply(text, { model, usage, stopReason })`, `toolUse(id, name, input)`, `toolResult(id, { isError?, content?, toolUseResult? })`, `turnDuration()`, `aiTitle(t)`, `customTitle(t)`, `permissionMode(m)`, `prLink(n)`, `queuedPrompt(text)`, `notification({ taskId, toolUseId, status, summary }, { queued? })`, `compactSummary()`, `compactBoundary()`, `apiError(text)`, `costState()`, `raw(obj)`; plus `subagent(id, toolUseId)` writing `agent-<id>.meta.json` and a log writer for it.
- [ ] **Step 2: failing tests**, at least: locator (case-insensitive match of `/Volumes/wyobi/X` against `-Volumes-Wyobi-X`; worktrees included, sibling `-X-Old` not; newest first; `CLAUDE_CONFIG_DIR`); tail (partial line, append, truncation → reset, bad JSON skipped); session — each feed rule above, tool items updated in place, async agent running until its notification (user entry and queued attachment), background Bash, `cost-state` exit, turn end by `end_turn` and by `turn_duration`, titles precedence, API error keeps the model; status — each state including the 8 s / 600 s thresholds and bypass mode; subagent steps via meta.json; snapshot caps; subscriptions — follow newest with the 15 s hysteresis, pin/unpin, status tick pushes `maybe-waiting` without a log change, no push when nothing changed, cleanup.
- [ ] **Step 3: implement** until `npx vitest run src/main/claude` passes and `npx tsc -p tsconfig.node.json --noEmit` is clean. Then a **read-only sanity check against real logs** with a throwaway script (not committed): parse the newest sessions of `~/Development/deck` and `/Volumes/wyobi/AccessControl_Guard` and compare status/title/model/ctx/agent counts with `python3 claude_activity_pane.py <folder> --once --width 100 --height 20`. Report it (no log content in the report beyond titles and counts).

---

### Task 3: Markdown and feed model (Agent B)

**Files:** `src/renderer/src/claude/markdown.ts` (+ test), `src/renderer/src/claude/Markdown.tsx`.

A small, safe markdown renderer for replies: **no HTML is ever injected** (`dangerouslySetInnerHTML` is not used); text becomes React elements.

```ts
export type Block =
  | { type: 'paragraph'; inlines: Inline[] }
  | { type: 'heading'; level: number; inlines: Inline[] }
  | { type: 'code'; lang: string; text: string }
  | { type: 'list'; ordered: boolean; items: Inline[][] }
  | { type: 'quote'; inlines: Inline[] }
  | { type: 'rule' }
  | { type: 'table'; rows: Inline[][][] } // header row first
export type Inline =
  | { type: 'text'; text: string }
  | { type: 'code'; text: string }
  | { type: 'strong' | 'em'; children: Inline[] }
  | { type: 'link'; href: string; children: Inline[] }
export function parseMarkdown(src: string): Block[]
```

Tests: paragraphs split on blank lines; fenced code (```lang … ```) kept verbatim (no inline parsing inside); inline code wins over emphasis (`` `a*b*` ``); `**bold**`, `*em*`/`_em_`; `[text](https://x)` links (only http/https/mailto become links; others stay text); `-`/`*`/`1.` lists; `> quote`; `#…######` headings; `---` rule; GitHub tables; unclosed markers stay literal; a 20 KB reply parses in < 20 ms.

`Markdown.tsx`: renders blocks; links call `window.deck.app.openExternal`; code blocks monospace with horizontal scroll and a copy button (`app.copyText`).

---

### Task 4: Claude panel (Agent B)

**Files:** `src/renderer/src/claude/ClaudePanel.tsx`, `Feed.tsx`, `SessionPicker.tsx`, `panel.css`; `App.tsx` and `styles.css` (layout).

- **Placement:** the workspace becomes `[git panel] [splitter] [terminal] [splitter] [Claude panel]`. The Claude panel shows when `!tab.claudeHidden` and (Claude runs in the tab — `runsClaude(tab.process, tab.title)` from `tabs/title.ts` — or the folder has a session). The folder is `tab.cwd` (Claude's cwd is where it was started; fall back to `vars.GIT_REPO`). Width in `localStorage['deck.claudeWidth']` (default 380 px, 260 px … 45 % of the window), its own splitter (reuse `git/Splitter.tsx`). View → Claude Panel toggles `claudeHidden` on the active tab.
- **Subscription:** the workspace subscribes for the folder while the tab is active (so it knows whether a session exists) and passes the snapshot down; unsubscribes when inactive/unmounted; keeps the last snapshot; listens to `onUpdate` for its folder.
- **Header:** status chip — `✻ working` (violet), `⏺ <tool>` (amber), `◐ waiting on you` / `◐ waiting on you?` (amber), `✓ idle` (teal) with "· N agents running · M background" when non-zero, `? quiet for Nm` (dim; compute N from the snapshot's `modified` and the clock, re-rendered every 15 s), `⏹ exited` (dim), `⚠ <error>` (red); then model (`claude-` stripped), `ctx 84k`, `⎇ branch`, mode (bypass / plan mode / accept edits / auto mode; nothing for default), PR; the title; a ▾ session picker (sessions with titles and ages, the current one ticked, "Follow newest session" at the top; calls `claude.follow`).
- **To-do:** "To-do 1/3", unfinished items first (▸ in progress bold, ○ pending), then a few completed (✓, dim).
- **Agents:** "Agents 1 running · 3 done"; running ones with their type, description and `↳ step`; the last three finished ones (✓ / ✗).
- **Feed** (`Feed.tsx`): newest at the bottom; follows the end while the view is at the bottom, pauses when the user scrolls up and shows "↓ N new" to jump back (like the Python `f`). Prompt: highlighted block (teal edge). Thinking: dim italic, collapsed to two lines with "more"; empty thinking renders as `✻ thinking…`; a header toggle hides all thinking. Reply: `Markdown`. Tool: icon by kind (terminal for Bash, pencil for Edit/Write/MultiEdit/NotebookEdit, eye for Read, magnifier for Grep/Glob/WebSearch, globe for WebFetch, branch for Agent/Task, question for AskUserQuestion, plug for MCP, dot otherwise) + name + summary (ellipsised, full text in the tooltip); a running tool shows a subtle animated dot, an error is red with its message. Notice: dim line (red for errors). Render only what's visible if it's simple (300 items max may be fine without virtualisation — measure; must stay smooth while a turn streams).
- **Empty states:** no session yet ("No Claude Code session in this folder yet. Start `claude` in the terminal."), Claude running but no log yet ("Waiting for Claude's first message…").

---

### Task 5: Integration and verification (coordinator)

- [ ] `registerClaudeIpc()` in `src/main/index.ts`; all checks.
- [ ] Real app: a tab in `~/Development/deck` follows **this very session's log** live (status flips working → tool → working as the coordinator works; feed shows prompts/tool calls; agents appear when subagents are dispatched); AccessControl_Guard shows its newest session with the right title/model/ctx; the session picker lists sessions and pinning works; `claude` exiting shows `⏹ exited`; ⌘⇧A toggles; no CPU when idle beyond the 1 s status tick (no file reads).
- [ ] Review (superpowers:code-reviewer), fixes, docs (README, CLAUDE.md), PR against `m2-git-panel`.
