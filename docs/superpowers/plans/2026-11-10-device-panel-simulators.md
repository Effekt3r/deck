# Device panel, step 2 (simulators) Implementation Plan

> **For agentic workers:** REQUIRED SUB-SKILL: Use superpowers:subagent-driven-development (recommended) or superpowers:executing-plans to implement this plan task-by-task. Steps use checkbox (`- [ ]`) syntax for tracking.

**Goal:** In an iOS project's tabs (and any tab, when asked for), show a booted iOS simulator live in
the device panel, and let Franco tap, drag, type, paste and press Home on it. macOS only.

**Architecture:** Main follows the simulators with one long-running `idb_companion --notify stdout`
beside adb's tracker, and merges both into one device list that says which kinds are still being
looked for. A viewed simulator gets a session: its own `idb_companion --udid` serving gRPC on a
private Unix socket (input, and the screen's size in points), and `sim-video stream` writing
fragmented MP4, which main cuts into the same Annex B packets the view already decodes. gRPC runs on
Node's own `http2` with the few protobuf messages written by hand. The stream lifecycle
(`streams.ts`) takes any session with `input`, `keyframe` and `stop`; scrcpy's session is wrapped
into that shape. The renderer picks devices by platform, maps keys to USB HID usages for simulators
(iOS edits text like a Mac, so keys go as they are), and shows the Home button and the
idb-companion hints. Spec: `docs/superpowers/specs/2026-11-03-device-panel-design.md` (step 2 of its
build order), updated by this plan where noted.

**Tech Stack:** Electron 45 (main/preload/renderer), Node 22 (`node:http2`, `net`, `child_process`),
React 19, TypeScript, vitest (node environment). No new dependency.

**Conventions:**
- Node 22: `export PATH="$HOME/.nvm/versions/node/v22.19.0/bin:$PATH"` before npm commands.
- Work in the worktree `~/.config/superpowers/worktrees/deck/m5-device-simulators`, branch
  `m5-device-simulators` (based on `m5-device-picks`, PR #17: each project's device list).
- Commits use `git -c user.email=franco@effektstudios.com commit` and never carry
  `Co-Authored-By`. They end with
  `Claude-Session: https://claude.ai/code/session_012TidnBvRYbxhSYqPzFZuph`.
- Comments explain why, in the repo's plain style. Tests sit next to their source as `*.test.ts`.
- Code comments and tests never name other repositories of Franco's (use made-up names); device ids
  and UDIDs in tests are made up.
- Never commit screenshots or session logs. Never boot, shut down or type into Franco's own
  simulators: checks use a throwaway simulator in a private device set (Task 14).

**Facts this plan relies on** (measured 2026-11-10 on Franco's Mac: idb-companion 1.6.1 from
Homebrew, Xcode with iOS 27.0 simulators):
- `/opt/homebrew/bin/idb_companion` links to `/opt/homebrew/Cellar/idb-companion/1.6.1/libexec/idb_companion`;
  `sim-video` sits beside that real file. `idb_companion --version` prints only a build date.
- `idb_companion --notify stdout --only simulator` prints, about 2.5 s after it starts, one line: a
  JSON array of every simulator (`{"udid","name","model","os_version":"iOS 27.0","state","type":"Simulator"}`).
  Each later line is an array of only the simulators whose state changed (`Booting`, `Booted`,
  `Shutting Down`, `Shutdown`). Creating or deleting a shut-down simulator prints nothing.
- `idb_companion --udid <udid> --grpc-domain-sock <path> --terminate-offline true` serves gRPC on a
  Unix socket and exits when the simulator shuts down ("Target is no longer booted, companion going
  offline"). The socket's path must stay under 104 bytes (macOS's `sun_path`): a longer one fails with
  "GRPCCore.RuntimeError error 1" and the companion keeps running without a socket. It takes about
  half a second to create the socket. About 29 MB of memory. Two companions for one simulator work
  side by side (idb's own client keeps one in `/tmp/idb/`).
- gRPC over `node:http2` to that socket works: `describe` answered
  `screen_dimensions {width 1206, height 2622, density 3, width_points 402, height_points 874}`; `hid`
  events apply as they arrive while the client stream stays open (a Home press changed the screen
  before the call ended). A tap at a point is a touch down then up; a drag is a touch down at each
  point along the way, then an up (it scrolled Settings). Keys are USB HID usages: Shift (225) held
  around 4 typed "A" ("Ab1!" was typed exactly).
- `sim-video stream --set <set> --udid <udid> --scale 0.5 --key-frame-rate 2 --transport fmp4 -`
  writes `ftyp` (28 bytes), `moov` (631, with `avc1` 604×1312 and `avcC`: High profile, level 3.1,
  4-byte NAL lengths, one SPS, one PPS), then a `moof` (100) and an `mdat` per picture, each `mdat`
  one NAL with a 4-byte length: an IDR (type 5) first, then P slices (type 1). The first boxes came
  0.95 s after the start. Frames come only when the screen changes; while it changes, a key frame
  every 2 s (IDR at 1.2, 3.1, 5.1 and 7.1 s). Closing its stdin ends it (exit 0). A bad UDID prints
  `Error: No simulator <udid> in <set>` on stderr and exits 64. Its stderr also carries info lines
  ("Overlay setup: screenInfo=1206x2622@3.0x, …").
- With `--transport annex-b` a still screen gave SPS, PPS and one IDR and then nothing: with no
  delimiters, a picture only ends where the next begins, so the last one never would.
- Rotating with idb's orientation event changed no box size (iPhone Settings stays portrait):
  landscape apps are unchecked.
- `xcrun simctl pbcopy` then ⌘V makes iOS ask "would like to paste from CoreSimulatorBridge" every
  time.

**Where this plan departs from the spec** (Task 13 writes these into it):
1. `sim-video`'s fMP4, not its Annex B: exact picture boundaries (above).
2. gRPC on `node:http2` with hand-written protobuf, not `@grpc/grpc-js`: that and its loader are 33
   packages and 12 MB for two calls. The field numbers follow idb's `proto/idb.proto` (MIT), whose
   notice joins scrcpy's.
3. A paste on a simulator is typed, as a US keyboard would (at most 1,000 characters), not put on
   its pasteboard: iOS would ask every time.
4. One watch runs both sources (simulators on macOS with idb-companion installed); the list says
   which kinds are still pending, and a tab waits only for the kinds it shows. A view that joins a
   running simulator stream gets the current group of pictures replayed (sim-video can't be asked
   for a key frame).

---

## File structure

New, main (`src/main/devices/`):
- `session.ts`: `StreamEvents` and `DeviceSession`, the shape every kind of stream has.
- `registry.ts`: one `DeviceList` from adb's devices and the simulators (pure).
- `ios/proto.ts`: idb's HID and describe messages, and gRPC message framing (pure).
- `ios/grpc.ts`: a gRPC client on `node:http2` over a Unix socket.
- `ios/fmp4.ts`: sim-video's fragmented MP4 to Annex B packets (pure).
- `ios/input.ts`: the renderer's input for a simulator, checked and turned into HID events (pure).
- `ios/tools.ts`: finding `idb_companion` and `sim-video`; whether a simulator is booted without idb.
- `ios/simulators.ts`: `--notify` lines and the long-running notifier.
- `ios/simulator.ts`: one simulator's session (companion, socket, describe, video, input, GOP).
- `ios/test-process.ts`, `ios/test-fixtures.ts`: test helpers (fake child processes; fMP4 and
  describe fixtures).

New, shared: `src/shared/hid.ts` (the named keys' USB HID usages and the modifier bits).

Changed: `src/shared/types.ts`, `src/main/devices/streams.ts`, `ipc.ts`, `project.ts`,
`src/main/index.ts`, `src/renderer/src/App.tsx`, `src/renderer/src/device/pick.ts`, `keys.ts`,
`DevicePanel.tsx`, `DeviceScreen.tsx`, `device.css`, `resources/THIRD-PARTY-NOTICES.txt`, docs.

---

### Task 1: One session shape for every kind of device

Streams start, view, ask for key frames and pass input through a session whatever the device;
scrcpy's session is wrapped into that shape in `ipc.ts`. The shared types gain what step 2 needs.

**Files:**
- Create: `src/main/devices/session.ts`, `src/shared/hid.ts`
- Modify: `src/shared/types.ts`, `src/main/devices/streams.ts`, `src/main/devices/streams.test.ts`,
  `src/main/devices/ipc.ts`, `src/main/devices/ipc.test.ts`

- [ ] **Step 1: Change the stream tests to the new session shape**

In `src/main/devices/streams.test.ts`:

Replace the imports and `Started`/`setup` head:

```ts
import { afterEach, beforeEach, describe, expect, it, vi } from 'vitest'
import type { DeviceStreamEvent } from '@shared/types'
import type { StreamEvents } from './session'
import { DeviceStreams } from './streams'

interface Started {
  id: string
  events: StreamEvents
  session: { input: ReturnType<typeof vi.fn>; keyframe: ReturnType<typeof vi.fn>; stop: ReturnType<typeof vi.fn> }
}
```

and in `setup()` make the fake session `const session = { input: vi.fn(), keyframe: vi.fn(), stop: vi.fn() }`.

Then, everywhere a test checked scrcpy's reset video message, check `keyframe` instead:
- `expect(started[0].session.send).toHaveBeenCalledWith(Buffer.from([17]))` (two places) becomes
  `expect(started[0].session.keyframe).toHaveBeenCalledTimes(1)`;
- `expect(started[0].session.send).not.toHaveBeenCalled()` and
  `expect(started[1].session.send).not.toHaveBeenCalled()` become the same on `.keyframe` (and, in
  the test that also sent input before checking, on `.input` too).

Replace the test 'passes input and key frame requests to a running session only' with:

```ts
  it('passes input and key frame requests to a running session only', async () => {
    const { streams, started } = setup()
    streams.input('android:1', { type: 'text', text: 'a' })
    streams.view('android:1')
    await flush()
    streams.input('android:1', { type: 'text', text: 'b' })
    streams.keyframe('android:1')
    expect(started[0].session.input.mock.calls).toEqual([[{ type: 'text', text: 'b' }]])
    expect(started[0].session.keyframe).toHaveBeenCalledTimes(1)
  })
```

and in the test that ends a stream and then sends input (`streams.input('android:1', Buffer.from([2]))`
after `started[0].events.end('gone')`), send `{ type: 'text', text: 'b' }` and expect both
`started[0].session.input` and `started[0].session.keyframe` not to have been called.

- [ ] **Step 2: Run the stream tests and watch them fail**

Run: `npx vitest run src/main/devices/streams.test.ts`
Expected: FAIL: the streams still call `session.send(...)`, which the fake no longer has
("session.send is not a function"), and the input/keyframe expectations aren't met.

- [ ] **Step 3: Add the session shape and the shared HID constants**

Create `src/main/devices/session.ts`:

```ts
import type { DeviceStreamEvent } from '@shared/types'

/** One packet of a stream: H.264, Annex B. */
export type StreamPacket = Omit<Extract<DeviceStreamEvent, { type: 'packet' }>, 'type'>

/** What a starting stream reports, whatever the device. */
export interface StreamEvents {
  /** A capture session started: the frames that follow have this size. */
  size(width: number, height: number): void
  packet(packet: StreamPacket): void
  /** The stream ended by itself: why. Not called after stop(). */
  end(why: string): void
}

/** A running stream: scrcpy's server on an Android device, idb on a simulator. */
export interface DeviceSession {
  /** The renderer's input, unchecked: the session checks it and drops what it can't use. */
  input(input: unknown): void
  /** A key frame, for a viewer that joins or a decoder that fell behind. */
  keyframe(): void
  stop(): void
}
```

Create `src/shared/hid.ts`:

```ts
/** USB HID keyboard usages (page 7) for the named keys a simulator gets; typing goes as text. */
export const HID_KEY = {
  ENTER: 40, ESCAPE: 41, BACKSPACE: 42, TAB: 43, HOME: 74, PAGE_UP: 75, DELETE: 76, END: 77,
  PAGE_DOWN: 78, RIGHT: 79, LEFT: 80, DOWN: 81, UP: 82,
} as const

/** The modifiers sent with a simulator's key, as bits; main presses their keys around it. */
export const HID_MOD = { SHIFT: 1, CTRL: 2, ALT: 4, CMD: 8 } as const
```

- [ ] **Step 4: Widen the shared types**

In `src/shared/types.ts`:

`DeviceInfo`'s `id` doc and `kind`, `name` and `detail`:

```ts
export interface DeviceInfo {
  /** The same across reconnects and connections: `android:<serial number>`,
   *  `emulator:<AVD name>` (an emulator's adb name changes with its port), or `simulator:<UDID>`. */
  id: string
  kind: 'android' | 'emulator' | 'simulator'
  /** The name set on the phone ("Franco's S25 FE"), else its maker and model; an emulator's AVD
   *  name; a simulator's name. */
  name: string
  /** Its system and connection: "Android 13 · USB", "Android 17 · USB + Wi-Fi",
   *  "Emulator · Android 15", "Simulator · iOS 27.0". */
  detail: string
```

(`state` stays as it is.) Below `DeviceInfo`:

```ts
/** What a device runs: Android phones and emulators, or iOS simulators. */
export type DevicePlatform = 'android' | 'ios'

/** The devices Deck sees, or why it sees none. */
export interface DeviceList {
  devices: DeviceInfo[]
  /** Android: 'no-adb': adb wasn't found; { error }: adb failed; null: adb runs. */
  problem: 'no-adb' | { error: string } | null
  /** Simulators (macOS): 'no-idb': one is booted but idb-companion isn't installed; 'old-idb': the
   *  idb-companion found has no sim-video; { error }: its notifier failed; null otherwise. */
  ios: 'no-idb' | 'old-idb' | { error: string } | null
  /** The kinds still finding their first devices: a tab waits only for the ones it shows. */
  pending: DevicePlatform[]
}
```

In `DeviceInput`, after the `key` member:

```ts
  /** A simulator's named key (`HID_KEY` in @shared/hid) with `HID_MOD` bits. */
  | { type: 'hid'; usage: number; modifiers: number }
  /** A simulator's Home button. */
  | { type: 'button'; button: 'home' }
```

and change the `key` member's doc to "An Android key code pressed and let go, with Android's meta
state (shift 1, alt 2)." (it's Android's only now).

- [ ] **Step 5: Make the streams use the session shape**

In `src/main/devices/streams.ts`:
- Replace the imports of `resetVideoMessage` and of `ScrcpyEvents, ScrcpySession` with
  `import type { DeviceSession, StreamEvents } from './session'`.
- `StreamsDeps.start` becomes
  `start(id: string, events: StreamEvents, signal: AbortSignal): Promise<DeviceSession>`, and
  `Stream.session` becomes `DeviceSession | null`.
- In `view()`, `s.session.send(resetVideoMessage()) // the new viewer's decoder starts from a key frame`
  becomes `s.session.keyframe() // the new viewer's decoder starts from a key frame`.
- `keyframe(id)` and `input(id, …)` become:

```ts
  /** A fresh key frame: a decoder fell behind or failed. */
  keyframe(id: string): void {
    this.streams.get(id)?.session?.keyframe()
  }

  /** The renderer's input for the device, while its stream runs: its session checks it. */
  input(id: string, input: unknown): void {
    this.streams.get(id)?.session?.input(input)
  }
```

- In `begin()`, `const events: ScrcpyEvents = {` becomes `const events: StreamEvents = {`.

- [ ] **Step 6: Wrap scrcpy's session in `ipc.ts`**

In `src/main/devices/ipc.ts`, add the imports
`import { resetVideoMessage } from './android/protocol'`,
`import { adbIo, type ScrcpySession, startScrcpy } from './android/scrcpy'` (replacing the existing
`adbIo, startScrcpy` import) and `import type { DeviceSession } from './session'`, and above
`registerDeviceIpc`:

```ts
/** scrcpy's session as a stream's: input becomes scrcpy's control messages, a key frame its reset
 *  video. */
function androidSession(scrcpy: ScrcpySession): DeviceSession {
  return {
    input: (input) => {
      for (const message of controlMessages(input)) scrcpy.send(message)
    },
    keyframe: () => scrcpy.send(resetVideoMessage()),
    stop: () => scrcpy.stop(),
  }
}
```

The streams' `start` returns
`androidSession(await startScrcpy(serial, await scrcpyServer(opts.resources), events, adbIo(adb), signal))`,
and the input listener becomes:

```ts
  ipcMain.on(IPC.devicesInput, (_e, id: unknown, input: unknown) => {
    if (typeof id === 'string') streams.input(id, input)
  })
```

Every list `ipc.ts` publishes gains the two new fields: `{ devices: [], problem: 'no-adb', ios: null, pending: [] }`
and `{ devices, problem: error && devices.length === 0 ? { error } : null, ios: null, pending: [] }`
(Task 8 replaces both with the registry).

In `src/main/devices/ipc.test.ts`, every expected `DeviceList` gains `ios: null, pending: []`
(lines with `problem: 'no-adb' }` and `problem: null }`).

- [ ] **Step 7: Run the tests and the typecheck**

Run: `npx vitest run src/main/devices && npm run typecheck`
Expected: PASS, no type errors. (`DevicePanel.tsx` reads `DeviceList['problem']`, which is unchanged.)

- [ ] **Step 8: Commit**

```bash
git add src/shared/hid.ts src/shared/types.ts src/main/devices/session.ts src/main/devices/streams.ts \
  src/main/devices/streams.test.ts src/main/devices/ipc.ts src/main/devices/ipc.test.ts
git -c user.email=franco@effektstudios.com commit -m "Devices: one session shape for every kind of stream

Claude-Session: https://claude.ai/code/session_012TidnBvRYbxhSYqPzFZuph"
```

---

### Task 2: iOS projects

A project is an iOS app when it has an Xcode project or workspace at its root or one folder down.

**Files:**
- Modify: `src/main/devices/project.ts`, `src/main/devices/project.test.ts`, `src/shared/types.ts`,
  `src/main/devices/ipc.ts`, `src/main/devices/ipc.test.ts`

- [ ] **Step 1: Write the failing tests**

In `src/main/devices/project.test.ts`, import `isIosApp` too
(`import { describeProject, isAndroidApp, isIosApp, projectRoot } from './project'`), and add after
the `isAndroidApp` block:

```ts
describe('isIosApp', () => {
  it('finds an Xcode project or workspace at the root or one folder down', async () => {
    const native = makeDir('deck-dev-')
    mkdirSync(join(native, 'App.xcodeproj'))
    expect(await isIosApp(native)).toBe(true)
    const flutter = makeDir('deck-dev-')
    mkdirSync(join(flutter, 'ios', 'Runner.xcworkspace'), { recursive: true })
    expect(await isIosApp(flutter)).toBe(true)
  })

  it('skips deeper ones, build output, dependencies and files named like one', async () => {
    const dir = makeDir('deck-dev-')
    mkdirSync(join(dir, 'libs', 'demo', 'Demo.xcodeproj'), { recursive: true })
    mkdirSync(join(dir, 'Pods', 'Pods.xcodeproj'), { recursive: true })
    mkdirSync(join(dir, 'build', 'X.xcworkspace'), { recursive: true })
    writeFileSync(join(dir, 'notes.xcodeproj'), '')
    expect(await isIosApp(dir)).toBe(false)
  })
})
```

In the `describeProject` block, every existing expectation gains `ios: false` (for example
`{ root: repo, android: true, ios: false }`), and add:

```ts
  it('an Xcode project in a repository is an iOS app, and Flutter is both', async () => {
    const home = makeDir('deck-dev-home-')
    const ios = makeRepo()
    commit(ios, 'app', { 'App.xcodeproj/project.pbxproj': '// !$*UTF8*$!' })
    expect(await describeProject(ios, home)).toEqual({ root: ios, android: false, ios: true })
    const flutter = makeRepo()
    commit(flutter, 'app', {
      'android/app/src/main/AndroidManifest.xml': '<manifest/>',
      'ios/Runner.xcworkspace/contents.xcworkspacedata': '<Workspace/>',
    })
    expect(await describeProject(flutter, home)).toEqual({ root: flutter, android: true, ios: true })
  })

  it('outside git, only the folder itself is looked at for an Xcode project', async () => {
    const home = makeDir('deck-dev-home-')
    const copied = makeDir('deck-dev-')
    mkdirSync(join(copied, 'App.xcworkspace'))
    expect(await describeProject(copied, home)).toEqual({ root: copied, android: false, ios: true })
    const plain = makeDir('deck-dev-')
    mkdirSync(join(plain, 'some', 'App.xcodeproj'), { recursive: true })
    expect(await describeProject(plain, home)).toEqual({ root: plain, android: false, ios: false })
  })
```

(`writeFileSync` is already imported; add nothing else.)

- [ ] **Step 2: Run them and watch them fail**

Run: `npx vitest run src/main/devices/project.test.ts`
Expected: FAIL: `isIosApp` isn't exported, and `describeProject` answers without `ios`.

- [ ] **Step 3: Implement**

In `src/main/devices/project.ts`, after `isAndroidApp`:

```ts
/** An Xcode project or workspace: a folder Xcode opens. */
const isXcode = (name: string) => name.endsWith('.xcodeproj') || name.endsWith('.xcworkspace')

async function hasXcode(dir: string): Promise<boolean> {
  const entries = await readdir(dir, { withFileTypes: true }).catch(() => [])
  return entries.some((e) => e.isDirectory() && isXcode(e.name))
}

/** An iOS app has an Xcode project or workspace at the project's root (`App.xcodeproj`) or in a
 *  first-level folder (`ios/Runner.xcworkspace`: Flutter, React Native). A Mac-only one counts too. */
export async function isIosApp(root: string): Promise<boolean> {
  if (await hasXcode(root)) return true
  return (await Promise.all((await subfolders(root)).map(hasXcode))).some(Boolean)
}
```

and replace `describeProject` (keep its doc comment, adding the iOS rule):

```ts
/** … (as before) … Outside git, an Xcode project counts only in the folder itself. */
export async function describeProject(folder: string, home: string): Promise<{ root: string; android: boolean; ios: boolean }> {
  const { root, git } = await findRoot(folder)
  const realHome = await realpath(home).catch(() => resolve(home))
  if (pathKey(resolve(root)) === pathKey(realHome)) return { root, android: false, ios: false }
  if (!git) {
    const [android, ios] = await Promise.all([
      isGradleProject(root).then((gradle) => gradle && isAndroidApp(root)),
      hasXcode(root),
    ])
    return { root, android, ios }
  }
  const [android, ios] = await Promise.all([isAndroidApp(root), isIosApp(root)])
  return { root, android, ios }
}
```

In `src/shared/types.ts`, `DeviceProject` gains after `android`:

```ts
  /** It's an iOS app (an Xcode project or workspace), so it takes simulators. */
  ios: boolean
```

In `src/main/devices/ipc.ts`, the projects cache's value type becomes
`Promise<{ root: string; android: boolean; ios: boolean }>`, and `devices:project` returns
`{ root, android, ios, picks: picked }` (destructure `ios` from `describe(folder)`). In
`ipc.test.ts`, the `devices:project` expectations gain `ios: false`.

- [ ] **Step 4: Run the tests and the typecheck**

Run: `npx vitest run src/main/devices && npm run typecheck`
Expected: PASS.

- [ ] **Step 5: Commit**

```bash
git add src/main/devices/project.ts src/main/devices/project.test.ts src/shared/types.ts src/main/devices/ipc.ts src/main/devices/ipc.test.ts
git -c user.email=franco@effektstudios.com commit -m "Devices: an Xcode project makes an iOS app

Claude-Session: https://claude.ai/code/session_012TidnBvRYbxhSYqPzFZuph"
```

---

### Task 3: idb's messages

The few protobuf messages Deck sends to `idb_companion` and the one it reads, and gRPC's message
framing, by hand.

**Files:**
- Create: `src/main/devices/ios/proto.ts`, `src/main/devices/ios/proto.test.ts`,
  `src/main/devices/ios/test-fixtures.ts`

- [ ] **Step 1: Write the fixtures and the failing tests**

The hex below was produced by protobufjs from idb's message definitions (2026-11-10), so the
encoder is checked against an independent implementation. Create
`src/main/devices/ios/test-fixtures.ts`:

```ts
/** Test data for the simulator code: protobuf from protobufjs, fMP4 built box by box. */

/** idb's describe answer: udid "U1", name "iPhone 17", state "Booted", 1206×2622 px at 3×,
 *  402×874 points (protobufjs, 2026-11-10). */
export const DESCRIBE_ANSWER = Buffer.from(
  '0a2e0a02553112096950686f6e652031371a1508b60910be1419000000000000084020920328ea062206426f6f746564',
  'hex',
)
```

Create `src/main/devices/ios/proto.test.ts`:

```ts
import { describe, expect, it } from 'vitest'
import { buttonEvent, grpcFrame, grpcMessages, HOME_BUTTON, keyEvent, parseDescribe, touchEvent } from './proto'
import { DESCRIBE_ANSWER } from './test-fixtures'

const hex = (b: Buffer) => b.toString('hex')

describe("idb's HID events", () => {
  // Every expected value is protobufjs's encoding of the same message (2026-11-10).
  it('touches, with both coordinates and the direction written out', () => {
    expect(hex(touchEvent(201.5, 437, false))).toBe('0a1a0a160a140a12090000000000306940110000000000507b401000')
    expect(hex(touchEvent(201.5, 437, true))).toBe('0a1a0a160a140a12090000000000306940110000000000507b401001')
    expect(hex(touchEvent(0, 12, false))).toBe('0a1a0a160a140a120900000000000000001100000000000028401000')
  })

  it('the Home button, and keys by HID usage', () => {
    expect(hex(buttonEvent(HOME_BUTTON, false))).toBe('0a080a04120208011000')
    expect(hex(buttonEvent(HOME_BUTTON, true))).toBe('0a080a04120208011001')
    expect(hex(keyEvent(4, false))).toBe('0a080a041a0208041000')
    expect(hex(keyEvent(225, true))).toBe('0a090a051a0308e1011001')
  })
})

describe('parseDescribe', () => {
  it("reads the screen's pixels and points", () => {
    expect(parseDescribe(DESCRIBE_ANSWER)).toEqual({ width: 1206, height: 2622, widthPoints: 402, heightPoints: 874 })
  })

  it('refuses an answer without a screen, or a broken one', () => {
    expect(() => parseDescribe(Buffer.from('0a040a025531', 'hex'))).toThrow("didn't say its screen size")
    expect(() => parseDescribe(Buffer.from('0a2e0a02', 'hex'))).toThrow('truncated')
    expect(() => parseDescribe(Buffer.from('0f', 'hex'))).toThrow("isn't protobuf's")
  })
})

describe('gRPC framing', () => {
  it('prefixes a message with no compression and its length, and reads them back', () => {
    const framed = Buffer.concat([grpcFrame(Buffer.from([1, 2, 3])), grpcFrame(Buffer.alloc(0))])
    expect(hex(framed)).toBe('0000000003010203' + '0000000000')
    expect(grpcMessages(framed).map(hex)).toEqual(['010203', ''])
  })

  it('refuses compressed or truncated messages', () => {
    expect(() => grpcMessages(Buffer.from('0100000000', 'hex'))).toThrow('compressed')
    expect(() => grpcMessages(Buffer.from('00000000050102', 'hex'))).toThrow('truncated')
    expect(() => grpcMessages(Buffer.from('0000', 'hex'))).toThrow('truncated')
  })
})
```

- [ ] **Step 2: Run them and watch them fail**

Run: `npx vitest run src/main/devices/ios/proto.test.ts`
Expected: FAIL: `./proto` doesn't exist.

- [ ] **Step 3: Implement**

Create `src/main/devices/ios/proto.ts`:

```ts
/** idb's gRPC messages, as Deck uses them, written by hand: HID events (touches, the Home button,
 *  keys) and describe's answer. Field numbers follow idb's proto/idb.proto (MIT, Meta Platforms; see
 *  resources/THIRD-PARTY-NOTICES.txt). Fields are all written, as protobufjs writes them. */

export const DESCRIBE_PATH = '/idb.CompanionService/describe'
export const HID_PATH = '/idb.CompanionService/hid'

/** HIDEvent.HIDButtonType.HOME */
export const HOME_BUTTON = 1

function varint(n: number): number[] {
  const out: number[] = []
  let v = n
  do {
    let byte = v % 128
    v = Math.floor(v / 128)
    if (v > 0) byte |= 0x80
    out.push(byte)
  } while (v > 0)
  return out
}

const tag = (field: number, wire: number) => varint(field * 8 + wire)
const bytesField = (field: number, payload: Buffer) => Buffer.concat([Buffer.from([...tag(field, 2), ...varint(payload.length)]), payload])
const varintField = (field: number, n: number) => Buffer.from([...tag(field, 0), ...varint(n)])

function doubleField(field: number, x: number): Buffer {
  const out = Buffer.alloc(9)
  out[0] = tag(field, 1)[0] // fields 1 and 2: a one-byte tag
  out.writeDoubleLE(x, 1)
  return out
}

/** HIDEvent { press: HIDPress { action, direction } }: direction DOWN 0, UP 1. */
function press(action: Buffer, up: boolean): Buffer {
  return bytesField(1, Buffer.concat([bytesField(1, action), varintField(2, up ? 1 : 0)]))
}

/** A finger down or up at a point, in the screen's points. idb has no move: a finger put down
 *  somewhere else moves there. */
export function touchEvent(x: number, y: number, up: boolean): Buffer {
  const point = Buffer.concat([doubleField(1, x), doubleField(2, y)])
  return press(bytesField(1, bytesField(1, point)), up) // HIDPressAction.touch: HIDTouch { point }
}

/** A hardware button (HIDButtonType) pressed or let go. */
export function buttonEvent(button: number, up: boolean): Buffer {
  return press(bytesField(2, varintField(1, button)), up)
}

/** A key, by its USB HID usage (keyboard page), pressed or let go. */
export function keyEvent(usage: number, up: boolean): Buffer {
  return press(bytesField(3, varintField(1, usage)), up)
}

interface Field {
  field: number
  wire: number
  value: number | Buffer
}

/** A message's fields in order: varints and doubles as numbers, length-delimited ones as bytes. */
function fields(buf: Buffer): Field[] {
  const out: Field[] = []
  let at = 0
  const need = (n: number) => {
    if (at + n > buf.length) throw new Error("idb's answer is truncated.")
  }
  const readVarint = (): number => {
    let result = 0
    let scale = 1
    for (;;) {
      need(1)
      const byte = buf[at++]
      result += (byte & 0x7f) * scale
      if (byte < 0x80) return result
      scale *= 128
      if (scale > 2 ** 63) throw new Error("idb's answer has a varint too long.")
    }
  }
  while (at < buf.length) {
    const key = readVarint()
    const field = Math.floor(key / 8)
    const wire = key % 8
    if (wire === 0) out.push({ field, wire, value: readVarint() })
    else if (wire === 1) {
      need(8)
      out.push({ field, wire, value: buf.readDoubleLE(at) })
      at += 8
    } else if (wire === 2) {
      const n = readVarint()
      need(n)
      out.push({ field, wire, value: buf.subarray(at, at + n) })
      at += n
    } else if (wire === 5) {
      need(4)
      at += 4 // a 32-bit field: none that Deck reads
    } else throw new Error(`Wire type ${wire} isn't protobuf's.`)
  }
  return out
}

const message = (fs: Field[], n: number): Buffer | undefined => {
  const f = fs.find((x) => x.field === n && x.wire === 2)
  return f ? (f.value as Buffer) : undefined
}
const number = (fs: Field[], n: number): number => {
  const f = fs.find((x) => x.field === n && x.wire !== 2)
  return typeof f?.value === 'number' ? f.value : 0
}

/** A simulator's screen: in pixels, and in the points touches are given in. */
export interface ScreenSize {
  width: number
  height: number
  widthPoints: number
  heightPoints: number
}

/** describe's answer: TargetDescriptionResponse.target_description.screen_dimensions. */
export function parseDescribe(answer: Buffer): ScreenSize {
  const target = message(fields(answer), 1)
  const screen = target && message(fields(target), 3)
  if (!screen) throw new Error("The simulator didn't say its screen size.")
  const s = fields(screen)
  const size = { width: number(s, 1), height: number(s, 2), widthPoints: number(s, 4), heightPoints: number(s, 5) }
  if (Object.values(size).some((v) => !Number.isInteger(v) || v <= 0 || v > 65535)) {
    throw new Error("The simulator's screen size makes no sense.")
  }
  return size
}

/** gRPC's length-prefixed message: a zero byte (not compressed), then the length, big-endian. */
export function grpcFrame(payload: Buffer): Buffer {
  const head = Buffer.alloc(5)
  head.writeUInt32BE(payload.length, 1)
  return Buffer.concat([head, payload])
}

/** The messages in a gRPC body. Deck asks for no compression, so a compressed one is refused. */
export function grpcMessages(body: Buffer): Buffer[] {
  const out: Buffer[] = []
  let at = 0
  while (at < body.length) {
    if (at + 5 > body.length) throw new Error('A truncated gRPC message.')
    if (body[at] !== 0) throw new Error('A compressed gRPC message.')
    const n = body.readUInt32BE(at + 1)
    if (at + 5 + n > body.length) throw new Error('A truncated gRPC message.')
    out.push(body.subarray(at + 5, at + 5 + n))
    at += 5 + n
  }
  return out
}
```

- [ ] **Step 4: Run the tests**

Run: `npx vitest run src/main/devices/ios/proto.test.ts`
Expected: PASS.

- [ ] **Step 5: Commit**

```bash
git add src/main/devices/ios
git -c user.email=franco@effektstudios.com commit -m "Simulators: idb's HID and describe messages, by hand

Claude-Session: https://claude.ai/code/session_012TidnBvRYbxhSYqPzFZuph"
```

---

### Task 4: gRPC on Node's HTTP/2

A unary call (describe) and a client stream kept open (hid) to `idb_companion`'s Unix socket.

**Files:**
- Create: `src/main/devices/ios/grpc.ts`, `src/main/devices/ios/grpc.test.ts`

- [ ] **Step 1: Write the failing tests**

They run a small HTTP/2 server on a Unix socket standing in for the companion. Unix sockets only:
skipped on Windows, where simulators don't exist. Create `src/main/devices/ios/grpc.test.ts`:

```ts
import http2 from 'node:http2'
import { mkdtempSync, rmSync } from 'node:fs'
import { tmpdir } from 'node:os'
import { join } from 'node:path'
import { afterAll, beforeAll, describe, expect, it, vi } from 'vitest'
import { GrpcClient } from './grpc'
import { grpcFrame, grpcMessages } from './proto'

describe.skipIf(process.platform === 'win32')('GrpcClient', () => {
  // A short folder: a Unix socket's path must stay under 104 bytes.
  const dir = mkdtempSync(join(tmpdir(), 'dk-'))
  const socket = join(dir, 's.sock')
  const received: { path: string; messages: Buffer[]; headers: http2.IncomingHttpHeaders }[] = []
  /** Messages of the open hid call, as they arrive. */
  const streamed: Buffer[] = []
  const server = http2.createServer()

  beforeAll(async () => {
    server.on('stream', (stream, headers) => {
      const path = String(headers[':path'])
      const chunks: Buffer[] = []
      let pending = Buffer.alloc(0)
      stream.on('data', (chunk: Buffer) => {
        if (path !== '/test/hid') return void chunks.push(chunk)
        // Whole messages only: one may come in pieces.
        pending = Buffer.concat([pending, chunk])
        while (pending.length >= 5 && pending.length >= 5 + pending.readUInt32BE(1)) {
          const n = 5 + pending.readUInt32BE(1)
          streamed.push(...grpcMessages(pending.subarray(0, n)))
          pending = pending.subarray(n)
        }
      })
      stream.on('end', () => {
        received.push({ path, messages: path === '/test/hid' ? [] : grpcMessages(Buffer.concat(chunks)), headers })
        if (path === '/test/silent') return // never answers
        if (path === '/test/fails') {
          stream.respond({ ':status': 200, 'content-type': 'application/grpc' }, { waitForTrailers: true })
          stream.on('wantTrailers', () => stream.sendTrailers({ 'grpc-status': '5', 'grpc-message': 'No%20such%20simulator' }))
          return stream.end()
        }
        if (path === '/test/trailers-only') {
          return stream.respond({ ':status': 200, 'content-type': 'application/grpc', 'grpc-status': '14', 'grpc-message': 'Unavailable' }, { endStream: true })
        }
        stream.respond({ ':status': 200, 'content-type': 'application/grpc' }, { waitForTrailers: true })
        stream.on('wantTrailers', () => stream.sendTrailers({ 'grpc-status': '0' }))
        stream.end(grpcFrame(Buffer.from('answer')))
      })
    })
    await new Promise<void>((resolve) => server.listen(socket, resolve))
  })
  afterAll(async () => {
    await new Promise<void>((resolve) => server.close(() => resolve()))
    rmSync(dir, { recursive: true, force: true })
  })

  it('makes a unary call: a gRPC POST with the framed message, answered by its one message', async () => {
    const client = new GrpcClient(socket)
    expect((await client.unary('/test/describe', Buffer.from('hi'))).toString()).toBe('answer')
    const call = received.find((r) => r.path === '/test/describe')!
    expect(call.headers['content-type']).toBe('application/grpc')
    expect(call.headers.te).toBe('trailers')
    expect(call.messages.map(String)).toEqual(['hi'])
    client.close()
  })

  it("rejects with the server's own words, from trailers or a trailers-only answer", async () => {
    const client = new GrpcClient(socket)
    await expect(client.unary('/test/fails', Buffer.alloc(0))).rejects.toThrow('No such simulator')
    await expect(client.unary('/test/trailers-only', Buffer.alloc(0))).rejects.toThrow('Unavailable')
    client.close()
  })

  it('gives up on a call that gets no answer', async () => {
    const client = new GrpcClient(socket)
    await expect(client.unary('/test/silent', Buffer.alloc(0), 200)).rejects.toThrow("didn't answer")
    client.close()
  })

  it('delivers a stream’s messages while the call stays open', async () => {
    const client = new GrpcClient(socket)
    const call = client.stream('/test/hid')
    call.write(Buffer.from('down'))
    await vi.waitFor(() => expect(streamed.map(String)).toEqual(['down']))
    call.write(Buffer.from('up'))
    await vi.waitFor(() => expect(streamed.map(String)).toEqual(['down', 'up']))
    call.close()
    call.write(Buffer.from('late')) // ignored once closed
    await vi.waitFor(() => expect(received.some((r) => r.path === '/test/hid')).toBe(true))
    expect(streamed.map(String)).toEqual(['down', 'up'])
    client.close()
  })

  it('rejects calls when nothing listens on the socket', async () => {
    const client = new GrpcClient(join(dir, 'missing.sock'))
    await expect(client.unary('/test/describe', Buffer.alloc(0))).rejects.toThrow()
    client.close()
  })
})
```

- [ ] **Step 2: Run them and watch them fail**

Run: `npx vitest run src/main/devices/ios/grpc.test.ts`
Expected: FAIL: `./grpc` doesn't exist.

- [ ] **Step 3: Implement**

Create `src/main/devices/ios/grpc.ts`:

```ts
import http2 from 'node:http2'
import net from 'node:net'
import { grpcFrame, grpcMessages } from './proto'

/** A client-streaming call kept open: each message goes as it's written. */
export interface GrpcStream {
  write(message: Buffer): void
  /** Ends the call; its answer isn't read. */
  close(): void
}

const headers = (path: string) => ({ ':method': 'POST', ':path': path, 'content-type': 'application/grpc', te: 'trailers' })

/** gRPC's status message is percent-encoded. */
function readable(message: string): string {
  try {
    return decodeURIComponent(message)
  } catch {
    return message
  }
}

/** gRPC to idb_companion over its Unix socket, on Node's own HTTP/2: Deck makes two kinds of call
 *  (describe and hid), which a gRPC library and its protobuf loader would add 12 MB for. */
export class GrpcClient {
  private readonly session: http2.ClientHttp2Session
  /** Why the connection failed, for the calls it takes down. */
  private failure: Error | null = null

  constructor(socket: string) {
    this.session = http2.connect('http://localhost', { createConnection: () => net.connect(socket) })
    this.session.on('error', (err) => {
      this.failure = err
    })
  }

  /** One message there, one back: the answer's message, or the server's own words for a failure. */
  unary(path: string, message: Buffer, timeoutMs = 10_000): Promise<Buffer> {
    return new Promise((resolve, reject) => {
      const req = this.session.request(headers(path))
      const chunks: Buffer[] = []
      let status: string | undefined
      let detail = ''
      let timedOut = false
      const timer = setTimeout(() => {
        timedOut = true
        req.close(http2.constants.NGHTTP2_CANCEL)
      }, timeoutMs)
      const read = (h: http2.IncomingHttpHeaders) => {
        if (h['grpc-status'] !== undefined) status = String(h['grpc-status'])
        if (h['grpc-message'] !== undefined) detail = readable(String(h['grpc-message']))
      }
      // A call that fails before any message answers "trailers-only": the status is in the headers.
      req.on('response', read)
      req.on('trailers', read)
      req.on('data', (chunk: Buffer) => chunks.push(chunk))
      req.on('error', () => {}) // 'close' settles the call
      req.on('close', () => {
        clearTimeout(timer)
        if (timedOut) return reject(new Error(`idb didn't answer ${path} within ${Math.round(timeoutMs / 1000)} s.`))
        if (status === undefined && this.failure) return reject(this.failure)
        if (status !== '0') return reject(new Error(detail || `idb answered ${path} with gRPC status ${status ?? 'none'}.`))
        try {
          const [answer] = grpcMessages(Buffer.concat(chunks))
          if (!answer) throw new Error(`idb sent no answer to ${path}.`)
          resolve(answer)
        } catch (err) {
          reject(err)
        }
      })
      req.end(grpcFrame(message))
    })
  }

  /** A client stream kept open (idb's hid): idb acts on each message as it comes. */
  stream(path: string): GrpcStream {
    const req = this.session.request(headers(path))
    req.on('error', () => {}) // a call reset with the connection: the session's end says why
    req.resume() // the answer isn't read
    return {
      write: (message) => {
        if (!req.destroyed && !req.writableEnded) req.write(grpcFrame(message))
      },
      close: () => {
        if (!req.destroyed && !req.writableEnded) req.end()
      },
    }
  }

  close(): void {
    this.session.close()
  }
}
```

- [ ] **Step 4: Run the tests**

Run: `npx vitest run src/main/devices/ios/grpc.test.ts`
Expected: PASS.

- [ ] **Step 5: Commit**

```bash
git add src/main/devices/ios/grpc.ts src/main/devices/ios/grpc.test.ts
git -c user.email=franco@effektstudios.com commit -m "Simulators: gRPC on Node's own HTTP/2

