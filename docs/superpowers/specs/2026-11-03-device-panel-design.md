# Device panel: design

2026-11-03. Franco asked: "if we have a device connected and we're busy on that project, let's say
/Volumes/Wyobi/AccessControl_Guard and we have the c66 connected then show it in the right pane, if we're
in /Volumes/Wyobi/AccessControl_Android then show either the emulator or the S25 in the right pane
depending on the task we're busy with, should be selectable.. if we're in /Volumes/Wyobi/AccessControl_iOS
then show the view from the simulator or my connected iphone". He chose how Deck gets the screens (below).
The rest was decided without a round of questions: review it here.

## Goal

In a tab whose project is an Android or iOS app, show the device the app runs on, live, at the top of
the right pane. A tab can pick its device and a project remembers its last pick, so Guard shows the C66
and AccessControl_Android shows the emulator or the S25 FE, whichever the task needs.

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
  (`.worktrees/fix`) belongs to its project; outside git, the tab's folder.
- **An Android app** has an `AndroidManifest.xml` in `src/main/` of a folder one or two levels down:
  `app/src/main/` (Guard, AccessControl_Android), `android/app/src/main/` (Flutter, React Native).
- **An iOS app** has an Xcode project or workspace at the project's root or one folder down
  (`ios/Runner.xcworkspace`).
- **Both** (Flutter, React Native, Kotlin Multiplatform) take both kinds of device.
- **The panel shows when a device that fits is connected**: Android phones and emulators for an
  Android app; simulators and iPhones (macOS only) for an iOS app. Elsewhere it shows only when asked
  for, and then offers every device.
- **View → Device Panel** (⌘⇧D; Ctrl+Shift+D off macOS) hides or shows it per tab, like the git and
  Claude panels. The choice holds in the project it was made in.

### Which device

- **A tab keeps its own pick** while it stays in that project, so two tabs on two tasks in
  AccessControl_Android can show the emulator and the S25 FE.
- **A project remembers the last device picked in it** (`devices.json` in Deck's data folder). A tab
  that hasn't picked shows that one, so every Guard tab shows the C66 once it has been picked there.
- **Nothing picked, or the pick isn't connected:**
  - one device fits: it's shown, without becoming the pick, so the picked one takes over when it's back;
  - several fit: the panel asks which, listing them;
  - none fits: no panel.
- **Picking:** the device's name in the panel's header opens a menu, the devices that fit first, then
  any others, each with its kind and connection: `Android 13 · USB`, `Android 17 · USB + Wi-Fi`,
  `Emulator · Android 15`, `Simulator · iOS 27.0`, `iPhone · cable · view only`. A pick sets the
  tab's device and the project's.
- **Names:**
  - an Android phone's own name (`settings get global device_name`: "Franco's S25 FE", "C66"), else
    its maker and model;
  - an emulator's AVD name, with underscores as spaces;
  - a simulator's or an iPhone's name.
- **One device, two connections:** the S25 FE over USB and over Wi-Fi is one device, used over USB
  while that's connected and over Wi-Fi when it isn't.
- **Telling devices apart:** phones by serial number (`ro.serialno`), emulators by AVD name (their
  `emulator-5554` changes with the port), simulators and iPhones by UDID.

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
  wide. Dragging the splitter sets the share for every tab, remembered like the panels' widths;
  double-click resets it. The screen keeps at least 120 px and the Claude panel 160 px. The pane's
  width is the Claude panel's, as now.
- **The screen:** as large as fits, its shape kept, centred, with rounded corners and a thin border.
  It turns with the device.
- **Header:**
  - a caret folds the panel to its header in every tab at once, like the usage card, and stops the
    stream;
  - the device's name opens the menu; beside it, its kind and connection, cut short and then dropped
    when the pane is narrow;
  - Android: Back ◁, Home ○, Recent apps □ and Power ⏻; simulators: Home ○; iPhones: none;
  - **Add screenshot to Claude** (◉, a camera), while Claude runs in the tab: saves the screen as a PNG
    and types its path into Claude's prompt, as the clipboard card's Add to Claude does. Claude Code
    turns it into `[Image #N]`.
- **The keyboard:** clicking the screen gives it the keyboard, which a teal ring shows. Clicking the
  terminal gives it back.

### Using the device from Deck

Android phones, emulators and simulators. iPhones are view only.

- A click taps, a drag swipes and a held click is a long press, with one finger.
- On Android the scroll wheel or trackpad scrolls where the pointer is; on a simulator, drag instead.
- With the keyboard on the screen:
  - typing types on the device: text as text; Return, Backspace, Delete, Tab, Escape and the arrows
    as keys;
  - ⌘V (Ctrl+Shift+V off macOS) types the Mac's clipboard text on the device: on Android through the
    device's clipboard;
  - Deck's own shortcuts (⌘T, ⌘W, ⌘1…, ⌘⇧G/A/D, and their Ctrl+Shift forms) still work.

### States

- **Connecting:** "Connecting to C66…" until the first frame, about a second.
- **Reconnecting:** a stream that breaks is started again after 1, 2 and 5 s, with "Reconnecting…"
  over the dimmed last frame. After that, the error and **Try again**.
- **Disconnected:** "C66 disconnected" over the dimmed last frame for 10 s, then the next device that
  fits, or no panel. A cable that wiggles doesn't make the pane jump.
- **Unauthorized:** "Allow USB debugging on C66: check its screen."
- **Offline:** "C66 isn't answering. Unplug it and plug it back in."
- **Couldn't show it:** the reason (the last error line of scrcpy's server, `sim-video` or the
  helper) and **Try again**.
