# Usage card: design

2026-11-02. Franco asked: "above the clipboard in the right pane, let's show a usage graph,
claude /usage shows our stats, let's update this every so often so that we can better manage
our usage, a nice donut chart with different colours could be great, but I'm not a UX designer
so whatever you think goes". He chose where the numbers come from (below). The rest was decided
without a round of questions: review it here.

## Goal

`/usage` shows the plan's 5-hour and weekly limits and when they reset. Show those in Deck's
right pane, kept current without typing `/usage`, so Franco can pace his work.

## Where the numbers come from

- **Not Claude's login.** `/usage` asks Anthropic's API with Claude Code's OAuth token. Anthropic
  doesn't allow other apps to do that: "developers may not collect, store, or intermediate
  Claude.ai credentials or session tokens"
  ([legal and compliance](https://code.claude.com/docs/en/legal-and-compliance)).
- **Claude Code's status line.** Claude Code gives its status line command the plan usage as
  `rate_limits.five_hour` and `rate_limits.seven_day`, each
  `{ used_percentage: 0–100, resets_at: Unix seconds }`
  ([status line](https://code.claude.com/docs/en/statusline)):
  - only on Pro, Max and Ultra plans, and only after a session's first API response;
  - either window can be missing;
  - the command runs:
    - as a session starts;
    - after each assistant message and after `/compact`;
    - on a permission or vim mode change;
    - when a window in its last data reaches `resets_at`.

    Updates are debounced by 300 ms, and a new one cancels a run still in progress.
- **Measured** (2026-11-02, Claude Code 2.1.283, Max plan): a throwaway Haiku session's status
  line got no `rate_limits` at start, then `{"seven_day": {"used_percentage": 85, "resets_at":
  1793653200}}` after its one-word reply, with no `five_hour` that time. Claude's own footer said
  "You've used 85% of your weekly limit · resets 11pm".
- **Not available:** the per-model weekly limits `/usage` also lists aren't given to status lines.
- **Franco's choice:** Deck becomes Claude Code's status line through Claude's user settings, so
  every session on the machine reports, in a Deck tab or not. The other options were:
  - adding `--settings` to the command Deck types, which misses sessions started by hand;
  - estimating from session-log token counts, which can't give a percentage of the plan.

## What the user sees

### The card

- **Where:** at the bottom of the Claude pane, above the clipboard card, in every tab that shows
  the pane. Usage belongs to the account, not to a tab.
- **Heading:** `USAGE`, a summary (`week 85% · 5h 34%`) and a caret that folds the card. Folding
  is remembered, like the To-do and Agents sections, and folds every tab's card at once.
- **Donut** (64 px): a ring per window on a dim track:
  - outer: **week**, in violet;
  - inner: **5-hour**, in teal;
  - middle: the fuller window's percentage and name (`85%`, `week`);
  - accessible label: `Week 85% used, 5-hour 34% used`.
- **Legend**, beside it:
  - `● Week 85%  resets 23:00`
  - `● 5-hour 34%  resets in 2 h 10 m`
  - Reset times within 5 hours are relative (`in 2 h 10 m`, `in 25 m`). Later ones show the time:
    `23:00` today, `tomorrow 09:00`, or a weekday (`Thu 09:00`), with `next` a week or more away
    (`next Mon 09:00` on a Monday, which would otherwise read as today). Times follow the app's
    locale (see Known limits).
- **Warnings:** a percentage turns amber from 75% and red from 90%. The rings keep their colours,
  so colour always tells the windows apart.
- **Missing and past windows:** a window Claude didn't report isn't drawn. Once a window's reset
  time has passed it shows 0% and `reset at 23:00`, until a report has the window again.
- **Footer** (when connected): `updated 2 min ago` (`just now`, `3 h ago`, `Mon 10:12`) and
  **Disconnect**.
- **How often it updates:** usage only moves when Claude gets a reply, so the card updates on
  each reply instead of on a timer, within about a second of any Claude session on this machine
  answering. Its times move on every 30 s, and the last numbers survive a restart.

### States

- **Not connected:** "See your Claude plan usage here. Deck reads it from Claude Code's status
  line." **Connect**, and in small print: "Adds a status line to Claude Code's settings
  (`~/.claude/settings.json`). Claude Code then hides its footer hints, like 'esc to interrupt'.
  Disconnect undoes it." The path shown is the real one (see below), `~`-shortened.
- **Claude already has a status line:** says so and shows its command. **Replace it** connects
  anyway; Disconnect puts it back.
- **Connected, no report yet:** "Waiting for Claude's next reply. Claude Code reports usage on
  Pro, Max and Ultra plans, and runs status lines only in folders you trust and while hooks are
  on."
- **Claude's settings can't be read** (not JSON, not an object, unreadable, a link to a file that
  doesn't exist): the error, and no Connect: Deck never rewrites a file it couldn't parse.
- **Connect or Disconnect failed:** the error, in the card.
- **After Connect, Replace or Disconnect:** when the button that had the keyboard is gone (Connect
  turns into the donut) or lost it while disabled, the keyboard goes back to the tab's terminal.
- **A card that fails to draw** (a state main got wrong) disappears without taking the pane with
  it; a new state (another link, a newer report) gets another try.

## How

### Connecting

1. **The command Claude runs:**
   - **macOS and Linux:** `/bin/sh '<userData>/usage/statusline.sh'`. The script saves its stdin
     to `statusline.json` beside it (to `.statusline.<pid>.tmp` first, then `mv -f`) and prints
     nothing. Deck checks it at every start and, when it differs, replaces it by a rename, so an
     update reaches it and a run under way never reads half of it.
   - **Windows:** no script file. Windows' default execution policy (Restricted) won't run a
     `.ps1`, and Deck doesn't pass `-ExecutionPolicy Bypass`, which security tools flag (as with
     the PowerShell hook). Instead the command is inline:
     `powershell -NoProfile -NonInteractive -Command "…"`. It reads stdin as UTF-8, writes it to
     `.statusline.<pid>.tmp`, deletes `statusline.json` and moves the temp file into its place,
     then deletes the temp file whatever happened.
     - **.NET calls only** (`[IO.File]`, `[IO.StreamReader]`), no cmdlets. A Windows PowerShell
       started under pwsh 7 (Deck's tab shell when pwsh is installed, then `claude`, then Git
       Bash or PowerShell) inherits pwsh 7's `PSModulePath`, and cmdlets such as `Move-Item`
       then fail to load. .NET Framework's `File.Move` can't overwrite, hence the delete.
     - **UTF-8:** `[Console]::In` would decode stdin in the console's code page.
     - Claude Code runs status line commands through Git Bash when it's installed, and
       PowerShell otherwise.
     - So the text avoids what either would change: no `$`, no backticks, no backslashes, no
       double quotes, only single quotes inside, and forward slashes in paths.
     - Git Bash's path conversion (MSYS2) leaves alone any argument holding `[`, `]` or `'`, as
       this one does, so its `C:/…` paths reach PowerShell unchanged.
2. **Claude's settings file:** `$CLAUDE_CONFIG_DIR/settings.json`, else
   `~/.claude/settings.json`. That's the folder the Claude panel reads logs from, taken from
   Deck's own environment. A missing file counts as `{}`; anything that isn't a JSON object stops
   here, and so does a link to a file that doesn't exist (dotfiles not set up yet: writing would
   put a plain file in the link's place). A leading byte order mark (Windows PowerShell 5.1's
   UTF-8) is skipped.
3. **Remember the old status line** in `<userData>/usage/connection.json`
   (`{ command, previous }`, with `previous` null when there was none). Back up the settings text
   Deck read, which the change is made from, to `<userData>/usage/settings.backup.json` (0600:
   settings can hold keys); with no file, there's no backup.
4. **Write** `"statusLine": { "type": "command", "command": … }`:
   - every other key stays as it was and where it was, in the file's own indentation (2 spaces
     when it has none);
   - just before writing, the file is read again. If it no longer holds the text the change was
     made from (Claude Code's `/config` or an editor wrote it meanwhile), Deck stops with "Claude
     Code's settings changed while Deck was writing them; try again." rather than lose that
     change;
   - a read-only file (no owner write bit) is refused: "… is read-only, so Deck leaves it alone."
     It's still read, so a status line set in it by hand shows as connected;
   - written beside the file and renamed over it, keeping the file's mode, which the temp file
     has from the start, so a private file's copy is never readable by others;
   - a symlinked settings file (a dotfiles manager) is written at its target, so the link stays.
5. Claude Code picks up settings changes as they happen, so running sessions report from their
   next update.

### Disconnecting

- If `statusLine` is still Deck's command, put back `previous`, or remove the key when there was
  none, with the same care as Connect's write.
- If it changed since, leave the settings alone.
- Either way, forget `connection.json`.
- Forget the numbers too (`usage.json`), so a later Connect waits for Claude's next report rather
  than showing old ones, and remove the last `statusline.json`, which the window coming to the
  front would otherwise read back in.

### Connected or not

- Connected means the settings' `statusLine.command` is the command this Deck would write.
- That command holds this Deck's userData path, so a dev build started with its own
  `--user-data-dir` counts as a different Deck.
- Deck checks at start, when its window comes to the front, and after Connect or Disconnect. The
  check at the front takes its turn with Connect and Disconnect, so a read made before one of
  them can't land after it.

### Reading the reports

- **Watching:** main watches `<userData>/usage/` for `statusline.json`, debounced 100 ms. It
  watches the folder because the file is replaced by a rename. It also reads the file at start
  and when the window comes to the front; the same report read again isn't an update (nothing is
  pushed or saved).
- **Reading:** at most 1 MB. Only `rate_limits.five_hour` and `.seven_day` with finite numbers are
  taken. The rest of the file (folders, session, cost) is ignored and never leaves main.
- **When:** a report is dated by the file's modification time.
- **Merging, per window:**
  - none yet: take it;
  - the same window (reset times within an hour of each other), higher or equal: take it;
  - the same window, lower: most likely older data (each session reports its own last API
    response, and an idle session's status line still runs on a mode change or a reset), so it's
    kept out for 10 minutes after the kept figure was seen. After that it wins, because usage can
    drop within a window (a plan upgrade, a reset by Anthropic); a stale report let in that way
    is corrected by the next real reply, since higher wins;
  - a later window (resets an hour or more later): take it; an earlier one: ignore it.
- **Kept** in `<userData>/usage/usage.json`, written beside it and renamed, so a restart shows the
  last numbers. Each window keeps `seenAt`, the time of the report it came from; a file from
  before that dates its windows by `updatedAt`. The card gets the windows without it.
- **Starting:** each step (the folder, the script, leftovers, `usage.json`, the watch, the first
  read, the settings) is caught and logged on its own, so one failing leaves the rest running.
- **Leftovers:** temp files from runs cancelled mid-write that are older than a minute are
  removed at start.

### Code

- `src/shared/`: `UsageWindow`, `UsageState`, `DeckApi.usage` (`get`, `onChange`,
  `connect(replace)`, `disconnect`), and the channels `usage:get`, `usage:connect`,
  `usage:disconnect`, `usage:changed`.
- `src/main/usage/`:
  - `report.ts`: status line JSON → windows (pure);
  - `merge.ts`: the merge rules (pure);
  - `statusline.ts`: the command and the script for a platform (pure);
  - `settings.ts`: Claude's settings file: state, connect, disconnect;
  - `store.ts`: `usage.json`;
  - `watch.ts`: the folder watch;
  - `ipc.ts`: wiring, starting and window focus.
- `src/renderer/src/usage/`:
  - `view.ts`: state + now → rings, texts and tones (pure);
  - `Donut.tsx`;
  - `UsageCard.tsx`, with an error boundary like the clipboard card's, tried again on a new state;
  - `useUsage.ts`;
  - `usage.css`.
- `App.tsx` puts the card between `ClaudePanel` and `ClipboardCard`, and keeps its fold flag, one
  for the window.
- The settings and usage files reuse the rename-with-retries in `git/targets-store.ts` (on
  Windows, a rename fails while a scanner or indexer has the file open), moved somewhere both can
  import it.

## Known limits

- **Overrides:** a project's `.claude/settings.json` or a `--settings` flag with its own status
  line wins over the user settings, so those sessions don't report.
- **Config folder:** a `CLAUDE_CONFIG_DIR` set only in shell profiles isn't seen when Deck starts
  from Finder, as for the Claude panel.
- **Uninstalling:** removing Deck and its data without Disconnect leaves Claude running a missing
  script. Claude's status line goes blank, and nothing else breaks. Disconnect first.
- **One status line:** Deck replaces another status line rather than running it as well.
- **This machine only:** usage on claude.ai or another computer shows up once a session here
  replies.
- **Hooks and trust:** Claude Code doesn't run status lines with `disableAllHooks` or
  `allowManagedHooksOnly` set, or in folders you haven't trusted, so those sessions don't report.
- **Clock format:** times use the app's locale, like the rest of Deck, so an en-US Mac shows
  12-hour times even with a 24-hour region.
- **Past windows:** Claude Code drops a window from its reports once it resets, so a past window
  shows 0% and its reset time until a report has it again.
- **Windows is mostly untested:** CI runs the inline command for real through Windows PowerShell
  and Git Bash, but not yet from a Claude Code session there, and PowerShell's startup (about
  0.3–0.5 s a run) is unmeasured. `docs/TESTING.md` has steps.
- **Not shown:** per-model weekly limits, and a gateway's spend limit.

## Testing

- **Unit:**
  - parsing reports: complete, partial, junk;
  - the merge rules, with the 10 minutes, and a report read again;
  - the command and the script: paths with spaces and quotes, Windows quoting;
  - connect, disconnect and state against temp folders:
    - a missing file, no status line, another status line, Deck's own;
    - invalid JSON, a byte order mark;
    - a symlink, and a link to a file that doesn't exist;
    - mode, key order and indentation kept;
    - a read-only file, and one changed before the write;
  - the watcher, on a temp folder;
  - main's wiring: start-up steps failing on their own, Connect and Disconnect asked for together,
    Disconnect forgetting the numbers;
  - the view: rings, the middle, tones, reset (`next Mon`) and updated texts, past windows, the
    summary.
- **Script:** the real macOS script, fed a sample, writes `statusline.json` whole and prints
  nothing. On Windows (CI) the inline command does the same through Windows PowerShell and Git
  Bash, with non-ASCII input, over an older report, leaving no temp file.
- **In the app** (dev build, its own userData):
  - Connect and Disconnect with `CLAUDE_CONFIG_DIR` pointing at a temp folder, so Franco's
    settings aren't touched;
  - a throwaway Claude session started with `--settings` set to Deck's command: the card fills in
    after its reply.
- **Windows:** steps in `docs/TESTING.md`.