Claude-Session: https://claude.ai/code/session_012TidnBvRYbxhSYqPzFZuph"
```

---

### Task 5: sim-video's fragmented MP4

Cut the fMP4 byte stream into the packets the view decodes: the init segment's SPS and PPS as a
config packet, each `mdat` as one picture, with Annex B start codes.

**Files:**
- Create: `src/main/devices/ios/fmp4.ts`, `src/main/devices/ios/fmp4.test.ts`
- Modify: `src/main/devices/ios/test-fixtures.ts`

- [ ] **Step 1: Add fMP4 fixtures and write the failing tests**

Append to `src/main/devices/ios/test-fixtures.ts`:

```ts
const u16 = (n: number) => {
  const b = Buffer.alloc(2)
  b.writeUInt16BE(n)
  return b
}
const u32 = (n: number) => {
  const b = Buffer.alloc(4)
  b.writeUInt32BE(n)
  return b
}

/** An MP4 box: its size, its type, then its body. */
export function box(type: string, ...body: Buffer[]): Buffer {
  const content = Buffer.concat(body)
  const head = Buffer.alloc(8)
  head.writeUInt32BE(8 + content.length)
  head.write(type, 4, 'latin1')
  return Buffer.concat([head, content])
}

export const SPS = Buffer.from([0x67, 0x64, 0x00, 0x1f, 0xac, 0xd9])
export const PPS = Buffer.from([0x68, 0xeb, 0xe3, 0xcb])

