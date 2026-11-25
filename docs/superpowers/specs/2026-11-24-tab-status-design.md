# Tabs: Claude's status, and reordering: design

2026-11-24. Franco asked: "two things that need fixing, tab names at the top don't refresh if I dont
have the tab open, also I would like to be able to reorder the tabs at the top by dragging. then
let's show a notification or color on the tabs when claude needs our input, if done then green,
input needed is amber - lets see what you can do". The choices below were made without a round of
questions; review them here. His other request from the same day, starting and stopping emulators
and simulators, has its own spec (`2026-11-24-device-start-stop-design.md`).

## Goal

- A background tab shows what its Claude is doing, as the front tab does.
- Terminal tabs can be dragged into a new order.
- A tab shows when its Claude needs Franco (amber) and when it finished something he hasn't seen
  yet (green).

## Why background tabs look stuck

Measured 2026-11-24 (Claude Code 2.1.283, Deck 0.5.0):

- **Claude's title:** Claude Code sets the terminal title to a status glyph and the session's name:
  `✳ Fix the login screen` when idle, `◐` and `◑` in turn every 960 ms while it works. The name is
  the `/rename` title, else the AI title, else `Claude Code`.
- **Animated only with focus:** Claude Code runs that 960 ms timer only while its terminal has focus
  (its title component skips the timer when `useTerminalFocus()` is false). Claude turns on focus
  reporting (`ESC[?1004h`), so xterm tells each tab's Claude when the tab gains or loses focus. In
  every tab but the front one, Claude sits on whichever frame it had.
- **Changes still arrive:**
  - Claude: a `claude` in a pseudo-terminal that had been told it lost focus still sent
    `◐ probe-blurred`, then `✳ probe-blurred`, when its state changed (a local `/rename`, so no
    tokens).
  - Deck: a shell printing a new title every second in a background tab moved that tab's name
    every second (dev build, read through the DevTools protocol).
- **So:** while Claude works, a background tab's `◐` stops moving. When it finishes, the name changes
  by one character (`◐` → `✳`), which is easy to miss. And the glyph can't say "waiting for you": a
  permission prompt looks like work.

The fix is the status below. Deck draws each tab's status itself, from a source that doesn't depend
on focus, and drops Claude's glyph from the name while it does. (If what Franco saw was something
else, such as a session's name itself staying old, these findings don't explain it: say so.)

## Where the status comes from

- **Claude Code's presence files:**
  - **What they are:** each running Claude Code keeps `<claude home>/sessions/<pid>.json`, where the
    home is `$CLAUDE_CONFIG_DIR` or `~/.claude`, and removes the file when it exits. Its own error
    message calls this the "session presence PID file".
  - **Example (2.1.283):**
    `{"pid":13508,"sessionId":"53b8…","cwd":"/Volumes/Wyobi/AccessControl_ios","procStart":"Mon Nov 23 04:16:43 2026","kind":"interactive","status":"busy","statusUpdatedAt":…, …}`.
    While Claude waits, the file also has `"waitingFor"`.
