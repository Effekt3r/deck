# Device panel, step 1 (Android) Implementation Plan

> **For agentic workers:** REQUIRED SUB-SKILL: Use superpowers:subagent-driven-development (recommended) or superpowers:executing-plans to implement this plan task-by-task. Steps use checkbox (`- [ ]`) syntax for tracking.

**Goal:** At the top of the right pane, show the Android phone or emulator a tab's project runs on,
live, and let Franco tap, type and press Back/Home on it, pick the device per tab and project, and
add a screenshot to Claude's prompt. macOS and Windows.

**Architecture:** Main follows adb's devices with one long-running `adb track-devices -l` (only
while a tab needs devices) and asks each new device what it is. A viewed device gets a scrcpy
session: Deck pushes scrcpy's server (v5.0.1, downloaded at install, never committed), opens an
adb forward tunnel, starts the server and reads its H.264 stream; main forwards packets to the
renderer, which decodes them with WebCodecs onto a canvas and sends touches and keys back as
scrcpy control messages. Pure parts (adb output, scrcpy's wire format, which device a tab shows,
letterboxing, keys, the codec string) are tested on their own. With Android the only source,
`devices/ipc.ts` plays the spec's `registry.ts`; step 2 splits that out when simulators arrive. Spec:
`docs/superpowers/specs/2026-11-03-device-panel-design.md` (step 1 of its build order).

**Tech Stack:** Electron 45 (main/preload/renderer), Node 22 (`net`, `child_process`), React 19,
TypeScript, WebCodecs `VideoDecoder`, vitest (node environment), plain CSS with the tokens in
`src/renderer/src/styles.css`.

**Conventions:**
- Node 22: `export PATH="$HOME/.nvm/versions/node/v22.19.0/bin:$PATH"` before npm commands.
- Work on the branch `m5-device-panel` (it exists, with the spec).
- Commits use `git -c user.email=franco@effektstudios.com commit` and never carry
  `Co-Authored-By`. They end with
  `Claude-Session: https://claude.ai/code/session_012TidnAXmFkf7jwBCQQo4jJ`.
- Comments explain why, in the repo's plain style. Tests sit next to their source as `*.test.ts`.
- Never commit device screenshots or session logs: they can show client data.

**scrcpy facts this plan relies on** (read from scrcpy 5.0.1's source, 2026-11-03):
- The server must be started with the exact version string of the file (`5.0.1`); `scid` is parsed
  as hex and names the socket `scrcpy_%08x`.
- With `tunnel_forward=true` the first socket gets one dummy byte, then the device's name (64
  bytes, NUL-padded), then the video codec id (u32, `0x68323634` for H.264). Then 12-byte headers:
  a capture session's has the first bit set (width and height follow as u32); a packet's is a u64
  (bit 62 config, bit 61 key frame, the rest the PTS) and a u32 size, then the packet.
- Control messages (big-endian): inject keycode (type 0, 14 bytes), text (1), touch (2, 32 bytes),
  scroll (3, 21 bytes, scroll values as i16 fixed point of value/16), set clipboard (9), reset
  video (17, one byte). A touch must carry the current video size or the server ignores it.
  Pointer id -2 (`POINTER_ID_GENERIC_FINGER`) is injected as a finger.
- `cleanup=true` (default): a separate process on the device deletes the jar at start and puts back
  `stay_on_while_plugged_in` when the server dies, even when the cable is pulled.

---

## File structure

| File | Responsibility |
|---|---|
| `resources/scrcpy-server.json` (create) | the server's version, URL, size and SHA-256 |
| `resources/THIRD-PARTY-NOTICES.txt` (create) | scrcpy's copyright and Apache 2.0 license, shipped with the app |
| `scripts/fetch-scrcpy-server.mjs` (create) | downloads and checks the server at install |
| `package.json`, `.gitignore`, `electron-builder.yml` (modify) | postinstall, ignore the download, ship it |
| `src/shared/types.ts`, `src/shared/channels.ts` (modify) | `DeviceInfo`, `DeviceList`, `DeviceProject`, `DeviceStreamEvent`, `DeviceInput`, `DeckApi.devices`, `devices:*`, `toggle-device` |
| `src/preload/index.ts` (modify) | `window.deck.devices` |
| `src/main/devices/android/devices.ts` (create) | `track-devices -l` frames, identities, one device per phone (pure) |
| `src/main/devices/android/adb.ts` (create) | where adb is; running it |
| `src/main/devices/android/tracker.ts` (create) | the long-running `track-devices`, identity lookups, restarts; the first list waits for its devices |
| `src/main/devices/android/protocol.ts` (create) | scrcpy's video stream reader and control messages (pure) |
| `src/main/devices/android/input.ts` (create) | renderer input → control messages, checked (pure) |
| `src/main/devices/android/server.ts` (create) | the server file and its version |
| `src/main/devices/android/scrcpy.ts` (create) | one session: push, tunnel, start, sockets, stop |
| `src/main/devices/streams.ts` (create) | one stream per device viewed: viewers, 10 s grace, retries, pause |
| `src/main/devices/project.ts` (create) | a folder's project root, and whether it's an Android app |
| `src/main/devices/picks.ts` (create) | `devices.json`: each project's device |
| `src/main/devices/ipc.ts` (create) | wiring: watches, project, picks, views, input, screenshots, lock and sleep |
| `src/main/clipboard/ipc.ts` (modify) | `saveImage`, for screenshots |
| `src/main/index.ts` (modify) | registers and attaches the device IPC |
| `src/main/menu.ts`, `menu.test.ts` (modify) | View → Device Panel |
| `src/renderer/src/device/pick.ts` (create) | which device a tab shows; the 10 s hold (pure) |
| `src/renderer/src/device/fit.ts` (create) | letterboxing and pointer mapping (pure) |
| `src/renderer/src/device/keys.ts` (create) | keys → Android key codes or text (pure) |
| `src/renderer/src/device/codec.ts` (create) | NAL units and the avc1 codec string (pure) |
| `src/renderer/src/device/useDevices.ts` (create) | `useDeviceList`, `useDeviceProject`, `useHeldView` |
| `src/renderer/src/device/DeviceScreen.tsx` (create) | decoder, canvas, input, screenshot |
| `src/renderer/src/device/DeviceMenu.tsx` (create) | the device menu |
| `src/renderer/src/device/DevicePanel.tsx` (create) | header, chooser, states, error boundary |
| `src/renderer/src/device/device.css` (create) | styles |
| `src/renderer/src/hooks.ts`, `icons.tsx` (modify) | `usePageVisible`; Back, Home, Recents, Power, Camera icons |
| `src/renderer/src/claude/SessionPicker.tsx` (modify) | exports `placeBelow` |
| `src/renderer/src/tabs/tabs.ts`, `tabs.test.ts` (modify) | `device`, `deviceHidden` |
| `src/renderer/src/terminal/keys.ts`, `keys.test.ts` (modify) | Ctrl+Shift+D goes to the menu |
| `src/renderer/src/App.tsx` (modify) | the right pane: device panel, splitter, Claude panel |
| `CLAUDE.md`, `README.md`, `docs/DECK.md`, `docs/TESTING.md` (modify) | docs |

---

### Task 1: scrcpy's server, fetched at install

**Files:**
- Create: `resources/scrcpy-server.json`
- Create: `resources/THIRD-PARTY-NOTICES.txt`
- Create: `scripts/fetch-scrcpy-server.mjs`
- Modify: `package.json` (scripts)
- Modify: `.gitignore`
- Modify: `electron-builder.yml` (after `npmRebuild: false`)

- [ ] **Step 1: The version Deck runs**

Create `resources/scrcpy-server.json`:

```json
{
  "version": "5.0.1",
  "url": "https://github.com/Genymobile/scrcpy/releases/download/v5.0.1/scrcpy-server-v5.0.1",
  "size": 733930,
  "sha256": "764eb6f79811d5211fe9df341120882ba9994c7a61b897d7bf3fb662e53bc536"
}
```

- [ ] **Step 2: The download script**

Create `scripts/fetch-scrcpy-server.mjs`:

```js
// Deck runs scrcpy's server on Android devices (src/main/devices/android/scrcpy.ts). It isn't
// committed: this downloads the version resources/scrcpy-server.json names from scrcpy's GitHub
// release and keeps it only when its SHA-256 matches. postinstall runs it; so can
// `npm run fetch:scrcpy`.
import { createHash } from 'node:crypto'
import { readFileSync, renameSync, rmSync, writeFileSync } from 'node:fs'
import { dirname, join } from 'node:path'
import { fileURLToPath } from 'node:url'

const resources = join(dirname(fileURLToPath(import.meta.url)), '..', 'resources')
const info = JSON.parse(readFileSync(join(resources, 'scrcpy-server.json'), 'utf8'))
const file = join(resources, 'scrcpy-server')
const sha256 = (bytes) => createHash('sha256').update(bytes).digest('hex')

function present() {
  try {
    return sha256(readFileSync(file)) === info.sha256
  } catch {
    return false
  }
}

async function fetchServer() {
  if (present()) return console.log(`scrcpy server ${info.version}: already here`)
  const res = await fetch(info.url, { redirect: 'follow' })
  if (!res.ok) throw new Error(`${info.url}: HTTP ${res.status}`)
  const bytes = Buffer.from(await res.arrayBuffer())
  const got = sha256(bytes)
  if (got !== info.sha256) throw new Error(`scrcpy server ${info.version}: SHA-256 ${got}, expected ${info.sha256}`)
  const tmp = `${file}.${process.pid}.tmp`
  try {
    writeFileSync(tmp, bytes)
    renameSync(tmp, file)
  } finally {
    rmSync(tmp, { force: true })
  }
  console.log(`scrcpy server ${info.version}: downloaded`)
}

fetchServer().catch((err) => {
  console.error(`Couldn't fetch scrcpy's server: ${err.message}`)
  // Without it Deck can't show Android devices. CI and releases stop here; a local install carries
  // on, and the device panel says what's missing.
  if (process.env.CI) process.exit(1)
})
```

- [ ] **Step 3: Run it at install, ignore what it downloads**

In `package.json`, replace the `postinstall` line and add `fetch:scrcpy` after it:

```json
    "postinstall": "node scripts/postinstall.mjs && node scripts/fetch-scrcpy-server.mjs",
    "fetch:scrcpy": "node scripts/fetch-scrcpy-server.mjs"
```

Append to `.gitignore`:

```
# scrcpy's server, downloaded at install (scripts/fetch-scrcpy-server.mjs)
/resources/scrcpy-server
/resources/scrcpy-server.*.tmp
```

- [ ] **Step 4: The notices shipped with the app**

Create `resources/THIRD-PARTY-NOTICES.txt` with this header:

```
Deck includes the following third-party software.

scrcpy server 5.0.1 (scrcpy-server), https://github.com/Genymobile/scrcpy
Deck copies it to an Android device and runs it there to show the device's screen.

    Copyright (C) 2018 Genymobile
    Copyright (C) 2018-2026 Romain Vimont

Licensed under the Apache License, Version 2.0, whose text follows.

```

Then append the license text from the same tag:

```bash
curl -fsSL https://raw.githubusercontent.com/Genymobile/scrcpy/v5.0.1/LICENSE >> resources/THIRD-PARTY-NOTICES.txt
grep -c 'Apache License' resources/THIRD-PARTY-NOTICES.txt
```

Expected: a count of at least 2.

- [ ] **Step 5: Ship them**

In `electron-builder.yml`, after the `npmRebuild: false` line, add:

```yaml

# scrcpy's server (scripts/fetch-scrcpy-server.mjs downloads it at install), its version and the
# third-party notices, beside the app as plain files: adb pushes the server from a real path.
extraResources:
  - from: resources/scrcpy-server
    to: scrcpy-server
  - from: resources/scrcpy-server.json
    to: scrcpy-server.json
  - from: resources/THIRD-PARTY-NOTICES.txt
    to: THIRD-PARTY-NOTICES.txt
```

- [ ] **Step 6: Run the script**

Run: `node scripts/fetch-scrcpy-server.mjs && node scripts/fetch-scrcpy-server.mjs && shasum -a 256 resources/scrcpy-server && git status --short`
Expected: `scrcpy server 5.0.1: downloaded`, then `scrcpy server 5.0.1: already here`, the hash
`764eb6f79811d5211fe9df341120882ba9994c7a61b897d7bf3fb662e53bc536`, and `git status` listing the
new files but not `resources/scrcpy-server`.

- [ ] **Step 7: Commit**

```bash
git add resources/scrcpy-server.json resources/THIRD-PARTY-NOTICES.txt scripts/fetch-scrcpy-server.mjs package.json .gitignore electron-builder.yml
git -c user.email=franco@effektstudios.com commit -m "Devices: fetch scrcpy's server at install and ship it" -m "Claude-Session: https://claude.ai/code/session_012TidnAXmFkf7jwBCQQo4jJ"
```

---

### Task 2: The IPC contract

**Files:**
- Modify: `src/shared/types.ts` (`MenuCommand`; after `UsageChange`; inside `DeckApi` after `usage`)
- Modify: `src/shared/channels.ts`
- Modify: `src/preload/index.ts`

- [ ] **Step 1: Types**

In `src/shared/types.ts`, add a member to `MenuCommand` after `{ type: 'toggle-claude' }`:

```ts
  | { type: 'toggle-device' }
```

After `export type UsageChange = …`, add:

```ts
/** An Android phone or emulator that adb sees. */
export interface DeviceInfo {
  /** The same across reconnects and connections: `android:<serial number>`, or
   *  `emulator:<AVD name>` (an emulator's adb name changes with its port). */
  id: string
  kind: 'android' | 'emulator'
  /** The name set on the phone ("Franco's S25 FE"), else its maker and model; an emulator's AVD name. */
  name: string
  /** Its Android version and connection: "Android 13 · USB", "Android 17 · USB + Wi-Fi",
   *  "Emulator · Android 15". */
  detail: string
  /** ready: it can be shown; unauthorized: USB debugging isn't allowed on it yet; offline: adb
   *  can't reach it; connecting: adb is still setting it up. */
  state: 'ready' | 'unauthorized' | 'offline' | 'connecting'
}

/** The devices Deck sees, or why it sees none. */
export interface DeviceList {
  devices: DeviceInfo[]
  /** 'no-adb': adb wasn't found; { error }: adb failed; null: adb runs. */
  problem: 'no-adb' | { error: string } | null
}

/** A tab's project, for the device panel. */
export interface DeviceProject {
  /** Its repository's main work tree (worktrees share it), or the folder outside git. */
  root: string
  /** It's an Android app, so it takes Android phones and emulators. */
  android: boolean
  /** The device last picked in it. */
  pick: string | null
}

/** News of a device's stream. */
export type DeviceStreamEvent =
  /** connecting: starting; live: frames are coming; reconnecting: it broke and is starting again;
   *  error: it couldn't be started (`message`), until Try again. */
  | { type: 'state'; state: 'connecting' | 'live' | 'reconnecting' | 'error'; message?: string }
  /** A capture session started (also after a rotation): the frames that follow have this size. */
  | { type: 'size'; width: number; height: number }
  /** H.264, Annex B. A config packet holds SPS and PPS, which the next key frame needs. */
  | { type: 'packet'; config: boolean; key: boolean; data: Uint8Array }

/** Input for a device. Positions are in the frame's pixels with the frame's size (the last 'size'):
 *  scrcpy ignores a touch made for another size. */
export type DeviceInput =
  | { type: 'touch'; action: 'down' | 'move' | 'up'; x: number; y: number; width: number; height: number }
  /** dx, dy: scroll steps, -16 … 16; a positive dy scrolls up, like a wheel pushed away. */
  | { type: 'scroll'; x: number; y: number; width: number; height: number; dx: number; dy: number }
  /** An Android key code pressed and let go, with Android's meta state (shift 1, alt 2). */
  | { type: 'key'; keycode: number; meta: number }
  | { type: 'text'; text: string }
  /** Puts `text` on the device's clipboard and pastes it. */
  | { type: 'paste'; text: string }
```

Inside `DeckApi`, after the `usage: { … }` block, add:

```ts
  devices: {
    /** Look for Android devices (adb) from now; the function stops this look. adb runs while any
     *  look is on, so only while some tab needs devices. */
    watch(): () => void
    /** The devices now. */
    list(): Promise<DeviceList>
    onList(cb: (list: DeviceList) => void): () => void
    /** `folder`'s project: its root, whether it's an Android app, and its device. */
    project(folder: string): Promise<DeviceProject>
    /** Remembers `id` as the project's device. */
    pick(root: string, id: string): Promise<void>
    /** Streams device `id` from now; the function stops viewing. A stream nobody views stops 10 s
     *  later, so viewing it again before then picks it up. */
    view(id: string): () => void
    onStream(cb: (id: string, event: DeviceStreamEvent) => void): () => void
    /** A fresh key frame, for a decoder that fell behind or failed. */
    keyframe(id: string): void
    /** Starts a stream that ended in an error again. */
    retry(id: string): void
    input(id: string, input: DeviceInput): void
    /** Saves a screenshot (PNG) where Claude can read it: the text that adds it to Claude's prompt. */
    screenshot(png: Uint8Array): Promise<InsertResult>
  }
```

- [ ] **Step 2: Channels**

In `src/shared/channels.ts`, after `usageDisconnect: 'usage:disconnect',`, add:

```ts
  devicesWatch: 'devices:watch',
  devicesUnwatch: 'devices:unwatch',
  devicesList: 'devices:list',
  devicesChanged: 'devices:changed',
  devicesProject: 'devices:project',
  devicesPick: 'devices:pick',
  devicesView: 'devices:view',
  devicesUnview: 'devices:unview',
  devicesStream: 'devices:stream',
  devicesKeyframe: 'devices:keyframe',
  devicesRetry: 'devices:retry',
  devicesInput: 'devices:input',
  devicesScreenshot: 'devices:screenshot',
```

- [ ] **Step 3: Preload**

In `src/preload/index.ts`, change the types import to:

```ts
import type { ClaudeSnapshot, ClipboardPreview, DeckApi, DeviceList, DeviceStreamEvent, GitSnapshot, MenuCommand, Platform, UsageState } from '@shared/types'
```

After the `on()` function, add:

```ts
/** A stop function that does its work once, however often it's called. */
function once(fn: () => void): () => void {
  let done = false
  return () => {
    if (done) return
    done = true
    fn()
  }
}
```

In `api`, after the `usage: { … },` block, add:

```ts
  devices: {
    watch: () => {
      ipcRenderer.send(IPC.devicesWatch)
      return once(() => ipcRenderer.send(IPC.devicesUnwatch))
    },
    list: () => ipcRenderer.invoke(IPC.devicesList),
    onList: (cb) => on<[DeviceList]>(IPC.devicesChanged, cb),
    project: (folder) => ipcRenderer.invoke(IPC.devicesProject, folder),
    pick: (root, id) => ipcRenderer.invoke(IPC.devicesPick, root, id),
    view: (id) => {
      ipcRenderer.send(IPC.devicesView, id)
      return once(() => ipcRenderer.send(IPC.devicesUnview, id))
    },
    onStream: (cb) => on<[string, DeviceStreamEvent]>(IPC.devicesStream, cb),
    keyframe: (id) => ipcRenderer.send(IPC.devicesKeyframe, id),
    retry: (id) => ipcRenderer.send(IPC.devicesRetry, id),
    input: (id, input) => ipcRenderer.send(IPC.devicesInput, id, input),
    screenshot: (png) => ipcRenderer.invoke(IPC.devicesScreenshot, png),
  },
```

- [ ] **Step 4: Typecheck**