/** A NAL unit of `header`'s type (0x65 an IDR slice, 0x41 a P slice) and `n` bytes. */
export const nal = (header: number, n = 6) => Buffer.from([header, ...Array<number>(n - 1).fill(0xab)])

/** The init segment sim-video writes: ftyp, then moov › trak › mdia › minf › stbl › stsd › avc1
 *  (`width`×`height`) › avcC with one SPS and one PPS and `lengthSize`-byte NAL lengths. */
export function initSegment(width = 604, height = 1312, lengthSize = 4): Buffer {
  const avcC = box('avcC', Buffer.from([1, 0x64, 0x00, 0x1f, 0xfc | (lengthSize - 1), 0xe1]), u16(SPS.length), SPS, Buffer.from([1]), u16(PPS.length), PPS)
  const fields = Buffer.alloc(78) // a visual sample entry's fields, width and height at 24 and 26
  fields.writeUInt16BE(width, 24)
  fields.writeUInt16BE(height, 26)
  const stsd = box('stsd', Buffer.from([0, 0, 0, 0, 0, 0, 0, 1]), box('avc1', fields, avcC))
  const trak = box('trak', box('tkhd', Buffer.alloc(84)), box('mdia', box('mdhd', Buffer.alloc(24)), box('minf', box('stbl', stsd))))
  return Buffer.concat([box('ftyp', Buffer.from('isom')), box('moov', box('mvhd', Buffer.alloc(100)), trak)])
}

/** One fragment: a moof, then an mdat with `nals`, each behind a `lengthSize`-byte length. */
export function fragment(nals: Buffer[], lengthSize = 4): Buffer {
  const lengths = nals.map((x) => {
    const b = Buffer.alloc(lengthSize)
    b.writeUIntBE(x.length, 0, lengthSize)
    return Buffer.concat([b, x])
  })
  return Buffer.concat([box('moof', Buffer.alloc(92)), box('mdat', ...lengths)])
}

export { u16, u32 }
```

Create `src/main/devices/ios/fmp4.test.ts`:

```ts
import { describe, expect, it } from 'vitest'
import { Fmp4Reader, MAX_BOX } from './fmp4'
import { box, fragment, initSegment, nal, PPS, SPS, u32 } from './test-fixtures'

const START = Buffer.from([0, 0, 0, 1])
const stream = () => Buffer.concat([initSegment(), fragment([nal(0x65)]), fragment([nal(0x41)])])
const expected = [
  { type: 'config', width: 604, height: 1312, data: Buffer.concat([START, SPS, START, PPS]) },
  { type: 'frame', key: true, data: Buffer.concat([START, nal(0x65)]) },
  { type: 'frame', key: false, data: Buffer.concat([START, nal(0x41)]) },
]

describe('Fmp4Reader', () => {
  it('turns the init segment into a config packet and each fragment into a picture', () => {
    expect(new Fmp4Reader().push(stream())).toEqual(expected)
  })

  it('reads the same from chunks split anywhere', () => {
    const bytes = stream()
    for (const size of [1, 3, 7, 50]) {
      const reader = new Fmp4Reader()
      const events = []
      for (let at = 0; at < bytes.length; at += size) events.push(...reader.push(bytes.subarray(at, at + size)))
      expect(events).toEqual(expected)
    }
  })

  it('takes 2-byte NAL lengths, several NALs per picture, and a second init segment', () => {
    const reader = new Fmp4Reader()
    const events = reader.push(Buffer.concat([initSegment(604, 1312, 2), fragment([nal(0x06, 3), nal(0x65)], 2), initSegment(1312, 604)]))
    expect(events[1]).toEqual({ type: 'frame', key: true, data: Buffer.concat([START, nal(0x06, 3), START, nal(0x65)]) })
    expect(events[2]).toMatchObject({ type: 'config', width: 1312, height: 604 })
  })

  it('refuses a picture before the init segment, a box out of bounds, and broken pictures', () => {
    expect(() => new Fmp4Reader().push(fragment([nal(0x65)]))).toThrow('before its configuration')
    expect(() => new Fmp4Reader().push(Buffer.concat([u32(4), Buffer.from('mdat')]))).toThrow('of 4 bytes')
    expect(() => new Fmp4Reader().push(Buffer.concat([u32(MAX_BOX + 1), Buffer.from('mdat')]))).toThrow('bytes')
    const bad = Buffer.concat([initSegment(), box('mdat', u32(50), nal(0x65))]) // a length past the end
    expect(() => new Fmp4Reader().push(bad)).toThrow('broken picture')
    expect(() => new Fmp4Reader().push(Buffer.concat([initSegment(), box('mdat')]))).toThrow('empty picture')
  })

  it('refuses an init segment without H.264', () => {
    expect(() => new Fmp4Reader().push(box('moov', box('mvhd', Buffer.alloc(100))))).toThrow('no H.264 track')
  })
})
```

- [ ] **Step 2: Run them and watch them fail**

Run: `npx vitest run src/main/devices/ios/fmp4.test.ts`
Expected: FAIL: `./fmp4` doesn't exist.

- [ ] **Step 3: Implement**

Create `src/main/devices/ios/fmp4.ts`:

```ts
/** sim-video's fragmented MP4, turned into the packets the view decodes (H.264, Annex B): the init
 *  segment's SPS and PPS as a config packet, then each fragment's picture. fMP4 rather than
 *  sim-video's own Annex B output: that has no delimiters, so a picture is only known to be complete
 *  once the next one starts, and a still screen sends no next one. */

/** A box larger than this is a broken stream, not a picture: scrcpy's packets have the same cap. */
export const MAX_BOX = 16 * 1024 * 1024

export type Fmp4Event =
  /** An init segment: the size pictures come at, and SPS and PPS for the next key frame. */
  | { type: 'config'; width: number; height: number; data: Buffer }
  /** One picture. */
  | { type: 'frame'; key: boolean; data: Buffer }

const START = Buffer.from([0, 0, 0, 1])

/** The child boxes in a box's body. */
function* children(body: Buffer): Generator<[string, Buffer]> {
  let at = 0
  while (at + 8 <= body.length) {
    const size = body.readUInt32BE(at)
    if (size < 8 || at + size > body.length) throw new Error("sim-video's init segment is broken.")
    yield [body.toString('latin1', at + 4, at + 8), body.subarray(at + 8, at + size)]
    at += size
  }
}

function child(body: Buffer, type: string): Buffer | undefined {
  for (const [t, b] of children(body)) if (t === type) return b
  return undefined
}

/** AVCDecoderConfigurationRecord: the NAL length's size, and the SPS and PPS. */
function parseAvcC(record: Buffer): { lengthSize: number; sps: Buffer[]; pps: Buffer[] } {
  const broken = () => new Error("sim-video's H.264 configuration is broken.")
  if (record.length < 7 || record[0] !== 1) throw broken()
  const lengthSize = (record[4] & 0x03) + 1
  if (lengthSize === 3) throw broken()
  let at = 5
  const read = (count: number): Buffer[] => {
    const out: Buffer[] = []
    for (let i = 0; i < count; i++) {
      if (at + 2 > record.length) throw broken()
      const n = record.readUInt16BE(at)
      if (n === 0 || at + 2 + n > record.length) throw broken()
      out.push(record.subarray(at + 2, at + 2 + n))
      at += 2 + n
    }
    return out
  }
  const sps = read(record[at++] & 0x1f)
  if (at >= record.length) throw broken()
  const pps = read(record[at++])
  return { lengthSize, sps, pps }
}

/** Top-level boxes read from a byte stream split anywhere; each is handled once all of it is in.
 *  Chunks are joined only per box, so memory stays about one box. */
export class Fmp4Reader {
  private chunks: Buffer[] = []
  private buffered = 0
  /** From the init segment's avcC; 0 until one came. */
  private lengthSize = 0

  push(chunk: Buffer): Fmp4Event[] {
    this.chunks.push(chunk)
    this.buffered += chunk.length
    const events: Fmp4Event[] = []
    for (;;) {
      if (this.buffered < 8) return events
      const head = this.peek(8)
      const size = head.readUInt32BE(0)
      const type = head.toString('latin1', 4, 8)
      if (size < 8 || size > MAX_BOX) throw new Error(`sim-video sent a ${type} box of ${size} bytes.`)
      if (this.buffered < size) return events
      const body = this.take(size).subarray(8)
      if (type === 'moov') events.push(this.init(body))
      else if (type === 'mdat') events.push(this.picture(body))
      // ftyp and each picture's moof: nothing the view needs (it keeps its own timestamps).
    }
  }

  private peek(n: number): Buffer {
    if (this.chunks[0].length < n) this.chunks = [Buffer.concat(this.chunks)]
    return this.chunks[0].subarray(0, n)
  }

