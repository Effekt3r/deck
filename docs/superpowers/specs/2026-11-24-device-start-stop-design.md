# Starting and stopping emulators and simulators: design

2026-11-24. Franco asked, after the tab changes (`2026-11-24-tab-status-design.md`): "Also ability to
start or stop an emulator / simulator would be greatly appreciated". The device panel's spec had
ruled this out ("Deck never boots or shuts down simulators"; "Not in this design: Starting or
stopping emulators and simulators"). This spec replaces those two lines. The choices below were made
without a round of questions; review them here.

Built on `m5-device-iphones` (device panel step 3), which rewrites the same files: the simulator
tracker, `devices/ipc.ts`, the shared types and the panel.

## Goal

From the device panel, start an Android emulator or an iOS simulator that isn't running, and stop
one that is, without opening Android Studio or Xcode.

## What can be started

- **Android emulators:**
  - **Which:** the AVDs that `emulator -list-avds` prints (Android Studio's Device Manager makes them).
  - **Where `emulator` is:** in the SDK, at `emulator/emulator` (`emulator.exe` on Windows). The SDK
    is found the way adb's is: `ANDROID_HOME`, `ANDROID_SDK_ROOT`, then the usual folder. An adb
    found only on PATH or through Homebrew isn't inside an SDK, so then no emulators are offered.
  - **On this Mac** (2026-11-24): emulator 37.2.12, system images for API 34 to 36, and no AVDs
    (`~/.android/avd` is empty). The menu says so (below).
- **iOS simulators** (macOS):
  - **Which:** the shut-down simulators in Xcode's default set (or `DECK_SIMULATOR_SET`).
    idb-companion's notifier already reports every simulator with its state; the panel only ever
    showed the booted ones.
  - **When:** only with a current idb-companion, which Deck needs to show simulators at all.
    Without it, the panel keeps its install hint.
  - **On this Mac:** 14 simulators (iOS 27.0: 7, iOS 18.5: 6, iOS 27.1: 1), 2 of them booted.

## Starting and stopping

- **An emulator starts** as `emulator -avd <name>`:
  - **Detached:** it keeps running when Deck quits, as Android Studio's emulators do.
  - **Its own window:** the emulator's default. The panel shows its screen as soon as adb lists it.
  - **Its id:** `emulator:<AVD name>`, the id it gets once it answers. So the pick made when it
    starts matches it when it appears.
- **A simulator boots** with `idb_companion --boot <UDID>`, plus `--device-set-path` with
  `DECK_SIMULATOR_SET`:
  - **Why idb:** it's the companion Deck already uses for simulators, and it boots through
    CoreSimulator. That avoids `xcrun simctl`, whose wrapper can run Xcode's first-launch step (the
    reason the panel's background checks avoid it).
  - **Lifetime:** without `--headless`, the simulator stays booted after the command ends.
  - **To check while planning,** with a throwaway simulator in a private set: whether it also opens
    Simulator.app's window. Either is fine: with a window, it's what starting one from Xcode does;
    without, the panel shows it and Simulator.app shows it when opened.
- **Stopping:**
  - **An emulator:** `adb -s <serial> emu kill`;
  - **A simulator:** `idb_companion --shutdown <UDID>`;
  - **Phones and iPhones** have no Stop.

## What the user sees

- **The ▾ menu:**
  - **Start:** below the devices, a "Start" heading lists what can be started:
    `▶ Pixel 8 API 35` with `Emulator`, and `▶ iPhone 17 Pro` with `Simulator · iOS 27.0`. Names are
    shown as the running devices' are (an AVD's `_` become spaces). The ones that fit the project
    come first, as with the devices above: simulators for an iOS app, emulators for an Android app.
  - **Choosing one** starts it and picks it for the tab and the project, as choosing a connected
    device does. Its row says `starting…` until it appears among the devices, where it then stays as
    an ordinary device, gone from Start.
  - **Nothing to start:** "No emulators: make one in Android Studio's Device Manager" when the SDK
    has none (shown only where emulators fit: an Android app's project, or the panel shown by hand).
  - **Stop:** the menu ends with "Stop iPhone 17 Pro" when the device on screen is an emulator or a
    simulator. There's no confirmation: starting it again is one click away.
- **While it starts:** in place of the screen, the panel shows "Starting iPhone 17 Pro…" with the
  busy spinner. The stream starts when the device is ready, as for any device. An emulator's cold
  boot can take over a minute.
- **If it fails:**
  - **The command fails:** "Couldn't start iPhone 17 Pro", with the tool's own last line.
  - **It doesn't appear within 3 minutes:** "iPhone 17 Pro didn't start within 3 minutes".
  - Both offer Try again.
- **After a stop:** the panel goes through its usual 10 s "disconnected" hold, then shows whatever
  the project's rules say (e.g. "No devices connected", with Start buttons).
- **The empty panel:**
  - **Buttons:** "No devices connected" gets Start buttons for up to 3 devices that fit the project
    ("Start Pixel 8 API 35"), and "More in the ▾ menu" when there are more.
  - **Its text:** with buttons, "start an emulator, or boot a simulator" becomes "or start one
    below"; with nothing to start, it stays as it is.

## How

- **`src/main/devices/android/emulators.ts`:**
  - `sdkRoots(env, platform, home)`: the SDK folders `adbCandidates` builds inline today, moved out
    so both use them;
  - `findEmulator(...)`: the first `<sdk>/emulator/emulator` that can be run;
  - `listAvds(emulator)`: runs `-list-avds` (10 s timeout) and keeps lines that are AVD names
    (letters, digits, `.`, `_`, `-`);
  - `startAvd(emulator, name)`: the detached start;
  - `killEmulator(adb, serial)`: `emu kill` through `runAdb`.
- **`src/main/devices/ios/boot.ts`:** `bootSimulator(idb, udid, set?)` and
  `shutdownSimulator(idb, udid, set?)`. They run `idb_companion` with a 120 s timeout and an abort
  signal, and turn a failure into its last line (`ios/process.ts`'s `lastLine`).
- **`SimulatorTracker`:** `shutDown()` gives the simulators it knows that aren't booted.
- **`ipc.ts`:**
  - `devices:start(id)` and `devices:stop(id)`, both invoked, answering null or `{ error }`;
  - **the list:** `DeviceList.startable` holds what can be started, and what is starting with its
    error, if any;
  - **AVDs** are read at each watch start, when Deck comes to the front (as adb is looked for
    again), and after a start or a stop;
  - **starting** is kept per id with a 3 minute deadline. It ends when the device appears among the
    devices (then dropped from `startable`), when the command fails, or at the deadline.
- **Types:** `StartableDevice { id, kind: 'emulator' | 'simulator', name, detail, starting?, error? }`
  and `DeckApi.devices.start` and `.stop`.
- **Renderer:**
  - `DeviceMenu`: the Start section, the Stop item, keyboard moves over both sections;
  - `DevicePanel`'s `Nothing`: the Start buttons;
  - `pick.ts`: a starting device is the tab's view ("Starting …") until it's listed.

## Known limits

- An emulator started from Deck keeps running after Deck quits.
- AVDs are read again only when Deck comes to the front. One made in Android Studio appears after
  switching back to Deck, which is the natural order anyway.
- idb's notifier doesn't announce simulators created or deleted while shut down (an existing limit).
  They show once the notifier restarts.
- Deck doesn't create AVDs or simulators.
- Windows: emulators only, untested.

## Not in this design

- Creating or deleting AVDs and simulators, cold boots, wiping data, and the emulator's window mode.
- Stopping phones.

## Testing

- **Unit tests:**
  - `emulators.test.ts`: `sdkRoots` order, `listAvds` parsing (blank lines, the emulator's own
    warnings on stdout, odd names), `findEmulator` with temp files;
  - `boot.test.ts`: the arguments (with and without a private set), a failure's last line, the abort;
  - the startable list: running ones left out, the project's kind first;
  - the starting state: appears (an ordinary device), fails (its error), times out, Try again;
  - `devices:start` and `devices:stop` through `registerDeviceIpc`, with shell-script fakes for
    `emulator`, `adb` and `idb_companion` (as the IPC tests already fake adb and idb), skipped on
    Windows.
- **In the app:**
  - only a throwaway simulator in a private set (`DECK_SIMULATOR_SET`, `DECK_IDB_COMPANION`), never
    Franco's own (CLAUDE.md): start it from the menu, see it stream, stop it;
  - an emulator only with a throwaway AVD Franco agrees to (he has none now), or not at all.

## Decided while planning (2026-11-25)

Measured on Franco's Mac with a throwaway simulator in a private device set (idb-companion 1.6.1,
iOS 27.0; his own simulators untouched), and the SDK's emulator 37.2.12 (no AVD made or started):

- **`idb_companion --boot`** doesn't open Simulator.app: it wasn't running, and the boot didn't start
  it (a private set's simulators never show there anyway). The simulator stays booted after the
  command ends. A first boot took 21 s (data migration), later ones 3 s; booting one already booted
  exits 0 in 0.9 s. It prints one JSON line on stdout and exits 0.
- **`--shutdown`** exits 0 in 3.5–6 s; one already shut down exits 0 too.
- **A failure** (an unknown UDID) exits 1, its last stderr line
  `<timestamp> <udid> could not be resolved to any target in [FBSimulatorControl.SimulatorSet]`. The
  reason shown drops the timestamp. Deck passes `--log-level info`, as it does for the notifier.
- **A SIGTERM mid-boot** ends idb_companion with exit code 0 within 0.1 s, and the simulator boots
  anyway: an abort is known by its signal, not its exit code.
- **The notifier** lists a shut-down simulator with `"state":"Shutdown"` and the fields Deck reads.
  During a first boot it said `Booting`, then `Booted` 0.07 s later, while idb's boot went on for 19 s
  more.
- **`emulator -list-avds`** with no AVDs exits 0 in 0.2 s, printing nothing; `-help` lists
  `-list-avds` and `-avd <name>`.

Decided (the planner makes the design calls; Franco reviews them here):

- **`booting`:** a device's state gains `booting`. A simulator Deck boots is listed as booting until
  idb's boot command ends, since the notifier says Booted 19 s too early to stream it. So is an
  Android device that answered before Android had started (`sys.boot_completed` not 1): adb lists an
  emulator during its cold boot (and a phone while it reboots) long before scrcpy's server can run,
  and a stream started then fails into "Couldn't show …". The panel says "Starting <name>…" with the
  spinner, so the text runs on from the click to the screen. A device still saying it's starting
  after the tracker's 40 asks (about 2 minutes) is taken as started.
- **The panel stays for a device that can be started:** with the tab's pick (else the project's
  latest) an emulator or simulator that isn't running, and this tab has shown, picked or stopped it
  this session, the panel stays open: its title is "<name> isn't running" once other devices are
  connected, else "No devices connected", with that device's Start button first. The existing rules
  would otherwise hide it (nothing connected, not shown by hand), so a Stop would take the panel away
  10 s later; this is what "After a stop" above describes. A fresh tab whose project's latest pick is
  already stopped stays closed instead (View → Device Panel still offers its Start button); an
  unplugged phone still closes the panel. See "Decided while building" below: this needed more than
  the planning-stage rule.
- **Failures** read "Couldn't start <name>" with the reason under it: the tool's last line, or "It
  didn't start within 3 minutes."; Try again. A failed start's menu row says `didn't start`, and the
  failure stays until it's started again or no tab watches devices. A start main refuses (no longer
  offered) and a stop that fails show "Couldn't start/stop <name>: <why>" under the panel's header.
- **"No emulators: …"** comes from a `noAvds` flag in the list (the SDK's emulator is there and lists
  no AVDs), shown in the menu's Start section and the empty panel, where emulators fit.
- **AVDs are read again** after an emulator's start or stop; a simulator's doesn't change them.
- **Already running** (started some other way meanwhile): a start answers null and the pick shows it.
  A second click while it starts changes nothing.
- **When no tab watches devices**, the starts are forgotten; one under way carries on by itself, and
  the next watch lists the device once it's up.
- **`sdkRoots`** lives in `android/adb.ts`, beside the `adbCandidates` it came out of: `emulators.ts`
  uses `runAdb`, so the other way round would be an import cycle.
- **Windows:** `startAvd` passes no `windowsHide` after all: `detached: true` already starts a process
  with no console window of its own (Microsoft documents `CREATE_NO_WINDOW` as ignored for a detached
  process), and `windowsHide`'s `SW_HIDE` could instead hide the emulator's own window. The Windows
  check looks for a console window beside the emulator, or its window not showing.
- **Not checked:** an emulator started from Deck (no AVD here), and whether macOS asks Deck for an
  emulator's microphone use. Deck's Info.plist has no `NSMicrophoneUsageDescription`, and macOS ends
  a process that asks for the microphone when the app responsible for it has none.

## Decided while building (2026-11-26)

Found while building and reviewing the panel's rules, past what planning had worked out:

- **Shown by hand still holds the Start view.** A stopped emulator or simulator that's the tab's pick
  (else the project's latest) keeps the panel on its Start view even when the panel is asked for by
  hand, rather than falling back to whichever phone is plugged in — why: View → Device Panel shouldn't
  abandon the device you just stopped for whatever else happens to be connected.
- **The empty title names the device, or doesn't, by whether anything's connected.** "<name> isn't
  running" once other devices are connected, else "No devices connected" (including with nothing
  connected at all) — why: so the panel never claims none are connected while some are, but also never
  names a device as "not running" into a title that otherwise means nothing is there.
- **A start's failure shows only for the tab's own device in force**, never a failure left over
  elsewhere in the project's picks — why: an old failure in another tab or project shouldn't resurface
  somewhere it wasn't asked for.
- **The panel stays open for a stopped device only in a tab that has shown, picked or stopped it this
  session**, not in every fresh tab of the project — why: a tab that never touched the device has no
  reason to claim the panel for it; View → Device Panel still offers its Start button there. Picking a
  device in a tab, or stopping one there, counts as having shown it too (not only actually streaming
  it live), so a device started and immediately stopped still keeps its tab's panel open.
- **Stop sets only the tab's own pick, not the project's**, which stays whatever it was — why: so the
  panel keeps its Start button even for a device that was only ever shown without a pick, without
  moving the project's own remembered device out from under other tabs.
  - Consequence: because `tab ?? project[0]` is the same stopped device for every tab of the project
    until some tab picks another, a phone connecting afterwards doesn't take the Start view away from
    *any* tab, the one that stopped it included — `shownHere` only ever decides whether a tab shows
    the panel by itself, never which device it would show. A fresh tab stays closed rather than
    popping its Start view open uninvited; View → Device Panel there opens to the same Start view, not
    to the phone.
- **Microphone, corrected:** Electron's default Info.plist already carries `NSMicrophoneUsageDescription`
  ("This app needs access to the microphone"), and the installed Deck has it (`extendInfo` only
  overrides the camera's string); Deck's entitlements have no `com.apple.security.device.audio-input`.
  The emulator binaries (`emulator`, `qemu-system-aarch64`) themselves carry microphone entitlements
  (checked against the SDK's own binaries), and an emulator started from Deck counts as Deck's for
  macOS privacy, so if it asks for the microphone the likely outcome is a prompt in Deck's name with
  Electron's generic text, or a silent denial under the hardened runtime (no entitlement to grant).
  Franco chose to leave it as is; the live check with a throwaway AVD is only to confirm, not to
  decide.