- **No adb**, only when the panel was asked for: "Deck can't find adb, so it can't see Android
  devices. Install Android Studio or Android's platform tools."
- **No idb-companion**, with a simulator booted: "Deck shows simulators with idb-companion:"
  `brew install facebook/fb/idb-companion` and **Copy**. A version without `sim-video`:
  `brew upgrade idb-companion`.
- **Camera not allowed:** "macOS hasn't let Deck use the camera, which is how it shows an iPhone's
  screen." **Open System Settings** (Privacy & Security → Camera).
- **Nothing connected**, when asked for: "No devices connected. Plug in an Android phone with USB
  debugging on or start an emulator; boot a simulator or plug in an iPhone." Windows leaves out the
  iOS half.
- **A panel that fails to draw** disappears without taking the pane with it, like the cards.

## How

### Finding devices

Deck looks for Android devices only while a tab's project is an Android app or a panel was asked for,
and likewise for iOS.

- **adb:** first `ANDROID_HOME` or `ANDROID_SDK_ROOT` in Deck's environment, then the SDK's usual place
  (`~/Library/Android/sdk/platform-tools/adb`; `%LOCALAPPDATA%\Android\Sdk\platform-tools\adb.exe`),
  then `PATH` and Homebrew's folders.
  - The SDK's adb comes first because Android Studio runs it, and two adb versions restart each
    other's server.
  - An `ANDROID_HOME` set only in shell profiles isn't seen when Deck starts from Finder, as with
    `CLAUDE_CONFIG_DIR`.
- **Android devices:**
  - one `adb track-devices -l`, which reports each change as it happens, restarted after a growing
    wait if adb's server goes away;
  - a device new in state `device` is asked once, in one `adb shell` call, for its serial number,
    maker, model, Android version, AVD name and name.
- **Simulators:** `idb_companion --notify stdout` reports every simulator's state as it changes, so
  nothing polls. Without idb-companion, Deck runs one `xcrun simctl list devices booted -j` (0.14 s)
  when an iOS project's tab comes to the front, only to say what's missing.
- **iPhones:** the helper reports screen capture devices as they come and go.

### Android

1. **Copy the server:** `adb -s <serial> push <server> /data/local/tmp/deck-scrcpy-server.jar`.
2. **Tunnel:** `adb -s <serial> forward tcp:0 localabstract:scrcpy_<id>`, with a random 31-bit `<id>`;
   adb picks a free port on 127.0.0.1. Removed again once both sockets are connected, as scrcpy does.
3. **Start:** `adb -s <serial> shell CLASSPATH=/data/local/tmp/deck-scrcpy-server.jar app_process /
   com.genymobile.scrcpy.Server 5.0.1 scid=<id> tunnel_forward=true audio=false video_codec=h264
   max_size=1600 max_fps=60 stay_awake=true clipboard_autosync=false`, at scrcpy's default bit rate
   (8 Mbit/s).
4. **Connect** twice, video then control. The video socket starts with a dummy byte (Deck retries
   until it comes), the device's name and the codec, then a size packet per capture session (a
   rotation starts one) and frames, each behind scrcpy's 12-byte header.
5. **Stop:** close the sockets and end the `adb shell` (and remove the forward if it's still there).

- **What it changes on the device**, only while shown:
  - the screen is turned on and stays on while the device is plugged in (`stay_awake`);
  - scrcpy puts the setting back when it stops, even when Deck quits or the cable is pulled: its
    cleanup runs as a separate process on the device.
- **Input:** scrcpy's control messages: touch (down, move, up), scroll, key codes (Back, Home, Recent
  apps, Power, typing keys), text, set clipboard with paste, and reset video for a new key frame.
