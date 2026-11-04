# Deck — project brief for Claude Code

Owner: Franco Landman (Effekt Studios). Repo: `github.com/Effekt3r/deck`, public since
2026-11-02:
- **Who can do what:** anyone can read and clone it. Only Franco can push or merge, and a
  fork's pull request runs CI only once he approves it.
- **What never goes in:** keys, certificates, session logs or client code. The Mac signing
  secrets live in GitHub's Actions secrets.

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
- the Claude panel (M3, PR #3, into `main` with PR #4).

Mac builds are signed and notarised in CI (M4, 2026-10-31); a Windows signing
route and polish (M5) are next. Plans that built M1–M3:
`docs/superpowers/plans/2026-10-30-m1-electron-shell.md`, `…/2026-10-31-m2-git-panel.md`,
`…/2026-10-31-m3-claude-panel.md`.

**M5, in progress:** the clipboard card and smart paste (spec:
`docs/superpowers/specs/2026-10-31-clipboard-design.md`; built 2026-10-31/11-01), and previews
of copied image files (`…/2026-11-02-clipboard-image-previews-design.md`). Also the usage card
(`…/2026-11-02-usage-card-design.md`, built 2026-11-02): Claude's plan limits above the clipboard
card. Windows to test.

The device panel, step 1 (Android: spec `…/2026-11-03-device-panel-design.md`, plan
`docs/superpowers/plans/2026-11-03-device-panel-android.md`, built 2026-11-03/04): the phone or
emulator a tab's project runs on, live at the top of the right pane. Checked with two phones on macOS
(2026-11-04); the hands-on checks and Windows are still to do. Simulators and iPhones are steps 2 and 3.

| Path | Role |
|---|---|
| `src/shared/` | `DeckApi` IPC contract (`types.ts`), channel names, and `quote.ts` (shell quoting, and `quoteImagePath` for Claude Code's image paths; used by main and the renderer); the only thing main and renderer share |
| `src/preload/index.ts` | exposes `window.deck`; sandboxed, requires only `electron` |
| `src/main/index.ts` | lifecycle, single instance + `--open <folder>`, IPC wiring; `window.ts`, `menu.ts` (platform shortcuts → `MenuCommand`) |
| `src/main/shell/` | `shellLaunch()` (which shell/args/env, pure), zsh `ZDOTDIR` wrappers + `deck.zsh`, PowerShell `deck.ps1`, installed to userData |
| `src/main/pty/` | node-pty sessions, output batching, startup command typed when the line editor is ready |
| `src/main/projects/` | `projects.json` (userData), scan, `.git/HEAD` branch, dirty counts, native context menu |
| `src/main/git/` | the git runner (the only way Deck runs git), header summary, merge target, graph log, commit details, watcher + poll probe, merge-target overrides, `git:*` subscriptions |
| `src/main/claude/` | session-log locator, incremental tail, the parser (TS port of `claude_activity_pane.py`), status rules, sub-agent steps, `claude:*` subscriptions |
| `src/main/clipboard/` | reads the clipboard (files, text, images; concealed copies skipped), decides what the card offers, saves pasted images for Claude |
| `src/main/usage/` | Claude's plan usage: the status line command and script, Claude Code's settings (connect/disconnect), reading and merging reports, `usage.json` |
| `src/main/devices/` | the device panel's main side: `android/` (finding and running adb, `track-devices` and identities, scrcpy's protocol, input checks and sessions), `streams.ts` (viewers, grace, retries), `project.ts` (a folder's project, Android app or not), `picks.ts` (`devices.json`), `ipc.ts` (wiring, lock and sleep) |
| `src/renderer/src/` | React: `tabs/` (model, titles, tab bar), `terminal/` (xterm view, OSC parsing, keys, search, `paste.ts`'s pasteSafe), `projects/`, `git/` (lane layout, canvas graph view, panel, details, splitter), `claude/` (panel, feed, markdown, session picker), `clipboard/` (card, hook), `usage/` (card, donut, view), `device/` (below) |
| `src/renderer/src/device/` | the device panel: which device a tab shows (`pick.ts`), the screen (WebCodecs, canvas, input: `codec.ts`, `fit.ts`, `keys.ts`), the menu, `useDevices.ts` |
| `resources/` | `scrcpy-server.json` (the server's version, URL, size, SHA-256) and `THIRD-PARTY-NOTICES.txt`; the server itself is downloaded at install (`scripts/fetch-scrcpy-server.mjs`), never committed |

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
- Clipboard (`src/main/clipboard/`):
  - **Electron 45's clipboard is async and web-like:** `read()` returns one item whose
    `types` are MIME types plus raw platform formats (`electron application/osclipboard;format="…"`).
    Copied files are in its `text/uri-list` (every file); the raw `NSFilenamesPboardType` holds only the first.
  - **When Deck looks:** on focus, about once a second while its window is in front, and
    once more as it leaves (one last look at a copy made just before) — never while it's
    actually in the background. Only on focus does a text change count as new; while in
    front, or leaving, a text change is Deck's own copy and gets no card (images and files
    always count).
  - **Password managers:** their copies carry `org.nspasteboard.ConcealedType`,
    `org.nspasteboard.TransientType`, `com.agilebits.onepassword` or
    `de.petermaurer.TransientPasteboardType` (macOS), or
    `ExcludeClipboardContentFromMonitorProcessing`, `Clipboard Viewer Ignore` or
    `CanIncludeInClipboardHistory`=0 (Windows), and get no card. A second `read()` right
    after the content read catches a marker the first missed (a copy landing in between,
    or a list Windows took while busy); `clipboard.has()` isn't used, since it's `read()`
    plus a search, for the same cost again.
  - **A busy clipboard** (Windows: another app has it open — RDP, Office, Clipboard
    History) makes Electron's `read()` resolve empty rather than reject; `readClipboard()`
    turns a listed type that comes back empty into a throw, so the watch retries at the
    next look instead of treating it as an empty clipboard.
  - **Raw formats:** only the legacy macOS alias `Apple PNG pasteboard type` is ever read raw.
    Electron hides from `types` any raw format Chromium treats as standard, which by Chromium 156
    includes `public.png` and Windows' `PNG`, so neither appears; Windows has no raw path at all,
    and image/png there always goes through Electron's own `ReadMime` decode (electron_api_clipboard_item.cc,
    not Chromium's) — unmeasured so far, worth checking on Windows. The raw PNG bytes are checked
    against the PNG signature, falling back to `image/png` when they don't match or come back
    empty. Text is read through `text/plain`, not raw: Apple documents that reading a standard
    text type joins every pasteboard item's text with newlines, but whether the legacy alias
    (`NSStringPboardType`) gets the same treatment isn't documented either way, so text/plain is
    read directly rather than risk an app that writes one item per row losing rows. Measured
    2026-11-01 with Deck in front: a 5K screenshot's PNG read costs 62 ms decoded against 0.5 ms
    raw, and 2.0% CPU with a 20 ms stall after switching to the raw read, close to idle's 1.8%/16 ms.
  - **Images:** saved to `<temp>/Deck clipboard/<instance>/` — `<instance>` is the first 8 hex
    characters of this run's userData path hashed with sha1, so a dev build started with its own
    `--user-data-dir` gets its own folder instead of clearing or colliding with the installed
    app's saved images — and pasted as a quoted path, which Claude Code turns into `[Image #N]`;
    cleared at start and quit. A dev app killed with a signal skips `will-quit` and leaves its
    image; the next start removes it.
  - **Copied image files get thumbnails** from the OS (`fileThumbnail()`,
    `nativeImage.createThumbnailFromPath`), on macOS only for now.
    - **macOS:** Quick Look, off the main thread: 14–170 ms the first time, about 3 ms after.
      Decoding and fitting its result then takes 0.5–7 ms on the main thread per image.
    - **Shape:** Electron 45's result claims the whole requested box, and its 2× copy
      (`toPNG({ scaleFactor: 2 })`, `resize()`) is stretched to that box. Only its 1× PNG keeps
      the image's shape, so that PNG is decoded and fitted again.
    - **Files it can't preview:** a file Quick Look can't preview (corrupt, unreadable, an
      unknown format) still resolves, with its type's 1024×1024 icon. Anything larger than the
      requested box is taken for that icon and dropped.
    - **Windows (off):** the thumbnail cache runs synchronously on the main thread, where a slow
      file would stall every terminal and could lose a Ctrl+V (the renderer gives up after 1 s).
      Also, Electron builds the bitmap as an icon masked by itself, which may make white
      transparent. `DECK_FILE_THUMBNAILS=1` turns it on to try (`docs/TESTING.md` 18l).
    - **When:** the watch publishes a files item at once, then again (same id) with
      `thumbnails`, outside the look/add/paste chain, so a paste never waits for one. The item is
      updated in place, because `add()` tells items apart by identity
      (`watch.test.ts` "add() still inserts when the thumbnails land").
    - **Privacy prompt:** Deck now opens copied files itself. A file in Downloads, Desktop,
      Documents or on a removable volume may trigger a macOS privacy prompt for Deck; denied
      means no preview. Unverified.
  - **Testing on macOS:** a clipboard written by a process that has quit keeps only its first
    item, so test writers must stay running (Finder does).
  - **Known limits:**
    - **Text copied while Deck is in front shows no card**, even when it came from
      elsewhere: Universal Clipboard text, OCR overlays and other panels that don't take
      focus, Keyboard Maestro or Shortcuts. That's the price of not offering Deck's own
      copies; children of Deck that write the clipboard while it's in front (`pbcopy`,
      Claude's `/copy`) rightly show no card. Images and files always show.
    - **The same content twice gets no card:** A → B → A while away, or copying something
      you already used or dismissed. Electron offers no clipboard change counter.
    - **Polls back off when a look is slow, whether its read succeeds or fails (then its
      fingerprint, on success),** to about 5% of the time, capped at 15 s. A locked screen or a
      sleeping Mac stops them.
    - **A huge text is still costly:** with 100 MB on the clipboard each look stalls the main
      thread about 0.3 s, and Deck uses about 7% CPU while in front — measured back on
      `text/plain` after removing the raw UTF-8 read (see "Raw formats" above). Decoding and
      fingerprinting run on every poll; the backoff now times the fingerprint too, not just the
      read, but a huge text's decode still dominates a look regardless. Follow-up: fingerprint
      the raw bytes and decode only when the text is new or pasted.
    - **A slow source could freeze terminals:** macOS clipboard reads run synchronously on the
      main thread and wait for the source app, so a slow one (Universal Clipboard from an iPhone,
      a hung app) could stall every terminal during a poll. Not yet hit; worth a manual check.
  - **Paste safety:**
    - Every paste goes through `pasteSafe()`, which first drops ^C, ^Z and ^\ (zsh keeps
      the tty's signal keys on, so a pasted ^C would end the bracketed paste and run what
      follows as typed keys), then strips the `ESC[200~`/`ESC[201~` markers xterm wraps a
      paste in, in one linear pass — repeating `replace()` until none remain would be
      quadratic on nested markers.
    - `quotePath()` refuses paths with control characters, because no quoting makes them safe.
  - **Paste ordering:** `terminal/pasteQueue.ts`'s `PasteQueue` keeps typed input (and Shift+Enter,
    sent through `term.input()` precisely so it counts as input) behind a smart paste still
    waiting on its clipboard round trip, and keeps overlapping pastes in the order they were asked
    for rather than the order their reads happen to resolve in — a plain in-flight counter got this
    wrong as soon as two Cmd+V's overlapped. A paste gives up after 1 s, not longer: xterm's own
    DA/CPR replies queue behind a pending paste too.
  - **Claude Code attaches an image only when a paste is one image path,** optionally
    quoted and with a trailing space. Several files pasted at once reach Claude as paths
    it can read. Before checking that the path is absolute, Claude Code (2.1.283) strips the
    outer quotes and drops each backslash that escapes a character, even inside single quotes
    (Windows paths under WSL aside). So on Windows an image's path is pasted with its backslashes
    doubled (`quoteImagePath` in `src/shared/quote.ts`, used by the card's image paste and the
    device panel's screenshot). Found by reading Claude Code's paste code; unverified on Windows
    (`docs/TESTING.md` 18b, 18s).
- Usage card (`src/main/usage/`):
  - **Source:** Claude Code's status line input: `rate_limits.five_hour` / `seven_day`, each
    `used_percentage` (0–100) and `resets_at` (Unix seconds). It comes only on Pro/Max/Ultra and
    only after a session's first API response, and either window can be missing (2026-11-02,
    2.1.283: only `seven_day` came).
  - **Never Claude's login:** Deck never reads Claude Code's OAuth token or calls `/api/oauth/usage`,
    which is what `/usage` does. Anthropic's terms forbid other apps collecting or using Claude.ai
    credentials.
  - **Connect** writes `statusLine` into Claude Code's user settings
    (`$CLAUDE_CONFIG_DIR` or `~/.claude`, then `settings.json`):
    - key order, indentation and the file's mode are kept, and a symlink is followed;
    - the old value goes to `userData/usage/connection.json` for Disconnect, and the text Deck read
      to `settings.backup.json` (0600);
    - Deck never writes a settings file it can't parse, a read-only one or a link to a missing
      file, and reads the file again just before writing: if it changed meanwhile, Connect or
      Disconnect fails with "try again" rather than lose that change;
    - while connected, Claude Code hides its footer hints ("esc to interrupt").
  - **Disconnect** also forgets the numbers, and removes the last `statusline.json`, which the next
    focus would otherwise read back in.
  - **Connected** means the settings' command equals this Deck's. That command holds the userData
    path, so a dev build started with `--user-data-dir` is another Deck.
  - **The command:**
    - **macOS:** `/bin/sh '<userData>/usage/statusline.sh'`, which writes a temp file and `mv`s it
      over `statusline.json`.
    - **Windows:** inline `powershell -NoProfile -NonInteractive -Command "…"`. The Restricted
      policy won't run a `.ps1`, and Deck doesn't pass `-ExecutionPolicy Bypass`. Claude Code runs
      the command through Git Bash, or PowerShell when that's missing, so it has no `$`, backtick,
      `"` or backslash. Git Bash's MSYS2 path conversion skips any argument holding `[`, `]` or
      `'`, so its `C:/…` paths arrive unchanged. .NET calls only, no cmdlets: a Windows PowerShell
      started under pwsh 7 (a Deck tab's shell when it's installed) inherits pwsh 7's
      `PSModulePath`, and `Move-Item` then fails to load. Stdin is read as UTF-8, not in the
      console code page. CI's Windows job runs it through both shells (from pwsh 7, GitHub's
      default shell); untested from a real Claude Code session on Windows.
  - **Merging:** within a window (reset times under an hour apart) a higher or equal percentage
    wins. A lower one is kept out for 10 minutes after the kept one was seen (`seenAt`, its
    report's file time, kept in `usage.json`): an idle session's status line re-runs (on a mode
    change or a reset) with its own older numbers. After that the lower one wins, since usage can
    drop within a window (a plan upgrade, a reset by Anthropic), and the next real reply corrects
    a stale one. The same file read again (at focus) isn't an update.
  - **Testing without touching real settings:** start the dev build with `CLAUDE_CONFIG_DIR` set
    to a temp folder whose `projects` links to `~/.claude/projects`. Feed it reports with a
    throwaway `claude --settings <file with Deck's statusLine>` run. Checked that way on
    2026-11-02: a real reply moved the card to "week 90%" within a second, and Disconnect left
    the settings as they were.
- Device panel (`src/main/devices/`, `src/renderer/src/device/`):
  - **scrcpy's server** (v5.0.1, Apache 2.0) is downloaded at install by `scripts/fetch-scrcpy-server.mjs`
    and kept only if its SHA-256 matches `resources/scrcpy-server.json`. The download gives up after
    120 s and prints `err.cause`, where Node's fetch puts the real network error. CI stops without the
    server, and so does a build: electron-builder only warns about a missing `extraResources` file, so
    `scripts/before-pack.cjs` (`beforePack`) checks the hash. Dev builds read the repo's `resources/`,
    packaged ones `process.resourcesPath`. The server refuses any version but its own, so a bump
    changes the JSON, `android/protocol.ts` if the protocol moved, and the notices.
  - **adb:** `ANDROID_HOME`/`ANDROID_SDK_ROOT` from Deck's own environment, the SDK's usual place, then
    PATH and Homebrew. The SDK's adb first: Android Studio runs it, and two adb versions restart each
    other's server. Only absolute PATH entries (a relative one means "the current folder"); Windows
    entries may be quoted. On Windows `env` must be the live `process.env`: names are case-insensitive
    there, and a copy holds `Path`, not `PATH`. `runAdb`'s error is adb's own `adb:`/`error:` line
    (stderr before stdout, `* daemon …` chatter skipped), at most 500 characters; its signal ends a
    call at once, so a stop ends a push under way.
  - **Devices** (`android/tracker.ts`, `android/devices.ts`): one `adb track-devices -l` while any tab
    needs devices (`devices:watch` counts).
    - **Its output:** each list is four hex digits of length, then the lines. Windows writes it in
      text mode, so each "\n" may arrive as "\r\n", which the lengths don't count: `readTrackFrames`
      drops every "\r" first (from adb's source; not yet seen on Windows). A line is read up to the
      first adb state word, since mDNS renames a clashing Wi-Fi name with spaces
      (`adb-<serial>-<x> (2)._adb-tls-connect._tcp`). Windows' own USB driver gives adb no device
      path, so cables list no `usb:` field there: a connection counts as a cable unless its name is an
      emulator's or a network one (`ip:port`, mDNS). Unverified on Windows.
    - **Identities:** each connection is asked once what it is (one `adb shell`; the first value of
      each key wins, so a name can't spoof the serial) and listed only once it answered or three asks
      (1.5 s apart) failed. So an emulator's id (its AVD name; its adb name changes with the port)
      never changes under the panel, and an emulator still starting isn't listed at all. A phone still
      booting (`sys.boot_completed` not 1) is asked again every 3 s, up to 40 times, so one rebooted
      while plugged in gets its own name back. A device already listed (e.g. unauthorized) stays
      listed as "connecting" while it's asked: no "disconnected" flash after tapping Allow. A device
      waiting out its retry gap isn't asked again by the next list, and re-ask timers belong to their
      connection's record. The asks take no signal: one can run up to 10 s after a stop (quick in
      practice).
    - **One device per phone:** `android:<ro.serialno>`, so a phone over USB and Wi-Fi
      (`adb-<serial>-<x>._adb-tls-connect._tcp`) is one device, reached over USB first.
    - **The first list** after tracking (re)starts waits for every ready device to answer or run out
      of tries, 3 s at most counted from adb's first list (starting adb's server takes time of its
      own); else a project with two devices would show whichever answered first. Until then
      `devices:list` answers null (as it does again once nothing watches; no push at stop), and the
      panel says "Looking for devices…". An emulator still offline in that list isn't waited for, and
      a hung adb leaves "Looking for devices…" up.
    - **Restarts:** adb's server going away ends track-devices. It starts again after 1 s, doubling to
      30 s, and the wait resets only after a run of 30 s, so two adb versions killing each other's
      server don't restart every second. What adb prints while starting its server is never the
      error, and a publish that throws doesn't stop tracking.
    - **Known limit:** an adb of another version (run by Claude or the user) kills Deck's server; if
      Deck's had run 30 s or more, it restarts within 1 s and kills theirs, cutting off e.g. a long
      `adb logcat`. Hence the SDK's adb first, as Android Studio does.
  - **Streams** (`android/scrcpy.ts`, `android/protocol.ts`):
    - **Connecting:** a forward tunnel to `localabstract:scrcpy_<scid>` (the server reads `scid` as
      hex, eight digits). adb accepts a connection before the server listens and drops it, so Deck
      waits for the server's dummy byte (100 tries, 100 ms apart). The forward is removed once both
      sockets are connected, as scrcpy does: a crash after that leaves none. A socket destroyed while
      still connecting only emits `close`, so `connected()` rejects on close too.
    - **Input:** fingers are pointer id -2 (a mouse id would make mouse events). A touch must carry
      the current video size or the server ignores it, in whole pixels 0…size−1. Text goes in pieces
      of at most 300 bytes and a paste at most 256 KiB: scrcpy's own client's limits, not the
      server's. Scroll: a positive dx scrolls right (the wheel's deltaX sign), a positive dy up
      (against deltaY). Reset video (type 17) restarts the capture (a new size, config and key
      frame): sent when a viewer joins a running stream, or a decoder falls behind or fails.
    - **Stopping:** a stop also stops a start under way (an `AbortSignal` into `startScrcpy`) and
      closes what it had opened: quitting mid-start once left the server running on the S25 FE
      (2026-11-03). Killing the local `adb shell` ends the server on the device: adbd SIGHUPs `sh -c`,
      and mksh hangs up its foreground job (traced in AOSP's source).
    - **Errors:** after the start, a socket close waits up to 1 s for the shell's own close, so the
      server's last words, which reach Deck a moment later, explain the drop. `serverError` takes a
      Java exception's message, a `Caused by:` root, or "<ERROR line> (<Exception>)" for a bare
      exception.
    - **The video reader** caps packets at 16 MiB and turns a broken stream (an empty or oversized
      packet, a frame before the screen's size, a 0 or >65535 screen) into an error. Each packet is
      filled as its bytes arrive (shifting a long chunk list was quadratic), so memory stays about
      one packet.
    - **Lifecycle** (`streams.ts`): one stream per device, shared by its viewers. It lingers 10 s
      after its last viewer and sends no packets meanwhile; a viewer coming back gets a key frame. A
      break is retried after 1, 2 and 5 s, then it's an error until Try again. A stream counts as
      recovered only after 5 s live, so one that dies right after its first frame still reaches the
      error. Each start has its own 20 s deadline, an ended session is never heard from again, and
      `view()` always answers with a state.
  - **On the device:** `stay_awake` keeps the screen on while it's shown and plugged in:
    `stay_on_while_plugged_in` is 7 while shown and goes back when the stream stops (2 on the C66,
    2026-11-04). scrcpy's cleanup is a separate process: it deletes the jar at start and puts the
    setting back when the server dies, a pulled cable or a killed Deck included.
    `clipboard_autosync=false`, or the device's copies would come back to the Mac. A paste goes
    through the device's clipboard and stays there, as with scrcpy, a password manager's copy
    included.
    - **Checking a device after a quit:** `adb -s <serial> shell pgrep -f com.genymobile.scrcpy.Server`
      prints nothing, and `settings get global stay_on_while_plugged_in` is back. The jar's path is in
      the server's environment, not its command line, so `pgrep -f deck-scrcpy` only matches the
      Mac's `adb shell`.
    - **Known limit:** a Deck crash in the ~1 s a start takes leaves the adb client and the server
      waiting, with the screen kept on, as scrcpy itself would.
  - **Which projects** (`project.ts`): a tab's project is its repository's main work tree (worktrees
    share it), else its folder. Inside git the whole repository is scanned; outside git only a Gradle
    build (`settings.gradle[.kts]` at the root or in `android/`); the home folder never: scanning `~`
    stats inside Desktop, Documents and Downloads, which can raise macOS privacy prompts for Deck,
    and a "Don't Allow" also blocks the terminals there. An app has `AndroidManifest.xml` in
    `src/main/` or `src/androidMain/` of a first-level folder, or of a second-level one inside
    `android/` (any case) or a first-level Gradle build of its own; at most 200 folders per level, and
    200 in all at the second. Main caches {root, android} per folder for 30 s and reads the pick fresh.
    `gitDirs` resolves git's relative common dir against the path it's given, so pass it a real
    path (`project.ts` realpaths first): through a symlink or junction it lands beside the repository.
    - **Known limits:** a folder outside git holding several Gradle builds isn't found (show the panel
      by hand); a temporary git failure is cached as "outside git" for 30 s; each worktree of a bare
      repository is its own project; a single-module app at the repository's root isn't found; a
      repository with only an Android library counts as an app.
  - **Which device a tab shows** (`pick.ts`): the tab's pick, else the project's (`devices.json`),
    while connected; else the only device that fits; with several the panel asks. Outside an Android
    app the project's pick doesn't open the panel by itself; it's used once the panel is shown by hand.
    - **Holds:** a shown device that goes away stays, as "disconnected", for 10 s, and one still
      connected stays when a second arrives (no drop to "Which device?"; the menu switches). Either
      hold ends at once when the tab picks another device or moves to another project. The hold keeps
      the stored pick's id, not the resolved device, or a tab's own pick unplugging (the project's
      taking its place) would end it.
    - **Projects:** a tab's pick and its View → Device Panel choice hold only in the project they were
      made in, and count for nothing from the first render in another (`movedOn` in App.tsx), so a
      `cd` can't start a stream. A tab coming to the front reads its project again before it
      streams: another tab may have changed the pick.
  - **The screen** (`DeviceScreen.tsx`):
    - **Decoding:** WebCodecs in Annex B mode (no `description`): the config packet's SPS and PPS go in
      front of the next key frame. The codec string comes from the SPS, with the constraint byte's two
      reserved bits masked (Chromium refuses the string otherwise). A rotation needs no reconfigure:
      the same codec string decodes both sizes (measured 2026-11-04). Only the latest
      `VideoFrame` is kept (closed when replaced): frames left open stall the decoder.
    - **Failures:** a failed decoder is replaced in software; after 3 failures in a row with no
      picture between, "Couldn't show …" with Try again, rather than restart the device's encoder over
      and over. Each view tries the GPU first again. More than 10 frames queued: skip to the next key
      frame. Key frames asked for that way are one a second at most (each restarts the device's
      encoder), and one held back is asked for once the gap has passed.
    - **Canvas:** the fitted screen's size at `devicePixelRatio`, which it follows (another display,
      zoom). Its edge is a box-shadow ring: a border squeezed the picture inside the canvas's size and
      shifted touches. A picture of the old orientation isn't stretched into a turned canvas.
    - **Touch:** one pointer at a time. A touch in progress when the frame changes size (a rotation)
      is lifted at its last point for both sizes: scrcpy drops a touch made for another size, and may
      switch before or after it says so. A finger down when the screen goes (a tab switch, a fold) is
      lifted too. A pinch (a wheel with Ctrl) isn't a scroll; a wheel notch is taken as 100 px.
    - **Keys** (`keys.ts`): macOS's Option+Backspace/Delete/←/→ are word-wise, so they go to Android
      with Ctrl: Android's Alt+Backspace deletes the whole line. Shift is dropped on the deletes
      (Android deletes nothing for Ctrl+Shift+Backspace) and kept on the arrows. Option+↑/↓ are plain
      arrows (Android's Alt+↑/↓ jump to the text's ends). Cmd+←/→ go to the line's start/end
      (`MOVE_HOME`/`MOVE_END`), Cmd+↑/↓ to the text's (the same with Ctrl); every other Cmd key stays
      Deck's. Off macOS, Ctrl keys stay Deck's (so Windows' Ctrl+←/→ and Ctrl+Backspace don't reach
      the device), Alt alone never types (Alt+F is a menu key, Alt+0233 an Alt code, Alt+Space the
      window menu), and AltGr does: `getModifierState('AltGraph')`, or Ctrl+Alt, since Chromium may
      report AltGraph only for the right-hand key. Tab and Esc go to the device by design: the way out
      is a click elsewhere, or Deck's shortcuts.
    - **Pastes:** Chromium fires the Edit menu's paste (and its own Ctrl+V) at the element holding the
      page's text selection when there is one, else at the focused element. So the screen listens on
      the document and takes a paste while it has the keyboard, and pressing on it clears the page's
      selection. Off macOS, Ctrl+V and Ctrl+Shift+V both paste. Known limit: Cmd+A on the screen
      selects Deck's own text (the Edit menu's Select All), not the device's.
  - **The panel** (`DevicePanel.tsx`, App.tsx): 60 % of the right pane at first, 15–85 % by its
    splitter (shared by every tab). Its slot shrinks first (`flex: 0 1 auto`): the device panel keeps
    152 px (its header and 120 px of screen) and the Claude panel under it 160 px
    (`.claude-pane.with-device`). Folded with no Claude panel, the pane keeps its width and shows the
    header (View → Device Panel hides it). A thrown render says "The device panel couldn't show
    this" with Try again.
    - **Known limit:** below about 620 px of window height the right pane can't fit those 152 and
      160 px and both cards, so the cards overflow and the clipboard card's Add button can end up
      below the window, which breaks clipboard.css's "the card is never cut". Folding the device panel
      removes its floor.
    - **Keyboard:** clicks in the header and the chooser leave it where it was. A pick from the ▾ menu
      gives it back where it was when the menu opened: the terminal, for a click (it landed on the
      device's button until 2026-11-04). Folding the panel, or another device taking the screen's
      place, gives it to the terminal.
  - **Screenshot:** the camera (while Claude runs) draws the last live frame into a PNG; main takes
    only a PNG of at most 32 MiB, saves it with the clipboard's `saveImage` (same folder, cleared at
    start and quit) and returns `quoteImagePath`'s text (see the clipboard's image paths above).
  - **IPC:** a pick needs an absolute root and a project an absolute folder; a view of a device that
    isn't listed is ignored (it could only cycle through retries); input goes through
    `android/input.ts`'s checks. For M4, see Security below.
  - **Cost:** only the active tab's unfolded panel streams, with the window visible (page
    visibility); a stream lingers 10 s after its last viewer; lock and sleep stop it. Measured
    2026-11-04 (dev build, the C66 and S25 FE on their lock screens, so almost no frames): main, GPU
    and renderer about 0.5 % of a core each. A moving screen's cost isn't measured yet.
  - **Checked on the devices** (2026-11-04, macOS, C66 and S25 FE over USB; the emulator streamed
    earlier): Guard with no pick asked between the two, and the pick went to `devices.json` and
    survived a restart. One `adb … shell CLASSPATH=…deck-scrcpy-server.jar` per stream; the jar gone
    from the device once started; no forward left once connected. Switching devices, folding the
    panel and hiding the window stop the old stream after its 10 s grace; showing the window again
    brought it back in 0.7 s. Quitting within a second of a pick left nothing on the Mac (no
    `adb shell`, no forward) or the devices (no server, no jar, settings back). At a 900 px window
    the device panel had its 60 % (518 px) and the Claude panel 168 px. With real mouse clicks, a
    pick from the ▾ menu gave the keyboard back to the terminal, a click on the screen took it, and
    a fold while the screen had it gave it to the terminal.
  - **Not yet checked:**
    - by hand: taps, swipes, typing and pasting; rotating while a touch is held; the Option and Cmd
      editing keys; a paste after selecting text in Claude's reply, and after Cmd+A; the wheel's
      speed on macOS (Chromium may give 40 px a notch, not 100); the camera's `[Image #N]`; pulling
      cables;
    - Shift+arrows selecting in a classic (View-based) EditText. Android's TextView takes selection
      from a separate Shift key event (MetaKeyKeyListener's state), not from the arrow's Shift flag,
      and scrcpy sends Shift as its own key. If it doesn't select, `android/input.ts` should wrap a
      Shift-flagged key in Shift down/up;
    - dead keys: macOS should compose them (Option+E, E types "é"); unverified on Windows. Input
      methods (Chinese, Japanese, Korean) don't reach the device;
    - Windows, all of it: `docs/TESTING.md` 18p–18x.
  - **Known limits, devices:** two devices sharing an id look like one (cheap boards' `0123456789ABCDEF`
    serial; two copies of one AVD with `-read-only`); Linux's `no permissions` shows as offline, or
    not at all when adb gives no reason; recovery and sideload devices are told to unplug; devices
    with the same name look alike in the menu.

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
| `electron-builder.yml` | Mac dmg+zip (Apple silicon only, notarised), Windows NSIS (x64; arm64 later), GitHub publish; each keeps only its own node-pty prebuild; ships `resources/` (scrcpy's server, its JSON, the notices) as `extraResources`, and `beforePack` (`scripts/before-pack.cjs`) stops a build without the right server |
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
4. CI for macOS (Apple silicon only, since 2026-10-31) and Windows x64: `release.yml` signs and notarises
   the Mac build (secrets set 2026-10-31; a run fails
   without them and checks both apps' signature and ticket). Windows stays
   unsigned until there's a signing route. `ci.yml` runs typecheck + tests on
   macOS and Windows for pull requests. **Releasing:** bump `version` in
   `package.json`, add its `CHANGELOG.md` section, merge, then
   `gh workflow run release.yml --ref main` (or push the tag `v<version>`), check
   the draft and publish it. The build jobs only upload artifacts; the release
   job makes the one draft (two builders publishing at once each made their own),
   creating the new draft before it deletes earlier ones. Don't merge changes to
   `.github/workflows/` while a release builds: the Actions token can't create a
   release on a commit whose workflows differ from main's (HTTP 403 "Resource not
   accessible by integration"; seen 2026-10-31), so the run fails at the end.
   A Keychain-exported `.p12` uses old ciphers: OpenSSL 3 reads it only with
   `openssl pkcs12 -legacy`.
5. Device panel: step 1 (Android) built 2026-11-03/04 and checked with two phones on macOS. Next:
   Franco's hands-on checks (Device panel → "Not yet checked" above) and Windows
   (`docs/TESTING.md` 18p–18x); then step 2, simulators (idb-companion), and step 3, iPhones (a
   Swift helper on CoreMediaIO, once an iPhone has been seen streaming). Each step gets its own plan
   and pull request.

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
- **Accepted risk (device panel):** on Windows `devices:project` accepts a UNC path from the tab's
  folder, which other programs' output can set (OSC 7), so Deck may run git and stat files on a
  network share: the same exposure as the git panel's.
- **Security (M4):**
  - Check the IPC sender frame (`clipboard:paste` hands password-manager text to the renderer;
    `devices:input` taps and types on a phone).
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
"Deck". Both use the same userData and so the same single-instance lock: with the
installed Deck running, a dev launch hands its arguments (`--open` too) to it and quits.
Give the dev build its own folder instead of quitting Franco's Deck:
`npx electron-vite dev --remoteDebuggingPort 9333 --inspect 9229 -- --user-data-dir=<dir>`,
and pass the same `--user-data-dir` to a second launch with `--open`. `--inspect` exposes
the main process (evaluate through `process.mainModule.require`, since `require` isn't a
global there). Hide, show or quit the dev build from there:
`process.mainModule.require('electron').BrowserWindow.getAllWindows()[0].hide()`, `.showInactive()`,
or `process.mainModule.require('electron').app.quit()`. Run from Claude Code,
`osascript -e 'tell application "System Events" to …'` (e.g. `set visible of process "Electron"`)
hangs waiting for macOS's Automation permission (2026-11-04).

Single instance: if the running Deck doesn't acknowledge a second launch within about
20 s (Chromium's ProcessSingleton), the second launch kills it and takes over. It was seen
once, with an Intel build's slow first launch under Rosetta; a main-thread stall that long
would cost the user's tabs.

macOS kills a copy of a system binary (e.g. `/bin/cat` renamed to `claude`) started from
the scratch folder; build a stand-in with `swiftc` instead.

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