Run: `npm run typecheck`
Expected: PASS. (`App.tsx`'s menu switch has no `default`, so the new command needs no case yet.)

- [ ] **Step 5: Commit**

```bash
git add src/shared/types.ts src/shared/channels.ts src/preload/index.ts
git -c user.email=franco@effektstudios.com commit -m "Devices: the IPC contract" -m "Claude-Session: https://claude.ai/code/session_012TidnAXmFkf7jwBCQQo4jJ"
```

---

### Task 3: adb's device lists

**Files:**
- Create: `src/main/devices/android/devices.ts`
- Test: `src/main/devices/android/devices.test.ts`

- [ ] **Step 1: Write the failing test**

Create `src/main/devices/android/devices.test.ts`:

```ts
import { describe, expect, it } from 'vitest'
import { deviceId, IDENTITY_SCRIPT, type Identity, mergeDevices, parseDeviceLines, parseIdentity, readTrackFrames, type Seen } from './devices'

/** A list as `adb track-devices` sends it: its length in four hex digits, then the lines. */
const frame = (text: string) => Buffer.from(Buffer.byteLength(text).toString(16).padStart(4, '0') + text)

// As adb listed Franco's devices on 2026-11-03.
const C66 = '8d2e61a              device usb:34603008X product:C66 model:C66 device:C66 transport_id:32410\n'
const S25_USB = 'R5CW20XY7QZ            device usb:17825792X product:r13sxxx model:SM_S731B device:r13s transport_id:32564\n'
const S25_WIFI = 'adb-R5CW20XY7QZ-Xk3Tq9._adb-tls-connect._tcp device product:r13sxxx model:SM_S731B device:r13s transport_id:32565\n'
const EMULATOR = 'emulator-5554          device product:sdk_gphone64_arm64 model:sdk_gphone64_arm64 device:emu64a transport_id:30144\n'

const identity = (over: Partial<Identity>): Identity => ({ serialNo: '', maker: '', model: '', release: '', avd: '', name: '', ...over })
const c66 = identity({ serialNo: '8d2e61a', maker: 'CHAINWAY', model: 'C66', release: '13', name: 'C66' })
const s25 = identity({ serialNo: 'R5CW20XY7QZ', maker: 'samsung', model: 'SM-S731B', release: '17', name: "Franco's S25 FE" })
const emu = identity({ serialNo: 'EMULATOR37X2X12X0', maker: 'Google', model: 'sdk_gphone64_arm64', release: '15', avd: 'Pixel_9', name: 'sdk_gphone64_arm64' })
const entry = (line: string) => parseDeviceLines(line)[0]

describe('parseDeviceLines', () => {
  it('reads the serial, state, cable and connection', () => {
    expect(parseDeviceLines(C66 + S25_WIFI)).toEqual([
      { serial: '8d2e61a', state: 'device', usb: true, model: 'C66', transport: '32410' },
      { serial: 'adb-R5CW20XY7QZ-Xk3Tq9._adb-tls-connect._tcp', state: 'device', usb: false, model: 'SM_S731B', transport: '32565' },
    ])
  })

  it('reads a device not allowed yet, and skips blank lines', () => {
    expect(parseDeviceLines('\n8d2e61a unauthorized usb:34603008X transport_id:7\n\n')).toEqual([
      { serial: '8d2e61a', state: 'unauthorized', usb: true, model: '', transport: '7' },
    ])
  })
})

describe('readTrackFrames', () => {
  it('reads every complete list and keeps the rest for the next chunk', () => {
    const all = Buffer.concat([frame(C66), frame(C66 + EMULATOR), frame(S25_USB)])
    const cut = all.length - 5
    const first = readTrackFrames(all.subarray(0, cut))
    expect(first.lists.map((list) => list.map((e) => e.serial))).toEqual([['8d2e61a'], ['8d2e61a', 'emulator-5554']])
    const second = readTrackFrames(Buffer.concat([first.rest, all.subarray(cut)]))
    expect(second.lists.map((list) => list.map((e) => e.serial))).toEqual([['R5CW20XY7QZ']])
    expect(second.rest.length).toBe(0)
  })

  it('reads an empty list: every device unplugged', () => {
    expect(readTrackFrames(Buffer.from('0000')).lists).toEqual([[]])
  })

  it("refuses output that isn't a list", () => {
    expect(() => readTrackFrames(Buffer.from('* daemon started'))).toThrow(/unexpected output/)
  })
})

describe('parseIdentity', () => {
  it("reads the script's lines, CRLF and the \"null\" of a missing setting included", () => {
    expect(parseIdentity('serial=8d2e61a\r\nmaker=CHAINWAY\r\nmodel=C66\r\nrelease=13\r\navd=\r\nname=null\r\n'))
      .toEqual(identity({ serialNo: '8d2e61a', maker: 'CHAINWAY', model: 'C66', release: '13' }))
  })

  it('asks for everything it reads', () => {
    for (const key of ['serial=', 'maker=', 'model=', 'release=', 'avd=', 'name=']) expect(IDENTITY_SCRIPT).toContain(key)
  })
})

describe('deviceId', () => {
  it("is a phone's serial number, or an emulator's AVD name", () => {
    expect(deviceId({ entry: entry(C66), identity: c66 })).toBe('android:8d2e61a')
    expect(deviceId({ entry: entry(EMULATOR), identity: emu })).toBe('emulator:Pixel_9')
  })

  it("before the device answers: its USB name, or the serial inside a Wi-Fi (mDNS) name", () => {
    expect(deviceId({ entry: entry(C66), identity: null })).toBe('android:8d2e61a')
    expect(deviceId({ entry: entry(S25_WIFI), identity: null })).toBe('android:R5CW20XY7QZ')
  })
})

describe('mergeDevices', () => {
  it('lists one device per phone, reached over USB first, phones before emulators', () => {
    const seen: Seen[] = [
      { entry: entry(EMULATOR), identity: emu },
      { entry: entry(S25_WIFI), identity: s25 },
      { entry: entry(C66), identity: c66 },
      { entry: entry(S25_USB), identity: s25 },
    ]
    const { devices, serials } = mergeDevices(seen)
    expect(devices).toEqual([
      { id: 'android:8d2e61a', kind: 'android', name: 'C66', detail: 'Android 13 · USB', state: 'ready' },
      { id: 'android:R5CW20XY7QZ', kind: 'android', name: "Franco's S25 FE", detail: 'Android 17 · USB + Wi-Fi', state: 'ready' },
      { id: 'emulator:Pixel_9', kind: 'emulator', name: 'Pixel 9', detail: 'Emulator · Android 15', state: 'ready' },
    ])
    expect(serials.get('android:R5CW20XY7QZ')).toBe('R5CW20XY7QZ')
    expect(serials.get('emulator:Pixel_9')).toBe('emulator-5554')
  })

  it('carries on over Wi-Fi when the cable is pulled, or its connection is offline', () => {
    const wifi = 'adb-R5CW20XY7QZ-Xk3Tq9._adb-tls-connect._tcp'
    const pulled = mergeDevices([{ entry: entry(S25_WIFI), identity: s25 }])
    expect(pulled.devices[0].detail).toBe('Android 17 · Wi-Fi')
    expect(pulled.serials.get('android:R5CW20XY7QZ')).toBe(wifi)
    const offline = mergeDevices([{ entry: { ...entry(S25_USB), state: 'offline' }, identity: null }, { entry: entry(S25_WIFI), identity: s25 }])
    expect(offline.devices).toEqual([{ id: 'android:R5CW20XY7QZ', kind: 'android', name: "Franco's S25 FE", detail: 'Android 17 · Wi-Fi', state: 'ready' }])
    expect(offline.serials.get('android:R5CW20XY7QZ')).toBe(wifi)
  })

  it("names a device that couldn't answer by adb's model, else its adb name", () => {
    const { devices } = mergeDevices([
      { entry: entry('8d2e61a unauthorized usb:1 transport_id:7\n'), identity: null },
      { entry: entry(S25_WIFI), identity: null },
    ])
    expect(devices.map((d) => [d.name, d.state, d.detail])).toEqual([
      ['8d2e61a', 'unauthorized', 'USB'],
      ['SM S731B', 'ready', 'Wi-Fi'],
    ])
  })
})
```

- [ ] **Step 2: Run it to make sure it fails**

Run: `npx vitest run src/main/devices/android/devices.test.ts`
Expected: FAIL: `Failed to resolve import "./devices"`.

- [ ] **Step 3: Write the implementation**

Create `src/main/devices/android/devices.ts`:

```ts
import type { DeviceInfo } from '@shared/types'

/** One line of `adb track-devices -l`. */
export interface AdbEntry {
  /** adb's name for it: `8d2e61a`, `emulator-5554`, `adb-R5CW20XY7QZ-Xk3Tq9._adb-tls-connect._tcp`,
   *  `192.168.1.5:5555`. */
  serial: string
  /** device, unauthorized, offline, authorizing, connecting, recovery … */
  state: string
  /** By cable: adb lists a `usb:` field. */
  usb: boolean
  /** adb's model field (`SM_S731B`); '' when adb doesn't know it. */
  model: string
  /** New with every connection, so a device that reconnects (or another emulator on the same port)
   *  is asked again what it is. */
  transport: string
}

/** Lines like `8d2e61a   device usb:34603008X product:C66 model:C66 device:C66 transport_id:32410`. */
export function parseDeviceLines(text: string): AdbEntry[] {
  const entries: AdbEntry[] = []
  for (const line of text.split('\n')) {
    const [serial, state, ...fields] = line.trim().split(/\s+/)
    if (!serial || !state) continue
    const attrs = new Map<string, string>()
    for (const field of fields) {
      const i = field.indexOf(':')
      if (i > 0) attrs.set(field.slice(0, i), field.slice(i + 1))
    }
    entries.push({ serial, state, usb: attrs.has('usb'), model: attrs.get('model') ?? '', transport: attrs.get('transport_id') ?? '' })
  }
  return entries
}

/** `adb track-devices -l` writes each list as four hex digits of length, then that many bytes. The
 *  lists complete in `buf`, and what's left of the next one. Throws on a length that isn't hex. */
export function readTrackFrames(buf: Buffer): { lists: AdbEntry[][]; rest: Buffer } {
  const lists: AdbEntry[][] = []
  let at = 0
  while (buf.length - at >= 4) {
    const head = buf.toString('latin1', at, at + 4)
    if (!/^[0-9a-f]{4}$/i.test(head)) throw new Error(`adb track-devices: unexpected output ${JSON.stringify(head)}`)
    const length = Number.parseInt(head, 16)
    if (buf.length - at - 4 < length) break
    lists.push(parseDeviceLines(buf.toString('utf8', at + 4, at + 4 + length)))
    at += 4 + length
  }
  return { lists, rest: buf.subarray(at) }
}

/** What Deck asks a device, in one `adb shell` call: one `key=value` line each. */
export const IDENTITY_SCRIPT = [
  'echo "serial=$(getprop ro.serialno)"',
  'echo "maker=$(getprop ro.product.manufacturer)"',
  'echo "model=$(getprop ro.product.model)"',
  'echo "release=$(getprop ro.build.version.release)"',
  // ro.boot on recent emulator images, ro.kernel on older ones; empty on phones.
  'echo "avd=$(getprop ro.boot.qemu.avd_name)$(getprop ro.kernel.qemu.avd_name)"',
  'echo "name=$(settings get global device_name 2>/dev/null)"',
].join('; ')

export interface Identity {
  serialNo: string
  maker: string
  model: string
  release: string
  /** An emulator's AVD name; '' on a phone. */
  avd: string
  /** The name set on the phone; '' when there's none. */
  name: string
}

export function parseIdentity(stdout: string): Identity {
  const values = new Map<string, string>()
  for (const line of stdout.split(/\r?\n/)) {
    const i = line.indexOf('=')
    if (i > 0) values.set(line.slice(0, i).trim(), line.slice(i + 1).trim())
  }
  // `settings get` prints "null" for a setting that isn't there.
  const get = (key: string) => {
    const value = values.get(key) ?? ''
    return value === 'null' ? '' : value
  }
  return { serialNo: get('serial'), maker: get('maker'), model: get('model'), release: get('release'), avd: get('avd'), name: get('name') }
}

/** An adb entry and what the device said it is: null before it answered, or when it can't
 *  (unauthorized, offline). */
export interface Seen {
  entry: AdbEntry
  identity: Identity | null
}

type State = DeviceInfo['state']
/** Best first. */
const STATES: readonly State[] = ['ready', 'connecting', 'unauthorized', 'offline']

function stateOf(adbState: string): State {
  if (adbState === 'device') return 'ready'
  if (adbState === 'unauthorized') return 'unauthorized'
  if (adbState === 'authorizing' || adbState === 'connecting') return 'connecting'
  return 'offline'
}

const isEmulator = (s: Seen) => s.entry.serial.startsWith('emulator-') || (s.identity?.avd ?? '') !== ''

/** A phone's serial number (its adb name over USB; inside its mDNS name over Wi-Fi, until it
 *  answers); an emulator's AVD name. */
export function deviceId(s: Seen): string {
  if (isEmulator(s)) return `emulator:${s.identity?.avd || s.entry.serial}`
  if (s.identity?.serialNo) return `android:${s.identity.serialNo}`
  const mdns = /^adb-(.+)-[^-.]+\._adb-tls-connect\._tcp\.?$/.exec(s.entry.serial)
  return `android:${mdns ? mdns[1] : s.entry.serial}`
}

/** A ready connection first, then by state; USB before Wi-Fi. */
const rank = (s: Seen) => STATES.indexOf(stateOf(s.entry.state)) * 2 + (s.entry.usb ? 0 : 1)

/** One device per phone or emulator (a phone over USB and Wi-Fi is one), phones first, by name;
 *  and the adb name to reach each by. */
export function mergeDevices(seen: readonly Seen[]): { devices: DeviceInfo[]; serials: Map<string, string> } {
  const groups = new Map<string, Seen[]>()
  for (const s of seen) {
    const id = deviceId(s)
    groups.set(id, [...(groups.get(id) ?? []), s])
  }
  const devices: DeviceInfo[] = []
  const serials = new Map<string, string>()
  for (const [id, group] of groups) {
    const best = [...group].sort((a, b) => rank(a) - rank(b))[0]
    const state = stateOf(best.entry.state)
    const identity = group.find((s) => s.identity)?.identity ?? null
    const emulator = id.startsWith('emulator:')
    serials.set(id, best.entry.serial)
    devices.push({
      id,
      kind: emulator ? 'emulator' : 'android',
      name: nameOf(best.entry, identity, emulator),
      // Only the connections in the best state: a cable that's offline isn't "USB + Wi-Fi".
      detail: detailOf(group.filter((s) => stateOf(s.entry.state) === state), identity, emulator),
      state,
    })
  }
  devices.sort((a, b) => (a.kind === b.kind ? a.name.localeCompare(b.name) : a.kind === 'android' ? -1 : 1))
  return { devices, serials }
}

const capitalised = (s: string) => s.charAt(0).toUpperCase() + s.slice(1)

function nameOf(entry: AdbEntry, identity: Identity | null, emulator: boolean): string {
  if (emulator) return (identity?.avd || entry.serial).replace(/_/g, ' ')
  if (identity?.name) return identity.name
  if (identity?.model) {
    const maker = identity.maker
    return maker && !identity.model.toLowerCase().startsWith(maker.toLowerCase()) ? `${capitalised(maker)} ${identity.model}` : identity.model
  }
  return entry.model.replace(/_/g, ' ') || entry.serial
}

function detailOf(connections: readonly Seen[], identity: Identity | null, emulator: boolean): string {
  const version = identity?.release ? `Android ${identity.release}` : ''
  if (emulator) return ['Emulator', version].filter(Boolean).join(' · ')
  const usb = connections.some((s) => s.entry.usb)
  const wifi = connections.some((s) => !s.entry.usb)
  return [version, usb && wifi ? 'USB + Wi-Fi' : usb ? 'USB' : 'Wi-Fi'].filter(Boolean).join(' · ')
}
```

- [ ] **Step 4: Run the test to make sure it passes**

Run: `npx vitest run src/main/devices/android/devices.test.ts`
Expected: PASS (11 tests).

- [ ] **Step 5: Commit**

```bash
git add src/main/devices/android/devices.ts src/main/devices/android/devices.test.ts
git -c user.email=franco@effektstudios.com commit -m "Devices: read adb's device lists, one device per phone" -m "Claude-Session: https://claude.ai/code/session_012TidnAXmFkf7jwBCQQo4jJ"
```

---

### Task 4: Finding and running adb

**Files:**
- Create: `src/main/devices/android/adb.ts`
- Test: `src/main/devices/android/adb.test.ts`

- [ ] **Step 1: Write the failing test**

Create `src/main/devices/android/adb.test.ts`:

```ts
import { chmodSync, mkdirSync, mkdtempSync, rmSync, writeFileSync } from 'node:fs'
import { tmpdir } from 'node:os'
import { join } from 'node:path'
import { afterAll, describe, expect, it } from 'vitest'
import { AdbError, adbCandidates, findAdb, runAdb } from './adb'

const root = mkdtempSync(join(tmpdir(), 'deck-adb-'))
afterAll(() => rmSync(root, { recursive: true, force: true }))

describe('adbCandidates', () => {
  it('macOS: ANDROID_HOME, the SDK under ~/Library, then PATH and Homebrew', () => {
    expect(adbCandidates({ ANDROID_HOME: '/sdk', PATH: '/usr/bin:/bin' }, 'darwin', '/Users/f')).toEqual([
      '/sdk/platform-tools/adb',
      '/Users/f/Library/Android/sdk/platform-tools/adb',
      '/usr/bin/adb',
      '/bin/adb',
      '/opt/homebrew/bin/adb',
      '/usr/local/bin/adb',
    ])
  })

  it('Windows: the SDK under LOCALAPPDATA, adb.exe, PATH split on ;', () => {
    expect(adbCandidates({ LOCALAPPDATA: 'C:\\Users\\f\\AppData\\Local', PATH: 'C:\\Windows;C:\\tools' }, 'win32', 'C:\\Users\\f')).toEqual([
      'C:\\Users\\f\\AppData\\Local\\Android\\Sdk\\platform-tools\\adb.exe',
      'C:\\Windows\\adb.exe',
      'C:\\tools\\adb.exe',
    ])
  })

  it('lists each file once', () => {
    const files = adbCandidates({ ANDROID_HOME: '/Users/f/Library/Android/sdk', PATH: '' }, 'darwin', '/Users/f')
    expect(files.filter((f) => f === '/Users/f/Library/Android/sdk/platform-tools/adb')).toHaveLength(1)
  })
})

describe('findAdb', () => {
  it('takes the first one that is there', async () => {
    const dir = join(root, 'platform-tools')
    mkdirSync(dir)
    const adb = join(dir, process.platform === 'win32' ? 'adb.exe' : 'adb')
    writeFileSync(adb, '')
    chmodSync(adb, 0o755)
    expect(await findAdb([join(root, 'missing', 'adb'), adb])).toBe(adb)
    expect(await findAdb([join(root, 'missing', 'adb')])).toBeNull()
  })
})

describe('runAdb', () => {
  // Node stands in for adb: what matters is the output and the error.
  it('resolves with stdout', async () => {
    expect(await runAdb(process.execPath, ['-e', 'process.stdout.write("27183\\n")'])).toBe('27183\n')
  })

  it("rejects with adb's last word", async () => {
    const failing = runAdb(process.execPath, ['-e', 'console.error("* daemon started successfully"); console.error("adb: device offline"); process.exit(1)'])
    await expect(failing).rejects.toThrow(new AdbError('adb: device offline'))
  })
})
```

- [ ] **Step 2: Run it to make sure it fails**

Run: `npx vitest run src/main/devices/android/adb.test.ts`
Expected: FAIL: `Failed to resolve import "./adb"`.

- [ ] **Step 3: Write the implementation**

Create `src/main/devices/android/adb.ts`:

```ts
import { execFile } from 'node:child_process'
import { constants } from 'node:fs'
import { access } from 'node:fs/promises'
import { posix, win32 } from 'node:path'

export class AdbError extends Error {
  constructor(message: string) {
    super(message)
    this.name = 'AdbError'
  }
}

/** Where adb may be, in the order Deck tries them: ANDROID_HOME and ANDROID_SDK_ROOT (Deck's own
 *  environment: one set only in shell profiles isn't seen when Deck starts from Finder), the SDK's
 *  usual place, then PATH and Homebrew's folders. The SDK's adb comes before the others because
 *  Android Studio runs it, and two adb versions restart each other's server. */
export function adbCandidates(env: NodeJS.ProcessEnv, platform: NodeJS.Platform, home: string): string[] {
  const path = platform === 'win32' ? win32 : posix
  const exe = platform === 'win32' ? 'adb.exe' : 'adb'
  const sdks = [env.ANDROID_HOME, env.ANDROID_SDK_ROOT]
  if (platform === 'darwin') sdks.push(path.join(home, 'Library', 'Android', 'sdk'))
  else if (platform === 'win32') sdks.push(path.join(env.LOCALAPPDATA || path.join(home, 'AppData', 'Local'), 'Android', 'Sdk'))
  else sdks.push(path.join(home, 'Android', 'Sdk'))
  const dirs = (env.PATH ?? '').split(path.delimiter)
  if (platform === 'darwin') dirs.push('/opt/homebrew/bin', '/usr/local/bin')
  const files = [
    ...sdks.filter((dir): dir is string => Boolean(dir)).map((dir) => path.join(dir, 'platform-tools', exe)),
    ...dirs.filter(Boolean).map((dir) => path.join(dir, exe)),
  ]
  return [...new Set(files)]
}

/** The first candidate that is there and can be run; null when none is. */
export async function findAdb(candidates: readonly string[]): Promise<string | null> {
  for (const file of candidates) {
    if (await access(file, constants.X_OK).then(() => true, () => false)) return file
  }
  return null
}

/** stdout of `adb <args>`. Throws AdbError with adb's own last word ("device offline",
 *  "device '8d2e61a' not found"). */
export function runAdb(adb: string, args: readonly string[], timeoutMs = 15_000): Promise<string> {
  return new Promise((resolve, reject) => {
    const child = execFile(adb, args, { encoding: 'utf8', timeout: timeoutMs, maxBuffer: 16 * 1024 * 1024, windowsHide: true },
      (err, stdout, stderr) => {
        if (!err) return resolve(stdout)
        if (err.killed) return reject(new AdbError(`adb didn't answer within ${Math.round(timeoutMs / 1000)} s.`))
        const said = `${stderr}\n${stdout}`.split('\n').map((line) => line.trim()).filter(Boolean)
        reject(new AdbError(said.at(-1) ?? err.message))
      })
    // Nothing Deck runs reads stdin: EOF instead of a wait; an adb that exits first makes it an EPIPE.
    child.stdin?.on('error', () => {})
    child.stdin?.end()
  })
}
```

- [ ] **Step 4: Run the test to make sure it passes**

Run: `npx vitest run src/main/devices/android/adb.test.ts`
Expected: PASS (6 tests).

- [ ] **Step 5: Commit**

```bash
git add src/main/devices/android/adb.ts src/main/devices/android/adb.test.ts
git -c user.email=franco@effektstudios.com commit -m "Devices: find adb, the SDK's first, and run it" -m "Claude-Session: https://claude.ai/code/session_012TidnAXmFkf7jwBCQQo4jJ"
```

---

### Task 5: Following the devices

**Files:**
- Create: `src/main/devices/android/tracker.ts`
- Test: `src/main/devices/android/tracker.test.ts`

- [ ] **Step 1: Write the failing test**

Create `src/main/devices/android/tracker.test.ts`:

```ts
import type { ChildProcess } from 'node:child_process'
import { EventEmitter } from 'node:events'
import { PassThrough } from 'node:stream'
import { afterEach, describe, expect, it, vi } from 'vitest'
import type { DeviceInfo } from '@shared/types'
import type { Identity } from './devices'
import { AndroidTracker } from './tracker'

type FakeChild = ChildProcess & { stdout: PassThrough; stderr: PassThrough; kill: ReturnType<typeof vi.fn> }

/** `adb track-devices`: emitting on its streams directly keeps the tests in step. */
function fakeChild(): FakeChild {
  const child = Object.assign(new EventEmitter(), { stdout: new PassThrough(), stderr: new PassThrough() })
  return Object.assign(child, { kill: vi.fn(() => child.emit('close', null)) }) as unknown as FakeChild
}

const frame = (text: string) => Buffer.from(Buffer.byteLength(text).toString(16).padStart(4, '0') + text)
const C66 = '8d2e61a device usb:34603008X product:C66 model:C66 device:C66 transport_id:1\n'
const c66: Identity = { serialNo: '8d2e61a', maker: 'CHAINWAY', model: 'C66', release: '13', avd: '', name: 'C66', booted: true }

function setup(identify: (serial: string) => Promise<Identity>) {
  const children: FakeChild[] = []
  const published: { devices: DeviceInfo[]; error: string | null }[] = []
  const tracker = new AndroidTracker({
    track: () => {
      const child = fakeChild()
      children.push(child)
      return child
    },
    identify,
    publish: (devices, error) => published.push({ devices, error }),
    retryMs: { identity: 10, booting: 10, restartMin: 20, restartMax: 80 },
  })
  return { tracker, children, published }
}

afterEach(() => {
  vi.useRealTimers()
})

describe('AndroidTracker', () => {
  it('lists a device once it has said what it is, and finds its adb name', async () => {
    const { tracker, children, published } = setup(async () => c66)
    tracker.start()
    children[0].stdout.emit('data', frame(C66))
    await vi.waitFor(() => expect(published.at(-1)?.devices.map((d) => d.name)).toEqual(['C66']))
    // Never listed under a stand-in name first.
    expect(published.every((p) => p.devices.every((d) => d.name === 'C66'))).toBe(true)
    expect(tracker.serialFor('android:8d2e61a')).toBe('8d2e61a')
    tracker.stop()
  })

  it("asks three times, then lists the device as adb names it", async () => {
    const identify = vi.fn(async (): Promise<Identity> => {
      throw new Error('closed')
    })
    const { tracker, children, published } = setup(identify)
    tracker.start()
    children[0].stdout.emit('data', frame(C66))
    await vi.waitFor(() => expect(published.at(-1)?.devices.map((d) => d.id)).toEqual(['android:8d2e61a']))
    expect(identify).toHaveBeenCalledTimes(3)
    tracker.stop()
  })

  it('asks a phone that is still starting up again until it has booted', async () => {
    const answers: Identity[] = [{ ...c66, name: '', booted: false }, c66]
    const { tracker, children, published } = setup(async () => answers.shift() ?? c66)
    tracker.start()
    children[0].stdout.emit('data', frame(C66))
    await vi.waitFor(() => expect(published.at(-1)?.devices.map((d) => d.name)).toEqual(['C66']))
    // Named by maker and model until Android had started.
    expect(published.map((p) => p.devices[0]?.name)).toContain('CHAINWAY C66')
    tracker.stop()
  })

  it("starts again after adb's server goes away, waiting longer each time, and says why", () => {
    vi.useFakeTimers()
    const { tracker, children, published } = setup(async () => c66)
    tracker.start()
    children[0].stderr.emit('data', Buffer.from('error: cannot connect to daemon\n'))
    children[0].emit('close', 1)
    expect(published.at(-1)).toEqual({ devices: [], error: 'error: cannot connect to daemon' })
    vi.advanceTimersByTime(19)
    expect(children).toHaveLength(1)
    vi.advanceTimersByTime(1)
    expect(children).toHaveLength(2)
    children[1].emit('close', 1)
    vi.advanceTimersByTime(39)
    expect(children).toHaveLength(2)
    vi.advanceTimersByTime(1)
    expect(children).toHaveLength(3)
    tracker.stop()
  })

  it('stop() ends track-devices for good', () => {
    vi.useFakeTimers()
    const { tracker, children } = setup(async () => c66)
    tracker.start()
    tracker.stop()
    expect(children[0].kill).toHaveBeenCalled()
    vi.advanceTimersByTime(1000)
    expect(children).toHaveLength(1)
  })
})
```

- [ ] **Step 2: Run it to make sure it fails**

Run: `npx vitest run src/main/devices/android/tracker.test.ts`
Expected: FAIL: `Failed to resolve import "./tracker"`.

- [ ] **Step 3: Write the implementation**

Create `src/main/devices/android/tracker.ts`:

```ts
import type { ChildProcess } from 'node:child_process'
import type { DeviceInfo } from '@shared/types'
import { type AdbEntry, type Identity, mergeDevices, readTrackFrames, type Seen } from './devices'

export interface TrackerDeps {
  /** Starts `adb track-devices -l`. */
  track(): ChildProcess
  /** Asks a device what it is (IDENTITY_SCRIPT through `adb -s <serial> shell`). */
  identify(serial: string): Promise<Identity>
  /** The devices changed; `error` while adb's track-devices is down. */
  publish(devices: DeviceInfo[], error: string | null): void
  /** ms; tests shorten them. */
  retryMs?: { identity: number; booting: number; restartMin: number; restartMax: number }
}

/** A connection that doesn't answer is asked this many times, then listed as adb names it. */
const IDENTITY_TRIES = 3
/** A phone still starting up is asked again, this many times at most (about two minutes). */
const BOOT_TRIES = 40

interface Asked {
  identity: Identity | null
  /** Failed asks in a row. */
  tries: number
  asking: boolean
  /** Answers given while the device was still starting up. */
  boots: number
}

/** Follows the Android devices adb sees with one long-running `adb track-devices -l`, and asks each
 *  connected device once what it is (again while it's still starting up). Runs while a tab needs Android devices. adb's server going
 *  away ends track-devices; it's started again after 1 s, then up to 30 s apart while it keeps
 *  failing. */
export class AndroidTracker {
  private running = false
  private child: ChildProcess | null = null
  private entries: AdbEntry[] = []
  /** By adb name and connection (transport id). */
  private readonly asked = new Map<string, Asked>()
  private serials = new Map<string, string>()
  private readonly timers = new Set<ReturnType<typeof setTimeout>>()
  private readonly retry: NonNullable<TrackerDeps['retryMs']>
  private restartMs: number
  private lastPublished = ''

  constructor(private readonly deps: TrackerDeps) {
    this.retry = deps.retryMs ?? { identity: 1500, booting: 3000, restartMin: 1000, restartMax: 30_000 }
    this.restartMs = this.retry.restartMin
  }

  start(): void {
    if (this.running) return
    this.running = true
    this.spawn()
  }

  stop(): void {
    this.running = false
    for (const timer of this.timers) clearTimeout(timer)
    this.timers.clear()
    const child = this.child
    this.child = null
    child?.kill()
    this.entries = []
    this.asked.clear()
    this.serials.clear()
    this.lastPublished = ''
  }

  /** The adb name to reach device `id` by (a ready connection first, USB before Wi-Fi); undefined
   *  when adb doesn't list it. */
  serialFor(id: string): string | undefined {
    return this.serials.get(id)
  }

  private later(ms: number, run: () => void): void {
    const timer = setTimeout(() => {
      this.timers.delete(timer)
      run()
    }, ms)
    this.timers.add(timer)
  }

  private spawn(): void {
    let child: ChildProcess
    try {
      child = this.deps.track()
    } catch (err) {
      return this.ended(err instanceof Error ? err.message : String(err))
    }
    this.child = child
    let pending: Buffer = Buffer.alloc(0)
    let said = ''
    let done = false
    const end = (why: string) => {
      if (done || this.child !== child) return
      done = true
      this.child = null
      this.ended(why)
    }
    child.stdout?.on('data', (chunk: Buffer) => {
      if (this.child !== child) return
      try {
        const { lists, rest } = readTrackFrames(pending.length ? Buffer.concat([pending, chunk]) : chunk)
        pending = rest
        const latest = lists.at(-1)
        if (!latest) return
        this.restartMs = this.retry.restartMin
        this.entries = latest
        this.update()
      } catch (err) {
        said = err instanceof Error ? err.message : String(err)
        child.kill()
      }
    })
    child.stderr?.on('data', (chunk: Buffer) => {
      said = `${said}${chunk.toString()}`.slice(-2000)
    })
    child.on('error', (err) => end(err.message))
    child.on('close', (code) => end(lastLine(said) || `adb track-devices stopped (exit code ${code}).`))
  }

  private ended(why: string): void {
    if (!this.running) return
    this.entries = []
    this.asked.clear()
    this.publish(why)
    const wait = this.restartMs
    this.restartMs = Math.min(this.restartMs * 2, this.retry.restartMax)
    this.later(wait, () => {
      if (this.running && !this.child) this.spawn()
    })
  }

  private update(): void {
    const keys = new Set(this.entries.map(keyOf))
    for (const key of this.asked.keys()) if (!keys.has(key)) this.asked.delete(key)
    for (const entry of this.entries) if (entry.state === 'device') this.ask(entry)
    this.publish(null)
  }

  /** `again`: ask once more a device that failed to answer, or answered while still starting up. */
  private ask(entry: AdbEntry, again = false): void {
    const key = keyOf(entry)
    const asked = this.asked.get(key) ?? { identity: null, tries: 0, asking: false, boots: 0 }
    this.asked.set(key, asked)
    if ((asked.identity && !again) || asked.asking || asked.tries >= IDENTITY_TRIES) return
    asked.asking = true
    this.deps.identify(entry.serial).then(
      (identity) => {
        if (this.asked.get(key) !== asked) return
        asked.asking = false
        asked.tries = 0
        asked.identity = identity
        this.publish(null)
        // Still starting up: Android's settings, and with them the phone's own name, aren't there yet.
        if (!identity.booted && ++asked.boots < BOOT_TRIES) this.askLater(key, this.retry.booting)
      },
      () => {
        if (this.asked.get(key) !== asked) return
        asked.asking = false
        if (++asked.tries >= IDENTITY_TRIES) return this.publish(null)
        this.askLater(key, this.retry.identity)
      },
    )
  }

  private askLater(key: string, ms: number): void {
    this.later(ms, () => {
      const now = this.entries.find((e) => keyOf(e) === key)
      if (now?.state === 'device') this.ask(now, true)
    })
  }

  private publish(error: string | null): void {
    // A ready device is listed once it has said what it is (or Deck stopped asking), so its id (an
    // emulator's AVD name) never changes under the panel.
    const seen: Seen[] = []
    for (const entry of this.entries) {
      const asked = this.asked.get(keyOf(entry))
      if (entry.state === 'device' && !asked?.identity && (asked?.asking || (asked?.tries ?? 0) < IDENTITY_TRIES)) continue
      seen.push({ entry, identity: asked?.identity ?? null })
    }
    const { devices, serials } = mergeDevices(seen)
    this.serials = serials
    const text = JSON.stringify([devices, error])
    if (text === this.lastPublished) return
    this.lastPublished = text
    this.deps.publish(devices, error)
  }
}

const keyOf = (e: AdbEntry) => `${e.serial}#${e.transport}`
const lastLine = (text: string) => text.split('\n').map((line) => line.trim()).filter(Boolean).at(-1) ?? ''
```

- [ ] **Step 4: Run the test to make sure it passes**

Run: `npx vitest run src/main/devices/android/tracker.test.ts`
Expected: PASS (5 tests).

- [ ] **Step 5: Commit**

```bash
git add src/main/devices/android/tracker.ts src/main/devices/android/tracker.test.ts
git -c user.email=franco@effektstudios.com commit -m "Devices: follow adb's devices with one track-devices" -m "Claude-Session: https://claude.ai/code/session_012TidnAXmFkf7jwBCQQo4jJ"
```

---
### Task 6: scrcpy's wire format

**Files:**
- Create: `src/main/devices/android/protocol.ts`
- Create: `src/main/devices/android/input.ts`
- Test: `src/main/devices/android/protocol.test.ts`
- Test: `src/main/devices/android/input.test.ts`

- [ ] **Step 1: Write the failing tests**

Create `src/main/devices/android/protocol.test.ts`:

```ts
import { describe, expect, it } from 'vitest'
import { CODEC_H264, FINGER, keycodeMessage, resetVideoMessage, scrollMessage, setClipboardMessage, textMessage, textPieces, touchMessage, VideoReader } from './protocol'

// The expected bytes are scrcpy 5.0.1's own: app/tests/test_control_msg_serialize.c.
describe('control messages', () => {
  it('inject keycode', () => {
    expect([...keycodeMessage('up', 66, 5, 0x41)]).toEqual([0x00, 0x01, 0x00, 0x00, 0x00, 0x42, 0x00, 0x00, 0x00, 0x05, 0x00, 0x00, 0x00, 0x41])
  })

  it('inject text', () => {
    expect([...textMessage('hello, world!')]).toEqual([0x01, 0x00, 0x00, 0x00, 0x0d, ...Buffer.from('hello, world!')])
  })

  it('inject touch', () => {
    const message = touchMessage({ action: 'down', pointerId: 0x1234567887654321n, x: 100, y: 200, width: 1080, height: 1920, pressure: 1, actionButton: 1, buttons: 1 })
    expect([...message]).toEqual([
      0x02, 0x00, 0x12, 0x34, 0x56, 0x78, 0x87, 0x65, 0x43, 0x21, 0x00, 0x00, 0x00, 0x64, 0x00, 0x00, 0x00, 0xc8,
      0x04, 0x38, 0x07, 0x80, 0xff, 0xff, 0x00, 0x00, 0x00, 0x01, 0x00, 0x00, 0x00, 0x01,
    ])
  })

  it('a finger unless told otherwise: no buttons, pressed down and moving, let go up', () => {
    const down = touchMessage({ action: 'down', x: 10.4, y: 20.6, width: 720, height: 1440 })
    expect(down.readBigUInt64BE(2)).toBe(FINGER)
    expect([down.readInt32BE(10), down.readInt32BE(14)]).toEqual([10, 21])
    expect(down.readUInt16BE(22)).toBe(0xffff)
    expect([down.readUInt32BE(24), down.readUInt32BE(28)]).toEqual([0, 0])
    expect(touchMessage({ action: 'up', x: 0, y: 0, width: 720, height: 1440 }).readUInt16BE(22)).toBe(0)
  })

  it('inject scroll', () => {
    expect([...scrollMessage({ x: 260, y: 1026, width: 1080, height: 1920, hscroll: 16, vscroll: -16, buttons: 1 })]).toEqual([
      0x03, 0x00, 0x00, 0x01, 0x04, 0x00, 0x00, 0x04, 0x02, 0x04, 0x38, 0x07, 0x80, 0x7f, 0xff, 0x80, 0x00, 0x00, 0x00, 0x00, 0x01,
    ])
  })

  it('set clipboard', () => {
    expect([...setClipboardMessage('hello, world!', true, 0x0102030405060708n)]).toEqual([
      0x09, 0x01, 0x02, 0x03, 0x04, 0x05, 0x06, 0x07, 0x08, 0x01, 0x00, 0x00, 0x00, 0x0d, ...Buffer.from('hello, world!'),
    ])
  })

  it('reset video', () => {
    expect([...resetVideoMessage()]).toEqual([0x11])
  })

  it('cuts text into pieces scrcpy takes, never inside a character', () => {
    expect(textPieces('a'.repeat(301))).toEqual(['a'.repeat(300), 'a'])
    expect(textPieces('é'.repeat(200)).map((piece) => Buffer.byteLength(piece))).toEqual([300, 100])
    expect(textPieces('')).toEqual([])
  })
})