- **The server file:**
  - downloaded from scrcpy's GitHub release at install and checked against its SHA-256 (v5.0.1:
    733,930 bytes, `764eb6f79811d5211fe9df341120882ba9994c7a61b897d7bf3fb662e53bc536`);
  - never committed; shipped in the app's resources with scrcpy's license;
  - the server must match the version Deck passes it, so the version is set in one place.

### Simulators

- **Video:** `sim-video stream --set <device set> --udid <udid> --scale <s> --key-frame-rate 2
  --transport annex-b -`, found beside `idb_companion`'s real path (`../libexec/sim-video`).
  - The scale keeps the long side within 1600 px (0.56 for the iPhone 18 Pro Max).
  - Deck keeps its stdin open; closing it stops the stream.
- **Input:** `idb_companion --udid <udid> --grpc-domain-sock <socket>`, the socket in Deck's own temp
  folder (only Franco's user can open it; no network port).
  - idb's gRPC `hid` (touches, the Home button, keys) and `describe` (the screen's size in points).
  - Deck carries idb's protocol file for 1.6.1 (MIT) and talks gRPC with `@grpc/grpc-js`.
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
  - The codec string comes from the stream's SPS.
  - `sim-video`'s Annex B stream is cut into frames; scrcpy's and the helper's arrive framed.
  - A size change reconfigures the decoder at the next key frame.
- **Drawing:** each new frame onto a `<canvas>` the size of the fitted screen at the window's pixel
  ratio.
- **Keeping up:** if the decoder falls more than 10 frames behind, the view skips to the next key
  frame and asks for one. That's scrcpy's reset video and the helper's request; `sim-video` sends one
  every 2 s.
- **Input:** a point on the canvas maps through the letterbox to the frame, then to the device:
  scrcpy takes frame pixels with the frame's size, idb takes points. Keys become Android key codes
  for scrcpy and USB HID usages for idb.

### Streaming and its cost

