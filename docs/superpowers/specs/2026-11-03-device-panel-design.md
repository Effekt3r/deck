# Device panel: design

2026-11-03. Franco asked: "if we have a device connected and we're busy on that project, let's say
/Volumes/Wyobi/AccessControl_Guard and we have the c66 connected then show it in the right pane, if we're
in /Volumes/Wyobi/AccessControl_Android then show either the emulator or the S25 in the right pane
depending on the task we're busy with, should be selectable.. if we're in /Volumes/Wyobi/AccessControl_iOS
then show the view from the simulator or my connected iphone". He chose how Deck gets the screens (below).
The rest was decided without a round of questions: review it here. Updated 2026-11-04 with the
decisions made while building and reviewing step 1 (Android). Updated 2026-11-10: Franco asked "you
should auto pick c66 for guardapp and s25 for residents app, but I should be able to attach to ios as
well". With the C66 unplugged, Guard's panel asked between the S25 FE and a face terminal that belongs
to another repository, which wasn't found as an Android app at all (its app sits in
`apps/<build>/<module>/`). So a project now remembers every device picked in it, and opens only on
those; and a Gradle build two levels down is looked into.

Updated 2026-11-10 with step 2 (simulators), built that day
(`docs/superpowers/plans/2026-11-10-device-panel-simulators.md`). It departs from this design in
four places, written into the sections below:

- **`sim-video`'s fragmented MP4, not its Annex B:** Annex B has no delimiters, so a picture is known
  to be complete only once the next one starts, and a still screen sends no next one. fMP4 gives
  each picture's exact bounds.
- **gRPC on Node's own `node:http2`, with idb's few messages written by hand,** not `@grpc/grpc-js`:
  that and its loader are 33 packages and 12 MB for two calls. The field numbers follow idb's
  `proto/idb.proto` (MIT), whose notice joins scrcpy's.
- **A paste on a simulator is typed,** as a US keyboard would type it (at most 1,000 characters), not
  put on its pasteboard: iOS asks "would like to paste from CoreSimulatorBridge" every time.
- **One watch runs both sources** (simulators on macOS with idb-companion installed). The list says
  which kinds are still being looked for, and a tab waits only for the kinds it shows. A view that
  joins a running simulator stream gets the current group of pictures replayed when it's short (at
  most 8 pictures), else `sim-video` is started again: it can't be asked for a key frame, and a long
  replay would trip the view's 10-picture backlog rule.

## Goal

In a tab whose project is an Android or iOS app, show the device the app runs on, live, at the top of
the right pane. A tab can pick its device and a project remembers the devices picked in it, so Guard
shows the C66 and AccessControl_Android shows the emulator or the S25 FE, whichever the task needs.

## What was there (measured 2026-11-03)

- **Android** (`adb devices -l`, the Android SDK's adb 37.0.1):
  - C66: Chainway, Android 13, 720×1440, over USB.
  - Franco's S25 FE: Samsung SM-S731B, Android 17, 1080×2340. Listed twice: over USB (`R5CW20XY7QZ`)
    and over Wi-Fi (`adb-R5CW20XY7QZ-Xk3Tq9._adb-tls-connect._tcp`).
  - The emulator `Pixel_9`: Android 15, 1080×2400 (`emulator-5554`).
- **iOS** (Xcode 27.1, macOS 27.2):
  - The iPhone 18 Pro Max simulator (iOS 27.0, 1320×2868 at 3×), booted with no Simulator app
    running, so there was no window to copy.
  - Franco's iPhone (iPhone 17 Pro): paired, not plugged in.
- **idb-companion 1.6.1** (Homebrew, `facebook/fb`) works with Xcode 27.1. Its `sim-video stream` wrote
  the booted simulator's screen as H.264 to stdout with no Simulator window: 84 frames in 5.2 s while
  dark mode was toggled (frames come only when the screen changes), 2.4 ms to encode each, about
  400 kbit/s at half size. It stops when its stdin closes.
- **Screenshots, for comparison:** one `simctl io screenshot` took 0.4 s; one `adb exec-out screencap`
  0.5 s on the C66, 1.1 s on the S25 FE and 34 s on the emulator.
- **The projects:** `AccessControl_Guard` and `AccessControl_Android` have
  `app/src/main/AndroidManifest.xml`. The iOS one is `/Volumes/Wyobi/AccessControl_ios` (lowercase),
  with `AccessControl.xcodeproj` and `.xcworkspace`.

## How Deck gets the screens

Franco's choice (2026-11-03): live video for all three, decoded by one view in Deck.

- **Android phones and emulators: scrcpy's server.** Deck carries the server of scrcpy v5.0.1 (open
  source, Apache 2.0) and runs it as scrcpy does: copied to `/data/local/tmp` over adb and started with
  adb's shell rights. It deletes its own file as soon as it has started, streams the screen as H.264
  through an adb tunnel and takes touches and keys back. Nothing is installed on the device.
- **Simulators: idb-companion.** Its `sim-video` streams a booted simulator's screen as H.264, with or
  without the Simulator app; `idb_companion` takes touches, buttons and keys. Deck uses the copy
  Homebrew installed and says how to install it when it's missing.
- **iPhones: macOS's own iPhone screen capture**, the one QuickTime uses (CoreMediaIO's screen capture
  devices), through a small Swift helper inside Deck that encodes H.264.
  - Over a cable only, and view only: Apple offers no way to tap a real iPhone remotely.
  - macOS treats an iPhone's screen as a camera, so the first use asks to let Deck use the camera.
  - **Not tried yet** (the iPhone wasn't plugged in): checked first in step 3.
- **Decoding:** WebCodecs in the renderer, in hardware.

Rejected:

- **Copying other apps' windows** (scrcpy's, Simulator's, QuickTime's) into the pane: each window has
  to stay open (the booted simulator had none), it's view only, it needs Screen Recording permission,
  and Windows gets no Android view.
- **Screenshots on a timer:** 0.4–34 s each (above), view only, and no iPhone.

## What the user sees

### Which tabs show a device