  private take(n: number): Buffer {
    const all = this.chunks.length === 1 ? this.chunks[0] : Buffer.concat(this.chunks)
    const rest = all.subarray(n)
    this.chunks = rest.length > 0 ? [rest] : []
    this.buffered -= n
    return all.subarray(0, n)
  }

  /** moov › trak › mdia › minf › stbl › stsd › avc1 › avcC: the video's size, SPS and PPS. */
  private init(moov: Buffer): Fmp4Event {
    let stsd: Buffer | undefined = moov
    for (const type of ['trak', 'mdia', 'minf', 'stbl', 'stsd']) stsd = stsd && child(stsd, type)
    // stsd is a full box with an entry count; avc1 is a visual sample entry, whose 78 bytes of
    // fields (width and height at 24 and 26) come before its own boxes.
    const avc1 = stsd && stsd.length > 8 ? child(stsd.subarray(8), 'avc1') : undefined
    if (!avc1 || avc1.length < 78) throw new Error('sim-video sent no H.264 track.')
    const width = avc1.readUInt16BE(24)
    const height = avc1.readUInt16BE(26)
    const avcC = child(avc1.subarray(78), 'avcC')
    if (!avcC) throw new Error('sim-video sent no H.264 configuration.')
    const { lengthSize, sps, pps } = parseAvcC(avcC)
    if (width === 0 || height === 0 || sps.length === 0 || pps.length === 0) throw new Error("sim-video's video makes no sense.")
    this.lengthSize = lengthSize
    return { type: 'config', width, height, data: Buffer.concat([...sps, ...pps].flatMap((n) => [START, n])) }
  }

  /** An mdat: one picture's NAL units, each behind its length. */
  private picture(mdat: Buffer): Fmp4Event {
    if (this.lengthSize === 0) throw new Error('sim-video sent a picture before its configuration.')
    const parts: Buffer[] = []
    let key = false
    let at = 0
    while (at < mdat.length) {
      if (at + this.lengthSize > mdat.length) throw new Error('sim-video sent a broken picture.')
      const n = mdat.readUIntBE(at, this.lengthSize)
      at += this.lengthSize
      if (n === 0 || at + n > mdat.length) throw new Error('sim-video sent a broken picture.')
      if ((mdat[at] & 0x1f) === 5) key = true // an IDR slice
      parts.push(START, mdat.subarray(at, at + n))
      at += n
    }
    if (parts.length === 0) throw new Error('sim-video sent an empty picture.')
    return { type: 'frame', key, data: Buffer.concat(parts) }
  }
}
```

- [ ] **Step 4: Run the tests**

Run: `npx vitest run src/main/devices/ios/fmp4.test.ts`
Expected: PASS.

- [ ] **Step 5: Commit**

```bash
git add src/main/devices/ios
git -c user.email=franco@effektstudios.com commit -m "Simulators: sim-video's fragmented MP4 as Annex B packets

Claude-Session: https://claude.ai/code/session_012TidnBvRYbxhSYqPzFZuph"
```

---

### Task 6: A simulator's input

The renderer's touches, text, pastes, named keys and the Home button, checked and turned into idb's
HID events.

**Files:**
- Create: `src/main/devices/ios/input.ts`, `src/main/devices/ios/input.test.ts`

- [ ] **Step 1: Write the failing tests**

Create `src/main/devices/ios/input.test.ts`:

```ts
import { describe, expect, it } from 'vitest'
import { HID_KEY, HID_MOD } from '@shared/hid'
import { MAX_TEXT, simulatorEvents, typeText } from './input'
import { buttonEvent, HOME_BUTTON, keyEvent, touchEvent } from './proto'

const points = { width: 402, height: 874 }
const down = (u: number) => keyEvent(u, false)
const up = (u: number) => keyEvent(u, true)
const SHIFT = 225

describe('simulatorEvents', () => {
  it("maps a touch in the frame's pixels to the screen's points; a move is a touch down", () => {
    const frame = { width: 604, height: 1312 }
    expect(simulatorEvents({ type: 'touch', action: 'down', x: 302, y: 656, ...frame }, points)).toEqual([touchEvent(201, 437, false)])
    expect(simulatorEvents({ type: 'touch', action: 'move', x: 0, y: 1312, ...frame }, points)).toEqual([touchEvent(0, 874, false)])
    expect(simulatorEvents({ type: 'touch', action: 'up', x: 700, y: -5, ...frame }, points)).toEqual([touchEvent(402, 0, true)])
  })

  it('drops touches that make no sense', () => {
    for (const bad of [
      { type: 'touch', action: 'hover', x: 1, y: 1, width: 10, height: 10 },
      { type: 'touch', action: 'down', x: Number.NaN, y: 1, width: 10, height: 10 },
      { type: 'touch', action: 'down', x: 1, y: 1, width: 0, height: 10 },
      { type: 'touch', action: 'down', x: 1, y: 1, width: 10, height: 70000 },
    ]) expect(simulatorEvents(bad, points)).toEqual([])
  })

  it('types text and pastes as a US keyboard would, Shift held where needed', () => {
    const typed = [down(SHIFT), down(4), up(4), up(SHIFT), down(5), up(5), down(30), up(30), down(SHIFT), down(30), up(30), up(SHIFT)]
    expect(simulatorEvents({ type: 'text', text: 'Ab1!' }, points)).toEqual(typed)
    expect(simulatorEvents({ type: 'paste', text: 'Ab1!' }, points)).toEqual(typed)
  })

  it('presses a named key with its modifiers around it, in order', () => {
    expect(simulatorEvents({ type: 'hid', usage: HID_KEY.BACKSPACE, modifiers: HID_MOD.ALT }, points))
      .toEqual([down(226), down(42), up(42), up(226)])
    expect(simulatorEvents({ type: 'hid', usage: HID_KEY.LEFT, modifiers: HID_MOD.CMD | HID_MOD.SHIFT }, points))
      .toEqual([down(225), down(227), down(80), up(80), up(227), up(225)])
  })

  it('takes only named keys and known modifiers', () => {
    expect(simulatorEvents({ type: 'hid', usage: 4, modifiers: 0 }, points)).toEqual([])
    expect(simulatorEvents({ type: 'hid', usage: HID_KEY.ENTER, modifiers: 16 }, points)).toEqual([])
    expect(simulatorEvents({ type: 'hid', usage: HID_KEY.ENTER, modifiers: 1.5 }, points)).toEqual([])
  })

  it('presses Home, and ignores what a simulator has no use for', () => {
    expect(simulatorEvents({ type: 'button', button: 'home' }, points)).toEqual([buttonEvent(HOME_BUTTON, false), buttonEvent(HOME_BUTTON, true)])
    expect(simulatorEvents({ type: 'button', button: 'power' }, points)).toEqual([])
    expect(simulatorEvents({ type: 'key', keycode: 3, meta: 0 }, points)).toEqual([])
    expect(simulatorEvents({ type: 'scroll', x: 1, y: 1, width: 10, height: 10, dx: 0, dy: 1 }, points)).toEqual([])
    expect(simulatorEvents(null, points)).toEqual([])
  })
})

describe('typeText', () => {
  it('turns newlines into Return and skips what a US keyboard has no key for', () => {
    expect(typeText('a\r\nb')).toEqual([down(4), up(4), down(40), up(40), down(5), up(5)])
    expect(typeText('é✓')).toEqual([])
  })

  it(`types at most ${MAX_TEXT} characters`, () => {
    expect(typeText('a'.repeat(MAX_TEXT + 5))).toHaveLength(MAX_TEXT * 2)
  })
})
```

- [ ] **Step 2: Run them and watch them fail**

Run: `npx vitest run src/main/devices/ios/input.test.ts`
Expected: FAIL: `./input` doesn't exist.

- [ ] **Step 3: Implement**

Create `src/main/devices/ios/input.ts`:

```ts
import { HID_KEY, HID_MOD } from '@shared/hid'
import { buttonEvent, HOME_BUTTON, keyEvent, touchEvent } from './proto'

/** The screen in points, as idb takes touches. */
export interface Points {
  width: number
  height: number
}

const SPACE = 44
const LEFT_CTRL = 224
const LEFT_SHIFT = 225
const LEFT_ALT = 226
const LEFT_GUI = 227

/** The renderer's modifier bits as their keys, pressed in this order and let go in reverse. */
const MODIFIERS: [number, number][] = [[HID_MOD.SHIFT, LEFT_SHIFT], [HID_MOD.CTRL, LEFT_CTRL], [HID_MOD.ALT, LEFT_ALT], [HID_MOD.CMD, LEFT_GUI]]

const NAMED = new Set<number>(Object.values(HID_KEY))

/** A US keyboard's characters: [usage, Shift held]. */
const US = new Map<string, [number, boolean]>()
for (let i = 0; i < 26; i++) {
  US.set(String.fromCharCode(97 + i), [4 + i, false])
  US.set(String.fromCharCode(65 + i), [4 + i, true])
}
;[...'1234567890'].forEach((c, i) => US.set(c, [30 + i, false]))
;[...'!@#$%^&*()'].forEach((c, i) => US.set(c, [30 + i, true]))
for (const [plain, shifted, usage] of [
  ['-', '_', 45], ['=', '+', 46], ['[', '{', 47], [']', '}', 48], ['\\', '|', 49], [';', ':', 51],
  ["'", '"', 52], ['`', '~', 53], [',', '<', 54], ['.', '>', 55], ['/', '?', 56],
] as const) {
  US.set(plain, [usage, false])
  US.set(shifted, [usage, true])
}
US.set('\n', [HID_KEY.ENTER, false])
US.set('\t', [HID_KEY.TAB, false])
US.set(' ', [SPACE, false])

/** Text typed or pasted on a simulator goes key by key: at most this many characters. */
export const MAX_TEXT = 1000

function press(modifiers: number[], usage: number): Buffer[] {
  return [
    ...modifiers.map((k) => keyEvent(k, false)),
    keyEvent(usage, false),
    keyEvent(usage, true),
    ...[...modifiers].reverse().map((k) => keyEvent(k, true)),
  ]
}

/** A US keyboard's keys for `text`, newlines as Return. A simulator gets what that keyboard types:
 *  other characters are skipped. A paste goes the same way, not through the simulator's pasteboard,
 *  since iOS would ask "would like to paste from CoreSimulatorBridge" every time. */
export function typeText(text: string): Buffer[] {
  const events: Buffer[] = []
  for (const c of [...text.replace(/\r\n?/g, '\n')].slice(0, MAX_TEXT)) {
    const key = US.get(c)
    if (key) events.push(...press(key[1] ? [LEFT_SHIFT] : [], key[0]))
  }
  return events
}

const finite = (v: unknown): v is number => typeof v === 'number' && Number.isFinite(v)
const clamp = (v: number, max: number) => Math.min(Math.max(v, 0), max)

/** The renderer's input for a simulator, checked and turned into idb's HID events; none for what a
 *  simulator has no use for (Android's key codes, the wheel: a simulator scrolls by dragging). */
export function simulatorEvents(input: unknown, points: Points): Buffer[] {
  if (typeof input !== 'object' || input === null) return []
  const i = input as Record<string, unknown>
  switch (i.type) {
    case 'touch': {
      if (i.action !== 'down' && i.action !== 'move' && i.action !== 'up') return []
      if (!finite(i.x) || !finite(i.y) || !finite(i.width) || !finite(i.height)) return []
      if (i.width < 1 || i.height < 1 || i.width > 65535 || i.height > 65535) return []
      // The frame is the screen scaled down, so a pixel of it scales to points by the same ratios.
      const x = clamp(i.x, i.width) * (points.width / i.width)
      const y = clamp(i.y, i.height) * (points.height / i.height)
      return [touchEvent(x, y, i.action === 'up')]
    }
    case 'text':
    case 'paste':
      return typeof i.text === 'string' ? typeText(i.text) : []
    case 'hid': {
      const { usage, modifiers } = i
      if (typeof usage !== 'number' || !NAMED.has(usage)) return []
      if (typeof modifiers !== 'number' || !Number.isInteger(modifiers) || modifiers < 0 || modifiers > 15) return []
      return press(MODIFIERS.filter(([bit]) => (modifiers & bit) !== 0).map(([, key]) => key), usage)
    }
    case 'button':
      return i.button === 'home' ? [buttonEvent(HOME_BUTTON, false), buttonEvent(HOME_BUTTON, true)] : []
    default:
      return []
  }
}
```

- [ ] **Step 4: Run the tests**

Run: `npx vitest run src/main/devices/ios/input.test.ts`
Expected: PASS.

- [ ] **Step 5: Commit**

```bash
git add src/main/devices/ios/input.ts src/main/devices/ios/input.test.ts
git -c user.email=franco@effektstudios.com commit -m "Simulators: touches in points, typing as a US keyboard, Home

Claude-Session: https://claude.ai/code/session_012TidnBvRYbxhSYqPzFZuph"
```

---

### Task 7: Finding idb and following the simulators

Find `idb_companion` and its `sim-video`; tell whether a simulator is booted without idb (for the
install hint); read `--notify` lines; keep one notifier running with restarts.

**Files:**
- Create: `src/main/devices/ios/tools.ts`, `src/main/devices/ios/tools.test.ts`,
  `src/main/devices/ios/simulators.ts`, `src/main/devices/ios/simulators.test.ts`,
  `src/main/devices/ios/test-process.ts`

- [ ] **Step 1: The fake child process for tests**

Create `src/main/devices/ios/test-process.ts`:

```ts
import type { ChildProcess } from 'node:child_process'
import { EventEmitter } from 'node:events'
import { PassThrough } from 'node:stream'

/** A child process for tests: stdio the test writes and reads; kill() and exit() end it as a real
 *  one ends ('exit', then 'close', after its output). */
export interface FakeProcess {
  proc: ChildProcess
  stdin: PassThrough
  stdout: PassThrough
  stderr: PassThrough
  killed(): boolean
  exit(code?: number | null): void
}

export function fakeProcess(): FakeProcess {
  const emitter = new EventEmitter()
  const stdin = new PassThrough()
  const stdout = new PassThrough()
  const stderr = new PassThrough()
  let ended = false
  let killed = false
  const exit = (code: number | null = 0, signal: NodeJS.Signals | null = null) => {
    if (ended) return
    ended = true
    stdout.end()
    stderr.end()
    setImmediate(() => {
      emitter.emit('exit', code, signal)
      emitter.emit('close', code, signal)
    })
  }
  const proc = Object.assign(emitter, {
    stdin,
    stdout,
    stderr,
    kill: () => {
      killed = true
      exit(null, 'SIGTERM')
      return true
    },
  }) as unknown as ChildProcess
  return { proc, stdin, stdout, stderr, killed: () => killed, exit: (code) => exit(code ?? 0) }
}
```

- [ ] **Step 2: Write the failing tests**

Create `src/main/devices/ios/tools.test.ts`:

```ts
import { chmodSync, mkdirSync, mkdtempSync, rmSync, symlinkSync, writeFileSync } from 'node:fs'
import { tmpdir } from 'node:os'
import { delimiter, join } from 'node:path'
import { afterAll, describe, expect, it } from 'vitest'
import { findIdb, idbCandidates, simulatorBooted } from './tools'

const root = mkdtempSync(join(tmpdir(), 'deck-idb-'))
afterAll(() => rmSync(root, { recursive: true, force: true }))

function tool(path: string) {
  mkdirSync(join(path, '..'), { recursive: true })
  writeFileSync(path, '#!/bin/sh\n')
  chmodSync(path, 0o755)
}

describe('idbCandidates', () => {
  it("looks in PATH's absolute folders, then Homebrew's", () => {
    const env = { PATH: ['/usr/bin', 'relative', '/opt/homebrew/bin'].join(delimiter) }
    expect(idbCandidates(env)).toEqual(['/usr/bin', '/opt/homebrew/bin', '/usr/local/bin'].map((d) => join(d, 'idb_companion')))
  })

  it('takes DECK_IDB_COMPANION alone, for checks', () => {
    expect(idbCandidates({ PATH: '/usr/bin', DECK_IDB_COMPANION: '/nowhere/idb_companion' })).toEqual(['/nowhere/idb_companion'])
  })
})

describe('findIdb', () => {
  it.skipIf(process.platform === 'win32')('finds sim-video beside the real idb_companion, through a link', async () => {
    const libexec = join(root, 'Cellar', 'idb-companion', '1.6.1', 'libexec')
    tool(join(libexec, 'idb_companion'))
    tool(join(libexec, 'sim-video'))
    mkdirSync(join(root, 'bin'))
    symlinkSync(join(libexec, 'idb_companion'), join(root, 'bin', 'idb_companion'))
    expect(await findIdb([join(root, 'missing', 'idb_companion'), join(root, 'bin', 'idb_companion')]))
      .toEqual({ companion: join(root, 'bin', 'idb_companion'), simVideo: join(libexec, 'sim-video') })
  })

  it('says when sim-video is missing, and when nothing is found', async () => {
    tool(join(root, 'old', 'idb_companion'))
    expect(await findIdb([join(root, 'old', 'idb_companion')])).toEqual({ companion: join(root, 'old', 'idb_companion'), simVideo: null })
    expect(await findIdb([join(root, 'none', 'idb_companion')])).toBeNull()
  })
})