/** A video socket's bytes as scrcpy's server writes them. */
function stream(): Buffer {
  const name = Buffer.alloc(64)
  name.write('C66')
  const codec = Buffer.alloc(4)
  codec.writeUInt32BE(CODEC_H264)
  const session = Buffer.alloc(12)
  session.writeUInt32BE(0x80000000, 0)
  session.writeUInt32BE(720, 4)
  session.writeUInt32BE(1440, 8)
  const packet = (flags: bigint, data: number[]) => {
    const head = Buffer.alloc(12)
    head.writeBigUInt64BE(flags, 0)
    head.writeUInt32BE(data.length, 8)
    return Buffer.concat([head, Buffer.from(data)])
  }
  return Buffer.concat([
    Buffer.from([0]), name, codec, session,
    packet(1n << 62n, [0, 0, 0, 1, 0x67, 0x64, 0x00, 0x28]), // config: the SPS
    packet((1n << 61n) | 16_666n, [0, 0, 0, 1, 0x65, 0xaa]), // a key frame
    packet(33_333n, [0, 0, 0, 1, 0x41, 0xbb]), // a delta frame
  ])
}

describe('VideoReader', () => {
  const expected = [
    { type: 'name', name: 'C66' },
    { type: 'codec', codec: CODEC_H264 },
    { type: 'size', width: 720, height: 1440 },
    { type: 'packet', config: true, key: false, data: new Uint8Array([0, 0, 0, 1, 0x67, 0x64, 0x00, 0x28]) },
    { type: 'packet', config: false, key: true, data: new Uint8Array([0, 0, 0, 1, 0x65, 0xaa]) },
    { type: 'packet', config: false, key: false, data: new Uint8Array([0, 0, 0, 1, 0x41, 0xbb]) },
  ]

  it('reads the stream in one chunk', () => {
    expect(new VideoReader().feed(stream())).toEqual(expected)
  })

  it('reads it one byte at a time', () => {
    const reader = new VideoReader()
    const all = stream()
    const events: unknown[] = []
    for (let i = 0; i < all.length; i++) events.push(...reader.feed(all.subarray(i, i + 1)))
    expect(events).toEqual(expected)
  })
})
```

Create `src/main/devices/android/input.test.ts`:

```ts
import { describe, expect, it } from 'vitest'
import { controlMessages } from './input'
import { keycodeMessage, scrollMessage, setClipboardMessage, textMessage, touchMessage } from './protocol'

describe('controlMessages', () => {
  it('a touch, in the frame it was made for', () => {
    expect(controlMessages({ type: 'touch', action: 'move', x: 10, y: 20, width: 720, height: 1440 }))
      .toEqual([touchMessage({ action: 'move', x: 10, y: 20, width: 720, height: 1440 })])
  })

  it('a scroll', () => {
    expect(controlMessages({ type: 'scroll', x: 10, y: 20, width: 720, height: 1440, dx: 0, dy: -1.5 }))
      .toEqual([scrollMessage({ x: 10, y: 20, width: 720, height: 1440, hscroll: 0, vscroll: -1.5 })])
  })

  it('a key is pressed, then let go', () => {
    expect(controlMessages({ type: 'key', keycode: 4, meta: 0 })).toEqual([keycodeMessage('down', 4), keycodeMessage('up', 4)])
  })

  it('text in pieces; a paste through the clipboard', () => {
    expect(controlMessages({ type: 'text', text: 'hi' })).toEqual([textMessage('hi')])
    expect(controlMessages({ type: 'text', text: 'a'.repeat(301) })).toHaveLength(2)
    expect(controlMessages({ type: 'paste', text: 'line 1\nline 2' })).toEqual([setClipboardMessage('line 1\nline 2', true)])
  })

  it("nothing for input that isn't valid", () => {
    const junk = [
      null, 'touch', { type: 'shell', command: 'reboot' },
      { type: 'touch', action: 'down', x: 10, y: 20, width: 0, height: 1440 },
      { type: 'touch', action: 'tap', x: 1, y: 1, width: 2, height: 2 },
      { type: 'touch', action: 'down', x: 5, y: Number.NaN, width: 10, height: 10 },
      { type: 'scroll', x: 1, y: 1, width: 2, height: 2, dx: 0, dy: 99 },
      { type: 'key', keycode: 4.5, meta: 0 },
      { type: 'text', text: '' },
      { type: 'paste', text: 42 },
    ]
    for (const input of junk) expect(controlMessages(input), JSON.stringify(input)).toEqual([])
  })
})
```

- [ ] **Step 2: Run them to make sure they fail**

Run: `npx vitest run src/main/devices/android/protocol.test.ts src/main/devices/android/input.test.ts`
Expected: FAIL: `Failed to resolve import "./protocol"` and `"./input"`.

- [ ] **Step 3: Write the protocol**

Create `src/main/devices/android/protocol.ts`:

```ts
// scrcpy 5.0.1's wire format, as its server reads and writes it. The protocol is internal to
// scrcpy and changes between versions: it must match resources/scrcpy-server.json's version.

/** The video codec id for H.264 ("h264"). 0 and 1 mean the device couldn't start its video. */
export const CODEC_H264 = 0x68323634
/** The device's name, NUL-padded, on the first socket. */
const NAME_LENGTH = 64
const FLAG_SESSION = 0x80
const FLAG_CONFIG = 1n << 62n
const FLAG_KEY = 1n << 61n

export type VideoEvent =
  | { type: 'name'; name: string }
  | { type: 'codec'; codec: number }
  | { type: 'size'; width: number; height: number }
  | { type: 'packet'; config: boolean; key: boolean; data: Uint8Array }

/** Reads scrcpy's video socket as it arrives, in chunks cut anywhere: the forward tunnel's dummy
 *  byte, the device's name (64 bytes), the codec id (4), then 12-byte headers: a capture session's
 *  (first bit set; width and height follow) or a packet's (flags and PTS, its size, then it). */
export class VideoReader {
  private buf: Buffer = Buffer.alloc(0)
  private stage: 'dummy' | 'name' | 'codec' | 'packets' = 'dummy'

  feed(chunk: Buffer): VideoEvent[] {
    this.buf = this.buf.length ? Buffer.concat([this.buf, chunk]) : chunk
    const events: VideoEvent[] = []
    for (;;) {
      if (this.stage === 'dummy') {
        if (this.buf.length < 1) break
        this.take(1)
        this.stage = 'name'
      } else if (this.stage === 'name') {
        if (this.buf.length < NAME_LENGTH) break
        const raw = this.take(NAME_LENGTH)
        const end = raw.indexOf(0)
        events.push({ type: 'name', name: raw.toString('utf8', 0, end < 0 ? NAME_LENGTH : end) })
        this.stage = 'codec'
      } else if (this.stage === 'codec') {
        if (this.buf.length < 4) break
        events.push({ type: 'codec', codec: this.take(4).readUInt32BE(0) })
        this.stage = 'packets'
      } else {
        if (this.buf.length < 12) break
        if (this.buf[0] & FLAG_SESSION) {
          const head = this.take(12)
          events.push({ type: 'size', width: head.readUInt32BE(4), height: head.readUInt32BE(8) })
          continue
        }
        const size = this.buf.readUInt32BE(8)
        if (this.buf.length < 12 + size) break
        const flags = this.buf.readBigUInt64BE(0)
        const packet = this.take(12 + size)
        // Copied, so the buffer it came in can go.
        events.push({ type: 'packet', config: (flags & FLAG_CONFIG) !== 0n, key: (flags & FLAG_KEY) !== 0n, data: new Uint8Array(packet.subarray(12)) })
      }
    }
    return events
  }

  private take(n: number): Buffer {
    const out = this.buf.subarray(0, n)
    this.buf = this.buf.subarray(n)
    return out
  }
}

const TYPE = { keycode: 0, text: 1, touch: 2, scroll: 3, setClipboard: 9, resetVideo: 17 } as const
/** Android's MotionEvent and KeyEvent actions. */
const ACTION = { down: 0, up: 1, move: 2 } as const
/** scrcpy's POINTER_ID_GENERIC_FINGER (-2): injected as a finger, not a mouse. */
export const FINGER = 0xfffffffffffffffen
/** scrcpy reads at most 300 bytes of text per message. */
export const TEXT_MAX_BYTES = 300

export function keycodeMessage(action: 'down' | 'up', keycode: number, repeat = 0, meta = 0): Buffer {
  const b = Buffer.alloc(14)
  b.writeUInt8(TYPE.keycode, 0)
  b.writeUInt8(ACTION[action], 1)
  b.writeInt32BE(keycode, 2)
  b.writeInt32BE(repeat, 6)
  b.writeInt32BE(meta, 10)
  return b
}

/** At most TEXT_MAX_BYTES of UTF-8: see textPieces. */
export function textMessage(text: string): Buffer {
  const bytes = Buffer.from(text, 'utf8')
  const b = Buffer.alloc(5 + bytes.length)
  b.writeUInt8(TYPE.text, 0)
  b.writeUInt32BE(bytes.length, 1)
  bytes.copy(b, 5)
  return b
}

export interface Touch {
  action: 'down' | 'move' | 'up'
  /** In the frame's pixels; width and height are the frame's (the server ignores another size). */
  x: number
  y: number
  width: number
  height: number
  pointerId?: bigint
  /** 0 … 1; a finger presses with 1 and lets go with 0. */
  pressure?: number
  actionButton?: number
  buttons?: number
}

export function touchMessage(t: Touch): Buffer {
  const b = Buffer.alloc(32)
  b.writeUInt8(TYPE.touch, 0)
  b.writeUInt8(ACTION[t.action], 1)
  b.writeBigUInt64BE(t.pointerId ?? FINGER, 2)
  b.writeInt32BE(Math.round(t.x), 10)
  b.writeInt32BE(Math.round(t.y), 14)
  b.writeUInt16BE(t.width, 18)
  b.writeUInt16BE(t.height, 20)
  b.writeUInt16BE(u16fp(t.pressure ?? (t.action === 'up' ? 0 : 1)), 22)
  b.writeUInt32BE(t.actionButton ?? 0, 24)
  b.writeUInt32BE(t.buttons ?? 0, 28)
  return b
}

export interface Scroll {
  x: number
  y: number
  width: number
  height: number
  /** -16 … 16 steps; positive scrolls right and up. */
  hscroll: number
  vscroll: number
  buttons?: number
}

export function scrollMessage(s: Scroll): Buffer {
  const b = Buffer.alloc(21)
  b.writeUInt8(TYPE.scroll, 0)
  b.writeInt32BE(Math.round(s.x), 1)
  b.writeInt32BE(Math.round(s.y), 5)
  b.writeUInt16BE(s.width, 9)
  b.writeUInt16BE(s.height, 11)
  b.writeInt16BE(i16fp(s.hscroll / 16), 13)
  b.writeInt16BE(i16fp(s.vscroll / 16), 15)
  b.writeUInt32BE(s.buttons ?? 0, 17)
  return b
}

/** Sequence 0 asks for no acknowledgement. */
export function setClipboardMessage(text: string, paste: boolean, sequence = 0n): Buffer {
  const bytes = Buffer.from(text, 'utf8')
  const b = Buffer.alloc(14 + bytes.length)
  b.writeUInt8(TYPE.setClipboard, 0)
  b.writeBigUInt64BE(sequence, 1)
  b.writeUInt8(paste ? 1 : 0, 9)
  b.writeUInt32BE(bytes.length, 10)
  bytes.copy(b, 14)
  return b
}

/** The server restarts its capture: a new session (size), config and key frame follow. */
export const resetVideoMessage = (): Buffer => Buffer.from([TYPE.resetVideo])

/** scrcpy's u16 fixed point: 0 … 1 → 0 … 0xffff. */
const u16fp = (f: number) => Math.min(0xffff, Math.max(0, Math.trunc(f * 0x10000)))
/** scrcpy's i16 fixed point: -1 … 1 → -0x8000 … 0x7fff. */
const i16fp = (f: number) => Math.min(0x7fff, Math.max(-0x8000, Math.trunc(f * 0x8000)))

/** `text` in pieces of at most `max` bytes of UTF-8, never cutting a character in two. */
export function textPieces(text: string, max = TEXT_MAX_BYTES): string[] {
  const pieces: string[] = []
  let piece = ''
  let bytes = 0
  for (const ch of text) {
    const n = Buffer.byteLength(ch, 'utf8')
    if (bytes + n > max && piece) {
      pieces.push(piece)
      piece = ''
      bytes = 0
    }
    piece += ch
    bytes += n
  }
  if (piece) pieces.push(piece)
  return pieces
}
```

- [ ] **Step 4: Write the input checks**

Create `src/main/devices/android/input.ts`:

```ts
import { keycodeMessage, scrollMessage, setClipboardMessage, textMessage, textPieces, touchMessage } from './protocol'

/** scrcpy reads up to 256 KiB per message; a clipboard message takes 14 bytes of its own. */
const MAX_PASTE_BYTES = (1 << 18) - 14
const ACTIONS = new Set(['down', 'move', 'up'])

const num = (v: unknown, min: number, max: number): v is number => typeof v === 'number' && Number.isFinite(v) && v >= min && v <= max
const int = (v: unknown, min: number, max: number): v is number => num(v, min, max) && Number.isInteger(v)

/** The control messages for input from the renderer (a DeviceInput), checked first as every IPC
 *  listener checks its arguments: none for anything that isn't valid input. */
export function controlMessages(input: unknown): Buffer[] {
  if (typeof input !== 'object' || input === null) return []
  const { type, action, x, y, width, height, dx, dy, keycode, meta, text } = input as Record<string, unknown>
  switch (type) {
    case 'touch':
      if (typeof action !== 'string' || !ACTIONS.has(action)) return []
      if (!int(width, 1, 0xffff) || !int(height, 1, 0xffff) || !num(x, 0, width) || !num(y, 0, height)) return []
      return [touchMessage({ action: action as 'down' | 'move' | 'up', x, y, width, height })]
    case 'scroll':
      if (!int(width, 1, 0xffff) || !int(height, 1, 0xffff) || !num(x, 0, width) || !num(y, 0, height)) return []
      if (!num(dx, -16, 16) || !num(dy, -16, 16)) return []
      return [scrollMessage({ x, y, width, height, hscroll: dx, vscroll: dy })]
    case 'key':
      if (!int(keycode, 0, 1000) || !int(meta, 0, 0x7fffffff)) return []
      return [keycodeMessage('down', keycode, 0, meta), keycodeMessage('up', keycode, 0, meta)]
    case 'text':
      if (typeof text !== 'string' || text.length === 0 || text.length > 10_000) return []
      return textPieces(text).map(textMessage)
    case 'paste':
      if (typeof text !== 'string' || text.length === 0 || Buffer.byteLength(text, 'utf8') > MAX_PASTE_BYTES) return []
      return [setClipboardMessage(text, true)]
    default:
      return []
  }
}
```

- [ ] **Step 5: Run the tests to make sure they pass**

Run: `npx vitest run src/main/devices/android/protocol.test.ts src/main/devices/android/input.test.ts`
Expected: PASS (15 tests).

- [ ] **Step 6: Commit**

```bash
git add src/main/devices/android/protocol.ts src/main/devices/android/protocol.test.ts src/main/devices/android/input.ts src/main/devices/android/input.test.ts
git -c user.email=franco@effektstudios.com commit -m "Devices: scrcpy's video stream and control messages" -m "Claude-Session: https://claude.ai/code/session_012TidnAXmFkf7jwBCQQo4jJ"
```

---

### Task 7: A scrcpy session

**Files:**
- Create: `src/main/devices/android/server.ts`
- Create: `src/main/devices/android/scrcpy.ts`
- Test: `src/main/devices/android/scrcpy.test.ts`

- [ ] **Step 1: Write the failing test**

Create `src/main/devices/android/scrcpy.test.ts`:

```ts
import type { ChildProcess } from 'node:child_process'
import { EventEmitter } from 'node:events'
import { mkdirSync, mkdtempSync, rmSync, writeFileSync } from 'node:fs'
import { connect, createServer, type Server, type Socket } from 'node:net'
import { tmpdir } from 'node:os'
import { join } from 'node:path'
import { PassThrough } from 'node:stream'
import { afterAll, afterEach, describe, expect, it, vi } from 'vitest'
import { CODEC_H264, resetVideoMessage } from './protocol'
import { REMOTE_PATH, type ScrcpyIo, serverArgs, serverError, startScrcpy } from './scrcpy'
import { scrcpyServer } from './server'

const server = { path: '/res/scrcpy-server', version: '5.0.1' }
let device: Server | null = null
afterEach(() => {
  device?.close()
  device = null
})

/** The device's end of the tunnel. adb accepts a connection before the server listens and then
 *  drops it, so the first is closed; the next is the video socket, the one after the control socket. */
async function fakeDevice(bytes: Buffer) {
  let n = 0
  let gotVideo: (s: Socket) => void = () => {}
  let gotControl: (s: Socket) => void = () => {}
  const video = new Promise<Socket>((resolve) => (gotVideo = resolve))
  const control = new Promise<Socket>((resolve) => (gotControl = resolve))
  device = createServer((socket) => {
    socket.on('error', () => {})
    if (++n === 1) return socket.destroy()
    if (n === 2) {
      gotVideo(socket)
      return void socket.write(bytes)
    }
    gotControl(socket)
  })
  await new Promise<void>((resolve) => device!.listen(0, '127.0.0.1', resolve))
  return { port: (device.address() as { port: number }).port, video, control }
}

function fakeShell() {
  const child = Object.assign(new EventEmitter(), { stdout: new PassThrough(), stderr: new PassThrough(), kill: vi.fn(() => true) })
  return child as unknown as ChildProcess & { stdout: PassThrough; kill: ReturnType<typeof vi.fn> }
}

/** adb, as far as a session sees it: the forward picks port 27183; connections reach `port`. */
function fakeIo(port: number) {
  const runs: string[][] = []
  const shell = fakeShell()
  const io: ScrcpyIo = {
    run: async (args) => {
      runs.push(args)
      return args.includes('tcp:0') ? '27183\n' : ''
    },
    spawn: vi.fn(() => shell),
    connect: () => connect({ host: '127.0.0.1', port }),
  }
  return { io, runs, shell }
}

function videoBytes(): Buffer {
  const name = Buffer.alloc(64)
  name.write('C66')
  const codec = Buffer.alloc(4)
  codec.writeUInt32BE(CODEC_H264)
  const session = Buffer.alloc(12)
  session.writeUInt32BE(0x80000000, 0)
  session.writeUInt32BE(720, 4)
  session.writeUInt32BE(1440, 8)
  const packet = (flags: bigint, data: number[]) => {
    const head = Buffer.alloc(12)
    head.writeBigUInt64BE(flags, 0)
    head.writeUInt32BE(data.length, 8)
    return Buffer.concat([head, Buffer.from(data)])
  }
  return Buffer.concat([Buffer.from([0]), name, codec, session, packet(1n << 62n, [0, 0, 0, 1, 0x67]), packet(1n << 61n, [0, 0, 0, 1, 0x65])])
}

const quiet = { size() {}, packet() {}, end() {} }

describe('startScrcpy', () => {
  it('copies the server, opens a tunnel, starts it and streams what it sends', async () => {
    const { port, control } = await fakeDevice(videoBytes())
    const { io, runs, shell } = fakeIo(port)
    const sizes: number[][] = []
    const packets: { config: boolean; key: boolean }[] = []
    const session = await startScrcpy('8d2e61a', server, {
      size: (width, height) => sizes.push([width, height]),
      packet: (p) => packets.push({ config: p.config, key: p.key }),
      end: () => {},
    }, io)

    expect(runs[0]).toEqual(['-s', '8d2e61a', 'push', '/res/scrcpy-server', REMOTE_PATH])
    expect(runs[1].slice(0, 4)).toEqual(['-s', '8d2e61a', 'forward', 'tcp:0'])
    expect(runs[1][4]).toMatch(/^localabstract:scrcpy_[0-9a-f]{8}$/)
    expect(io.spawn).toHaveBeenCalledWith(['-s', '8d2e61a', 'shell', ...serverArgs('5.0.1', runs[1][4].slice(-8))])
    await vi.waitFor(() => expect(packets).toEqual([{ config: true, key: false }, { config: false, key: true }]))
    expect(sizes).toEqual([[720, 1440]])

    const socket = await control
    const got = new Promise<Buffer>((resolve) => socket.once('data', resolve))
    session.send(resetVideoMessage())
    expect([...(await got)]).toEqual([0x11])

    session.stop()
    expect(shell.kill).toHaveBeenCalled()
    await vi.waitFor(() => expect(runs.at(-1)).toEqual(['-s', '8d2e61a', 'forward', '--remove', 'tcp:27183']))
  })

  it('ends when the device stops sending video, and says nothing after stop()', async () => {
    const { port, video } = await fakeDevice(videoBytes())
    const { io } = fakeIo(port)
    const ended: string[] = []
    const session = await startScrcpy('8d2e61a', server, { ...quiet, end: (why) => ended.push(why) }, io)
    ;(await video).destroy()
    await vi.waitFor(() => expect(ended).toEqual(['The device stopped sending video.']))
    session.stop()
    expect(ended).toHaveLength(1)
  })

  it("rejects with the server's own error when it stops before answering", async () => {
    device = createServer((socket) => socket.destroy())
    await new Promise<void>((resolve) => device!.listen(0, '127.0.0.1', resolve))
    const { io, shell } = fakeIo((device.address() as { port: number }).port)
    const started = startScrcpy('8d2e61a', server, quiet, io)
    await new Promise((resolve) => setTimeout(resolve, 50))
    shell.stdout.emit('data', Buffer.from('[server] INFO: Device: [CHAINWAY] C66 (Android 13)\n[server] ERROR: Could not open video stream\n'))
    shell.emit('close', 1)
    await expect(started).rejects.toThrow('Could not open video stream')
  })

  it('a stop while starting closes what it opened', async () => {
    device = createServer((socket) => socket.destroy()) // the server never answers
    await new Promise<void>((resolve) => device!.listen(0, '127.0.0.1', resolve))
    const { io, runs, shell } = fakeIo((device.address() as { port: number }).port)
    const stop = new AbortController()
    const started = startScrcpy('8d2e61a', server, quiet, io, stop.signal)
    await new Promise((resolve) => setTimeout(resolve, 150))
    stop.abort()
    await expect(started).rejects.toThrow('Stopped.')
    expect(shell.kill).toHaveBeenCalled()
    expect(runs.at(-1)).toEqual(['-s', '8d2e61a', 'forward', '--remove', 'tcp:27183'])
  })
})

describe('serverError', () => {
  it("takes the server's last error, without its prefix", () => {
    expect(serverError('[server] INFO: Device: [CHAINWAY] C66\n[server] ERROR: Encoding error: x\n')).toBe('Encoding error: x')
    expect(serverError('Exception in thread "main" java.lang.IllegalArgumentException: The server version (5.0.0) does not match the client (5.0.1)\n'))
      .toMatch(/does not match/)
    expect(serverError('adb: error: failed to get feature set: device offline\n')).toBe('adb: error: failed to get feature set: device offline')
    expect(serverError('[server] INFO: all good\n')).toBe('')
  })
})

describe('scrcpyServer', () => {
  const resources = mkdtempSync(join(tmpdir(), 'deck-resources-'))
  afterAll(() => rmSync(resources, { recursive: true, force: true }))

  it("finds the server and its version, or says how to get it", async () => {
    await expect(scrcpyServer(resources)).rejects.toThrow(/npm run fetch:scrcpy/)
    mkdirSync(resources, { recursive: true })
    writeFileSync(join(resources, 'scrcpy-server'), 'dex')
    writeFileSync(join(resources, 'scrcpy-server.json'), JSON.stringify({ version: '5.0.1' }))
    expect(await scrcpyServer(resources)).toEqual({ path: join(resources, 'scrcpy-server'), version: '5.0.1' })
  })
})
```

- [ ] **Step 2: Run it to make sure it fails**

Run: `npx vitest run src/main/devices/android/scrcpy.test.ts`
Expected: FAIL: `Failed to resolve import "./scrcpy"`.

- [ ] **Step 3: Write where the server is**

Create `src/main/devices/android/server.ts`:

```ts
import { access, readFile } from 'node:fs/promises'
import { join } from 'node:path'

export interface ScrcpyServer {
  /** The file pushed to the device. */
  path: string
  /** Passed to it: the server won't run for another version. */
  version: string
}

/** scrcpy's server in Deck's resources (process.resourcesPath when packaged, the repo's resources/
 *  in a dev build), with its version from scrcpy-server.json beside it. */
export async function scrcpyServer(resources: string): Promise<ScrcpyServer> {
  const path = join(resources, 'scrcpy-server')
  try {
    const info = JSON.parse(await readFile(join(resources, 'scrcpy-server.json'), 'utf8')) as { version?: unknown }
    await access(path)
    if (typeof info.version !== 'string' || !/^\d+(\.\d+)*$/.test(info.version)) throw new Error('no version')
    return { path, version: info.version }
  } catch {
    throw new Error("scrcpy's server isn't in Deck's resources. In a dev build, run npm run fetch:scrcpy.")
  }
}
```

- [ ] **Step 4: Write the session**

Create `src/main/devices/android/scrcpy.ts`:

```ts
import { type ChildProcess, spawn } from 'node:child_process'
import { randomInt } from 'node:crypto'
import { connect, type Socket } from 'node:net'
import { runAdb } from './adb'
import { CODEC_H264, VideoReader } from './protocol'
import type { ScrcpyServer } from './server'

/** Where the server is copied on the device. It deletes itself once started (scrcpy's cleanup). */
export const REMOTE_PATH = '/data/local/tmp/deck-scrcpy-server.jar'

export interface ScrcpyEvents {
  /** A capture session started: the frames that follow have this size. */
  size(width: number, height: number): void
  packet(packet: { config: boolean; key: boolean; data: Uint8Array }): void
  /** The stream ended by itself: why. Not called after stop(). */
  end(why: string): void
}

export interface ScrcpySession {
  /** A control message (protocol.ts). */
  send(message: Buffer): void
  stop(): void
}

/** How a session reaches adb and the tunnel; tests replace it. */
export interface ScrcpyIo {
  run(args: string[], timeoutMs?: number): Promise<string>
  spawn(args: string[]): ChildProcess
  connect(port: number): Socket
}

export function adbIo(adb: string): ScrcpyIo {
  return {
    run: (args, timeoutMs) => runAdb(adb, args, timeoutMs),
    spawn: (args) => spawn(adb, args, { stdio: ['ignore', 'pipe', 'pipe'], windowsHide: true }),
    connect: (port) => connect({ host: '127.0.0.1', port }),
  }
}

/** What `adb shell` runs: H.264 at most 1600 px on the long side and 60 frames a second, no audio,
 *  control on; the screen kept on while the device is plugged in (scrcpy puts the setting back when
 *  it stops); the device's own copies not sent back. */
export function serverArgs(version: string, scid: string): string[] {
  return [
    `CLASSPATH=${REMOTE_PATH}`, 'app_process', '/', 'com.genymobile.scrcpy.Server', version,
    `scid=${scid}`, 'log_level=info', 'tunnel_forward=true', 'audio=false', 'control=true',
    'video_codec=h264', 'max_size=1600', 'max_fps=60', 'stay_awake=true', 'clipboard_autosync=false',
  ]
}

/** The last error the server (or adb) printed, without the "[server] ERROR: " prefix; '' if none. */
export function serverError(text: string): string {
  const lines = text.split(/\r?\n/).map((line) => line.trim())
    .filter((line) => /\b(ERROR|Exception)\b/.test(line) || /^(adb: )?error:/i.test(line))
  return (lines.at(-1) ?? '').replace(/^\[server\]\s*/, '').replace(/^ERROR:\s*/, '')
}

const connected = (socket: Socket) =>
  new Promise<void>((resolve, reject) => {
    socket.once('connect', () => resolve())
    socket.once('error', reject)
  })

/** Through a forward tunnel a connection succeeds even before the server listens (adb accepts it,
 *  then drops it), so scrcpy's dummy byte says the server is really there. Up to 100 tries, 100 ms
 *  apart, as scrcpy itself does. The socket comes back paused, with what it sent first. */
async function firstAnswer(io: ScrcpyIo, port: number, gaveUp: () => boolean): Promise<{ socket: Socket; chunk: Buffer }> {
  for (let attempt = 0; attempt < 100 && !gaveUp(); attempt++) {
    const answer = await new Promise<{ socket: Socket; chunk: Buffer } | null>((resolve) => {
      const socket = io.connect(port)
      let done = false
      const settle = (value: { socket: Socket; chunk: Buffer } | null) => {
        if (done) return
        done = true
        clearTimeout(timer)
        if (!value) socket.destroy()
        resolve(value)
      }
      const timer = setTimeout(() => settle(null), 2000)
      socket.on('error', () => {})
      socket.once('close', () => settle(null))
      socket.once('data', (chunk: Buffer) => {
        socket.pause()
        settle({ socket, chunk })
      })
    })
    if (answer) return answer
    await new Promise((resolve) => setTimeout(resolve, 100))
  }
  throw new Error("scrcpy's server didn't answer.")
}