- **Only a panel on screen streams:** the active tab's, unfolded, with Deck's window visible (not
  minimized, hidden or fully covered, by the page's visibility), and the Mac neither locked nor
  asleep.
  - Deck in the background but visible, beside Xcode or Android Studio, keeps streaming: that's the
    point.
- **10 seconds' grace:** a stream no panel shows stops after 10 s, so leaving a tab and coming back
  doesn't restart it (a restart takes about a second). Tabs showing the same device share its stream.
- **Size and rate:** the long side within 1600 px (the C66 as it is, the S25 FE at about 740×1600), up to
  60 frames a second, no audio. A still screen costs little: scrcpy repeats a frame every 100 ms,
  and `sim-video` sends none.
- **Measured in step 1:** Deck's CPU with a stream showing, written into CLAUDE.md.

### Screenshot to Claude

- The view keeps the last decoded frame. The camera button draws it at full size into a PNG and sends
  it to main.
- Main saves it as the clipboard card saves a pasted image: in its image folder
  (`<temp>/Deck clipboard/<instance>/`, cleared at start and quit), named by its content, and returns
  the quoted path. The renderer types it into the tab's terminal through `pasteSafe()`, as Add to
  Claude does.

### Code

- `src/shared/`: `DeviceKind`, `DeviceInfo` (id, kind, name, detail, state, what's missing), a
  project's kinds and pick, a stream's events (size, frame, state) and input (touch, scroll, key,
  text, button, paste); `DeckApi.devices` and the `devices:*` channels.
- `src/main/devices/`:
  - `project.ts`: the kinds of device a project takes (tested on temp folders);
  - `picks.ts`: `devices.json`, written beside and renamed (`fs/atomic.ts`);
  - `registry.ts`: one list from every source; starts and stops sources as tabs need them;
  - `stream.ts`: a stream's viewers, its 10 s grace and its retries, for every kind;
  - `android/adb.ts`: finding adb and running it, like `git/runner.ts`;
  - `android/devices.ts`: `track-devices -l` and identity parsing, USB and Wi-Fi merged (pure);
  - `android/scrcpy.ts`: push, tunnel, start, sockets and stop;
  - `android/protocol.ts`: the video stream's parser and the control messages (pure);
  - `ios/simulators.ts`, `ios/simvideo.ts`, `ios/idb.ts` (gRPC) and `ios/iphone.ts` (the helper);
  - `ipc.ts`: wiring, the window's visibility, lock and sleep. Every listener checks its arguments.
- `src/renderer/src/device/`:
  - `pick.ts`: which device a tab shows (pure);
  - `DevicePanel.tsx`: header, menu, chooser and states, inside an error boundary;
  - `DeviceScreen.tsx`: canvas, decoder and input;
  - `decoder.ts`: cutting Annex B and the codec string (pure);
  - `input.ts`: pointer to device coordinates, keys to Android key codes and HID usages (pure);
  - `useDevices.ts` and `device.css`.
- `App.tsx`:
  - the right pane holds the device panel, a horizontal splitter and the Claude panel;
  - `TerminalTab.device` (the tab's pick) and `deviceHidden`;
  - the fold and the height share, one each for the window.
- `menu.ts` and `terminal/keys.ts`: View → Device Panel.
- `native/iphone-screen/` with `scripts/build-iphone-helper.mjs`; `scripts/fetch-scrcpy-server.mjs`,
  run by `postinstall`.
- **Packaging:**
  - `electron-builder.yml`: `extraResources` for the server and, on macOS, the helper;
    `NSCameraUsageDescription`;
  - the camera entitlement in `build/entitlements.mac.plist`;
  - scrcpy's license (Apache 2.0) and idb's (MIT) in a third-party notices file shipped with the
    app.
- **Docs:** CLAUDE.md (paths and the facts above), README, DECK.md (M5), TESTING.md and CHANGELOG.

## Build order

1. **The panel and Android**, macOS and Windows: finding devices, the project rules and picks, the
   panel, scrcpy video and input, and the screenshot. This covers Guard and AccessControl_Android.
2. **Simulators**, macOS: idb-companion's video and input.
3. **iPhones**, macOS: the helper, once it has been seen working with Franco's iPhone.

Each step gets its own plan and pull request and works without the next.

## Known limits

- **Black screens:** Android hides secure windows (`FLAG_SECURE`: some banking, payment and DRM
  screens) from screen capture, so they show black.
- **Typing:** on Android, characters the device's key map can't make are skipped; simulators get what
  a US keyboard types.
- **One finger:** no pinch or two-finger gestures, and no scroll wheel on simulators.
- **One adb:** if a different adb version runs the server, Deck's starts it again, as any adb does.
  Wi-Fi debugging works once the device has been paired elsewhere (Android Studio, `adb pair`); Deck
  doesn't pair.
- **Emulators** may encode in software, so their stream may be slower: measured in step 1.
- **A lit screen:** a device shown for hours stays on while plugged in, and a still image can mark an
  OLED screen. Fold the panel, or press Power, when not watching.
- **iPhones** need a cable, an unlocked phone and trust in this Mac, and are view only.
- **iOS needs a Mac:** Windows shows Android devices only.
- **A Mac-only Xcode project** counts as an iOS app, so a booted simulator shows there too.
- **Client data:** device screens can show residents' and visitors' details. Frames are kept in memory
  only; a screenshot is saved only when asked, in Deck's temp image folder (cleared at start and quit),
  and Deck sends it nowhere.

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
  - picks: the tab's, the project's, the only device that fits, several, none, asked for by hand, the
    picked device coming back, and the 10 s of "disconnected";
  - scrcpy's video stream parsed from chunks split anywhere (dummy byte, name, codec, sessions, config
    and media packets), and control messages byte for byte against scrcpy's own
    `test_control_msg_serialize.c`;
  - a stream's life: viewers, the 10 s grace, retries at 1, 2 and 5 s, lock and sleep;
  - cutting Annex B and the codec string; pointer mapping through the letterbox and after a rotation;
    keys;
  - `idb_companion --notify` output and the helper's frames;
  - main's wiring, including arguments checked.
- **In the app** (a dev build with its own userData, Franco's devices):
  - Guard's tab shows the C66; AccessControl_Android asks, then remembers; two tabs, two devices;
  - taps, swipes, typing, paste, Back, Home, Recent apps, Power, rotation and the wheel;
  - the S25 FE's cable pulled: it carries on over Wi-Fi; the C66's: "disconnected", then no panel;
  - tab switches within 10 s don't restart the stream; minimizing stops it; after Deck quits,
    `settings get global stay_on_while_plugged_in` is as before and the server's file is gone;
  - the screenshot reaches Claude as `[Image #N]`;
  - Deck's CPU with a stream showing.
- **Simulators:** the booted simulator without the Simulator app: video, taps, typing, Home. Then with
  idb-companion out of reach: the install hint.
- **iPhone:** the Camera prompt, the stream, unplugging and locking.
- **Windows:** the Android steps, in `docs/TESTING.md`.
