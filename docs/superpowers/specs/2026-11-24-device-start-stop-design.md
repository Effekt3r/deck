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