/** Streams one device: copies the server, opens a tunnel, starts the server and connects to its
 *  video and control sockets. Resolves once video flows; rejects, cleaning up, when a step fails or
 *  `signal` stops it first. */
export async function startScrcpy(serial: string, server: ScrcpyServer, events: ScrcpyEvents, io: ScrcpyIo, signal?: AbortSignal): Promise<ScrcpySession> {
  const scid = randomInt(0, 0x7fffffff).toString(16).padStart(8, '0')
  const adb = (args: string[], timeoutMs?: number) => io.run(['-s', serial, ...args], timeoutMs)
  let port = 0
  let shell: ChildProcess | null = null
  let video: Socket | null = null
  let control: Socket | null = null
  let said = ''
  let returned = false
  let over = false
  let why = ''

  /** Safe to run again: a step that finishes after a stop may have opened something since. */
  const cleanUp = () => {
    video?.destroy()
    control?.destroy()
    shell?.kill()
    if (port) {
      const tunnel = port
      port = 0
      adb(['forward', '--remove', `tcp:${tunnel}`]).catch(() => {})
    }
  }
  /** The stream is over: the caller hears it once it has the session; before that it's thrown. */
  const finish = (reason: string) => {
    if (over) return
    over = true
    why = reason
    cleanUp()
    if (returned) events.end(reason)
  }
  const reason = (fallback: string) => serverError(said) || fallback
  /** Between steps: a stop or a failure meanwhile ends the start here. */
  const still = () => {
    if (over) throw new Error(why)
  }
  // Stopping a start under way: without it, a Deck that quit mid-start left the server running on
  // the device (seen on 2026-11-03).
  const stop = () => finish('Stopped.')
  signal?.addEventListener('abort', stop, { once: true })

  try {
    if (signal?.aborted) stop()
    still()
    await adb(['push', server.path, REMOTE_PATH], 60_000)
    still()
    port = Number.parseInt((await adb(['forward', 'tcp:0', `localabstract:scrcpy_${scid}`])).trim(), 10)
    still()
    if (!Number.isInteger(port) || port <= 0) throw new Error("adb couldn't open a tunnel to the device.")
    const child = io.spawn(['-s', serial, 'shell', ...serverArgs(server.version, scid)])
    shell = child
    const keep = (chunk: Buffer) => {
      said = `${said}${chunk.toString()}`.slice(-4000)
    }
    child.stdout?.on('data', keep)
    child.stderr?.on('data', keep)
    child.on('error', (err) => finish(err.message))
    child.on('close', (code) => finish(reason(`scrcpy's server stopped (exit code ${code}).`)))

    const first = await firstAnswer(io, port, () => over)
    video = first.socket
    still()
    control = io.connect(port)
    await connected(control)
    still()
    control.on('error', () => {})
    control.on('data', () => {}) // device messages: none were asked for
    control.on('close', () => finish(reason('The device closed the control connection.')))

    const reader = new VideoReader()
    const onChunk = (chunk: Buffer) => {
      for (const event of reader.feed(chunk)) {
        if (over) return
        if (event.type === 'error') return finish(event.message)
        if (event.type === 'codec' && event.codec !== CODEC_H264) {
          return finish(reason(event.codec <= 1 ? "The device couldn't start its video." : `scrcpy sent another codec (${event.codec.toString(16)}).`))
        }
        if (event.type === 'size') events.size(event.width, event.height)
        else if (event.type === 'packet') events.packet({ config: event.config, key: event.key, data: event.data })
      }
    }
    video.on('error', () => {})
    video.on('close', () => finish(reason('The device stopped sending video.')))
    video.on('data', onChunk)
    onChunk(first.chunk)
    video.resume()
  } catch (err) {
    finish(err instanceof Error ? err.message : String(err))
    cleanUp()
  } finally {
    signal?.removeEventListener('abort', stop)
  }
  if (over) throw new Error(serverError(said) || why)
  returned = true

  return {
    send(message) {
      if (!over && control && !control.destroyed) control.write(message)
    },
    stop() {
      if (over) return
      over = true
      cleanUp()
    },
  }
}
```

- [ ] **Step 5: Run the test to make sure it passes**

Run: `npx vitest run src/main/devices/android/scrcpy.test.ts`
Expected: PASS (6 tests).

- [ ] **Step 6: Commit**

```bash
git add src/main/devices/android/server.ts src/main/devices/android/scrcpy.ts src/main/devices/android/scrcpy.test.ts
git -c user.email=franco@effektstudios.com commit -m "Devices: a scrcpy session over an adb tunnel" -m "Claude-Session: https://claude.ai/code/session_012TidnAXmFkf7jwBCQQo4jJ"
```

---

### Task 8: Streams: viewers, grace, retries

**Files:**
- Create: `src/main/devices/streams.ts`
- Test: `src/main/devices/streams.test.ts`

- [ ] **Step 1: Write the failing test**

Create `src/main/devices/streams.test.ts`:

```ts
import { afterEach, beforeEach, describe, expect, it, vi } from 'vitest'
import type { DeviceStreamEvent } from '@shared/types'
import type { ScrcpyEvents } from './android/scrcpy'
import { DeviceStreams } from './streams'

interface Started {
  id: string
  events: ScrcpyEvents
  session: { send: ReturnType<typeof vi.fn>; stop: ReturnType<typeof vi.fn> }
}

function setup(failing: () => boolean = () => false) {
  const started: Started[] = []
  const sent: [string, DeviceStreamEvent][] = []
  const streams = new DeviceStreams({
    start: async (id, events) => {
      if (failing()) throw new Error('device offline')
      const session = { send: vi.fn(), stop: vi.fn() }
      started.push({ id, events, session })
      return session
    },
    send: (id, event) => sent.push([id, event]),
  })
  return { streams, started, sent }
}

const states = (sent: [string, DeviceStreamEvent][]) => sent.flatMap(([, e]) => (e.type === 'state' ? [e.state] : []))
const flush = () => vi.advanceTimersByTimeAsync(0)
const frame = { config: false, key: true, data: new Uint8Array([1]) }

beforeEach(() => {
  vi.useFakeTimers()
})
afterEach(() => {
  vi.useRealTimers()
})

describe('DeviceStreams', () => {
  it('one stream for two viewers, kept 10 s after the last leaves; a viewer coming back gets a key frame', async () => {
    const { streams, started, sent } = setup()
    streams.view('android:1')
    streams.view('android:1')
    await flush()
    expect(started).toHaveLength(1)
    started[0].events.size(720, 1440)
    started[0].events.packet(frame)
    expect(states(sent)).toEqual(['connecting', 'connecting', 'live']) // the second viewer is told too

    streams.unview('android:1')
    streams.unview('android:1')
    await vi.advanceTimersByTimeAsync(9_000)
    streams.view('android:1')
    expect(started).toHaveLength(1)
    expect(started[0].session.send).toHaveBeenCalledWith(Buffer.from([17]))
    expect(sent.slice(-2)).toEqual([['android:1', { type: 'size', width: 720, height: 1440 }], ['android:1', { type: 'state', state: 'live' }]])

    streams.unview('android:1')
    await vi.advanceTimersByTimeAsync(10_000)
    expect(started[0].session.stop).toHaveBeenCalled()
  })

  it('a stream that breaks starts again after 1, 2 and 5 s, then reports the error until retry()', async () => {
    let failing = false
    const { streams, started, sent } = setup(() => failing)
    streams.view('android:1')
    await flush()
    failing = true
    started[0].events.end('The device stopped sending video.')
    expect(sent.at(-1)).toEqual(['android:1', { type: 'state', state: 'reconnecting' }])
    await vi.advanceTimersByTimeAsync(1000 + 2000 + 5000)
    expect(sent.at(-1)).toEqual(['android:1', { type: 'state', state: 'error', message: 'device offline' }])

    failing = false
    streams.retry('android:1')
    await flush()
    expect(started).toHaveLength(2)
  })

  it('a stream that went live and broke gets three fresh tries', async () => {
    const { streams, started } = setup()
    streams.view('android:1')
    await flush()
    for (let i = 0; i < 4; i++) {
      started[i].events.packet(frame)
      started[i].events.end('gone')
      await vi.advanceTimersByTimeAsync(1000)
    }
    expect(started).toHaveLength(5)
  })

  it('stops while the Mac is locked or asleep, and starts again after', async () => {
    const { streams, started, sent } = setup()
    streams.view('android:1')
    await flush()
    streams.pause()
    expect(started[0].session.stop).toHaveBeenCalled()
    // News from the stopped session is dropped.
    const before = sent.length
    started[0].events.packet(frame)
    started[0].events.end('gone')
    expect(sent).toHaveLength(before)
    streams.resume()
    await flush()
    expect(started).toHaveLength(2)
  })

  it('passes input and key frame requests to a running session only', async () => {
    const { streams, started } = setup()
    streams.input('android:1', Buffer.from([1]))
    streams.view('android:1')
    await flush()
    streams.input('android:1', Buffer.from([2]))
    streams.keyframe('android:1')
    expect(started[0].session.send.mock.calls).toEqual([[Buffer.from([2])], [Buffer.from([17])]])
  })

  it('stopping a stream that is still starting stops the start', async () => {
    const signals: AbortSignal[] = []
    const streams = new DeviceStreams({
      start: (_id, _events, signal) => {
        signals.push(signal)
        return new Promise(() => {}) // adb never finishes
      },
      send: () => {},
    })
    streams.view('android:1')
    streams.unview('android:1')
    await vi.advanceTimersByTimeAsync(10_000)
    expect(signals[0].aborted).toBe(true)
    streams.view('android:2')
    streams.pause()
    expect(signals[1].aborted).toBe(true)
  })
})
```

- [ ] **Step 2: Run it to make sure it fails**

Run: `npx vitest run src/main/devices/streams.test.ts`
Expected: FAIL: `Failed to resolve import "./streams"`.

- [ ] **Step 3: Write the implementation**

Create `src/main/devices/streams.ts`:

```ts
import type { DeviceStreamEvent } from '@shared/types'
import { resetVideoMessage } from './android/protocol'
import type { ScrcpyEvents, ScrcpySession } from './android/scrcpy'

export interface StreamsDeps {
  /** Starts device `id`'s stream; `signal` stops a start still under way. */
  start(id: string, events: ScrcpyEvents, signal: AbortSignal): Promise<ScrcpySession>
  /** News for the renderer. */
  send(id: string, event: DeviceStreamEvent): void
  /** How long a stream nobody views keeps running. */
  graceMs?: number
  /** The waits before each new start after a stream broke; then it's an error. */
  retryMs?: readonly number[]
}

interface Stream {
  viewers: number
  session: ScrcpySession | null
  /** The start under way; aborting it stops it. */
  starting: AbortController | null
  /** Breaks in a row; a stream that goes live counts from 0 again. */
  failures: number
  graceTimer: ReturnType<typeof setTimeout> | null
  retryTimer: ReturnType<typeof setTimeout> | null
  /** Set once the retries ran out, until retry(). */
  error: string | null
  /** The latest capture size, for a viewer that joins a running stream. */
  size: { width: number; height: number } | null
  live: boolean
  /** Bumped at every start and stop, so an older session's news is dropped. */
  generation: number
}

/** One stream per device viewed, shared by its viewers (tabs). It keeps running 10 s after the last
 *  viewer leaves, so switching tabs and back doesn't restart it: a viewer that comes back asks for a
 *  key frame instead. A stream that breaks is started again after 1, 2 and 5 s, then reports the
 *  error until retry(). While the Mac is locked or asleep (pause) nothing streams. */
export class DeviceStreams {
  private readonly streams = new Map<string, Stream>()
  private paused = false
  private readonly graceMs: number
  private readonly retryMs: readonly number[]

  constructor(private readonly deps: StreamsDeps) {
    this.graceMs = deps.graceMs ?? 10_000
    this.retryMs = deps.retryMs ?? [1000, 2000, 5000]
  }

  view(id: string): void {
    let s = this.streams.get(id)
    if (!s) {
      s = { viewers: 0, session: null, starting: null, failures: 0, graceTimer: null, retryTimer: null, error: null, size: null, live: false, generation: 0 }
      this.streams.set(id, s)
    }
    s.viewers++
    if (s.graceTimer) {
      clearTimeout(s.graceTimer)
      s.graceTimer = null
    }
    if (this.paused) return
    if (s.error) return this.deps.send(id, { type: 'state', state: 'error', message: s.error })
    if (s.session) {
      if (s.size) this.deps.send(id, { type: 'size', ...s.size })
      if (s.live) this.deps.send(id, { type: 'state', state: 'live' })
      s.session.send(resetVideoMessage()) // the new viewer's decoder starts from a key frame
      return
    }
    if (s.starting || s.retryTimer) return this.deps.send(id, { type: 'state', state: s.failures > 0 ? 'reconnecting' : 'connecting' })
    this.begin(id, s)
  }

  unview(id: string): void {
    const s = this.streams.get(id)
    if (!s || s.viewers === 0) return
    s.viewers--
    if (s.viewers > 0) return
    if (!s.session && !s.starting) return this.drop(id, s) // an error, or a retry nobody waits for
    s.graceTimer = setTimeout(() => {
      s.graceTimer = null
      if (s.viewers === 0 && this.streams.get(id) === s) this.drop(id, s)
    }, this.graceMs)
  }

  /** A fresh key frame: a decoder fell behind or failed. */
  keyframe(id: string): void {
    this.streams.get(id)?.session?.send(resetVideoMessage())
  }

  /** A control message for the device, while its stream runs. */
  input(id: string, message: Buffer): void {
    this.streams.get(id)?.session?.send(message)
  }

  retry(id: string): void {
    const s = this.streams.get(id)
    if (!s || !s.error || s.viewers === 0 || this.paused) return
    s.failures = 0
    this.begin(id, s)
  }

  pause(): void {
    if (this.paused) return
    this.paused = true
    for (const [id, s] of this.streams) {
      this.halt(s)
      if (s.viewers === 0) this.streams.delete(id)
    }
  }

  resume(): void {
    if (!this.paused) return
    this.paused = false
    for (const [id, s] of this.streams) {
      s.failures = 0
      this.begin(id, s)
    }
  }

  /** A reload or quit: every stream stops, viewers forgotten. */
  stopAll(): void {
    for (const s of this.streams.values()) this.halt(s)
    this.streams.clear()
  }

  private begin(id: string, s: Stream): void {
    const start = new AbortController()
    s.starting = start
    s.live = false
    s.error = null
    const generation = ++s.generation
    this.deps.send(id, { type: 'state', state: s.failures > 0 ? 'reconnecting' : 'connecting' })
    const current = () => this.streams.get(id) === s && s.generation === generation
    const events: ScrcpyEvents = {
      size: (width, height) => {
        if (!current()) return
        s.size = { width, height }
        this.deps.send(id, { type: 'size', width, height })
      },
      packet: (packet) => {
        if (!current()) return
        if (!s.live) {
          s.live = true
          s.failures = 0
          this.deps.send(id, { type: 'state', state: 'live' })
        }
        this.deps.send(id, { type: 'packet', ...packet })
      },
      end: (why) => {
        if (!current()) return
        s.session = null
        s.live = false
        this.failed(id, s, why)
      },
    }
    this.deps.start(id, events, start.signal).then(
      (session) => {
        if (!current()) return session.stop()
        s.starting = null
        s.session = session
      },
      (err: unknown) => {
        if (!current()) return
        s.starting = null
        this.failed(id, s, err instanceof Error ? err.message : String(err))
      },
    )
  }

  private failed(id: string, s: Stream, why: string): void {
    if (s.viewers === 0) return this.drop(id, s)
    if (this.paused) return
    if (s.failures < this.retryMs.length) {
      const wait = this.retryMs[s.failures++]
      this.deps.send(id, { type: 'state', state: 'reconnecting' })
      s.retryTimer = setTimeout(() => {
        s.retryTimer = null
        if (this.streams.get(id) === s && s.viewers > 0 && !this.paused) this.begin(id, s)
      }, wait)
      return
    }
    s.error = why
    this.deps.send(id, { type: 'state', state: 'error', message: why })
  }

  /** Stops the stream's session and timers; its news from here on is dropped. */
  private halt(s: Stream): void {
    if (s.graceTimer) clearTimeout(s.graceTimer)
    if (s.retryTimer) clearTimeout(s.retryTimer)
    s.graceTimer = null
    s.retryTimer = null
    s.generation++
    s.session?.stop()
    s.session = null
    s.starting?.abort()
    s.starting = null
    s.live = false
  }

  private drop(id: string, s: Stream): void {
    this.halt(s)
    this.streams.delete(id)
  }
}
```

- [ ] **Step 4: Run the test to make sure it passes**

Run: `npx vitest run src/main/devices/streams.test.ts`
Expected: PASS (6 tests).

- [ ] **Step 5: Commit**

```bash
git add src/main/devices/streams.ts src/main/devices/streams.test.ts
git -c user.email=franco@effektstudios.com commit -m "Devices: one stream per device viewed, 10 s grace and retries" -m "Claude-Session: https://claude.ai/code/session_012TidnAXmFkf7jwBCQQo4jJ"
```

---

### Task 9: Projects and picks

**Files:**
- Create: `src/main/devices/project.ts`
- Create: `src/main/devices/picks.ts`
- Test: `src/main/devices/project.test.ts`
- Test: `src/main/devices/picks.test.ts`

- [ ] **Step 1: Write the failing tests**

Create `src/main/devices/project.test.ts`:

```ts
import { mkdirSync, writeFileSync } from 'node:fs'
import { dirname, join } from 'node:path'
import { afterAll, describe, expect, it } from 'vitest'
import { commit, makeDir, makeRepo, removeRepos, run } from '../git/test-repo'
import { describeProject, isAndroidApp, projectRoot } from './project'

afterAll(removeRepos)

function touch(file: string): void {
  mkdirSync(dirname(file), { recursive: true })
  writeFileSync(file, '<manifest/>')
}

describe('isAndroidApp', () => {
  it("finds a module's manifest one level down, and two levels down in android/", async () => {
    const gradle = makeDir('deck-dev-')
    touch(join(gradle, 'app', 'src', 'main', 'AndroidManifest.xml'))
    expect(await isAndroidApp(gradle)).toBe(true)
    const flutter = makeDir('deck-dev-')
    touch(join(flutter, 'android', 'app', 'src', 'main', 'AndroidManifest.xml'))
    expect(await isAndroidApp(flutter)).toBe(true)
  })

  it('skips build output, dependencies and folders deeper down', async () => {
    const dir = makeDir('deck-dev-')
    touch(join(dir, 'build', 'src', 'main', 'AndroidManifest.xml'))
    touch(join(dir, 'node_modules', 'x', 'src', 'main', 'AndroidManifest.xml'))
    touch(join(dir, 'libs', 'app', 'src', 'main', 'AndroidManifest.xml'))
    expect(await isAndroidApp(dir)).toBe(false)
  })
})

describe('projectRoot', () => {
  it("is a worktree's main checkout, a sub-folder's repository, and a plain folder itself", async () => {
    const repo = makeRepo()
    commit(repo, 'first', { 'a.txt': 'a' })
    const tree = join(makeDir('deck-dev-wt-'), 'fix')
    run(repo, 'worktree', 'add', '-q', '-b', 'fix', tree)
    mkdirSync(join(repo, 'sub'))
    expect(await projectRoot(tree)).toBe(repo)
    expect(await projectRoot(join(repo, 'sub'))).toBe(repo)
    const plain = makeDir('deck-dev-')
    expect(await projectRoot(plain)).toBe(plain)
  })
})

describe('describeProject', () => {
  it("a worktree of an Android app is that app", async () => {
    const repo = makeRepo()
    commit(repo, 'app', { 'app/src/main/AndroidManifest.xml': '<manifest/>' })
    const tree = join(makeDir('deck-dev-wt-'), 'task')
    run(repo, 'worktree', 'add', '-q', '-b', 'task', tree)
    expect(await describeProject(tree)).toEqual({ root: repo, android: true })
  })
})
```

Create `src/main/devices/picks.test.ts`:

```ts
import { mkdtempSync, rmSync, writeFileSync } from 'node:fs'
import { tmpdir } from 'node:os'
import { join } from 'node:path'
import { afterAll, describe, expect, it } from 'vitest'
import { PicksStore } from './picks'

const root = mkdtempSync(join(tmpdir(), 'deck-picks-'))
afterAll(() => rmSync(root, { recursive: true, force: true }))

describe('PicksStore', () => {
  it("remembers each project's device across restarts", async () => {
    const file = join(root, 'devices.json')
    const store = new PicksStore(file)
    expect(await store.get('/Volumes/Wyobi/AccessControl_Guard')).toBeNull()
    await store.set('/Volumes/Wyobi/AccessControl_Guard', 'android:8d2e61a')
    await store.set('/Volumes/Wyobi/AccessControl_Android', 'emulator:Pixel_9')
    await store.set('/Volumes/Wyobi/AccessControl_Android', 'android:R5CW20XY7QZ')
    const again = new PicksStore(file)
    expect(await again.get('/Volumes/Wyobi/AccessControl_Guard')).toBe('android:8d2e61a')
    expect(await again.get('/Volumes/Wyobi/AccessControl_Android')).toBe('android:R5CW20XY7QZ')
  })

  it('reads a broken file as empty', async () => {
    const file = join(root, 'broken.json')
    writeFileSync(file, '{ not json')
    expect(await new PicksStore(file).get('/x')).toBeNull()
  })
})
```

- [ ] **Step 2: Run them to make sure they fail**

Run: `npx vitest run src/main/devices/project.test.ts src/main/devices/picks.test.ts`
Expected: FAIL: `Failed to resolve import "./project"` and `"./picks"`.

- [ ] **Step 3: Write the project rules**

Create `src/main/devices/project.ts`:

```ts
import { readdir, realpath, stat } from 'node:fs/promises'
import { basename, dirname, join } from 'node:path'
import { gitDirs } from '../git/summary'

/** The tab's project: its repository's main work tree, so a worktree belongs to its project; outside
 *  git, the folder itself; as the file system spells it. */
export async function projectRoot(folder: string): Promise<string> {
  const dirs = await gitDirs(folder)
  // The common dir is canonical already: `<main checkout>/.git` unless the repository is bare.
  if (dirs && basename(dirs.commonDir) === '.git') return dirname(dirs.commonDir)
  const own = dirs ? dirs.root : folder
  return realpath(own).catch(() => own)
}

/** Build output and dependencies hold no app of the project's own. */
const SKIP = new Set(['build', 'node_modules', 'Pods', 'DerivedData'])

async function subfolders(dir: string): Promise<string[]> {
  const entries = await readdir(dir, { withFileTypes: true }).catch(() => [])
  return entries.filter((e) => e.isDirectory() && !e.name.startsWith('.') && !SKIP.has(e.name)).map((e) => join(dir, e.name))
}

const hasManifest = (module: string) =>
  stat(join(module, 'src', 'main', 'AndroidManifest.xml')).then((s) => s.isFile(), () => false)

/** An Android app has an AndroidManifest.xml in `src/main/` of a folder one level down
 *  (`app/src/main/`), or two levels down in `android/` (Flutter, React Native). */
export async function isAndroidApp(root: string): Promise<boolean> {
  const first = await subfolders(root)
  if ((await Promise.all(first.map(hasManifest))).some(Boolean)) return true
  const android = first.filter((dir) => basename(dir) === 'android')
  const second = (await Promise.all(android.map(subfolders))).flat()
  return (await Promise.all(second.map(hasManifest))).some(Boolean)
}

export async function describeProject(folder: string): Promise<{ root: string; android: boolean }> {
  const root = await projectRoot(folder)
  return { root, android: await isAndroidApp(root) }
}
```

- [ ] **Step 4: Write the picks store**

Create `src/main/devices/picks.ts`:

```ts
import { mkdir, readFile } from 'node:fs/promises'
import { dirname, resolve } from 'node:path'
import { writeFileAtomic } from '../fs/atomic'
import { pathKey } from '../projects/config'

const keyOf = (root: string) => pathKey(resolve(root))

function parse(text: string): Map<string, string> {
  const picks = new Map<string, string>()
  let raw: unknown
  try {
    raw = JSON.parse(text.replace(/^﻿/, ''))
  } catch {
    return picks
  }
  if (typeof raw !== 'object' || raw === null || Array.isArray(raw)) return picks
  for (const [root, id] of Object.entries(raw)) if (typeof id === 'string' && id) picks.set(keyOf(root), id)
  return picks
}

/** Each project's device, `{ [project root]: device id }` in devices.json (userData). */
export class PicksStore {
  private cache: Promise<Map<string, string>> | null = null
  private queue: Promise<unknown> = Promise.resolve()

  constructor(private readonly file: string) {}

  private load(): Promise<Map<string, string>> {
    this.cache ??= readFile(this.file, 'utf8').then(parse, (err: NodeJS.ErrnoException) => {
      if (err.code === 'ENOENT') return new Map<string, string>()
      this.cache = null // try again next time; never save over a file that couldn't be read
      throw err
    })
    return this.cache
  }

  async get(root: string): Promise<string | null> {
    return (await this.load()).get(keyOf(root)) ?? null
  }

  /** One write at a time, each beside the file and renamed over it. */
  set(root: string, id: string): Promise<void> {
    const result = this.queue.then(async () => {
      const next = new Map(await this.load())
      next.set(keyOf(root), id)
      await mkdir(dirname(this.file), { recursive: true })
      await writeFileAtomic(this.file, `${JSON.stringify(Object.fromEntries(next), null, 2)}\n`)
      this.cache = Promise.resolve(next)
    })
    this.queue = result.catch(() => undefined)
    return result
  }
}
```

- [ ] **Step 5: Run the tests to make sure they pass**

Run: `npx vitest run src/main/devices/project.test.ts src/main/devices/picks.test.ts`
Expected: PASS (6 tests).

- [ ] **Step 6: Commit**

```bash
git add src/main/devices/project.ts src/main/devices/project.test.ts src/main/devices/picks.ts src/main/devices/picks.test.ts
git -c user.email=franco@effektstudios.com commit -m "Devices: a tab's project, Android apps, and each project's device" -m "Claude-Session: https://claude.ai/code/session_012TidnAXmFkf7jwBCQQo4jJ"
```

---

### Task 10: Main's wiring

**Files:**
- Create: `src/main/devices/ipc.ts`
- Test: `src/main/devices/ipc.test.ts`
- Modify: `src/main/clipboard/ipc.ts` (the `ClipboardIpc` interface and the returned object)
- Modify: `src/main/index.ts`

- [ ] **Step 1: Write the failing test**

Create `src/main/devices/ipc.test.ts`:

```ts
import { EventEmitter } from 'node:events'
import { mkdtempSync, rmSync } from 'node:fs'
import { tmpdir } from 'node:os'
import { join } from 'node:path'
import { afterAll, describe, expect, it, vi } from 'vitest'
import { IPC } from '@shared/channels'
import type { DeviceList, DeviceProject, InsertResult } from '@shared/types'
import type { BrowserWindow } from 'electron'
import { commit, makeRepo, removeRepos } from '../git/test-repo'
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

const root = mkdtempSync(join(tmpdir(), 'deck-devices-ipc-'))
afterAll(() => {
  rmSync(root, { recursive: true, force: true })
  removeRepos()
})

/** A window that records what it's sent. */
function fakeWindow() {
  const sent: [string, unknown[]][] = []
  const webContents = Object.assign(new EventEmitter(), {
    isDestroyed: () => false,
    send: (channel: string, ...args: unknown[]) => sent.push([channel, args]),
  })
  const win = Object.assign(new EventEmitter(), { isDestroyed: () => false, webContents })
  return { win: win as unknown as BrowserWindow, sent }
}

const call = <T>(channel: string, ...args: unknown[]) => Promise.resolve(ipc.handlers.get(channel)!({}, ...args)) as Promise<T>
const emit = (channel: string, ...args: unknown[]) => ipc.listeners.get(channel)!({}, ...args)

// One registration for the file: ipcMain keeps one handler per channel. No SDK in `home` and an
// empty PATH: Deck finds no adb.
const devices = registerDeviceIpc({
  picksFile: join(root, 'devices.json'),
  resources: join(root, 'resources'),
  platform: 'linux',
  home: join(root, 'home'),
  env: { PATH: '' },
  saveImage: async () => '/tmp/Deck clipboard/1/clipboard-ab.png',
})
const { win, sent } = fakeWindow()
devices.attach(win)