describe('simulatorBooted', () => {
  const run = (answers: Record<string, string | Error>) => async (cmd: string) => {
    const answer = answers[cmd]
    if (answer instanceof Error) throw answer
    return answer ?? ''
  }

  it('asks simctl only with a developer folder selected', async () => {
    expect(await simulatorBooted(run({ 'xcode-select': new Error('no developer folder') }))).toBe(false)
    const booted = JSON.stringify({ devices: { 'com.apple.CoreSimulator.SimRuntime.iOS-27-0': [{ state: 'Booted' }] } })
    expect(await simulatorBooted(run({ 'xcode-select': '/Applications/Xcode.app\n', xcrun: booted }))).toBe(true)
    expect(await simulatorBooted(run({ 'xcode-select': '/x\n', xcrun: JSON.stringify({ devices: {} }) }))).toBe(false)
    expect(await simulatorBooted(run({ 'xcode-select': '/x\n', xcrun: 'not json' }))).toBe(false)
  })
})
```

Create `src/main/devices/ios/simulators.test.ts`:

```ts
import { afterEach, beforeEach, describe, expect, it, vi } from 'vitest'
import { readNotifyLine, simulatorDevices, SimulatorTracker, type SimTarget, udidOf } from './simulators'
import { fakeProcess, type FakeProcess } from './test-process'

const sim = (udid: string, name: string, state: string, os = 'iOS 27.0') =>
  ({ udid, name, model: name, state, type: 'Simulator', os_version: os })
const line = (...targets: object[]) => `${JSON.stringify(targets)}\n`

describe('readNotifyLine', () => {
  it('takes the first line as every simulator, and later lines as changes', () => {
    const first = readNotifyLine(line(sim('A', 'iPhone 17', 'Booted'), sim('B', 'iPad', 'Shutdown')), new Map(), true)!
    expect([...first.keys()]).toEqual(['A', 'B'])
    const next = readNotifyLine(line(sim('B', 'iPad', 'Booted')), first, false)!
    expect(next.get('B')?.state).toBe('Booted')
    expect(next.get('A')?.state).toBe('Booted')
    const again = readNotifyLine(line(sim('C', 'iPhone Air', 'Booted')), next, true)!
    expect([...again.keys()]).toEqual(['C']) // a restarted notifier's first line replaces the rest
  })

  it('ignores devices and odd entries, and says when a line is no list', () => {
    const read = readNotifyLine(line({ udid: 'D', type: 'Device', state: 'Booted' }, null, { type: 'Simulator' }, sim('A', '', 'Booted')), new Map(), true)!
    expect([...read.values()]).toEqual([{ udid: 'A', name: 'A', state: 'Booted', osVersion: 'iOS 27.0' }])
    expect(readNotifyLine('2026-11-10 starting', new Map(), true)).toBeNull()
  })
})

describe('simulatorDevices', () => {
  it('lists the booted ones by name, as devices', () => {
    const targets = new Map<string, SimTarget>([
      ['B', { udid: 'B', name: 'iPhone 18 Pro Max', state: 'Booted', osVersion: 'iOS 27.0' }],
      ['A', { udid: 'A', name: 'iPhone 16', state: 'Booted', osVersion: 'iOS 18.5' }],
      ['C', { udid: 'C', name: 'iPad', state: 'Shutdown', osVersion: 'iOS 27.0' }],
    ])
    expect(simulatorDevices(targets)).toEqual([
      { id: 'simulator:A', kind: 'simulator', name: 'iPhone 16', detail: 'Simulator · iOS 18.5', state: 'ready' },
      { id: 'simulator:B', kind: 'simulator', name: 'iPhone 18 Pro Max', detail: 'Simulator · iOS 27.0', state: 'ready' },
    ])
    expect(udidOf('simulator:A')).toBe('A')
    expect(udidOf('android:A')).toBeNull()
  })
})

describe('SimulatorTracker', () => {
  beforeEach(() => vi.useFakeTimers())
  afterEach(() => vi.useRealTimers())

  function setup() {
    const spawned: FakeProcess[] = []
    const published: string[][] = []
    const failures: [string, boolean][] = []
    const tracker = new SimulatorTracker({
      notify: () => {
        const p = fakeProcess()
        spawned.push(p)
        return p.proc
      },
      publish: (devices) => published.push(devices.map((d) => d.id)),
      failed: (why, listed) => failures.push([why, listed]),
    })
    return { tracker, spawned, published, failures }
  }

  it('publishes after each line, read across chunks', async () => {
    const { tracker, spawned, published } = setup()
    tracker.start()
    const text = line(sim('A', 'iPhone 17', 'Booted')) + line(sim('B', 'iPhone 18', 'Booted'))
    spawned[0].stdout.write(text.slice(0, 20))
    spawned[0].stdout.write(text.slice(20))
    await vi.waitFor(() => expect(published).toEqual([['simulator:A'], ['simulator:A', 'simulator:B']]))
    expect(tracker.booted('B')).toBe(true)
    tracker.stop()
  })

  it('starts the notifier again after 1 s, then 2 s, saying why, and stops for good', async () => {
    const { tracker, spawned, failures } = setup()
    tracker.start()
    spawned[0].stderr.write('Error: CoreSimulator is broken\n')
    spawned[0].exit(1)
    await vi.advanceTimersByTimeAsync(0)
    expect(failures).toEqual([['Error: CoreSimulator is broken', false]])
    await vi.advanceTimersByTimeAsync(999)
    expect(spawned).toHaveLength(1)
    await vi.advanceTimersByTimeAsync(1)
    expect(spawned).toHaveLength(2)
    spawned[1].stdout.write(line(sim('A', 'iPhone 17', 'Booted')))
    spawned[1].exit(1)
    await vi.advanceTimersByTimeAsync(0)
    expect(failures[1]).toEqual(['idb_companion stopped.', true])
    await vi.advanceTimersByTimeAsync(2000)
    expect(spawned).toHaveLength(3)
    tracker.stop()
    expect(spawned[2].killed()).toBe(true)
    await vi.advanceTimersByTimeAsync(60_000)
    expect(spawned).toHaveLength(3)
  })
})
```

- [ ] **Step 3: Run them and watch them fail**

Run: `npx vitest run src/main/devices/ios/tools.test.ts src/main/devices/ios/simulators.test.ts`
Expected: FAIL: `./tools` and `./simulators` don't exist.

- [ ] **Step 4: Implement**

Create `src/main/devices/ios/tools.ts`:

```ts
import { execFile } from 'node:child_process'
import { realpath, stat } from 'node:fs/promises'
import { delimiter, dirname, isAbsolute, join } from 'node:path'

/** idb-companion as Homebrew installs it. */
export interface IdbTools {
  /** idb_companion as found (Homebrew's link). */
  companion: string
  /** sim-video beside idb_companion's real file; null: an idb-companion without it. */
  simVideo: string | null
}

const isFile = (path: string) => stat(path).then((s) => s.isFile(), () => false)

/** Where idb_companion may be: PATH's absolute folders, then Homebrew's (Deck started from Finder
 *  gets a short PATH). `DECK_IDB_COMPANION` replaces them all, so a check can hide idb. */
export function idbCandidates(env: NodeJS.ProcessEnv): string[] {
  if (env.DECK_IDB_COMPANION) return [env.DECK_IDB_COMPANION]
  const dirs = (env.PATH ?? '').split(delimiter).filter((d) => d && isAbsolute(d))
  return [...new Set([...dirs, '/opt/homebrew/bin', '/usr/local/bin'])].map((d) => join(d, 'idb_companion'))
}

/** The first idb_companion found, and the sim-video Homebrew puts beside its real file
 *  (`…/Cellar/idb-companion/<version>/libexec/`). */
export async function findIdb(candidates: readonly string[]): Promise<IdbTools | null> {
  for (const companion of candidates) {
    if (!(await isFile(companion))) continue
    const real = await realpath(companion).catch(() => companion)
    const simVideo = join(dirname(real), 'sim-video')
    return { companion, simVideo: (await isFile(simVideo)) ? simVideo : null }
  }
  return null
}

/** Xcode's own device set, which idb_companion follows unless told another. */
export const defaultSimulatorSet = (home: string) => join(home, 'Library', 'Developer', 'CoreSimulator', 'Devices')

function runTool(cmd: string, args: string[]): Promise<string> {
  return new Promise((resolve, reject) => {
    execFile(cmd, args, { timeout: 10_000, maxBuffer: 8 * 1024 * 1024 }, (err, stdout) => (err ? reject(err) : resolve(stdout)))
  })
}

/** Whether any simulator is booted, asked without idb (to say idb-companion is missing). Only with a
 *  developer folder selected: without one, `xcrun` offers to install the command line tools. */
export async function simulatorBooted(run: (cmd: string, args: string[]) => Promise<string> = runTool): Promise<boolean> {
  try {
    await run('xcode-select', ['-p'])
    const out = await run('xcrun', ['simctl', 'list', 'devices', 'booted', '-j'])
    const devices = (JSON.parse(out) as { devices?: Record<string, { state?: string }[]> }).devices ?? {}
    return Object.values(devices).some((list) => Array.isArray(list) && list.some((d) => d?.state === 'Booted'))
  } catch {
    return false
  }
}
```

Create `src/main/devices/ios/simulators.ts`:

```ts
import type { ChildProcess } from 'node:child_process'
import type { DeviceInfo } from '@shared/types'

/** What idb_companion's notifier says of a simulator. */
export interface SimTarget {
  udid: string
  name: string
  state: string
  osVersion: string
}

const PREFIX = 'simulator:'

export const udidOf = (id: string): string | null => (id.startsWith(PREFIX) ? id.slice(PREFIX.length) : null)

/** One line of `idb_companion --notify stdout`: a JSON array of targets. Its first line lists every
 *  simulator, each later one only those whose state changed (idb-companion 1.6.1). null: a line
 *  that isn't a list. */
export function readNotifyLine(line: string, known: ReadonlyMap<string, SimTarget>, first: boolean): Map<string, SimTarget> | null {
  let raw: unknown
  try {
    raw = JSON.parse(line)
  } catch {
    return null
  }
  if (!Array.isArray(raw)) return null
  const next = new Map(first ? [] : known)
  for (const item of raw) {
    if (typeof item !== 'object' || item === null) continue
    const t = item as Record<string, unknown>
    if (t.type !== 'Simulator' || typeof t.udid !== 'string' || !t.udid) continue
    const name = typeof t.name === 'string' && t.name ? t.name : t.udid
    next.set(t.udid, {
      udid: t.udid,
      name,
      state: typeof t.state === 'string' ? t.state : '',
      osVersion: typeof t.os_version === 'string' ? t.os_version : '',
    })
  }
  return next
}

/** The booted simulators, by name, as devices. */
export function simulatorDevices(targets: ReadonlyMap<string, SimTarget>): DeviceInfo[] {
  return [...targets.values()]
    .filter((t) => t.state === 'Booted')
    .sort((a, b) => a.name.localeCompare(b.name) || a.udid.localeCompare(b.udid))
    .map((t) => ({ id: `${PREFIX}${t.udid}`, kind: 'simulator', name: t.name, detail: t.osVersion ? `Simulator · ${t.osVersion}` : 'Simulator', state: 'ready' }))
}

export interface SimulatorTrackerDeps {
  /** `idb_companion --notify stdout --only simulator`. */
  notify(): ChildProcess
  /** The booted simulators, after each line. */
  publish(devices: DeviceInfo[]): void
  /** The notifier stopped (it starts again soon): its last words, and whether it had listed anything. */
  failed(why: string, listed: boolean): void
}

/** Follows the simulators with one long-running notifier. If it stops, it's started again after
 *  1 s, then twice the wait each time, up to 30 s; the wait goes back to 1 s after a run of 30 s. */
export class SimulatorTracker {
  private child: ChildProcess | null = null
  private timer: ReturnType<typeof setTimeout> | null = null
  private wait = 1000
  private running = false
  private targets = new Map<string, SimTarget>()
  private listed = false

  constructor(private readonly deps: SimulatorTrackerDeps) {}

  start(): void {
    if (this.running) return
    this.running = true
    this.run()
  }

  stop(): void {
    this.running = false
    if (this.timer) clearTimeout(this.timer)
    this.timer = null
    const child = this.child
    this.child = null
    child?.kill()
  }

  /** Whether simulator `udid` was booted at the last line. */
  booted(udid: string): boolean {
    return this.targets.get(udid)?.state === 'Booted'
  }

  private run(): void {
    const child = this.deps.notify()
    this.child = child
    const startedAt = Date.now()
    let first = true
    let rest = ''
    let lastWords = ''
    child.stdout?.setEncoding('utf8')
    child.stdout?.on('data', (text: string) => {
      if (this.child !== child) return
      const lines = (rest + text).split('\n')
      rest = lines.pop() ?? ''
      if (rest.length > 4 * 1024 * 1024) rest = '' // no line is this long: garbage
      for (const line of lines) {
        if (!line.trim()) continue
        const next = readNotifyLine(line, this.targets, first)
        if (!next) continue
        first = false
        this.targets = next
        this.listed = true
        this.deps.publish(simulatorDevices(next))
      }
    })
    child.stderr?.setEncoding('utf8')
    child.stderr?.on('data', (text: string) => {
      const line = text.trim().split('\n').at(-1)?.trim()
      if (line) lastWords = line
    })
    let ended = false
    const end = () => {
      if (ended || this.child !== child) return
      ended = true
      this.child = null
      if (!this.running) return
      if (Date.now() - startedAt >= 30_000) this.wait = 1000
      this.deps.failed(lastWords || 'idb_companion stopped.', this.listed)
      this.timer = setTimeout(() => {
        this.timer = null
        if (this.running) this.run()
      }, this.wait)
      this.wait = Math.min(this.wait * 2, 30_000)
    }
    child.on('error', end) // it couldn't start
    child.on('close', end)
  }
}
```

- [ ] **Step 5: Run the tests**

Run: `npx vitest run src/main/devices/ios`
Expected: PASS.

- [ ] **Step 6: Commit**

```bash
git add src/main/devices/ios
git -c user.email=franco@effektstudios.com commit -m "Simulators: finding idb-companion and following the simulators

Claude-Session: https://claude.ai/code/session_012TidnBvRYbxhSYqPzFZuph"
```

---

### Task 8: One list from both sources

Main runs the simulator notifier beside adb's tracker while devices are watched (macOS, with
idb-companion), and publishes one list that says which kinds are still pending.

**Files:**
- Create: `src/main/devices/registry.ts`, `src/main/devices/registry.test.ts`,
  `src/main/devices/ipc.ios.test.ts`
- Modify: `src/main/devices/ipc.ts`, `src/main/devices/ipc.test.ts`, `src/main/index.ts`

- [ ] **Step 1: Write the failing tests**

Create `src/main/devices/registry.test.ts`:

```ts
import { describe, expect, it } from 'vitest'
import type { DeviceInfo } from '@shared/types'
import { combineLists } from './registry'

const phone: DeviceInfo = { id: 'android:X1', kind: 'android', name: 'C66', detail: 'Android 13 · USB', state: 'ready' }
const sim: DeviceInfo = { id: 'simulator:U1', kind: 'simulator', name: 'iPhone 17', detail: 'Simulator · iOS 27.0', state: 'ready' }

describe('combineLists', () => {
  it("lists adb's devices, then the simulators, with each source's problem", () => {
    expect(combineLists({ pending: false, devices: [phone], problem: null }, { pending: false, devices: [sim], problem: null }))
      .toEqual({ devices: [phone, sim], problem: null, ios: null, pending: [] })
    expect(combineLists({ pending: false, devices: [], problem: 'no-adb' }, { pending: false, devices: [], problem: 'no-idb' }))
      .toEqual({ devices: [], problem: 'no-adb', ios: 'no-idb', pending: [] })
  })

  it('says which kinds are still pending', () => {
    expect(combineLists({ pending: false, devices: [phone], problem: null }, { pending: true, devices: [], problem: null }).pending).toEqual(['ios'])
    expect(combineLists({ pending: true, devices: [], problem: null }, { pending: false, devices: [sim], problem: null }).pending).toEqual(['android'])
  })
})
```

Create `src/main/devices/ipc.ios.test.ts`: the wiring on macOS with a fake idb_companion (a shell
script printing notify lines) and no adb. Shell scripts: skipped on Windows.

```ts
import { EventEmitter } from 'node:events'
import { chmodSync, mkdirSync, mkdtempSync, rmSync, writeFileSync } from 'node:fs'
import { tmpdir } from 'node:os'
import { join } from 'node:path'
import { afterAll, describe, expect, it, vi } from 'vitest'
import { IPC } from '@shared/channels'
import type { DeviceList } from '@shared/types'
import type { BrowserWindow } from 'electron'
import { registerDeviceIpc } from './ipc'

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
}))


describe.skipIf(process.platform === 'win32')('registerDeviceIpc on macOS', () => {
  const root = mkdtempSync(join(tmpdir(), 'deck-ios-ipc-'))
  afterAll(() => rmSync(root, { recursive: true, force: true }))
  const libexec = join(root, 'libexec')
  mkdirSync(libexec)
  // Prints a first list with one booted simulator, then stays up as the real notifier does.
  writeFileSync(join(libexec, 'idb_companion'), [
    '#!/bin/sh',
    `echo '[{"udid":"FAKE-UDID","name":"iPhone 17","state":"Booted","type":"Simulator","os_version":"iOS 27.0"}]'`,
    'exec sleep 60',
    '',
  ].join('\n'))
  writeFileSync(join(libexec, 'sim-video'), '#!/bin/sh\n')
  chmodSync(join(libexec, 'idb_companion'), 0o755)
  chmodSync(join(libexec, 'sim-video'), 0o755)

  const sent: [string, unknown[]][] = []
  const webContents = Object.assign(new EventEmitter(), { isDestroyed: () => false, send: (c: string, ...a: unknown[]) => sent.push([c, a]) })
  const win = Object.assign(new EventEmitter(), { isDestroyed: () => false, webContents }) as unknown as BrowserWindow
  const devices = registerDeviceIpc({
    picksFile: join(root, 'devices.json'),
    resources: join(root, 'resources'),
    platform: 'darwin',
    home: join(root, 'home'),
    env: { PATH: '', DECK_IDB_COMPANION: join(libexec, 'idb_companion') },
    socketDir: join(root, 's'),
    saveImage: async () => '',
  })
  devices.attach(win)
  afterAll(() => devices.dispose())

  it('lists the simulators beside adb, which is missing here', async () => {
    ipc.listeners.get(IPC.devicesWatch)!({})
    await vi.waitFor(async () => {
      const list = (await ipc.handlers.get(IPC.devicesList)!({})) as DeviceList | null
      expect(list).toEqual({
        devices: [{ id: 'simulator:FAKE-UDID', kind: 'simulator', name: 'iPhone 17', detail: 'Simulator · iOS 27.0', state: 'ready' }],
        problem: 'no-adb',
        ios: null,
        pending: [],
      })
    }, { timeout: 5000 })
    ipc.listeners.get(IPC.devicesUnwatch)!({})
    expect(await ipc.handlers.get(IPC.devicesList)!({})).toBeNull()
  })
})
```

(`socketDir` joins `DeviceIpcOptions` in Step 4; Task 10 uses it.)

- [ ] **Step 2: Run them and watch them fail**

Run: `npx vitest run src/main/devices/registry.test.ts src/main/devices/ipc.ios.test.ts`
Expected: FAIL: `./registry` doesn't exist; the list has no simulators.

- [ ] **Step 3: The registry**

Create `src/main/devices/registry.ts`:

```ts
import type { DeviceInfo, DeviceList, DevicePlatform } from '@shared/types'