- **`status`**, as Claude Code's source sets it:
  - `busy`: a turn is running, or work Claude handed off is (a sub-agent, a teammate);
  - `waiting`: something on Claude's screen needs the user, and `waitingFor` says what. The values
    are the open dialog's own words (a permission or a question), `input needed` (an MCP server
    asking), `sandbox request`, `dialog open` (a local command's dialog, like `/config`) and
    `goal proposal`;
  - `idle`: the turn ended;
  - `shell`: idle, with a background shell still running (a dev server). Deck treats it as idle;
    otherwise a tab running a dev server would look busy for hours.
- **Checked against the logs** (2026-11-24, the six Claudes on this Mac):
  - the four `busy` ones were mid-turn;
  - a fifth was `busy` after its turn ended, because it had just sent work to an agent;
  - the `idle` one had ended its turn;
  - after `/exit`, the file was gone.
- **Better than the log:** permission prompts aren't logged, so the Claude panel's "waiting on you?"
  is a guess (a pending tool after 8 s of silence). The presence file knows.
- **What Deck reads:** files named `<digits>.json`, at most 64 KB each, and only the fields below. It
  never opens the `<pid>.<hash>.key` files beside them, which hold the keys for Claude's peer
  messaging.
- **Undocumented:** like the session logs, these are Claude Code's own files. If a version drops or
  changes them, tabs show no status and keep Claude's glyph in their names, as today.

### Which tab a Claude belongs to

- **macOS and Linux, by process:**
  - **The rule:** a tab's shell is its pty's process (node-pty's `pid`), and a Claude started in the
    tab is that shell's child. Checked: each of the five Claudes in Franco's Deck was a child of its
    tab's zsh.
  - **How:** when a presence file appears with a pid main hasn't seen, main runs
    `ps -A -o pid=,ppid=,lstart=` (20 ms, with 1,300 processes running) and walks up from Claude's
    pid to a tab's shell. It walks at most 8 steps, so a Claude started by a wrapper script still
    counts.
  - **Reused pids:** `procStart` is the process's start time (`ps`'s `lstart`) in UTC. With
    `TZ=UTC LC_ALL=C`, `ps` printed exactly the `Tue Nov 24 06:01:36 2026` that a file said. So a
    file whose Claude died without removing it is ignored, whether its pid is gone or now belongs to
    another process.
  - **A Claude inside Claude:** a `claude -p` run by Claude's Bash tool also descends from the tab's
    shell. The one nearest the shell is the tab's.
- **Windows, by folder:**
  - **Why:** Windows has no `ps`, and asking WMI for parent processes means starting PowerShell.
  - **The rule:** a presence file belongs to a tab when its `cwd` is the tab's folder (ignoring case
    and slash direction), the tab runs Claude, and this is the only such tab and file for that
    folder. With two Claudes in one folder, neither tab gets a status.
  - **Unverified:** whether Claude Code writes presence files on Windows at all.