describe('registerDeviceIpc', () => {
  it("says so when adb can't be found, and forgets it when nothing needs devices", async () => {
    emit(IPC.devicesWatch)
    await vi.waitFor(() => expect(sent.at(-1)).toEqual([IPC.devicesChanged, [{ devices: [], problem: 'no-adb' }]]))
    expect(await call<DeviceList>(IPC.devicesList)).toEqual({ devices: [], problem: 'no-adb' })
    emit(IPC.devicesUnwatch)
    expect(sent.at(-1)).toEqual([IPC.devicesChanged, [{ devices: [], problem: null }]])
  })

  it("describes a tab's project and remembers its device", async () => {
    // Only git repositories are looked into for an app.
    const app = makeRepo()
    commit(app, 'app', { 'app/src/main/AndroidManifest.xml': '<manifest/>' })
    expect(await call<DeviceProject>(IPC.devicesProject, app)).toEqual({ root: app, android: true, pick: null })
    await call(IPC.devicesPick, app, 'android:8d2e61a')
    expect(await call<DeviceProject>(IPC.devicesProject, app)).toEqual({ root: app, android: true, pick: 'android:8d2e61a' })
    await expect(call(IPC.devicesProject, 42)).rejects.toThrow('No folder given.')
    await expect(call(IPC.devicesProject, 'relative/app')).rejects.toThrow('No folder given.')
  })

  it('turns a screenshot into the quoted path Claude reads', async () => {
    expect(await call<InsertResult>(IPC.devicesScreenshot, new Uint8Array([137, 80]))).toEqual({ text: "'/tmp/Deck clipboard/1/clipboard-ab.png' " })
    expect(await call<InsertResult>(IPC.devicesScreenshot, 'not a png')).toEqual({ error: 'There was no screenshot to add.' })
  })

  it('ignores input it cannot use and views of nothing', () => {
    expect(() => emit(IPC.devicesInput, 'android:1', { type: 'shell' })).not.toThrow()
    expect(() => emit(IPC.devicesView, 42)).not.toThrow()
    expect(() => emit(IPC.devicesUnview, 'android:never-viewed')).not.toThrow()
    expect(() => emit(IPC.devicesKeyframe, null)).not.toThrow()
  })
})
```

- [ ] **Step 2: Run it to make sure it fails**

Run: `npx vitest run src/main/devices/ipc.test.ts`
Expected: FAIL: `Failed to resolve import "./ipc"`.

- [ ] **Step 3: Write the wiring**

Create `src/main/devices/ipc.ts`:

```ts
import { spawn } from 'node:child_process'
import { isAbsolute } from 'node:path'
import { type BrowserWindow, ipcMain, powerMonitor } from 'electron'
import { IPC } from '@shared/channels'
import { quotePath } from '@shared/quote'
import type { DeviceList, DeviceProject, InsertResult, Platform } from '@shared/types'
import { adbCandidates, findAdb, runAdb } from './android/adb'
import { IDENTITY_SCRIPT, parseIdentity } from './android/devices'
import { controlMessages } from './android/input'
import { adbIo, startScrcpy } from './android/scrcpy'
import { scrcpyServer } from './android/server'
import { AndroidTracker } from './android/tracker'
import { PicksStore } from './picks'
import { describeProject } from './project'
import { DeviceStreams } from './streams'

export interface DeviceIpcOptions {
  /** devices.json in userData: each project's device. */
  picksFile: string
  /** Deck's resources folder, which holds scrcpy's server. */
  resources: string
  platform: Platform
  home: string
  env: NodeJS.ProcessEnv
  /** Saves a PNG where Claude can read it (the clipboard card's folder); resolves with its path. */
  saveImage(png: Uint8Array): Promise<string>
}

export interface DeviceIpc {
  /** Pushes go to this window; a reload forgets its watches and views. */
  attach(win: BrowserWindow): void
  /** At quit: stop streaming and watching. */
  dispose(): void
}

const NOTHING: DeviceList = { devices: [], problem: null }

/** The device panel's main side: Android devices adb sees (looked for only while a tab needs them),
 *  each project's device, scrcpy streams for the devices viewed, and screenshots for Claude. */
export function registerDeviceIpc(opts: DeviceIpcOptions): DeviceIpc {
  const picks = new PicksStore(opts.picksFile)
  let win: BrowserWindow | null = null
  let list: DeviceList = NOTHING
  let watchers = 0
  let tracker: AndroidTracker | null = null
  /** Looked for again at each start of watching, so an SDK installed since is found. */
  let adb: string | null = null
  /** Bumped by every start and stop, so a slow look for adb can't start watching late. */
  let generation = 0

  const send = (channel: string, ...args: unknown[]) => {
    if (win && !win.isDestroyed() && !win.webContents.isDestroyed()) win.webContents.send(channel, ...args)
  }
  const publish = (next: DeviceList) => {
    if (JSON.stringify(next) === JSON.stringify(list)) return
    list = next
    send(IPC.devicesChanged, list)
  }

  const streams = new DeviceStreams({
    start: async (id, events, signal) => {
      const serial = tracker?.serialFor(id)
      if (!adb || !serial) throw new Error("The device isn't connected.")
      return startScrcpy(serial, await scrcpyServer(opts.resources), events, adbIo(adb), signal)
    },
    send: (id, event) => send(IPC.devicesStream, id, event),
  })

  const startWatching = async () => {
    const mine = ++generation
    const found = await findAdb(adbCandidates(opts.env, opts.platform, opts.home))
    if (mine !== generation) return
    adb = found
    if (!found) return publish({ devices: [], problem: 'no-adb' })
    tracker = new AndroidTracker({
      track: () => spawn(found, ['track-devices', '-l'], { stdio: ['ignore', 'pipe', 'pipe'], windowsHide: true }),
      identify: async (serial) => parseIdentity(await runAdb(found, ['-s', serial, 'shell', IDENTITY_SCRIPT], 10_000)),
      publish: (devices, error) => publish({ devices, problem: error && devices.length === 0 ? { error } : null }),
    })
    tracker.start()
  }
  const stopWatching = () => {
    generation++
    tracker?.stop()
    tracker = null
    publish(NOTHING)
  }

  /** A folder's project, for 30 s: asked whenever a tab comes to the front, and each look runs git
   *  and a few dozen stats. The pick is read fresh every time. */
  const projects = new Map<string, { at: number; value: Promise<{ root: string; android: boolean }> }>()
  const describe = (folder: string) => {
    const now = Date.now()
    const cached = projects.get(folder)
    if (cached && now - cached.at < 30_000) return cached.value
    if (projects.size > 200) projects.clear()
    const value = describeProject(folder, opts.home)
    projects.set(folder, { at: now, value })
    value.catch(() => projects.delete(folder))
    return value
  }

  // ipcMain.on listeners check their arguments: a throw there becomes an error dialog.
  ipcMain.on(IPC.devicesWatch, () => {
    if (++watchers === 1) void startWatching()
  })
  ipcMain.on(IPC.devicesUnwatch, () => {
    if (watchers > 0 && --watchers === 0) stopWatching()
  })
  ipcMain.handle(IPC.devicesList, () => list)
  ipcMain.handle(IPC.devicesProject, async (_e, folder: unknown): Promise<DeviceProject> => {
    if (typeof folder !== 'string' || !isAbsolute(folder)) throw new Error('No folder given.')
    const { root, android } = await describe(folder)
    // An unreadable devices.json must not hide every tab's panel: no pick, then.
    const pick = await picks.get(root).catch((err: unknown) => {
      console.error('devices: reading devices.json failed', err)
      return null
    })
    return { root, android, pick }
  })
  ipcMain.handle(IPC.devicesPick, async (_e, root: unknown, id: unknown) => {
    if (typeof root !== 'string' || !root || typeof id !== 'string' || !id) throw new Error('No project or device given.')
    await picks.set(root, id)
  })
  ipcMain.on(IPC.devicesView, (_e, id: unknown) => {
    if (typeof id === 'string' && id) streams.view(id)
  })
  ipcMain.on(IPC.devicesUnview, (_e, id: unknown) => {
    if (typeof id === 'string') streams.unview(id)
  })
  ipcMain.on(IPC.devicesKeyframe, (_e, id: unknown) => {
    if (typeof id === 'string') streams.keyframe(id)
  })
  ipcMain.on(IPC.devicesRetry, (_e, id: unknown) => {
    if (typeof id === 'string') streams.retry(id)
  })
  ipcMain.on(IPC.devicesInput, (_e, id: unknown, input: unknown) => {
    if (typeof id !== 'string') return
    for (const message of controlMessages(input)) streams.input(id, message)
  })
  ipcMain.handle(IPC.devicesScreenshot, async (_e, png: unknown): Promise<InsertResult> => {
    if (!(png instanceof Uint8Array) || png.length === 0) return { error: 'There was no screenshot to add.' }
    try {
      const text = quotePath(await opts.saveImage(png), opts.platform)
      return text === null ? { error: "The screenshot's path can't be pasted safely." } : { text: `${text} ` }
    } catch (err) {
      return { error: `Couldn't save the screenshot for Claude: ${err instanceof Error ? err.message : String(err)}` }
    }
  })

  /** A new renderer (a reload, a crash) knows nothing of the old one's watches and views. */
  const forget = () => {
    streams.stopAll()
    if (watchers > 0) {
      watchers = 0
      stopWatching()
    }
  }

  return {
    attach(w) {
      if (win) throw new Error('registerDeviceIpc: attach() runs once')
      win = w
      w.webContents.on('did-start-loading', forget)
      w.webContents.on('render-process-gone', forget)
      // A locked screen or a sleeping Mac: nobody's watching, and the device may sleep. Waking with
      // a password fires resume, then unlock-screen: stream again only once unlocked.
      let locked = false
      powerMonitor.on('lock-screen', () => {
        locked = true
        streams.pause()
      })
      powerMonitor.on('unlock-screen', () => {
        locked = false
        streams.resume()
      })
      powerMonitor.on('suspend', () => streams.pause())
      powerMonitor.on('resume', () => {
        if (!locked) streams.resume()
      })
    },
    dispose() {
      streams.stopAll()
      generation++
      tracker?.stop()
      tracker = null
    },
  }
}
```

- [ ] **Step 4: Run the test to make sure it passes**

Run: `npx vitest run src/main/devices/ipc.test.ts`
Expected: PASS (4 tests).

- [ ] **Step 5: Screenshots go where pasted images go**

In `src/main/clipboard/ipc.ts`, add to the `ClipboardIpc` interface, after `dispose(): void`:

```ts
  /** Saves a PNG beside the pasted images (cleared at start and quit): the device panel's
   *  screenshots for Claude. Resolves with its path. */
  saveImage(png: Uint8Array): Promise<string>
```

and in the returned object, after the `dispose() { … },` method:

```ts
    saveImage: (png) => temp.save(png),
```

- [ ] **Step 6: Register it**

In `src/main/index.ts`, add the import after `import { externalUrl } from './external'`:

```ts
import { registerDeviceIpc } from './devices/ipc'
```

After the `const usage = registerUsageIpc({ … })` block, add:

```ts
  const devices = registerDeviceIpc({
    picksFile: join(userData, 'devices.json'),
    // scrcpy's server: in the app's resources when packaged, the repo's resources/ in a dev build.
    resources: app.isPackaged ? process.resourcesPath : join(app.getAppPath(), 'resources'),
    platform: process.platform as Platform,
    home: homedir(),
    env: process.env,
    saveImage: (png) => clip.saveImage(png),
  })
```

After `usage.attach(win)`, add `devices.attach(win)`. In the `will-quit` handler, after `usage.dispose()`, add `devices.dispose()`.

- [ ] **Step 7: Run everything**

Run: `npm run typecheck && npm test`
Expected: PASS.

- [ ] **Step 8: Commit**

```bash
git add src/main/devices/ipc.ts src/main/devices/ipc.test.ts src/main/clipboard/ipc.ts src/main/index.ts
git -c user.email=franco@effektstudios.com commit -m "Devices: main's wiring" -m "Claude-Session: https://claude.ai/code/session_012TidnAXmFkf7jwBCQQo4jJ"
```

---
### Task 11: The renderer's pure parts

**Files:**
- Create: `src/renderer/src/device/pick.ts`, `fit.ts`, `keys.ts`, `codec.ts`
- Test: `src/renderer/src/device/pick.test.ts`, `fit.test.ts`, `keys.test.ts`, `codec.test.ts`

- [ ] **Step 1: Write the failing tests**

Create `src/renderer/src/device/pick.test.ts`:

```ts
import { describe, expect, it } from 'vitest'
import type { DeviceInfo } from '@shared/types'
import { choosePanel, GONE_MS, panelView } from './pick'

const device = (id: string, name: string): DeviceInfo => ({ id, kind: id.startsWith('emulator:') ? 'emulator' : 'android', name, detail: '', state: 'ready' })
const c66 = device('android:8d2e61a', 'C66')
const s25 = device('android:R5CW20XY7QZ', "Franco's S25 FE")
const emu = device('emulator:Pixel_9', 'Pixel 9')

describe('choosePanel', () => {
  const base = { tab: undefined, project: null, android: true, byHand: false }

  it("shows the tab's pick, else the project's, while connected", () => {
    expect(choosePanel({ ...base, tab: s25.id, project: c66.id, devices: [c66, s25] })).toEqual({ kind: 'device', device: s25 })
    expect(choosePanel({ ...base, tab: s25.id, project: c66.id, devices: [c66] })).toEqual({ kind: 'device', device: c66 })
  })

  it('shows the only device that fits, asks among several, and shows nothing without one', () => {
    expect(choosePanel({ ...base, devices: [emu] })).toEqual({ kind: 'device', device: emu })
    expect(choosePanel({ ...base, devices: [c66, s25, emu] })).toEqual({ kind: 'choose', devices: [c66, s25, emu] })
    expect(choosePanel({ ...base, devices: [] })).toEqual({ kind: 'none' })
  })

  it('outside an Android app: only when asked for, or when the project picked a device', () => {
    expect(choosePanel({ ...base, android: false, devices: [c66] })).toEqual({ kind: 'none' })
    expect(choosePanel({ ...base, android: false, byHand: true, devices: [c66] })).toEqual({ kind: 'device', device: c66 })
    expect(choosePanel({ ...base, android: false, project: c66.id, devices: [c66, s25] })).toEqual({ kind: 'device', device: c66 })
  })
})

describe('panelView', () => {
  it('keeps a device that went away, as gone, for 10 s, then moves on', () => {
    const shown = panelView({ kind: 'device', device: c66 }, [c66, emu], null, 0)
    const gone = panelView({ kind: 'device', device: emu }, [emu], shown.held, 1000)
    expect(gone.view).toEqual({ kind: 'device', device: c66, gone: true })
    expect(panelView({ kind: 'device', device: emu }, [emu], gone.held, 1000 + GONE_MS - 1).view).toEqual({ kind: 'device', device: c66, gone: true })
    expect(panelView({ kind: 'device', device: emu }, [emu], gone.held, 1000 + GONE_MS).view).toEqual({ kind: 'device', device: emu, gone: false })
  })

  it('takes the device back when it returns in time', () => {
    const shown = panelView({ kind: 'device', device: c66 }, [c66], null, 0)
    const gone = panelView({ kind: 'none' }, [], shown.held, 100)
    expect(gone.view).toEqual({ kind: 'device', device: c66, gone: true })
    expect(panelView({ kind: 'device', device: c66 }, [c66], gone.held, 200).view).toEqual({ kind: 'device', device: c66, gone: false })
  })

  it('shows a new pick of a connected device at once', () => {
    const shown = panelView({ kind: 'device', device: c66 }, [c66, s25], null, 0)
    expect(panelView({ kind: 'device', device: s25 }, [c66, s25], shown.held, 1).view).toEqual({ kind: 'device', device: s25, gone: false })
  })
})
```

Create `src/renderer/src/device/fit.test.ts`:

```ts
import { describe, expect, it } from 'vitest'
import { fitSize, toFrame } from './fit'

describe('fitSize', () => {
  it('fits a tall screen by its height and a wide one by its width', () => {
    expect(fitSize({ width: 380, height: 572 }, { width: 1080, height: 2340 })).toEqual({ width: 264, height: 572 })
    expect(fitSize({ width: 380, height: 572 }, { width: 2340, height: 1080 })).toEqual({ width: 380, height: 175 })
  })

  it('nothing in an empty box', () => {
    expect(fitSize({ width: 0, height: 100 }, { width: 720, height: 1440 })).toEqual({ width: 0, height: 0 })
  })
})

describe('toFrame', () => {
  it('scales a point on the drawn screen to the frame, and keeps it inside', () => {
    expect(toFrame(132, 286, { width: 264, height: 572 }, { width: 1080, height: 2340 })).toEqual({ x: 540, y: 1170 })
    expect(toFrame(-5, 600, { width: 264, height: 572 }, { width: 1080, height: 2340 })).toEqual({ x: 0, y: 2339 })
  })
})
```

Create `src/renderer/src/device/keys.test.ts`:

```ts
import { describe, expect, it } from 'vitest'
import { deviceKey, KEYCODE, type KeyPress } from './keys'

const k = (key: string, mods: Partial<KeyPress> = {}): KeyPress => ({ key, shiftKey: false, ctrlKey: false, metaKey: false, altKey: false, ...mods })

describe('deviceKey', () => {
  it('editing and moving keys are Android key codes, with Shift', () => {
    expect(deviceKey(k('Enter'), 'darwin')).toEqual({ keycode: KEYCODE.ENTER, meta: 0 })
    expect(deviceKey(k('Backspace'), 'win32')).toEqual({ keycode: KEYCODE.DEL, meta: 0 })
    expect(deviceKey(k('ArrowLeft', { shiftKey: true }), 'darwin')).toEqual({ keycode: KEYCODE.DPAD_LEFT, meta: 1 })
  })

  it('typed characters are text, Option and AltGr ones included', () => {
    expect(deviceKey(k('a'), 'darwin')).toEqual({ text: 'a' })
    expect(deviceKey(k('A', { shiftKey: true }), 'darwin')).toEqual({ text: 'A' })
    expect(deviceKey(k('ø', { altKey: true }), 'darwin')).toEqual({ text: 'ø' })
    expect(deviceKey(k('@', { ctrlKey: true, altKey: true }), 'win32')).toEqual({ text: '@' })
  })

  it("Deck's shortcuts, dead keys and keys Android has no use for stay Deck's", () => {
    expect(deviceKey(k('v', { metaKey: true }), 'darwin')).toBeNull()
    expect(deviceKey(k('T', { ctrlKey: true, shiftKey: true }), 'win32')).toBeNull()
    expect(deviceKey(k('c', { ctrlKey: true }), 'darwin')).toBeNull()
    expect(deviceKey(k('Dead', { altKey: true }), 'darwin')).toBeNull()
    expect(deviceKey(k('F5'), 'darwin')).toBeNull()
    expect(deviceKey(k('a', { isComposing: true }), 'darwin')).toBeNull()
  })
})
```

Create `src/renderer/src/device/codec.test.ts`:

```ts
import { describe, expect, it } from 'vitest'
import { avcCodec, joined, nalUnits } from './codec'

describe('nalUnits', () => {
  it('splits on three- and four-byte start codes', () => {
    const data = new Uint8Array([0, 0, 0, 1, 0x67, 1, 2, 0, 0, 1, 0x68, 3, 0, 0, 0, 1, 0x65, 4])
    expect(nalUnits(data).map((nal) => [...nal])).toEqual([[0x67, 1, 2], [0x68, 3], [0x65, 4]])
  })
})

describe('avcCodec', () => {
  it("reads the profile, constraints and level from the SPS", () => {
    expect(avcCodec(new Uint8Array([0, 0, 0, 1, 0x67, 0x64, 0x00, 0x28, 0xac, 0, 0, 0, 1, 0x68, 0xee]))).toBe('avc1.640028')
    expect(avcCodec(new Uint8Array([0, 0, 0, 1, 0x68, 0xee]))).toBeNull()
  })
})

describe('joined', () => {
  it('puts the config in front of the key frame', () => {
    expect([...joined(new Uint8Array([1, 2]), new Uint8Array([3]))]).toEqual([1, 2, 3])
  })
})
```

- [ ] **Step 2: Run them to make sure they fail**

Run: `npx vitest run src/renderer/src/device`
Expected: FAIL: the four imports don't resolve.

- [ ] **Step 3: Which device a tab shows**

Create `src/renderer/src/device/pick.ts`:

```ts
import type { DeviceInfo } from '@shared/types'

export type PanelChoice =
  | { kind: 'device'; device: DeviceInfo }
  | { kind: 'choose'; devices: DeviceInfo[] }
  | { kind: 'none' }

export interface ChoiceInput {
  /** The tab's own pick. */
  tab: string | undefined
  /** The project's last pick. */
  project: string | null
  /** The project is an Android app. */
  android: boolean
  /** The panel was asked for (View → Device Panel), so every device fits. */
  byHand: boolean
  devices: DeviceInfo[]
}

/** The device a tab's panel shows: its own pick, else its project's, while connected; else the only
 *  device that fits. With several the panel asks; with none there's no panel. */
export function choosePanel({ tab, project, android, byHand, devices }: ChoiceInput): PanelChoice {
  const find = (id: string | null | undefined) => (id ? devices.find((d) => d.id === id) : undefined)
  const picked = find(tab) ?? find(project)
  if (picked) return { kind: 'device', device: picked }
  const fits = android || byHand ? devices : []
  if (fits.length === 1) return { kind: 'device', device: fits[0] }
  if (fits.length > 1) return { kind: 'choose', devices: fits }
  return { kind: 'none' }
}

/** How long a device that went away keeps its place. */
export const GONE_MS = 10_000

export type PanelView =
  | { kind: 'device'; device: DeviceInfo; gone: boolean }
  | { kind: 'choose'; devices: DeviceInfo[] }
  | { kind: 'none' }

/** The device shown last, and since when it's gone (null while it's connected). */
export interface Held {
  device: DeviceInfo
  goneSince: number | null
}

/** What the panel shows: the choice, except that a shown device that went away stays, as gone, for
 *  10 s, so a cable that wiggles doesn't move the pane. Also what to hold for next time. */
export function panelView(choice: PanelChoice, devices: DeviceInfo[], held: Held | null, now: number): { view: PanelView; held: Held | null } {
  if (held && !devices.some((d) => d.id === held.device.id)) {
    const goneSince = held.goneSince ?? now
    if (now - goneSince < GONE_MS) return { view: { kind: 'device', device: held.device, gone: true }, held: { device: held.device, goneSince } }
  }
  if (choice.kind === 'device') return { view: { kind: 'device', device: choice.device, gone: false }, held: { device: choice.device, goneSince: null } }
  return { view: choice, held: null }
}
```

- [ ] **Step 4: Letterboxing**

Create `src/renderer/src/device/fit.ts`:

```ts
export interface Box {
  width: number
  height: number
}

/** The largest size of the frame's shape that fits in the box, in whole CSS pixels. */
export function fitSize(box: Box, frame: Box): Box {
  if (box.width <= 0 || box.height <= 0 || frame.width <= 0 || frame.height <= 0) return { width: 0, height: 0 }
  const scale = Math.min(box.width / frame.width, box.height / frame.height)
  return {
    width: Math.max(1, Math.min(box.width, Math.round(frame.width * scale))),
    height: Math.max(1, Math.min(box.height, Math.round(frame.height * scale))),
  }
}

/** A point on the drawn screen (CSS px from its top-left corner) as a pixel of the frame, inside it. */
export function toFrame(x: number, y: number, drawn: Box, frame: Box): { x: number; y: number } {
  const inside = (v: number, size: number) => Math.min(Math.max(v, 0), size - 1)
  return {
    x: inside(Math.round((x / drawn.width) * frame.width), frame.width),
    y: inside(Math.round((y / drawn.height) * frame.height), frame.height),
  }
}
```

- [ ] **Step 5: Keys**

Create `src/renderer/src/device/keys.ts`:

```ts
import type { Platform } from '@shared/types'

/** Android key codes (android.view.KeyEvent). */
export const KEYCODE = {
  HOME: 3, BACK: 4, DPAD_UP: 19, DPAD_DOWN: 20, DPAD_LEFT: 21, DPAD_RIGHT: 22, POWER: 26, TAB: 61,
  ENTER: 66, DEL: 67, PAGE_UP: 92, PAGE_DOWN: 93, ESCAPE: 111, FORWARD_DEL: 112, MOVE_HOME: 122,
  MOVE_END: 123, APP_SWITCH: 187,
} as const

/** Android's meta state (KeyEvent.META_SHIFT_ON, META_ALT_ON). */
const META_SHIFT = 0x1
const META_ALT = 0x2

const KEYS: Record<string, number> = {
  Enter: KEYCODE.ENTER, Backspace: KEYCODE.DEL, Delete: KEYCODE.FORWARD_DEL, Tab: KEYCODE.TAB,
  Escape: KEYCODE.ESCAPE, ArrowUp: KEYCODE.DPAD_UP, ArrowDown: KEYCODE.DPAD_DOWN,
  ArrowLeft: KEYCODE.DPAD_LEFT, ArrowRight: KEYCODE.DPAD_RIGHT, Home: KEYCODE.MOVE_HOME,
  End: KEYCODE.MOVE_END, PageUp: KEYCODE.PAGE_UP, PageDown: KEYCODE.PAGE_DOWN,
}

export interface KeyPress {
  key: string
  shiftKey: boolean
  ctrlKey: boolean
  metaKey: boolean
  altKey: boolean
  isComposing?: boolean
}

/** What a key pressed on the device's screen sends: an Android key code (Return, Backspace, the
 *  arrows …) with Shift and Alt, or a typed character as text. null leaves the key to Deck: Cmd
 *  shortcuts, Ctrl ones (but Ctrl+Alt off macOS is AltGr, which types), dead keys while composing,
 *  and keys Android has no use for. */
export function deviceKey(e: KeyPress, platform: Platform): { keycode: number; meta: number } | { text: string } | null {
  if (e.isComposing || e.metaKey) return null
  const altGr = platform !== 'darwin' && e.ctrlKey && e.altKey
  if (e.ctrlKey && !altGr) return null
  const keycode = KEYS[e.key]
  if (keycode !== undefined) return { keycode, meta: (e.shiftKey ? META_SHIFT : 0) | (e.altKey && !altGr ? META_ALT : 0) }
  // One character ("a", "ø", "@"); named keys ("F5", "Dead") are longer.
  return [...e.key].length === 1 ? { text: e.key } : null
}
```

- [ ] **Step 6: The codec string**

Create `src/renderer/src/device/codec.ts`:

```ts
/** The NAL units of an Annex B buffer, each after a 00 00 01 or 00 00 00 01 start code. */
export function nalUnits(data: Uint8Array): Uint8Array[] {
  const starts: number[] = []
  for (let i = 0; i + 2 < data.length; i++) {
    if (data[i] === 0 && data[i + 1] === 0 && data[i + 2] === 1) {
      starts.push(i + 3)
      i += 2
    }
  }
  return starts.map((start, n) => {
    if (n + 1 === starts.length) return data.subarray(start)
    let end = starts[n + 1] - 3
    if (end > start && data[end - 1] === 0) end-- // the extra zero of a four-byte start code
    return data.subarray(start, end)
  })
}

const hex2 = (n: number) => n.toString(16).padStart(2, '0')

/** WebCodecs' codec string for the H.264 stream a config packet opens: avc1.PPCCLL (profile,
 *  constraint flags and level, from its SPS); null when it holds no SPS. */
export function avcCodec(config: Uint8Array): string | null {
  for (const nal of nalUnits(config)) {
    if ((nal[0] & 0x1f) === 7 && nal.length >= 4) return `avc1.${hex2(nal[1])}${hex2(nal[2])}${hex2(nal[3])}`
  }
  return null
}

/** `a` then `b` in one buffer: a key frame with the config (SPS, PPS) in front, as the decoder takes it. */
export function joined(a: Uint8Array, b: Uint8Array): Uint8Array {
  const out = new Uint8Array(a.length + b.length)
  out.set(a, 0)
  out.set(b, a.length)
  return out
}
```

- [ ] **Step 7: Run the tests to make sure they pass**

Run: `npx vitest run src/renderer/src/device`
Expected: PASS (14 tests).

- [ ] **Step 8: Commit**

```bash
git add src/renderer/src/device/
git -c user.email=franco@effektstudios.com commit -m "Device panel: which device a tab shows, letterboxing, keys and the codec string" -m "Claude-Session: https://claude.ai/code/session_012TidnAXmFkf7jwBCQQo4jJ"
```

**After review (commit `99b052b`), the code above changed:**
- `Held` also keeps the pick in force (`pick: string | null`), and `panelView(choice, devices, held, now, pick)`
  takes the tab's pick (else the project's, else null). A new pick ends a hold at once. While the pick
  is unchanged, a shown device that's still connected stays when a second arrives (the menu switches).
- `fitSize` floors the box first, so sizes are whole CSS px for fractional boxes.
- `avcCodec` masks the constraint byte's two reserved bits.
- `deviceKey`:
  - macOS: Option+Backspace/Delete/←/→ go with Android's Ctrl (`META_CTRL_ON`, 0x1000), since they're
    word-wise and Android's Alt works by line. Cmd+←/→ go to `MOVE_HOME`/`MOVE_END`.
  - Off macOS: `KeyPress.altGraph` (from `getModifierState('AltGraph')`, else Ctrl+Alt) tells AltGr from
    Alt. An Alt combination that isn't AltGr types nothing.

---

### Task 11b: The first list waits for its devices

**Files:**
- Modify: `src/main/devices/android/tracker.ts`, `src/main/devices/android/tracker.test.ts`
- Modify: `src/main/devices/ipc.ts`, `src/main/devices/ipc.test.ts`
- Modify: `src/shared/types.ts` (`DeckApi.devices.list`)

A device joins the list once it has said what it is, so right after adb's tracking starts (or
restarts) the list grows one device at a time. A project with the emulator and the S25 and no pick
would show whichever answered first, and keep showing it (`panelView` keeps a shown device when a
second one arrives). And until the first list main answers `list()` with "no devices", so a panel
shown by hand says "No devices connected" while adb is still starting. From now on the first list
after each start waits for every ready device's first answer (3 s at most), and `list()` answers
null until it's there.

- [ ] **Step 1: Write the failing tests**

In `src/main/devices/android/tracker.test.ts`, after the `c66` constant, add:

```ts
const EMULATOR = 'emulator-5554 device product:sdk_gphone64_arm64 model:sdk_gphone64_arm64 device:emu64a transport_id:2\n'
const emu: Identity = { serialNo: 'EMULATOR37X2X12X0', maker: 'Google', model: 'sdk_gphone64_arm64', release: '15', avd: 'Pixel_9', name: 'sdk_gphone64_arm64', booted: true }
```

Replace the test `'keeps tracking when publish throws, and the next publish tries again'` with:

```ts
  it('keeps tracking when publish throws, and the next publish tries again', async () => {
    vi.useFakeTimers()
    const errorSpy = vi.spyOn(console, 'error').mockImplementation(() => {})
    const calls: { devices: DeviceInfo[]; error: string | null }[] = []
    let first = true
    const { tracker, children } = setup(async () => c66, (devices, error) => {
      if (first) {
        first = false
        throw new Error('boom')
      }
      calls.push({ devices, error })
    })
    tracker.start()
    // No device to wait for: the first list goes out at once, and that publish throws.
    children[0].stdout.emit('data', frame(''))
    expect(errorSpy).toHaveBeenCalledWith('devices: publishing the list failed', expect.any(Error))
    children[0].stdout.emit('data', frame(C66))
    await vi.advanceTimersByTimeAsync(0)
    expect(calls.at(-1)?.devices.map((d) => d.name)).toEqual(['C66'])
    // The throw didn't look like adb dying: no restart.
    expect(children).toHaveLength(1)
    tracker.stop()
    errorSpy.mockRestore()
  })