/** What one source of devices knows: adb's, or idb's simulators. */
export interface SourceState<P> {
  /** Still finding its first devices. */
  pending: boolean
  devices: DeviceInfo[]
  problem: P
}

export type AndroidState = SourceState<DeviceList['problem']>
export type IosState = SourceState<DeviceList['ios']>

/** One list from both sources: adb's devices as its tracker orders them, then the simulators. */
export function combineLists(android: AndroidState, ios: IosState): DeviceList {
  const pending: DevicePlatform[] = []
  if (android.pending) pending.push('android')
  if (ios.pending) pending.push('ios')
  return { devices: [...android.devices, ...ios.devices], problem: android.problem, ios: ios.problem, pending }
}
```

- [ ] **Step 4: Run both sources in `ipc.ts`**

First the option the simulators' sessions will need (Task 10), so the macOS test can pass it. In
`DeviceIpcOptions` add:

```ts
  /** Where simulators' companions put their sockets: short (macOS limits a Unix socket's path) and
   *  this instance's own (`socketDirFor` in ios/simulator.ts, Task 9). */
  socketDir: string
```

pass `socketDir: join(root, 'sockets')` in `ipc.test.ts`'s registration, and in `src/main/index.ts`
pass `socketDir: join(app.getPath('temp'), `deck-${instance}`)` for now (Task 10 switches it to
`socketDirFor`, which keeps the path short enough).

In `src/main/devices/ipc.ts`, import
`import { defaultSimulatorSet, findIdb, idbCandidates, type IdbTools, simulatorBooted } from './ios/tools'`,
`import { SimulatorTracker } from './ios/simulators'` and
`import { type AndroidState, combineLists, type IosState } from './registry'`.

Replace the watch state and `startWatching`/`stopWatching` with:

```ts
  let watchers = 0
  let tracker: AndroidTracker | null = null
  let simulators: SimulatorTracker | null = null
  /** Looked for again at each start of watching, so an SDK installed since is found. */
  let adb: string | null = null
  let idb: IdbTools | null = null
  /** A look for adb or idb under way: Deck coming to the front doesn't start a second one. */
  let lookingForAdb = false
  let lookingForIdb = false
  let android: AndroidState = { pending: true, devices: [], problem: null }
  let ios: IosState = { pending: false, devices: [], problem: null }
  /** Bumped by every start and stop, so a slow look can't start watching late. */
  let generation = 0
  /** A custom device set, for checks (Xcode's own otherwise). */
  const simulatorSet = opts.env.DECK_SIMULATOR_SET || null
```

```ts
  /** The list, once some source has answered: until then a tab waits rather than taking "no
   *  devices" for an answer. */
  const update = () => {
    if (watchers > 0 && (!android.pending || !ios.pending)) publish(combineLists(android, ios))
  }

  const watchAndroid = async (mine: number) => {
    lookingForAdb = true
    const found = await findAdb(adbCandidates(opts.env, opts.platform, opts.home)).finally(() => {
      lookingForAdb = false
    })
    if (mine !== generation || tracker) return
    adb = found
    if (!found) {
      android = { pending: false, devices: [], problem: 'no-adb' }
      return update()
    }
    tracker = new AndroidTracker({
      track: () => spawn(found, ['track-devices', '-l'], { stdio: ['ignore', 'pipe', 'pipe'], windowsHide: true }),
      identify: async (serial) => parseIdentity(await runAdb(found, ['-s', serial, 'shell', IDENTITY_SCRIPT], 10_000)),
      publish: (devices, error) => {
        android = { pending: false, devices, problem: error && devices.length === 0 ? { error } : null }
        update()
      },
    })
    tracker.start()
  }

  /** Simulators: macOS only, with idb-companion. Without it (or with one too old for sim-video), a
   *  booted simulator gets the panel to say what to install. */
  const watchSimulators = async (mine: number) => {
    if (opts.platform !== 'darwin') return
    lookingForIdb = true
    const found = await findIdb(idbCandidates(opts.env)).finally(() => {
      lookingForIdb = false
    })
    if (mine !== generation || simulators) return
    idb = found
    if (!found?.simVideo) {
      const booted = await simulatorBooted()
      if (mine !== generation) return
      ios = { pending: false, devices: [], problem: booted ? (found ? 'old-idb' : 'no-idb') : null }
      return update()
    }
    simulators = new SimulatorTracker({
      notify: () => spawn(found.companion, ['--notify', 'stdout', '--only', 'simulator', ...(simulatorSet ? ['--device-set-path', simulatorSet] : [])], { stdio: ['ignore', 'pipe', 'pipe'] }),
      publish: (devices) => {
        ios = { pending: false, devices, problem: null }
        update()
      },
      failed: (why, listed) => {
        if (listed) return // the last list stands until the notifier is back
        ios = { pending: false, devices: [], problem: { error: why } }
        update()
      },
    })
    simulators.start()
  }

  const startWatching = () => {
    const mine = ++generation
    android = { pending: true, devices: [], problem: null }
    ios = { pending: opts.platform === 'darwin', devices: [], problem: null }
    void watchAndroid(mine)
    void watchSimulators(mine)
  }
  const stopWatching = () => {
    generation++
    tracker?.stop()
    tracker = null
    simulators?.stop()
    simulators = null
    // No push: every tab that watched has already stopped listening (it calls off() before unwatch).
    list = null
  }
```

In the `devices:watch` listener, `void startWatching()` becomes `startWatching()`. In `attach`, the
focus handler becomes:

```ts
      // adb or idb-companion installed while Deck runs: look again when Deck comes to the front,
      // rather than only when a tab starts needing devices.
      w.on('focus', () => {
        if (watchers === 0) return
        if (!tracker && !lookingForAdb) void watchAndroid(generation)
        if (opts.platform === 'darwin' && !simulators && !lookingForIdb) void watchSimulators(generation)
      })
```

and `dispose()` also stops the simulators (`simulators?.stop(); simulators = null`). `idb` is used by
Task 10.

- [ ] **Step 5: Run the device tests**

Run: `npx vitest run src/main/devices`
Expected: PASS. (`ipc.test.ts` runs as `linux`: no simulator source, so its lists are as in Task 1.)

- [ ] **Step 6: Typecheck**

Run: `npm run typecheck`
Expected: PASS (see the note on `socketDir` in Step 1).

- [ ] **Step 7: Commit**

```bash
git add src/main/devices
git -c user.email=franco@effektstudios.com commit -m "Devices: one list from adb and the simulators, with what's still pending

Claude-Session: https://claude.ai/code/session_012TidnBvRYbxhSYqPzFZuph"
```

---

### Task 9: A simulator's session

One viewed simulator: its own companion and socket, describe for the screen's points, sim-video for
the picture, the hid stream for input, and the current group of pictures for a viewer that joins.

**Files:**
- Create: `src/main/devices/ios/simulator.ts`, `src/main/devices/ios/simulator.test.ts`

- [ ] **Step 1: Write the failing tests**

Create `src/main/devices/ios/simulator.test.ts`:

```ts
import { describe, expect, it, vi } from 'vitest'
import type { StreamPacket } from '../session'
import type { GrpcStream } from './grpc'
import { DESCRIBE_PATH, HID_PATH, touchEvent } from './proto'
import { type IdbConnection, scaleFor, type SimulatorIo, socketDirFor, startSimulator } from './simulator'
import { DESCRIBE_ANSWER, fragment, initSegment, nal } from './test-fixtures'
import { fakeProcess, type FakeProcess } from './test-process'

function setup(opts: { describe?: () => Promise<Buffer> } = {}) {
  const companions: FakeProcess[] = []
  const videos: FakeProcess[] = []
  const videoArgs: [string, number][] = []
  const streams: { path: string; written: Buffer[]; closed: boolean }[] = []
  const connection: IdbConnection & { closed: boolean } = {
    closed: false,
    unary: vi.fn(async (path: string) => {
      expect(path).toBe(DESCRIBE_PATH)
      return opts.describe ? opts.describe() : DESCRIBE_ANSWER
    }),
    stream: (path: string): GrpcStream => {
      const s = { path, written: [] as Buffer[], closed: false }
      streams.push(s)
      return { write: (m) => s.written.push(m), close: () => { s.closed = true } }
    },
    close() {
      this.closed = true
    },
  }
  const io: SimulatorIo = {
    socketFor: (udid) => `/tmp/sock/${udid}.sock`,
    companion: () => {
      const p = fakeProcess()
      companions.push(p)
      return p.proc
    },
    socketReady: async () => {},
    connect: () => connection,
    video: (udid, scale) => {
      videoArgs.push([udid, scale])
      const p = fakeProcess()
      videos.push(p)
      return p.proc
    },
  }
  const sizes: [number, number][] = []
  const packets: StreamPacket[] = []
  const ends: string[] = []
  const events = { size: (w: number, h: number) => sizes.push([w, h]), packet: (p: StreamPacket) => packets.push(p), end: (why: string) => ends.push(why) }
  return { io, events, companions, videos, videoArgs, streams, connection, sizes, packets, ends }
}

const flush = () => new Promise((r) => setImmediate(r))

describe('startSimulator', () => {
  it('describes the screen, then streams it scaled to 1600 px at most', async () => {
    const t = setup()
    await startSimulator('U1', t.events, t.io, new AbortController().signal)
    expect(t.videoArgs).toEqual([['U1', 1600 / 2622]])
    t.videos[0].stdout.write(Buffer.concat([initSegment(), fragment([nal(0x65)]), fragment([nal(0x41)])]))
    await flush()
    expect(t.sizes).toEqual([[604, 1312]])
    expect(t.packets.map((p) => [p.config, p.key])).toEqual([[true, false], [false, true], [false, false]])
  })

  it('replays the current group of pictures for a key frame', async () => {
    const t = setup()
    const session = await startSimulator('U1', t.events, t.io, new AbortController().signal)
    t.videos[0].stdout.write(Buffer.concat([initSegment(), fragment([nal(0x41)]), fragment([nal(0x65)]), fragment([nal(0x41, 9)])]))
    await flush()
    const before = t.packets.length
    session.keyframe()
    // The config, then the last key frame and what followed it; not the P frame before it.
    expect(t.packets.slice(before).map((p) => [p.config, p.key, p.data.length])).toEqual([[true, false, t.packets[0].data.length], [false, true, 10], [false, false, 13]])
  })

  it('sends input in points down one hid stream, and drops what a simulator has no use for', async () => {
    const t = setup()
    const session = await startSimulator('U1', t.events, t.io, new AbortController().signal)
    session.input({ type: 'scroll', x: 1, y: 1, width: 10, height: 10, dx: 0, dy: 1 })
    expect(t.streams).toEqual([])
    session.input({ type: 'touch', action: 'down', x: 302, y: 656, width: 604, height: 1312 })
    session.input({ type: 'touch', action: 'up', x: 302, y: 656, width: 604, height: 1312 })
    expect(t.streams).toHaveLength(1)
    expect(t.streams[0].path).toBe(HID_PATH)
    expect(t.streams[0].written).toEqual([touchEvent(201, 437, false), touchEvent(201, 437, true)])
  })

  it("ends with sim-video's own error, or the companion's last words", async () => {
    const t = setup()
    await startSimulator('U1', t.events, t.io, new AbortController().signal)
    t.videos[0].stderr.write('Overlay setup: screenInfo=1206x2622@3.0x\nError: No simulator U1 in /set\nUsage: sim-video\n')
    t.videos[0].exit(64)
    await vi.waitFor(() => expect(t.ends).toEqual(['No simulator U1 in /set']))

    const u = setup()
    await startSimulator('U2', u.events, u.io, new AbortController().signal)
    u.companions[0].stderr.write('2026-11-10 14:21:57.805+0200 [U2] Target is no longer booted, companion going offline\n')
    u.companions[0].exit(0)
    await vi.waitFor(() => expect(u.ends).toEqual(['Target is no longer booted, companion going offline']))
    expect(u.videos[0].killed()).toBe(true)
  })

  it('ends on a broken picture stream', async () => {
    const t = setup()
    await startSimulator('U1', t.events, t.io, new AbortController().signal)
    t.videos[0].stdout.write(fragment([nal(0x65)]))
    await vi.waitFor(() => expect(t.ends).toEqual(['sim-video sent a picture before its configuration.']))
  })

  it('stops everything on stop(), and says nothing after', async () => {
    const t = setup()
    const session = await startSimulator('U1', t.events, t.io, new AbortController().signal)
    session.input({ type: 'button', button: 'home' })
    session.stop()
    expect(t.companions[0].killed()).toBe(true)
    expect(t.videos[0].killed()).toBe(true)
    expect(t.streams[0].closed).toBe(true)
    expect(t.connection.closed).toBe(true)
    await flush()
    expect(t.ends).toEqual([])
  })

  it('fails a start whose companion stops first, and one that is stopped', async () => {
    const t = setup({ describe: () => new Promise(() => {}) })
    const starting = startSimulator('U1', t.events, t.io, new AbortController().signal)
    await flush()
    t.companions[0].stderr.write('2026-11-10 10:00:00.000+0200 The operation couldn’t be completed.\n')
    t.companions[0].exit(1)
    await expect(starting).rejects.toThrow('The operation couldn’t be completed.')
    expect(t.videos).toEqual([])

    const u = setup({ describe: () => new Promise(() => {}) })
    const abort = new AbortController()
    const stopped = startSimulator('U1', u.events, u.io, abort.signal)
    await flush()
    abort.abort()
    await expect(stopped).rejects.toThrow('Stopped.')
    expect(u.companions[0].killed()).toBe(true)
  })
})

describe('scaleFor and socketDirFor', () => {
  it('keeps the long side within 1600 px, never scaling up', () => {
    expect(scaleFor({ width: 1320, height: 2868, widthPoints: 440, heightPoints: 956 })).toBeCloseTo(0.558, 3)
    expect(scaleFor({ width: 750, height: 1334, widthPoints: 375, heightPoints: 667 })).toBe(1)
  })

  it("keeps the socket's path under macOS's 104 bytes", () => {
    expect(socketDirFor('/var/folders/wv/abc/T', 'deadbeef', 501)).toBe('/var/folders/wv/abc/T/deck-deadbeef')
    expect(socketDirFor(`/${'x'.repeat(90)}`, 'deadbeef', 501)).toBe('/tmp/deck-501-deadbeef')
  })
})
```

- [ ] **Step 2: Run them and watch them fail**

Run: `npx vitest run src/main/devices/ios/simulator.test.ts`
Expected: FAIL: `./simulator` doesn't exist.

- [ ] **Step 3: Implement**

Create `src/main/devices/ios/simulator.ts`:

```ts
import { type ChildProcess, spawn } from 'node:child_process'
import { mkdirSync, rmSync, statSync } from 'node:fs'
import { stat } from 'node:fs/promises'
import { join } from 'node:path'
import type { DeviceSession, StreamEvents, StreamPacket } from '../session'
import { Fmp4Reader } from './fmp4'
import { GrpcClient, type GrpcStream } from './grpc'
import { simulatorEvents } from './input'
import { DESCRIBE_PATH, HID_PATH, parseDescribe, type ScreenSize } from './proto'

/** What a session needs of the gRPC client. */
export interface IdbConnection {
  unary(path: string, message: Buffer, timeoutMs?: number): Promise<Buffer>
  stream(path: string): GrpcStream
  close(): void
}

/** How a session reaches idb; tests replace it. */
export interface SimulatorIo {
  /** A new socket path for `udid`'s companion. */
  socketFor(udid: string): string
  /** `idb_companion --udid <udid> --grpc-domain-sock <socket> --terminate-offline true`. */
  companion(udid: string, socket: string): ChildProcess
  /** Resolves once the socket is there; rejects when `signal` aborts. */
  socketReady(socket: string, signal: AbortSignal): Promise<void>
  connect(socket: string): IdbConnection
  /** `sim-video stream … --scale <scale> --key-frame-rate 2 --transport fmp4 -`, stdin kept open. */
  video(udid: string, scale: number): ChildProcess
}

/** The picture's long side, as scrcpy's max_size for Android. */
const MAX_SIDE = 1600
/** The current group of pictures, replayed for a viewer that joins (sim-video can't be asked for a
 *  key frame): at most this many pictures or bytes. Past that the screen is moving, and its next key
 *  frame is at most 2 s away. */
const GOP_FRAMES = 120
const GOP_BYTES = 16 * 1024 * 1024