- **The project** is the tab's repository, taken at its main work tree, so a worktree
  (`.worktrees/fix`) belongs to its project; outside git, the tab's folder. Each worktree of a bare
  repository is a project of its own.
- **Where Deck looks for an app:**
  - in a git repository, the whole repository;
  - outside git, only in a Gradle build (`settings.gradle` or `settings.gradle.kts` at its root or in
    `android/`), so a plain folder, or a volume holding many projects, isn't searched;
  - never in the home folder: looking through `~` would read inside Desktop, Documents and Downloads,
    which can make macOS ask whether Deck may, and a "Don't Allow" there also keeps Deck's terminals
    out of those folders;
  - at most 200 folders per level, and 200 in all at the second and third levels. The answer is kept
    for 30 s per folder (it's asked whenever a tab comes to the front).
- **An Android app** has an `AndroidManifest.xml` in `src/main/` (or Kotlin Multiplatform's
  `src/androidMain/`) of a module one level down (`app/src/main/`: Guard, AccessControl_Android), or
  two levels down inside a first-level `android/` folder in any case (`android/app/src/main/`:
  Flutter, React Native) or inside a first-level folder that's a Gradle build of its own, or three
  levels down inside a Gradle build two levels down (a monorepo's `apps/<build>/<module>/`, an app's
  `mobile/android/app/`). The other first-level folders are listed for that only when nothing was
  found higher up.
- **An iOS app** has an Xcode project or workspace at the project's root or one folder down
  (`ios/Runner.xcworkspace`); outside git, only one in the folder itself counts. Off macOS there's no
  Xcode scan at all: simulators show only there.
- **Both** (Flutter, React Native, Kotlin Multiplatform) take both kinds of device.
- **The panel shows when a device that fits is connected**: Android phones and emulators for an
  Android app; simulators and iPhones (macOS only) for an iOS app. Once the project has picked
  devices, only those open it (below). Elsewhere it shows only when asked for, and then offers every
  device. A project's picks don't open it there by themselves: they're used once the panel is shown
  by hand. An iOS app's panel also opens while a simulator is booted that Deck can't show, to say what
  to install (States).
- **View → Device Panel** (⌘⇧D; Ctrl+Shift+D off macOS) hides or shows it per tab, like the git and
  Claude panels. The choice holds in the project it was made in.

### Which device

- **A tab keeps its own pick** while it stays in that project, so two tabs on two tasks in
  AccessControl_Android can show the emulator and the S25 FE. In another project the pick no longer
  counts, from the moment the tab gets there, so a `cd` never starts a stream for the old project's
  device.
- **A project remembers the devices picked in it**, the latest first and at most 8 (`devices.json`
  in Deck's data folder; Deck 0.4's one device per project is read as a list of one). A tab that
  hasn't picked shows the latest of them that's connected, so every Guard tab shows the C66 once it
  has been picked there, and AccessControl_Android shows the emulator or, while it's closed, the
  S25 FE. A tab coming to the front reads them again before it streams, since another tab may have
  picked meanwhile.
- **None of them connected:**
  - the project has picked devices: no panel. Another project's phone never opens it, so Guard with
    its C66 unplugged doesn't ask between the S25 FE and a face terminal; View → Device Panel still
    offers every device;
  - nothing picked yet, one device fits: it's shown, without becoming a pick, so a picked one takes
    over when it's connected;
  - nothing picked yet, several fit: the panel asks which, listing them, unless one is already shown
    (below);
  - none fits: no panel.
- **The device shown stays put** while the pick doesn't change:
  - one that goes away stays, as "disconnected" over its last picture, for 10 s, so a cable that
    wiggles doesn't make the pane jump;
  - one still connected stays when a second device that fits arrives: the panel doesn't drop to
    asking, and the menu switches;
  - a new pick (the tab's, or the project's from another tab) or a move to another project ends
    either at once, so a pick made right after a disconnect doesn't wait out the 10 s.
- **The first list waits:** when Deck starts following the devices, or adb's server has restarted,
  it waits until every connected device has said what it is, 3 s at most from adb's first list, so
  a project with two devices asks rather than showing whichever answered first. The simulators'
  first list is the notifier's first line, about 2.5 s after it starts. A tab waits only for the
  kinds it may show (its project's apps', those of the devices picked there or by the tab, and every
  kind when the panel was asked for), so a project with a phone and a simulator asks rather than
  showing whichever kind came first. Meanwhile the panel says "Looking for devices…".
- **Picking:** the device's name in the panel's header opens a menu, the devices that fit first, then
  any others, each with its kind and connection: `Android 13 · USB`, `Android 17 · USB + Wi-Fi`,
  `Emulator · Android 15`, `Simulator · iOS 27.0`, `iPhone · cable · view only`. One that isn't ready
  says so instead: `not allowed yet`, `offline`, `connecting`. A pick sets the tab's device and the
  project's; choosing the device already shown picks it too. Within each group the menu lists
  phones, then emulators, then simulators, each by name.
- **Names:**
  - an Android phone's own name (`settings get global device_name`: "Franco's S25 FE", "C66"), else
    its maker and model;
  - an emulator's AVD name, with underscores as spaces;
  - a simulator's or an iPhone's name.
- **One device, two connections:** the S25 FE over USB and over Wi-Fi is one device, used over USB
  while that's connected and over Wi-Fi when it isn't.
- **Telling devices apart:** phones by serial number (`ro.serialno`), emulators by AVD name (their
  `emulator-5554` changes with the port), simulators and iPhones by UDID. A device is listed only once
  it has said what it is (or didn't answer three times), and an emulator still starting not at all,
  so a device's id never changes under the panel. A phone still starting up is asked again every 3 s,
  for two minutes at most, so one rebooted while plugged in gets its own name back.

### The panel

```
┌ right pane ────────────────────────────┐
│ ▾ C66 ▾  Android 13 · USB  ◁ ○ □ ⏻  ◉ │  header
│          ┌──────────────┐              │
│          │              │              │
│          │    screen    │              │  fitted, centred
│          │              │              │
│          └──────────────┘              │
├─────────────── splitter ───────────────┤
│ ✻ working · ctx 84k                    │  Claude panel, as now
│ feed …                                 │
│ USAGE …                                │
│ clipboard card                         │
└────────────────────────────────────────┘
```

- **Where:** at the top of the right pane, above the Claude panel, with a splitter between them. The
  screen is what Franco looks at once Claude has installed a build, and the feed scrolls underneath.
  The usage and clipboard cards stay with the Claude panel. Without a Claude panel (no session, or
  hidden), the device takes the whole pane; without a device, the pane is as now.
- **Height:** 60% of the pane at first: at 60% of a 1,000 px pane the S25 FE's screen is about 260 px
  wide. Dragging the splitter sets the share for every tab, between 15% and 85%, remembered like the
  panels' widths; double-click resets it. The device panel keeps at least 152 px (its header and
  120 px of screen) and the Claude panel under it 160 px, and the cards keep their heights: a window
  too short for all of it takes the room from the device panel first. The pane's width is the Claude
  panel's, as now.
- **Folded with no Claude panel**, the pane keeps its width and shows the header: the fold is the
  window's, and the header has to stay reachable. View → Device Panel hides it.
- **The screen:** as large as fits, its shape kept, centred, with rounded corners and a thin ring
  around it, drawn outside the picture: a border squeezed the picture inside its size and shifted
  touches. It turns with the device.
- **Header:**
  - a caret folds the panel to its header in every tab at once, like the usage card, and stops the
    stream;
  - the device's name opens the menu; beside it, its kind and connection, cut short and then dropped
    when the pane is narrow;
  - Android: Back ◁, Home ○, Recent apps □ and Power ⏻; simulators: Home ○; iPhones: none;
  - **Add screenshot to Claude** (◉, a camera), while Claude runs in the tab: saves the screen as a PNG
    and types its path into Claude's prompt, as the clipboard card's Add to Claude does. Claude Code
    turns it into `[Image #N]`. It needs a live picture; its error stays with its device and shows
    only while Claude runs.
- **The keyboard:** clicking the screen gives it the keyboard, which a teal ring shows. Clicking the
  terminal gives it back, and so do folding the panel and another device taking the screen's place.
  Tab and Esc go to the device, so the way out is a click elsewhere or one of Deck's shortcuts.
  Clicks in the header and the chooser leave the keyboard where it was, and a pick from the ▾ menu
  gives it back to where it was when the menu opened (the terminal, after a click).

### Using the device from Deck

Android phones, emulators and simulators. iPhones are view only.

- A click taps, a drag swipes and a held click is a long press, with one finger: one pointer at a
  time. A finger still down when the screen goes (a tab switch, a fold) is lifted, and so is one held
  through a rotation.
- On Android the scroll wheel or trackpad scrolls where the pointer is, about one step per wheel
  notch; a pinch isn't a scroll. On a simulator, drag instead.
- With the keyboard on the screen:
  - typing types on the device: text as text; Return, Backspace, Delete, Tab, Escape, the arrows,
    Home, End, Page Up and Page Down as keys, with Shift;
  - on a simulator the keys go as they are, since iOS edits text the way a Mac does: Option+Backspace
    deletes a word, Option+←/→ move by word, ⌘←/→ go to the line's start or end and ⌘↑/↓ to the
    text's, with Shift and Option as held. Every other ⌘ key, and every Ctrl one, stays Deck's;
  - on macOS an Android device's editing keys do what they do on a Mac:
    - Option+Backspace/Delete delete a word and Option+←/→ move by word. They go with Android's Ctrl,
      since Android's Alt+Backspace deletes the whole line; Shift is dropped on the deletes, as
      Android deletes nothing for Ctrl+Shift+Backspace;
    - Option+↑/↓ are plain arrows: Android's Alt+↑/↓ would jump to the text's start or end;
    - Cmd+←/→ go to the line's start or end, Cmd+↑/↓ to the text's (Ctrl+Home/End on Android);
    - every other ⌘ key stays Deck's;
  - off macOS the editing keys do what they do on Windows: Ctrl+Backspace/Delete delete a word and
    Ctrl+←/→ move by word (with Android's Ctrl; Shift dropped on the deletes), Ctrl+Home/End go to
    the text's start or end, and every other Ctrl key stays Deck's. Alt that isn't AltGr never reaches
    the device (Alt+F is a menu key, Alt+0233 an Alt code, Alt+Space the window menu, and Android's
    Alt+Backspace would delete the whole line), but AltGr types, also as Ctrl+Alt;
  - ⌘V (Ctrl+V or Ctrl+Shift+V off macOS) types the computer's clipboard text on the device: on
    Android through the device's clipboard, where it stays, as with scrcpy; on a simulator key by key,
    as a US keyboard types it (at most 1,000 characters), since iOS would ask before every paste from
    its own pasteboard. The screen takes the paste whenever it has the keyboard, even with text
    selected elsewhere in Deck, and pressing on the screen clears that selection;
  - Deck's own shortcuts (⌘T, ⌘W, ⌘1…, ⌘⇧G/A/D, and their Ctrl+Shift forms) still work.

### States

- **Looking for devices…**, with a spinner, until the first list of every kind the tab may show is in
  (above).
- **Connecting:** "Connecting to C66…" until the first frame, about a second. A start that takes more
  than 20 s has failed.
- **Still being set up:** "C66 is connecting…" while adb sets a device up, or while one just allowed
  says what it is.
- **Reconnecting:** a stream that breaks is started again after 1, 2 and 5 s, with "Reconnecting…"
  over the dimmed last frame. It counts as working again only after 5 s live, so one that breaks right
  after its first frame still runs out of tries. After that, the error and **Try again**.
- **Disconnected:** "C66 disconnected" over the dimmed last frame for 10 s, then the next device that
  fits, or no panel. A cable that wiggles doesn't make the pane jump.
- **Unauthorized:** "Allow USB debugging on C66: check its screen."
- **Offline:** "C66 isn't answering. Unplug it and plug it back in." A device in recovery or sideload
  gets this too.
- **Couldn't show it:** the reason (the last error of scrcpy's server, a Java exception's message or
  its root cause; `sim-video`'s `Error:` line, or its or the companion's last line that reads as a
  failure, such as "Target is no longer booted, companion going offline", else how the process
  ended; the helper's last error line) and **Try again**. A screen that fails to decode three times
  in a row, with no picture in between, says so the same way.
- **adb fails**, when the panel was asked for: "adb couldn't list the devices", with adb's own error.
- **No adb**, only when the panel was asked for: "Deck can't find adb, so it can't see Android
  devices. Install Android Studio or Android's platform tools."
- **No idb-companion**, with a simulator booted, in an iOS app's tab (which it opens) or a panel asked
  for: "Deck shows simulators with idb-companion:" `brew install facebook/fb/idb-companion` and
  **Copy**. An idb-companion without `sim-video`: "This idb-companion can't stream a simulator's
  screen. Update it:" `brew upgrade idb-companion`, with **Copy**. Looked at again whenever Deck comes
  to the front; once an installed idb-companion's notifier starts, the hint stays until its first
  list replaces it, rather than flash "Looking for devices…".
- **idb-companion fails** before its notifier lists anything, when the panel was asked for: "Deck
  couldn't list the simulators", with the notifier's last words (or "idb_companion listed nothing in
  20 s."). One that had listed keeps its list while it's started again.
- **Camera not allowed:** "macOS hasn't let Deck use the camera, which is how it shows an iPhone's
  screen." **Open System Settings** (Privacy & Security → Camera).
- **Nothing connected**, when asked for: "No devices connected. Plug in an Android phone with USB
  debugging on, start an emulator, or boot a simulator." Windows leaves out the simulator; iPhones
  join in step 3.
- **A panel that fails to draw** says "The device panel couldn't show this", with the error and **Try
  again**, without taking the pane with it. Another device or view gets another try by itself.

## How

### Finding devices

Deck follows devices only while a tab needs them: its project is an Android or iOS app, it has picked
a device, or its panel was asked for. One watch then follows both kinds, adb's devices and, on macOS
with idb-companion, the simulators, and merges them into one list (`registry.ts`) that says which
kinds are still finding their first devices (`pending`).

- **adb:** first `ANDROID_HOME` or `ANDROID_SDK_ROOT` in Deck's environment, then the SDK's usual place
  (`~/Library/Android/sdk/platform-tools/adb`; `%LOCALAPPDATA%\Android\Sdk\platform-tools\adb.exe`),
  then `PATH` and Homebrew's folders. Only absolute folders count: a relative `PATH` entry means "the
  current folder". With none found, Deck looks again whenever it comes to the front, so platform
  tools installed meanwhile are picked up without a restart.
  - The SDK's adb comes first because Android Studio runs it, and two adb versions restart each
    other's server.
  - An `ANDROID_HOME` set only in shell profiles isn't seen when Deck starts from Finder, as with
    `CLAUDE_CONFIG_DIR`.
  - adb's failures are shown in adb's own words (its `adb:` or `error:` line, at most 500
    characters).
- **Android devices:**
  - one `adb track-devices -l`, which reports each change as it happens. If adb's server goes away,
    it's started again after 1 s, then after twice the wait each time, up to 30 s. The wait goes back
    to 1 s only after a run of 30 s, so two adb versions fighting over the server don't restart every
    second;
  - a connection counts as USB unless its adb name is an emulator's or a network one, since with
    Windows' own USB driver adb lists no `usb:` field;
  - a device new in state `device` is asked once, in one `adb shell` call, for its serial number,
    maker, model, Android version, AVD name and name: up to three tries, 1.5 s apart.
- **Simulators:** one `idb_companion --notify stdout --only simulator --log-level info` reports every
  simulator's state as it changes, so nothing polls. About 2.5 s after it starts it prints one line,
  a JSON array of every simulator (`udid`, `name`, `os_version`, `state`, …); each later line lists
  only the simulators whose state changed (`Booting`, `Booted`, `Shutting Down`, `Shutdown`), and
  creating or deleting a shut-down simulator prints nothing. The booted ones are listed by name, each
  with its iOS version (`Simulator · iOS 27.0`).
  - `idb_companion` is looked for in `PATH`'s absolute folders, then Homebrew's (`/opt/homebrew/bin`,
    `/usr/local/bin`), and `sim-video` through Homebrew's stable link
    (`<prefix>/opt/idb-companion/libexec/sim-video`), else beside `idb_companion`'s real file
    (`…/Cellar/idb-companion/<version>/libexec/`): a `brew upgrade` deletes the versioned folder.
  - A notifier that stops is started again after 1 s, then twice the wait each time, up to 30 s,
    back to 1 s after a run of 30 s, as adb's tracker is. One that lists nothing in 20 s is taken as
    hung and killed, and that wait doubles, up to 2 minutes, until a run lists. One that had listed
    keeps its list while it's away.
  - **Without idb-companion**, or with one without `sim-video`, Deck asks `pgrep -x launchd_sim` (each
    booted simulator runs one) when it starts following devices and whenever it comes to the front,
    only to say what's missing. Not `simctl`: the selected Xcode's is a wrapper that can run
    `xcodebuild -runFirstLaunch` after an Xcode update, which a background check must never start.
  - **For checks:** `DECK_SIMULATOR_SET` points the notifier, the companion and `sim-video` at another
    device set (a throwaway simulator's), and `DECK_IDB_COMPANION` replaces where `idb_companion` is
    looked for (`/nowhere` hides it).
- **iPhones:** the helper reports screen capture devices as they come and go.

### Android

1. **Copy the server:** `adb -s <serial> push <server> /data/local/tmp/deck-scrcpy-server.jar`.
2. **Tunnel:** `adb -s <serial> forward tcp:0 localabstract:scrcpy_<id>`, with a random 31-bit `<id>`;
   adb picks a free port on 127.0.0.1. Removed again once both sockets are connected, as scrcpy does.
3. **Start:** `adb -s <serial> shell CLASSPATH=/data/local/tmp/deck-scrcpy-server.jar app_process /
   com.genymobile.scrcpy.Server 5.0.1 scid=<id> log_level=info tunnel_forward=true audio=false
   control=true video_codec=h264 max_size=1600 max_fps=60 stay_awake=true clipboard_autosync=false`,
   at scrcpy's default bit rate (8 Mbit/s).
4. **Connect** twice, video then control. The video socket starts with a dummy byte, the device's name
   and the codec, then a size packet per capture session (a rotation starts one) and frames, each
   behind scrcpy's 12-byte header. Through the tunnel adb accepts a connection even before the server
   listens, then drops it, so Deck tries until the dummy byte comes: 100 times, 100 ms apart.
5. **Stop:** close the sockets and end the `adb shell` (and remove the forward if it's still there).
   Ending the local `adb shell` ends the server on the device: adbd hangs up the device's shell, which
   hangs up the server. A stop during a start cancels the step under way (the push too) and closes
   what was opened: before it did, quitting Deck mid-start left the server running.

- **What it changes on the device**, only while shown:
  - the screen is turned on and stays on while the device is plugged in (`stay_awake`);
  - scrcpy puts the setting back when it stops, even when Deck quits or the cable is pulled: its
    cleanup runs as a separate process on the device;
  - the device's own copies aren't sent back (`clipboard_autosync=false`), but a paste from Deck stays
    on the device's clipboard.
- **Input:** scrcpy's control messages: touch (down, move, up, as a finger: pointer id -2), scroll,
  key codes (Back, Home, Recent apps, Power, typing keys), text, set clipboard with paste, and reset
  video for a new key frame. Positions are whole pixels of the frame, sent with its size: scrcpy
  ignores a touch made for another size. Text goes in pieces of at most 300 bytes and a paste is at
  most 256 KiB, as scrcpy's own client sends them. Main checks everything the renderer sends.
- **The video stream:** packets up to 16 MiB. Anything that makes no sense (an empty or larger
  packet, a frame before the screen's size, a screen of 0 or more than 65,535 px) ends the stream
  with an error.
- **The server file:**
  - downloaded from scrcpy's GitHub release at install and checked against its SHA-256 (v5.0.1:
    733,930 bytes, `764eb6f79811d5211fe9df341120882ba9994c7a61b897d7bf3fb662e53bc536`); the download
    gives up after 120 s;
  - never committed; shipped in the app's resources with scrcpy's license. A build without the right
    file stops, since electron-builder would only warn about a missing resource;
  - the server must match the version Deck passes it, so the version is set in one place.

### Simulators

- **Video:** `sim-video stream --set <device set> --udid <udid> --scale <s> --key-frame-rate 2
  --transport fmp4 -`.
  - fMP4, not `--transport annex-b`: Annex B has no delimiters, so a picture is known to be complete
    only once the next one starts, and a still screen sends no next one (measured: SPS, PPS and one
    IDR, then nothing). The fMP4 is `ftyp`, `moov` (an `avc1` track whose `avcC` holds one SPS and one
    PPS, with 4-byte NAL lengths), then a `moof` and an `mdat` per picture. Main turns the `avcC` into
    a config packet and each `mdat` into one picture, in Annex B: the packets the view already
    decodes. A box over 16 MiB, a picture before the `moov` or a broken one ends the stream with an
    error.
  - The scale keeps the long side within 1600 px, never above 1 (0.61 for the iPhone 17's
    1206×2622).
  - Deck keeps its stdin open; closing it stops the stream.
- **Input:** `idb_companion --udid <udid> --grpc-domain-sock <socket> --terminate-offline true
  --log-level info`, one per simulator shown. It exits when its simulator shuts down ("Target is no
  longer booted, companion going offline"), and logs at `info` rather than its default `debug`. Two
  companions for one simulator work side by side, so idb's own client, which keeps one in `/tmp/idb/`,
  isn't in the way.
  - **The socket** is in Deck's own folder, `<temp>/deck-<instance>/` (`socketDirFor`; `<instance>`
    as for the clipboard's images), made private (0700) and used only while it's this user's own and
    closed to others, so only Franco's user can reach the companion; no network port. A socket's path
    must stay under macOS's 104 bytes (`sun_path`): with a longer one the companion fails with
    "GRPCCore.RuntimeError error 1" and runs on without a socket. So the folder leaves room for a
    name (`<the UDID's first 8>-<8 random hex>.sock`), else it's `/tmp/deck-<uid>-<instance>/`. A
    companion's socket goes when it exits, and the folder at quit.
  - **gRPC on `node:http2`** over the socket, with idb's few messages written by hand (the field
    numbers of idb's `proto/idb.proto`, MIT): `describe` for the screen's size in pixels and points,
    and one `hid` call kept open from the first input, which idb acts on as each event arrives.
  - **Touches** are in points: a tap is a touch down, then an up; idb has no move, so a drag is a
    touch down at each point along the way, then an up.
  - **Keys** are USB HID usages, with Shift, Option or ⌘ pressed around them. Typing and pastes go
    key by key as a US keyboard types them (Shift where needed, newlines as Return), at most 1,000
    characters; anything else is skipped. A paste isn't put on the simulator's pasteboard: after
    `xcrun simctl pbcopy`, ⌘V made iOS ask "would like to paste from CoreSimulatorBridge" every time.
  - **Home** is idb's Home button, pressed and let go.
- **Key frames:** `sim-video` can't be asked for one. While the screen changes it sends one every
  2 s; a still screen sends nothing at all. So a key frame asked for (a viewer joining, a decoder
  behind) replays the current group of pictures, the last key frame and those since, when that's at
  most 8, else starts `sim-video` again, which begins with a key frame of the screen as it is. A
  longer replay would trip the view's 10-picture backlog rule. One asked for while a new
  `sim-video`'s first key frame is on its way does nothing.
- **Starting and ending:** the companion opens its socket in about half a second; the start waits up
  to 10 s for it, then asks `describe`. When `sim-video` or the connection ends without an error of
  its own, most often because the simulator is shutting down, the session waits a second for the
  companion's words. Reasons are cut at 500 characters. A process that ignores SIGTERM gets SIGKILL
  2 s later.
- Deck never boots or shuts down simulators.

### iPhones

- **The helper** (`native/iphone-screen/`, Swift, macOS only) turns on
  `kCMIOHardwarePropertyAllowScreenCaptureDevices`, then:
  - lists the iPhone and iPad screens macOS offers (plugged in, unlocked, trusting this Mac) as they
    come and go;
  - streams one: AVFoundation capture, VideoToolbox H.264 (the long side within 1600 px, a key frame
    on request), frames on stdout behind a small header; closing its stdin stops it.
- **Built** with `swiftc` on macOS (dev and CI), shipped in the app's resources, signed and notarised
  with the app.
- **Camera:** Deck's Info.plist says why ("Deck shows a connected iPhone's screen, which macOS treats
  as a camera."), and the hardened runtime gets `com.apple.security.device.camera`. macOS asks once;
  if Franco says no, the panel says so.
- **Checked first in step 3:** the phone appears, frames come, and the capture device's ID is the
  phone's UDID.

### The view

- **Decoding:** WebCodecs `VideoDecoder`, in hardware on Apple silicon and on most Windows PCs.
  - The codec string comes from the stream's SPS, with the two reserved bits of its constraint byte
    cleared: some encoders set them, and Chromium refuses the string then.
  - The H.264 is taken as Annex B (no `description`): a config packet's SPS and PPS go in front of the
    next key frame. `sim-video`'s fMP4 fragments are turned into Annex B in main; scrcpy's and the
    helper's arrive framed.
  - A rotation needs nothing new: the same codec string decodes both sizes (measured), so the decoder
    is configured again only when the string changes.
  - A decoder that fails is replaced by one decoding in software. After 3 failures in a row with no
    picture in between, the screen says so with **Try again**, rather than restart the device's
    encoder over and over. Each new view tries the hardware first again.
- **Drawing:** each new frame onto a `<canvas>` the size of the fitted screen at the window's pixel
  ratio, which it follows (another display, zoom). Only the latest frame is kept.
- **Keeping up:** if the decoder falls more than 10 frames behind, the view skips to the next key
  frame and asks for one, at most once a second (each one restarts the device's encoder). One held
  back by that second is asked for once it has passed, on a timer: a still simulator sends no next
  frame to check on. That's scrcpy's reset video, the helper's request, and on a simulator a replay
  of a short group of pictures or a new `sim-video` (above): `sim-video` sends a key frame every 2 s
  only while the screen changes.
- **Input:** a point on the canvas maps through the letterbox to the frame, then to the device:
  scrcpy takes frame pixels with the frame's size, idb takes points. A touch held while the frame
  changes size is let go at its last point, once for each size: scrcpy drops a touch made for another
  size, and may switch before or after it says so. Keys become Android key codes for scrcpy and USB
  HID usages for idb.

### Streaming and its cost

- **Only a panel on screen streams:** the active tab's, unfolded, with Deck's window visible (not
  minimized, hidden or fully covered, by the page's visibility), the tab's project read since it came
  to the front, and the Mac neither locked nor asleep.
  - Deck in the background but visible, beside Xcode or Android Studio, keeps streaming: that's the
    point.
- **10 seconds' grace:** a stream no panel shows stops after 10 s, so leaving a tab and coming back
  doesn't restart it (a restart takes about a second). Meanwhile nothing is sent to the window; a
  panel coming back gets a key frame. Tabs showing the same device share its stream.
- **Size and rate:** the long side within 1600 px (the C66 as it is, the S25 FE at about 740×1600), up to
  60 frames a second, no audio. A still screen costs little: scrcpy repeats a frame every 100 ms,
  and `sim-video` sends none. A simulator's stream runs its own `idb_companion` (about 29 MB) and
  `sim-video`, besides the notifier that runs while devices are followed.
- **Measured in step 1** (2026-11-04, a dev build, two phones on their lock screens, so almost no
  frames): Deck's main, GPU and renderer processes used about 0.5% of a core each. A moving screen's
  cost isn't measured yet.

### Screenshot to Claude

- The view keeps the last decoded frame. The camera button draws it at full size into a PNG and sends
  it to main; without a live picture (connecting, reconnecting, failed) it adds nothing, since a stale
  picture would mislead Claude.
- Main takes only a PNG, of at most 32 MiB, and saves it as the clipboard card saves a pasted image:
  in its image folder (`<temp>/Deck clipboard/<instance>/`, cleared at start and quit), named by its
  content, and returns the quoted path. The renderer types it into the tab's terminal through
  `pasteSafe()`, as Add to Claude does.
- On Windows the path's backslashes are doubled. Claude Code strips a pasted path's quotes and drops
  each backslash that escapes a character before it checks that the path is absolute (read in Claude
  Code 2.1.283's paste code; not yet tried on Windows). The clipboard card's image paste does the same.

### Code

- `src/shared/`: `DeviceInfo` (id, kind, name, detail, state), `DeviceList` (the devices, adb's
  problem and the simulators', the kinds still pending), `DeviceProject` (root, Android app, iOS app,
  picks), a stream's events (size, packet, state) and input (touch, scroll, key, a simulator's HID
  key and Home button, text, paste); `DeckApi.devices` and the `devices:*` channels;
  `quoteImagePath` in `quote.ts`; `hid.ts`, a simulator's named keys as USB HID usages and Deck's
  modifier bits.
- `src/main/devices/`:
  - `project.ts`: a folder's project and whether it's an Android or iOS app (tested on temp folders);
  - `picks.ts`: `devices.json` (each project's picks, latest first), written beside and renamed
    (`fs/atomic.ts`);
  - `session.ts`: the shape every kind of stream has (`input`, `keyframe`, `stop`, none of which
    throws); `android/session.ts` wraps scrcpy's in it;
  - `streams.ts`: a stream's viewers, its 10 s grace, its retries and its start deadline, for every
    kind;
  - `registry.ts`: one list from both sources, with each one's problem and the kinds still pending (a
    pure merge);
  - `ipc.ts`: wiring, the 30 s project cache, starting and stopping both sources as tabs need them,
    and lock and sleep. Every listener checks its arguments;
  - `android/adb.ts`: finding adb and running it, like `git/runner.ts`;
  - `android/devices.ts`: `track-devices -l` frames and identity parsing, USB and Wi-Fi merged (pure);
  - `android/tracker.ts`: the long-running `track-devices`, identity asks, restarts and the first
    list's wait;
  - `android/protocol.ts`: the video stream's reader and the control messages (pure);
  - `android/input.ts`: the renderer's input, checked and turned into control messages (pure);
  - `android/server.ts`: the server file and its version;
  - `android/scrcpy.ts`: push, tunnel, start, sockets and stop;
  - `ios/tools.ts`: finding `idb_companion` and `sim-video`, and whether any simulator is booted,
    asked without idb;
  - `ios/simulators.ts`: the notifier's lines (pure) and the long-running notifier;
  - `ios/simulator.ts`: one simulator's session (companion, socket, `describe`, `sim-video`, input,
    the group of pictures kept for a key frame); `ios/simulator-io.ts`: the real processes, the
    socket folder and its removal;
  - `ios/process.ts`: stopping a process (SIGTERM, then SIGKILL) and its last words;
  - `ios/grpc.ts`: a gRPC client on `node:http2` over a Unix socket;
  - `ios/proto.ts`: idb's HID and `describe` messages, and gRPC's message framing (pure);
  - `ios/fmp4.ts`: `sim-video`'s fMP4 as Annex B packets (pure);
  - `ios/input.ts`: the renderer's input for a simulator, checked and turned into HID events (pure);
  - `ios/test-process.ts` and `ios/test-fixtures.ts`: fake child processes, fMP4 and `describe`
    fixtures for the tests;
  - step 3: `ios/iphone.ts` (the helper).
- `src/renderer/src/device/`:
  - `pick.ts`: which device a tab shows, and the holds; which devices fit (by platform), the menu's
    order, whether a tab still waits (`stillLooking`), and the panel's rules (`devicesNeeded`,
    `panelRules`) (pure);
  - `fit.ts`: letterboxing, and a point on the screen as a pixel of the frame (pure);
  - `keys.ts`: keys to Android key codes, a simulator's HID usages, or text (pure);
  - `codec.ts`: NAL units and the avc1 codec string (pure);
  - `DevicePanel.tsx`: header, chooser and states, inside an error boundary; `DeviceMenu.tsx`: the
    menu;
  - `DeviceScreen.tsx`: canvas, decoder, input and the screenshot;
  - `useDevices.ts` and `device.css`.
- `App.tsx`:
  - the right pane holds the device panel, a horizontal splitter and the Claude panel;
  - `TerminalTab.device` (the tab's pick) and `deviceHidden`;
  - the fold and the height share, one each for the window.
- `menu.ts` and `terminal/keys.ts`: View → Device Panel.
- `scripts/fetch-scrcpy-server.mjs`, run by `postinstall` (or `npm run fetch:scrcpy`), and
  `scripts/before-pack.cjs`, electron-builder's `beforePack`, which stops a build without the right
  server. Step 3: `native/iphone-screen/` with `scripts/build-iphone-helper.mjs`.
- **Packaging:**
  - `electron-builder.yml`: `extraResources` for the server and, on macOS, the helper (step 3);
    `NSCameraUsageDescription` (step 3);
  - the camera entitlement in `build/entitlements.mac.plist` (step 3);
  - scrcpy's license (Apache 2.0) in `resources/THIRD-PARTY-NOTICES.txt`, shipped with the app;
    idb's (MIT) joined it in step 2, for `ios/proto.ts`;
  - step 2 adds no dependency: no `@grpc/grpc-js`, and idb-companion is the user's own, from
    Homebrew, never shipped.
- **Docs:** CLAUDE.md (paths and the facts above), README, DECK.md (M5), TESTING.md and CHANGELOG.

## Build order

1. **The panel and Android**, macOS and Windows: finding devices, the project rules and picks, the
   panel, scrcpy video and input, and the screenshot. This covers Guard and AccessControl_Android.
   Built 2026-11-03/04.
2. **Simulators**, macOS: idb-companion's video and input. Built 2026-11-10.
3. **iPhones**, macOS: the helper, once it has been seen working with Franco's iPhone.

Each step gets its own plan and pull request and works without the next.

## Known limits

- **Black screens:** Android hides secure windows (`FLAG_SECURE`: some banking, payment and DRM
  screens) from screen capture, so they show black.
- **Typing:**
  - on Android, characters the device's key map can't make are skipped; simulators get what a US
    keyboard types, and characters it can't are skipped;
  - a paste of more than 1,000 characters on a simulator is cut to its first 1,000, without a word,
    and a long one is slow in a field that works on every key: Settings' search settled about 89 s
    after 1,000 characters (2026-11-10);
  - no input methods (Chinese, Japanese, Korean): composed text doesn't reach the device;
  - dead keys: macOS should compose them (Option+E, then E, types "é"); not yet checked on a device,
    and unverified on Windows.
- **Shortcuts:** ⌘A on the screen selects Deck's own text (the Edit menu's Select All), not the
  device's; a paste still goes to the device. Off macOS, Ctrl+←/→ and Ctrl+Backspace stay Deck's.
- **Pastes stay on the device:** a paste leaves its text on the device's clipboard, as scrcpy's does,
  a password manager's copy included.
- **One finger:** no pinch or two-finger gestures, and no scroll wheel on simulators.
- **One adb:** an adb of another version, run by Claude or by hand, kills Deck's adb server; if
  Deck's had run 30 s or more, Deck starts it again within 1 s and kills theirs, which cuts off, say,
  a long `adb logcat`. Deck prefers the SDK's adb, as Android Studio does. Wi-Fi debugging works once
  the device has been paired elsewhere (Android Studio, `adb pair`); Deck doesn't pair.
- **Telling devices apart:** two devices with the same id look like one (cheap boards that all report
  `0123456789ABCDEF` as their serial; two copies of one AVD started with `-read-only`), and devices
  with the same name look alike in the menu.
- **adb's other states:** a device in recovery or sideload is told to unplug; on Linux,
  `no permissions` shows as offline, or not at all when adb gives no reason.
- **The first list:** an emulator still offline then isn't waited for (it joins when it answers), and
  an adb that never lists anything leaves "Looking for devices…" up.
- **Which projects:** a folder outside git that holds several Gradle builds isn't found (show the
  panel by hand); a git failure is taken as "outside git" for 30 s; a single-module app at the
  repository's root isn't found, nor an app deeper than a Gradle build two levels down
  (`apps/<app>/android/app/`); a repository with only an Android library counts as an app. An iOS
  project outside git is found only by an Xcode project in the folder itself, and a symlinked
  `.xcodeproj`, or a symlinked first-level folder holding one, isn't seen.
- **Simulators:**
  - only those in Xcode's own device set are listed (another set only with `DECK_SIMULATOR_SET`);
  - a rotated simulator in a landscape app is unchecked: rotating with idb's orientation event
    changed no box size, since iPhone Settings stays portrait;
  - idb-companion uninstalled while its notifier runs shows the notifier's failed start (`ENOENT`)
    once it's started again, not the install hint;
  - a notifier that never lists anything is started again and again, its 20 s wait doubling up to
    2 minutes;
  - a companion or notifier that ignores SIGTERM can outlive Deck when it quits: Deck exits before
    the 2 s SIGKILL;
  - simulators of other platforms (watchOS, tvOS, visionOS) aren't listed.
- **A project's devices:** a device picked once by hand stays among the project's until 8 newer
  picks push it out, so it opens that project's panel whenever the others are unplugged.
- **A crash while starting:** if Deck crashes in the second a stream takes to start, the adb client
  and the server on the device are left waiting, with the screen kept on, as scrcpy itself would.
- **A very short window:** below about 620 px of window height the right pane can't fit the device
  panel's 152 px, the Claude panel's 160 px and both cards, so the cards overflow and the clipboard
  card's Add button can end up below the window. Folding the device panel removes its floor.
- **Emulators** may encode in software, so their stream may be slower: not measured yet.
- **A lit screen:** a device shown for hours stays on while plugged in, and a still image can mark an
  OLED screen. Fold the panel, or press Power, when not watching.
- **iPhones** need a cable, an unlocked phone and trust in this Mac, and are view only.
- **iOS needs a Mac:** Windows shows Android devices only.
- **A Mac-only Xcode project** counts as an iOS app, so a booted simulator shows there too.
- **Client data:** device screens can show residents' and visitors' details. Frames are kept in memory
  only; a screenshot is saved only when asked, in Deck's temp image folder (cleared at start and quit),
  and Deck sends it nowhere.
- **Not yet tried on Windows:** adb's lists there (they may end lines with "\r\n"), cables listed
  without a `usb:` field, image paths with doubled backslashes, AltGr and dead keys
  (`docs/TESTING.md` 18p–18y).

## Not in this design

- Recording, audio, multi-touch, volume keys, rotating the device from Deck, or dropping an APK to
  install it.
- Starting or stopping emulators and simulators.
- Controlling a real iPhone.
- Claude looking at the screen by itself: Claude Code can already use adb and simctl.
- Following the device Claude installs to (`adb -s …` in its commands). Maybe later.

## Testing

- **Unit:**
  - the project rules on temp folders: Gradle with `app/src/main/AndroidManifest.xml`; Flutter
    (`android/app/…`, `ios/Runner.xcworkspace`); an Xcode project one level down; none; a worktree
    belonging to its project;
  - `track-devices -l` lists: USB; Wi-Fi (mDNS and `ip:port`); emulators; `unauthorized`; `offline`;
    empty. One phone over USB and Wi-Fi merged;
  - picks: the tab's, the project's latest connected, the only device that fits, several, none, a
    project whose devices are all unplugged, asked for by hand, the picked device coming back, and
    the 10 s of "disconnected";
  - scrcpy's video stream parsed from chunks split anywhere (dummy byte, name, codec, sessions, config
    and media packets), and control messages byte for byte against scrcpy's own
    `test_control_msg_serialize.c`;
  - a stream's life: viewers, the 10 s grace, retries at 1, 2 and 5 s, lock and sleep;
  - NAL units and the codec string; pointer mapping through the letterbox and after a rotation;
    keys, a simulator's HID usages included;
  - `idb_companion --notify` output, the notifier's restarts and its first list's deadline;
    `sim-video`'s fMP4 split anywhere; idb's messages byte for byte against protobufjs's; gRPC
    against a local HTTP/2 server on a Unix socket; a simulator's session against fake processes; and
    the helper's frames;
  - main's wiring, including arguments checked, both sources' races, and simulators listed beside a
    fake adb.
- **In the app** (a dev build with its own userData, Franco's devices):
  - Guard's tab shows the C66; AccessControl_Android asks, then remembers; two tabs, two devices;
  - taps, swipes, typing, paste, Back, Home, Recent apps, Power, rotation and the wheel;
  - the S25 FE's cable pulled: it carries on over Wi-Fi; the C66's: "disconnected", then no panel;
  - tab switches within 10 s don't restart the stream; minimizing stops it; after Deck quits,
    `settings get global stay_on_while_plugged_in` is as before and the server's file is gone;
  - the screenshot reaches Claude as `[Image #N]`;
  - Deck's CPU with a stream showing.
- **Simulators:** a throwaway simulator in a private device set (`DECK_SIMULATOR_SET`), never
  Franco's own, booted without the Simulator app: video, taps, typing, a paste, Home, a tab switch
  within 10 s, and nothing left running after a quit. Then with idb-companion out of reach
  (`DECK_IDB_COMPANION=/nowhere`): the install hint. Checked 2026-11-10 on a throwaway "Deck probe"
  (iPhone 17, iOS 27.0) through the DevTools protocol: all of these, plus a still screen's group
  replayed and a moving one's `sim-video` started again on tab switches, a 1,000-character paste
  that arrived whole, and a tap after ten minutes idle (details in CLAUDE.md). Not yet: the camera
  with Claude running, a landscape app, the "old-idb" hint, the notifier failing for real, two Decks
  at once.
- **iPhone:** the Camera prompt, the stream, unplugging and locking.
- **Windows:** the Android steps, in `docs/TESTING.md`.