```

Replace the test `'tries again even when the repeated state is identical, since a failed publish leaves lastPublished unset'` with:

```ts
  it('tries again even when the repeated state is identical, since a failed publish leaves lastPublished unset', () => {
    vi.useFakeTimers()
    const errorSpy = vi.spyOn(console, 'error').mockImplementation(() => {})
    const calls: { devices: DeviceInfo[]; error: string | null }[] = []
    let first = true
    const { tracker, children } = setup(async () => c66, (devices, error) => {
      if (first) {
        first = false
        throw new Error('boom')
      }
      calls.push({ devices, error })
    })
    tracker.start()
    // The same empty list twice: the second is published, since the first never was.
    children[0].stdout.emit('data', frame(''))
    children[0].stdout.emit('data', frame(''))
    expect(calls).toEqual([{ devices: [], error: null }])
    tracker.stop()
    errorSpy.mockRestore()
  })
```

Before `it('keeps a phone listed, as connecting, while its first ask is in flight', …)`, add:

```ts
  it('holds the first list until every ready device has answered once', async () => {
    vi.useFakeTimers()
    let answerEmulator: (identity: Identity) => void = () => {}
    const identify = vi.fn((serial: string) =>
      serial === '8d2e61a' ? Promise.resolve(c66) : new Promise<Identity>((resolve) => { answerEmulator = resolve }))
    const { tracker, children, published } = setup(identify)
    tracker.start()
    children[0].stdout.emit('data', frame(C66 + EMULATOR))
    await vi.advanceTimersByTimeAsync(0)
    // The C66 has answered, the emulator not yet: nothing goes out, not even an empty list.
    expect(published).toEqual([])
    answerEmulator(emu)
    await vi.advanceTimersByTimeAsync(0)
    expect(published.map((p) => p.devices.map((d) => d.id))).toEqual([['android:8d2e61a', 'emulator:Pixel_9']])
    tracker.stop()
  })

  it('publishes the first list after 3 s without a device that is slow to answer', async () => {
    vi.useFakeTimers()
    const identify = vi.fn((serial: string) => (serial === '8d2e61a' ? Promise.resolve(c66) : new Promise<Identity>(() => {})))
    const { tracker, children, published } = setup(identify)
    tracker.start()
    children[0].stdout.emit('data', frame(C66 + EMULATOR))
    await vi.advanceTimersByTimeAsync(2999)
    expect(published).toEqual([])
    await vi.advanceTimersByTimeAsync(1)
    expect(published.map((p) => p.devices.map((d) => d.id))).toEqual([['android:8d2e61a']])
    tracker.stop()
  })

  it('publishes the first list once a first ask fails, without that device', async () => {
    vi.useFakeTimers()
    const identify = vi.fn(async (): Promise<Identity> => {
      throw new Error('closed')
    })
    const { tracker, children, published } = setup(identify)
    tracker.start()
    children[0].stdout.emit('data', frame(C66))
    expect(published).toEqual([])
    await vi.advanceTimersByTimeAsync(0)
    expect(published).toEqual([{ devices: [], error: null }])
    tracker.stop()
  })

  it('waits for the devices again after adb restarts', async () => {
    vi.useFakeTimers()
    let answer: (identity: Identity) => void = () => {}
    const identify = vi.fn(() => new Promise<Identity>((resolve) => { answer = resolve }))
    const { tracker, children, published } = setup(identify)
    tracker.start()
    children[0].stdout.emit('data', frame(''))
    expect(published).toEqual([{ devices: [], error: null }])
    children[0].emit('close', 1)
    expect(published.at(-1)?.error).toBeTruthy()
    const before = published.length
    await vi.advanceTimersByTimeAsync(20) // restartMin
    children[1].stdout.emit('data', frame(C66))
    await vi.advanceTimersByTimeAsync(0)
    expect(published).toHaveLength(before)
    answer(c66)
    await vi.advanceTimersByTimeAsync(0)
    expect(published).toHaveLength(before + 1)
    expect(published.at(-1)).toEqual({ devices: [expect.objectContaining({ name: 'C66' })], error: null })
    tracker.stop()
  })
```

In `src/main/devices/ipc.test.ts`, replace the first test with:

```ts
  it("answers null until the first list, says so when adb can't be found, and forgets it when nothing needs devices", async () => {
    expect(await call<DeviceList | null>(IPC.devicesList)).toBeNull()
    emit(IPC.devicesWatch)
    await vi.waitFor(() => expect(sent.at(-1)).toEqual([IPC.devicesChanged, [{ devices: [], problem: 'no-adb' }]]))
    expect(await call<DeviceList | null>(IPC.devicesList)).toEqual({ devices: [], problem: 'no-adb' })
    const pushes = sent.length
    emit(IPC.devicesUnwatch)
    // Nobody listens any more: nothing is pushed, and the list is unknown again.
    expect(sent).toHaveLength(pushes)
    expect(await call<DeviceList | null>(IPC.devicesList)).toBeNull()
  })
```

In the test `"a reload forgets the watches: devices:watch publishes no-adb again, and the old page's late unwatch does nothing"`,
replace its body with:

```ts
    emit(IPC.devicesWatch)
    await vi.waitFor(() => expect(sent.at(-1)).toEqual([IPC.devicesChanged, [{ devices: [], problem: 'no-adb' }]]))

    win.webContents.emit('did-start-loading')
    expect(await call<DeviceList | null>(IPC.devicesList)).toBeNull()

    const pushes = sent.length
    emit(IPC.devicesUnwatch) // the old page's effect cleanup, arriving late: watchers is already 0
    expect(sent).toHaveLength(pushes)

    emit(IPC.devicesWatch) // the new page watches again
    await vi.waitFor(() => expect(sent.at(-1)).toEqual([IPC.devicesChanged, [{ devices: [], problem: 'no-adb' }]]))
    emit(IPC.devicesUnwatch) // leave watchers at 0 for later tests
```

(Any other assertion in `ipc.test.ts` that expects `{ devices: [], problem: null }` to be pushed when
watching stops changes the same way: nothing is pushed, and `devices:list` answers null.)

- [ ] **Step 2: Run them to make sure they fail**

Run: `npx vitest run src/main/devices`
Expected: FAIL: the tracker publishes an empty list at the first frame and before each device has
answered, and `devices:list` answers `{ devices: [], problem: null }` rather than null.

- [ ] **Step 3: The tracker holds its first list**

In `src/main/devices/android/tracker.ts`:

Add to `TrackerDeps`, after `retryMs`:

```ts
  /** ms the first list after a (re)start waits at most for every ready device's first answer;
   *  tests shorten it. */
  settleMs?: number
```

After `const BOOT_TRIES = 40`, add:

```ts
/** After track-devices (re)starts, the first list waits this long at most for its devices' answers. */
const SETTLE_MS = 3000
```

Add a field after `private lastPublished = ''`:

```ts
  /** Since track-devices (re)started, until every ready device has answered once (or SETTLE_MS has
   *  passed): the list isn't published yet, so it holds every device that answers in time rather
   *  than growing one at a time. A project with two devices would otherwise show whichever answered
   *  first. */
  private settling = false
```

In `spawn()`, right after `this.child = child`, add:

```ts
    this.settling = true
    this.later(this.deps.settleMs ?? SETTLE_MS, () => {
      if (this.child !== child || !this.settling) return
      this.settling = false
      this.publish(null)
    })
```

In `ask()`'s failure handler, replace:

```ts
        if (++asked.tries >= IDENTITY_TRIES) return this.publish(null)
        this.askLater(key, asked, this.retry.identity)
```

with:

```ts
        if (++asked.tries >= IDENTITY_TRIES) return this.publish(null)
        // A first list held for this answer goes out without the device.
        if (this.settling) this.publish(null)
        this.askLater(key, asked, this.retry.identity)
```

At the top of `publish(error)`, before `const seen: Seen[] = []`, add:

```ts
    if (this.settling) {
      if (error === null && this.firstAsks()) return
      this.settling = false
    }
```

and after `publish()`, add:

```ts
  /** A ready device hasn't answered its first ask yet. */
  private firstAsks(): boolean {
    return this.entries.some((entry) => {
      const asked = this.asked.get(keyOf(entry))
      return entry.state === 'device' && !asked?.identity && (asked?.tries ?? 0) === 0
    })
  }
```

Update the class comment's first sentence to: "Follows the Android devices adb sees with one
long-running `adb track-devices -l`, and asks each connected device once what it is (again while it's
still starting up); after each start, the first list waits for every ready device's first answer (3 s
at most)."

- [ ] **Step 4: Main's list is null until the first**

In `src/main/devices/ipc.ts`:

Remove `const NOTHING: DeviceList = { devices: [], problem: null }` and change `let list: DeviceList = NOTHING` to:

```ts
  /** null until the first list after watching starts, and again once nothing watches: a tab waits
   *  for the list rather than taking "no devices" for an answer. */
  let list: DeviceList | null = null