export const scaleFor = (screen: ScreenSize) => Math.min(1, MAX_SIDE / Math.max(screen.width, screen.height))

/** The folder for the companions' sockets: Deck's own in the temp folder, or `/tmp` when that path
 *  would be too long (macOS takes a Unix socket's path up to 103 bytes; Deck's names add 25). */
export function socketDirFor(temp: string, instance: string, uid: number): string {
  const dir = join(temp, `deck-${instance}`)
  return dir.length <= 78 ? dir : join('/tmp', `deck-${uid}-${instance}`)
}

/** Keeps a stream's last line worth showing, reading it all so its pipe never fills. */
function lastLine(stream: NodeJS.ReadableStream | null, keep: (line: string) => string | null): () => string {
  let last = ''
  let rest = ''
  stream?.setEncoding('utf8')
  stream?.on('data', (text: string) => {
    const lines = (rest + text).split('\n')
    rest = (lines.pop() ?? '').slice(-4096)
    for (const line of lines) {
      const shown = keep(line.trim())
      if (shown) last = shown
    }
  })
  return () => (rest.trim() && keep(rest.trim())) || last
}

/** sim-video's "Error: …" lines, without the word. */
const videoError = (line: string) => (line.startsWith('Error: ') ? line.slice(7) : null)
/** The companion's lines, without the time and the bracketed UDID they start with. */
const companionLine = (line: string) =>
  line.replace(/^\d{4}-\d{2}-\d{2} \S+ /, '').replace(/^\[[^\]\s]+\] /, '').trim() || null

/** Starts simulator `udid`'s stream. Resolves once sim-video runs; the first picture follows within
 *  about a second. `signal` stops a start under way and closes what it opened. */
export async function startSimulator(udid: string, events: StreamEvents, io: SimulatorIo, signal: AbortSignal): Promise<DeviceSession> {
  if (signal.aborted) throw new Error('Stopped.')
  const socket = io.socketFor(udid)
  const companion = io.companion(udid, socket)
  const companionSaid = lastLine(companion.stderr, companionLine)
  let video: ChildProcess | null = null
  let client: IdbConnection | null = null
  let hid: GrpcStream | null = null
  let stopping = false
  let ended = false
  const close = () => {
    hid?.close()
    client?.close()
    companion.kill()
    if (video) {
      video.stdin?.end()
      video.kill()
    }
  }
  const end = (why: string) => {
    if (ended || stopping) return
    ended = true
    close()
    events.end(why)
  }
  const companionGone = new Promise<never>((_, reject) => {
    companion.once('close', () => reject(new Error(companionSaid() || 'idb_companion stopped.')))
  })
  companionGone.catch(() => {}) // heard after the start through 'close' below
  const onAbort = () => close()
  signal.addEventListener('abort', onAbort, { once: true })
  let screen: ScreenSize
  try {
    await Promise.race([io.socketReady(socket, signal), companionGone])
    client = io.connect(socket)
    screen = parseDescribe(await Promise.race([client.unary(DESCRIBE_PATH, Buffer.alloc(0)), companionGone]))
    if (signal.aborted) throw new Error('Stopped.')
  } catch (err) {
    signal.removeEventListener('abort', onAbort)
    close()
    throw signal.aborted ? new Error('Stopped.') : err
  }
  signal.removeEventListener('abort', onAbort)

  const v = io.video(udid, scaleFor(screen))
  video = v
  const videoSaid = lastLine(v.stderr, videoError)
  const reader = new Fmp4Reader()
  let config: StreamPacket | null = null
  /** The last key frame and the pictures since; null past the caps, until the next key frame. */
  let gop: StreamPacket[] | null = null
  let gopBytes = 0
  const remember = (packet: StreamPacket) => {
    if (packet.key) {
      gop = [packet]
      gopBytes = packet.data.length
    } else if (gop && gop.length < GOP_FRAMES && gopBytes + packet.data.length <= GOP_BYTES) {
      gop.push(packet)
      gopBytes += packet.data.length
    } else gop = null
  }
  v.stdout?.on('data', (chunk: Buffer) => {
    if (ended || stopping) return
    let parsed
    try {
      parsed = reader.push(chunk)
    } catch (err) {
      return end(err instanceof Error ? err.message : String(err))
    }
    for (const e of parsed) {
      if (e.type === 'config') {
        config = { config: true, key: false, data: e.data }
        gop = null // a new configuration starts with its own key frame
        events.size(e.width, e.height)
        events.packet(config)
      } else {
        const packet = { config: false, key: e.key, data: e.data }
        remember(packet)
        events.packet(packet)
      }
    }
  })
  v.on('error', () => {}) // 'close' follows
  v.on('close', () => end(videoSaid() || 'sim-video stopped.'))
  companion.on('close', () => end(companionSaid() || 'idb_companion stopped.'))

  const points = { width: screen.widthPoints, height: screen.heightPoints }
  const connection = client
  return {
    input(input) {
      if (ended || stopping) return
      const messages = simulatorEvents(input, points)
      if (messages.length === 0) return
      hid ??= connection.stream(HID_PATH)
      for (const m of messages) hid.write(m)
    },
    keyframe() {
      if (ended || stopping || !config || !gop) return
      events.packet(config)
      for (const packet of gop) events.packet(packet)
    },
    stop() {
      if (stopping) return
      stopping = true
      close()
    },
  }
}

/** The real io: Homebrew's idb_companion and sim-video, sockets in `dir`. */
export function simulatorIo(opts: { companion: string; simVideo: string; set: string; customSet: boolean; dir: string }): SimulatorIo {
  let n = 0
  return {
    socketFor: (udid) => join(opts.dir, `${udid.slice(0, 8)}-${++n}.sock`),
    companion: (udid, socket) => {
      mkdirSync(opts.dir, { recursive: true, mode: 0o700 })
      // Only this user may reach the companion: refuse a folder someone else made (in /tmp).
      const owned = statSync(opts.dir)
      if (owned.uid !== process.getuid?.() || (owned.mode & 0o077) !== 0) throw new Error(`${opts.dir} isn't private to this user.`)
      rmSync(socket, { force: true })
      const child = spawn(opts.companion, [
        '--udid', udid, '--grpc-domain-sock', socket, '--terminate-offline', 'true', '--log-level', 'info',
        ...(opts.customSet ? ['--device-set-path', opts.set] : []),
      ], { stdio: ['ignore', 'ignore', 'pipe'] })
      child.on('close', () => rmSync(socket, { force: true }))
      return child
    },
    socketReady: async (socket, signal) => {
      while (!signal.aborted) {
        if (await stat(socket).then((s) => s.isSocket(), () => false)) return
        await new Promise((resolve) => setTimeout(resolve, 100))
      }
      throw new Error('Stopped.')
    },
    connect: (socket) => new GrpcClient(socket),
    video: (udid, scale) => spawn(opts.simVideo, [
      'stream', '--set', opts.set, '--udid', udid, '--scale', scale.toFixed(3), '--key-frame-rate', '2', '--transport', 'fmp4', '-',
    ], { stdio: ['pipe', 'pipe', 'pipe'] }),
  }
}
```

Note: `companion()` throws for a folder that isn't private; `startSimulator` calls it before its
`try`, so that error rejects the start as it should. If the implementer moves the call, keep it
rejecting the start.

- [ ] **Step 4: Run the tests**

Run: `npx vitest run src/main/devices/ios/simulator.test.ts`
Expected: PASS.

- [ ] **Step 5: Commit**

```bash
git add src/main/devices/ios/simulator.ts src/main/devices/ios/simulator.test.ts
git -c user.email=franco@effektstudios.com commit -m "Simulators: a session from idb_companion and sim-video

Claude-Session: https://claude.ai/code/session_012TidnBvRYbxhSYqPzFZuph"
```

---

### Task 10: Streaming a simulator

`ipc.ts` starts simulator sessions; `index.ts` gives it the socket folder; the folder goes at quit.

**Files:**
- Modify: `src/main/devices/ipc.ts`, `src/main/index.ts`, `src/main/devices/ipc.test.ts`

- [ ] **Step 1: The start by kind**

In `ipc.ts`, import `import { simulatorIo, startSimulator } from './ios/simulator'` and
`udidOf` from `./ios/simulators`, and make the streams' `start`:

```ts
    start: async (id, events, signal) => {
      const udid = udidOf(id)
      if (udid !== null) {
        if (!idb?.simVideo || !simulators?.booted(udid)) throw new Error("The simulator isn't booted.")
        const set = simulatorSet ?? defaultSimulatorSet(opts.home)
        const io = simulatorIo({ companion: idb.companion, simVideo: idb.simVideo, set, customSet: simulatorSet !== null, dir: opts.socketDir })
        return startSimulator(udid, events, io, signal)
      }
      const serial = tracker?.serialFor(id)
      if (!adb || !serial) throw new Error("The device isn't connected.")
      return androidSession(await startScrcpy(serial, await scrcpyServer(opts.resources), events, adbIo(adb), signal))
    },
```

and in `dispose()`, after stopping the streams: `rmSync(opts.socketDir, { recursive: true, force: true })`
(import `rmSync` from `node:fs`).

- [ ] **Step 2: Give main the folder**

In `src/main/index.ts`, import `socketDirFor` from `./devices/ios/simulator`, and make the option
Task 8 added:

```ts
    // Keyed by this instance like the clipboard's folder, so a dev build has its own.
    socketDir: socketDirFor(app.getPath('temp'), instance, process.getuid?.() ?? 0),
```

`instance` is the clipboard's (computed above it).

- [ ] **Step 3: Run the tests and the typecheck**

Run: `npx vitest run src/main/devices && npm run typecheck`
Expected: PASS.

- [ ] **Step 4: Commit**

```bash
git add src/main/devices/ipc.ts src/main/devices/ipc.test.ts src/main/index.ts
git -c user.email=franco@effektstudios.com commit -m "Simulators: streaming one, with its socket in Deck's own folder

Claude-Session: https://claude.ai/code/session_012TidnBvRYbxhSYqPzFZuph"
```

---

### Task 11: Which devices fit, and a simulator's keys

The renderer's pure parts: devices fit a project by platform, the menu lists those first, a tab
waits only for the kinds it shows, and keys map to HID usages for simulators.

**Files:**
- Modify: `src/renderer/src/device/pick.ts`, `pick.test.ts`, `keys.ts`, `keys.test.ts`

- [ ] **Step 1: Write the failing tests**

In `src/renderer/src/device/pick.test.ts`, extend the import
(`import { choosePanel, GONE_MS, menuOrder, panelView, stillLooking } from './pick'`), add a
simulator (`const sim: DeviceInfo = { id: 'simulator:U1', kind: 'simulator', name: 'iPhone 17', detail: 'Simulator · iOS 27.0', state: 'ready' }`),
give `base` an `ios: false`, and add:

```ts
  it('fits devices by platform: phones and emulators to an Android app, simulators to an iOS one', () => {
    expect(choosePanel({ ...base, devices: [c66, sim] })).toEqual({ kind: 'device', device: c66 })
    expect(choosePanel({ ...base, android: false, ios: true, devices: [c66, sim] })).toEqual({ kind: 'device', device: sim })
    expect(choosePanel({ ...base, ios: true, devices: [c66, sim] })).toEqual({ kind: 'choose', devices: [c66, sim] })
    expect(choosePanel({ ...base, byHand: true, android: false, devices: [c66, sim] })).toEqual({ kind: 'choose', devices: [c66, sim] })
    expect(choosePanel({ ...base, project: [sim.id], devices: [c66, sim] })).toEqual({ kind: 'device', device: sim })
  })
```

and after the `choosePanel` block:

```ts
describe('menuOrder', () => {
  it('lists the devices that fit first, each group as listed', () => {
    expect(menuOrder([c66, sim, emu], { android: false, ios: true })).toEqual([sim, c66, emu])
    expect(menuOrder([c66, sim, emu], { android: true, ios: false })).toEqual([c66, emu, sim])
  })
})

describe('stillLooking', () => {
  const list = (pending: ('android' | 'ios')[]): DeviceList => ({ devices: [], problem: null, ios: null, pending })
  const android = { android: true, ios: false, picks: [] }
  it('waits for the list, and for the kinds the tab shows', () => {
    expect(stillLooking(null, android, false, undefined)).toBe(true)
    expect(stillLooking(list(['ios']), android, false, undefined)).toBe(false)
    expect(stillLooking(list(['android']), android, false, undefined)).toBe(true)
    expect(stillLooking(list(['ios']), android, true, undefined)).toBe(true)
    expect(stillLooking(list(['ios']), android, false, sim.id)).toBe(true)
    expect(stillLooking(list(['ios']), { ...android, picks: [sim.id] }, false, undefined)).toBe(true)
    expect(stillLooking(list([]), null, true, undefined)).toBe(false)
  })
})
```

(`DeviceList` joins the `@shared/types` import.)

In `src/renderer/src/device/keys.test.ts`, import `simulatorKey` and `HID_KEY`, `HID_MOD`
(`import { HID_KEY, HID_MOD } from '@shared/hid'`) and add:

```ts
describe('simulatorKey', () => {
  const press = (key: string, mods: Partial<KeyPress> = {}): KeyPress => ({ key, shiftKey: false, ctrlKey: false, metaKey: false, altKey: false, ...mods })

  it('sends named keys with Shift and Option as they are: iOS edits like a Mac', () => {
    expect(simulatorKey(press('Enter'))).toEqual({ usage: HID_KEY.ENTER, modifiers: 0 })
    expect(simulatorKey(press('Backspace', { altKey: true }))).toEqual({ usage: HID_KEY.BACKSPACE, modifiers: HID_MOD.ALT })
    expect(simulatorKey(press('ArrowLeft', { altKey: true, shiftKey: true }))).toEqual({ usage: HID_KEY.LEFT, modifiers: HID_MOD.ALT | HID_MOD.SHIFT })
  })

  it('sends ⌘ with the arrows only; every other ⌘ key and Ctrl ones stay Deck’s', () => {
    expect(simulatorKey(press('ArrowRight', { metaKey: true }))).toEqual({ usage: HID_KEY.RIGHT, modifiers: HID_MOD.CMD })
    expect(simulatorKey(press('ArrowUp', { metaKey: true, shiftKey: true }))).toEqual({ usage: HID_KEY.UP, modifiers: HID_MOD.CMD | HID_MOD.SHIFT })
    expect(simulatorKey(press('t', { metaKey: true }))).toBeNull()
    expect(simulatorKey(press('Tab', { ctrlKey: true }))).toBeNull()
  })

  it('types characters as text; leaves composing and other named keys alone', () => {
    expect(simulatorKey(press('a'))).toEqual({ text: 'a' })
    expect(simulatorKey(press('A', { shiftKey: true }))).toEqual({ text: 'A' })
    expect(simulatorKey(press('e', { isComposing: true }))).toBeNull()
    expect(simulatorKey(press('F5'))).toBeNull()
  })
})
```

(Import `type KeyPress` from `./keys` if the file doesn't already.)

- [ ] **Step 2: Run them and watch them fail**

Run: `npx vitest run src/renderer/src/device`
Expected: FAIL: `menuOrder`, `stillLooking` and `simulatorKey` don't exist, and simulators fit
Android apps.

- [ ] **Step 3: Implement**

In `src/renderer/src/device/pick.ts`, import `DeviceList` and `DevicePlatform` from
`@shared/types`, add `ios: boolean` to `ChoiceInput` (after `android`, doc "The project is an iOS
app."), and:

```ts
/** What a device runs: phones and emulators Android, simulators iOS. */
export const platformOf = (kind: DeviceInfo['kind']): DevicePlatform => (kind === 'simulator' ? 'ios' : 'android')
const platformOfId = (id: string): DevicePlatform => (id.startsWith('simulator:') ? 'ios' : 'android')

/** The project is an app for the device's platform. */
const fits = (device: DeviceInfo, project: { android: boolean; ios: boolean }) => project[platformOf(device.kind)]
```

In `choosePanel`, destructure `ios` and replace the `fits` line with:

```ts
  const fitting = byHand ? devices : android || ios ? (!tab && project.length === 0 ? devices.filter((d) => fits(d, { android, ios })) : []) : []
  if (fitting.length === 1) return { kind: 'device', device: fitting[0] }
  if (fitting.length > 1) return { kind: 'choose', devices: fitting }
  return { kind: 'none' }
```

and update its doc's "the only device that fits" sentence to say a device fits an app for its
platform. Add:

```ts
/** The menu's order: the devices that fit the project first, then the others, each as listed. */
export function menuOrder(devices: DeviceInfo[], project: { android: boolean; ios: boolean }): DeviceInfo[] {
  return [...devices.filter((d) => fits(d, project)), ...devices.filter((d) => !fits(d, project))]
}

/** Whether a tab still waits for devices: the list isn't in, or a kind it may show is still being
 *  looked for (the project's, its picks' and the tab's own pick's; every kind when asked for), so a
 *  project with a phone and a simulator asks rather than showing whichever came first. */
export function stillLooking(list: DeviceList | null, project: { android: boolean; ios: boolean; picks: string[] } | null, byHand: boolean, tabPick: string | undefined): boolean {
  if (!list) return true
  const wanted = new Set<DevicePlatform>()
  if (byHand || project?.android) wanted.add('android')
  if (byHand || project?.ios) wanted.add('ios')
  for (const id of [...(project?.picks ?? []), ...(tabPick ? [tabPick] : [])]) wanted.add(platformOfId(id))
  return list.pending.some((p) => wanted.has(p))
}
```

In `src/renderer/src/device/keys.ts`, import `HID_KEY, HID_MOD` from `@shared/hid` and add:

```ts
const HID_KEYS: Record<string, number> = {
  Enter: HID_KEY.ENTER, Escape: HID_KEY.ESCAPE, Backspace: HID_KEY.BACKSPACE, Tab: HID_KEY.TAB,
  Home: HID_KEY.HOME, PageUp: HID_KEY.PAGE_UP, Delete: HID_KEY.DELETE, End: HID_KEY.END,
  PageDown: HID_KEY.PAGE_DOWN, ArrowRight: HID_KEY.RIGHT, ArrowLeft: HID_KEY.LEFT,
  ArrowDown: HID_KEY.DOWN, ArrowUp: HID_KEY.UP,
}
const ARROWS = new Set(['ArrowLeft', 'ArrowRight', 'ArrowUp', 'ArrowDown'])

