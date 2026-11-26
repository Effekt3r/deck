# Starting and stopping emulators and simulators: implementation plan

> **For agentic workers:** REQUIRED SUB-SKILL: Use superpowers:subagent-driven-development (recommended) or superpowers:executing-plans to implement this plan task-by-task. Steps use checkbox (`- [ ]`) syntax for tracking.

**Goal:** From the device panel, start an Android emulator (an AVD) or boot an iOS simulator that
isn't running, and stop one that is, without opening Android Studio or Xcode.

**Architecture:** Main reads the AVDs from the SDK's `emulator -list-avds` and takes the shut-down
simulators from idb's notifier, and adds them to the device list as `startable`, with what's starting
or failed to (`starts.ts`, 3 minutes at most). `devices:start` runs `emulator -avd <name>` detached,
or `idb_companion --boot <udid>`; `devices:stop` runs `adb -s <serial> emu kill` or
`idb_companion --shutdown <udid>`. A device that's listed but still starting up (an emulator's cold
boot, a simulator Deck is booting) has the new state `booting`, so its screen isn't streamed before
it can be. The renderer shows a started device as the tab's view until it's listed, puts Start and
Stop in the ▾ menu, and Start buttons in an empty panel. Spec:
`docs/superpowers/specs/2026-11-24-device-start-stop-design.md` (approved by Franco: "Build both as
written"), with its "Decided while planning" section.

**Tech Stack:** Electron 45 (main, preload, renderer), Node 22 / Electron's Node 24 (`child_process`),
React 19, TypeScript, vitest (node environment). No new dependency.

---

## Checked while planning (2026-11-25)

On Franco's Mac, with a throwaway "Deck Probe" iPhone 17 (iOS 27.0) in a private device set under the
session's scratchpad, deleted afterwards (Franco's own simulators untouched; Simulator.app was not
running before and wasn't started), idb-companion 1.6.1 from Homebrew, and the SDK's emulator 37.2.12:

- **`idb_companion --boot <UDID> --device-set-path <set>`** exited 0 after 21.4 s (a first boot: data
  migration), printing one line on stdout,
  `{"type":"Simulator","name":"Deck Probe","os_version":"iOS 27.0","model":"iPhone 17","udid":"…","state":"Booted"}`,
  and 31 timestamped lines on stderr ending "Boot Status Changed: Finished | Elapsed 20.0". It did
  **not** open Simulator.app (no `Simulator` process before, during or after; a private set's
  simulators never show there anyway). The simulator **stayed booted** after the command ended
  (checked 10 s later: `Booted`, a third `launchd_sim`). Later boots took 3.1 s; booting one already
  booted exited 0 in 0.9 s.
- **`--shutdown <UDID>`** exited 0 in 3.5–5.9 s with nothing on stdout; shutting down one already shut
  down exited 0 ("succeeded as it is already shutdown").
- **A failure:** `--boot 00000000-… --log-level info` exited 1; its last stderr line was
  `2026-11-25 15:22:03.218+0200 00000000-0000-0000-0000-000000000000 could not be resolved to any target in [FBSimulatorControl.SimulatorSet]`.
  Every line starts with that timestamp, so the reason Deck shows drops it.
- **A SIGTERM mid-boot** (1 s in) ended `idb_companion --boot` within 0.1 s **with exit code 0**,
  nothing on stdout, and the simulator went on to `Booted`. So an abort is told apart by its signal,
  never by the exit code.
- **The notifier** (`--notify stdout --only simulator --log-level info --device-set-path <set>`) listed
  the shut-down simulator as
  `[{"udid":"…","state":"Shutdown","type":"Simulator","name":"Deck Probe","model":"iPhone 17","os_version":"iOS 27.0"}]`,
  the same fields `readNotifyLine` reads. During a shutdown it printed `Shutting Down`, then `Shutdown`.
  During a first boot of a fresh simulator it printed `Booting` at 15:36:53.842 and **`Booted` at
  15:36:53.912**, while idb's boot reported "Finished" only at 15:37:12.721: **19 s after the notifier
  said Booted**. Hence the `booting` state for a simulator Deck boots (Task 8).
- **`~/Library/Android/sdk/emulator/emulator -list-avds`** (no AVDs on this Mac) exited 0 in 0.19 s
  with empty stdout and stderr; `-help` lists `-list-avds` ("list available AVDs") and
  `-avd <name>`. No AVD was made or started.

## Decided while planning

Written into the spec's "Decided while planning" section (UI calls are delegated to the planner):

1. **`booting`:** `DeviceInfo.state` gains `'booting'`: an Android device that answered before Android
   had started (`sys.boot_completed` not 1: an emulator's cold boot, a phone rebooting), and a
   simulator whose boot Deck started, until idb's boot command ends. The panel says
   "Starting <name>…" with the spinner instead of streaming. A device still saying it's starting after
   the tracker's 40 asks is taken as started.
2. **The panel stays for the tab's device when it can be started:** with the tab's pick (else the
   project's latest) an emulator or simulator that isn't running, the panel stays open, "No devices
   connected" with its Start button first. Without this the panel would go 10 s after a Stop
   (nothing connected, not shown by hand), unlike the spec's "After a stop".
3. **Errors:** both failures read "Couldn't start <name>" with the reason under it (the tool's last
   line, or "It didn't start within 3 minutes."), and Try again. A failed start's menu row says
   `didn't start`. A start main refuses and a stop that fails show "Couldn't start/stop <name>: <why>"
   under the panel's header.
4. **`noAvds`:** the list says when the SDK's emulator is there and lists no AVDs; the menu's Start
   section and the empty panel then say "No emulators: make one in Android Studio's Device Manager"
   where emulators fit.
5. **AVDs are read again** after an emulator's start or stop, not a simulator's.
6. **`sdkRoots`** lives in `android/adb.ts`, which it comes out of: `emulators.ts` imports `runAdb`
   from there, so the other way round would be an import cycle.
7. **Starts are forgotten** when no tab watches devices any more; a start under way carries on by
   itself, and the next watch lists the device once it's up.

## Before you start

- **Worktree:** `~/.config/superpowers/worktrees/deck/m5-device-start-stop`, branch
  `m5-device-start-stop`, stacked on `m5-device-iphones` (device panel step 3, PR #22). Run every
  command from there; paths below are relative to it.
- **Node:** `export PATH="$HOME/.nvm/versions/node/v22.19.0/bin:$PATH"` in every shell.
- **Dependencies:** if `node_modules` is missing, `npm install --no-audit --no-fund`, then
  `cp ~/Development/deck/resources/scrcpy-server resources/scrcpy-server` if its
  download failed, and `git checkout -- package-lock.json` (npm install touches it). Postinstall also
  builds the iPhone helper (needs Xcode; fine on this Mac).
- **Baseline:** `npx vitest run src/main/devices src/renderer/src/device` and `npm run typecheck` pass
  before Task 1 (29 files, 402 tests on 2026-11-25).
- **Commits:** `git add <the task's files>` then
  `git -c user.email=franco@effektstudios.com commit -m "<message>"`. Never add `Co-Authored-By` or any
  other attribution line. Never push.
- **Code style:** comments say why, in the repo's plain style; tests sit beside their source as
  `*.test.ts`; device ids and UDIDs in tests are made up. Tests that need POSIX shell stand-ins are
  `describe.skipIf(process.platform === 'win32')` (or `it.skipIf`), with temp folders made in
  `beforeAll`, never in a describe body (a skipped describe's body still runs for collection on
  Windows).
- **Checks on real devices:** never boot, shut down or type into Franco's own simulators, and never
  start, make or delete an AVD (he has none; an emulator check needs a throwaway AVD he agrees to).
  Simulator checks use a throwaway simulator in a private set: `xcrun simctl --set <dir> create …`,
  then `DECK_SIMULATOR_SET=<dir>` for the dev build. `DECK_IDB_COMPANION` replaces where
  `idb_companion` is looked for (`/nowhere` hides it).
- **The `ios/` tests** also run on Electron's own Node (main's): after Task 3, run
  `ELECTRON_RUN_AS_NODE=1 ./node_modules/.bin/electron ./node_modules/vitest/vitest.mjs run src/main/devices/ios`.

## File structure

| File | | Responsibility |
|---|---|---|
| `src/shared/types.ts` | modify | `StartableDevice`, `DeviceActionResult`, `DeviceInfo.state` `'booting'`, `DeviceList.startable` and `.noAvds`, `DeckApi.devices.start` / `.stop` |
| `src/shared/channels.ts` | modify | `devices:start`, `devices:stop` |
| `src/preload/index.ts` | modify | `window.deck.devices.start` / `.stop` |
| `src/main/devices/android/adb.ts` | modify | `sdkRoots`: the SDK folders, for adb and the emulator |
| `src/main/devices/android/emulators.ts` | create | the SDK's emulator: finding it, its AVDs, starting one detached, `emu kill` |
| `src/main/devices/android/devices.ts` | modify | `booting` for a device that answered before Android had started |
| `src/main/devices/android/tracker.ts` | modify | a device still starting after 40 answers is published as started |
| `src/main/devices/ios/boot.ts` | create | `idb_companion --boot` / `--shutdown`, 120 s, abortable, the failure's line |
| `src/main/devices/ios/simulators.ts` | modify | `startableSimulators`, `SimulatorTracker.shutDown()` |
| `src/main/devices/starts.ts` | create | the starts under way (3 minutes), merged into what can be started |
| `src/main/devices/registry.ts` | modify | `combineLists` returns `FoundDevices` (the list without what can be started) |
| `src/main/devices/ipc.ts` | modify | AVD reads, `startable` and `noAvds`, `devices:start` and `devices:stop`, simulators Deck is booting |
| `src/renderer/src/device/pick.ts` | modify | a started device as the tab's view, `menuOrder` for startables, `startButtons`, `startPick` |
| `src/renderer/src/device/menu.ts` | create | the ▾ menu's items (devices, Start, Stop) and a Start item's hint |
| `src/renderer/src/device/DeviceMenu.tsx` | modify | the Start section, Stop, the keyboard over all of it |
| `src/renderer/src/device/DevicePanel.tsx` | modify | the starting view, start and stop and their errors, the booting message, Start buttons |
| `src/renderer/src/device/DeviceScreen.tsx` | modify | the spinner beside a waiting message |
| `src/renderer/src/device/device.css` | modify | the Start buttons |
| `src/renderer/src/App.tsx` | modify | `startable`, `noAvds` and the tab's pick into the panel; `startPick` keeps it shown |
| tests | create / modify | `android/adb.test.ts`, `android/emulators.test.ts`, `ios/boot.test.ts`, `ios/simulators.test.ts`, `android/devices.test.ts`, `android/tracker.test.ts`, `starts.test.ts`, `ipc.start.test.ts`; list literals in `ipc.test.ts`, `ipc.watch.test.ts`, `ipc.ios.test.ts`; `device/pick.test.ts`, `device/menu.test.ts` |
| `CLAUDE.md`, `README.md`, `docs/TESTING.md`, `docs/superpowers/specs/2026-11-03-device-panel-design.md` | modify | what's built, how to test it, the two lines that ruled it out |

---

### Task 1: The SDK's folders on their own

`adbCandidates` builds the SDK folders inline; the emulator needs the same ones.

**Files:**
- Modify: `src/main/devices/android/adb.ts` (`adbCandidates`, lines 13–36)
- Test: `src/main/devices/android/adb.test.ts`

- [ ] **Step 1: Write the failing test**

In `src/main/devices/android/adb.test.ts`, change the import and add a `describe` right after the
`afterAll` line:

```ts
import { AdbError, adbCandidates, findAdb, runAdb, sdkRoots } from './adb'

const root = mkdtempSync(join(tmpdir(), 'deck-adb-'))
afterAll(() => rmSync(root, { recursive: true, force: true }))

describe('sdkRoots', () => {
  it('ANDROID_HOME, ANDROID_SDK_ROOT, then the usual place for each system', () => {
    expect(sdkRoots({ ANDROID_HOME: '/sdk1', ANDROID_SDK_ROOT: '/sdk2' }, 'darwin', '/Users/f')).toEqual(['/sdk1', '/sdk2', '/Users/f/Library/Android/sdk'])
    expect(sdkRoots({}, 'linux', '/home/f')).toEqual(['/home/f/Android/Sdk'])
    expect(sdkRoots({ LOCALAPPDATA: 'C:\\Users\\f\\AppData\\Local' }, 'win32', 'C:\\Users\\f')).toEqual(['C:\\Users\\f\\AppData\\Local\\Android\\Sdk'])
    expect(sdkRoots({}, 'win32', 'C:\\Users\\f')).toEqual(['C:\\Users\\f\\AppData\\Local\\Android\\Sdk'])
  })

  it('skips a relative or empty one, and lists each folder once', () => {
    expect(sdkRoots({ ANDROID_HOME: 'sdk', ANDROID_SDK_ROOT: '' }, 'darwin', '/Users/f')).toEqual(['/Users/f/Library/Android/sdk'])
    expect(sdkRoots({ ANDROID_HOME: '/Users/f/Library/Android/sdk' }, 'darwin', '/Users/f')).toEqual(['/Users/f/Library/Android/sdk'])
  })
})
```

- [ ] **Step 2: Run it and see it fail**

Run: `npx vitest run src/main/devices/android/adb.test.ts`
Expected: the two `sdkRoots` tests FAIL with `TypeError: sdkRoots is not a function`; the rest pass.

- [ ] **Step 3: Implement**

In `src/main/devices/android/adb.ts`, replace `adbCandidates` and its doc comment (from
`/** Where adb may be, in the order Deck tries them:` to the function's closing `}`) with:

```ts
/** The Android SDK's folders, in the order Deck tries them: ANDROID_HOME and ANDROID_SDK_ROOT (Deck's
 *  own environment — on Windows this must be the live process.env, since its names are
 *  case-insensitive there and a copy holds `Path`, not `PATH`; one set only in shell profiles isn't
 *  seen when Deck starts from Finder), then the SDK's usual place. Only absolute ones, each once.
 *  adb's and the emulator's candidates both start here. */
export function sdkRoots(env: NodeJS.ProcessEnv, platform: NodeJS.Platform, home: string): string[] {
  const path = platform === 'win32' ? win32 : posix
  const roots = [env.ANDROID_HOME, env.ANDROID_SDK_ROOT]
  if (platform === 'darwin') roots.push(path.join(home, 'Library', 'Android', 'sdk'))
  else if (platform === 'win32') roots.push(path.join(env.LOCALAPPDATA || path.join(home, 'AppData', 'Local'), 'Android', 'Sdk'))
  else roots.push(path.join(home, 'Android', 'Sdk'))
  return [...new Set(roots.filter((dir): dir is string => typeof dir === 'string' && path.isAbsolute(dir)))]
}

/** Where adb may be, in the order Deck tries them: the SDKs' (sdkRoots), then PATH and Homebrew's
 *  folders. The SDK's adb comes before the others because Android Studio runs it, and two adb
 *  versions restart each other's server. Only absolute paths are tried: a relative PATH entry means
 *  "run what's in the current folder", not Deck's. */
export function adbCandidates(env: NodeJS.ProcessEnv, platform: NodeJS.Platform, home: string): string[] {
  const path = platform === 'win32' ? win32 : posix
  const exe = platform === 'win32' ? 'adb.exe' : 'adb'
  // Windows PATH entries are sometimes individually quoted ("C:\Program Files\...").
  const unquote = (dir: string): string => (platform === 'win32' && dir.startsWith('"') && dir.endsWith('"') ? dir.slice(1, -1) : dir)
  const dirs = (env.PATH ?? '').split(path.delimiter).map(unquote)
  if (platform === 'darwin') dirs.push('/opt/homebrew/bin', '/usr/local/bin')
  const files = [
    ...sdkRoots(env, platform, home).map((dir) => path.join(dir, 'platform-tools', exe)),
    ...dirs.filter((dir) => dir !== '' && path.isAbsolute(dir)).map((dir) => path.join(dir, exe)),
  ]
  return [...new Set(files)]
}
```

- [ ] **Step 4: Run it and see it pass**

Run: `npx vitest run src/main/devices/android/adb.test.ts`
Expected: PASS, the old `adbCandidates` tests included (the order they check hasn't changed).

- [ ] **Step 5: Commit**

```bash
git add src/main/devices/android/adb.ts src/main/devices/android/adb.test.ts
git -c user.email=franco@effektstudios.com commit -m "Emulators: the SDK's folders on their own, for adb and the emulator"
```

---

### Task 2: Finding and running the emulator

**Files:**
- Modify: `src/shared/types.ts` (after `DeviceInfo`)
- Create: `src/main/devices/android/emulators.ts`
- Test: `src/main/devices/android/emulators.test.ts`

- [ ] **Step 1: Write the failing test**

Create `src/main/devices/android/emulators.test.ts`:

```ts
import { chmodSync, mkdirSync, mkdtempSync, readFileSync, rmSync, writeFileSync } from 'node:fs'
import { tmpdir } from 'node:os'
import { join } from 'node:path'
import { afterAll, describe, expect, it, vi } from 'vitest'
import { avdNames, emulatorCandidates, findEmulator, isAvdName, killEmulator, listAvds, startableEmulators, startAvd } from './emulators'

const root = mkdtempSync(join(tmpdir(), 'deck-emulators-'))
afterAll(() => rmSync(root, { recursive: true, force: true }))

/** A shell script standing in for a program, in its own folder under `root`: `body` runs with the
 *  arguments it was given, and `$DIR` is that folder. */
function script(name: string, file: string, body: string): string {
  const dir = join(root, name)
  mkdirSync(dir, { recursive: true })
  const path = join(dir, file)
  writeFileSync(path, `#!/bin/sh\nDIR='${dir}'\n${body}\n`)
  chmodSync(path, 0o755)
  return path
}
const argsOf = (name: string) => readFileSync(join(root, name, 'args'), 'utf8')

describe('avdNames', () => {
  it("keeps the AVDs' names, each once, and drops the emulator's own lines and blank ones", () => {
    const out = 'INFO    | Storing crashdata in: /tmp/android-f/emu-crash-37.2.12.db\n\nPixel_8_API_35\r\nMedium_Phone_API_36.1\nPixel_8_API_35\nWARNING | Something odd\n'
    expect(avdNames(out)).toEqual(['Pixel_8_API_35', 'Medium_Phone_API_36.1'])
    expect(avdNames('')).toEqual([])
  })

  it("refuses a name avdmanager wouldn't make, or one starting with a dash", () => {
    expect(['my avd', '-avd', 'a/b', 'x;y', '', 'a'.repeat(201)].filter(isAvdName)).toEqual([])
    expect(['Pixel_9', 'a.b-c_d', '_x'].every(isAvdName)).toBe(true)
  })
})

describe('emulatorCandidates and findEmulator', () => {
  it("is each SDK's emulator/emulator, emulator.exe on Windows", () => {
    expect(emulatorCandidates(['/sdk1', '/sdk2'], 'darwin')).toEqual(['/sdk1/emulator/emulator', '/sdk2/emulator/emulator'])
    expect(emulatorCandidates(['C:\\Sdk'], 'win32')).toEqual(['C:\\Sdk\\emulator\\emulator.exe'])
  })

  it.skipIf(process.platform === 'win32')('takes the first one that can be run', async () => {
    mkdirSync(join(root, 'sdk2', 'emulator'), { recursive: true })
    writeFileSync(join(root, 'sdk2', 'emulator', 'emulator'), '#!/bin/sh\n')
    chmodSync(join(root, 'sdk2', 'emulator', 'emulator'), 0o755)
    mkdirSync(join(root, 'sdk1', 'emulator'), { recursive: true })
    writeFileSync(join(root, 'sdk1', 'emulator', 'emulator'), '') // there, but can't be run
    expect(await findEmulator([join(root, 'sdk0'), join(root, 'sdk1'), join(root, 'sdk2')], process.platform)).toBe(join(root, 'sdk2', 'emulator', 'emulator'))
    expect(await findEmulator([join(root, 'sdk0')], process.platform)).toBeNull()
  })
})

describe('startableEmulators', () => {
  it('offers each AVD by name, with the id and the name it has once running', () => {
    expect(startableEmulators(['Pixel_9', 'Medium_Phone_API_36.1'])).toEqual([
      { id: 'emulator:Medium_Phone_API_36.1', kind: 'emulator', name: 'Medium Phone API 36.1', detail: 'Emulator' },
      { id: 'emulator:Pixel_9', kind: 'emulator', name: 'Pixel 9', detail: 'Emulator' },
    ])
  })
})

describe.skipIf(process.platform === 'win32')('running the emulator', () => {
  it('listAvds runs -list-avds and reads the names', async () => {
    const emulator = script('list', 'emulator', 'echo "$@" > "$DIR/args"\nprintf "INFO    | hello\\nPixel_9\\n"')
    expect(await listAvds(emulator)).toEqual(['Pixel_9'])
    expect(argsOf('list')).toBe('-list-avds\n')
  })

  it('listAvds rejects when the emulator fails, or takes too long', async () => {
    await expect(listAvds(script('list-fail', 'emulator', 'exit 3'))).rejects.toThrow()
    await expect(listAvds(script('list-slow', 'emulator', 'exec sleep 5'), 200)).rejects.toThrow()
  })

  it('startAvd starts the AVD, and hears when the emulator ends', async () => {
    const emulator = script('start', 'emulator', 'echo "$@" > "$DIR/args"\nexec sleep 0.3')
    const ended = vi.fn()
    await startAvd(emulator, 'Pixel_9', ended)
    expect(ended).not.toHaveBeenCalled() // it runs for 0.3 s
    await vi.waitFor(() => expect(ended).toHaveBeenCalledWith('The emulator stopped.'), { timeout: 3000 })
    expect(argsOf('start')).toBe('-avd Pixel_9\n')
  })

  it('startAvd says how an emulator that fails ended', async () => {
    const ended = vi.fn()
    await startAvd(script('start-fail', 'emulator', 'exit 1'), 'Pixel_9', ended)
    await vi.waitFor(() => expect(ended).toHaveBeenCalledWith('The emulator stopped (exit code 1).'), { timeout: 3000 })
  })

  it("startAvd rejects an emulator that can't be started, and a name that isn't an AVD's", async () => {
    await expect(startAvd(join(root, 'missing', 'emulator'), 'Pixel_9')).rejects.toThrow(/ENOENT/)
    await expect(startAvd('/bin/sh', '-help')).rejects.toThrow(`"-help" isn't an AVD's name.`)
  })

  it('killEmulator tells the emulator to close through adb', async () => {
    const adb = script('kill', 'adb', `echo "$@" > "$DIR/args"\necho 'OK: killing emulator, bye bye'`)
    await killEmulator(adb, 'emulator-5554')
    expect(argsOf('kill')).toBe('-s emulator-5554 emu kill\n')
  })

  it("killEmulator refuses an adb name that isn't an emulator's, and says adb's own error", async () => {
    await expect(killEmulator('/nowhere/adb', '8d2e61a')).rejects.toThrow("8d2e61a isn't an emulator.")
    const adb = script('kill-fail', 'adb', "echo 'error: could not connect to TCP port 5554: Connection refused' >&2\nexit 1")
    await expect(killEmulator(adb, 'emulator-5554')).rejects.toThrow('error: could not connect to TCP port 5554: Connection refused')
  })
})
```

- [ ] **Step 2: Run it and see it fail**

Run: `npx vitest run src/main/devices/android/emulators.test.ts`
Expected: FAIL with `Error: Cannot find module './emulators'`.

- [ ] **Step 3: The type for what can be started**

In `src/shared/types.ts`, right after the closing `}` of `interface DeviceInfo`, add:

```ts
/** An emulator or a simulator that isn't running, which the panel can start (an AVD the SDK's
 *  emulator lists, a shut-down simulator), or one started from the panel and not listed yet. */
export interface StartableDevice {
  /** The id it has once running: `emulator:<AVD name>` or `simulator:<UDID>`. */
  id: string
  kind: 'emulator' | 'simulator'
  /** As the running device's: an AVD's name with spaces for its `_`, a simulator's name. */
  name: string
  /** "Emulator", or "Simulator · iOS 27.0". */
  detail: string
  /** Started from the panel and not among the devices yet (3 minutes at most). */
  starting?: boolean
  /** Why its last start failed: the tool's last line, or that it didn't start in time. Cleared by
   *  the next start. */
  error?: string
}
```

- [ ] **Step 4: Implement**

Create `src/main/devices/android/emulators.ts`:

```ts
import { type ChildProcess, execFile, spawn } from 'node:child_process'
import { constants } from 'node:fs'
import { access } from 'node:fs/promises'
import { posix, win32 } from 'node:path'
import type { StartableDevice } from '@shared/types'
import { runAdb } from './adb'

/** An AVD's name as avdmanager allows it (letters, digits, `.`, `_`, `-`), not starting with a dash:
 *  it goes into the emulator's argv after `-avd`. Whatever else `-list-avds` prints (the emulator's
 *  own INFO and WARNING lines, blank lines) isn't one. */
const AVD_NAME = /^[A-Za-z0-9._][A-Za-z0-9._-]*$/

export const isAvdName = (name: string): boolean => name.length <= 200 && AVD_NAME.test(name)

/** The AVD names in `emulator -list-avds`'s output, each once, in its order. */
export function avdNames(stdout: string): string[] {
  return [...new Set(stdout.split(/\r?\n/).map((line) => line.trim()).filter(isAvdName))]
}

/** `<sdk>/emulator/emulator` (`emulator.exe` on Windows) in each SDK folder, in order. */
export function emulatorCandidates(sdks: readonly string[], platform: NodeJS.Platform): string[] {
  const path = platform === 'win32' ? win32 : posix
  const exe = platform === 'win32' ? 'emulator.exe' : 'emulator'
  return sdks.map((dir) => path.join(dir, 'emulator', exe))
}

/** The first SDK's emulator that is there and can be run, or null. Only an SDK has one: an adb found
 *  on PATH or through Homebrew comes without, and then there's nothing to start. (Not findAdb: the
 *  IPC tests replace that one.) */
export async function findEmulator(sdks: readonly string[], platform: NodeJS.Platform): Promise<string | null> {
  for (const file of emulatorCandidates(sdks, platform)) {
    if (await access(file, constants.X_OK).then(() => true, () => false)) return file
  }
  return null
}

/** The AVDs `emulator -list-avds` prints (Android Studio's Device Manager makes them). Rejects when
 *  it fails, or takes longer than `timeoutMs`. */
export function listAvds(emulator: string, timeoutMs = 10_000): Promise<string[]> {
  return new Promise((resolve, reject) => {
    const child = execFile(emulator, ['-list-avds'], { encoding: 'utf8', timeout: timeoutMs, maxBuffer: 1024 * 1024, windowsHide: true },
      (err, stdout) => (err ? reject(err) : resolve(avdNames(stdout))))
    // It reads nothing: EOF rather than a wait; one that exits first makes it an EPIPE.
    child.stdin?.on('error', () => {})
    child.stdin?.end()
  })
}

/** The AVDs as what the panel can start, by name. `emulator:<AVD name>` is the id a running emulator
 *  gets once it answers (ro.boot.qemu.avd_name), so a pick made at the start matches it; the name has
 *  spaces for `_`, as a running one's has. */
export function startableEmulators(avds: readonly string[]): StartableDevice[] {
  return avds
    .map((name): StartableDevice => ({ id: `emulator:${name}`, kind: 'emulator', name: name.replace(/_/g, ' '), detail: 'Emulator' }))
    .sort((a, b) => a.name.localeCompare(b.name) || a.id.localeCompare(b.id))
}

/** How a started emulator ended, in the panel's words. */
const endedAs = (code: number | null, signal: NodeJS.Signals | null): string =>
  signal ? `The emulator was stopped (${signal}).` : code ? `The emulator stopped (exit code ${code}).` : 'The emulator stopped.'

/** Starts AVD `name` in the emulator's own window, as Android Studio does: detached, so it keeps
 *  running when Deck quits, with nothing read from it. Resolves once it runs; rejects when it can't
 *  be started (ENOENT, EACCES). `ended` hears if it ends while Deck runs, and how, so a start that
 *  dies early (a broken AVD, a missing system image) needn't wait out its 3 minutes. */
export function startAvd(emulator: string, name: string, ended: (how: string) => void = () => {}): Promise<void> {
  if (!isAvdName(name)) return Promise.reject(new Error(`"${name}" isn't an AVD's name.`))
  return new Promise((resolve, reject) => {
    let child: ChildProcess
    try {
      // windowsHide keeps a console from opening on Windows. Unchecked there: if the emulator's own
      // window doesn't show (SW_HIDE reaching it), or a console window opens beside it, start here.
      child = spawn(emulator, ['-avd', name], { detached: true, stdio: 'ignore', windowsHide: true })
    } catch (err) {
      return reject(err instanceof Error ? err : new Error(String(err)))
    }
    child.once('error', reject)
    child.once('spawn', () => {
      // Deck's quit doesn't wait for it, and nothing of Deck's ends it.
      child.unref()
      resolve()
    })
    child.once('exit', (code, signal) => ended(endedAs(code, signal)))
  })
}

/** Tells emulator `serial` (adb's name for it, `emulator-5554`) to close, through its console:
 *  `adb -s <serial> emu kill`. Resolves once it was told; it closes a moment later. */
export async function killEmulator(adb: string, serial: string): Promise<void> {
  // Only an emulator's adb name reaches its console, and only such a name goes into the argv.
  if (!/^emulator-\d+$/.test(serial)) throw new Error(`${serial} isn't an emulator.`)
  await runAdb(adb, ['-s', serial, 'emu', 'kill'])
}
```

- [ ] **Step 5: Run it and see it pass**

Run: `npx vitest run src/main/devices/android/emulators.test.ts && npx tsc -p tsconfig.node.json --noEmit`
Expected: PASS (12 tests), and no type errors.

- [ ] **Step 6: Commit**

```bash
git add src/shared/types.ts src/main/devices/android/emulators.ts src/main/devices/android/emulators.test.ts
git -c user.email=franco@effektstudios.com commit -m "Emulators: the SDK's emulator, its AVDs, starting one detached and closing one"
```

---

### Task 3: Booting and shutting down a simulator

**Files:**
- Create: `src/main/devices/ios/boot.ts`
- Test: `src/main/devices/ios/boot.test.ts`

- [ ] **Step 1: Write the failing test**

Create `src/main/devices/ios/boot.test.ts`:

```ts
import { chmodSync, existsSync, mkdirSync, mkdtempSync, readFileSync, rmSync, writeFileSync } from 'node:fs'
import { tmpdir } from 'node:os'
import { join } from 'node:path'
import { afterAll, beforeAll, describe, expect, it } from 'vitest'
import { bootSimulator, shutdownSimulator } from './boot'

// Shell scripts stand in for idb_companion; simulators are macOS's anyway.
describe.skipIf(process.platform === 'win32')('bootSimulator and shutdownSimulator', () => {
  let root: string
  beforeAll(() => {
    root = mkdtempSync(join(tmpdir(), 'deck-boot-'))
  })
  afterAll(() => rmSync(root, { recursive: true, force: true }))

  /** A stand-in idb_companion in its own folder: writes its arguments there, then runs `body`. */
  const idb = (name: string, body: string): string => {
    const dir = join(root, name)
    mkdirSync(dir)
    const file = join(dir, 'idb_companion')
    writeFileSync(file, `#!/bin/sh\necho "$@" > '${dir}/args'\n${body}\n`)
    chmodSync(file, 0o755)
    return file
  }
  const argsOf = (name: string) => readFileSync(join(root, name, 'args'), 'utf8').trim()

  it("boots and shuts down in Xcode's own set, at --log-level info", async () => {
    const file = idb('plain', `echo '{"state":"Booted"}'`)
    await bootSimulator(file, 'FAKE-UDID', { set: null })
    expect(argsOf('plain')).toBe('--boot FAKE-UDID --log-level info')
    await shutdownSimulator(file, 'FAKE-UDID', { set: null })
    expect(argsOf('plain')).toBe('--shutdown FAKE-UDID --log-level info')
  })

  it('names a private device set', async () => {
    const file = idb('set', 'exit 0')
    await bootSimulator(file, 'FAKE-UDID', { set: '/tmp/deck-set' })
    expect(argsOf('set')).toBe('--boot FAKE-UDID --device-set-path /tmp/deck-set --log-level info')
  })

  it('rejects with its last line that reads as a failure, without the timestamp', async () => {
    // As idb-companion 1.6.1 said it, booting a UDID its set doesn't have (2026-11-25).
    const file = idb('fail', [
      "echo '2026-11-25 15:22:03.140+0200 Booting 0000' >&2",
      "echo '2026-11-25 15:22:03.218+0200 0000 could not be resolved to any target in [FBSimulatorControl.SimulatorSet]' >&2",
      "echo '2026-11-25 15:22:03.219+0200 Loaded All Private Frameworks [CoreSimulator]' >&2",
      'exit 1',
    ].join('\n'))
    await expect(bootSimulator(file, '0000', { set: null })).rejects.toThrow(new Error('0000 could not be resolved to any target in [FBSimulatorControl.SimulatorSet]'))
  })

  it('says how it ended when no line reads as a failure', async () => {
    const file = idb('quiet', "echo '2026-11-25 15:22:03.140+0200 Booting FAKE-UDID' >&2\nexit 4")
    await expect(bootSimulator(file, 'FAKE-UDID', { set: null })).rejects.toThrow(new Error('idb_companion stopped (exit code 4).'))
  })

  it('an abort ends it at once with Stopped., and so does running out of time', async () => {
    const slow = idb('slow', 'exec sleep 30')
    const started = Date.now()
    const controller = new AbortController()
    const booting = bootSimulator(slow, 'FAKE-UDID', { set: null, signal: controller.signal })
    setTimeout(() => controller.abort(), 100)
    await expect(booting).rejects.toThrow(new Error('Stopped.'))
    await expect(shutdownSimulator(slow, 'FAKE-UDID', { set: null, timeoutMs: 200 })).rejects.toThrow(new Error("idb_companion didn't finish within 1 s."))
    expect(Date.now() - started).toBeLessThan(5000)
  })

  it('an abort before the start runs nothing', async () => {
    const file = idb('never', 'exit 0')
    await expect(bootSimulator(file, 'FAKE-UDID', { set: null, signal: AbortSignal.abort() })).rejects.toThrow(new Error('Stopped.'))
    expect(existsSync(join(root, 'never', 'args'))).toBe(false)
  })
})
```

- [ ] **Step 2: Run it and see it fail**

Run: `npx vitest run src/main/devices/ios/boot.test.ts`
Expected: FAIL with `Error: Cannot find module './boot'`.

- [ ] **Step 3: Implement**

Create `src/main/devices/ios/boot.ts`:

```ts
import { type ChildProcess, spawn } from 'node:child_process'
import { asFailure, endedHow, lastLine, stopper } from './process'

export interface BootOptions {
  /** A device set other than Xcode's own (DECK_SIMULATOR_SET), or null. */
  set: string | null
  /** Ends the command at once (Deck quitting): it rejects with "Stopped.". */
  signal?: AbortSignal
  /** ms; tests shorten it. */
  timeoutMs?: number
}

/** idb_companion starts each line of its log with a timestamp ("2026-11-25 15:22:03.218+0200 "):
 *  the reason shown is what follows. */
const STAMP = /^\d{4}-\d\d-\d\d \d\d:\d\d:\d\d(?:\.\d+)?[+-]\d{4} /
/** A log line that reads as a failure, without its timestamp; null for any other. */
const failureLine = (line: string): string | null => asFailure(line.replace(STAMP, '')) || null

/** Boots simulator `udid` with `idb_companion --boot`: through CoreSimulator, as idb does
 *  everything, not `xcrun simctl`, whose wrapper can run Xcode's first-launch step. It doesn't open
 *  Simulator.app (measured 2026-11-25), and without --headless the simulator stays booted after
 *  the command ends. Resolves when idb says the boot has finished (18 s for a first boot, 3 s after
 *  that), which is after the notifier already said "Booted". */
export const bootSimulator = (idb: string, udid: string, opts: BootOptions): Promise<void> => runIdb(idb, ['--boot', udid], opts)

/** Shuts simulator `udid` down with `idb_companion --shutdown` (3 to 6 s). One already shut down is
 *  fine. */
export const shutdownSimulator = (idb: string, udid: string, opts: BootOptions): Promise<void> => runIdb(idb, ['--shutdown', udid], opts)

/** Runs one idb_companion command at --log-level info (its default, debug, would bury a failure's
 *  line in chatter) for up to `timeoutMs` (120 s). Rejects with its last line that reads as a
 *  failure, else how it ended. A SIGTERM ends idb_companion with exit code 0, so an abort answers
 *  "Stopped." before its close is seen. */
function runIdb(idb: string, args: string[], { set, signal, timeoutMs = 120_000 }: BootOptions): Promise<void> {
  return new Promise((resolve, reject) => {
    if (signal?.aborted) return reject(new Error('Stopped.'))
    let child: ChildProcess
    try {
      child = spawn(idb, [...args, ...(set ? ['--device-set-path', set] : []), '--log-level', 'info'], { stdio: ['ignore', 'pipe', 'pipe'] })
    } catch (err) {
      return reject(err instanceof Error ? err : new Error(String(err)))
    }
    const stop = stopper(child)
    const said = lastLine(child.stderr, failureLine)
    lastLine(child.stdout) // read to its end, so the pipe never fills
    let done = false
    const finish = (err: Error | null) => {
      if (done) return
      done = true
      clearTimeout(timer)
      signal?.removeEventListener('abort', onAbort)
      if (err) reject(err)
      else resolve()
    }
    const onAbort = () => {
      stop()
      finish(new Error('Stopped.'))
    }
    const timer = setTimeout(() => {
      stop()
      finish(new Error(`idb_companion didn't finish within ${Math.max(1, Math.round(timeoutMs / 1000))} s.`))
    }, timeoutMs)
    signal?.addEventListener('abort', onAbort, { once: true })
    child.on('error', (err) => finish(new Error(said() || err.message)))
    child.on('close', (code, sig) => finish(code === 0 ? null : new Error(said() || endedHow('idb_companion', code, sig))))
  })
}
```

- [ ] **Step 4: Run it and see it pass, on both Nodes**

Run: `npx vitest run src/main/devices/ios/boot.test.ts`
Then: `ELECTRON_RUN_AS_NODE=1 ./node_modules/.bin/electron ./node_modules/vitest/vitest.mjs run src/main/devices/ios`
Expected: PASS (6 tests), and the whole `ios/` folder passes on Electron's Node.

- [ ] **Step 5: Commit**

```bash
git add src/main/devices/ios/boot.ts src/main/devices/ios/boot.test.ts
git -c user.email=franco@effektstudios.com commit -m "Simulators: booting and shutting one down through idb_companion"
```

---

### Task 4: The shut-down simulators, as what can be started

**Files:**
- Modify: `src/main/devices/ios/simulators.ts`
- Test: `src/main/devices/ios/simulators.test.ts`

- [ ] **Step 1: Write the failing tests**

In `src/main/devices/ios/simulators.test.ts`, add `startableSimulators` to the import from
`./simulators`:

```ts
import { readNotifyLine, simulatorDevices, SimulatorTracker, type SimTarget, startableSimulators, udidOf } from './simulators'
```

Add this `describe` just before `describe('SimulatorTracker', () => {`:

```ts
describe('startableSimulators', () => {
  it('offers the shut-down ones by name; not one booted, booting or shutting down', () => {
    const targets = new Map<string, SimTarget>([
      ['B', { udid: 'B', name: 'iPhone 17 Pro', state: 'Shutdown', osVersion: 'iOS 27.0' }],
      ['A', { udid: 'A', name: 'iPhone 16', state: 'Shutdown', osVersion: 'iOS 18.5' }],
      ['C', { udid: 'C', name: 'iPad', state: 'Booted', osVersion: 'iOS 27.0' }],
      ['D', { udid: 'D', name: 'iPhone Air', state: 'Booting', osVersion: 'iOS 27.0' }],
      ['E', { udid: 'E', name: 'iPhone 17e', state: 'Shutting Down', osVersion: 'iOS 27.0' }],
    ])
    expect(startableSimulators(targets)).toEqual([
      { id: 'simulator:A', kind: 'simulator', name: 'iPhone 16', detail: 'Simulator · iOS 18.5' },
      { id: 'simulator:B', kind: 'simulator', name: 'iPhone 17 Pro', detail: 'Simulator · iOS 27.0' },
    ])
  })
})
```

Inside `describe('SimulatorTracker', …)`, add this test before
`it('keeps booted() consistent with the list: a booted watchOS simulator never enters either', …`:

```ts
  it('shutDown() gives the shut-down iOS simulators as of the last line', async () => {
    const { tracker, spawned, published } = setup()
    tracker.start()
    spawned[0].stdout.write(line(sim('A', 'iPhone 17', 'Shutdown'), sim('B', 'iPad', 'Booted'), sim('W', 'Apple Watch', 'Shutdown', 'watchOS 11.2')))
    await vi.waitFor(() => expect(published).toHaveLength(1))
    expect(tracker.shutDown()).toEqual([{ id: 'simulator:A', kind: 'simulator', name: 'iPhone 17', detail: 'Simulator · iOS 27.0' }])
    spawned[0].stdout.write(line(sim('A', 'iPhone 17', 'Booting')))
    await vi.waitFor(() => expect(published).toHaveLength(2))
    expect(tracker.shutDown()).toEqual([])
    tracker.stop()
  })
```

- [ ] **Step 2: Run them and see them fail**

Run: `npx vitest run src/main/devices/ios/simulators.test.ts`
Expected: the two new tests FAIL (`TypeError: startableSimulators is not a function`,
`TypeError: tracker.shutDown is not a function`); the rest pass.

- [ ] **Step 3: Implement**

In `src/main/devices/ios/simulators.ts`, change the type import to:

```ts
import type { DeviceInfo, StartableDevice } from '@shared/types'
```

Replace `simulatorDevices` (with its doc comment) by:

```ts
const byName = (a: SimTarget, b: SimTarget) => a.name.localeCompare(b.name) || a.udid.localeCompare(b.udid)
const detailOf = (t: SimTarget) => (t.osVersion ? `Simulator · ${t.osVersion}` : 'Simulator')

/** The booted simulators, by name, as devices. */
export function simulatorDevices(targets: ReadonlyMap<string, SimTarget>): DeviceInfo[] {
  return [...targets.values()]
    .filter((t) => t.state === 'Booted')
    .sort(byName)
    .map((t) => ({ id: `${PREFIX}${t.udid}`, kind: 'simulator', name: t.name, detail: detailOf(t), state: 'ready' }))
}

/** The shut-down simulators, by name, as what the panel can start. One booting or shutting down is
 *  neither listed nor offered until it settles. */
export function startableSimulators(targets: ReadonlyMap<string, SimTarget>): StartableDevice[] {
  return [...targets.values()]
    .filter((t) => t.state === 'Shutdown')
    .sort(byName)
    .map((t) => ({ id: `${PREFIX}${t.udid}`, kind: 'simulator', name: t.name, detail: detailOf(t) }))
}
```

In `class SimulatorTracker`, after `booted(udid)`, add:

```ts
  /** The simulators shut down at the last line, as what the panel can start. */
  shutDown(): StartableDevice[] {
    return startableSimulators(this.targets)
  }
```

- [ ] **Step 4: Run them and see them pass**

Run: `npx vitest run src/main/devices/ios/simulators.test.ts`
Expected: PASS.

- [ ] **Step 5: Commit**

```bash
git add src/main/devices/ios/simulators.ts src/main/devices/ios/simulators.test.ts
git -c user.email=franco@effektstudios.com commit -m "Simulators: the shut-down ones, as what the panel can start"
```

---

### Task 5: A device still starting up is `booting`

adb lists a device as soon as adbd runs, well before Android has started (an emulator's cold boot, a
phone rebooting); scrcpy's server can't run yet, so a stream started then fails three times and ends
in "Couldn't show …". The tracker already asks such a device again every 3 s (`sys.boot_completed`);
now the list says so, and the panel waits.

**Files:**
- Modify: `src/shared/types.ts` (`DeviceInfo.state`)
- Modify: `src/main/devices/android/devices.ts` (`mergeDevices`)
- Modify: `src/main/devices/android/tracker.ts` (`ask`, `publish`)
- Modify: `src/renderer/src/device/DeviceMenu.tsx` (`STATE_WORDS`)
- Modify: `src/renderer/src/device/DevicePanel.tsx` (the message, the screen's `busy`)
- Modify: `src/renderer/src/device/DeviceScreen.tsx` (`busy`)
- Test: `src/main/devices/android/devices.test.ts`, `src/main/devices/android/tracker.test.ts`

- [ ] **Step 1: Write the failing tests**

In `src/main/devices/android/devices.test.ts`, inside `describe('mergeDevices', …)`, add before
`it('lists nothing for an emulator still starting (offline, unanswered)', …`:

```ts
  it('says a device that answered before Android had started is booting, until it has', () => {
    const starting = { ...emu, booted: false }
    expect(mergeDevices([{ entry: entry(EMULATOR), identity: starting }]).devices[0].state).toBe('booting')
    expect(mergeDevices([{ entry: entry(EMULATOR), identity: emu }]).devices[0].state).toBe('ready')
    // adb's own state comes first, and a device that never answered isn't taken for booting.
    expect(mergeDevices([{ entry: { ...entry(C66), state: 'unauthorized' }, identity: { ...c66, booted: false } }]).devices[0].state).toBe('unauthorized')
    expect(mergeDevices([{ entry: entry(C66), identity: null }]).devices[0].state).toBe('ready')
  })
```

In `src/main/devices/android/tracker.test.ts`, inside `describe('AndroidTracker', …)`, add before
`it("starts again after adb's server goes away, waiting longer each time, and says why", …`:

```ts
  it('lists a device as booting while it says Android is still starting, then as ready', async () => {
    const answers: Identity[] = [{ ...emu, booted: false }, emu]
    const { tracker, children, published } = setup(async () => answers.shift() ?? emu)
    tracker.start()
    children[0].stdout.emit('data', frame(EMULATOR))
    await vi.waitFor(() => expect(published.at(-1)?.devices.map((d) => d.state)).toEqual(['ready']))
    expect(published.map((p) => p.devices[0]?.state)).toEqual(['booting', 'ready'])
    tracker.stop()
  })

  it('takes a device that still says it is starting after 40 answers as started', async () => {
    const identify = vi.fn(async (): Promise<Identity> => ({ ...emu, booted: false }))
    const { tracker, children, published } = setup(identify, undefined, { identity: 1, booting: 1, restartMin: 20, restartMax: 80 })
    tracker.start()
    children[0].stdout.emit('data', frame(EMULATOR))
    await vi.waitFor(() => expect(published.at(-1)?.devices.map((d) => d.state)).toEqual(['ready']), { timeout: 3000 })
    expect(identify).toHaveBeenCalledTimes(40)
    tracker.stop()
  })
```

- [ ] **Step 2: Run them and see them fail**

Run: `npx vitest run src/main/devices/android/devices.test.ts src/main/devices/android/tracker.test.ts`
Expected: three FAIL: `expected 'ready' to be 'booting'`; `expected [ 'ready' ] to deeply equal
[ 'booting', 'ready' ]`; and the 40-answer test, its spy called far fewer than 40 times (the device
is published as ready at the first answer).

- [ ] **Step 3: Implement the state in main**

In `src/shared/types.ts`, replace the `state` field of `DeviceInfo` (with its comment) by:

```ts
  /** ready: it can be shown; booting: it's still starting up (an Android device that answered
   *  before Android had finished starting, or a simulator Deck is booting), shown once it has;
   *  unauthorized: USB debugging isn't allowed on it yet; offline: adb can't reach it; connecting:
   *  adb is still setting it up. */
  state: 'ready' | 'booting' | 'unauthorized' | 'offline' | 'connecting'
```

In `src/main/devices/android/devices.ts`, in `mergeDevices`, replace the last field of the pushed
device, `      state,`, by:

```ts
      // adb lists a device once adbd runs, well before Android has started (an emulator's cold boot,
      // a phone rebooting): a stream started then fails, so it shows once Android has.
      state: state === 'ready' && identity && !identity.booted ? 'booting' : state,
```

In `src/main/devices/android/tracker.ts`, in `ask()`, replace the answer's handling:

```ts
        asked.asking = false
        asked.tries = 0
        asked.identity = identity
        this.publish(null)
        // Still starting up: Android's settings, and with them the phone's own name, aren't there yet.
        if (!identity.booted && ++asked.boots < BOOT_TRIES) this.askLater(key, asked, this.retry.booting)
```

by:

```ts
        asked.asking = false
        asked.tries = 0
        asked.identity = identity
        // Still starting up: Android's settings, and with them the phone's own name, aren't there yet.
        // Counted before publishing, so the answer that uses up the tries is published as started.
        const again = !identity.booted && ++asked.boots < BOOT_TRIES
        this.publish(null)
        if (again) this.askLater(key, asked, this.retry.booting)
```

In `publish()`, replace `      seen.push({ entry, identity: asked?.identity ?? null })` by:

```ts
      seen.push({ entry, identity: settled(asked) })
```

and at the end of the file, after `const keyOf = …`, add:

```ts

/** What a device said it is. One that still said it was starting up after BOOT_TRIES answers isn't
 *  asked again, so it's taken as started: shown, rather than "starting" for good. */
function settled(asked: Asked | undefined): Identity | null {
  if (!asked?.identity) return null
  return !asked.identity.booted && asked.boots >= BOOT_TRIES ? { ...asked.identity, booted: true } : asked.identity
}
```

- [ ] **Step 4: Show it in the panel**

In `src/renderer/src/device/DeviceMenu.tsx`, replace `STATE_WORDS` by:

```ts
const STATE_WORDS: Record<DeviceInfo['state'], string> = { ready: '', booting: 'starting', connecting: 'connecting', unauthorized: 'not allowed yet', offline: 'offline' }
```

In `src/renderer/src/device/DeviceScreen.tsx`, replace the `message` prop's comment and add `busy`:

```ts
  /** Why the device can't be shown (gone, not allowed, offline, still starting), over the dimmed last
   *  picture. */
  message: string | null
  /** The message is a wait (a device still starting up): it gets the spinner. */
  busy?: boolean
  handle?: Ref<ScreenHandle>
}
```

change the signature to
`export function DeviceScreen({ deviceId, name, kind, live, message, busy, handle }: DeviceScreenProps) {`,
and replace the message overlay
`        <div className="dp-overlay" role="status"><strong>{message}</strong></div>` by:

```tsx
        <div className="dp-overlay" role="status">
          {busy && <span className="cp-spinner" aria-hidden="true" />}
          <strong>{message}</strong>
        </div>
```

In `src/renderer/src/device/DevicePanel.tsx`, add the booting message as the second branch:

```ts
  if (device && gone) message = `${device.name} disconnected`
  else if (device?.state === 'booting') message = `Starting ${device.name}…`
  else if (device?.state === 'unauthorized') message = `Allow USB debugging on ${device.name}: check its screen.`
```

and give the screen its spinner (`ready` already keeps a booting device from streaming):

```tsx
            <DeviceScreen key={device.id} deviceId={device.id} name={device.name} kind={device.kind} live={visible && ready} message={message}
              busy={device.state === 'booting' && !gone} handle={screen} />
```

- [ ] **Step 5: Run the tests and the typecheck**

Run: `npx vitest run src/main/devices/android && npm run typecheck`
Expected: PASS, no type errors.

- [ ] **Step 6: Commit**

```bash
git add src/shared/types.ts src/main/devices/android/devices.ts src/main/devices/android/tracker.ts src/main/devices/android/devices.test.ts src/main/devices/android/tracker.test.ts src/renderer/src/device/DeviceMenu.tsx src/renderer/src/device/DevicePanel.tsx src/renderer/src/device/DeviceScreen.tsx
git -c user.email=franco@effektstudios.com commit -m "Devices: one still starting up is listed as booting, and shown once Android has started"
```

---

### Task 6: The starts under way

From the click until the device is listed, for 3 minutes at most; a failure keeps its reason until
the next start.

**Files:**
- Create: `src/main/devices/starts.ts`
- Test: `src/main/devices/starts.test.ts`

- [ ] **Step 1: Write the failing test**

Create `src/main/devices/starts.test.ts`:

```ts
import { afterEach, beforeEach, describe, expect, it, vi } from 'vitest'
import type { DeviceInfo, StartableDevice } from '@shared/types'
import { START_DEADLINE_MS, Starts } from './starts'

const pixel: StartableDevice = { id: 'emulator:Pixel_9', kind: 'emulator', name: 'Pixel 9', detail: 'Emulator' }
const medium: StartableDevice = { id: 'emulator:Medium_Phone', kind: 'emulator', name: 'Medium Phone', detail: 'Emulator' }
const iphone: StartableDevice = { id: 'simulator:U1', kind: 'simulator', name: 'iPhone 17', detail: 'Simulator · iOS 27.0' }
const running = (d: StartableDevice): DeviceInfo => ({ id: d.id, kind: d.kind, name: d.name, detail: d.detail, state: 'ready' })

describe('Starts', () => {
  beforeEach(() => vi.useFakeTimers())
  afterEach(() => vi.useRealTimers())

  it('offers what is offered and not running, emulators first, each kind by name', () => {
    const starts = new Starts(() => {})
    expect(starts.merge([iphone, pixel, medium], [])).toEqual([medium, pixel, iphone])
    expect(starts.merge([iphone, pixel, medium], [running(pixel)])).toEqual([medium, iphone])
  })

  it('a start shows as starting, even once no longer offered, until its device is listed', () => {
    const changed = vi.fn()
    const starts = new Starts(changed)
    expect(starts.begin(iphone)).not.toBeNull()
    expect(starts.merge([iphone], [])).toEqual([{ ...iphone, starting: true }])
    // Booting: the notifier no longer says it's shut down, and doesn't list it yet.
    expect(starts.merge([], [])).toEqual([{ ...iphone, starting: true }])
    starts.listed([running(iphone)])
    expect(starts.merge([], [running(iphone)])).toEqual([])
    expect(changed).not.toHaveBeenCalled()
  })

  it('a second click while it starts does nothing', () => {
    const starts = new Starts(() => {})
    expect(starts.begin(pixel)).not.toBeNull()
    expect(starts.begin(pixel)).toBeNull()
  })

  it("a failed command keeps its reason until the next start, which clears it (Try again)", () => {
    const changed = vi.fn()
    const starts = new Starts(changed)
    const fail = starts.begin(pixel)!
    fail('The emulator stopped (exit code 1).')
    expect(changed).toHaveBeenCalledTimes(1)
    expect(starts.merge([pixel], [])).toEqual([{ ...pixel, error: 'The emulator stopped (exit code 1).' }])
    fail('Said twice.') // only once
    expect(changed).toHaveBeenCalledTimes(1)
    const again = starts.begin(pixel)
    expect(again).not.toBeNull()
    expect(starts.merge([pixel], [])).toEqual([{ ...pixel, starting: true }])
    fail('From the first start.') // the first start's failure can't touch the second
    expect(starts.merge([pixel], [])).toEqual([{ ...pixel, starting: true }])
  })

  it('runs out of time after 3 minutes', () => {
    const changed = vi.fn()
    const starts = new Starts(changed)
    starts.begin(pixel)
    vi.advanceTimersByTime(START_DEADLINE_MS - 1)
    expect(changed).not.toHaveBeenCalled()
    vi.advanceTimersByTime(1)
    expect(changed).toHaveBeenCalledTimes(1)
    expect(starts.merge([pixel], [])).toEqual([{ ...pixel, error: "It didn't start within 3 minutes." }])
  })

  it('a listed device ends its start, failed or not, and its deadline with it', () => {
    const changed = vi.fn()
    const starts = new Starts(changed)
    const fail = starts.begin(pixel)!
    starts.listed([running(pixel)])
    vi.advanceTimersByTime(START_DEADLINE_MS)
    fail('Too late.')
    expect(changed).not.toHaveBeenCalled()
    starts.begin(medium)!('Broken AVD.')
    starts.listed([running(medium)]) // it came up anyway
    expect(starts.merge([], [running(medium)])).toEqual([])
  })

  it('clear() forgets every start and its deadline', () => {
    const changed = vi.fn()
    const starts = new Starts(changed)
    starts.begin(pixel)
    starts.clear()
    vi.advanceTimersByTime(START_DEADLINE_MS)
    expect(changed).not.toHaveBeenCalled()
    expect(starts.merge([], [])).toEqual([])
  })
})
```

- [ ] **Step 2: Run it and see it fail**

Run: `npx vitest run src/main/devices/starts.test.ts`
Expected: FAIL with `Error: Cannot find module './starts'`.

- [ ] **Step 3: Implement**

Create `src/main/devices/starts.ts`:

```ts
import type { DeviceInfo, StartableDevice } from '@shared/types'

/** How long a start may take before it's given up: until the device is listed, which for an
 *  emulator's cold boot can be over a minute. */
export const START_DEADLINE_MS = 3 * 60_000

interface Start {
  /** As it was offered when started. */
  device: StartableDevice
  /** Why it failed; null while it's starting. */
  error: string | null
  timer: ReturnType<typeof setTimeout> | null
}

/** The emulators and simulators started from the panel, from the click until they're listed among
 *  the devices, for 3 minutes at most. One whose command fails, or that runs out of time, keeps its
 *  error until it's started again (Try again). Merged into what the panel can start. */
export class Starts {
  private readonly starts = new Map<string, Start>()

  /** `changed`: a start failed or ran out of time, so what can be started changed. */
  constructor(private readonly changed: () => void, private readonly deadlineMs = START_DEADLINE_MS) {}

  /** `device` starts now: what to call if its command fails, or null when it's already starting (a
   *  second click). Starting one that failed (Try again) clears its error. */
  begin(device: StartableDevice): ((why: string) => void) | null {
    const known = this.starts.get(device.id)
    if (known && known.error === null) return null
    if (known?.timer) clearTimeout(known.timer)
    const start: Start = { device: { id: device.id, kind: device.kind, name: device.name, detail: device.detail }, error: null, timer: null }
    this.starts.set(device.id, start)
    const fail = (why: string) => {
      // Only this start, and only once: a later start of the same device has its own.
      if (this.starts.get(device.id) !== start || start.error !== null) return
      if (start.timer) clearTimeout(start.timer)
      start.timer = null
      start.error = why
      this.changed()
    }
    start.timer = setTimeout(() => fail(`It didn't start within ${Math.round(this.deadlineMs / 60_000)} minutes.`), this.deadlineMs)
    return fail
  }

  /** Ends the starts whose device is listed now: it has started, whatever its command said. */
  listed(devices: readonly DeviceInfo[]): void {
    for (const device of devices) {
      const start = this.starts.get(device.id)
      if (!start) continue
      if (start.timer) clearTimeout(start.timer)
      this.starts.delete(device.id)
    }
  }

  /** What the panel can start: `offered` (the AVDs, the shut-down simulators) less the devices
   *  running, each with its start's state, and the starts no longer offered (a simulator booting);
   *  emulators first, each kind by name. */
  merge(offered: readonly StartableDevice[], devices: readonly DeviceInfo[]): StartableDevice[] {
    const running = new Set(devices.map((d) => d.id))
    const items = new Map<string, StartableDevice>()
    for (const device of offered) if (!running.has(device.id)) items.set(device.id, device)
    for (const [id, start] of this.starts) {
      const base = items.get(id) ?? start.device
      items.set(id, start.error === null ? { ...base, starting: true } : { ...base, error: start.error })
    }
    return [...items.values()].sort((a, b) =>
      a.kind === b.kind ? a.name.localeCompare(b.name) || a.id.localeCompare(b.id) : a.kind === 'emulator' ? -1 : 1)
  }

  /** Forgets every start: nothing watches any more, or Deck quits. */
  clear(): void {
    for (const start of this.starts.values()) if (start.timer) clearTimeout(start.timer)
    this.starts.clear()
  }
}
```

- [ ] **Step 4: Run it and see it pass**

Run: `npx vitest run src/main/devices/starts.test.ts && npx tsc -p tsconfig.node.json --noEmit`
Expected: PASS (7 tests), no type errors.

- [ ] **Step 5: Commit**

```bash
git add src/main/devices/starts.ts src/main/devices/starts.test.ts
git -c user.email=franco@effektstudios.com commit -m "Devices: the starts under way, from the click until the device is listed"
```

---

### Task 7: The list offers what can be started

`DeviceList` gains `startable` and `noAvds`. Main reads the AVDs at each start of watching and each
focus, and adds them and the shut-down simulators to every list it publishes.

**Files:**
- Modify: `src/shared/types.ts` (`DeviceList`)
- Modify: `src/main/devices/registry.ts` (`combineLists`'s return type)
- Modify: `src/main/devices/ipc.ts`
- Create: `src/main/devices/ipc.start.test.ts`
- Modify (list literals): `src/main/devices/ipc.test.ts`, `src/main/devices/ipc.watch.test.ts`,
  `src/main/devices/ipc.ios.test.ts`, `src/renderer/src/device/pick.test.ts`

- [ ] **Step 1: Write the failing test**

Create `src/main/devices/ipc.start.test.ts` (its stand-ins already do what Task 8's tests need; Task 8
adds the `start` and `stop` helpers once their channels exist, since `tsc` checks test files too):

```ts
import { EventEmitter } from 'node:events'
import { chmodSync, mkdirSync, mkdtempSync, readFileSync, rmSync, writeFileSync } from 'node:fs'
import { tmpdir } from 'node:os'
import { join } from 'node:path'
import { afterAll, beforeAll, describe, expect, it, vi } from 'vitest'
import { IPC } from '@shared/channels'
import type { DeviceList } from '@shared/types'
import type { BrowserWindow } from 'electron'
import { type DeviceIpc, registerDeviceIpc } from './ipc'

const ipc = vi.hoisted(() => ({
  handlers: new Map<string, (...args: unknown[]) => unknown>(),
  listeners: new Map<string, (...args: unknown[]) => void>(),
}))
vi.mock('electron', () => ({
  ipcMain: {
    handle: (channel: string, fn: (...args: unknown[]) => unknown) => ipc.handlers.set(channel, fn),
    on: (channel: string, fn: (...args: unknown[]) => void) => ipc.listeners.set(channel, fn),
  },
  powerMonitor: { on: () => {} },
  shell: { openExternal: async () => {} },
}))

const call = <T>(channel: string, ...args: unknown[]) => Promise.resolve(ipc.handlers.get(channel)!({}, ...args)) as Promise<T>
const emit = (channel: string, ...args: unknown[]) => ipc.listeners.get(channel)!({}, ...args)
const list = () => call<DeviceList | null>(IPC.devicesList)

// Shell scripts stand in for the SDK's adb and emulator and for idb_companion, never the real ones
// (a real adb would take over the adb server; real simulators are Franco's). They share a folder of
// marks: the emulator lists the AVDs in `avds` and, started, marks `started` and stays up; adb's
// track-devices lists emulator-5554 from then until `emu kill` (which ends the emulator); idb's
// notifier lists FAKE-UDID booted while `booted` is there, which `--boot` and `--shutdown` set and
// clear. Every call goes to `calls`, one line each.
describe.skipIf(process.platform === 'win32')('registerDeviceIpc: starting and stopping', () => {
  let root: string
  let marks: string
  let set: string
  let devices: DeviceIpc
  let win: BrowserWindow
  const calls = () => readFileSync(join(marks, 'calls'), 'utf8').split('\n')
  const tool = (path: string, body: string[]) => {
    mkdirSync(join(path, '..'), { recursive: true })
    writeFileSync(path, ['#!/bin/sh', `M='${marks}'`, ...body, ''].join('\n'))
    chmodSync(path, 0o755)
  }

  beforeAll(() => {
    root = mkdtempSync(join(tmpdir(), 'deck-start-ipc-'))
    marks = join(root, 'marks')
    set = join(root, 'set')
    mkdirSync(marks)
    writeFileSync(join(marks, 'avds'), 'Pixel_9\nBroken_AVD\n')
    writeFileSync(join(marks, 'calls'), '')
    tool(join(root, 'sdk', 'emulator', 'emulator'), [
      'echo "emulator $*" >> "$M/calls"',
      'if [ "$1" = "-list-avds" ]; then cat "$M/avds"; exit 0; fi',
      'if [ "$2" = "Broken_AVD" ]; then exit 1; fi',
      'echo $$ > "$M/emulator.pid"',
      'touch "$M/started"',
      'exec sleep 30',
    ])
    tool(join(root, 'sdk', 'platform-tools', 'adb'), [
      'echo "adb $1 $2 $3 $4" >> "$M/calls"',
      'if [ "$1" = "track-devices" ]; then',
      "  printf '0000'",
      '  while [ ! -f "$M/started" ]; do sleep 0.05; done',
      "  printf '0015emulator-5554\\tdevice\\n'",
      '  while [ ! -f "$M/killed" ]; do sleep 0.05; done',
      "  printf '0000'",
      '  exec sleep 30',
      'fi',
      'if [ "$3" = "shell" ]; then',
      "  printf 'serial=EMULATOR1\\nmaker=Google\\nmodel=sdk_gphone64_arm64\\nrelease=15\\nbooted=1\\navd=Pixel_9\\navd_old=\\nname=\\n'",
      '  exit 0',
      'fi',
      'if [ "$3" = "emu" ]; then',
      '  touch "$M/killed"',
      '  kill "$(cat "$M/emulator.pid")"',
      "  echo 'OK: killing emulator, bye bye'",
      'fi',
      'exit 0',
    ])
    tool(join(root, 'libexec', 'idb_companion'), [
      'echo "idb $*" >> "$M/calls"',
      'state() { if [ -f "$M/booted" ]; then echo Booted; else echo Shutdown; fi; }',
      'list() { echo "[{\\"udid\\":\\"FAKE-UDID\\",\\"name\\":\\"iPhone 17\\",\\"state\\":\\"$1\\",\\"type\\":\\"Simulator\\",\\"os_version\\":\\"iOS 27.0\\"},{\\"udid\\":\\"BAD-UDID\\",\\"name\\":\\"iPhone Broken\\",\\"state\\":\\"Shutdown\\",\\"type\\":\\"Simulator\\",\\"os_version\\":\\"iOS 27.0\\"}]"; }',
      'case "$1" in',
      '  --notify)',
      '    last=$(state); list "$last"',
      '    while :; do now=$(state); if [ "$now" != "$last" ]; then list "$now"; last=$now; fi; sleep 0.05; done ;;',
      '  --boot)',
      '    if [ "$2" = "BAD-UDID" ]; then echo "2026-11-25 15:22:03.218+0200 BAD-UDID could not be resolved to any target" >&2; exit 1; fi',
      // The notifier says Booted at once; the boot itself goes on a while, as a real first boot does.
      '    touch "$M/booted"; sleep 1 ;;',
      '  --shutdown) rm -f "$M/booted" ;;',
      'esac',
    ])
    writeFileSync(join(root, 'libexec', 'sim-video'), '#!/bin/sh\n')
    chmodSync(join(root, 'libexec', 'sim-video'), 0o755)

    const webContents = Object.assign(new EventEmitter(), { isDestroyed: () => false, send: () => {} })
    win = Object.assign(new EventEmitter(), { isDestroyed: () => false, webContents }) as unknown as BrowserWindow
    devices = registerDeviceIpc({
      picksFile: join(root, 'devices.json'),
      resources: join(root, 'resources'),
      platform: 'darwin',
      home: join(root, 'home'),
      env: { PATH: '', ANDROID_HOME: join(root, 'sdk'), DECK_IDB_COMPANION: join(root, 'libexec', 'idb_companion'), DECK_SIMULATOR_SET: set },
      socketDir: join(root, 's'),
      iphoneHelper: null,
      saveImage: async () => '',
    })
    devices.attach(win)
    emit(IPC.devicesWatch)
  })
  afterAll(() => {
    emit(IPC.devicesUnwatch)
    devices?.dispose()
    // The emulator stand-in is detached, as a real one is: end it if a test didn't.
    try {
      process.kill(Number(readFileSync(join(marks, 'emulator.pid'), 'utf8')))
    } catch {
      // never started, or already ended
    }
    rmSync(root, { recursive: true, force: true })
  })

  it('offers the AVDs and the shut-down simulators, emulators first, each by name', async () => {
    await vi.waitFor(async () => expect((await list())?.startable).toEqual([
      { id: 'emulator:Broken_AVD', kind: 'emulator', name: 'Broken AVD', detail: 'Emulator' },
      { id: 'emulator:Pixel_9', kind: 'emulator', name: 'Pixel 9', detail: 'Emulator' },
      { id: 'simulator:FAKE-UDID', kind: 'simulator', name: 'iPhone 17', detail: 'Simulator · iOS 27.0' },
      { id: 'simulator:BAD-UDID', kind: 'simulator', name: 'iPhone Broken', detail: 'Simulator · iOS 27.0' },
    ]), { timeout: 5000 })
    expect((await list())?.noAvds).toBe(false)
  })

  it('reads the AVDs again when Deck comes to the front, and says when there are none', async () => {
    writeFileSync(join(marks, 'avds'), '')
    win.emit('focus')
    await vi.waitFor(async () => expect((await list())?.noAvds).toBe(true), { timeout: 5000 })
    expect((await list())?.startable.filter((d) => d.kind === 'emulator')).toEqual([])
    writeFileSync(join(marks, 'avds'), 'Pixel_9\nBroken_AVD\n')
    win.emit('focus')
    await vi.waitFor(async () => expect((await list())?.startable.filter((d) => d.kind === 'emulator').map((d) => d.id)).toEqual(['emulator:Broken_AVD', 'emulator:Pixel_9']), { timeout: 5000 })
    expect((await list())?.noAvds).toBe(false)
  })
})
```

- [ ] **Step 2: Run it and see it fail**

Run: `npx vitest run src/main/devices/ipc.start.test.ts`
Expected: both tests FAIL after their 5 s waits: `expected undefined to deeply equal [ … ]` and
`expected undefined to be true` (the list has no `startable` or `noAvds` yet).

- [ ] **Step 3: The list's new fields**

In `src/shared/types.ts`, at the end of `interface DeviceList` (after `pending`), add:

```ts
  /** What the panel can start: emulators (the AVDs the SDK's emulator lists), then simulators (the
   *  shut-down ones; macOS, with idb-companion), each by name, without those running; and those
   *  starting, or whose start failed. */
  startable: StartableDevice[]
  /** The SDK's emulator lists no AVDs: none made yet in Android Studio's Device Manager. False with
   *  no SDK emulator, and until it has answered. */
  noAvds: boolean
```

In `src/main/devices/registry.ts`, replace the doc comment and first line of `combineLists`:

```ts
/** The devices the three sources found, before ipc.ts adds what can be started. */
export type FoundDevices = Omit<DeviceList, 'startable' | 'noAvds'>

/** One list from the three sources, phones first (Android's, as adb's tracker orders them, then
 *  iPhones), then emulators, then simulators. iOS is pending while the simulators or the iPhones
 *  are. */
export function combineLists(android: AndroidState, ios: IosState, iphones: IphoneState): FoundDevices {
```

- [ ] **Step 4: Main reads the AVDs and offers them**

All in `src/main/devices/ipc.ts`.

Imports: change the adb import, and add two:

```ts
import { adbCandidates, findAdb, runAdb, sdkRoots } from './android/adb'
import { IDENTITY_SCRIPT, parseIdentity } from './android/devices'
import { findEmulator, listAvds, startableEmulators } from './android/emulators'
```

and, after `import { type AndroidState, combineLists, type IosState, type IphoneState } from './registry'`:

```ts
import { Starts } from './starts'
```

After `const simulatorSet = opts.env.DECK_SIMULATOR_SET || null`, add:

```ts
  /** The SDK's emulator, found again at each read of the AVDs; null without one. */
  let emulator: string | null = null
  /** The AVDs it listed last; null without an emulator, and until its first answer since watching
   *  started. */
  let avds: string[] | null = null
  /** The read of the AVDs under way, if any: a newer read's token replaces it. */
  let avdLook: object | null = null
  /** Emulators and simulators started from the panel, until they're listed. */
  const starts = new Starts(() => refresh())
```

Replace `update` (with its doc comment) by:

```ts
  /** The list, once some source has answered (or, with one already shown, once any source's pending
   *  flag changes): until a first list, a tab waits rather than taking "no devices" for an answer.
   *  Without `list !== null`, setting a settled source back to pending while the others are already
   *  pending would leave the old list showing instead of saying so. With it, what can be started:
   *  the AVDs and shut-down simulators not running, and the starts not listed yet. */
  const update = () => {
    if (disposed || watchers === 0 || (list === null && android.pending && ios.pending && iphones.pending)) return
    const found = combineLists(android, ios, iphones)
    starts.listed(found.devices)
    const offered = [...startableEmulators(avds ?? []), ...(simulators?.shutDown() ?? [])]
    publish({ ...found, startable: starts.merge(offered, found.devices), noAvds: avds !== null && avds.length === 0 })
  }
  /** What can be started changed: a list already out is sent again. The first list still waits for
   *  a device source (update's rule), and has what's known by then. */
  const refresh = () => {
    if (list !== null) update()
  }

  /** The AVDs the SDK's emulator lists: read at each start of watching, when Deck comes to the front
   *  (one made in Android Studio meanwhile), and after an emulator's start or stop. The newest read
   *  wins; one that fails keeps what the last one found. */
  const readAvds = async (mine: number) => {
    const look = (avdLook = {})
    try {
      const found = await findEmulator(sdkRoots(opts.env, opts.platform, opts.home), opts.platform)
      let failure: unknown = null
      const names = found
        ? await listAvds(found).catch((err: unknown) => {
            failure = err
            return null
          })
        : null
      // A stale read (watching stopped or restarted, or a newer read began) says nothing.
      if (mine !== generation || avdLook !== look) return
      if (failure) console.error('devices: listing the AVDs failed', failure)
      emulator = found
      if (!found) avds = null
      else if (names) avds = names
      refresh()
    } finally {
      if (avdLook === look) avdLook = null
    }
  }
```

In `startWatching`, after `void watchSimulators(mine)`, add `    void readAvds(mine)`.

In `stopWatching`, right after `generation++`, add:

```ts
    // A start under way goes on by itself (an emulator is detached, a simulator's boot runs in
    // CoreSimulator): the next watch lists it once it's up.
    starts.clear()
    avds = null
```

In `attach`'s focus handler, after the `watchSimulators` line, add:

```ts
        // An AVD made in Android Studio meanwhile.
        if (!avdLook) void readAvds(generation)
```

In `dispose()`, right after `disposed = true`, add `      starts.clear()`.

- [ ] **Step 5: Run the new test, then every device test**

Run: `npx vitest run src/main/devices/ipc.start.test.ts`
Expected: PASS (2 tests).

Run: `npx vitest run src/main/devices`
Expected: FAIL in `ipc.test.ts`, `ipc.watch.test.ts` and `ipc.ios.test.ts` only: their whole-list
literals lack the two new fields (`expected { devices: [], …(4) } to deeply equal …`).

- [ ] **Step 6: Give the list literals the new fields**

The one-line literals all end in `pending: [...] }`; every one of them has nothing to start (no SDK
emulator in those tests, and their simulators are booted):

```bash
perl -pi -e 's/(pending: \[[^\]]*\]) \}/$1, startable: [], noAvds: false }/g' src/main/devices/ipc.test.ts src/main/devices/ipc.watch.test.ts
grep -c "startable: \[\], noAvds: false" src/main/devices/ipc.test.ts src/main/devices/ipc.watch.test.ts
```

Expected: `ipc.test.ts:9` and `ipc.watch.test.ts:19`.

In `src/main/devices/ipc.ios.test.ts`, the multi-line literal ends:

```ts
        iosProblem: null,
        pending: [],
        startable: [],
        noAvds: false,
      })
```

In `src/renderer/src/device/pick.test.ts`, the two `list` helpers become:

```ts
  const list = (pending: ('android' | 'ios')[]): DeviceList => ({ devices: [], problem: null, iosProblem: null, pending, startable: [], noAvds: false })
```

and

```ts
  const list = (over: Partial<DeviceList> = {}): DeviceList => ({ devices: [], problem: null, iosProblem: null, pending: [], startable: [], noAvds: false, ...over })
```

- [ ] **Step 7: Run everything and the typecheck**

Run: `npx vitest run src/main/devices src/renderer/src/device && npx tsc -p tsconfig.node.json --noEmit && npx tsc -p tsconfig.web.json --noEmit`
Expected: PASS, no type errors.

- [ ] **Step 8: Commit**

```bash
git add src/shared/types.ts src/main/devices/registry.ts src/main/devices/ipc.ts src/main/devices/ipc.start.test.ts src/main/devices/ipc.test.ts src/main/devices/ipc.watch.test.ts src/main/devices/ipc.ios.test.ts src/renderer/src/device/pick.test.ts
git -c user.email=franco@effektstudios.com commit -m "Devices: the list offers the AVDs and the shut-down simulators to start"
```

---

### Task 8: `devices:start` and `devices:stop`

**Files:**
- Modify: `src/shared/types.ts` (`DeviceActionResult`, `DeckApi.devices`)
- Modify: `src/shared/channels.ts`, `src/preload/index.ts`
- Modify: `src/main/devices/ipc.ts`
- Test: `src/main/devices/ipc.start.test.ts`

- [ ] **Step 1: Write the failing tests**

In `src/main/devices/ipc.start.test.ts`, widen the type import to
`import type { DeviceActionResult, DeviceInfo, DeviceList } from '@shared/types'`, and after
`const list = () => call<DeviceList | null>(IPC.devicesList)` add:

```ts
const start = (id: unknown) => call<DeviceActionResult>(IPC.devicesStart, id)
const stop = (id: unknown) => call<DeviceActionResult>(IPC.devicesStop, id)

const PIXEL: DeviceInfo = { id: 'emulator:Pixel_9', kind: 'emulator', name: 'Pixel 9', detail: 'Emulator · Android 15', state: 'ready' }
const SIM: DeviceInfo = { id: 'simulator:FAKE-UDID', kind: 'simulator', name: 'iPhone 17', detail: 'Simulator · iOS 27.0', state: 'ready' }
```

Then append inside the `describe`, after the AVD test:

```ts
  it('starts an emulator: starting until adb lists it, then an ordinary device; Stop closes it', async () => {
    expect(await start('emulator:Pixel_9')).toBeNull()
    expect((await list())?.startable).toContainEqual({ id: 'emulator:Pixel_9', kind: 'emulator', name: 'Pixel 9', detail: 'Emulator', starting: true })
    expect(await start('emulator:Pixel_9')).toBeNull() // a second click changes nothing
    await vi.waitFor(async () => expect((await list())?.devices).toEqual([PIXEL]), { timeout: 5000 })
    expect((await list())?.startable.map((d) => d.id)).not.toContain('emulator:Pixel_9')
    expect(calls().filter((c) => c === 'emulator -avd Pixel_9')).toHaveLength(1)
    expect(await start('emulator:Pixel_9')).toBeNull() // running: nothing to do

    expect(await stop('emulator:Pixel_9')).toBeNull()
    expect(calls()).toContain('adb -s emulator-5554 emu kill')
    await vi.waitFor(async () => expect((await list())?.devices).toEqual([]), { timeout: 5000 })
    expect((await list())?.startable.map((d) => d.id)).toContain('emulator:Pixel_9')
  })

  it("boots a simulator in the private set: booting until idb's boot ends, then ready; Stop shuts it down", async () => {
    expect(await start('simulator:FAKE-UDID')).toBeNull()
    await vi.waitFor(async () => expect((await list())?.devices).toEqual([{ ...SIM, state: 'booting' }]), { timeout: 5000 })
    expect((await list())?.startable.map((d) => d.id)).not.toContain('simulator:FAKE-UDID')
    await vi.waitFor(async () => expect((await list())?.devices).toEqual([SIM]), { timeout: 5000 })
    expect(calls()).toContain(`idb --boot FAKE-UDID --device-set-path ${set} --log-level info`)

    expect(await stop('simulator:FAKE-UDID')).toBeNull()
    expect(calls()).toContain(`idb --shutdown FAKE-UDID --device-set-path ${set} --log-level info`)
    await vi.waitFor(async () => expect((await list())?.devices).toEqual([]), { timeout: 5000 })
  })

  it("a start that fails says why, and starting it again clears that (Try again)", async () => {
    expect(await start('emulator:Broken_AVD')).toBeNull()
    expect(await start('simulator:BAD-UDID')).toBeNull()
    await vi.waitFor(async () => expect((await list())?.startable).toEqual(expect.arrayContaining([
      { id: 'emulator:Broken_AVD', kind: 'emulator', name: 'Broken AVD', detail: 'Emulator', error: 'The emulator stopped (exit code 1).' },
      { id: 'simulator:BAD-UDID', kind: 'simulator', name: 'iPhone Broken', detail: 'Simulator · iOS 27.0', error: 'BAD-UDID could not be resolved to any target' },
    ])), { timeout: 5000 })
    expect(await start('emulator:Broken_AVD')).toBeNull()
    expect((await list())?.startable).toContainEqual({ id: 'emulator:Broken_AVD', kind: 'emulator', name: 'Broken AVD', detail: 'Emulator', starting: true })
  })

  it("refuses what isn't offered, and stops only a running emulator or simulator", async () => {
    for (const id of [42, 'emulator:Not_There', 'emulator:-help', 'android:8d2e61a']) expect(await start(id)).toEqual({ error: 'Deck no longer sees it.' })
    for (const id of [42, 'android:8d2e61a', 'emulator:Pixel_9', 'simulator:FAKE-UDID']) {
      expect(await stop(id)).toEqual({ error: 'Only a running emulator or simulator can be stopped.' })
    }
  })

  it('starts nothing while nothing watches', async () => {
    emit(IPC.devicesUnwatch)
    expect(await start('simulator:FAKE-UDID')).toEqual({ error: "Deck isn't looking for devices." })
    emit(IPC.devicesWatch) // for afterAll's unwatch
  })
```

- [ ] **Step 2: Run them and see them fail**

Run: `npx vitest run src/main/devices/ipc.start.test.ts`
Expected: the five new tests FAIL with `TypeError: ipc.handlers.get(...) is not a function` (there's
no `devices:start` channel yet); the first two pass.

- [ ] **Step 3: The channels and the API**

In `src/shared/channels.ts`, after `devicesCameraSettings: 'devices:camera-settings',`:

```ts
  devicesStart: 'devices:start',
  devicesStop: 'devices:stop',
```

In `src/shared/types.ts`, after `interface StartableDevice { … }`:

```ts
/** devices:start's and devices:stop's answer: null, or why not. */
export type DeviceActionResult = { error: string } | null
```

and at the end of `DeckApi.devices`, after `openCameraSettings(): void`:

```ts
    /** Starts emulator or simulator `id`, one of the list's `startable`: null once it's starting (the
     *  list then says how it goes; one already running answers null too), or why it can't be. */
    start(id: string): Promise<DeviceActionResult>
    /** Stops running emulator or simulator `id`: null once it's stopping (an emulator once it was
     *  told to, a simulator once it has shut down), or why not. */
    stop(id: string): Promise<DeviceActionResult>
```

In `src/preload/index.ts`, after `openCameraSettings: () => ipcRenderer.send(IPC.devicesCameraSettings),`:

```ts
    start: (id) => ipcRenderer.invoke(IPC.devicesStart, id),
    stop: (id) => ipcRenderer.invoke(IPC.devicesStop, id),
```

- [ ] **Step 4: Main starts and stops**

All in `src/main/devices/ipc.ts`.

Imports become:

```ts
import type { DeviceActionResult, DeviceList, DeviceProject, InsertResult, Platform } from '@shared/types'
```

```ts
import { findEmulator, killEmulator, listAvds, startableEmulators, startAvd } from './android/emulators'
```

and, after `import { AndroidTracker } from './android/tracker'`:

```ts
import { bootSimulator, shutdownSimulator } from './ios/boot'
```

After `const starts = new Starts(() => refresh())`, add:

```ts
  /** Simulators Deck is booting. The notifier says "Booted" as soon as a boot begins (19 s before it
   *  had finished, on a first boot), so each is listed as booting until idb's boot command ends. */
  const booting = new Set<string>()
  /** Ends the boots and shutdowns under way when Deck quits. */
  const quitting = new AbortController()
```

In `update`, replace `    const found = combineLists(android, ios, iphones)` by:

```ts
    const simulatorDevices = ios.devices.map((d) => (booting.has(d.id) ? { ...d, state: 'booting' as const } : d))
    const found = combineLists(android, { ...ios, devices: simulatorDevices }, iphones)
```

After the `ipcMain.on(IPC.devicesCameraSettings, …)` block, add:

```ts
  // Only what the list offers can be started, and only a listed emulator or simulator stopped: the
  // ids come from adb's, the emulator's and idb's own lists, checked where they're read.
  ipcMain.handle(IPC.devicesStart, (_e, id: unknown): DeviceActionResult => {
    if (!list) return { error: "Deck isn't looking for devices." }
    // Started some other way meanwhile: the pick shows it.
    if (list.devices.some((d) => d.id === id)) return null
    const device = list.startable.find((d) => d.id === id)
    if (!device) return { error: 'Deck no longer sees it.' }
    const fail = starts.begin(device)
    if (!fail) return null // already starting
    refresh()
    const failWith = (err: unknown) => fail(err instanceof Error ? err.message : String(err))
    if (device.kind === 'emulator') {
      if (!emulator) fail("Deck can't find Android's emulator.")
      else startAvd(emulator, device.id.slice('emulator:'.length), fail).then(() => void readAvds(generation), failWith)
      return null
    }
    const udid = udidOf(device.id)
    if (!idb || !udid) {
      fail("Deck can't find idb-companion.")
      return null
    }
    booting.add(device.id)
    bootSimulator(idb.companion, udid, { set: simulatorSet, signal: quitting.signal })
      .catch((err: unknown) => {
        if (!quitting.signal.aborted) failWith(err)
      })
      .finally(() => {
        booting.delete(device.id)
        refresh()
      })
    return null
  })
  ipcMain.handle(IPC.devicesStop, async (_e, id: unknown): Promise<DeviceActionResult> => {
    const device = typeof id === 'string' ? list?.devices.find((d) => d.id === id) : undefined
    if (!device || (device.kind !== 'emulator' && device.kind !== 'simulator')) return { error: 'Only a running emulator or simulator can be stopped.' }
    try {
      if (device.kind === 'emulator') {
        const serial = tracker?.serialFor(device.id)
        if (!adb || !serial) return { error: "adb doesn't list it." }
        await killEmulator(adb, serial)
        void readAvds(generation)
        return null
      }
      const udid = udidOf(device.id)
      if (!idb || !udid) return { error: "Deck can't find idb-companion." }
      await shutdownSimulator(idb.companion, udid, { set: simulatorSet, signal: quitting.signal })
      return null
    } catch (err) {
      return { error: err instanceof Error ? err.message : String(err) }
    }
  })
```

In `dispose()`, right after `disposed = true`, add `      quitting.abort()` (before `starts.clear()`).

- [ ] **Step 5: Run them and see them pass**

Run: `npx vitest run src/main/devices/ipc.start.test.ts` (three times: it drives real processes)
Expected: PASS (7 tests) each time.

Run: `npx vitest run src/main && npm run typecheck`
Expected: PASS, no type errors.

- [ ] **Step 6: Commit**

```bash
git add src/shared/types.ts src/shared/channels.ts src/preload/index.ts src/main/devices/ipc.ts src/main/devices/ipc.start.test.ts
git -c user.email=franco@effektstudios.com commit -m "Devices: devices:start and devices:stop, for emulators and simulators"
```

---

### Task 9: A started device is the tab's view until it's listed

**Files:**
- Modify: `src/renderer/src/device/pick.ts`
- Test: `src/renderer/src/device/pick.test.ts`

- [ ] **Step 1: Write the failing tests**

In `src/renderer/src/device/pick.test.ts`:

The imports become:

```ts
import type { DeviceInfo, DeviceList, DeviceProject, StartableDevice } from '@shared/types'
import { choosePanel, GONE_MS, MAX_START_BUTTONS, menuOrder, panelRules, panelView, startButtons, stillLooking } from './pick'
```

After `const iphone: DeviceInfo = …`, add:

```ts
const avd: StartableDevice = { id: 'emulator:Pixel_9', kind: 'emulator', name: 'Pixel 9', detail: 'Emulator' }
const shutSim: StartableDevice = { id: 'simulator:U2', kind: 'simulator', name: 'iPhone 17 Pro', detail: 'Simulator · iOS 27.0' }
```

In `describe('choosePanel', …)`, `base` gains what can be started:

```ts
  const base = { tab: undefined, project: [] as string[], android: true, ios: false, byHand: false, startable: [] as StartableDevice[] }
```

Before `describe('menuOrder', …)`, add:

```ts
describe('choosePanel: devices started from the panel', () => {
  const base = { tab: undefined, project: [] as string[], android: true, ios: false, byHand: false, devices: [c66] }
  const starting = { ...avd, starting: true }

  it("shows the tab's or the project's pick as starting until it's listed, rather than another device", () => {
    expect(choosePanel({ ...base, tab: avd.id, project: [c66.id], startable: [starting] })).toEqual({ kind: 'starting', device: starting })
    expect(choosePanel({ ...base, project: [avd.id, c66.id], startable: [starting] })).toEqual({ kind: 'starting', device: starting })
    expect(choosePanel({ ...base, tab: avd.id, devices: [c66, emu], startable: [] })).toEqual({ kind: 'device', device: emu })
  })

  it('shows why a start failed, until it is started again or picked away', () => {
    const failed = { ...avd, error: "It didn't start within 3 minutes." }
    expect(choosePanel({ ...base, tab: avd.id, startable: [failed] })).toEqual({ kind: 'starting', device: failed })
  })

  it('a pick that is only startable (not started) counts as not connected', () => {
    expect(choosePanel({ ...base, project: [avd.id, c66.id], startable: [avd] })).toEqual({ kind: 'device', device: c66 })
    expect(choosePanel({ ...base, tab: avd.id, startable: [avd] })).toEqual({ kind: 'none' })
  })
})
```

Inside `describe('menuOrder', …)`, after its test, add:

```ts
  it('orders what can be started the same way', () => {
    expect(menuOrder([avd, shutSim], { android: false, ios: true })).toEqual([shutSim, avd])
  })
```

After `describe('menuOrder', …)`, add:

```ts
describe('startButtons', () => {
  const avds = ['A', 'B', 'C', 'D'].map((n): StartableDevice => ({ id: `emulator:${n}`, kind: 'emulator', name: n, detail: 'Emulator' }))

  it('offers up to 3 that fit the tab, and says when the menu has more', () => {
    expect(MAX_START_BUTTONS).toBe(3)
    expect(startButtons([...avds, shutSim], { android: true, ios: false }, null)).toEqual({ buttons: avds.slice(0, 3), more: true })
    expect(startButtons([avds[0], shutSim], { android: false, ios: true }, null)).toEqual({ buttons: [shutSim], more: false })
    expect(startButtons([avds[0], shutSim], { android: true, ios: true }, null)).toEqual({ buttons: [avds[0], shutSim], more: false })
  })

  it("puts the tab's device first, even one that doesn't fit the project", () => {
    expect(startButtons([...avds, shutSim], { android: true, ios: false }, avds[3].id).buttons).toEqual([avds[3], avds[0], avds[1]])
    expect(startButtons([avds[0], shutSim], { android: false, ios: true }, avds[0].id).buttons).toEqual([avds[0], shutSim])
  })

  it('leaves out one already starting, and offers one that failed (to try again)', () => {
    const failed = { ...avds[1], error: 'The emulator stopped (exit code 1).' }
    expect(startButtons([{ ...avds[0], starting: true }, failed], { android: true, ios: false }, null)).toEqual({ buttons: [failed], more: false })
  })
})
```

In `describe('panelView', …)`, before `it('a device shown alone stays shown when a second one arrives to choose from', …`:

```ts
  it('a start shows at once, even of the device whose disconnected hold is running (stopped, then started again)', () => {
    const emuShown = panelView({ kind: 'device', device: emu }, [emu], null, 0, emu.id)
    const gone = panelView({ kind: 'none' }, [], emuShown.held, 100, emu.id)
    expect(gone.view).toEqual({ kind: 'device', device: emu, gone: true })
    const again = { id: emu.id, kind: 'emulator' as const, name: 'Pixel 9', detail: 'Emulator', starting: true }
    expect(panelView({ kind: 'starting', device: again }, [], gone.held, 200, emu.id)).toEqual({ view: { kind: 'starting', device: again }, held: null })
  })
```

In `describe('panelRules', …)`, before `it('View → Device Panel hidden (tabHidden === true) wins: …`:

```ts
  it("stays open while the tab's device (its pick, else the project's latest) can be started", () => {
    const listed = list({ devices: [], startable: [avd, shutSim] })
    expect(panelRules({ ...base, project: androidApp, tabDevice: avd.id, list: listed, platform: 'darwin' })).toMatchObject({ choice: { kind: 'none' }, startPick: true })
    expect(panelRules({ ...base, project: { ...androidApp, picks: [avd.id] }, list: listed, platform: 'darwin' }).startPick).toBe(true)
    // An unplugged phone can't be started; nothing picked, nothing to keep open for.
    expect(panelRules({ ...base, project: { ...androidApp, picks: [c66.id] }, list: listed, platform: 'darwin' }).startPick).toBe(false)
    expect(panelRules({ ...base, project: androidApp, list: listed, platform: 'darwin' }).startPick).toBe(false)
    // Not before the list is in.
    expect(panelRules({ ...base, project: androidApp, tabDevice: avd.id, list: null, platform: 'darwin' }).startPick).toBe(false)
  })

  it("passes what's starting to choosePanel: the tab's started pick shows as starting", () => {
    const starting = { ...avd, starting: true }
    const rules = panelRules({ ...base, project: androidApp, tabDevice: avd.id, list: list({ devices: [c66], startable: [starting] }), platform: 'darwin' })
    expect(rules.choice).toEqual({ kind: 'starting', device: starting })
  })
```

- [ ] **Step 2: Run them and see them fail**

Run: `npx vitest run src/renderer/src/device/pick.test.ts`
Expected: FAIL: `TypeError: startButtons is not a function`, the `choosePanel` starting tests (got
`none` or another device), the `panelView` test (got the disconnected hold), and `startPick`
(`undefined`).

- [ ] **Step 3: Implement**

In `src/renderer/src/device/pick.ts`:

The import and `PanelChoice`:

```ts
import type { DeviceInfo, DeviceList, DevicePlatform, DeviceProject, Platform, StartableDevice } from '@shared/types'

export type PanelChoice =
  | { kind: 'device'; device: DeviceInfo }
  /** Started from the panel and not listed yet: "Starting …", or why it didn't. */
  | { kind: 'starting'; device: StartableDevice }
  | { kind: 'choose'; devices: DeviceInfo[] }
  | { kind: 'none' }
```

At the end of `interface ChoiceInput`, after `devices: DeviceInfo[]`:

```ts
  /** What can be started, with the starts under way or failed (`DeviceList.startable`). */
  startable: StartableDevice[]
```

Replace `fits`, and `choosePanel`'s doc comment and first three lines (down to
`if (picked) return { kind: 'device', device: picked }`), by:

```ts
/** The project is an app for the device's platform. */
const fits = (device: { kind: DeviceInfo['kind'] }, project: { android: boolean; ios: boolean }) => project[platformOf(device.kind)]

/** The device a tab's panel shows: its own pick, else the latest of its project's picks that's
 *  connected, or that was started from the panel and isn't listed yet (it shows as starting, or why
 *  it didn't start, rather than the tab falling back to another device meanwhile). Nothing picked
 *  yet, the only device that fits an app for its platform (phones and emulators an Android one,
 *  simulators and iPhones an iOS one); with several the panel asks. Once something has been picked, a
 *  device the project never picked doesn't open the panel (the C66's project doesn't open on the S25
 *  meanwhile), unless it was asked for. With none there's no panel. */
export function choosePanel({ tab, project, android, ios, byHand, devices, startable }: ChoiceInput): PanelChoice {
  const find = (id: string | undefined): PanelChoice | undefined => {
    if (!id) return undefined
    const device = devices.find((d) => d.id === id)
    if (device) return { kind: 'device', device }
    const start = startable.find((d) => d.id === id && (d.starting || d.error !== undefined))
    return start ? { kind: 'starting', device: start } : undefined
  }
  const picked = find(tab) ?? project.map(find).find((c) => c !== undefined)
  if (picked) return picked
```

Replace `menuOrder` (with its doc comment) by:

```ts
/** The menu's order: the devices (or what can be started) that fit the project first, then the
 *  others, each as listed. */
export function menuOrder<T extends { kind: DeviceInfo['kind'] }>(devices: T[], project: { android: boolean; ios: boolean }): T[] {
  return [...devices.filter((d) => fits(d, project)), ...devices.filter((d) => !fits(d, project))]
}

/** At most this many Start buttons in an empty panel; the rest are in the ▾ menu. */
export const MAX_START_BUTTONS = 3

/** What an empty panel offers to start: the tab's device (`pick`) first when it can be started, then
 *  those that fit the tab (emulators where Android devices do, simulators where iOS ones do), none
 *  starting already, up to 3; `more` when the menu has more. */
export function startButtons(startable: StartableDevice[], wants: { android: boolean; ios: boolean }, pick: string | null): { buttons: StartableDevice[]; more: boolean } {
  const offered = startable.filter((d) => !d.starting && (d.id === pick || fits(d, wants)))
  const ordered = [...offered.filter((d) => d.id === pick), ...offered.filter((d) => d.id !== pick)]
  return { buttons: ordered.slice(0, MAX_START_BUTTONS), more: ordered.length > MAX_START_BUTTONS }
}
```

Replace `PanelRules` (with its doc comment) by:

```ts
/** What App.tsx needs back from `panelRules`: whether main should be asked to watch for devices
 *  (`devicesNeeded` again, now that the list it gates is known), the panel was asked for by hand, the
 *  project's own apps, what the panel speaks of when it has nothing, whether a kind the tab may show
 *  is still being looked for, the device to show (a choice, or none), whether a booted simulator
 *  Deck can't show should open the panel anyway, and whether the tab's device can be started (the
 *  panel stays, to start it). */
export interface PanelRules {
  needed: boolean
  byHand: boolean
  apps: { android: boolean; ios: boolean }
  wants: { android: boolean; ios: boolean }
  looking: boolean
  choice: PanelChoice | null
  iosHint: boolean
  startPick: boolean
}
```

In `panelRules`, pass what can be started to `choosePanel`:

```ts
    ? choosePanel({ tab: tabDevice, project: project?.picks ?? [], ...apps, byHand, devices: list.devices, startable: list.startable })
```

and replace its last line, `  return { needed, byHand, apps, wants, looking, choice, iosHint }`, by:

```ts
  // The tab's device (its own pick, else the project's latest) is an emulator or a simulator that
  // isn't running: the panel stays open with its Start button, as it doesn't for an unplugged phone.
  // So a Stop leaves a way to start it again, and a project whose simulator is shut down offers it.
  const pick = tabDevice ?? project?.picks[0]
  const startPick = choice !== null && pick !== undefined && (list?.startable.some((d) => d.id === pick) ?? false)
  return { needed, byHand, apps, wants, looking, choice, iosHint, startPick }
```

`PanelView` gains the starting view:

```ts
export type PanelView =
  | { kind: 'device'; device: DeviceInfo; gone: boolean }
  | { kind: 'starting'; device: StartableDevice }
  | { kind: 'choose'; devices: DeviceInfo[] }
  | { kind: 'none' }
```

and `panelView` starts with:

```ts
export function panelView(choice: PanelChoice, devices: DeviceInfo[], held: Held | null, now: number, pick: string | null): { view: PanelView; held: Held | null } {
  // Started again right after a stop, with the same pick: "Starting …" at once, not the stopped
  // device's "disconnected" hold.
  if (choice.kind === 'starting') return { view: choice, held: null }
  if (held && held.pick === pick) {
```

- [ ] **Step 4: Run them and see them pass**

Run: `npx vitest run src/renderer/src/device && npm run typecheck`
Expected: PASS, no type errors (the panel doesn't draw the starting view yet: Task 11).

- [ ] **Step 5: Commit**

```bash
git add src/renderer/src/device/pick.ts src/renderer/src/device/pick.test.ts
git -c user.email=franco@effektstudios.com commit -m "Device panel: a device started from the panel is the tab's view until it's listed"
```

---

### Task 10: The menu's items

**Files:**
- Create: `src/renderer/src/device/menu.ts`
- Test: `src/renderer/src/device/menu.test.ts`

- [ ] **Step 1: Write the failing test**

Create `src/renderer/src/device/menu.test.ts`:

```ts
import { describe, expect, it } from 'vitest'
import type { DeviceInfo, StartableDevice } from '@shared/types'
import { menuEntries, startHint } from './menu'

const c66: DeviceInfo = { id: 'android:8d2e61a', kind: 'android', name: 'C66', detail: 'Android 13 · USB', state: 'ready' }
const emu: DeviceInfo = { id: 'emulator:Pixel_9', kind: 'emulator', name: 'Pixel 9', detail: 'Emulator · Android 15', state: 'ready' }
const sim: DeviceInfo = { id: 'simulator:U1', kind: 'simulator', name: 'iPhone 17', detail: 'Simulator · iOS 27.0', state: 'ready' }
const iphone: DeviceInfo = { id: 'iphone:C1', kind: 'iphone', name: "Franco's iPhone", detail: 'iPhone · cable · view only', state: 'ready' }
const avd: StartableDevice = { id: 'emulator:Medium_Phone', kind: 'emulator', name: 'Medium Phone', detail: 'Emulator' }
const shutSim: StartableDevice = { id: 'simulator:U2', kind: 'simulator', name: 'iPhone 17 Pro', detail: 'Simulator · iOS 27.0' }

describe('menuEntries', () => {
  it('lists the devices, then what can be started, then Stop for an emulator or simulator on screen', () => {
    expect(menuEntries([c66, emu], [avd, shutSim], emu).map((e) => e.key)).toEqual([
      'device:android:8d2e61a',
      'device:emulator:Pixel_9',
      'start:emulator:Medium_Phone',
      'start:simulator:U2',
      'stop',
    ])
    expect(menuEntries([sim], [], sim).at(-1)).toEqual({ key: 'stop', type: 'stop', device: sim })
  })

  it('has no Stop for a phone or an iPhone, nor with nothing on screen', () => {
    expect(menuEntries([c66], [avd], c66).map((e) => e.type)).toEqual(['device', 'start'])
    expect(menuEntries([iphone], [], iphone).map((e) => e.type)).toEqual(['device'])
    expect(menuEntries([emu], [], null).map((e) => e.type)).toEqual(['device'])
  })
})

describe('startHint', () => {
  it('says starting, that it failed, or what it is', () => {
    expect(startHint({ ...avd, starting: true })).toBe('starting…')
    expect(startHint({ ...avd, error: 'The emulator stopped (exit code 1).' })).toBe("didn't start")
    expect(startHint(shutSim)).toBe('Simulator · iOS 27.0')
  })
})
```

- [ ] **Step 2: Run it and see it fail**

Run: `npx vitest run src/renderer/src/device/menu.test.ts`
Expected: FAIL with `Error: Cannot find module './menu'`.

- [ ] **Step 3: Implement**

Create `src/renderer/src/device/menu.ts`:

```ts
import type { DeviceInfo, StartableDevice } from '@shared/types'

/** One item of the ▾ menu: a device to show, one to start, or Stop for the device on screen. */
export type MenuEntry =
  | { key: string; type: 'device'; device: DeviceInfo }
  | { key: string; type: 'start'; device: StartableDevice }
  | { key: string; type: 'stop'; device: DeviceInfo }

/** The ▾ menu's items, top to bottom: the devices, what can be started, then Stop when the device on
 *  screen (`shown`: listed, not gone; null otherwise) is an emulator or a simulator. Phones and
 *  iPhones have no Stop. Each key is unique, so the keyboard's place survives the list changing
 *  under it. */
export function menuEntries(devices: DeviceInfo[], startable: StartableDevice[], shown: DeviceInfo | null): MenuEntry[] {
  const entries: MenuEntry[] = [
    ...devices.map((device): MenuEntry => ({ key: `device:${device.id}`, type: 'device', device })),
    ...startable.map((device): MenuEntry => ({ key: `start:${device.id}`, type: 'start', device })),
  ]
  if (shown && (shown.kind === 'emulator' || shown.kind === 'simulator')) entries.push({ key: 'stop', type: 'stop', device: shown })
  return entries
}

/** What a Start item says beside its name: starting, that its start failed, or what it is. */
export const startHint = (device: StartableDevice): string =>
  device.starting ? 'starting…' : device.error !== undefined ? "didn't start" : device.detail
```

- [ ] **Step 4: Run it and see it pass**

Run: `npx vitest run src/renderer/src/device/menu.test.ts`
Expected: PASS (3 tests).

- [ ] **Step 5: Commit**

```bash
git add src/renderer/src/device/menu.ts src/renderer/src/device/menu.test.ts
git -c user.email=franco@effektstudios.com commit -m "Device panel: the menu's items, with Start and Stop"
```

---

### Task 11: Start and Stop in the panel

The menu gets its Start section and Stop; the panel shows a starting device, starts and stops, says
when that couldn't be done, and offers Start buttons when it's empty; App keeps it shown for a tab
whose device can be started. No unit tests reach the components (the repo tests none): the checks
are the typecheck, the build, and Task 13.

**Files:**
- Modify: `src/renderer/src/device/DeviceMenu.tsx` (whole file)
- Modify: `src/renderer/src/device/DevicePanel.tsx` (whole file)
- Modify: `src/renderer/src/App.tsx`
- Modify: `src/renderer/src/device/device.css`

- [ ] **Step 1: The menu**

Replace `src/renderer/src/device/DeviceMenu.tsx` with:

```tsx
import { type KeyboardEvent, type ReactNode, useEffect, useLayoutEffect, useRef, useState } from 'react'
import { createPortal } from 'react-dom'
import type { DeviceInfo, StartableDevice } from '@shared/types'
import { placeBelow } from '../claude/SessionPicker'
import { type MenuEntry, menuEntries, startHint } from './menu'

interface DeviceMenuProps {
  devices: DeviceInfo[]
  /** What can be started, those that fit the tab first. */
  startable: StartableDevice[]
  /** Say the SDK has no AVDs (only where emulators fit the tab). */
  noAvds: boolean
  /** The device shown now (or starting). */
  current: string | null
  /** The device on screen, listed and not gone, for Stop; null otherwise. */
  shown: DeviceInfo | null
  /** The button it hangs from. */
  anchor: HTMLElement
  onPick(id: string): void
  onStart(device: StartableDevice): void
  onStop(device: DeviceInfo): void
  /** How it closed: `back` (Esc, a choice: the keyboard goes back where it was), `tab` (to the button,
   *  and the browser's Tab moves on from there), `leave` (a click elsewhere, a blur, a resize). */
  onClose(how: MenuClose): void
}

export type MenuClose = 'back' | 'tab' | 'leave'

const STATE_WORDS: Record<DeviceInfo['state'], string> = { ready: '', booting: 'starting', connecting: 'connecting', unauthorized: 'not allowed yet', offline: 'offline' }

/** Which device the tab shows, from every device Deck sees; what can be started; and Stop for an
 *  emulator or a simulator on screen. Rendered into <body> like the session menu. */
export function DeviceMenu({ devices, startable, noAvds, current, shown, anchor, onPick, onStart, onStop, onClose }: DeviceMenuProps) {
  const entries = menuEntries(devices, startable, shown)
  // The cursor is an item, not a place in the list, which can change under it (one unplugged).
  const [cursor, setCursor] = useState<string | null>(() => (current ? `device:${current}` : (entries[0]?.key ?? null)))
  // Placed once: the menu closes when the window resizes.
  const [place] = useState(() => placeBelow(anchor))
  const menuRef = useRef<HTMLDivElement>(null)

  useLayoutEffect(() => {
    menuRef.current?.focus()
  }, [])

  useEffect(() => {
    const onPointerDown = (e: PointerEvent) => {
      const t = e.target as Node | null
      if (t && (menuRef.current?.contains(t) || anchor.contains(t))) return // the button toggles by itself
      onClose('leave')
    }
    const close = () => onClose('leave')
    document.addEventListener('pointerdown', onPointerDown, true)
    window.addEventListener('blur', close)
    window.addEventListener('resize', close)
    return () => {
      document.removeEventListener('pointerdown', onPointerDown, true)
      window.removeEventListener('blur', close)
      window.removeEventListener('resize', close)
    }
  }, [anchor, onClose])

  const at = Math.max(0, entries.findIndex((e) => e.key === cursor))
  const move = (i: number) => setCursor(entries[Math.min(Math.max(i, 0), entries.length - 1)]?.key ?? null)
  // Choosing the device shown picks it too: shown as the only one that fits, it becomes the tab's and
  // the project's device. Choosing one to start picks it as well (DevicePanel's start).
  const choose = (entry: MenuEntry | undefined) => {
    if (entry?.type === 'device') onPick(entry.device.id)
    else if (entry?.type === 'start') onStart(entry.device)
    else if (entry?.type === 'stop') onStop(entry.device)
    onClose('back')
  }
  const onKeyDown = (e: KeyboardEvent<HTMLDivElement>) => {
    switch (e.key) {
      case 'Escape':
        e.stopPropagation()
        onClose('back')
        break
      case 'ArrowDown':
        move(at + 1)
        break
      case 'ArrowUp':
        move(at - 1)
        break
      case 'Home':
        move(0)
        break
      case 'End':
        move(entries.length - 1)
        break
      case 'Enter':
        choose(entries[at])
        break
      case 'Tab':
        // The button takes the keyboard now, and the browser's own Tab moves on from there.
        onClose('tab')
        return
      default:
        return
    }
    e.preventDefault()
  }

  const row = (entry: MenuEntry, i: number): ReactNode => {
    const className = `cpm-item${i === at ? ' cursor' : ''}`
    const hover = () => entry.key !== cursor && setCursor(entry.key)
    if (entry.type === 'device') {
      const { device } = entry
      const checked = device.id === current
      const word = STATE_WORDS[device.state]
      return (
        <div key={entry.key} role="menuitemradio" aria-checked={checked} className={className}
          title={`${device.name}\n${device.detail}${word ? ` · ${word}` : ''}`} onMouseMove={hover} onClick={() => choose(entry)}>
          <span className="cpm-check" aria-hidden="true">{checked ? '✓' : ''}</span>
          <span className="cpm-label">{device.name}</span>
          <span className="cpm-hint">{word || device.detail}</span>
        </div>
      )
    }
    if (entry.type === 'start') {
      const { device } = entry
      return (
        <div key={entry.key} role="menuitem" className={className} title={`Start ${device.name}\n${device.error ?? device.detail}`}
          onMouseMove={hover} onClick={() => choose(entry)}>
          <span className="cpm-check" aria-hidden="true">▶</span>
          <span className="cpm-label">{device.name}</span>
          <span className="cpm-hint">{startHint(device)}</span>
        </div>
      )
    }
    return (
      <div key={entry.key} role="menuitem" className={className} onMouseMove={hover} onClick={() => choose(entry)}>
        <span className="cpm-check" aria-hidden="true" />
        <span className="cpm-label">Stop {entry.device.name}</span>
      </div>
    )
  }

  return createPortal(
    <div className="cp-menu" ref={menuRef} role="menu" aria-label="Device to show" tabIndex={-1} style={place} onKeyDown={onKeyDown}>
      <div className="cpm-title">Devices</div>
      <div className="cpm-list">
        {entries.map((entry, i) => entry.type === 'device' && row(entry, i))}
        {devices.length === 0 && <div className="cpm-note">No devices connected.</div>}
        {(startable.length > 0 || noAvds) && <div className="cpm-title">Start</div>}
        {entries.map((entry, i) => entry.type === 'start' && row(entry, i))}
        {noAvds && <div className="cpm-note">No emulators: make one in Android Studio's Device Manager</div>}
        {entries.at(-1)?.type === 'stop' && <div className="cpm-sep" />}
        {entries.map((entry, i) => entry.type === 'stop' && row(entry, i))}
      </div>
    </div>,
    document.body,
  )
}
```

- [ ] **Step 2: The panel**

Replace `src/renderer/src/device/DevicePanel.tsx` with (Task 5's booting message and spinner are in
it):

```tsx
import { Component, type ErrorInfo, type MouseEvent, type ReactNode, useCallback, useEffect, useLayoutEffect, useRef, useState } from 'react'
import type { DeviceInfo, DeviceList, StartableDevice } from '@shared/types'
import { errorText } from '../git/format'
import { BackIcon, CameraIcon, Caret, HomeIcon, PowerIcon, RecentsIcon } from '../icons'
import { DeviceMenu, type MenuClose } from './DeviceMenu'
import { DeviceScreen, type ScreenHandle } from './DeviceScreen'
import { KEYCODE } from './keys'
import { type PanelView, startButtons } from './pick'
import '../claude/panel.css'
import './device.css'

interface DevicePanelProps {
  /** A device (maybe gone for now), the devices to choose from, or none: the panel was asked for. */
  view: PanelView
  /** Every device Deck sees, for the menu, those that fit first. */
  devices: DeviceInfo[]
  /** What can be started, those that fit first (DeviceList.startable). */
  startable: StartableDevice[]
  /** The SDK's emulator lists no AVDs. */
  noAvds: boolean
  /** The tab's device (its own pick, else the project's latest): its Start button comes first. */
  pick: string | null
  problem: DeviceList['problem']
  /** Why simulators can't be listed (macOS). */
  iosProblem: DeviceList['iosProblem']
  /** The kinds of device the tab shows, for what to say with none. */
  wants: { android: boolean; ios: boolean }
  /** adb or idb-companion still finding their first devices the tab may show. */
  looking: boolean
  /** Unfolded: one flag for the window, so every tab's panel folds together. */
  open: boolean
  onToggle(): void
  /** The tab is in front and the window can be seen: the screen may stream. */
  visible: boolean
  /** Claude runs in the tab: the screenshot button shows. */
  claudeRuns: boolean
  onPick(id: string): void
  /** Types text into the tab's terminal: the screenshot's path. */
  onInsert(text: string): void
  /** A device was chosen from the keyboard and its button went with the chooser: the tab gives the
   *  keyboard to its terminal. */
  onFocusLost(): void
}

/** Clicks in the header and the chooser leave the keyboard where it was. (The device menu takes it
 *  itself, and gives it back to its button.) */
const keepFocus = (e: MouseEvent) => e.preventDefault()

/** A device's screen at the top of the right pane: a header (fold, the device menu, the device's
 *  buttons, the screenshot), then the screen, a choice of devices, or why there's none. A thrown
 *  render costs the panel only. */
export function DevicePanel(props: DevicePanelProps) {
  const shown = props.view.kind === 'device' || props.view.kind === 'starting' ? props.view.device.id : props.view.kind
  return (
    <Boundary resetKey={shown}>
      <PanelBody {...props} />
    </Boundary>
  )
}

function PanelBody({ view, devices, startable, noAvds, pick, problem, iosProblem, wants, looking, open, onToggle, visible, claudeRuns, onPick, onInsert, onFocusLost }: DevicePanelProps) {
  const [menuAnchor, setMenuAnchor] = useState<HTMLElement | null>(null)
  /** A screenshot that failed, and the device it was of. */
  const [error, setError] = useState<{ device: string; text: string } | null>(null)
  const [busy, setBusy] = useState(false)
  const screen = useRef<ScreenHandle>(null)
  const deviceButton = useRef<HTMLButtonElement>(null)
  /** Where the keyboard was when the menu opened: the terminal for a click, the button from the keyboard. */
  const returnTo = useRef<Element | null>(null)
  /** The menu closed and the keyboard has to be put back, once it's gone (below). */
  const putBack = useRef<MenuClose | null>(null)
  const closeMenu = useCallback((how: MenuClose) => {
    setMenuAnchor(null)
    // Tab moves on from the button, so the button takes the keyboard before the browser's Tab does.
    if (how === 'tab') deviceButton.current?.focus()
    else putBack.current = how
  }, [])
  // Once the menu is gone, and a device it chose has taken the screen's place, the keyboard goes back
  // where it was when the menu opened if that's still there (not a screen that went with its device),
  // else to the button. After a click elsewhere, what was clicked keeps it if it took it.
  useLayoutEffect(() => {
    const how = putBack.current
    if (menuAnchor || !how) return
    putBack.current = null
    const focused = document.activeElement
    if (how === 'leave' && focused && focused !== document.body) return
    const back = returnTo.current
    if (back instanceof HTMLElement && back.isConnected && back !== document.body) back.focus()
    else deviceButton.current?.focus()
  })
  useEffect(() => {
    if (!visible) setMenuAnchor(null) // it lives in <body>, outside the hidden tab
  }, [visible])

  const device = view.kind === 'device' ? view.device : null
  const starting = view.kind === 'starting' ? view.device : null
  const gone = view.kind === 'device' && view.gone
  const ready = device !== null && device.state === 'ready' && !gone
  // A failed screenshot's error goes with its device, and with Claude.
  useEffect(() => {
    setError(null)
  }, [device?.id, claudeRuns])
  // A start or stop that couldn't be done says so while the panel shows what it showed when the
  // answer came (for a refused start, whatever the pick fell back to).
  const viewKey = device?.id ?? starting?.id ?? view.kind
  const viewNow = useRef(viewKey)
  useLayoutEffect(() => {
    viewNow.current = viewKey
  })
  const [actionError, setActionError] = useState<{ view: string; text: string } | null>(null)
  const say = (text: string) => setActionError({ view: viewNow.current, text })
  // Choosing one to start picks it for the tab and the project, as choosing a connected device does;
  // the list then says how the start goes.
  const start = (item: StartableDevice) => {
    setActionError(null)
    onPick(item.id)
    window.deck.devices.start(item.id).then(
      (result) => {
        if (result) say(`Couldn't start ${item.name}: ${result.error}`)
      },
      (err: unknown) => say(`Couldn't start ${item.name}: ${errorText(err)}`),
    )
  }
  const stop = (target: DeviceInfo) => {
    setActionError(null)
    window.deck.devices.stop(target.id).then(
      (result) => {
        if (result) say(`Couldn't stop ${target.name}: ${result.error}`)
      },
      (err: unknown) => say(`Couldn't stop ${target.name}: ${errorText(err)}`),
    )
  }
  const shownActionError = actionError && actionError.view === viewKey ? actionError.text : null
  let message: string | null = null
  if (device && gone) message = `${device.name} disconnected`
  else if (device?.state === 'booting') message = `Starting ${device.name}…`
  else if (device?.state === 'unauthorized') message = `Allow USB debugging on ${device.name}: check its screen.`
  else if (device?.state === 'offline') message = `${device.name} isn't answering. Unplug it and plug it back in.`
  else if (device?.state === 'connecting') message = `${device.name} is connecting…`

  const press = (keycode: number) => {
    if (device) window.deck.devices.input(device.id, { type: 'key', keycode, meta: 0 })
  }
  const screenshot = async () => {
    if (!device || busy) return
    const of = device.id
    setBusy(true)
    setError(null)
    try {
      const png = await screen.current?.screenshot()
      if (!png) throw new Error("There's no live picture to add yet.")
      const result = await window.deck.devices.screenshot(png)
      if ('text' in result) onInsert(result.text)
      else setError({ device: of, text: result.error })
    } catch (err) {
      setError({ device: of, text: errorText(err) })
    } finally {
      setBusy(false)
    }
  }
  // An error belongs to its device's screenshot button: it goes when the device or Claude does.
  const shownError = error && error.device === device?.id && claudeRuns ? error.text : null

  const title = device?.name ?? starting?.name ?? (view.kind === 'choose' ? 'Choose a device' : 'Devices')
  return (
    <div className={open ? 'device-panel' : 'device-panel folded'}>
      <header className="dp-head" onMouseDown={keepFocus}>
        <button className="cp-section-head dp-fold" aria-expanded={open} aria-label="Device panel"
          title={open ? 'Fold the device panel' : 'Unfold the device panel'} onClick={onToggle}>
          <Caret />
        </button>
        <button ref={deviceButton} className="dp-device" aria-haspopup="menu" aria-expanded={menuAnchor !== null} title="The device this tab shows"
          onClick={(e) => {
            if (menuAnchor) return closeMenu('back')
            returnTo.current = document.activeElement
            setMenuAnchor(e.currentTarget)
          }}>
          <span className="dp-name">{title}</span>
          <Chevron />
        </button>
        {device && <span className={gone ? 'dp-detail gone' : 'dp-detail'}>{gone ? 'disconnected' : device.detail}</span>}
        {starting && <span className="dp-detail">{starting.detail}</span>}
        <span className="cp-spacer" />
        {open && ready && device && (
          <span className="dp-buttons">
            {/* An iPhone is view only: it gets the camera alone. */}
            {device.kind === 'simulator' && (
              <IconButton label="Home" onClick={() => window.deck.devices.input(device.id, { type: 'button', button: 'home' })}><HomeIcon /></IconButton>
            )}
            {(device.kind === 'android' || device.kind === 'emulator') && (
              <>
                <IconButton label="Back" onClick={() => press(KEYCODE.BACK)}><BackIcon /></IconButton>
                <IconButton label="Home" onClick={() => press(KEYCODE.HOME)}><HomeIcon /></IconButton>
                <IconButton label="Recent apps" onClick={() => press(KEYCODE.APP_SWITCH)}><RecentsIcon /></IconButton>
                <IconButton label="Power" onClick={() => press(KEYCODE.POWER)}><PowerIcon /></IconButton>
              </>
            )}
            {claudeRuns && (
              <IconButton label="Add screenshot to Claude" busy={busy} onClick={() => void screenshot()}><CameraIcon /></IconButton>
            )}
          </span>
        )}
      </header>
      {open && shownError && <div className="dp-error" role="alert">{shownError}</div>}
      {open && shownActionError && <div className="dp-error" role="alert">{shownActionError}</div>}
      {open && (
        <div className="dp-body">
          {device && (
            <DeviceScreen key={device.id} deviceId={device.id} name={device.name} kind={device.kind} live={visible && ready} message={message}
              busy={device.state === 'booting' && !gone} handle={screen} />
          )}
          {starting && (starting.error !== undefined ? (
            <State error title={`Couldn't start ${starting.name}`} detail={starting.error}>
              <button className="button" onMouseDown={keepFocus} onClick={() => start(starting)}>Try again</button>
            </State>
          ) : (
            <State busy title={`Starting ${starting.name}…`} />
          ))}
          {view.kind === 'choose' && (
            <div className="dp-choose" onMouseDown={keepFocus}>
              <span className="dp-choose-title">Which device should this project show?</span>
              {view.devices.map((d) => (
                <button key={d.id} className="dp-choice" onClick={(e) => {
                  // From the keyboard, the button had it, and it goes with the chooser.
                  const fromKeyboard = e.currentTarget === document.activeElement
                  onPick(d.id)
                  if (fromKeyboard) onFocusLost()
                }}>
                  <span>{d.name}</span>
                  <span className="dp-choice-detail">{d.detail}</span>
                </button>
              ))}
            </div>
          )}
          {view.kind === 'none' && (
            <Nothing problem={problem} iosProblem={iosProblem} wants={wants} looking={looking} startable={startable} noAvds={noAvds} pick={pick}
              onStart={(item, fromKeyboard) => {
                start(item)
                // From the keyboard, the button had it, and it goes with the empty panel.
                if (fromKeyboard) onFocusLost()
              }} />
          )}
        </div>
      )}
      {menuAnchor && (
        <DeviceMenu devices={devices} startable={startable} noAvds={noAvds && wants.android} current={device?.id ?? starting?.id ?? null}
          shown={device && !gone ? device : null} anchor={menuAnchor} onPick={onPick} onStart={start} onStop={stop} onClose={closeMenu} />
      )}
    </div>
  )
}

interface NothingProps {
  problem: DeviceList['problem']
  iosProblem: DeviceList['iosProblem']
  wants: { android: boolean; ios: boolean }
  looking: boolean
  startable: StartableDevice[]
  noAvds: boolean
  pick: string | null
  /** A Start button was pressed; `fromKeyboard`: it had the keyboard. */
  onStart(item: StartableDevice, fromKeyboard: boolean): void
}

/** The panel was asked for (or a simulator can't be shown) and there's nothing to show: why, and
 *  Start buttons for up to 3 emulators or simulators that fit. */
function Nothing({ problem, iosProblem, wants, looking, startable, noAvds, pick, onStart }: NothingProps) {
  if (looking) return <State busy title="Looking for devices…" />
  // Nested so each problem narrows.
  if (wants.ios) {
    if (iosProblem === 'no-idb') {
      const command = 'brew install facebook/fb/idb-companion'
      return <Install key={command} title="Deck shows simulators with idb-companion:" command={command} />
    }
    if (iosProblem === 'old-idb') {
      const command = 'brew upgrade idb-companion'
      return <Install key={command} title="This idb-companion can't stream a simulator's screen. Update it:" command={command} />
    }
    if (iosProblem) return <State error title="Deck couldn't list the simulators" detail={iosProblem.error} />
  }
  if (wants.android) {
    if (problem === 'no-adb') {
      return <State title="Deck can't find adb, so it can't see Android devices." detail="Install Android Studio or Android's platform tools." />
    }
    if (problem) return <State error title="adb couldn't list the devices" detail={problem.error} />
  }
  const { buttons, more } = startButtons(startable, wants, pick)
  // iOS is wanted only on macOS, where iPhones show too: unlocked, since one isn't listed while it's
  // locked or doesn't trust the Mac.
  const plugIn = wants.android && wants.ios
    ? 'Plug in an unlocked iPhone or an Android phone with USB debugging on'
    : wants.ios ? 'Plug in an unlocked iPhone' : 'Plug in an Android phone with USB debugging on'
  const detail = buttons.length > 0
    ? `${plugIn}, or start one below.`
    : wants.android && wants.ios
      ? `${plugIn}, start an emulator, or boot a simulator.`
      : wants.ios ? `${plugIn}, or boot a simulator in Xcode or with simctl.` : `${plugIn}, or start an emulator.`
  return (
    <State title="No devices connected" detail={detail}>
      {buttons.length > 0 && (
        <span className="dp-starts">
          {buttons.map((item) => (
            <button key={item.id} className="button" title={item.error ?? item.detail} onMouseDown={keepFocus}
              onClick={(e) => onStart(item, e.currentTarget === document.activeElement)}>Start {item.name}</button>
          ))}
        </span>
      )}
      {more && <span className="cp-state-detail">More in the ▾ menu</span>}
      {wants.android && noAvds && <span className="cp-state-detail">No emulators: make one in Android Studio's Device Manager</span>}
    </State>
  )
}

/** What to run in a terminal, with Copy. */
function Install({ title, command }: { title: string; command: string }) {
  const [copied, setCopied] = useState(false)
  useEffect(() => {
    if (!copied) return
    const timer = setTimeout(() => setCopied(false), 1500)
    return () => clearTimeout(timer)
  }, [copied])
  return (
    <State title={title}>
      <code className="dp-command">{command}</code>
      <button className="button" title="Copy the command" onMouseDown={keepFocus} onClick={() => {
        window.deck.app.copyText(command)
        setCopied(true)
      }}>{copied ? '✓ Copied' : 'Copy'}</button>
    </State>
  )
}

function State({ title, detail, busy, error, children }: { title: string; detail?: string; busy?: boolean; error?: boolean; children?: ReactNode }) {
  return (
    <div className={error ? 'cp-state error' : 'cp-state'} role="status">
      {busy && <span className="cp-spinner" aria-hidden="true" />}
      <strong>{title}</strong>
      {detail && <span className="cp-state-detail">{detail}</span>}
      {children}
    </div>
  )
}

/** Busy, it stays enabled (a disabled button would drop the keyboard) and ignores presses. */
function IconButton({ label, busy, onClick, children }: { label: string; busy?: boolean; onClick(): void; children: ReactNode }) {
  return (
    <button className="cp-icon-button dp-icon" aria-label={label} title={label} aria-disabled={busy || undefined}
      onClick={() => !busy && onClick()}>
      {children}
    </button>
  )
}

const Chevron = () => (
  <svg className="cp-chevron" width="10" height="10" viewBox="0 0 16 16" fill="none" stroke="currentColor" strokeWidth="2"
    strokeLinecap="round" strokeLinejoin="round" aria-hidden="true">
    <path d="M4 6l4 4 4-4" />
  </svg>
)

/** A thrown render (a state main got wrong) costs the panel, never the pane: it says so, with Try
 *  again, and another device or view gets another try by itself. */
class Boundary extends Component<{ resetKey: string; children: ReactNode }, { error: Error | null }> {
  state: { error: Error | null } = { error: null }

  static getDerivedStateFromError(error: unknown) {
    return { error: error instanceof Error ? error : new Error(String(error)) }
  }

  componentDidCatch(error: unknown, info: ErrorInfo) {
    console.error('Device panel:', error, info.componentStack)
  }

  componentDidUpdate(prev: { resetKey: string }) {
    if (this.state.error && prev.resetKey !== this.props.resetKey) this.setState({ error: null })
  }

  render() {
    if (!this.state.error) return this.props.children
    return (
      <div className="device-panel">
        <div className="dp-body">
          <State error title="The device panel couldn't show this" detail={this.state.error.message}>
            <button className="button" onClick={() => this.setState({ error: null })}>Try again</button>
          </State>
        </div>
      </div>
    )
  }
}
```

- [ ] **Step 3: App passes it on, and keeps the panel for a device that can be started**

In `src/renderer/src/App.tsx`, the type import gains `StartableDevice`:

```ts
import type { AppInfo, ClipboardPreview, DeviceInfo, MenuCommand, ProjectAction, StartableDevice, UsageState } from '@shared/types'
```

after `const NO_DEVICES: DeviceInfo[] = []`, add:

```ts
const NO_STARTABLE: StartableDevice[] = []
```

replace the three lines from `const { byHand, apps, wants, looking: deviceLooking, choice, iosHint } = panelRules(…)`
to `const showDevice = …` by:

```ts
  const { byHand, apps, wants, looking: deviceLooking, choice, iosHint, startPick } = panelRules({ project, tabDevice, tabHidden, list: deviceList, platform })
  /** The tab's device: its own pick, else the project's latest. */
  const devicePick = tabDevice ?? project?.picks[0] ?? null
  const deviceView = useHeldView(choice, devices, deviceRoot, devicePick)
  const showDevice = tabHidden !== true && (deviceView.kind !== 'none' || byHand || iosHint || startPick)
```

and give the panel what can be started:

```tsx
              <DevicePanel view={deviceView} devices={menuOrder(devices, apps)} startable={menuOrder(deviceList?.startable ?? NO_STARTABLE, apps)}
                noAvds={deviceList?.noAvds ?? false} pick={devicePick} problem={deviceList?.problem ?? null}
```

(the rest of that element, from `iosProblem=`, stays as it is).

- [ ] **Step 4: The Start buttons' style**

In `src/renderer/src/device/device.css`, after the `.dp-choice-detail` rule, add:

```css

/* An empty panel's Start buttons: side by side while they fit, a long name cut. */
.dp-starts { display: flex; flex-wrap: wrap; justify-content: center; gap: 6px; max-width: 100%; }
.dp-starts .button { max-width: 100%; overflow: hidden; text-overflow: ellipsis; white-space: nowrap; }
```

- [ ] **Step 5: Typecheck, test, build**

Run: `npm run typecheck && npx vitest run && npm run build`
Expected: no type errors; every test passes (105 files on 2026-11-25); the build succeeds.

- [ ] **Step 6: Commit**

```bash
git add src/renderer/src/device/DeviceMenu.tsx src/renderer/src/device/DevicePanel.tsx src/renderer/src/App.tsx src/renderer/src/device/device.css
git -c user.email=franco@effektstudios.com commit -m "Device panel: Start and Stop in the menu, a starting device's view, Start buttons when empty"
```

---

### Task 12: Docs

**Files:**
- Modify: `CLAUDE.md`, `README.md`, `docs/TESTING.md`
- Modify: `docs/superpowers/specs/2026-11-03-device-panel-design.md` (the two lines that ruled this out)

- [ ] **Step 1: CLAUDE.md**

After the "Current state" paragraph that ends "…the hands-on check with Franco's iPhone is still to do
(Device panel › iPhones).", add a paragraph:

```markdown
Starting and stopping emulators and simulators (spec `…/2026-11-24-device-start-stop-design.md`, plan
`docs/superpowers/plans/2026-11-25-device-start-stop.md`), built 2026-11-25/26: the ▾ menu's Start
section and Stop, Start buttons in an empty panel, and the panel kept open, in whichever tab showed,
picked or stopped it, for an emulator or simulator that isn't running. Checked with a throwaway
simulator in a private set; emulators only by unit tests (no AVD on Franco's Mac, 2026-11-25), Windows
not at all (Device panel › Starting and stopping).
```

In the table's `src/main/devices/` row, make three phrase changes: after "input checks and sessions"
add "; `emulators.ts`: the SDK's emulator, its AVDs, starting one and `emu kill`"; after "following
the simulators" add ", booting and shutting one down (`boot.ts`)"; and replace "`ipc.ts` (wiring, the
three sources, lock and sleep)" by "`starts.ts` (the starts under way, 3 minutes at most), `ipc.ts`
(wiring, the three sources, starting and stopping, lock and sleep)". In the
`src/renderer/src/device/` row, replace "the menu," by "the menu (`menu.ts`: its devices, Start and
Stop),".

In "Device panel", insert this bullet just before `  - **Which projects** (`project.ts`): …`:

```markdown
  - **Starting and stopping** (`android/emulators.ts`, `ios/boot.ts`, `starts.ts`, `ipc.ts`; renderer
    `menu.ts`, `pick.ts`; spec `…/2026-11-24-device-start-stop-design.md` with its "Decided while
    planning" and "Decided while building", plan `docs/superpowers/plans/2026-11-25-device-start-stop.md`):
    - **What can be started** (`DeviceList.startable`, emulators then simulators, each by name): the
      AVDs the SDK's `emulator -list-avds` prints (`sdkRoots`, the SDK adb's folders; an adb on PATH or
      from Homebrew has no emulator), kept to avdmanager's name characters and never starting with a
      dash (the emulator's INFO lines go), and the simulators the notifier says are `Shutdown` (macOS,
      with a current idb-companion); running ones are left out. AVDs are read at each start of
      watching, at each focus and after an emulator's start or stop; a failed read keeps the last
      list, a stale one says nothing. `noAvds`: the SDK's emulator lists none ("No emulators: make one
      in Android Studio's Device Manager", where emulators fit).
    - **An emulator** starts as `emulator -avd <name>`, detached, `unref()`: it keeps running when
      Deck quits, in its own window. Its stdout and stderr go to a new file for each start,
      `<temp>/Deck emulators/<instance>/<AVD name>-<ms since 1970>.log` (`<instance>` is the same
      per-userData hash the clipboard's folder uses), and each start first removes that AVD's earlier
      logs (`<AVD name>-<digits>.log` only). A failed start's reason is the log's own first ERROR/PANIC/FATAL line (its own
      "LEVEL | " prefix stripped, cut to 500 characters), else the exit code or signal's wording ("The
      emulator stopped (exit code 1)."); without a log (the folder or file couldn't be made) the start
      still works, with nothing read back. No `windowsHide`: `detached: true` already starts it with no
      console window (Microsoft documents `CREATE_NO_WINDOW` as ignored for a detached process), and
      `windowsHide`'s `SW_HIDE` could instead hide the emulator's own window — unverified on Windows;
      note it if a console opens beside the emulator, or its window doesn't show. Once it answers, its
      id is `emulator:<AVD name>` (`ro.boot.qemu.avd_name`), the pick made at the start. Stop is
      `adb -s emulator-<port> emu kill` (only such an adb name reaches the console).
    - **A simulator** boots with `idb_companion --boot <udid> [--device-set-path <set>] --log-level
      info` and shuts down with `--shutdown`, 120 s at most, ended when Deck quits. Measured
      2026-11-25 (idb-companion 1.6.1, iOS 27.0, a private set): Simulator.app isn't opened; a first
      boot took 21 s, later ones 3 s, a shutdown 3.5–6 s; booting a booted one and shutting down a
      shut-down one exit 0; an unknown UDID exits 1 with "<timestamp> <udid> could not be resolved to
      any target in [FBSimulatorControl.SimulatorSet]" (the reason shown drops the timestamp); a
      SIGTERM mid-boot exits 0 within 0.1 s and the simulator boots anyway, so an abort is known by its
      signal. The notifier said `Booted` 0.07 s after `Booting`, 19 s before idb's first boot had
      finished: a simulator Deck boots is listed as `booting` until the command ends.
    - **`booting`** (`DeviceInfo.state`): also an Android device that answered before Android had
      started (`sys.boot_completed` not 1: an emulator's cold boot, a phone rebooting), until it has;
      one still saying so after the tracker's 40 asks (about 2 minutes) is taken as started. A
      simulator Deck boots keeps this flag, even once the notifier already says `Booted`, until idb's
      own boot command ends — each boot carries its own token, so Start → Stop → Start can't let an
      older boot's end clear a newer one's flag or let its video stream early. The panel says
      "Starting <name>…" with the spinner and doesn't stream it; the menu says `starting`.
    - **Starts** (`starts.ts`): from the click until the device is listed and not booting, 3 minutes at
      most. A failed command or the deadline keeps its reason (the tool's last line, or "It didn't
      start within 3 minutes.") until it's started again; a second click changes nothing; a device
      already running answers null; an id the list doesn't offer is refused ("Deck no longer sees
      it."). A failure during a boot — an emulator that dies in its cold boot, a simulator boot that
      fails after the notifier already said `Booted` — reaches `startable` as an error only once the
      device is gone: while it's still merely listed as `booting`, the device counts as running and the
      failure stays unseen rather than flash for a moment. Stop forgets the start outright, deadline
      included, so a Stop during a boot is never a failed start, and nor is an emulator that exits
      cleanly (code 0, no signal, nothing wrong in its log) once it had already been listed — that's
      the user closing its own window. Forgotten too when nothing watches: a start under way carries on
      by itself.
    - **The panel:** the tab's pick (else the project's latest) that's starting or failed to is the
      tab's view: "Starting <name>…", or "Couldn't start <name>" with the reason and Try again — only
      for the tab's own device in force, never a failure elsewhere in the project's picks. The device
      in force, stopped, keeps the panel on its Start view against whichever phone is plugged in —
      shown by hand too, and the same for every tab of the project, since `tab ?? project[0]` is the
      same device until some tab picks another: only a device the project's picks already reach past
      it, and that's connected, shows instead. A start picks for the tab and the project, as choosing a
      connected device does; Stop picks only for the tab, leaving the project's own remembered device
      as it was, so the panel stays on its Start button even for a device that was only ever shown
      without a pick. Picking a device in a tab, or stopping one there, counts as having shown it in
      that tab too (`shownHere`), same as actually streaming it live: the panel opens by itself for a
      stopped device only in a tab that has shown, picked or stopped it this session — a fresh tab
      whose project's latest pick is already stopped stays closed on its own; View → Device Panel there
      still only offers its Start button rather than opening it outright. `shownHere` decides only
      whether the panel shows itself, never which device it shows. The empty panel's title is "<name>
      isn't running" ("Start it below, or choose another device in the ▾ menu.") once other devices are
      connected, else "No devices connected" — including when nothing at all is connected. The ▾ menu
      has a Start section (those that fit first; `starting…`, `didn't start`) and, for an emulator or
      simulator on screen, Stop, with no confirmation; the keyboard moves over all of it. An empty
      panel offers up to 3 Start buttons, then "More in the ▾ menu". A refused start or a failed stop
      says so under the header.
    - **Unit tests:** `sdkRoots`; AVD names, finding and running the emulator and `emu kill` (shell
      stand-ins); the log file and its failure line, `startAvd` without one; `--boot`/`--shutdown`
      arguments, the failure's line, abort and timeout; the shut-down simulators; `booting` in
      `mergeDevices` and the tracker; `Starts` (fake timers); `devices:start` and `devices:stop` through
      `registerDeviceIpc` with stand-ins for the SDK's adb and emulator and for idb_companion
      (`ipc.start.test.ts`, skipped on Windows), including a boot's own token surviving a Stop and a
      restart, and a boot that fails after the notifier said Booted showing its error only once the
      device is gone; `pick.ts`'s starting view, `startButtons` and `startPick`; the menu's entries.
    - **Not yet checked:** an emulator started from Deck, and whether macOS prompts for its microphone
      use, in whose name. Electron's default Info.plist already has `NSMicrophoneUsageDescription`
      ("This app needs access to the microphone"), which the installed Deck carries unchanged
      (`extendInfo` overrides only the camera's string); Deck's entitlements have no
      `com.apple.security.device.audio-input`. The emulator binaries (`emulator`,
      `qemu-system-aarch64`) themselves carry the microphone entitlement, and an emulator Deck starts
      counts as Deck's for macOS privacy, so the likely outcome, if the emulator ever asks, is a prompt
      in Deck's name with Electron's generic text, or a silent denial under the hardened runtime (no
      entitlement to grant). Franco chose to leave it as is; the live check with a throwaway AVD is
      only to confirm. Windows, all of it (`docs/TESTING.md` 18ah–18ai).
    - **Known limits:** an emulator started from Deck runs on after Deck quits; an AVD made meanwhile
      shows once Deck comes to the front; simulators created or deleted while shut down show only
      once the notifier restarts; Deck doesn't make AVDs or simulators; a failed start stays in the
      menu until started again or nothing watches; an old system image that sets neither AVD property
      is listed as `emulator:emulator-<port>`, so its start runs out of time; no "Stopping …" feedback
      (an emulator may stay listed as ready while it saves its snapshot, or show as offline, which the
      panel answers with "Unplug it and plug it back in"); a start can't be cancelled before its device
      is listed; in a project that's both an Android and an iOS app, a simulator-listing error hides
      the emulators' Start buttons too (the empty panel gives up before it gets to them); quitting Deck
      mid-boot leaves the simulator booted (idb's command ends, the boot completes, in CoreSimulator,
      not in the command Deck ran), as an emulator started from Deck keeps running after Deck quits;
      Stop then Start right away while Quick Boot saves its snapshot may fail (the AVD still locked); a
      device that never sets `sys.boot_completed` shows "Starting …" for about 2 minutes on each
      connection (the tracker's 40 asks), and an emulator whose cold boot runs longer than that after
      adbd answers may end in "Couldn't show …" with Try again instead; Windows: emulators only, and
      unverified whether `emulator.exe` stays up for the emulator's whole life (if it re-execs or hands
      off to a child, `ended` would wrongly report a stop during a healthy boot) or whether a console
      window appears beside it.
```

At the end of the first paragraph of "**Which device a tab shows** (`pick.ts`)", after "…they're used
once the panel is shown by hand.", add: "A pick started from the panel and not listed yet shows as
starting, and one that can be started keeps the panel open (Starting and stopping, above)."

In "Next steps", item 5, after "…Windows (`docs/TESTING.md` 18p–18y).", add: "Starting and stopping
emulators and simulators: built from `docs/superpowers/plans/2026-11-25-device-start-stop.md`; next,
an emulator check with a throwaway AVD Franco agrees to, `docs/TESTING.md` 33–36 on the signed app,
and 18ah–18ai on Windows."

- [ ] **Step 2: README.md**

In the "**Device panel**" bullet, after "(the ▾ menu picks another, per tab).", add (re-wrapping the
paragraph at the file's width):

```markdown
The ▾ menu also starts an emulator (an AVD made in Android Studio's Device Manager) or boots a
shut-down simulator, and stops the one shown; while a project's own emulator or simulator isn't
running, its panel offers a Start button. An emulator started from Deck keeps running after Deck quits.
```

- [ ] **Step 3: docs/TESTING.md**

By the time this was built, items 18ac–18ag were already taken (the tab-status checks): the new ones
go in as 18ah–18ai instead, in the same place (after item 18ag, before "**Restart**"):

```markdown
18ah. Starting an emulator, only with an AVD you're happy to start (Android Studio › Device Manager):
     with no phone plugged in and the emulator closed, open an Android app's tab and press
     Ctrl+Shift+D. The panel says "No devices connected" with **Start <AVD>** (its `_` as spaces), and
     the ▾ menu lists it under Start. Click it: "Starting <AVD>…" with a spinner, the emulator's own
     window opens, and the panel shows its screen once Android has started, without "Couldn't show".
     Note it if a console window opens beside the emulator, or the emulator's window doesn't show. If
     it fails instead, its reason should be in
     `%TEMP%\Deck emulators\<8 characters>\<AVD>-<digits>.log` (the AVD's own name, `_` not spaces;
     the newest file, one per start).
18ai. ▾ → **Stop <AVD>**: the emulator closes; "disconnected", then the panel stays with its Start
     button first. View → Device Panel on a new tab in the same folder offers that Start button too
     (a fresh tab no longer opens the panel by itself for a stopped device). Start it again from
     there, then quit Deck: the emulator keeps running.
```

At the end of the file, add:

```markdown

## macOS: starting and stopping simulators and emulators

On the installed app (your own simulators are fine here: this is your check). Quit Simulator.app
first.

33. In an iOS project's tab with no simulator booted, press Cmd+Shift+D: "No devices connected" with up
    to 3 **Start <simulator>** buttons, then "More in the ▾ menu"; the ▾ menu lists every shut-down
    simulator under Start, an iOS app's first. Click one: "Starting <name>…" with a spinner until it
    has booted (about 20 s the first time), then its screen. Simulator.app doesn't open; opened, it
    shows the simulator.
34. ▾ → **Stop <name>**: it shuts down; "disconnected", then the panel stays with its Start button
    first. View → Device Panel on a new tab in the same project offers that button too, without
    Cmd+Shift+D opening it by itself (a fresh tab no longer does that for a stopped device). Start it
    from the ▾ menu's Start section this time: the same as 33, quicker.
35. Start a simulator and quit Deck while it says "Starting …": the simulator finishes booting anyway
    (`xcrun simctl list devices booted`).
36. With an AVD (only one you're happy to start): 18ah and 18ai on the Mac, and note any macOS prompt
    that names Deck (the microphone or the camera, asked for by the emulator). Without any AVD, an
    Android app's empty panel (Cmd+Shift+D) says "No emulators: make one in Android Studio's Device
    Manager".
```

- [ ] **Step 4: The device panel's spec**

In `docs/superpowers/specs/2026-11-03-device-panel-design.md`, replace
`- Deck never boots or shuts down simulators.` by:

```markdown
- Deck boots or shuts down a simulator only when asked to, from the panel
  (`2026-11-24-device-start-stop-design.md`).
```

and, under "## Not in this design", replace `- Starting or stopping emulators and simulators.` by:

```markdown
- Starting or stopping emulators and simulators: added by `2026-11-24-device-start-stop-design.md`.
```

- [ ] **Step 5: Commit**

```bash
git add CLAUDE.md README.md docs/TESTING.md docs/superpowers/specs/2026-11-03-device-panel-design.md
git -c user.email=franco@effektstudios.com commit -m "Docs: starting and stopping emulators and simulators"
```

---

### Task 13: On a throwaway simulator, in a dev build

A dev build driven through the DevTools protocol, against a throwaway simulator in a private device
set: never Franco's own simulators, and no AVD. No Claude prompt is sent (no tokens in checks). The
project's pick is seeded in the dev build's own `devices.json`, so the panel opens by `startPick`, not
by hand: shown by hand, every device fits, and a phone Franco has plugged in could be picked and
streamed.

- [ ] **Step 1: A throwaway simulator, an iOS project, and its pick**

```bash
SCR=<the session's scratchpad>
xcrun simctl list runtimes | grep iOS     # take an available iOS runtime (iOS 27.0 on 2026-11-25)
SET="$SCR/simset"; mkdir -p "$SET"
U=$(xcrun simctl --set "$SET" create "Deck check" com.apple.CoreSimulator.SimDeviceType.iPhone-17 com.apple.CoreSimulator.SimRuntime.iOS-27-0)
APP="$SCR/ios-app"; mkdir -p "$APP/App.xcodeproj"; printf '// !$*UTF8*$!\n' > "$APP/App.xcodeproj/project.pbxproj"
git -C "$APP" init -q && git -C "$APP" add . && git -C "$APP" -c user.name=Check -c user.email=check@example.com commit -qm app
ROOT=$(cd "$APP" && pwd -P)
mkdir -p "$SCR/deck-dev-data" && printf '{"%s":["simulator:%s"]}\n' "$ROOT" "$U" > "$SCR/deck-dev-data/devices.json"
pgrep -lx Simulator || echo "Simulator.app not running"   # compare at the end
```

- [ ] **Step 2: A DevTools helper**

Write `$SCR/cdp.mjs` (Node 22 has `fetch` and `WebSocket`):

```js
// node cdp.mjs <port> '<expression>' [wait]: evaluates in the page (9333) or in main (9229, the Node
// inspector) and prints the value as JSON; with `wait`, again every 250 ms until it's truthy (90 s
// at most), then prints it and how long that took.
const [port, expression, mode] = process.argv.slice(2)
const targets = await (await fetch(`http://127.0.0.1:${port}/json`)).json()
const target = targets.find((t) => t.type === 'page' && !t.url.startsWith('devtools:')) ?? targets[0]
const ws = new WebSocket(target.webSocketDebuggerUrl)
await new Promise((resolve, reject) => {
  ws.onopen = resolve
  ws.onerror = reject
})
let id = 0
const evaluate = (expr) =>
  new Promise((resolve) => {
    const mine = ++id
    ws.onmessage = (m) => {
      const msg = JSON.parse(m.data)
      if (msg.id === mine) resolve(msg.result?.exceptionDetails ? { error: msg.result.exceptionDetails.exception?.description ?? msg.result.exceptionDetails.text } : msg.result?.result?.value)
    }
    ws.send(JSON.stringify({ id: mine, method: 'Runtime.evaluate', params: { expression: expr, awaitPromise: true, returnByValue: true } }))
  })
const started = Date.now()
let value = await evaluate(expression)
while (mode === 'wait' && !value && Date.now() - started < 90_000) {
  await new Promise((r) => setTimeout(r, 250))
  value = await evaluate(expression)
}
console.log(JSON.stringify(mode === 'wait' ? { value, ms: Date.now() - started } : value))
ws.close()
```

(Checked while planning against a `node --inspect` process: a value, `wait`, and an error.)

- [ ] **Step 3: The dev build**

From the worktree, in the background (its own data folder, the private set, a tab in the project):

```bash
env -u CLAUDECODE DECK_SIMULATOR_SET="$SET" npx electron-vite dev --remoteDebuggingPort 9333 --inspect 9229 -- --user-data-dir="$SCR/deck-dev-data" --open "$APP"
```

Wait for its DevTools port, then keep the page drawing while other windows cover it:

```bash
node -e "const t = Date.now(); (async function up() { try { await fetch('http://127.0.0.1:9333/json'); console.log('up after', Date.now() - t, 'ms') } catch { if (Date.now() - t < 120000) setTimeout(up, 500); else console.log('not up after 2 min') } })()"
node "$SCR/cdp.mjs" 9229 "process.mainModule.require('electron').BrowserWindow.getAllWindows()[0].webContents.setBackgroundThrottling(false)"
```

- [ ] **Step 4: Start it from the empty panel, see it stream**

```bash
P="document.querySelector('.device-panel')?.innerText"
node "$SCR/cdp.mjs" 9333 "$P && $P.includes('Start Deck check') && $P" wait
node "$SCR/cdp.mjs" 9333 "(() => { const b = [...document.querySelectorAll('.dp-starts .button')].find((x) => x.textContent === 'Start Deck check'); b?.click(); return Boolean(b) })()"
node "$SCR/cdp.mjs" 9333 "$P"
pgrep -fl "idb_companion --boot"
node "$SCR/cdp.mjs" 9333 "Boolean(document.querySelector('.dp-screen')) && !document.querySelector('.dp-overlay')" wait
pgrep -fl sim-video | grep "$U"; pgrep -lx Simulator || echo "Simulator.app not running"
```

Expected: the panel opened by itself with "No devices connected" and **Start Deck check** (the
project's pick, shut down); right after the click, "Starting Deck check…"; one
`idb_companion --boot <U> --device-set-path <SET> --log-level info`; the screen live (a canvas, no
overlay) within about 30 s for this first boot, never "Couldn't show"; one `sim-video` for `$U`; no
Simulator.app started. Note the time `wait` printed.

- [ ] **Step 5: Stop it from the menu, then start it from the menu**

```bash
node "$SCR/cdp.mjs" 9333 "(() => { document.querySelector('.dp-device').click(); return new Promise((r) => setTimeout(() => r([...document.querySelectorAll('.cp-menu .cpm-item')].map((i) => i.innerText)), 100)) })()"
node "$SCR/cdp.mjs" 9333 "(() => { const i = [...document.querySelectorAll('.cp-menu .cpm-item')].find((x) => x.querySelector('.cpm-label')?.textContent === 'Stop Deck check'); i?.click(); return Boolean(i) })()"
xcrun simctl --set "$SET" list devices | grep "Deck check"
node "$SCR/cdp.mjs" 9333 "$P && $P.includes('Start Deck check') && $P" wait
node "$SCR/cdp.mjs" 9333 "(() => { document.querySelector('.dp-device').click(); return new Promise((r) => setTimeout(() => r([...document.querySelectorAll('.cp-menu .cpm-item')].map((i) => i.innerText)), 100)) })()"
node "$SCR/cdp.mjs" 9333 "(() => { const i = [...document.querySelectorAll('.cp-menu .cpm-item')].find((x) => x.querySelector('.cpm-label')?.textContent === 'Deck check' && x.getAttribute('role') === 'menuitem'); i?.click(); return Boolean(i) })()"
node "$SCR/cdp.mjs" 9333 "Boolean(document.querySelector('.dp-screen')) && !document.querySelector('.dp-overlay')" wait
```

Expected: the first menu lists "Deck check" as a device and "Stop Deck check" last (any device adb
sees is listed too: click nothing else); after Stop, the simulator is `Shutdown`, the panel says
"disconnected", and about 10 s later "No devices connected" with **Start Deck check** (kept by
`startPick`); the second menu has "▶ Deck check" under Start; that start streams again within a few
seconds (a warm boot). Then stop it the same way as above.

- [ ] **Step 6: Quit, and leave nothing behind**

```bash
node "$SCR/cdp.mjs" 9229 "process.mainModule.require('electron').app.quit()"
pgrep -fl idb_companion | grep -F "$SET"; pgrep -fl sim-video | grep "$U"; echo "(nothing above)"
xcrun simctl --set "$SET" shutdown all; xcrun simctl --set "$SET" delete all
rm -rf "$SET" "$APP" "$SCR/deck-dev-data"
pgrep -lx Simulator || echo "Simulator.app not running"
```

Expected: no companion, notifier or `sim-video` of the private set left; Simulator.app as it was in
Step 1.

- [ ] **Step 7: Record it**

In CLAUDE.md's "**Starting and stopping**" bullet, add a sub-bullet "**Checked in the app** (the date,
a dev build, a throwaway simulator in a private set, through the DevTools protocol)" with what you saw
in Steps 4–6: the times `wait` printed for the first and the warm start, the processes, the panel's
texts, that Simulator.app didn't open, and anything that didn't go as expected. Then:

```bash
git add CLAUDE.md
git -c user.email=franco@effektstudios.com commit -m "Docs: starting and stopping, checked on a throwaway simulator"
```

---

## Self-review (done while writing; kept for the reviewer)

**Spec coverage:**
- What can be started: AVDs through `sdkRoots`/`findEmulator`/`listAvds` (Tasks 1, 2, 7); no SDK, no
  emulators (`findEmulator` looks only in SDK folders); shut-down simulators only with a current
  idb-companion (`simulators` runs only with `sim-video`; Tasks 4, 7).
- Starting: `startAvd` detached, own window, id `emulator:<AVD name>` (Task 2); `idb_companion --boot`
  with `--device-set-path` (Task 3); Simulator.app checked (above). Stopping: `emu kill`,
  `--shutdown`; no Stop for phones and iPhones (Tasks 2, 3, 8, 10).
- The menu: Start section, project-fitting first, `starting…`, picking on start, Stop without
  confirmation, keyboard over both (Tasks 9–11). "No emulators…" where emulators fit (Tasks 7, 11).
- While it starts, "Starting …" with the spinner (Tasks 9, 11, and `booting` in Tasks 5, 8); failures
  with Try again (Tasks 6, 8, 11); after a stop, the hold, then Start buttons (Task 9's `startPick`).
- The empty panel: up to 3 buttons, "More in the ▾ menu", the text change only with buttons (Task 11).
- How: `boot.ts` 120 s, abort, last line (Task 3); `shutDown()` (Task 4); `devices:start`/`stop`
  invoked, null or `{ error }`; `startable` with starting and error; AVD reads at watch start, focus,
  after start and stop; the 3-minute starting state (Tasks 6–8); types and API (Tasks 2, 7, 8).
- Known limits and testing: CLAUDE.md, TESTING.md (Task 12); unit tests throughout; the in-app check
  with a throwaway simulator, no AVD (Task 13).

**Placeholder scan:** every code step has its code; the only values filled in at run time are
measurements (Task 13's times) and the scratchpad's path.

**Names across tasks:** `sdkRoots`, `findEmulator(sdks, platform)`, `listAvds(emulator, timeoutMs?)`,
`startAvd(emulator, name, ended?)`, `killEmulator(adb, serial)`, `startableEmulators`;
`bootSimulator(idb, udid, { set, signal, timeoutMs })`, `shutdownSimulator(…)`;
`startableSimulators`, `SimulatorTracker.shutDown()`; `Starts.begin/listed/merge/clear`,
`START_DEADLINE_MS`; `FoundDevices`; `DeviceActionResult`, `StartableDevice`,
`DeviceList.startable/noAvds`, `DeviceInfo.state` `'booting'`; `IPC.devicesStart/devicesStop`;
`PanelChoice`/`PanelView` `'starting'`, `startButtons(startable, wants, pick)`, `MAX_START_BUTTONS`,
`PanelRules.startPick`; `menuEntries`, `startHint`, `MenuEntry`. Each is defined in the task that
first uses it, or earlier.