```

In `stopWatching`, replace `publish(NOTHING)` with `list = null` (no push: every tab that watched has
stopped listening).

In the `IPC.devicesView` listener, change `list.devices.some(` to `list?.devices.some(`.

In `src/shared/types.ts`, in `DeckApi.devices`, replace:

```ts
    /** The devices now. */
    list(): Promise<DeviceList>
```

with:

```ts
    /** The devices now; null while Deck is still looking (adb starting, or devices still saying what
     *  they are): the list is pushed when it's there. */
    list(): Promise<DeviceList | null>
```

- [ ] **Step 5: Run the tests**

Run: `npx vitest run src/main/devices && npm run typecheck`
Expected: PASS. (`src/preload/index.ts` passes `list` through `ipcRenderer.invoke` unchanged.)

- [ ] **Step 6: Commit**

```bash
git add src/main/devices/android/tracker.ts src/main/devices/android/tracker.test.ts src/main/devices/ipc.ts src/main/devices/ipc.test.ts src/shared/types.ts
git -c user.email=franco@effektstudios.com commit -m "Devices: the first list waits for its devices; list() is null until then" -m "Claude-Session: https://claude.ai/code/session_012TidnAXmFkf7jwBCQQo4jJ"
```

---

### Task 12: The screen

**Files:**
- Create: `src/renderer/src/device/DeviceScreen.tsx`

The canvas, the decoder and input need a real window: this task is checked by typecheck and build
here, and on the devices in Task 15.

- [ ] **Step 1: Write the component**

Create `src/renderer/src/device/DeviceScreen.tsx`:

```tsx
import { type ClipboardEvent, type KeyboardEvent, type PointerEvent as ReactPointerEvent, type Ref, useCallback, useEffect, useImperativeHandle, useLayoutEffect, useRef, useState, type WheelEvent } from 'react'
import type { DeviceInput, DeviceStreamEvent } from '@shared/types'
import { avcCodec, joined } from './codec'
import { type Box, fitSize, toFrame } from './fit'
import { deviceKey } from './keys'

export interface ScreenHandle {
  /** The screen now, as a PNG at the stream's size; null before the first picture. */
  screenshot(): Promise<Uint8Array | null>
}

interface DeviceScreenProps {
  deviceId: string
  name: string
  /** Stream now: the tab is in front, the panel unfolded, the window visible, the device ready. */
  live: boolean
  /** Why the device can't be shown (gone, not allowed, offline), over the dimmed last picture. */
  message: string | null
  handle?: Ref<ScreenHandle>
}

type StreamState = Extract<DeviceStreamEvent, { type: 'state' }>

/** More frames than this waiting to be decoded: skip to the next key frame. */
const MAX_QUEUE = 10
/** The decoder wants increasing timestamps, not real ones. */
const FRAME_US = 16_667

/** The window's pixel ratio, which changes when the window moves to a display with another scale
 *  (or zooms). */
function usePixelRatio(): number {
  const [ratio, setRatio] = useState(() => window.devicePixelRatio || 1)
  useEffect(() => {
    // The query matches only the ratio it was made for: a change ends the match, and the new ratio
    // makes a new query.
    const query = window.matchMedia(`(resolution: ${ratio}dppx)`)
    const update = () => setRatio(window.devicePixelRatio || 1)
    query.addEventListener('change', update)
    return () => query.removeEventListener('change', update)
  }, [ratio])
  return ratio
}

/** One device's screen: its stream decoded with WebCodecs onto a canvas that fits the space, and
 *  the pointer and keyboard sent back as touches, scrolls, keys and text. */
export function DeviceScreen({ deviceId, name, live, message, handle }: DeviceScreenProps) {
  const platform = window.deck.platform
  const ratio = usePixelRatio()
  const areaRef = useRef<HTMLDivElement>(null)
  const canvasRef = useRef<HTMLCanvasElement>(null)
  const [area, setArea] = useState<Box>({ width: 0, height: 0 })
  const [size, setSize] = useState<Box | null>(null)
  const [stream, setStream] = useState<StreamState>({ type: 'state', state: 'connecting' })
  /** The frame size touches are made for: scrcpy ignores a touch made for another size. */
  const sizeRef = useRef<Box | null>(null)
  const decoder = useRef<VideoDecoder | null>(null)
  const codec = useRef('')
  const config = useRef<Uint8Array | null>(null)
  const waitKey = useRef(true)
  /** The latest picture, kept for redraws and screenshots; each one before it is closed. */
  const frame = useRef<VideoFrame | null>(null)
  const timestamp = useRef(0)
  const touching = useRef(false)
  /** The last touch's point on the frame, to lift it there. */
  const lastTouch = useRef<{ x: number; y: number } | null>(null)

  const draw = useCallback(() => {
    const canvas = canvasRef.current
    const picture = frame.current
    if (!canvas || !picture || canvas.width === 0) return
    canvas.getContext('2d')?.drawImage(picture, 0, 0, canvas.width, canvas.height)
  }, [])

  const closeDecoder = useCallback(() => {
    const d = decoder.current
    decoder.current = null
    codec.current = ''
    waitKey.current = true
    if (d && d.state !== 'closed') d.close()
  }, [])

  /** The frame changed size (the screen turned) under a touch: lift it at its last point, once for
   *  each size. scrcpy drops a touch made for another size than its own, and may switch before or
   *  after it says so. The pointer is then ignored until it's released. */
  const lift = useCallback((sizes: Box[]) => {
    const point = lastTouch.current
    if (!touching.current || !point) return
    touching.current = false
    for (const { width, height } of sizes) {
      const x = Math.min(point.x, width - 1)
      const y = Math.min(point.y, height - 1)
      window.deck.devices.input(deviceId, { type: 'touch', action: 'up', x, y, width, height })
    }
  }, [deviceId])

  useLayoutEffect(() => {
    const el = areaRef.current
    if (!el) return
    const observer = new ResizeObserver(([entry]) => {
      const { width, height } = entry.contentRect
      setArea((a) => (a.width === width && a.height === height ? a : { width, height }))
    })
    observer.observe(el)
    return () => observer.disconnect()
  }, [])

  const drawn = size ? fitSize(area, size) : null
  // The canvas holds the drawn size at the window's pixel ratio, so the picture stays sharp.
  useLayoutEffect(() => {
    const canvas = canvasRef.current
    if (!canvas || !drawn) return
    canvas.width = Math.round(drawn.width * ratio)
    canvas.height = Math.round(drawn.height * ratio)
    draw()
  }, [drawn?.width, drawn?.height, ratio, draw])

  // Viewing: main streams the device while any tab views it, and sends its news.
  useEffect(() => {
    if (!live) return
    const keyframe = () => window.deck.devices.keyframe(deviceId)
    const configure = (next: string) => {
      closeDecoder()
      const d = new VideoDecoder({
        output: (picture) => {
          frame.current?.close()
          frame.current = picture
          draw()
        },
        error: (err) => {
          console.error(`${deviceId}: the decoder failed`, err)
          if (decoder.current !== d) return
          closeDecoder()
          keyframe() // a new session follows: config, then a key frame
        },
      })
      d.configure({ codec: next, optimizeForLatency: true })
      decoder.current = d
      codec.current = next
    }
    const off = window.deck.devices.onStream((id, event) => {
      if (id !== deviceId) return
      if (event.type === 'state') return setStream(event)
      if (event.type === 'size') {
        const next = { width: event.width, height: event.height }
        const before = sizeRef.current
        sizeRef.current = next
        if (before && (before.width !== next.width || before.height !== next.height)) lift([before, next])
        setSize((s) => (s && s.width === next.width && s.height === next.height ? s : next))
        return
      }
      if (event.config) {
        config.current = event.data
        const next = avcCodec(event.data)
        if (next && (next !== codec.current || !decoder.current)) configure(next)
        waitKey.current = true
        return
      }
      const d = decoder.current
      if (!d || d.state !== 'configured' || (waitKey.current && !event.key)) return
      if (d.decodeQueueSize > MAX_QUEUE) {
        waitKey.current = true
        return keyframe()
      }
      try {
        d.decode(new EncodedVideoChunk({
          type: event.key ? 'key' : 'delta',
          timestamp: (timestamp.current += FRAME_US),
          data: event.key && config.current ? joined(config.current, event.data) : event.data,
        }))
        if (event.key) waitKey.current = false
      } catch (err) {
        console.error(`${deviceId}: a frame couldn't be decoded`, err)
        closeDecoder()
        keyframe()
      }
    })
    // Listening before viewing: main answers a view at once with the size and state it knows.
    const stopViewing = window.deck.devices.view(deviceId)
    return () => {
      stopViewing()
      off()
      closeDecoder() // the last picture stays until the stream comes back
    }
  }, [deviceId, live, draw, closeDecoder, lift])

  useEffect(() => () => {
    frame.current?.close()
    frame.current = null
  }, [])

  useImperativeHandle(handle, () => ({
    async screenshot() {
      const picture = frame.current
      if (!picture) return null
      const canvas = new OffscreenCanvas(picture.displayWidth, picture.displayHeight)
      canvas.getContext('2d')?.drawImage(picture, 0, 0)
      const blob = await canvas.convertToBlob({ type: 'image/png' })
      return new Uint8Array(await blob.arrayBuffer())
    },
  }), [])

  const interactive = live && !message
  const send = (input: DeviceInput) => window.deck.devices.input(deviceId, input)
  /** Where the pointer is, in the frame's pixels, with the frame's size. */
  const at = (e: { clientX: number; clientY: number; currentTarget: Element }) => {
    const frameSize = sizeRef.current
    const r = e.currentTarget.getBoundingClientRect()
    if (!frameSize || r.width === 0 || r.height === 0) return null
    return { ...toFrame(e.clientX - r.left, e.clientY - r.top, { width: r.width, height: r.height }, frameSize), ...frameSize }
  }
  const touch = (action: 'down' | 'move' | 'up', e: ReactPointerEvent<HTMLCanvasElement>) => {
    const point = at(e)
    if (!point) return
    lastTouch.current = { x: point.x, y: point.y }
    send({ type: 'touch', action, ...point })
  }
  const onPointerDown = (e: ReactPointerEvent<HTMLCanvasElement>) => {
    if (!interactive || e.button !== 0) return
    e.currentTarget.focus()
    e.currentTarget.setPointerCapture(e.pointerId)
    touching.current = true
    touch('down', e)
  }
  const onPointerMove = (e: ReactPointerEvent<HTMLCanvasElement>) => {
    if (touching.current) touch('move', e)
  }
  const onPointerEnd = (e: ReactPointerEvent<HTMLCanvasElement>) => {
    if (!touching.current) return
    touching.current = false
    touch('up', e)
  }
  const onWheel = (e: WheelEvent<HTMLCanvasElement>) => {
    const point = at(e)
    if (!interactive || !point) return
    // About one step per wheel notch: 100 px, 3 lines or a page. Android scrolls right for a
    // positive dx, as the wheel's deltaX does, but up for a positive dy, against its deltaY.
    const unit = e.deltaMode === 1 ? 3 : e.deltaMode === 2 ? 1 : 100
    const step = (delta: number) => Math.max(-16, Math.min(16, delta / unit))
    send({ type: 'scroll', ...point, dx: step(e.deltaX), dy: step(-e.deltaY) })
  }
  const onKeyDown = (e: KeyboardEvent<HTMLCanvasElement>) => {
    if (!interactive) return
    // Off macOS there's no Edit menu to paste with: Ctrl+V and Ctrl+Shift+V paste here.
    if (platform !== 'darwin' && e.ctrlKey && !e.altKey && !e.metaKey && e.code === 'KeyV') {
      e.preventDefault()
      window.deck.clipboard.paste({ claude: false }).then((result) => {
        if (result && 'text' in result && result.text) send({ type: 'paste', text: result.text })
      }, () => {})
      return
    }
    // Built by hand: a KeyboardEvent says whether AltGr is held only through getModifierState.
    const native = e.nativeEvent
    const key = deviceKey({
      key: native.key, shiftKey: native.shiftKey, ctrlKey: native.ctrlKey, metaKey: native.metaKey, altKey: native.altKey,
      altGraph: native.getModifierState('AltGraph'), isComposing: native.isComposing,
    }, platform)
    if (!key) return
    e.preventDefault()
    send('keycode' in key ? { type: 'key', ...key } : { type: 'text', text: key.text })
  }
  // macOS: Cmd+V is the Edit menu's paste, which fires here while the screen has the keyboard.
  const onPaste = (e: ClipboardEvent<HTMLCanvasElement>) => {
    const text = e.clipboardData.getData('text/plain')
    if (!interactive || !text) return
    e.preventDefault()
    send({ type: 'paste', text })
  }

  const dim = message !== null || (live && stream.state !== 'live')
  return (
    <div className="dp-area" ref={areaRef}>
      {drawn && (
        <canvas ref={canvasRef} className={dim ? 'dp-screen dim' : 'dp-screen'} tabIndex={interactive ? 0 : -1}
          aria-label={`${name}'s screen`} style={{ width: drawn.width, height: drawn.height }}
          onPointerDown={onPointerDown} onPointerMove={onPointerMove} onPointerUp={onPointerEnd}
          onPointerCancel={onPointerEnd} onLostPointerCapture={onPointerEnd} onWheel={onWheel}
          onKeyDown={onKeyDown} onPaste={onPaste} onContextMenu={(e) => e.preventDefault()} />
      )}
      {message ? (
        <div className="dp-overlay" role="status"><strong>{message}</strong></div>
      ) : live && stream.state === 'error' ? (
        <div className="dp-overlay error" role="alert">
          <strong>Couldn't show {name}</strong>
          {stream.message && <span className="dp-overlay-detail">{stream.message}</span>}
          <button className="button" onClick={() => window.deck.devices.retry(deviceId)}>Try again</button>
        </div>
      ) : live && stream.state !== 'live' ? (
        <div className="dp-overlay" role="status">
          <span className="cp-spinner" aria-hidden="true" />
          {stream.state === 'reconnecting' ? 'Reconnecting…' : `Connecting to ${name}…`}
        </div>
      ) : null}
    </div>
  )
}
```

- [ ] **Step 2: Typecheck**

Run: `npm run typecheck`
Expected: PASS.

- [ ] **Step 3: Commit**

```bash
git add src/renderer/src/device/DeviceScreen.tsx
git -c user.email=franco@effektstudios.com commit -m "Device panel: the screen, decoded with WebCodecs, with touch and keys" -m "Claude-Session: https://claude.ai/code/session_012TidnAXmFkf7jwBCQQo4jJ"
```

---

### Task 13: The panel

**Files:**
- Create: `src/renderer/src/device/useDevices.ts`
- Create: `src/renderer/src/device/DeviceMenu.tsx`
- Create: `src/renderer/src/device/DevicePanel.tsx`
- Create: `src/renderer/src/device/device.css`
- Modify: `src/renderer/src/hooks.ts` (add `usePageVisible`)
- Modify: `src/renderer/src/icons.tsx` (add five icons)
- Modify: `src/renderer/src/claude/SessionPicker.tsx` (export `placeBelow`)

- [ ] **Step 1: Hooks**

Append to `src/renderer/src/hooks.ts`:

```ts
/** The window can be seen: not minimized, hidden or fully covered (the page's visibility). */
export function usePageVisible(): boolean {
  const [visible, setVisible] = useState(() => document.visibilityState === 'visible')
  useEffect(() => {
    const update = () => setVisible(document.visibilityState === 'visible')
    document.addEventListener('visibilitychange', update)
    return () => document.removeEventListener('visibilitychange', update)
  }, [])
  return visible
}
```

Create `src/renderer/src/device/useDevices.ts`:

```ts
import { useCallback, useEffect, useLayoutEffect, useRef, useState } from 'react'
import type { DeviceInfo, DeviceList, DeviceProject } from '@shared/types'
import { GONE_MS, type Held, type PanelChoice, type PanelView, panelView } from './pick'

const NONE: PanelView = { kind: 'none' }

/** The devices Deck sees while `needed` (main runs adb only while some tab needs it); null until
 *  main has its first list. */
export function useDeviceList(needed: boolean): DeviceList | null {
  const [list, setList] = useState<DeviceList | null>(null)
  useEffect(() => {
    if (!needed) return
    let live = true
    let pushed = false
    const stop = window.deck.devices.watch()
    // A push can arrive before list()'s answer: once one has, it's the newer.
    const off = window.deck.devices.onList((next) => {
      pushed = true
      setList(next)
    })
    window.deck.devices.list().then((now) => {
      if (live && !pushed && now) setList(now)
    }, () => {})
    return () => {
      live = false
      off()
      stop()
      setList(null)
    }
  }, [needed])
  return list
}

/** The tab's project for the device panel (null until known), read again whenever the tab comes to
 *  the front, as another tab may have picked the project's device meanwhile; and how to pick one. */
export function useDeviceProject(folder: string, active: boolean): [DeviceProject | null, (id: string) => void] {
  const [project, setProject] = useState<DeviceProject | null>(null)
  const current = useRef(project)
  useLayoutEffect(() => {
    current.current = project
  }, [project])
  useEffect(() => {
    if (!folder || !active) return
    let live = true
    window.deck.devices.project(folder).then(
      (next) => {
        if (live) setProject(next)
      },
      (err: unknown) => {
        if (!live) return
        console.error('device panel: reading the project failed', err)
        setProject(null)
      },
    )
    return () => {
      live = false
    }
  }, [folder, active])
  const pick = useCallback((id: string) => {
    const p = current.current
    if (!p) return
    setProject({ ...p, pick: id })
    window.deck.devices.pick(p.root, id).catch((err: unknown) => console.error('device panel: saving the pick failed', err))
  }, [])
  return [project, pick]
}

/** The panel's view (panelView): a shown device that went away stays, as gone, for 10 s, unless the
 *  tab picks another device (`pick`: the tab's, else the project's) or moves to another project
 *  (`root`). Nothing while `choice` is null: the project or the devices aren't known yet. */
export function useHeldView(choice: PanelChoice | null, devices: DeviceInfo[], root: string | null, pick: string | null): PanelView {
  const held = useRef<{ root: string | null; held: Held | null }>({ root: null, held: null })
  const [, rerender] = useState(0)
  const kept = held.current.root === root ? held.current.held : null
  const result = choice ? panelView(choice, devices, kept, Date.now(), pick) : { view: NONE, held: null }
  // Written while rendering: for the same inputs panelView answers the same, so a render React runs
  // twice (StrictMode) or throws away holds the same device since the same moment.
  held.current = { root, held: result.held }
  const goneSince = result.held?.goneSince ?? null
  useEffect(() => {
    if (goneSince === null) return
    const timer = setTimeout(() => rerender((n) => n + 1), Math.max(0, goneSince + GONE_MS - Date.now()))
    return () => clearTimeout(timer)
  }, [goneSince])
  return result.view
}
```

- [ ] **Step 2: Icons, and the menu's placement**

Append to `src/renderer/src/icons.tsx`:

```tsx
/** Android's navigation buttons and the screenshot camera, for the device panel. */
export const BackIcon = () => <Svg size={13}><path d="M11 3.5v9L4 8z" /></Svg>
export const HomeIcon = () => <Svg size={13}><circle cx="8" cy="8" r="4.5" /></Svg>
export const RecentsIcon = () => <Svg size={13}><rect x="3.5" y="3.5" width="9" height="9" rx="1.5" /></Svg>
export const PowerIcon = () => <Svg size={13}><path d="M8 2.5v5" /><path d="M5 4.6a5 5 0 1 0 6 0" /></Svg>
export const CameraIcon = () => (
  <Svg size={13}>
    <path d="M2.5 5.5h2l1.2-2h4.6l1.2 2h2v7h-11z" />
    <circle cx="8" cy="9" r="2.2" />
  </Svg>
)
```

In `src/renderer/src/claude/SessionPicker.tsx`, change `function placeBelow(` to `export function placeBelow(`.

- [ ] **Step 3: The device menu**

Create `src/renderer/src/device/DeviceMenu.tsx`:

```tsx
import { type KeyboardEvent, useEffect, useLayoutEffect, useRef, useState } from 'react'
import { createPortal } from 'react-dom'
import type { DeviceInfo } from '@shared/types'
import { placeBelow } from '../claude/SessionPicker'

interface DeviceMenuProps {
  devices: DeviceInfo[]
  /** The device shown now. */
  current: string | null
  /** The button it hangs from. */
  anchor: HTMLElement
  onPick(id: string): void
  /** `refocus`: give the keyboard back to the button (Esc, a choice), not after a click elsewhere. */
  onClose(refocus: boolean): void
}

const STATE_WORDS: Record<DeviceInfo['state'], string> = { ready: '', connecting: 'connecting', unauthorized: 'not allowed yet', offline: 'offline' }

/** Which device the tab shows, from every device adb sees. Rendered into <body> like the session menu. */
export function DeviceMenu({ devices, current, anchor, onPick, onClose }: DeviceMenuProps) {
  const [cursor, setCursor] = useState(() => Math.max(0, devices.findIndex((d) => d.id === current)))
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
      onClose(false)
    }
    const close = () => onClose(false)
    document.addEventListener('pointerdown', onPointerDown, true)
    window.addEventListener('blur', close)
    window.addEventListener('resize', close)
    return () => {
      document.removeEventListener('pointerdown', onPointerDown, true)
      window.removeEventListener('blur', close)
      window.removeEventListener('resize', close)
    }
  }, [anchor, onClose])

  const at = Math.min(cursor, devices.length - 1)
  const choose = (device: DeviceInfo | undefined) => {
    if (device && device.id !== current) onPick(device.id)
    onClose(true)
  }
  const onKeyDown = (e: KeyboardEvent<HTMLDivElement>) => {
    switch (e.key) {
      case 'Escape':
        e.stopPropagation()
        onClose(true)
        break
      case 'ArrowDown':
        setCursor(Math.min(devices.length - 1, at + 1))
        break
      case 'ArrowUp':
        setCursor(Math.max(0, at - 1))
        break
      case 'Home':
        setCursor(0)
        break
      case 'End':
        setCursor(devices.length - 1)
        break
      case 'Enter':
        choose(devices[at])
        break
      case 'Tab':
        onClose(false)
        return
      default:
        return
    }
    e.preventDefault()
  }

  return createPortal(
    <div className="cp-menu" ref={menuRef} role="menu" aria-label="Device to show" tabIndex={-1} style={place} onKeyDown={onKeyDown}>
      <div className="cpm-title">Devices</div>
      <div className="cpm-list">
        {devices.map((device, i) => {
          const checked = device.id === current
          const word = STATE_WORDS[device.state]
          return (
            <div key={device.id} role="menuitemradio" aria-checked={checked} className={`cpm-item${i === at ? ' cursor' : ''}`}
              title={`${device.name}\n${device.detail}${word ? ` · ${word}` : ''}`}
              onMouseMove={() => i !== at && setCursor(i)} onClick={() => choose(device)}>
              <span className="cpm-check" aria-hidden="true">{checked ? '✓' : ''}</span>
              <span className="cpm-label">{device.name}</span>
              <span className="cpm-hint">{word || device.detail}</span>
            </div>
          )
        })}
        {devices.length === 0 && <div className="cpm-note">No devices connected.</div>}
      </div>
    </div>,
    document.body,
  )
}
```

- [ ] **Step 4: The panel**

Create `src/renderer/src/device/DevicePanel.tsx`:

```tsx
import { Component, type ErrorInfo, type MouseEvent, type ReactNode, useCallback, useLayoutEffect, useRef, useState } from 'react'
import type { DeviceInfo, DeviceList } from '@shared/types'
import { errorText } from '../git/format'
import { BackIcon, CameraIcon, Caret, HomeIcon, PowerIcon, RecentsIcon } from '../icons'
import { DeviceMenu } from './DeviceMenu'
import { DeviceScreen, type ScreenHandle } from './DeviceScreen'
import { KEYCODE } from './keys'
import type { PanelView } from './pick'
import './device.css'

interface DevicePanelProps {
  /** A device (maybe gone for now), the devices to choose from, or none: the panel was asked for. */
  view: PanelView
  /** Every device adb sees, for the menu. */
  devices: DeviceInfo[]
  problem: DeviceList['problem']
  /** The devices aren't known yet: adb is starting, or they're still saying what they are. */
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
}

/** Clicking the header's text leaves the keyboard where it was. */
const keepFocus = (e: MouseEvent) => {
  if (!(e.target as Element).closest('button')) e.preventDefault()
}

/** A device's screen at the top of the right pane: a header (fold, the device menu, Android's
 *  buttons, the screenshot), then the screen, a choice of devices, or why there's none. A thrown
 *  render costs the panel only. */
export function DevicePanel(props: DevicePanelProps) {
  const shown = props.view.kind === 'device' ? props.view.device.id : props.view.kind
  return (
    <Boundary resetKey={shown}>
      <PanelBody {...props} />
    </Boundary>
  )
}

function PanelBody({ view, devices, problem, looking, open, onToggle, visible, claudeRuns, onPick, onInsert }: DevicePanelProps) {
  const [menuAnchor, setMenuAnchor] = useState<HTMLElement | null>(null)
  const [error, setError] = useState<string | null>(null)
  const [busy, setBusy] = useState(false)
  const screen = useRef<ScreenHandle>(null)
  const anchorRef = useRef<HTMLElement | null>(null)
  useLayoutEffect(() => {
    anchorRef.current = menuAnchor
  }, [menuAnchor])
  const closeMenu = useCallback((refocus: boolean) => {
    const anchor = anchorRef.current
    setMenuAnchor(null)
    if (refocus) anchor?.focus()
  }, [])

  const device = view.kind === 'device' ? view.device : null
  const gone = view.kind === 'device' && view.gone
  const ready = device !== null && device.state === 'ready' && !gone
  let message: string | null = null
  if (device && gone) message = `${device.name} disconnected`
  else if (device?.state === 'unauthorized') message = `Allow USB debugging on ${device.name}: check its screen.`
  else if (device?.state === 'offline') message = `${device.name} isn't answering. Unplug it and plug it back in.`
  else if (device?.state === 'connecting') message = `${device.name} is connecting…`

  const press = (keycode: number) => {
    if (device) window.deck.devices.input(device.id, { type: 'key', keycode, meta: 0 })
  }
  const screenshot = async () => {
    setBusy(true)
    setError(null)
    try {
      const png = await screen.current?.screenshot()
      if (!png) throw new Error('There is no picture yet.')
      const result = await window.deck.devices.screenshot(png)
      if ('text' in result) onInsert(result.text)
      else setError(result.error)
    } catch (err) {
      setError(errorText(err))
    } finally {
      setBusy(false)
    }
  }

  const title = device ? device.name : view.kind === 'choose' ? 'Choose a device' : 'Devices'
  return (
    <div className={open ? 'device-panel' : 'device-panel folded'}>
      <header className="dp-head" onMouseDown={keepFocus}>
        <button className="cp-section-head dp-fold" aria-expanded={open} aria-label="Device panel"
          title={open ? 'Fold the device panel' : 'Unfold the device panel'} onClick={onToggle}>
          <Caret />
        </button>
        <button className="dp-device" aria-haspopup="menu" aria-expanded={menuAnchor !== null} title="The device this tab shows"
          onClick={(e) => {
            const button = e.currentTarget
            setMenuAnchor((a) => (a ? null : button))
          }}>
          <span className="dp-name">{title}</span>
          <Chevron />
        </button>
        {device && <span className={gone ? 'dp-detail gone' : 'dp-detail'}>{gone ? 'disconnected' : device.detail}</span>}
        <span className="cp-spacer" />
        {open && ready && (
          <span className="dp-buttons">
            <IconButton label="Back" onClick={() => press(KEYCODE.BACK)}><BackIcon /></IconButton>
            <IconButton label="Home" onClick={() => press(KEYCODE.HOME)}><HomeIcon /></IconButton>
            <IconButton label="Recent apps" onClick={() => press(KEYCODE.APP_SWITCH)}><RecentsIcon /></IconButton>
            <IconButton label="Power" onClick={() => press(KEYCODE.POWER)}><PowerIcon /></IconButton>
            {claudeRuns && (
              <IconButton label="Add screenshot to Claude" disabled={busy} onClick={() => void screenshot()}><CameraIcon /></IconButton>
            )}
          </span>
        )}
      </header>
      {open && error && <div className="dp-error" role="alert">{error}</div>}
      {open && (
        <div className="dp-body">
          {device && (
            <DeviceScreen key={device.id} deviceId={device.id} name={device.name} live={visible && ready} message={message} handle={screen} />
          )}
          {view.kind === 'choose' && (
            <div className="dp-choose">
              <span className="dp-choose-title">Which device should this project show?</span>
              {view.devices.map((d) => (
                <button key={d.id} className="dp-choice" onClick={() => onPick(d.id)}>
                  <span>{d.name}</span>
                  <span className="dp-choice-detail">{d.detail}</span>
                </button>
              ))}
            </div>
          )}
          {view.kind === 'none' && <Nothing problem={problem} looking={looking} />}
        </div>
      )}
      {menuAnchor && (
        <DeviceMenu devices={devices} current={device?.id ?? null} anchor={menuAnchor} onPick={onPick} onClose={closeMenu} />
      )}
    </div>
  )
}

/** The panel was asked for and there's nothing to show. */
function Nothing({ problem, looking }: { problem: DeviceList['problem']; looking: boolean }) {
  if (looking) return <State title="Looking for devices…" />
  if (problem === 'no-adb') {
    return <State title="Deck can't find adb, so it can't see Android devices." detail="Install Android Studio or Android's platform tools." />
  }
  if (problem) return <State error title="adb couldn't list the devices" detail={problem.error} />
  return <State title="No devices connected" detail="Plug in an Android phone with USB debugging on, or start an emulator." />
}

function State({ title, detail, error }: { title: string; detail?: string; error?: boolean }) {
  return (
    <div className={error ? 'cp-state error' : 'cp-state'} role="status">
      <strong>{title}</strong>
      {detail && <span className="cp-state-detail">{detail}</span>}
    </div>
  )
}

/** Pressing one leaves the keyboard where it was: on the device's screen or in the terminal. */
function IconButton({ label, disabled, onClick, children }: { label: string; disabled?: boolean; onClick(): void; children: ReactNode }) {
  return (
    <button className="cp-icon-button dp-icon" aria-label={label} title={label} disabled={disabled}
      onMouseDown={(e) => e.preventDefault()} onClick={onClick}>
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

/** A thrown render (a state main got wrong) costs the panel, never the pane: it disappears, and
 *  another device or view gets another try. */
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
    return this.state.error ? null : this.props.children
  }
}
```

- [ ] **Step 5: Styles**

Create `src/renderer/src/device/device.css`:

```css
/* The device panel, at the top of the right pane above the Claude panel (App.tsx: Workspace). Its
   menu, states and spinner are the Claude panel's (claude/panel.css: .cp-menu, .cp-state). */

.device-slot { display: flex; flex-direction: column; min-height: 0; }

.device-panel {
  position: relative;
  flex: 1;
  min-height: 0;
  display: flex;
  flex-direction: column;
  background: var(--chrome);
  color: var(--text);
  font-size: 12px;
}

.dp-head {
  flex: none;
  display: flex;
  align-items: center;
  gap: 4px;
  min-width: 0;
  height: 32px;
  padding: 0 8px 0 2px;
  border-bottom: 1px solid var(--line);
  white-space: nowrap;
}
.device-panel.folded .dp-head { border-bottom: 0; }
/* The Claude panel's section heading, without its full width. */
.dp-head .dp-fold { width: auto; padding: 0 5px; }
.dp-device {
  display: inline-flex;
  flex: 0 1 auto;
  align-items: center;
  gap: 4px;
  min-width: 0;
  height: 24px;
  padding: 0 6px;
  border: 0;
  border-radius: 5px;
  background: none;
  color: var(--ink);
  font-size: 12.5px;
  font-weight: 600;
}
.dp-device:hover { background: rgb(244 245 251 / 0.08); }
.dp-name { min-width: 0; overflow: hidden; text-overflow: ellipsis; }
.dp-detail { flex: 0 1 auto; min-width: 0; overflow: hidden; color: var(--faint); font-size: 11px; text-overflow: ellipsis; }
.dp-detail.gone { color: var(--amber); }
.dp-buttons { flex: none; display: flex; gap: 1px; }
.dp-icon:disabled { opacity: 0.4; }

.dp-error { flex: none; padding: 4px 10px; color: var(--red); font-size: 11.5px; overflow-wrap: anywhere; }
.dp-body { position: relative; flex: 1; min-height: 0; display: flex; }

.dp-area {
  position: relative;
  flex: 1;
  min-width: 0;
  min-height: 0;
  display: flex;
  align-items: center;
  justify-content: center;
  padding: 8px;
  overflow: hidden;
}
/* The canvas is the screen's own size (DeviceScreen), centred in the area. Its edge is a ring, not a
   border: a border would squeeze the picture inside that size (blurring it) and shift touches. */
.dp-screen {
  flex: none;
  display: block;
  border-radius: 8px;
  background: #000;
  box-shadow: 0 0 0 1px var(--line-strong);
  outline: none;
  touch-action: none;
}
.dp-screen:focus { box-shadow: 0 0 0 2px var(--teal); }
.dp-screen.dim { opacity: 0.35; }

.dp-overlay {
  position: absolute;
  inset: 0;
  display: flex;
  flex-direction: column;
  align-items: center;
  justify-content: center;
  gap: 6px;
  padding: 16px;
  color: var(--muted);
  font-size: 12px;
  text-align: center;
  pointer-events: none;
}
.dp-overlay strong { color: var(--text); font-weight: 600; }
.dp-overlay.error strong { color: var(--red); }
.dp-overlay-detail { max-width: 100%; color: var(--faint); font-size: 11.5px; overflow-wrap: anywhere; }
.dp-overlay .button { height: 26px; margin-top: 4px; pointer-events: auto; }

.dp-choose { margin: auto; display: flex; flex-direction: column; gap: 6px; width: min(100%, 300px); padding: 16px; }
.dp-choose-title { margin-bottom: 2px; color: var(--text); font-weight: 600; text-align: center; }
.dp-choice {
  display: flex;
  flex-direction: column;
  align-items: flex-start;
  gap: 1px;
  padding: 6px 10px;
  border: 1px solid var(--line-strong);
  border-radius: 6px;
  background: var(--surface);
  color: var(--ink);
  font-size: 12px;
  text-align: left;
}
.dp-choice:hover { border-color: var(--teal); }
.dp-choice-detail { color: var(--muted); font-size: 11px; }
```

- [ ] **Step 6: Typecheck**

Run: `npm run typecheck`
Expected: PASS.

- [ ] **Step 7: Commit**

```bash
git add src/renderer/src/device/ src/renderer/src/hooks.ts src/renderer/src/icons.tsx src/renderer/src/claude/SessionPicker.tsx
git -c user.email=franco@effektstudios.com commit -m "Device panel: header, device menu, chooser and states" -m "Claude-Session: https://claude.ai/code/session_012TidnAXmFkf7jwBCQQo4jJ"
```

---

### Task 14: The right pane

**Files:**
- Modify: `src/renderer/src/tabs/tabs.ts` (`TerminalTab`), `src/renderer/src/tabs/tabs.test.ts`
- Modify: `src/main/menu.ts` (View menu), `src/main/menu.test.ts`
- Modify: `src/renderer/src/terminal/keys.ts` (`MENU_LETTERS`), `src/renderer/src/terminal/keys.test.ts`
- Modify: `src/renderer/src/App.tsx` (whole file below)

- [ ] **Step 1: Write the failing tests**

In `src/renderer/src/tabs/tabs.test.ts`, before `it('activates known tabs only', …)`, add:

```ts
  it("keeps a tab's device and its device panel choice until they're cleared", () => {
    let s = tabsReducer(open(initialTabs, 'a'), { type: 'update', id: 'a', patch: { device: 'android:8d2e61a', deviceHidden: false } })
    expect(s.tabs[1]).toMatchObject({ device: 'android:8d2e61a', deviceHidden: false })
    expect(tabsReducer(s, { type: 'update', id: 'a', patch: { device: 'android:8d2e61a' } })).toBe(s)
    s = tabsReducer(s, { type: 'update', id: 'a', patch: { device: undefined, deviceHidden: undefined } })
    expect(s.tabs[1]).toMatchObject({ device: undefined, deviceHidden: undefined })
  })
```

In `src/main/menu.test.ts`, add `'Cmd+Shift+D'` to the macOS list (after `'Cmd+Shift+A'`) and `'Ctrl+Shift+D'` to the Windows list (after `'Ctrl+Shift+A'`).

In `src/renderer/src/terminal/keys.test.ts`, change `for (const key of ['T', 'W', 'O', 'G', 'A'])` to `for (const key of ['T', 'W', 'O', 'G', 'A', 'D'])`.

- [ ] **Step 2: Run them to make sure they fail**

Run: `npx vitest run src/renderer/src/tabs src/main/menu.test.ts src/renderer/src/terminal/keys.test.ts`
Expected: FAIL: the menu has no `Cmd+Shift+D`, Ctrl+Shift+D isn't `'menu'`, and `tabs.test.ts`
fails to typecheck its patch (vitest still runs it; the menu and keys tests are the failures).

- [ ] **Step 3: The tab, the menu, the key**

In `src/renderer/src/tabs/tabs.ts`, add to `TerminalTab` after `claudeSession`:

```ts
  /** The device panel was hidden in this tab (true) or shown by hand (false) with View → Device
   *  Panel; unset: it shows when a device fits. Holds in the project it was set in. */
  deviceHidden?: boolean
  /** The device picked in this tab; unset: the project's. Holds in the project it was picked in. */
  device?: string
```

In `src/main/menu.ts`, in the View menu after the `Claude Panel` item, add:

```ts
      item('Device Panel', key('Cmd+Shift+D', 'Ctrl+Shift+D'), { type: 'toggle-device' }),
```

In `src/renderer/src/terminal/keys.ts`, change `MENU_LETTERS` to:

```ts
const MENU_LETTERS = new Set(['t', 'w', 'o', 'g', 'a', 'd'])
```

- [ ] **Step 4: The right pane**

Replace `src/renderer/src/App.tsx` with:

```tsx
import { type CSSProperties, memo, useCallback, useEffect, useLayoutEffect, useReducer, useRef, useState } from 'react'
import type { AppInfo, ClipboardPreview, DeviceInfo, MenuCommand, ProjectAction, UsageState } from '@shared/types'
import { ClaudePanel } from './claude/ClaudePanel'
import { shownSession, toResume } from './claude/resume'
import { useClaudeSession } from './claude/useClaude'
import { ClipboardCard } from './clipboard/ClipboardCard'
import { useClipboardItem } from './clipboard/useClipboardItem'
import { DevicePanel } from './device/DevicePanel'
import { choosePanel } from './device/pick'
import { useDeviceList, useDeviceProject, useHeldView } from './device/useDevices'
import { GitPanel } from './git/GitPanel'
import { loadSize, saveSize, Splitter } from './git/Splitter'
import { usePageVisible, useStoredFlag } from './hooks'
import { ProjectsView } from './projects/ProjectsView'
import { TabBar } from './tabs/TabBar'
import { initialTabs, isTerminal, PROJECTS_ID, tabsReducer, type TerminalPatch, type TerminalTab } from './tabs/tabs'
import { runsClaude, tabTitle } from './tabs/title'
import { TerminalView } from './terminal/TerminalView'
import { UsageCard } from './usage/UsageCard'
import { useUsage } from './usage/useUsage'

// Main holds --open folders until the first ready(); StrictMode runs effects twice.
let readySent = false

/** The git panel's width, shared by every tab: 240 px … 55 % of the window. */
const GIT_WIDTH_KEY = 'deck.gitWidth'
const GIT_WIDTH = 360
const GIT_MIN = 240
const GIT_MAX_SHARE = 0.55
/** The right pane's width (device and Claude panels), shared by every tab: 260 px … 45 % of the
 *  window. Its key is from before the device panel. */
const CLAUDE_WIDTH_KEY = 'deck.claudeWidth'
const CLAUDE_WIDTH = 380
const CLAUDE_MIN = 260
const CLAUDE_MAX_SHARE = 0.45
/** What a drag leaves the terminal when both panels are open (and styles.css: .terminal-view). */
const TERMINAL_MIN = 280
/** The usage card's fold, shared by every tab. */
const USAGE_OPEN_KEY = 'deck.usageOpen'
/** The device panel's fold, shared by every tab. */
const DEVICE_OPEN_KEY = 'deck.deviceOpen'
/** The device panel's share of the right pane's height above the Claude panel, shared by every tab,
 *  stored in thousandths: 15 … 85 %. */
const DEVICE_SHARE_KEY = 'deck.deviceShare'
const DEVICE_SHARE = 0.6
/** The device panel keeps its header and 120 px of screen; the Claude panel under it 160 px. */
const DEVICE_MIN = 152
const CLAUDE_MIN_BELOW = 160
const NO_DEVICES: DeviceInfo[] = []

/** `px` within min … share of the window, and within `room` (what the other panel and the terminal leave). */
const clampWidth = (px: number, min: number, share: number, room = Infinity) =>
  Math.round(Math.min(Math.max(px, min), Math.max(min, Math.min(window.innerWidth * share, room))))
const clampGitWidth = (px: number, room?: number) => clampWidth(px, GIT_MIN, GIT_MAX_SHARE, room)
const clampClaudeWidth = (px: number, room?: number) => clampWidth(px, CLAUDE_MIN, CLAUDE_MAX_SHARE, room)
const clampShare = (share: number) => Math.min(Math.max(share, 0.15), 0.85)

export function App() {
  const platform = window.deck.platform
  const [state, dispatch] = useReducer(tabsReducer, initialTabs)
  const [info, setInfo] = useState<AppInfo | null>(null)
  const [findRequests, setFindRequests] = useState<Record<string, number>>({})
  const [gitWidth, setGitWidth] = useState(() => loadSize(GIT_WIDTH_KEY, GIT_WIDTH))
  const [claudeWidth, setClaudeWidth] = useState(() => loadSize(CLAUDE_WIDTH_KEY, CLAUDE_WIDTH))
  /** View → Claude Panel, per tab: the tab knows whether its panel shows. */
  const [claudeToggles, setClaudeToggles] = useState<Record<string, number>>({})
  /** View → Device Panel, per tab, likewise. */
  const [deviceToggles, setDeviceToggles] = useState<Record<string, number>>({})
  /** What was just copied, offered under the Claude panel of tabs where Claude runs. */
  const clipItem = useClipboardItem()
  /** Claude's plan usage, shown at the bottom of every Claude pane, which all fold together. */
  const usage = useUsage()
  const [usageOpen, toggleUsage] = useStoredFlag(USAGE_OPEN_KEY, true)
  const [deviceOpen, toggleDevice] = useStoredFlag(DEVICE_OPEN_KEY, true)
  const [deviceShare, setDeviceShare] = useState(() => clampShare(loadSize(DEVICE_SHARE_KEY, DEVICE_SHARE * 1000) / 1000))
  /** Device screens stream only while the window can be seen. */
  const pageVisible = usePageVisible()

  // Menu commands and IPC events read the latest state through refs.
  const stateRef = useRef(state)
  const homeRef = useRef('')
  useLayoutEffect(() => {
    stateRef.current = state
  }, [state])

  useEffect(() => {
    void window.deck.app.info().then((i) => {
      homeRef.current = i.home
      setInfo(i)
    })
  }, [])

  const open = useCallback((cwd: string, command?: string) => {
    dispatch({ type: 'open', id: crypto.randomUUID(), cwd, command })
  }, [])

  /** A shell tab in the active terminal's folder; from Projects, the home folder (main also falls back to it). */
  const newTab = useCallback(() => {
    const { tabs, active } = stateRef.current
    const tab = tabs.find((t) => t.id === active)
    open(tab && isTerminal(tab) ? tab.cwd : homeRef.current)
  }, [open])

  const openProject = useCallback(
    async (path: string, action: ProjectAction) => {
      // Read the command when it's used, so a Settings change applies at once.
      const command = action === 'claude'
        ? await window.deck.projects.getConfig().then((c) => c.command, () => undefined)
        : undefined
      open(path, command)
    },
    [open],
  )

  const update = useCallback((id: string, patch: TerminalPatch) => dispatch({ type: 'update', id, patch }), [])
  const close = useCallback((id: string) => dispatch({ type: 'close', id }), [])
  const activate = useCallback((id: string) => dispatch({ type: 'activate', id }), [])
  const storeGitWidth = useCallback((px: number) => {
    const width = clampGitWidth(px)
    setGitWidth(width)
    saveSize(GIT_WIDTH_KEY, width)
  }, [])
  const storeClaudeWidth = useCallback((px: number) => {
    const width = clampClaudeWidth(px)
    setClaudeWidth(width)
    saveSize(CLAUDE_WIDTH_KEY, width)
  }, [])
  const storeDeviceShare = useCallback((share: number) => {
    const next = clampShare(share)
    setDeviceShare(next)
    saveSize(DEVICE_SHARE_KEY, Math.round(next * 1000))
  }, [])

  useEffect(() => {
    const onMenu = (cmd: MenuCommand) => {
      const { active } = stateRef.current
      switch (cmd.type) {
        case 'new-tab':
          return newTab()
        case 'close-tab':
          return dispatch({ type: 'close', id: active }) // the reducer keeps the Projects tab
        case 'next-tab':
          return dispatch({ type: 'next' })
        case 'prev-tab':
          return dispatch({ type: 'prev' })
        case 'select-tab':
          return dispatch({ type: 'select', index: cmd.index })
        case 'projects':
          return dispatch({ type: 'activate', id: PROJECTS_ID })
        case 'find':
          return setFindRequests((f) => ({ ...f, [active]: (f[active] ?? 0) + 1 }))
        case 'toggle-git': {
          // Only where there is a panel to show or hide.
          const tab = stateRef.current.tabs.find((t) => t.id === active)
          if (tab && isTerminal(tab) && tab.vars.GIT_REPO) update(tab.id, { gitHidden: !tab.gitHidden })
          return
        }
        case 'toggle-claude': {
          const tab = stateRef.current.tabs.find((t) => t.id === active)
          if (tab && isTerminal(tab)) setClaudeToggles((t) => ({ ...t, [active]: (t[active] ?? 0) + 1 }))
          return
        }
        case 'toggle-device': {
          const tab = stateRef.current.tabs.find((t) => t.id === active)
          if (tab && isTerminal(tab)) setDeviceToggles((t) => ({ ...t, [active]: (t[active] ?? 0) + 1 }))
          return
        }
      }
    }
    const offMenu = window.deck.app.onMenu(onMenu)
    const offOpen = window.deck.app.onOpenFolder((path) => open(path))
    if (!readySent) {
      readySent = true
      window.deck.app.ready()
    }
    return () => {
      offMenu()
      offOpen()
    }
  }, [newTab, open, update])

  const activeTab = state.tabs.find((t) => t.id === state.active)
  const windowTitle = activeTab && isTerminal(activeTab) ? tabTitle(activeTab, platform) : 'Deck'
  useEffect(() => {
    document.title = windowTitle
  }, [windowTitle])

  const terminals = state.tabs.filter(isTerminal)

  return (
    <div className="app">
      <TabBar tabs={state.tabs} active={state.active} platform={platform}
        onActivate={activate} onClose={close} onNew={newTab} />
      <main className="content">
        <ProjectsView active={state.active === PROJECTS_ID} openTabs={terminals} home={info?.home ?? ''}
          findRequest={findRequests[PROJECTS_ID] ?? 0} onOpen={openProject} />
        {terminals.map((tab) => (
          <Workspace key={tab.id} tab={tab} active={tab.id === state.active} home={info?.home ?? ''}
            gitWidth={gitWidth} claudeWidth={claudeWidth} windowsBuild={info?.windowsBuild}
            findRequest={findRequests[tab.id] ?? 0} claudeToggle={claudeToggles[tab.id] ?? 0} clipItem={clipItem} usage={usage}
            usageOpen={usageOpen} onUsageToggle={toggleUsage}
            deviceToggle={deviceToggles[tab.id] ?? 0} deviceOpen={deviceOpen} onDeviceToggle={toggleDevice}
            deviceShare={deviceShare} onDeviceShare={storeDeviceShare} pageVisible={pageVisible}
            onGitWidth={storeGitWidth} onClaudeWidth={storeClaudeWidth} onUpdate={update} onClose={close} />
        ))}
      </main>
    </div>
  )
}

interface WorkspaceProps {
  tab: TerminalTab
  active: boolean
  home: string
  /** The stored width; CSS keeps it within 240 px … 55 % when the window shrinks. */
  gitWidth: number
  /** The right pane's; likewise, 260 px … 45 %. */
  claudeWidth: number
  findRequest: number
  /** Incremented by View → Claude Panel. */
  claudeToggle: number
  windowsBuild?: number
  /** The clipboard card's item (one for the window). */
  clipItem: ClipboardPreview | null
  /** Claude's plan usage (one for the window). */
  usage: UsageState | null
  /** The usage card is unfolded (one flag for the window). */
  usageOpen: boolean
  onUsageToggle(): void
  /** Incremented by View → Device Panel. */
  deviceToggle: number
  /** The device panel is unfolded (one flag for the window). */
  deviceOpen: boolean
  onDeviceToggle(): void
  /** The device panel's share of the right pane's height above the Claude panel. */
  deviceShare: number
  /** A drag ended (or a reset): clamp, store and share it. */
  onDeviceShare(share: number): void
  /** The window can be seen: a device screen may stream. */
  pageVisible: boolean
  /** A drag ended (or a reset): clamp, store and share the width. */
  onGitWidth(px: number): void
  onClaudeWidth(px: number): void
  onUpdate(id: string, patch: TerminalPatch): void
  onClose(id: string): void
}

/** A terminal tab: the git panel while the shell is in a repo (unless hidden with View → Git
 *  Panel), the terminal, and the right pane: the device panel while a device fits the project
 *  (unless hidden with View → Device Panel) above the Claude panel while Claude runs in the tab or
 *  the folder has a session (unless hidden with View → Claude Panel). Inactive tabs stay mounted. */
const Workspace = memo(function Workspace(props: WorkspaceProps) {
  const { tab, active, home, gitWidth, claudeWidth, findRequest, claudeToggle, windowsBuild, clipItem } = props
  const { usage, usageOpen, onUsageToggle, onGitWidth, onClaudeWidth, onUpdate, onClose } = props
  const { deviceToggle, deviceOpen, onDeviceToggle, deviceShare, onDeviceShare, pageVisible } = props
  const repo = tab.vars.GIT_REPO ?? ''
  const showGit = repo !== '' && !tab.gitHidden
  // Claude logs under the folder it was started in: the tab's cwd, which stays put while
  // it runs (no prompts, so no OSC 7; zsh reports a cd within the command line at once).
  const folder = tab.cwd || repo
  const claudeRuns = runsClaude(tab.process, tab.title)
  const claudeLive = active && tab.claudeHidden !== true
  const claude = useClaudeSession(folder, claudeLive, toResume(tab.claudeSession))
  // claudeHidden: true = hidden with View → Claude Panel; false = shown with it, even
  // with nothing to show yet; unset = shown when there is something to show.
  const showClaude = tab.claudeHidden !== true && (tab.claudeHidden === false || claudeRuns || claude.snapshot !== null)
  const [dragWidth, setDragWidth] = useState<number | null>(null)
  const [claudeDrag, setClaudeDrag] = useState<number | null>(null)
  const rootRef = useRef<HTMLDivElement>(null)
  const paneRef = useRef<HTMLDivElement>(null)
  const claudeRef = useRef<HTMLDivElement>(null)
  /** Pastes into this tab's terminal (TerminalView sets it). */
  const pasteRef = useRef<((text: string) => void) | null>(null)
  /** Add's progress for one item: a newer item starts clean, nothing to reset. */
  const [clip, setClip] = useState<{ id: string; busy: boolean; error: string | null } | null>(null)
  const clipState = clip && clip.id === clipItem?.id ? clip : null
  const addClip = useCallback((id: string) => {
    setClip({ id, busy: true, error: null })
    const settle = (error: string | null) => setClip((c) => (c?.id === id ? { id, busy: false, error } : c))
    window.deck.clipboard.add(id).then(
      (result) => {
        if ('text' in result) {
          pasteRef.current?.(result.text)
          settle(null)
        } else settle(result.error)
      },
      (err: unknown) => settle(err instanceof Error ? err.message : String(err)),
    )
  }, [])
  const dismissClip = useCallback((id: string) => {
    window.deck.clipboard.dismiss(id)
    // × via the keyboard leaves focus on the card's button, about to unmount: give it to the terminal.
    if (claudeRef.current?.contains(document.activeElement)) rootRef.current?.querySelector<HTMLElement>('.xterm-helper-textarea')?.focus()
  }, [])
  /** The usage card lost the keyboard to nowhere (its button went): the terminal gets it. */
  const focusTerminal = useCallback(() => {
    rootRef.current?.querySelector<HTMLElement>('.xterm-helper-textarea')?.focus()
  }, [])

  // The device panel: the tab's project (read when the tab comes to the front), the devices adb sees
  // while this tab may show one (null until known), and which one it shows. Shown by hand, it works
  // without a project too.
  const [project, pickForProject] = useDeviceProject(folder, active)
  const byHand = tab.deviceHidden === false
  const deviceNeeded = tab.deviceHidden !== true && (byHand || project?.android === true || Boolean(tab.device) || Boolean(project?.pick))
  const deviceList = useDeviceList(deviceNeeded)
  const devices = deviceList?.devices ?? NO_DEVICES
  const choice = deviceList && (project || byHand)
    ? choosePanel({ tab: tab.device, project: project?.pick ?? null, android: project?.android ?? false, byHand, devices })
    : null
  const deviceView = useHeldView(choice, devices, project?.root ?? null, tab.device ?? project?.pick ?? null)
  const showDevice = tab.deviceHidden !== true && (deviceView.kind !== 'none' || byHand)
  const showRight = showClaude || showDevice
  const [deviceDrag, setDeviceDrag] = useState<number | null>(null)
  const deviceRef = useRef<HTMLDivElement>(null)
  const pickDevice = useCallback((id: string) => {
    onUpdate(tab.id, { device: id })
    pickForProject(id)
  }, [tab.id, onUpdate, pickForProject])
  const insert = useCallback((text: string) => pasteRef.current?.(text), [])

  // Hidden for the repo it was hidden in: like the prototype's q, entering another repo shows it again.
  const hiddenIn = useRef<string | null>(null)
  useEffect(() => {
    if (!tab.gitHidden) hiddenIn.current = null
    else if (hiddenIn.current === null) hiddenIn.current = repo
    else if (repo && repo !== hiddenIn.current) onUpdate(tab.id, { gitHidden: false })
  }, [tab.gitHidden, tab.id, repo, onUpdate])

  // View → Claude Panel: hides the panel when it shows, else shows it.
  const toggleSeen = useRef(claudeToggle)
  useEffect(() => {
    if (claudeToggle === toggleSeen.current) return
    toggleSeen.current = claudeToggle
    onUpdate(tab.id, { claudeHidden: showClaude })
  }, [claudeToggle]) // showClaude, tab.id and onUpdate as of this render

  // View → Device Panel, likewise; shown with nothing to show, it offers every device.
  const deviceToggleSeen = useRef(deviceToggle)
  useEffect(() => {
    if (deviceToggle === deviceToggleSeen.current) return
    deviceToggleSeen.current = deviceToggle
    onUpdate(tab.id, { deviceHidden: showDevice })
  }, [deviceToggle]) // showDevice, tab.id and onUpdate as of this render

  // A tab's device and its View → Device Panel choice hold in the project they were made in.
  const deviceRoot = project?.root ?? null
  const deviceRootSeen = useRef<string | null>(null)
  useEffect(() => {
    if (!deviceRoot) return
    if (deviceRootSeen.current !== null && deviceRootSeen.current !== deviceRoot) onUpdate(tab.id, { device: undefined, deviceHidden: undefined })
    deviceRootSeen.current = deviceRoot
  }, [deviceRoot, tab.id, onUpdate])

  // The session the panel shows is the tab's: main's follow state is per folder, so subscribing
  // again (a tab switch) hands it back, rather than taking what another tab there followed. (The
  // same session again changes nothing: the reducer compares it by content.)
  useEffect(() => {
    const shown = claude.folder === folder ? shownSession(claude.snapshot) : undefined
    if (shown) onUpdate(tab.id, { claudeSession: shown })
  }, [claude.snapshot, claude.folder, folder, tab.id, onUpdate])

  // Claude starting in the tab: from now on its panel follows the newest session, which will
  // be Claude's own, not one this tab showed before; a pin it holds now is let go at once.
  const ranClaude = useRef(claudeRuns)
  useEffect(() => {
    if (claudeRuns === ranClaude.current) return
    ranClaude.current = claudeRuns
    if (!claudeRuns) return
    onUpdate(tab.id, { claudeSession: undefined })
    if (claudeLive && claude.folder === folder && claude.snapshot?.following === 'pinned') {
      window.deck.claude.follow(folder, null).catch(() => {}) // its snapshot arrives as an update
    }
  }, [claudeRuns]) // the rest as of this render

  // Like the git panel's: the choice holds in the repo (or folder) it was made in.
  const claudeKey = repo || folder
  const claudeChoiceIn = useRef<string | null>(null)
  useEffect(() => {
    if (tab.claudeHidden === undefined) claudeChoiceIn.current = null
    else if (claudeChoiceIn.current === null) claudeChoiceIn.current = claudeKey
    else if (claudeKey && claudeKey !== claudeChoiceIn.current) onUpdate(tab.id, { claudeHidden: undefined })
  }, [tab.claudeHidden, tab.id, claudeKey, onUpdate])

  // Hiding a panel while it had the keyboard would leave it with nobody: give it to the terminal.
  useEffect(() => {
    if (!active) return
    const focused = document.activeElement
    if (!focused || focused === document.body) rootRef.current?.querySelector<HTMLElement>('.xterm-helper-textarea')?.focus()
  }, [showGit, showClaude, showDevice, active])

  /** What a panel can have: the workspace less the other panel, the splitters and the terminal's minimum. */
  const roomBeside = (other: HTMLDivElement | null) =>
    (rootRef.current?.clientWidth ?? window.innerWidth) - (other?.offsetWidth ?? 0) - 2 - TERMINAL_MIN

  /** The device panel's height, leaving the Claude panel under it its minimum. */
  const clampDevice = (px: number) => {
    const pane = claudeRef.current?.clientHeight ?? window.innerHeight
    return Math.round(Math.min(Math.max(px, DEVICE_MIN), Math.max(DEVICE_MIN, pane - CLAUDE_MIN_BELOW)))
  }
  // Alone, the device panel takes the pane; folded, its header; else its share, which CSS keeps
  // within its minimum and the Claude panel's when the window shrinks.
  const deviceStyle: CSSProperties = !showClaude
    ? { flex: '1 1 0' }
    : !deviceOpen
      ? { flex: 'none' }
      : { flex: 'none', height: deviceDrag ?? `${deviceShare * 100}%`, minHeight: DEVICE_MIN, maxHeight: `calc(100% - ${CLAUDE_MIN_BELOW}px)` }

  return (
    <div className={active ? 'workspace' : 'workspace is-hidden'} ref={rootRef}>
      {showGit && (
        <div className="git-pane" ref={paneRef} style={{ width: dragWidth ?? gitWidth }}>
          <GitPanel key={repo} repo={repo} active={active} home={home} />
        </div>
      )}
      {showGit && (
        <Splitter orientation="vertical" label="Resize the git panel"
          getSize={() => paneRef.current?.offsetWidth ?? gitWidth}
          onResize={(px) => setDragWidth(clampGitWidth(px, roomBeside(claudeRef.current)))}
          onResizeEnd={(px) => {
            setDragWidth(null)
            onGitWidth(clampGitWidth(px, roomBeside(claudeRef.current)))
          }}
          onReset={() => onGitWidth(GIT_WIDTH)} />
      )}
      <TerminalView tab={tab} active={active} windowsBuild={windowsBuild} findRequest={findRequest}
        pasteRef={pasteRef} onUpdate={onUpdate} onClose={onClose} />
      {showRight && (
        <Splitter orientation="vertical" label="Resize the right pane" direction={-1}
          getSize={() => claudeRef.current?.offsetWidth ?? claudeWidth}
          onResize={(px) => setClaudeDrag(clampClaudeWidth(px, roomBeside(paneRef.current)))}
          onResizeEnd={(px) => {
            setClaudeDrag(null)
            onClaudeWidth(clampClaudeWidth(px, roomBeside(paneRef.current)))
          }}
          onReset={() => onClaudeWidth(CLAUDE_WIDTH)} />
      )}
      {showRight && (
        <div className="claude-pane" ref={claudeRef} style={{ width: claudeDrag ?? claudeWidth }}>
          {showDevice && (
            <div className="device-slot" ref={deviceRef} style={deviceStyle}>
              <DevicePanel view={deviceView} devices={devices} problem={deviceList?.problem ?? null} looking={deviceList === null}
                open={deviceOpen} onToggle={onDeviceToggle} visible={active && pageVisible} claudeRuns={claudeRuns}
                onPick={pickDevice} onInsert={insert} />
            </div>
          )}
          {showDevice && showClaude && deviceOpen && (
            <Splitter orientation="horizontal" label="Resize the device panel"
              getSize={() => deviceRef.current?.offsetHeight ?? DEVICE_MIN}
              onResize={(px) => setDeviceDrag(clampDevice(px))}
              onResizeEnd={(px) => {
                setDeviceDrag(null)
                const pane = claudeRef.current?.clientHeight ?? 0
                if (pane > 0) onDeviceShare(clampDevice(px) / pane)
              }}
              onReset={() => onDeviceShare(DEVICE_SHARE)} />
          )}
          {showClaude && (
            <ClaudePanel folder={folder} snapshot={claude.snapshot} phase={claude.phase} error={claude.error}
              claudeRuns={claudeRuns} active={active} home={home} onRetry={claude.retry} />
          )}
          {showClaude && usage && (
            <UsageCard state={usage} home={home} open={usageOpen} onToggle={onUsageToggle} onFocusLost={focusTerminal} />
          )}
          {showClaude && claudeRuns && clipItem && (
            <ClipboardCard item={clipItem} home={home} busy={clipState?.busy ?? false} error={clipState?.error ?? null}
              onAdd={addClip} onDismiss={dismissClip} />
          )}
        </div>
      )}
    </div>
  )
})
```

- [ ] **Step 5: Run everything**

Run: `npm test && npm run typecheck && npm run build`
Expected: PASS, and the build writes `out/`.

- [ ] **Step 6: Commit**

```bash
git add src/renderer/src/App.tsx src/renderer/src/tabs/ src/main/menu.ts src/main/menu.test.ts src/renderer/src/terminal/keys.ts src/renderer/src/terminal/keys.test.ts
git -c user.email=franco@effektstudios.com commit -m "Device panel: at the top of the right pane, with View → Device Panel" -m "Claude-Session: https://claude.ai/code/session_012TidnAXmFkf7jwBCQQo4jJ"
```

---
### Task 15: On the devices

**Files:**
- Create (scratchpad, not the repo): `cdp.mjs`
- Modify: whatever the checks below show is wrong, each fix with a test where one can be written

Franco's C66, S25 FE and the `Pixel_9` emulator are plugged in (2026-11-03). Screenshots of
Deck show what's on the devices, which can be client data: keep them in the scratchpad and never
commit them.

- [ ] **Step 1: Note the devices' screen settings before Deck touches them**

Run:

```bash
ADB=~/Library/Android/sdk/platform-tools/adb
for s in 8d2e61a R5CW20XY7QZ emulator-5554; do echo "$s $($ADB -s $s shell settings get global stay_on_while_plugged_in)"; done
```

Expected: one value per device (often `0`). Keep them for Step 6.

- [ ] **Step 2: Start the dev build on its own data, opening Guard**

```bash
export PATH="$HOME/.nvm/versions/node/v22.19.0/bin:$PATH"
npx electron-vite dev --remoteDebuggingPort 9333 -- --user-data-dir="$TMPDIR/deck-devices-dev" --open /Volumes/Wyobi/AccessControl_Guard
```

Run it in the background. It must not reach Franco's installed Deck: the `--user-data-dir` keeps it
apart.

- [ ] **Step 3: A way to look inside**

Create `cdp.mjs` in the scratchpad:

```js
// node cdp.mjs '<expression>'    evaluates in Deck's page and prints the value
// node cdp.mjs --shot <file.png> saves a screenshot of the page
import { writeFileSync } from 'node:fs'

const [arg, file] = process.argv.slice(2)
const pages = await (await fetch('http://127.0.0.1:9333/json')).json()
const page = pages.find((p) => p.type === 'page' && !p.url.startsWith('devtools'))
const ws = new WebSocket(page.webSocketDebuggerUrl)
await new Promise((resolve) => ws.addEventListener('open', resolve))
let next = 0
const call = (method, params) => new Promise((resolve) => {
  const id = ++next
  const onMessage = (e) => {
    const message = JSON.parse(e.data)
    if (message.id !== id) return
    ws.removeEventListener('message', onMessage)
    resolve(message)
  }
  ws.addEventListener('message', onMessage)
  ws.send(JSON.stringify({ id, method, params }))
})
if (arg === '--shot') {
  const { result } = await call('Page.captureScreenshot', { format: 'png' })
  writeFileSync(file, Buffer.from(result.data, 'base64'))
  console.log(file)
} else {
  const reply = await call('Runtime.evaluate', { expression: arg, awaitPromise: true, returnByValue: true })
  console.log(JSON.stringify(reply.result?.result?.value ?? reply.result))
}
ws.close()
```

- [ ] **Step 4: Guard asks, then shows the C66**

With all three devices plugged in, Guard has no pick yet, so the panel asks:

```bash
node cdp.mjs "[...document.querySelectorAll('.workspace:not(.is-hidden) .dp-choice')].map((b) => b.textContent)"
```

Expected: three entries: `C66Android 13 · USB`, `Franco's S25 FEAndroid 17 · USB + Wi-Fi`, `Pixel 9Emulator · Android 15`.

```bash
node cdp.mjs "[...document.querySelectorAll('.workspace:not(.is-hidden) .dp-choice')].find((b) => b.textContent.startsWith('C66')).click()"
sleep 4
node cdp.mjs "document.querySelector('.workspace:not(.is-hidden) .dp-name').textContent"
node cdp.mjs "(() => { const c = document.querySelector('.workspace:not(.is-hidden) .dp-screen'); if (!c) return 'no canvas'; const d = c.getContext('2d').getImageData(0, 0, c.width, c.height).data; let lit = 0; for (let i = 0; i < d.length; i += 4 * 97) if (d[i] + d[i + 1] + d[i + 2] > 30) lit++; return { width: c.width, height: c.height, lit } })()"
cat "$TMPDIR/deck-devices-dev/devices.json"
node cdp.mjs --shot guard.png
```

Expected: `"C66"`; a canvas with `lit` above 0 (the C66's screen, turned on by the server); and
`devices.json` holding `"/Volumes/Wyobi/AccessControl_Guard": "android:8d2e61a"`. Look at
`guard.png`: the device panel sits above the Claude panel, the C66's screen fitted and centred.

- [ ] **Step 5: Taps, keys and switching**

```bash
node cdp.mjs "document.querySelector('.workspace:not(.is-hidden) [aria-label=Home]').click()"
pgrep -fl 'deck-scrcpy-server.jar' ; ~/Library/Android/sdk/platform-tools/adb -s 8d2e61a shell ls /data/local/tmp/deck-scrcpy-server.jar
```

Expected: the C66 goes to its home screen; one `adb … shell CLASSPATH=…deck-scrcpy-server.jar …`
process on the Mac; `ls` says `No such file` (the server deleted its file).

Then the emulator: open the ▾ menu and pick `Pixel 9`:

```bash
node cdp.mjs "document.querySelector('.workspace:not(.is-hidden) .dp-device').click()"
node cdp.mjs "[...document.querySelectorAll('.cp-menu .cpm-item')].find((i) => i.textContent.includes('Pixel')).click()"
sleep 6
node cdp.mjs --shot emulator.png
```

Expected: the emulator's screen (it may take longer: emulators may encode in software). The C66's
stream stops 10 s after it was left: `pgrep -fl deck-scrcpy` shows one process again after 12 s.

- [ ] **Step 6: Leaving and coming back**

Minimise the dev window (`osascript -e 'tell application "System Events" to set visible of process "Electron" to false'`),
wait 15 s, and run `pgrep -fl deck-scrcpy`: nothing. Then the devices' settings from Step 1 are back:

```bash
for s in 8d2e61a R5CW20XY7QZ emulator-5554; do echo "$s $($ADB -s $s shell settings get global stay_on_while_plugged_in)"; done
```

Expected: the same values as Step 1. Show the window again (`set visible … to true`): the stream comes
back within a couple of seconds. Last, pick a device and quit the dev build within a second (while
its stream is starting): afterwards `pgrep -fl deck-scrcpy` and `$ADB forward --list` show nothing,
and on the device `$ADB -s 8d2e61a shell pgrep -f com.genymobile.scrcpy.Server` prints nothing and
`settings get global stay_on_while_plugged_in` is back to its Step 1 value. (On the device the jar's
path is in the environment, not the command line, so `deck-scrcpy` won't match there.)

- [ ] **Step 7: What it costs**

With the C66's screen streaming in front, and again with the panel folded:

```bash
top -l 3 -s 2 -stats pid,command,cpu -o cpu | grep -E 'Electron' | tail -6
```

Write down Deck's processes' CPU in both cases (main, GPU, renderer) for CLAUDE.md (Task 16).

- [ ] **Step 8: Fix what broke**

For each check that failed, use superpowers:systematic-debugging, fix the module at fault (with a test
where the fault can be reproduced in one), run `npm test && npm run typecheck`, and commit:

```bash
git -c user.email=franco@effektstudios.com commit -m "Device panel: <what was wrong>" -m "Claude-Session: https://claude.ai/code/session_012TidnAXmFkf7jwBCQQo4jJ"
```

Then quit the dev build and delete `$TMPDIR/deck-devices-dev` and the screenshots.

- [ ] **Step 9: Hand the rest to Franco**

These need hands on the devices; list them for him in the final message:
1. Guard tab: tap, swipe, type into a text field, paste (Cmd+V) into one, Back/Home/Recent apps/Power.
2. Rotate the S25 FE: the screen turns with it.
3. Pull the S25 FE's cable: it carries on over Wi-Fi after a moment. Pull the C66's: "C66
   disconnected", then no panel after 10 s. Plug it back: it returns.
4. Two tabs in AccessControl_Android: one on the emulator, one on the S25 FE; switching tabs
   switches the screen.
5. With Claude running in the tab, the camera button adds `[Image #N]` to Claude's prompt.

---

### Task 16: Docs

**Files:**
- Modify: `CLAUDE.md` ("Current state", the paths table, a new device panel section)
- Modify: `README.md` (the features list and the keys line)
- Modify: `docs/DECK.md` (M5)
- Modify: `docs/TESTING.md` (Windows steps)

- [ ] **Step 1: CLAUDE.md**

Under "M5, in progress", after the usage card sentence, add:

```markdown
The device panel, step 1 (Android: spec `…/2026-11-03-device-panel-design.md`, plan
`docs/superpowers/plans/2026-11-03-device-panel-android.md`, built <date>): the phone or emulator a
tab's project runs on, live at the top of the right pane. Simulators and iPhones are steps 2 and 3.
```

In the paths table, add:

```markdown
| `src/main/devices/` | the device panel's main side: `android/` (finding adb, `track-devices`, identities, scrcpy's protocol and sessions), streams (viewers, grace, retries), project rules, `devices.json` |
| `src/renderer/src/device/` | the device panel: which device a tab shows, the screen (WebCodecs, canvas, input), the menu |
| `resources/` | `scrcpy-server.json` (the server's version, URL, size, SHA-256) and `THIRD-PARTY-NOTICES.txt`; the server itself is downloaded at install, never committed |
```

After the usage card's section in "Things that aren't obvious from the code", add (with Task 15's
measurements filled in):

```markdown
- Device panel (`src/main/devices/`, `src/renderer/src/device/`):
  - **scrcpy's server** (v5.0.1, Apache 2.0) is downloaded at install by `scripts/fetch-scrcpy-server.mjs`
    and kept only if its SHA-256 matches `resources/scrcpy-server.json`. CI stops without it. Dev builds
    read the repo's `resources/`, packaged ones `process.resourcesPath`. The server refuses any version but
    its own, so a bump changes the JSON, `android/protocol.ts` if the protocol moved, and the notices.
  - **adb:** `ANDROID_HOME`/`ANDROID_SDK_ROOT` from Deck's own environment, the SDK's usual place, then
    PATH and Homebrew. The SDK's adb first: Android Studio runs it, and two adb versions restart each
    other's server.
  - **Devices:** one `adb track-devices -l` while any tab needs devices (`devices:watch` counts). Each
    connection is asked once what it is (one `adb shell`) and listed only once it answered or three asks
    failed, so an emulator's id (its AVD name; its adb name changes with the port) never changes under the
    panel. Phones are `android:<ro.serialno>`: a phone over USB and Wi-Fi
    (`adb-<serial>-<x>._adb-tls-connect._tcp`) is one device, reached over USB first.
  - **Streams:** a forward tunnel to `localabstract:scrcpy_<scid>` (the server reads `scid` as hex, eight
    digits). adb accepts a connection before the server listens and drops it, so Deck waits for the
    server's dummy byte (100 tries, 100 ms apart). Fingers are pointer id -2: a mouse id would make mouse
    events. A touch must carry the current video size or the server ignores it. Reset video (type 17)
    restarts the capture (a new size, config and key frame): sent when a viewer joins a running stream or
    a decoder falls behind. A stop also stops a start under way (an `AbortSignal` into `startScrcpy`):
    quitting mid-start once left the server running on the S25 FE (2026-11-03).
  - **On the device:** `stay_awake` keeps the screen on while it's shown and plugged in. scrcpy's cleanup
    is a separate process: it deletes the jar at start and puts `stay_on_while_plugged_in` back when the
    server dies, a pulled cable or a killed Deck included. `clipboard_autosync=false`, or the device's
    copies would come back to the Mac.
  - **Decoding:** WebCodecs in Annex B mode (no `description`): the config packet's SPS and PPS go in
    front of the next key frame, and the codec string comes from the SPS. Only the latest `VideoFrame` is
    kept (closed when replaced): frames left open stall the decoder.
  - **Cost:** only the active tab's unfolded panel streams, with the window visible; a stream lingers
    10 s after its last viewer; lock and sleep stop it. Measured <date>, C66 streaming in front: <main>%,
    <GPU>%, <renderer>% of a core; folded: <…>.
```

- [ ] **Step 2: README**

In the features list, after the **Claude panel** item, add:

```markdown
- **Device panel** (top of the right pane in an Android app's tabs; Cmd/Ctrl+Shift+D hides it): the
  phone or emulator the app runs on, live. Click to tap, drag to swipe, type and paste with the screen
  selected; Back, Home, Recent apps and Power in its header, and a camera that adds a screenshot to
  Claude's prompt. Each project remembers its device (the ▾ menu picks another, per tab). Deck runs
  scrcpy's server on the device over adb; the server deletes itself, and the screen setting it changes
  while shown is put back.
```

In the **Keys** item, after `Cmd+F find,`, add ` Cmd+Shift+D device panel,`.

- [ ] **Step 3: DECK.md**

In the M5 list, after the clipboard item, add:

```markdown
   - **Device panel** (step 1, Android, built <date>): the device a tab's project runs on, live at the
     top of the right pane (scrcpy's server over adb, decoded with WebCodecs), with touch and keys.
     Simulators (idb-companion) and iPhones (a Swift helper on CoreMediaIO) are steps 2 and 3. Spec:
     `docs/superpowers/specs/2026-11-03-device-panel-design.md`.
```

- [ ] **Step 4: TESTING.md**

After step 18o, add:

```markdown
18p. Device panel: install Android Studio (or Android's platform tools), plug in an Android phone with
     USB debugging on, and allow this PC when the phone asks. Open a tab in an Android app's folder (one
     with `app\src\main\AndroidManifest.xml`): within a few seconds the phone's screen shows at the top
     of the right pane. Click to tap, drag to swipe, and type with the screen selected; Ctrl+V pastes
     text into a field on the phone; Back, Home and Recent apps in the panel's header work.
18q. Ctrl+Shift+D hides the panel and shows it again. With an emulator running too, the ▾ next to the
     name switches between the two, and a new tab in the same folder shows the one picked last.
18r. Pull the phone's cable: "disconnected" over the dimmed picture, and the panel goes 10 s later.
     Plug it back in: the panel comes back.
18s. Minimise Deck for 15 s, then restore it: the screen streams again within a couple of seconds.
     Task Manager shows no adb.exe left over beyond adb's own server.
```

- [ ] **Step 5: Commit**

```bash
git add CLAUDE.md README.md docs/DECK.md docs/TESTING.md docs/superpowers/specs/2026-11-03-device-panel-design.md
git -c user.email=franco@effektstudios.com commit -m "Docs: the device panel, step 1" -m "Claude-Session: https://claude.ai/code/session_012TidnAXmFkf7jwBCQQo4jJ"
```

- [ ] **Step 6: Review the branch**

Use superpowers:requesting-code-review on `main...m5-device-panel`, then
superpowers:finishing-a-development-branch. A release is a separate step (version bump and
CHANGELOG, as CLAUDE.md describes).