- **Only while the tab runs Claude:** a tab shows a status only while its name says Claude runs in
  it (the same test: the foreground process, else Claude's title). So a file left by a killed Claude,
  whose pid was later reused, can't keep a status on a tab whose shell is back at its prompt.
- **Liveness:** every poll also checks each presence file's pid with `process.kill(pid, 0)`, which
  sends no signal. A file whose process has gone stops counting at once (Claude removes its file
  itself on a normal exit; one killed outright leaves it behind).

## What the user sees

### A tab's status

A terminal tab where Claude runs gets a mark before its name. Two of the states also colour the
tab's top edge, using the 2 px top border every tab already has (transparent until now):

| Claude | Mark | Top edge | Tooltip line |
|---|---|---|---|
| working | a turning ring, violet | – | "Claude is working" |
| needs you | a dot with a slow pulse, amber | amber | "Claude needs you" and what it waits on, e.g. "(dialog open)" |
| finished, not yet seen | a check mark ✓, green | green | "Claude finished" |
| idle and seen, or not running | none | – | – |

- **Shapes as well as colours:** a ring, a dot and a check. Amber and green are hard to tell apart
  with red-green colour blindness, so colour never carries the state alone.
- **Colours:**
  - violet is the Claude panel's "working" colour, and amber the app's (`--violet`, `--amber`);
  - green is the Claude panel's `#9ece6a`, moved to `:root` as `--green`;
  - not teal: teal already marks the front tab's bottom edge.
- **Seen:** a tab is seen while it's the front tab and Deck's window has focus.
  - **Turning green:** a turn ends (working or needs you, then idle) while its tab isn't seen. It
    stays green until the tab is seen.
  - **Not turning green:** a turn that ends in the tab you're looking at.
  - **Coming back to Deck** with the green tab in front clears it.
- **Needs you** shows whether or not the tab is seen: it's a state, not news. It goes when the
  dialog does.
- **Reduced motion:** the ring and the pulse stand still.
- **Accessible names:** the mark carries the tooltip's words.
- **No status for a tab** (an older Claude Code, Claude under tmux, two Claudes in one folder on
  Windows): no mark, and the name keeps Claude's glyph, as today.

### The name

- While Deck knows a tab's Claude (its presence file matched the tab), the name drops Claude's
  leading glyph, whether or not a mark shows: `deck · Fix the login screen`, not
  `deck · ◐ Fix the login screen`. Dropping it only while a mark shows would make the glyph come and
  go with the mark. The window title does the same.
- Otherwise the name is built as before: repo · Claude's title while Claude runs, else
  repo ⎇ branch, else the terminal's title or the folder.

### The Dock and the taskbar

- **macOS:** the Dock icon's badge counts the tabs that need you, and shows nothing at zero. When
  that count goes up while Deck isn't the front app, the icon bounces once (`informational`).
- **Windows:** when the count goes up while Deck isn't in front, its taskbar button flashes until
  Deck comes to the front.
- **No banner notifications:** they'd need the user's permission, and Claude Code can send its own.

### Reordering

- **Dragging:**
  - **Start:** press on a terminal tab and move more than 4 px sideways. The tab follows the pointer
    and the others slide aside (120 ms) to show where it will land.
  - **Drop:** releasing puts it there. Esc, a lost pointer, or Deck's window losing focus puts it
    back.
  - **The Projects tab** stays first: it doesn't move, and nothing lands before it.
  - **Front tab:** the dragged tab comes to the front, as in browsers.
  - **Keyboard:** the terminal keeps it throughout, as it does for clicks on the tab bar today.
  - **Long strips:** near either end of a strip too long for the bar, the strip scrolls (up to 8 px
    a frame).
  - **Clicks** are unchanged: one without movement activates the tab, and a middle click closes it.
- **Keys:**
  - **Menu:** Window → Move Tab Left and Move Tab Right move the front tab one place.
  - **Windows:** Ctrl+Shift+PageUp and Ctrl+Shift+PageDown, as in Chrome and Edge.
  - **macOS:** no shortcut, because Cmd+Shift+←/→ select text on a device's screen. System Settings →
    Keyboard → Keyboard Shortcuts → App Shortcuts can give the menu items one.
- **Cmd+1…9** (Ctrl+Shift+1…9 on Windows) follow the new order. The order lasts as long as the tabs:
  Deck doesn't reopen tabs after a restart.

## How

### Main

- **`src/main/claude/presence.ts`:**
  - **`readPresence(home)`:** reads `<home>/sessions/<digits>.json` and checks each file:
    - `pid` must be a positive integer, and `cwd` and `sessionId` strings;
    - `status` must be one of the four, else the file is skipped;
    - `waitingFor` and `procStart` must be strings when present;
    - broken JSON (caught mid-write) is skipped this time.
  - **`matchProcesses(entries, shells, table)`** (pure):
    - takes `table` (pid → {ppid, lstart}) and `shells` (shell pid → pty id);
    - gives each entry its pty id, or none;
    - drops entries whose pid is gone, or whose `lstart` isn't their `procStart`;
    - gives each pty only the entry nearest its shell.
  - **`PresenceWatch`:**
    - watches `<home>/sessions` with `watchDirs` and polls every 2 s. The poll only stats; a file is
      read again when its size or time changes;
    - runs `ps` (macOS, Linux) when a pid it hasn't seen appears, with `TZ=UTC LC_ALL=C`, a 5 s
      timeout and its output capped;
    - drops a file whose pid `process.kill(pid, 0)` finds gone;
    - publishes the list when it changes;
    - starts with the window and stops at quit.
- **`PtyManager.shells()`:** shell pid → pty id, for the matching.
- **IPC:**
  - `claude:presence` (invoke: the list now) and `claude:presence-changed` (push);
  - `ClaudePresence` in `types.ts`:
    `{ pid, sessionId, cwd, state: 'working' | 'waiting' | 'idle', waitingFor?, ptyId? }`.
- **The Dock and taskbar:** `app:attention` (renderer → main, the number of tabs that need you)
  drives `app.dock.setBadge`, `app.dock.bounce('informational')` and `win.flashFrame`.

### Renderer

- **`tabs/attention.ts`** (pure):
  - `presenceFor(tab, list, platform)`: by pty id, or on Windows by folder (rules above);
  - `nextAttention(previous, now, seenTab)`: each tab's state, and whether a finished turn is still
    unseen.
- **`tabs/useTabStatus.ts`:**
  - **inputs:** the list (`claude.presence()` and `onPresence`), and the tab being looked at (the
    front tab while the window has focus: `useWindowFocused` in `hooks.ts`);
  - **outputs:** each known tab's status (its mark, if any), and the needs-you count sent to main.
- **`tabs/title.ts`:** `tabTitle(tab, platform, { glyph: false })` drops Claude's glyph.
- **`tabs/tabs.ts`:** a `{ type: 'move'; id; index }` action. It moves terminal tabs only, to an
  index of 1 or more, and keeps the front tab in front.
- **`tabs/drag.ts`** (pure): where a dragged tab lands, from the tabs' positions in the strip, which
  tab is dragged, and the pointer's x.
- **`TabBar.tsx`:** the pointer handling (capture, the 4 px threshold, the slide, Esc), the mark and
  the tooltip.
- **`terminal/keys.ts`** and **`menu.ts`:** the two menu items, and off macOS, Ctrl+Shift+PageUp and
  PageDown go to the menu, not the shell.

## Known limits

- The presence files are undocumented (above).
- A Claude under tmux or screen in a tab isn't matched: its parent is the multiplexer's server.
- Windows matches by folder only, and is untested, like the rest of Deck there.
- Green isn't remembered across a restart.
- A local command that makes Claude busy for a moment (e.g. `/rename`) ends a "turn" too. It would
  turn a background tab green, but such commands are typed in the front tab.
- Dragging across the bar's empty space, which drags the window, should keep working because the
  press started on a tab. Check this on both platforms.

## Not in this design

- Banner notifications.
- The Claude panel's status chip using presence, which would make "waiting on you?" certain. Left
  for later.
- Moving tabs between windows (Deck has one), or tearing them off.

## Testing

- **Unit tests:**
  - `presence.test.ts`:
    - parsing and checks, and the status mapping;
    - `matchProcesses`: a child, a grandchild, the nearest winning, a gone pid, a reused pid, no pty;
    - the watch against a temp folder: a file appears, changes and goes;
  - `attention.test.ts`:
    - `presenceFor` on each platform;
    - `nextAttention`: a turn ending unseen turns green; being seen clears it; needs you shows while
      seen; Claude going away clears it;
  - `tabs.test.ts`: `move` both ways, the Projects tab, the bounds, the front tab unchanged;
  - `drag.test.ts`: landing places;
  - `title.test.ts`: the name without the glyph;
  - `keys.test.ts` and `menu.test.ts`: the new shortcuts off macOS, none on macOS, and none sent to a
    device's screen.
- **In the app:**
  - **Setup:** a dev build with its own `--user-data-dir`. No prompts go to Claude, so no tokens are
    spent.
  - **Status:** two tabs running `claude`. In one, open `/config` (`waiting`, `dialog open`): amber,
    and Dock badge 1. Close it while the other tab is in front: green. Activate it: no mark.
  - **The name** loses the glyph while the mark shows.
  - **Dragging:** across the other tabs and back; Esc mid-drag; with enough tabs to scroll, to the
    far end.
  - **Menu:** Window → Move Tab Left and Move Tab Right.