/** What a key pressed on a simulator's screen sends: a named key's USB HID usage with its modifiers,
 *  or a typed character as text; null leaves it to Deck. iOS edits text the way a Mac does, so keys
 *  go as they are: Option+Backspace deletes a word, Option+←/→ move by word, ⌘←/→ go to the line's
 *  ends and ⌘↑/↓ to the text's. Every other ⌘ key, and Ctrl ones, stay Deck's. (Simulators run on
 *  macOS only.) */
export function simulatorKey(e: KeyPress): { usage: number; modifiers: number } | { text: string } | null {
  if (e.isComposing) return null
  const modifiers = (e.shiftKey ? HID_MOD.SHIFT : 0) | (e.altKey ? HID_MOD.ALT : 0)
  if (e.metaKey) return !e.ctrlKey && ARROWS.has(e.key) ? { usage: HID_KEYS[e.key], modifiers: modifiers | HID_MOD.CMD } : null
  if (e.ctrlKey) return null
  const usage = HID_KEYS[e.key]
  if (usage !== undefined) return { usage, modifiers }
  return [...e.key].length === 1 ? { text: e.key } : null
}
```

`App.tsx` calls `choosePanel` without `ios` now: give it `ios: project?.ios ?? false` so the
typecheck passes (Task 12 does the rest of App.tsx).

- [ ] **Step 4: Run the tests and the typecheck**

Run: `npx vitest run src/renderer/src/device && npm run typecheck`
Expected: PASS.

- [ ] **Step 5: Commit**

```bash
git add src/renderer/src/device src/renderer/src/App.tsx
git -c user.email=franco@effektstudios.com commit -m "Device panel: devices fit by platform; a simulator's keys as HID usages

Claude-Session: https://claude.ai/code/session_012TidnBvRYbxhSYqPzFZuph"
```

---

### Task 12: The panel for simulators

The tab watches for iOS projects too, waits only for its kinds, orders the menu, shows Home for a
simulator, sends a simulator's keys as HID, and says when idb-companion is missing or old.

**Files:**
- Modify: `src/renderer/src/App.tsx`, `src/renderer/src/device/DevicePanel.tsx`,
  `src/renderer/src/device/DeviceScreen.tsx`, `src/renderer/src/device/device.css`

- [ ] **Step 1: `App.tsx`**

Import `menuOrder` and `stillLooking` beside `choosePanel`. In `Workspace`, replace the device block
from `const deviceNeeded = …` through `const showDevice = …` with:

```ts
  // Outside an app the panel shows only when asked for: the project's picks are remembered for
  // then, but don't open the panel in every new tab there.
  const deviceNeeded = tabHidden !== true && (byHand || project?.android === true || project?.ios === true || Boolean(tabDevice))
  const deviceList = useDeviceList(deviceNeeded)
  const devices = deviceList?.devices ?? NO_DEVICES
  const apps = { android: project?.android ?? false, ios: project?.ios ?? false }
  const deviceLooking = stillLooking(deviceList, project, byHand, tabDevice)
  // Not needed any more, the list is the old one until its effect lets it go: nothing to choose from.
  const choice = deviceNeeded && deviceList && !deviceLooking && (project || byHand)
    ? choosePanel({ tab: tabDevice, project: project?.picks ?? [], ...apps, byHand, devices })
    : null
  const deviceView = useHeldView(choice, devices, deviceRoot, tabDevice ?? project?.picks[0] ?? null)
  // A booted simulator Deck can't show (no idb-companion, or one without sim-video) opens an iOS
  // project's panel to say what to install.
  const iosHint = apps.ios && (deviceList?.ios === 'no-idb' || deviceList?.ios === 'old-idb')
  const showDevice = tabHidden !== true && (deviceView.kind !== 'none' || byHand || iosHint)
  // What the panel speaks of when it has nothing: the kinds the tab shows (iOS only on macOS).
  const wants = { android: byHand || apps.android, ios: (byHand && window.deck.platform === 'darwin') || apps.ios }
```

and the `<DevicePanel …>` element becomes:

```tsx
              <DevicePanel view={deviceView} devices={menuOrder(devices, apps)} problem={deviceList?.problem ?? null}
                iosProblem={deviceList?.ios ?? null} wants={wants} looking={deviceLooking}
                open={deviceOpen} onToggle={onDeviceToggle} visible={active && pageVisible && projectFresh} claudeRuns={claudeRuns}
                onPick={pickDevice} onInsert={insert} onFocusLost={focusTerminal} />
```

- [ ] **Step 2: `DevicePanel.tsx`**

Add to `DevicePanelProps` (after `problem`):

```ts
  /** Why simulators can't be listed (macOS). */
  iosProblem: DeviceList['ios']
  /** The kinds of device the tab shows, for what to say with none. */
  wants: { android: boolean; ios: boolean }
```

update the doc of `devices` to "Every device Deck sees, for the menu, those that fit first.", add
`iosProblem, wants` to `PanelBody`'s destructuring, and change the panel's doc ("Android's buttons"
→ "the device's buttons").

The header's buttons become (Home only for a simulator):

```tsx
        {open && ready && device && (
          <span className="dp-buttons">
            {device.kind === 'simulator' ? (
              <IconButton label="Home" onClick={() => window.deck.devices.input(device.id, { type: 'button', button: 'home' })}><HomeIcon /></IconButton>
            ) : (
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
```

`<DeviceScreen …>` gains `kind={device.kind}`, and
`{view.kind === 'none' && <Nothing problem={problem} looking={looking} />}` becomes
`{view.kind === 'none' && <Nothing problem={problem} iosProblem={iosProblem} wants={wants} looking={looking} />}`.

Replace `Nothing` with:

```tsx
/** The panel was asked for (or a simulator can't be shown) and there's nothing to show. */
function Nothing({ problem, iosProblem, wants, looking }: { problem: DeviceList['problem']; iosProblem: DeviceList['ios']; wants: { android: boolean; ios: boolean }; looking: boolean }) {
  if (looking) return <State busy title="Looking for devices…" />
  if (wants.ios && iosProblem === 'no-idb') return <Install title="Deck shows simulators with idb-companion:" command="brew install facebook/fb/idb-companion" />
  if (wants.ios && iosProblem === 'old-idb') return <Install title="This idb-companion can't stream a simulator's screen. Update it:" command="brew upgrade idb-companion" />
  if (wants.ios && iosProblem) return <State error title="Deck couldn't list the simulators" detail={iosProblem.error} />
  if (wants.android && problem === 'no-adb') {
    return <State title="Deck can't find adb, so it can't see Android devices." detail="Install Android Studio or Android's platform tools." />
  }
  if (wants.android && problem) return <State error title="adb couldn't list the devices" detail={problem.error} />
  const detail = wants.android && wants.ios
    ? 'Plug in an Android phone with USB debugging on, start an emulator, or boot a simulator.'
    : wants.ios ? 'Boot a simulator in Xcode or with simctl.' : 'Plug in an Android phone with USB debugging on, or start an emulator.'
  return <State title="No devices connected" detail={detail} />
}

/** What to run in a terminal, with Copy. */
function Install({ title, command }: { title: string; command: string }) {
  const [copied, setCopied] = useState(false)
  return (
    <State title={title}>
      <code className="dp-command">{command}</code>
      <button className="button" onClick={() => {
        window.deck.app.copyText(command)
        setCopied(true)
      }}>{copied ? 'Copied' : 'Copy'}</button>
    </State>
  )
}
```

- [ ] **Step 3: `DeviceScreen.tsx`**

Add to `DeviceScreenProps`: `kind: DeviceInfo['kind']` (doc: "Simulators take HID keys and no
wheel.") and import `DeviceInfo`; destructure `kind`; import `simulatorKey` beside `deviceKey`.
In `onWheel`, first line: `if (kind === 'simulator') return // a simulator scrolls by dragging`.
Replace `onKeyDown`'s body after `if (!interactive) return` with:

```ts
    // Built by hand: a KeyboardEvent says whether AltGr is held only through getModifierState.
    const native = e.nativeEvent
    const press = {
      key: native.key, shiftKey: native.shiftKey, ctrlKey: native.ctrlKey, metaKey: native.metaKey, altKey: native.altKey,
      altGraph: native.getModifierState('AltGraph'), isComposing: native.isComposing,
    }
    if (kind === 'simulator') {
      const key = simulatorKey(press)
      if (!key) return
      e.preventDefault()
      return send('usage' in key ? { type: 'hid', ...key } : { type: 'text', text: key.text })
    }
    const key = deviceKey(press, platform)
    if (!key) return
    e.preventDefault()
    send('keycode' in key ? { type: 'key', ...key } : { type: 'text', text: key.text })
```

- [ ] **Step 4: `device.css`**

```css
.dp-command { padding: 2px 6px; border-radius: 4px; background: var(--field); color: var(--text); font-family: var(--font-mono); font-size: 11.5px; user-select: text; }
```

- [ ] **Step 5: Typecheck and tests**

Run: `npm run typecheck && npm test`
Expected: PASS.

- [ ] **Step 6: Commit**

```bash
git add src/renderer
git -c user.email=franco@effektstudios.com commit -m "Device panel: simulators, with Home and the idb-companion hints

Claude-Session: https://claude.ai/code/session_012TidnBvRYbxhSYqPzFZuph"
```

---

### Task 13: Notices and docs

**Files:**
- Modify: `resources/THIRD-PARTY-NOTICES.txt`, `docs/superpowers/specs/2026-11-03-device-panel-design.md`,
  `CLAUDE.md`, `README.md`, `docs/DECK.md`

- [ ] **Step 1: idb's notice**

Append to `resources/THIRD-PARTY-NOTICES.txt`, in the file's style:

```
idb (https://github.com/facebook/idb)
Deck's src/main/devices/ios/proto.ts follows the message definitions of idb's proto/idb.proto.

MIT License

Copyright (c) Meta Platforms, Inc. and affiliates.

Permission is hereby granted, free of charge, to any person obtaining a copy
of this software and associated documentation files (the "Software"), to deal
in the Software without restriction, including without limitation the rights
to use, copy, modify, merge, publish, distribute, sublicense, and/or sell
copies of the Software, and to permit persons to whom the Software is
furnished to do so, subject to the following conditions:

The above copyright notice and this permission notice shall be included in all
copies or substantial portions of the Software.

THE SOFTWARE IS PROVIDED "AS IS", WITHOUT WARRANTY OF ANY KIND, EXPRESS OR
IMPLIED, INCLUDING BUT NOT LIMITED TO THE WARRANTIES OF MERCHANTABILITY,
FITNESS FOR A PARTICULAR PURPOSE AND NONINFRINGEMENT. IN NO EVENT SHALL THE
AUTHORS OR COPYRIGHT HOLDERS BE LIABLE FOR ANY CLAIM, DAMAGES OR OTHER
LIABILITY, WHETHER IN AN ACTION OF CONTRACT, TORT OR OTHERWISE, ARISING FROM,
OUT OF OR IN CONNECTION WITH THE SOFTWARE OR THE USE OR OTHER DEALINGS IN THE
SOFTWARE.
```

- [ ] **Step 2: The spec**

In `docs/superpowers/specs/2026-11-03-device-panel-design.md`:
- the header: "Updated 2026-11-10 with step 2 (simulators): …" listing the four departures at the
  top of this plan, each with its reason;
- **Finding devices › Simulators:** the notifier's lines (first all, then changes), one watch for
  both kinds with `pending`, `DECK_SIMULATOR_SET` and `DECK_IDB_COMPANION` for checks, and the
  no-idb check (`xcode-select -p`, then `simctl`, only when idb-companion is missing);
- **How › Simulators:** `--transport fmp4` instead of `annex-b` (and why), the companion's flags
  (`--terminate-offline true`, `--log-level info`), the socket folder (`socketDirFor`, private, under
  104 bytes, removed at quit), describe and hid over `node:http2`, touches as downs and an up,
  typing and pastes as a US keyboard (at most 1,000 characters), the replayed group of pictures;
- **The view:** "`sim-video`'s Annex B stream is cut into frames" → its fMP4 fragments are turned
  into Annex B in main; "`sim-video` sends one every 2 s" → while the screen changes, and a joining
  view gets the current group replayed;
- **States › No idb-companion:** shown with a simulator booted, also for an idb-companion without
  sim-video, with Copy; and "Deck couldn't list the simulators" with the notifier's last words;
- **Code:** `session.ts`, `registry.ts` (a pure merge; starting and stopping stays in `ipc.ts`),
  `ios/` with the files of this plan; `@shared/hid`;
- **Packaging:** no `@grpc/grpc-js`; idb's notice;
- **Known limits:** a paste of more than 1,000 characters is cut; characters a US keyboard can't type
  are skipped; simulators in a device set other than Xcode's aren't listed (except with
  `DECK_SIMULATOR_SET`); a rotated simulator in a landscape app is unchecked; an iOS project outside
  git is found only by an Xcode project in the folder itself;
- **Build order:** step 2 built 2026-11-10.

- [ ] **Step 3: `CLAUDE.md`**

- The `src/main/devices/` row of the paths table: add `session.ts` (one session shape), `registry.ts`
  (one list from both sources), and `ios/` (finding idb and following simulators, sessions:
  companion, gRPC on `node:http2`, sim-video's fMP4, HID input). The `src/renderer/src/device/` row:
  "the screen (… `keys.ts`: Android key codes and simulators' HID usages)".
- "Current state": the device panel's step 2 (simulators) built 2026-11-10 (spec and plan paths),
  checked on a throwaway simulator; iPhones are step 3.
- Device panel section: a **Simulators** bullet with the facts at the top of this plan that aren't
  obvious from the code (Homebrew's layout; the notifier's first line and changes; the socket path
  limit and its error; fMP4 and why; key frames only while the screen changes, so the group is
  replayed; iOS's paste prompt; two companions per simulator are fine; `DECK_SIMULATOR_SET` and
  `DECK_IDB_COMPANION` for checks; never touch Franco's own simulators in a check). The
  **Which projects** bullet: the iOS rule. The **Which device a tab shows** bullet: devices fit by
  platform; `pending` and `stillLooking`.
- "Next steps" item 5: step 2 built; next the hands-on checks, then step 3 (iPhones).

- [ ] **Step 4: `README.md` and `docs/DECK.md`**

README's **Device panel** paragraph: "the phone, emulator or (on macOS, with idb-companion from
Homebrew) simulator the app runs on"; Home for a simulator. DECK.md's device panel line: step 2
(simulators) built 2026-11-10.

- [ ] **Step 5: Commit**

```bash
git add resources/THIRD-PARTY-NOTICES.txt docs CLAUDE.md README.md
git -c user.email=franco@effektstudios.com commit -m "Docs: the device panel, step 2 (simulators)

Claude-Session: https://claude.ai/code/session_012TidnBvRYbxhSYqPzFZuph"
```

---

### Task 14: On a simulator

A dev build checked through the DevTools protocol against a throwaway simulator in a private device
set, never Franco's own simulators. No Claude prompt is sent (memory: no tokens in checks).

- [ ] **Step 1: A throwaway simulator**

```bash
SCR=<the session's scratchpad>; SET="$SCR/simset"; mkdir -p "$SET"
U=$(xcrun simctl --set "$SET" create "Deck check" com.apple.CoreSimulator.SimDeviceType.iPhone-17 com.apple.CoreSimulator.SimRuntime.iOS-27-0)
xcrun simctl --set "$SET" boot "$U" && xcrun simctl --set "$SET" bootstatus "$U" -b
```

- [ ] **Step 2: The dev build**

With its own data folder, the private set, and a copy of `devices.json`:

```bash
env -u CLAUDECODE DECK_SIMULATOR_SET="$SET" npx electron-vite dev --remoteDebuggingPort 9333 --inspect 9229 -- --user-data-dir="$SCR/deck-dev-data"
```

Open a tab in an iOS project (`--open` with a folder holding an `.xcodeproj` in a git repository: a
throwaway one in the scratchpad is enough), through a second launch with the same
`--user-data-dir`.

- [ ] **Step 3: Check, through `Runtime.evaluate` and `simctl io … screenshot`**

- the panel shows "Deck check", `Simulator · iOS 27.0`, with only Home in the header;
- the stream goes live (the canvas gets frames) within about 2 s;
- a synthetic pointer down/up on the canvas over Settings' "General" opens it (screenshot);
- typing into the search field types "Ab1!"; a paste event with "xyz" types it;
- Home goes back to the home screen;
- switching tabs and back within 10 s shows the picture at once (the group replayed), with no
  restart (one `sim-video` process, `pgrep -fl sim-video`);
- quitting leaves no `idb_companion --udid "$U"` and no `sim-video`, and the socket folder is gone;
- with `DECK_IDB_COMPANION=/nowhere` and a simulator booted in Xcode's own set (Franco's are, but
  look only): an iOS project's panel says "Deck shows simulators with idb-companion:" with Copy.

- [ ] **Step 4: Clean up**

```bash
xcrun simctl --set "$SET" shutdown "$U"; xcrun simctl --set "$SET" delete "$U"
```

Record what was checked (and what wasn't) in CLAUDE.md's device panel section, and commit.
