# Device panel, step 3 (iPhones) Implementation Plan

> **For agentic workers:** REQUIRED SUB-SKILL: Use superpowers:subagent-driven-development (recommended) or superpowers:executing-plans to implement this plan task-by-task. Steps use checkbox (`- [ ]`) syntax for tracking.

**Goal:** In an iOS project's tabs (and any tab, when asked for), show an iPhone plugged into the Mac
live in the device panel, view only. macOS only.

**Architecture:** A small Swift helper inside Deck (`native/iphone-screen/`, built with `swiftc` at
install) turns on macOS's iPhone screen capture devices (CoreMediaIO's switch, as QuickTime does).
`iphone-screen list` prints the screens on offer as JSON lines; main follows it with the same
restarting tracker as the simulators' notifier (extracted into `ios/tracker.ts`) and lists iPhones as
a third source (iOS is pending until the simulators and the iPhones have both listed).
`iphone-screen stream <id>` asks for the camera (an
iPhone's screen is a camera to macOS), captures with AVFoundation, scales with VideoToolbox and
encodes H.264, and writes scrcpy's own video stream from its codec id on, so main reads it with
scrcpy's reader and the view decodes it as it does Android's. A camera macOS refuses is shown at once
as "Camera not allowed" with **Open System Settings**, not retried. The page itself is refused the
camera: Deck's camera entitlement is the helper's. Spec: `docs/superpowers/specs/2026-11-03-device-panel-design.md`
(step 3 of its build order, and its update of 2026-11-11), refined by this plan where noted.

**Tech Stack:** Swift 6 compiler in Swift 5 mode (AVFoundation, CoreMediaIO, VideoToolbox; macOS 13+,
arm64), Electron 45 (main/preload/renderer), Node 22, React 19, TypeScript, vitest. No new npm
dependency.

**Conventions:**
- Node 22: `export PATH="$HOME/.nvm/versions/node/v22.19.0/bin:$PATH"` before npm commands.
- Work in the worktree `~/.config/superpowers/worktrees/deck/m5-device-iphones`, branch
  `m5-device-iphones` (on main's code at Deck 0.5.0, plus the spec's step 3 update). Run `npm ci`
  first if `node_modules` is missing.
- Commits: `git -c user.email=franco@effektstudios.com commit -m "<subject>" -m "Claude-Session: https://claude.ai/code/session_012TidnBvRYbxhSYqPzFZuph"`.
  Never `Co-Authored-By`.
- Comments explain why, in the repo's plain style. Tests sit next to their source as `*.test.ts`.
- Code comments and tests never name other repositories of Franco's (use made-up names); capture
  device IDs in tests are made up.
- The `ios/` tests run on Electron 45's own Node too (24.22; CI runs Node 22):
  `ELECTRON_RUN_AS_NODE=1 ./node_modules/.bin/electron ./node_modules/vitest/vitest.mjs run src/main/devices/ios`.
  If `node_modules/electron/dist` is missing (Electron 45's package fetches its binary separately),
  run `node node_modules/electron/install.js` first.
- **No device is touched before Task 12:** never run `iphone-screen list` or `stream <id>`, the old
  probe, adb or simctl while building. `iphone-screen selftest` (made-up frames) and the usage errors
  (no arguments, `stream` without an ID) open nothing and are fine.
- Never name anything `build` or `ios` outside the paths below: Franco's global gitignore excludes
  every folder of those names (`/build/` and `src/main/devices/ios/` are un-ignored in `.gitignore`).

**Facts this plan relies on** (2026-11-11, Franco's Mac: macOS 27.2, Xcode 27.1, Swift 6.4):
- **The check with Franco's iPhone 17 Pro** (iOS 27, a throwaway probe app; the spec's update of
  2026-11-11): after `kCMIOHardwarePropertyAllowScreenCaptureDevices` = 1 the phone's screen is an
  `AVCaptureDevice`, `modelID` "iOS Device", muxed (no video type), `.external`, named "Franco's
  iPhone", one `muxx` format of 0×0 until frames come. It appeared 0.5 s after the switch with the
  phone plugged in, 2.5 s after a replug. The phone's Continuity Camera is listed too ("Franco's
  iPhone Camera", `iPhone18,1`, video only): never opened. Its `uniqueID` is a UUID, not the UDID,
  the same across runs and replugs. Listing needs no permission; capturing asked for the camera on
  the Mac, for the app that started the process. `AVCaptureDeviceInput` with an
  `AVCaptureVideoDataOutput` (420v) gave 60 frames/s at 1206×2622, none dropped, the first 2.7 s after
  `startRunning()`.
- **The helper as this plan writes it** compiles with no warnings (`swiftc -O -swift-version 5
  -target arm64-apple-macos13.0`), typechecks against the macOS 26.5 SDK too, and in Swift 6 mode
  gives warnings only. Its `selftest` (made-up frames: 6 at 1206×2622, a key frame asked for at the
  4th, 6 at 2622×1206) wrote 154 KB in 0.7 s: codec `h264`, a 736×1600 session, config (SPS and PPS,
  High profile, `avc1.64002a`), key (SEI + IDR), P, P, config, key, P, P, a 1600×736 session, config,
  key, five P: `|ckppckpp|ckppppp`. VideoToolbox here has the hardware encoder
  (`com.apple.videotoolbox.videoencoder.ave.avc`) and a software one
  (`com.apple.videotoolbox.videoencoder.h264`); forced onto the software one the shape is the same,
  so a CI VM without the media engine passes too.
- **Swift details:** a global in `main.swift` is set up in order as its top-level code runs, so one
  declared below a command that never returns is used before it exists: the helpers live in other
  files. The linker signs an executable ad hoc with its output name as identifier, so the build
  writes `iphone-screen` (not `iphone-screen.tmp`) in a temporary folder and moves it.
  `/usr/bin/swiftc` is a shim that offers to install the command line tools in a dialog when there's
  no developer folder; `/usr/bin/xcode-select -p` only answers.
- **Electron 45.2.0** says `LSMinimumSystemVersion` 13.0 (so the helper targets macOS 13), and its
  `Electron.app` carries `NSCameraUsageDescription` "This app needs access to the camera".
- **electron-builder 26.18:** a `mac.extraResources` list adds to the top-level one
  (`getFileMatchers`); every signed file but the app itself gets `entitlementsInherit`, the hardened
  runtime and a timestamp (`MacTargetHelper.getOptionsForFile`), and `@electron/osx-sign` signs every
  binary file under `Contents/` (node-pty's `spawn-helper` in `app.asar.unpacked` already goes through
  notarisation that way). An unsigned `--dir` build with this plan's config put
  `Contents/Resources/iphone-screen` (mode 755, runs) beside `scrcpy-server`, and
  `NSCameraUsageDescription` = Deck's text in `Info.plist`; `before-pack.cjs` stopped a build without
  the helper.
- **Electron grants every permission request** (camera and microphone included) unless a handler says
  otherwise (its security checklist, item 5).
- **TCC attribution:** the camera is asked for, and granted, for the *responsible* process: a packaged
  Deck for its helper. A dev build started from a terminal (`npm run dev`) is that terminal's child, so
  macOS most likely attributes the prompt to the terminal app (which may have no camera usage string:
  then no prompt, just a refusal). Task 12 starts the dev build through LaunchServices (`open`) so
  Electron.app is its own responsible process.

**Where this plan departs from, or refines, the design calls and the spec** (Task 11 writes these
into the spec):
1. **A config packet before every key frame,** not only at a new size: a viewer that joins and a
   decoder that fell behind ask for a key frame, and the view can only decode one after an SPS and PPS
   (scrcpy's reset video restarts its encoder, which resends them; the helper's `key` doesn't).
2. **The start resolves once the helper runs,** not at the first frame: the camera prompt waits for
   Franco, and the streams' 20 s start deadline would kill a helper still waiting for his answer. The
   helper bounds its own waits instead: the screen not offered within 10 s (`not-found`), no frame
   15 s after the capture starts (`no-picture`).
3. **A camera macOS refuses is shown at once, not retried:** `StreamEvents.end(why, blocked)` and
   `blocked: 'camera'` on the error state. Retrying 1, 2 and 5 s can't change System Settings.
4. **More error codes** than `camera-denied` and `not-found`: `no-picture`, `disconnected`,
   `capture` and `encoder` (with a `message`), `usage` (exit 64). Every failure exits 1.
5. **The list also looks every 5 s** (a list the same as the last isn't sent), in case a screen comes
   or goes without `wasConnected`/`wasDisconnected`, which the check didn't watch.
6. **One `LineTracker`** (`ios/tracker.ts`, moved out of `SimulatorTracker`) runs both the
   simulators' notifier and the helper's `list`: restarts 1 s doubling to 30 s, a 20 s first-list
   deadline doubling to 2 min, SIGKILL 2 s after a SIGTERM that's ignored. The notifier's 30 tests
   pass unchanged on it.
7. **iPhones are listed with the phones:** Android phones, iPhones, emulators, simulators (the spec's
   "phones, then emulators, then simulators" within each group of the menu).
8. **The helper's path is settled at start** (`index.ts`, one `statSync`): `iphoneHelper: null`
   without one, so no source answers "no iPhones" late and the existing list tests stand.
9. **The page is refused the camera and microphone** (`src/main/permissions.ts`): with the camera
   entitlement and macOS's yes, Electron would otherwise grant a page's `getUserMedia` too.
10. **A compile failure stops `npm ci`;** only a Mac without Xcode's command line tools skips the
    helper (a note, then no iPhones; a packaged build then stops). The build is skipped when the
    helper is newer than its sources and the build script.

---

## File structure

New:
- `native/iphone-screen/main.swift`: the commands.
- `native/iphone-screen/Output.swift`: stdout (whole writes under a lock), failures as JSON on stderr,
  stdin.
- `native/iphone-screen/Encoder.swift`: scaling, H.264, scrcpy's framing.
- `native/iphone-screen/Screens.swift`: the screens on offer (`list`) and capturing one (`stream`).
- `native/iphone-screen/SelfTest.swift`: made-up frames through the encoder.
- `scripts/build-iphone-helper.mjs`: `swiftc` on macOS, into `native/iphone-screen/out/` (ignored).
- `src/main/devices/ios/tracker.ts`: `LineTracker`, the notifier's restarts and deadlines, for both.
- `src/main/devices/ios/iphone.ts` (+ `iphone.test.ts`): the helper's lists, `IphoneTracker`, an
  iPhone's session, the real io.
- `src/main/devices/ios/iphone-helper.test.ts`: the built helper's `selftest`, read with scrcpy's
  reader (macOS, skipped without the helper).
- `src/main/permissions.ts` (+ test): the page never gets the camera or microphone.

Changed: `src/main/devices/android/protocol.ts` (+ test), `ios/simulators.ts`, `session.ts`,
`streams.ts` (+ test), `registry.ts` (+ test), `ipc.ts` (+ `ipc.test.ts`, `ipc.ios.test.ts`,
`ipc.watch.test.ts`), `src/main/index.ts`, `src/shared/types.ts`, `src/shared/channels.ts`,
`src/preload/index.ts`, `src/renderer/src/device/pick.ts` (+ test), `DevicePanel.tsx`,
`DeviceScreen.tsx`, `device.css`, `scripts/postinstall.mjs`, `scripts/before-pack.cjs`,
`package.json`, `.gitignore`, `electron-builder.yml`, `build/entitlements.mac.plist`, docs.

No workflow changes: `ci.yml` and `release.yml` run `npm ci` on `macos-15`, whose postinstall builds
the helper, so CI runs the selftest and a release packages and signs it.

---

### Task 1: scrcpy's reader, from the codec id on

The helper writes scrcpy's video stream without the tunnel's dummy byte and the device's name. The
reader learns to start at the codec id, and to name its sender in its errors.

**Files:**
- Modify: `src/main/devices/android/protocol.ts`, `src/main/devices/android/protocol.test.ts`

- [ ] **Step 1: Write the failing test**

In `src/main/devices/android/protocol.test.ts`, add as the last test inside `describe('VideoReader', …)`
(after "each packet's data has its own buffer…", where `codecBuf`, `sessionBuf` and `packetBuf` are in
scope):

```ts
  it("reads Deck's iPhone helper's stream, which starts at the codec id, and names it in errors", () => {
    const helper = { from: 'codec', sender: "Deck's iPhone helper" } as const
    expect(new VideoReader(helper).feed(Buffer.concat([codecBuf(CODEC_H264), sessionBuf(736, 1600), packetBuf(1n << 62n, [0, 0, 0, 1, 0x67])]))).toEqual([
      { type: 'codec', codec: CODEC_H264 },
      { type: 'size', width: 736, height: 1600 },
      { type: 'packet', config: true, key: false, data: new Uint8Array([0, 0, 0, 1, 0x67]) },
    ])
    expect(new VideoReader(helper).feed(Buffer.concat([codecBuf(CODEC_H264), sessionBuf(0, 1600)]))).toEqual([
      { type: 'codec', codec: CODEC_H264 },
      { type: 'error', message: "Deck's iPhone helper sent a 0×1600 screen." },
    ])
  })
```

- [ ] **Step 2: Run it and watch it fail**

Run: `npx vitest run src/main/devices/android/protocol.test.ts`
Expected: FAIL: the reader takes the codec id for the dummy byte and waits for a 64-byte name, so it
answers `[]`.

- [ ] **Step 3: Implement**

In `src/main/devices/android/protocol.ts`, end the `VideoReader` doc comment with the helper's case,
make the stage and sender the constructor's, and name the sender in the three errors:

```ts
 *  12-byte header alone, without first waiting for that many bytes to arrive. Once broken, feed()
 *  never throws and only ever returns []: a confused or hostile server can't wedge main.
 *
 *  Deck's iPhone helper writes the same stream from the codec id on (no tunnel, no name): `from:
 *  'codec'`, with `sender` naming it in the errors. */
export class VideoReader {
  private chunks: Buffer[] = []
  private len = 0
  private stage: 'dummy' | 'name' | 'codec' | 'packets'
  private readonly sender: string
```

and, after `private broken = false`:

```ts
  constructor({ from = 'dummy', sender = 'scrcpy' }: { from?: 'dummy' | 'codec'; sender?: string } = {}) {
    this.stage = from
    this.sender = sender
  }
```

The three `this.fail(…)` calls become:

```ts
            this.fail(events, `${this.sender} sent a ${width}×${height} screen.`)
```
```ts
          this.fail(events, `${this.sender} sent a ${size}-byte packet.`)
```
```ts
          this.fail(events, `${this.sender} sent a frame before the screen's size.`)
```

(`scrcpy.ts` keeps `new VideoReader()`, so scrcpy's errors read as before.)

- [ ] **Step 4: Run the tests**

Run: `npx vitest run src/main/devices/android`
Expected: PASS.

- [ ] **Step 5: Commit**

```bash
git add src/main/devices/android/protocol.ts src/main/devices/android/protocol.test.ts
git -c user.email=franco@effektstudios.com commit -m "Devices: scrcpy's reader can start at the codec id" -m "Claude-Session: https://claude.ai/code/session_012TidnBvRYbxhSYqPzFZuph"
```

---

### Task 2: The helper's encoder, framing and selftest

The part of the Swift helper that needs no device: frames scaled, encoded and written as scrcpy's
stream, and a `selftest` that runs them on made-up frames. `npm ci` builds it on macOS; a vitest test
reads the selftest's output with the reader from Task 1, so CI checks the encoder and the framing.

**Files:**
- Create: `native/iphone-screen/main.swift`, `native/iphone-screen/Output.swift`,
  `native/iphone-screen/Encoder.swift`, `native/iphone-screen/SelfTest.swift`,
  `scripts/build-iphone-helper.mjs`, `src/main/devices/ios/iphone-helper.test.ts`
- Modify: `scripts/postinstall.mjs`, `package.json`, `.gitignore`

- [ ] **Step 1: Write the test**

Create `src/main/devices/ios/iphone-helper.test.ts`:

```ts
import { execFile } from 'node:child_process'
import { existsSync } from 'node:fs'
import { resolve } from 'node:path'
import { describe, expect, it } from 'vitest'
import { CODEC_H264, VideoReader } from '../android/protocol'

/** The helper as `npm ci` builds it on macOS (scripts/build-iphone-helper.mjs). */
const HELPER = resolve('native', 'iphone-screen', 'out', 'iphone-screen')

/** The NAL unit types in a packet, by their start codes (H.264 escapes 00 00 00 inside a NAL unit). */
function nalTypes(data: Uint8Array): number[] {
  const types: number[] = []
  for (let i = 0; i + 4 < data.length; i++) {
    if (data[i] === 0 && data[i + 1] === 0 && data[i + 2] === 0 && data[i + 3] === 1) types.push(data[i + 4] & 0x1f)
  }
  return types
}

// No capture device and no camera: `selftest` encodes made-up frames. Skipped off macOS, and on a Mac
// without Xcode's command line tools, which builds no helper.
describe.skipIf(process.platform !== 'darwin' || !existsSync(HELPER))("the iPhone helper's selftest", () => {
  it("scales, encodes and frames made-up frames as scrcpy's stream, with a new session when they turn", async () => {
    const stdout = await new Promise<Buffer>((done, failed) => {
      execFile(HELPER, ['selftest'], { encoding: 'buffer', maxBuffer: 64 * 1024 * 1024, timeout: 20_000 }, (err, out) => (err ? failed(err) : done(out)))
    })
    const events = new VideoReader({ from: 'codec', sender: "Deck's iPhone helper" }).feed(stdout)
    expect(events[0]).toEqual({ type: 'codec', codec: CODEC_H264 })
    expect(events.filter((e) => e.type === 'error')).toEqual([])
    // 1206×2622 within 1600 px, in even numbers, then turned.
    expect(events.filter((e) => e.type === 'size')).toEqual([
      { type: 'size', width: 736, height: 1600 },
      { type: 'size', width: 1600, height: 736 },
    ])
    // | a new size, c a config packet, k a key frame, p any other frame: every key frame behind a
    // config (the first of each size, and the one asked for at the fourth frame).
    const shape = events.slice(1).map((e) => (e.type === 'size' ? '|' : e.type === 'packet' ? (e.config ? 'c' : e.key ? 'k' : 'p') : '?')).join('')
    expect(shape).toBe('|ckppckpp|ckppppp')
    for (const e of events) {
      if (e.type !== 'packet') continue
      if (e.config) expect(nalTypes(e.data)).toEqual([7, 8]) // SPS, PPS
      else if (e.key) expect(nalTypes(e.data)).toContain(5) // an IDR picture
      else expect(nalTypes(e.data)).not.toContain(5)
    }
  }, 30_000)
})
```

- [ ] **Step 2: Run it**

Run: `npx vitest run src/main/devices/ios/iphone-helper.test.ts`
Expected: `1 skipped`: there's no helper yet. (It's skipped, not failed, on Windows and on a Mac
without Xcode's command line tools.)

- [ ] **Step 3: Output**

Create `native/iphone-screen/Output.swift`:

```swift
// Writing to Deck: the stream on stdout, failures on stderr, and Deck's lines on stdin. Kept out of
// main.swift, whose globals are set up in order as its top-level code runs (after the commands
// start, for anything declared below them); a global here is set up when first used.
import Foundation

/// stdout carries one stream: whole writes, one at a time, from any thread.
private let outputLock = NSLock()

/// Writes `data` to stdout whole. A Deck that reads no more (it closed the pipe) ends the process:
/// there's nobody left to send to.
func emit(_ data: Data) {
  outputLock.lock()
  defer { outputLock.unlock() }
  if !writeAll(STDOUT_FILENO, data) { exit(0) }
}

private func writeAll(_ fd: Int32, _ data: Data) -> Bool {
  data.withUnsafeBytes { (raw: UnsafeRawBufferPointer) -> Bool in
    guard var at = raw.baseAddress else { return true }
    var left = raw.count
    while left > 0 {
      let written = write(fd, at, left)
      if written < 0 {
        if errno == EINTR { continue }
        return false
      }
      at += written
      left -= written
    }
    return true
  }
}

/// `value` as one line of JSON, keys sorted.
func jsonLine<T: Encodable>(_ value: T) -> Data {
  let encoder = JSONEncoder()
  encoder.outputFormatting = [.sortedKeys, .withoutEscapingSlashes]
  var line = (try? encoder.encode(value)) ?? Data("{}".utf8)
  line.append(0x0a)
  return line
}

private struct Failure: Encodable {
  let error: String
  let message: String?
}

/// Says why on stderr, as the JSON line Deck reads (iphone.ts), and exits.
func fail(_ code: String, _ message: String? = nil, status: Int32 = 1) -> Never {
  _ = writeAll(STDERR_FILENO, jsonLine(Failure(error: code, message: message)))
  exit(status)
}

/// Deck holds stdin open for as long as it wants this process: its end (Deck stopped it, quit or
/// crashed) ends the process, so none is ever left behind. Each line before then goes to `line`, on
/// a thread of its own.
func followStdin(_ line: @escaping (String) -> Void = { _ in }) {
  let thread = Thread {
    while let text = readLine() { line(text) }
    exit(0)
  }
  thread.start()
}
```

- [ ] **Step 4: The encoder and scrcpy's framing**

Create `native/iphone-screen/Encoder.swift`:

```swift
// A screen's frames as scrcpy's video stream: scaled (VTPixelTransferSession), encoded as H.264
// (VTCompressionSession) and framed as scrcpy 5.0.1's server frames them, from its codec id on, so
// Deck reads them with the reader it has for scrcpy (src/main/devices/android/protocol.ts):
//   the codec id ("h264", 4 bytes, big-endian), once;
//   a session header (12 bytes: 0x80000000, then the width and height) for each frame size;
//   packets: 8 bytes of PTS in microseconds with flags (bit 62: config, bit 61: key frame), a 4-byte
//   size, then the H.264 in Annex B. A config packet holds the SPS and PPS.
import CoreMedia
import CoreVideo
import Foundation
import VideoToolbox

/// scrcpy's codec id for H.264: "h264" in ASCII.
private let codecH264: UInt32 = 0x6832_3634
private let configFlag: UInt64 = 1 << 62
private let keyFlag: UInt64 = 1 << 61
private let startCode: [UInt8] = [0, 0, 0, 1]

/// A frame size with the long side within `maxSize`, never larger than it came, in even numbers
/// (H.264's 4:2:0 halves both sides): 1206×2622 at 1600 is 736×1600.
func fitted(width: Int, height: Int, maxSize: Int) -> (width: Int, height: Int) {
  let scale = min(1, Double(maxSize) / Double(max(width, height)))
  func even(_ side: Int) -> Int {
    let wanted = Int((Double(side) * scale / 2).rounded()) * 2
    return max(2, min(wanted, side / 2 * 2, maxSize / 2 * 2))
  }
  return (even(width), even(height))
}

/// Scales a screen's frames, encodes them and writes them to stdout. Each frame size gets a session
/// header and an encoder of its own (a new size is the phone turning), whose first frame is a key
/// frame. Every key frame comes behind a config packet: a viewer that joins, or a decoder that fell
/// behind, asks for a key frame and needs the SPS and PPS with it. Not thread-safe: one queue calls it.
final class ScreenEncoder {
  private let maxSize: Int
  private let frameRate: Int
  private var session: VTCompressionSession?
  private var size: (width: Int, height: Int) = (0, 0)
  private var transfer: VTPixelTransferSession?
  private var sentCodec = false
  private var keyWanted = false
  private var firstTime = CMTime.invalid

  init(maxSize: Int, frameRate: Int) {
    self.maxSize = maxSize
    self.frameRate = frameRate
  }

  /// The next frame is a key frame.
  func requestKeyFrame() {
    keyWanted = true
  }

  func encode(_ frame: CVPixelBuffer, at time: CMTime) {
    let width = CVPixelBufferGetWidth(frame)
    let height = CVPixelBufferGetHeight(frame)
    let target = fitted(width: width, height: height, maxSize: maxSize)
    if session == nil || target != size { begin(target) }
    guard let session else { return }
    let image = target == (width, height) ? frame : scaled(frame, into: session)
    if !firstTime.isValid { firstTime = time }
    let micros = UInt64(max(0, CMTimeGetSeconds(CMTimeSubtract(time, firstTime))) * 1_000_000)
    var properties: CFDictionary?
    if keyWanted {
      keyWanted = false
      properties = [kVTEncodeFrameOptionKey_ForceKeyFrame as String: true] as CFDictionary
    }
    let status = VTCompressionSessionEncodeFrame(
      session, imageBuffer: image, presentationTimeStamp: time, duration: .invalid,
      frameProperties: properties, infoFlagsOut: nil
    ) { status, flags, sample in
      ScreenEncoder.send(status: status, flags: flags, sample: sample, micros: micros)
    }
    if status != noErr { fail("encoder", "The iPhone's screen couldn't be encoded (VideoToolbox error \(status)).") }
  }

  /// Waits until every frame given so far has been written.
  func flush() {
    if let session { VTCompressionSessionCompleteFrames(session, untilPresentationTimeStamp: .invalid) }
  }

  /// A new encoder for frames of `target`'s size, after the old one's last frames.
  private func begin(_ target: (width: Int, height: Int)) {
    if let old = session {
      VTCompressionSessionCompleteFrames(old, untilPresentationTimeStamp: .invalid)
      VTCompressionSessionInvalidate(old)
      session = nil
    }
    let attributes: [String: Any] = [
      kCVPixelBufferPixelFormatTypeKey as String: kCVPixelFormatType_420YpCbCr8BiPlanarVideoRange,
      kCVPixelBufferWidthKey as String: target.width,
      kCVPixelBufferHeightKey as String: target.height,
      kCVPixelBufferIOSurfacePropertiesKey as String: [String: Any](),
    ]
    var created: VTCompressionSession?
    let status = VTCompressionSessionCreate(
      allocator: nil, width: Int32(target.width), height: Int32(target.height), codecType: kCMVideoCodecType_H264,
      encoderSpecification: nil, imageBufferAttributes: attributes as CFDictionary, compressedDataAllocator: nil,
      outputCallback: nil, refcon: nil, compressionSessionOut: &created)
    guard status == noErr, let created else { fail("encoder", "No H.264 encoder (VideoToolbox error \(status)).") }
    // Real time, no frame reordering (each frame is shown as it's decoded), scrcpy's 8 Mbit/s, and a
    // key frame at least every 10 s. A property an encoder doesn't take stays at its default.
    let properties: [(CFString, CFTypeRef)] = [
      (kVTCompressionPropertyKey_RealTime, kCFBooleanTrue),
      (kVTCompressionPropertyKey_ProfileLevel, kVTProfileLevel_H264_High_AutoLevel),
      (kVTCompressionPropertyKey_AllowFrameReordering, kCFBooleanFalse),
      (kVTCompressionPropertyKey_AverageBitRate, NSNumber(value: 8_000_000)),
      (kVTCompressionPropertyKey_MaxKeyFrameIntervalDuration, NSNumber(value: 10)),
      (kVTCompressionPropertyKey_ExpectedFrameRate, NSNumber(value: frameRate)),
    ]
    for (key, value) in properties { _ = VTSessionSetProperty(created, key: key, value: value) }
    VTCompressionSessionPrepareToEncodeFrames(created)
    session = created
    size = target
    var head = Data()
    if !sentCodec {
      head.append(contentsOf: bigEndian(codecH264))
      sentCodec = true
    }
    head.append(contentsOf: bigEndian(UInt32(0x8000_0000)) + bigEndian(UInt32(target.width)) + bigEndian(UInt32(target.height)))
    emit(head)
  }

  /// `frame` at the encoder's size, in a buffer of its own pool.
  private func scaled(_ frame: CVPixelBuffer, into session: VTCompressionSession) -> CVPixelBuffer {
    if transfer == nil {
      var created: VTPixelTransferSession?
      guard VTPixelTransferSessionCreate(allocator: nil, pixelTransferSessionOut: &created) == noErr else {
        fail("encoder", "The iPhone's screen couldn't be scaled.")
      }
      transfer = created
    }
    var out: CVPixelBuffer?
    guard let transfer, let pool = VTCompressionSessionGetPixelBufferPool(session),
          CVPixelBufferPoolCreatePixelBuffer(nil, pool, &out) == kCVReturnSuccess, let out,
          VTPixelTransferSessionTransferImage(transfer, from: frame, to: out) == noErr else {
      fail("encoder", "The iPhone's screen couldn't be scaled.")
    }
    return out
  }

  /// An encoded frame to stdout: a key frame behind a config packet, in one write.
  private static func send(status: OSStatus, flags: VTEncodeInfoFlags, sample: CMSampleBuffer?, micros: UInt64) {
    if status != noErr { fail("encoder", "The iPhone's screen couldn't be encoded (VideoToolbox error \(status)).") }
    guard !flags.contains(.frameDropped), let sample, let format = CMSampleBufferGetFormatDescription(sample),
          let sets = parameterSets(format), let data = annexB(sample, lengthSize: sets.lengthSize) else { return }
    if isKeyFrame(sample) {
      emit(packet(sets.config, micros: 0, config: true) + packet(data, micros: micros, key: true))
    } else {
      emit(packet(data, micros: micros))
    }
  }
}

private func bigEndian(_ value: UInt32) -> [UInt8] {
  [24, 16, 8, 0].map { UInt8(truncatingIfNeeded: value >> $0) }
}

private func bigEndian(_ value: UInt64) -> [UInt8] {
  [56, 48, 40, 32, 24, 16, 8, 0].map { UInt8(truncatingIfNeeded: value >> $0) }
}

/// scrcpy's packet: the PTS (61 bits) with the flags, the size, then the payload.
private func packet(_ payload: Data, micros: UInt64, config: Bool = false, key: Bool = false) -> Data {
  var head = micros & (keyFlag - 1)
  if config { head |= configFlag }
  if key { head |= keyFlag }
  var out = Data(bigEndian(head) + bigEndian(UInt32(payload.count)))
  out.append(payload)
  return out
}

/// A frame no other depends on: not marked "not sync".
private func isKeyFrame(_ sample: CMSampleBuffer) -> Bool {
  guard let attachments = CMSampleBufferGetSampleAttachmentsArray(sample, createIfNecessary: false) as? [NSDictionary],
        let first = attachments.first else { return true }
  return (first[kCMSampleAttachmentKey_NotSync] as? Bool) != true
}

/// The SPS and PPS behind start codes, and the length of the encoder's NAL length fields.
private func parameterSets(_ format: CMFormatDescription) -> (config: Data, lengthSize: Int)? {
  var count = 0
  var lengthSize: Int32 = 0
  guard CMVideoFormatDescriptionGetH264ParameterSetAtIndex(
    format, parameterSetIndex: 0, parameterSetPointerOut: nil, parameterSetSizeOut: nil,
    parameterSetCountOut: &count, nalUnitHeaderLengthOut: &lengthSize) == noErr else { return nil }
  var config = Data()
  for index in 0..<count {
    var pointer: UnsafePointer<UInt8>?
    var length = 0
    guard CMVideoFormatDescriptionGetH264ParameterSetAtIndex(
      format, parameterSetIndex: index, parameterSetPointerOut: &pointer, parameterSetSizeOut: &length,
      parameterSetCountOut: nil, nalUnitHeaderLengthOut: nil) == noErr, let pointer else { return nil }
    config.append(contentsOf: startCode)
    config.append(pointer, count: length)
  }
  return (config, Int(lengthSize))
}

/// The encoder's NAL units, each behind a big-endian length of `lengthSize` bytes, behind Annex B's
/// start codes instead.
private func annexB(_ sample: CMSampleBuffer, lengthSize: Int) -> Data? {
  guard let block = CMSampleBufferGetDataBuffer(sample), lengthSize > 0 else { return nil }
  let length = CMBlockBufferGetDataLength(block)
  var bytes = [UInt8](repeating: 0, count: length)
  guard CMBlockBufferCopyDataBytes(block, atOffset: 0, dataLength: length, destination: &bytes) == noErr else { return nil }
  var out = Data(capacity: length + 32)
  var at = 0
  while at + lengthSize <= length {
    var size = 0
    for index in 0..<lengthSize { size = size << 8 | Int(bytes[at + index]) }
    at += lengthSize
    guard size > 0, at + size <= length else { return nil }
    out.append(contentsOf: startCode)
    out.append(contentsOf: bytes[at..<at + size])
    at += size
  }
  return out.isEmpty ? nil : out
}
```

- [ ] **Step 5: The selftest, and `main.swift` with only it for now**

Create `native/iphone-screen/SelfTest.swift`:

```swift
// `selftest`: the stream's scaling, encoding and framing on made-up frames, with no device, so CI can
// check them (src/main/devices/ios/iphone-helper.test.ts reads the output with scrcpy's reader).
import CoreMedia
import CoreVideo
import Foundation

/// Six portrait frames at an iPhone 17 Pro's 1206×2622, with a key frame asked for at the fourth,
/// then six turned (2622×1206), as when the phone rotates.
func runSelfTest() -> Never {
  let encoder = ScreenEncoder(maxSize: 1600, frameRate: 60)
  for index in 0..<12 {
    let portrait = index < 6
    if index == 3 { encoder.requestKeyFrame() }
    let frame = madeUpFrame(width: portrait ? 1206 : 2622, height: portrait ? 2622 : 1206, index: index)
    encoder.encode(frame, at: CMTime(value: CMTimeValue(index), timescale: 60))
    // One at a time: a busy runner mustn't make the real-time encoder drop one.
    encoder.flush()
  }
  exit(0)
}

/// Stripes that move with `index`, so each frame differs a little from the one before.
private func madeUpFrame(width: Int, height: Int, index: Int) -> CVPixelBuffer {
  var created: CVPixelBuffer?
  let attributes = [kCVPixelBufferIOSurfacePropertiesKey as String: [String: Any]()] as CFDictionary
  guard CVPixelBufferCreate(nil, width, height, kCVPixelFormatType_420YpCbCr8BiPlanarVideoRange, attributes, &created) == kCVReturnSuccess,
        let frame = created else {
    fail("selftest", "Couldn't make a \(width)×\(height) frame.")
  }
  CVPixelBufferLockBaseAddress(frame, [])
  defer { CVPixelBufferUnlockBaseAddress(frame, []) }
  guard let luma = CVPixelBufferGetBaseAddressOfPlane(frame, 0)?.assumingMemoryBound(to: UInt8.self),
        let chroma = CVPixelBufferGetBaseAddressOfPlane(frame, 1) else {
    fail("selftest", "Couldn't fill a \(width)×\(height) frame.")
  }
  let lumaRow = CVPixelBufferGetBytesPerRowOfPlane(frame, 0)
  for y in 0..<height {
    let row = luma + y * lumaRow
    for x in 0..<width { row[x] = UInt8(truncatingIfNeeded: (x + y) / 4 + index * 8) }
  }
  memset(chroma, 128, CVPixelBufferGetBytesPerRowOfPlane(frame, 1) * CVPixelBufferGetHeightOfPlane(frame, 1))
  return frame
}
```

Create `native/iphone-screen/main.swift` (Task 3 adds `list` and `stream`):

```swift
// iphone-screen: Deck's helper for a connected iPhone's screen, which macOS offers as a capture
// device (the one QuickTime records). For now only its selftest: the stream's scaling, encoding and
// framing on made-up frames, with no device (CI). A failure is one JSON line on stderr,
// {"error":"<code>"} or {"error":"<code>","message":"…"}, then a non-zero exit.
import Foundation

// A closed pipe is an error from write(), not a silent death.
signal(SIGPIPE, SIG_IGN)

let arguments = Array(CommandLine.arguments.dropFirst())
switch arguments.first {
case "selftest":
  runSelfTest()
default:
  fail("usage", "iphone-screen selftest", status: 64)
}
```

- [ ] **Step 6: The build**

Create `scripts/build-iphone-helper.mjs`:

```js
// Builds Deck's iPhone helper (native/iphone-screen/, Swift) into native/iphone-screen/out/, on macOS
// only: run by postinstall (scripts/postinstall.mjs), so dev and CI builds have it, or by hand with
// `npm run build:iphone` after changing it. A Mac without Xcode or its command line tools gets no
// helper, and so no iPhones in the device panel, with a note: a packaged build then stops
// (scripts/before-pack.cjs). A toolchain that's there but fails to build it stops the install.
import { execFileSync } from 'node:child_process'
import { existsSync, mkdirSync, mkdtempSync, readdirSync, realpathSync, renameSync, rmSync, statSync } from 'node:fs'
import { dirname, join } from 'node:path'
import { fileURLToPath } from 'node:url'

const sources = fileURLToPath(new URL('../native/iphone-screen/', import.meta.url))
export const IPHONE_HELPER = join(sources, 'out', 'iphone-screen')
/** Apple silicon only, like Deck; macOS 13, Electron 45's own minimum (its LSMinimumSystemVersion). */
const TARGET = 'arm64-apple-macos13.0'

export function buildIphoneHelper() {
  if (process.platform !== 'darwin') return
  // Without a developer folder, /usr/bin/swiftc (a shim) would offer to install the command line
  // tools in a dialog: xcode-select only answers.
  try {
    execFileSync('/usr/bin/xcode-select', ['-p'], { stdio: 'ignore' })
  } catch {
    console.warn('iphone-screen: no Xcode command line tools, so no iPhones (xcode-select --install, then npm run build:iphone)')
    return
  }
  const files = readdirSync(sources).filter((name) => name.endsWith('.swift')).sort().map((name) => join(sources, name))
  const newest = Math.max(...[...files, fileURLToPath(import.meta.url)].map((file) => statSync(file).mtimeMs))
  if (existsSync(IPHONE_HELPER) && statSync(IPHONE_HELPER).mtimeMs >= newest) {
    console.log('iphone-screen: up to date')
    return
  }
  mkdirSync(dirname(IPHONE_HELPER), { recursive: true })
  // Built in a folder of its own and moved, so a failed build never leaves half a helper; under its
  // own name there, which the linker's signature takes as its identifier. Swift 5 mode: the helper's
  // AVFoundation and VideoToolbox callbacks predate Swift 6's concurrency checks.
  const temp = mkdtempSync(join(dirname(IPHONE_HELPER), 'building-'))
  try {
    const built = join(temp, 'iphone-screen')
    execFileSync('/usr/bin/xcrun', ['swiftc', '-O', '-swift-version', '5', '-target', TARGET, '-o', built, ...files], { stdio: 'inherit' })
    renameSync(built, IPHONE_HELPER)
  } finally {
    rmSync(temp, { recursive: true, force: true })
  }
  console.log('iphone-screen: built')
}

// Run as a script (npm run build:iphone), not imported by postinstall. Node runs the main module by its
// real path, so the comparison is between real paths.
if (process.argv[1] && realpathSync(process.argv[1]) === fileURLToPath(import.meta.url)) buildIphoneHelper()
```

In `scripts/postinstall.mjs`, import it under the `chmodSync` import:

```js
import { buildIphoneHelper } from './build-iphone-helper.mjs'
```

and add at the end of the file:

```js

// Deck's iPhone helper, on macOS (scripts/build-iphone-helper.mjs).
buildIphoneHelper()
```

In `package.json`'s `scripts`, after `"fetch:scrcpy"` (add a comma to that line):

```json
    "build:iphone": "node scripts/build-iphone-helper.mjs"
```

Append to `.gitignore`:

```
# Deck's iPhone helper, built at install (scripts/build-iphone-helper.mjs)
/native/iphone-screen/out/
```

- [ ] **Step 7: Build it, twice**

Run: `npm run build:iphone && npm run build:iphone`
Expected: `iphone-screen: built` (about 6 s, no compiler warnings), then `iphone-screen: up to date`.

Run: `./native/iphone-screen/out/iphone-screen; echo "exit $?"`
Expected: `{"error":"usage","message":"iphone-screen selftest"}` and `exit 64`.

Run: `./native/iphone-screen/out/iphone-screen selftest | wc -c; lipo -archs native/iphone-screen/out/iphone-screen; codesign -dv native/iphone-screen/out/iphone-screen 2>&1 | grep Identifier`
Expected: about 154000 bytes, `arm64`, `Identifier=iphone-screen`.

Run: `git status --short`
Expected: the new sources and scripts, and no `native/iphone-screen/out/`.

- [ ] **Step 8: Run the test**

Run: `npx vitest run src/main/devices/ios/iphone-helper.test.ts`
Expected: PASS (1 test): codec `h264`, sizes 736×1600 then 1600×736, shape `|ckppckpp|ckppppp`.

- [ ] **Step 9: Commit**

```bash
git add native scripts/build-iphone-helper.mjs scripts/postinstall.mjs package.json .gitignore src/main/devices/ios/iphone-helper.test.ts
git -c user.email=franco@effektstudios.com commit -m "iPhones: the helper's encoder, scrcpy's framing and a selftest, built at install" -m "Claude-Session: https://claude.ai/code/session_012TidnBvRYbxhSYqPzFZuph"
```

---

### Task 3: The helper's list and stream

The two commands that open capture devices. Build them and check their argument errors only: they
run against Franco's iPhone in Task 12.

**Files:**
- Create: `native/iphone-screen/Screens.swift`
- Modify: `native/iphone-screen/main.swift`

- [ ] **Step 1: The screens**

Create `native/iphone-screen/Screens.swift`:

```swift
// The iPhone screens macOS offers: listing them (`list`) and capturing one (`stream`).
import AVFoundation
import CoreMediaIO

/// macOS offers an iPhone's or iPad's screen (plugged in, unlocked, trusting this Mac) as a capture
/// device only to a process that asks for screen capture devices, as QuickTime does. They appear a
/// moment later: 0.5 s with the phone already plugged in, 2.5 s after plugging it in (measured
/// 2026-11-11).
func allowScreenCaptureDevices() {
  var address = CMIOObjectPropertyAddress(
    mSelector: CMIOObjectPropertySelector(kCMIOHardwarePropertyAllowScreenCaptureDevices),
    mScope: CMIOObjectPropertyScope(kCMIOObjectPropertyScopeGlobal),
    mElement: CMIOObjectPropertyElement(kCMIOObjectPropertyElementMain))
  var allow: UInt32 = 1
  let status = CMIOObjectSetPropertyData(
    CMIOObjectID(kCMIOObjectSystemObject), &address, 0, nil, UInt32(MemoryLayout<UInt32>.size), &allow)
  if status != 0 { fail("capture", "macOS didn't offer iPhone screens (CoreMediaIO error \(status)).") }
}

/// The phone and tablet screens on offer: model "iOS Device", with muxed media. Not the phone's own
/// camera, which macOS lists too (a Continuity Camera: its model, video only), and which is never
/// opened.
func screenDevices() -> [AVCaptureDevice] {
  let types: [AVCaptureDevice.DeviceType]
  if #available(macOS 14.0, *) {
    types = [.external]
  } else {
    types = [.externalUnknown]
  }
  return AVCaptureDevice.DiscoverySession(deviceTypes: types, mediaType: nil, position: .unspecified).devices
    .filter { $0.modelID == "iOS Device" && $0.hasMediaType(.muxed) }
}

private struct Screen: Encodable {
  let id: String
  let name: String
}

private struct ScreenList: Encodable {
  let devices: [Screen]
}

/// `list`: the first list 3 s after the start, so the screens that turn up in the first moments
/// (above) are in it, and Deck, which waits for every kind's first list, isn't told "none" too soon.
/// Then a new list 200 ms after the last connect or disconnect, and a look every 5 s in case a screen
/// came or went unannounced. A list the same as the last isn't sent again.
func runList() -> Never {
  allowScreenCaptureDevices()
  let lister = Lister()
  lister.start()
  followStdin()
  RunLoop.main.run()
  exit(0)
}

/// The list's state, on the main queue.
private final class Lister {
  private var last: Data?
  private var started = false
  private var pending: DispatchWorkItem?

  func start() {
    for name in [AVCaptureDevice.wasConnectedNotification, AVCaptureDevice.wasDisconnectedNotification] {
      NotificationCenter.default.addObserver(forName: name, object: nil, queue: .main) { [self] _ in changed() }
    }
    DispatchQueue.main.asyncAfter(deadline: .now() + 3) { [self] in
      started = true
      send()
      Timer.scheduledTimer(withTimeInterval: 5, repeats: true) { [self] _ in send() }
    }
  }

  private func changed() {
    guard started else { return }
    pending?.cancel()
    let item = DispatchWorkItem { [self] in send() }
    pending = item
    DispatchQueue.main.asyncAfter(deadline: .now() + 0.2, execute: item)
  }

  private func send() {
    let screens = screenDevices()
      .map { Screen(id: $0.uniqueID, name: $0.localizedName) }
      .sorted { ($0.name, $0.id) < ($1.name, $1.id) }
    let line = jsonLine(ScreenList(devices: screens))
    if line == last { return }
    last = line
    emit(line)
  }
}

/// `stream <id> [--max-size N] [--max-fps N]`: capture device `id`'s screen, scaled and encoded
/// (Encoder.swift).
func runStream(_ arguments: [String]) -> Never {
  var id: String?
  var maxSize = 1600
  var maxFrameRate = 60
  var rest = arguments[...]
  while let argument = rest.popFirst() {
    switch argument {
    case "--max-size":
      maxSize = number(rest.popFirst(), within: 16...8192)
    case "--max-fps":
      maxFrameRate = number(rest.popFirst(), within: 1...240)
    default:
      if id != nil || argument.hasPrefix("-") { fail("usage", "iphone-screen stream <id> [--max-size N] [--max-fps N]", status: 64) }
      id = argument
    }
  }
  guard let id else { fail("usage", "iphone-screen stream <id> [--max-size N] [--max-fps N]", status: 64) }
  allowScreenCaptureDevices()
  let capture = ScreenCapture(id: id, encoder: ScreenEncoder(maxSize: maxSize, frameRate: maxFrameRate), maxFrameRate: maxFrameRate)
  followStdin { line in
    if line.trimmingCharacters(in: .whitespaces) == "key" { capture.requestKeyFrame() }
  }
  capture.start()
  RunLoop.main.run()
  exit(0)
}

private func number(_ text: String?, within range: ClosedRange<Int>) -> Int {
  guard let text, let value = Int(text), range.contains(value) else {
    fail("usage", "iphone-screen stream <id> [--max-size N] [--max-fps N]", status: 64)
  }
  return value
}

/// One screen's capture: the camera allowed, the device found, then its frames to the encoder on a
/// queue of their own.
private final class ScreenCapture: NSObject, AVCaptureVideoDataOutputSampleBufferDelegate {
  /// The screen appears about 0.5 s after it's asked for (allowScreenCaptureDevices).
  private static let findWithin: TimeInterval = 10
  /// The first frame came 2.7 s after the capture started (measured).
  private static let firstFrameWithin: TimeInterval = 15

  private let id: String
  private let encoder: ScreenEncoder
  private let maxFrameRate: Int
  private let session = AVCaptureSession()
  private let frames = DispatchQueue(label: "iphone-screen.frames")
  /// On `frames`: the last frame encoded, and how many were.
  private var lastFrame = CMTime.invalid
  private var encoded = 0

  init(id: String, encoder: ScreenEncoder, maxFrameRate: Int) {
    self.id = id
    self.encoder = encoder
    self.maxFrameRate = maxFrameRate
  }

  /// macOS treats the screen as a camera: the first capture asks, for the app that started this
  /// process (Deck), and the answer stands for every later one.
  func start() {
    switch AVCaptureDevice.authorizationStatus(for: .video) {
    case .authorized:
      find(since: Date())
    case .notDetermined:
      AVCaptureDevice.requestAccess(for: .video) { allowed in
        DispatchQueue.main.async {
          if !allowed { fail("camera-denied") }
          self.find(since: Date())
        }
      }
    default:
      fail("camera-denied")
    }
  }

  func requestKeyFrame() {
    frames.async { self.encoder.requestKeyFrame() }
  }

  private func find(since: Date) {
    if let device = screenDevices().first(where: { $0.uniqueID == id }) { return open(device) }
    if Date().timeIntervalSince(since) >= Self.findWithin { fail("not-found") }
    DispatchQueue.main.asyncAfter(deadline: .now() + 0.25) { self.find(since: since) }
  }

  private func open(_ device: AVCaptureDevice) {
    let input: AVCaptureDeviceInput
    do {
      input = try AVCaptureDeviceInput(device: device)
    } catch {
      fail("capture", "The iPhone's screen couldn't be opened: \(error.localizedDescription)")
    }
    guard session.canAddInput(input) else { fail("capture", "The iPhone's screen couldn't be opened.") }
    session.addInput(input)
    let output = AVCaptureVideoDataOutput()
    output.videoSettings = [kCVPixelBufferPixelFormatTypeKey as String: kCVPixelFormatType_420YpCbCr8BiPlanarVideoRange]
    output.alwaysDiscardsLateVideoFrames = true
    output.setSampleBufferDelegate(self, queue: frames)
    guard session.canAddOutput(output) else { fail("capture", "The iPhone's screen couldn't be read.") }
    session.addOutput(output)
    NotificationCenter.default.addObserver(forName: AVCaptureSession.runtimeErrorNotification, object: session, queue: .main) { note in
      let error = note.userInfo?[AVCaptureSessionErrorKey] as? Error
      fail("capture", "The iPhone's screen stopped: \(error?.localizedDescription ?? "no reason given").")
    }
    NotificationCenter.default.addObserver(forName: AVCaptureDevice.wasDisconnectedNotification, object: device, queue: .main) { _ in
      fail("disconnected")
    }
    // startRunning() blocks until the capture runs: not on the main thread.
    frames.async { self.session.startRunning() }
    DispatchQueue.main.asyncAfter(deadline: .now() + Self.firstFrameWithin) {
      self.frames.async { if self.encoded == 0 { fail("no-picture") } }
    }
  }

  func captureOutput(_ output: AVCaptureOutput, didOutput sampleBuffer: CMSampleBuffer, from connection: AVCaptureConnection) {
    guard let frame = CMSampleBufferGetImageBuffer(sampleBuffer) else { return }
    let time = CMSampleBufferGetPresentationTimeStamp(sampleBuffer)
    // --max-fps: a frame sooner than ¾ of its gap after the last is skipped, so the jitter of a
    // 60 Hz screen doesn't thin it at 60.
    if lastFrame.isValid, CMTimeGetSeconds(CMTimeSubtract(time, lastFrame)) < 0.75 / Double(maxFrameRate) { return }
    lastFrame = time
    encoded += 1
    encoder.encode(frame, at: time)
  }
}
```

- [ ] **Step 2: Every command in `main.swift`**

Replace `native/iphone-screen/main.swift` with:

```swift
// iphone-screen: Deck's helper for a connected iPhone's screen, which macOS offers as a capture
// device (the one QuickTime records). Deck runs it from src/main/devices/ios/iphone.ts:
//
//   iphone-screen list
//       a JSON line on stdout for each change of the screens on offer:
//       {"devices":[{"id":"<capture device ID>","name":"Franco's iPhone"}]}
//   iphone-screen stream <id> [--max-size 1600] [--max-fps 60]
//       that screen as H.264 on stdout, framed as scrcpy's video stream from its codec id on, so
//       Deck reads it with scrcpy's reader (android/protocol.ts); a line "key" on stdin asks for a
//       key frame
//   iphone-screen selftest
//       the stream's scaling, encoding and framing on made-up frames, with no device (CI)
//
// list and stream run until their stdin closes. A failure is one JSON line on stderr,
// {"error":"<code>"} or {"error":"<code>","message":"…"}, then a non-zero exit.
import Foundation

// A closed pipe is an error from write(), not a silent death.
signal(SIGPIPE, SIG_IGN)

let arguments = Array(CommandLine.arguments.dropFirst())
switch arguments.first {
case "list":
  runList()
case "stream":
  runStream(Array(arguments.dropFirst()))
case "selftest":
  runSelfTest()
default:
  fail("usage", "iphone-screen list | stream <id> [--max-size N] [--max-fps N] | selftest", status: 64)
}
```

- [ ] **Step 3: Build, and check the argument errors (nothing opened)**

Run: `npm run build:iphone`
Expected: `iphone-screen: built`, no warnings.

Run:
```bash
./native/iphone-screen/out/iphone-screen; echo "exit $?"
./native/iphone-screen/out/iphone-screen stream; echo "exit $?"
./native/iphone-screen/out/iphone-screen stream --max-size 9; echo "exit $?"
```
Expected: `{"error":"usage","message":"iphone-screen list | stream <id> [--max-size N] [--max-fps N] | selftest"}`
then twice `{"error":"usage","message":"iphone-screen stream <id> [--max-size N] [--max-fps N]"}`, each
with `exit 64`. (`runStream` checks its arguments before it turns screen capture devices on.)

- [ ] **Step 4: An older SDK, for CI's Xcode**

Run:
`/Library/Developer/CommandLineTools/usr/bin/swiftc -typecheck -swift-version 5 -target arm64-apple-macos13.0 -sdk /Library/Developer/CommandLineTools/SDKs/MacOSX26.sdk native/iphone-screen/*.swift`
Expected: no output. (`macos-15` runners may build with an older Xcode than Franco's; the helper
uses nothing newer than macOS 14's `.external`, behind `#available`.)

- [ ] **Step 5: The selftest still passes**

Run: `npx vitest run src/main/devices/ios/iphone-helper.test.ts`
Expected: PASS.

- [ ] **Step 6: Commit**

```bash
git add native
git -c user.email=franco@effektstudios.com commit -m "iPhones: the helper lists the screens on offer and streams one" -m "Claude-Session: https://claude.ai/code/session_012TidnBvRYbxhSYqPzFZuph"
```

---

### Task 4: One LineTracker for the notifier and the helper

The simulators' notifier and the helper's `list` are the same kind of program: long-running, a list
per line, to be restarted with backoff and killed when hung. `SimulatorTracker`'s machinery moves into
a generic `LineTracker`; the notifier keeps only what's its own (the change lines, `booted()`). A
refactor: the notifier's 30 tests are the net and stay as they are.

**Files:**
- Create: `src/main/devices/ios/tracker.ts`
- Modify: `src/main/devices/ios/simulators.ts`

- [ ] **Step 1: The tests before**

Run: `npx vitest run src/main/devices/ios/simulators.test.ts`
Expected: PASS (30 tests).

- [ ] **Step 2: The tracker**

Create `src/main/devices/ios/tracker.ts`:

```ts
import type { ChildProcess } from 'node:child_process'
import { asFailure, endedHow, lastLine, stopper } from './process'

export interface LineTrackerDeps<L> {
  /** The program, as its failures name it ("idb_companion stopped."). */
  name: string
  /** Starts it. Spawning can throw synchronously (ENOEXEC: a file with the execute bit that isn't a
   *  program; -86 for an Intel binary without Rosetta). */
  spawn(): ChildProcess
  /** One line of its stdout as a list, or null for a line that isn't one. `first`: this run hasn't
   *  listed yet. */
  parse(line: string, first: boolean): L | null
  /** Each list, as it comes. */
  publish(list: L): void
  /** It stopped (it starts again soon): its last words, and whether *this run* had listed anything
   *  before it died. */
  failed(why: string, listed: boolean): void
}

/** No line is ever this long: a run of garbage with no newline. */
const MAX_PENDING_LINE = 4 * 1024 * 1024
/** A run that lists nothing in this long is treated as hung and killed (idb-companion's first line
 *  normally comes in about 2.5 s, the iPhone helper's at 3 s). Doubles after each such kill (capped
 *  at DEADLINE_MAX), since a program that needs longer than this on every cold start would otherwise
 *  loop forever; a run that lists resets it back to this. */
const FIRST_LIST_DEADLINE = 20_000
const DEADLINE_MAX = 120_000
const RESTART_MIN = 1000
const RESTART_MAX = 30_000

/** Follows a long-running program that prints lists, one per line: idb_companion's simulator
 *  notifier, the iPhone helper's screens. If it stops, it's started again after 1 s, then twice the
 *  wait each time, up to 30 s; the wait goes back to 1 s after a run of 30 s on its own (a run killed
 *  for being hung never counts as that, however long we let it run first). `spawn()` throwing (a bad
 *  spawn) is handled the same way as the process dying later, so the tracker is never left wedged. A
 *  run that never lists anything within its deadline (20 s at first, doubling each time this happens,
 *  up to 2 min; a list resets it) is treated as hung and killed: SIGTERM, then SIGKILL 2 s later if
 *  it's still running (idb_companion handles SIGTERM itself on a dispatch queue, so a hung one may
 *  never act on it) — the same escalation `stop()` uses, so a hung program is never left running
 *  past a stop either. */
export class LineTracker<L> {
  private child: ChildProcess | null = null
  /** Ends the running program (process.ts's stopper): SIGTERM, then SIGKILL if it's still running
   *  2 s later. */
  private stopChild: (() => void) | null = null
  private timer: ReturnType<typeof setTimeout> | null = null
  private deadline: ReturnType<typeof setTimeout> | null = null
  private wait = RESTART_MIN
  private deadlineMs = FIRST_LIST_DEADLINE
  private running = false

  constructor(private readonly deps: LineTrackerDeps<L>) {}

  start(): void {
    if (this.running) return
    this.running = true
    this.run()
  }

  stop(): void {
    this.running = false
    if (this.timer) clearTimeout(this.timer)
    this.timer = null
    this.clearDeadline()
    const stopChild = this.stopChild
    this.child = null
    this.stopChild = null
    stopChild?.()
  }

  private run(): void {
    let child: ChildProcess
    try {
      child = this.deps.spawn()
    } catch (err) {
      this.ended(err instanceof Error ? err.message : String(err), 0, false)
      return
    }
    this.child = child
    const stopChild = stopper(child)
    this.stopChild = stopChild
    const said = lastLine(child.stderr)
    const startedAt = Date.now()
    let first = true
    let rest = ''
    let listed = false
    let done = false

    const finish = (why: string, hung = false) => {
      if (done || this.child !== child) return
      done = true
      this.clearDeadline()
      this.child = null
      this.stopChild = null
      this.ended(why, Date.now() - startedAt, listed, hung)
    }
    // A run stuck longer than this (its own deadlineMs, which grows the more this keeps happening)
    // is hung (idb-companion wedged, a CoreSimulator or CoreMediaIO problem that never prints
    // anything) and is killed rather than left silently providing no devices forever.
    const deadlineMs = this.deadlineMs
    this.deadline = setTimeout(() => {
      this.deadlineMs = Math.min(this.deadlineMs * 2, DEADLINE_MAX) // for next time, if this keeps happening
      finish(`${this.deps.name} listed nothing in ${deadlineMs / 1000} s.`, true)
      stopChild()
    }, deadlineMs)

    child.stdout?.setEncoding('utf8')
    child.stdout?.on('data', (text: string) => {
      if (this.child !== child) return
      const lines = (rest + text).split('\n')
      rest = lines.pop() ?? ''
      if (rest.length > MAX_PENDING_LINE) rest = '' // no line is this long: garbage
      for (const line of lines) {
        if (!line.trim()) continue
        const list = this.guard('reading', () => this.deps.parse(line, first)) ?? null
        if (list === null) continue
        first = false
        listed = true
        this.deadlineMs = FIRST_LIST_DEADLINE // proof it can answer quickly: back to the base wait
        this.clearDeadline()
        this.guard('publishing', () => this.deps.publish(list))
      }
    })
    // 'error' and 'close' can both fire for a failed spawn (e.g. EACCES): whichever comes first
    // finalizes the run (finish's own guard drops the other), each with its own best reason. Its
    // stderr's last line is only a reason when it reads as a failure (asFailure): idb at --log-level
    // info prints routine chatter there too.
    child.on('error', (err) => finish(asFailure(said()) || err.message))
    child.on('close', (code, signal) => finish(asFailure(said()) || endedHow(this.deps.name, code, signal)))
  }

  /** `listed`: whether the run that just ended had listed anything before it died (not sticky across
   *  restarts). `hung`: it was killed by the first-list deadline, not a death of its own. */
  private ended(why: string, ranMs: number, listed: boolean, hung = false): void {
    if (!this.running) return
    // A run that lasted as long as the longest wait, on its own, means the program is healthy again:
    // back off from scratch next time, rather than keep the slow pace a past failure earned. A run we
    // had to kill for being hung proves nothing of the sort, however long its (grown) deadline let it
    // run first, so it never resets this.
    if (!hung && ranMs >= RESTART_MAX) this.wait = RESTART_MIN
    this.guard('reporting a failure of', () => this.deps.failed(why, listed))
    const wait = this.wait
    this.timer = setTimeout(() => {
      this.timer = null
      if (this.running) this.run()
    }, wait)
    this.wait = Math.min(this.wait * 2, RESTART_MAX)
  }

  private clearDeadline(): void {
    if (this.deadline) {
      clearTimeout(this.deadline)
      this.deadline = null
    }
  }

  /** The callbacks run inside a stream's handler or a timer: a throw there would reach only main's
   *  last-resort log and leave the run half handled. */
  private guard<T>(doing: string, run: () => T): T | undefined {
    try {
      return run()
    } catch (err) {
      console.error(`devices: ${doing} ${this.deps.name}'s list failed`, err)
      return undefined
    }
  }
}
```

- [ ] **Step 3: The notifier on it**

In `src/main/devices/ios/simulators.ts`, replace the import of `./process` with
`import { LineTracker } from './tracker'`, keep `SimulatorTrackerDeps` as it is, and replace
everything from `/** No line is ever this long: a run of garbage with no newline. */` to the end of
the file with:

```ts
/** Follows the simulators with one long-running notifier, restarted and timed out as LineTracker
 *  does (tracker.ts). Its first line lists every simulator, each later one only those whose state
 *  changed. A run that never listed clears what's known, so `booted()` reports false rather than
 *  stale news from a much earlier run. */
export class SimulatorTracker {
  private targets = new Map<string, SimTarget>()
  private readonly lines: LineTracker<Map<string, SimTarget>>

  constructor(deps: SimulatorTrackerDeps) {
    this.lines = new LineTracker({
      name: 'idb_companion',
      spawn: () => deps.notify(),
      parse: (line, first) => readNotifyLine(line, this.targets, first),
      publish: (targets) => {
        this.targets = targets
        deps.publish(simulatorDevices(targets))
      },
      failed: (why, listed) => {
        if (!listed) this.targets = new Map()
        deps.failed(why, listed)
      },
    })
  }

  start(): void {
    this.lines.start()
  }

  stop(): void {
    this.lines.stop()
  }

  /** Whether simulator `udid` was booted at the last line. */
  booted(udid: string): boolean {
    return this.targets.get(udid)?.state === 'Booted'
  }
}
```

(`publish` stores the targets before it publishes, and `LineTracker` counts the run as listed before
it calls `publish`: a `publish` that throws still leaves `booted()` right, as the "guards" test
checks, and the run listed.)

- [ ] **Step 4: The same tests, on both Nodes, and the typecheck**

Run: `npx vitest run src/main/devices/ios && ELECTRON_RUN_AS_NODE=1 ./node_modules/.bin/electron ./node_modules/vitest/vitest.mjs run src/main/devices/ios && npm run typecheck`
Expected: PASS everywhere; `simulators.test.ts` 30 tests, unchanged.

- [ ] **Step 5: Commit**

```bash
git add src/main/devices/ios/tracker.ts src/main/devices/ios/simulators.ts
git -c user.email=franco@effektstudios.com commit -m "Devices: the notifier's restarts and deadlines as a LineTracker of their own" -m "Claude-Session: https://claude.ai/code/session_012TidnBvRYbxhSYqPzFZuph"
```

---

### Task 5: The shared types, and a stream the camera blocks

iPhones join the shared types (`kind: 'iphone'`, `openCameraSettings`), and a stream can end
*blocked*: what stops it is the user's to change in System Settings, so it's shown at once rather than
retried 1, 2 and 5 s.

**Files:**
- Modify: `src/shared/types.ts`, `src/shared/channels.ts`, `src/preload/index.ts`,
  `src/main/devices/session.ts`, `src/main/devices/streams.ts`, `src/main/devices/streams.test.ts`

- [ ] **Step 1: Write the failing test**

In `src/main/devices/streams.test.ts`, add before the test "a viewer joining before the first packet
gets connecting…":

```ts
  it('a blocked stream (the camera not allowed) says so at once, to every viewer, until retry()', async () => {
    const { streams, started, sent, attempts } = setup()
    streams.view('iphone:A1')
    await flush()
    started[0].events.end("macOS hasn't let Deck use the camera.", 'camera')
    const blocked = { type: 'state', state: 'error', message: "macOS hasn't let Deck use the camera.", blocked: 'camera' }
    expect(sent.at(-1)).toEqual(['iphone:A1', blocked])
    await vi.advanceTimersByTimeAsync(10_000)
    expect(attempts()).toBe(1) // not retried: only System Settings can change it
    streams.view('iphone:A1') // a second tab
    expect(sent.at(-1)).toEqual(['iphone:A1', blocked])
    streams.retry('iphone:A1') // Try again, once allowed
    await flush()
    expect(attempts()).toBe(2)
  })

```

- [ ] **Step 2: Run it and watch it fail**

Run: `npx vitest run src/main/devices/streams.test.ts`
Expected: FAIL: the end is taken as a break (`reconnecting`), and the stream is started again.

- [ ] **Step 3: The shared types**

In `src/shared/types.ts`, `DeviceInfo`'s doc, `id`, `kind`, `name` and `detail` become:

```ts
/** A device Deck can show: an Android phone or emulator adb sees, a booted simulator, or an iPhone
 *  on a cable. */
export interface DeviceInfo {
  /** The same across reconnects and connections: `android:<serial number>`,
   *  `emulator:<AVD name>` (an emulator's adb name changes with its port), `simulator:<UDID>`, or
   *  `iphone:<capture device ID>` (the ID macOS gives its screen: not the UDID, but the same across
   *  reconnects). */
  id: string
  kind: 'android' | 'emulator' | 'simulator' | 'iphone'
  /** The name set on the phone ("Franco's S25 FE"), else its maker and model; an emulator's AVD
   *  name; a simulator's or an iPhone's name. */
  name: string
  /** Its system and connection: "Android 13 · USB", "Android 17 · USB + Wi-Fi",
   *  "Emulator · Android 15", "Simulator · iOS 27.0", "iPhone · cable · view only". */
  detail: string
```

(`state` stays as it is.) `DevicePlatform` and what follows it:

```ts
/** What a device runs: Android phones and emulators, or iOS simulators and iPhones. */
export type DevicePlatform = 'android' | 'ios'

/** What stops a stream that only the user can change, so it isn't retried: 'camera', macOS hasn't let
 *  Deck use the camera (an iPhone's screen is a camera to macOS). */
export type DeviceBlock = 'camera'
```

`DeviceList.pending`'s doc: "The platforms still finding their first devices (iOS: the simulators or
the iPhones): a tab waits only for the ones it shows." `DeviceProject.ios`'s doc: "It's an iOS app (an
Xcode project or workspace), so it takes simulators and iPhones."

`DeviceStreamEvent`'s state member:

```ts
  /** connecting: starting; live: frames are coming; reconnecting: it broke and is starting again;
   *  error: it couldn't be started (`message`), until Try again; `blocked`: and only the user can
   *  change why (System Settings). */
  | { type: 'state'; state: 'connecting' | 'live' | 'reconnecting' | 'error'; message?: string; blocked?: DeviceBlock }
```

In `DeckApi.devices`, `watch`'s doc becomes "Look for devices (adb, and on macOS idb-companion for
simulators and Deck's helper for iPhones) from now; the function stops this look. They run while any
look is on, so only while some tab needs devices.", and after `screenshot`:

```ts
    /** Opens System Settings at Privacy & Security → Camera (macOS), where Deck is let use the
     *  camera an iPhone's screen is. */
    openCameraSettings(): void
```

In `src/shared/channels.ts`, after `devicesScreenshot`:

```ts
  devicesCameraSettings: 'devices:camera-settings',
```

In `src/preload/index.ts`, after `screenshot` in `devices`:

```ts
    openCameraSettings: () => ipcRenderer.send(IPC.devicesCameraSettings),
```

(Main listens from Task 8 on; until then the message goes nowhere.)

- [ ] **Step 4: The session's end says what blocks it**

In `src/main/devices/session.ts`, import `DeviceBlock` beside `DeviceStreamEvent`, and:

```ts
  /** The stream ended by itself: why. Not called after stop(). `blocked`: what stops it is the user's
   *  to change (macOS hasn't let Deck use the camera), so it's shown at once, not retried. */
  end(why: string, blocked?: DeviceBlock): void
```

and `DeviceSession`'s doc begins "A running stream: scrcpy's server on an Android device, idb on a
simulator, Deck's helper on an iPhone. None of its methods throws: …" (the rest as it is).

- [ ] **Step 5: The streams**

In `src/main/devices/streams.ts`, import `DeviceBlock` beside `DeviceStreamEvent`. `Stream.error`
keeps the event itself, to send again to a viewer that joins:

```ts
  /** The error shown once the retries ran out (or at once, for a blocked stream), and again to a
   *  viewer that joins; cleared by begin() (retry(), resume(), or a fresh view after every viewer had
   *  left and dropped the stream). */
  error: Extract<DeviceStreamEvent, { type: 'state' }> | null
```

The class doc's sentence after "…and resume() clear an error too." gains: "A blocked one (macOS
hasn't let Deck use the camera) reports it at once: only the user can change that." In `view()`:

```ts
    if (s.error) return this.deps.send(id, s.error)
```

In `begin()`, `end: (why) => {` becomes `end: (why, blocked) => {`, and its last line
`this.failed(id, s, why, blocked)`. `failed()` becomes:

```ts
  private failed(id: string, s: Stream, why: string, blocked?: DeviceBlock): void {
    if (s.viewers === 0) return this.drop(id, s)
    if (this.paused) return
    // Blocked (the camera, in System Settings): another start would only be refused again.
    if (!blocked && s.failures < this.retryMs.length) {
      const wait = this.retryMs[s.failures++]
      this.deps.send(id, { type: 'state', state: 'reconnecting' })
      s.retryTimer = setTimeout(() => {
        s.retryTimer = null
        if (this.streams.get(id) === s && s.viewers > 0 && !this.paused) this.begin(id, s)
      }, wait)
      return
    }
    s.error = { type: 'state', state: 'error', message: why, ...(blocked ? { blocked } : {}) }
    this.deps.send(id, s.error)
  }
```

(`begin()`'s `s.error = null` and `retry()`'s `!s.error` read as before.)

- [ ] **Step 6: Run the tests and the typecheck**

Run: `npx vitest run src/main/devices && npm run typecheck`
Expected: PASS. (`pick.ts` takes an `'iphone'` for Android until Task 9, and `DevicePanel` would give
it Android's buttons: nothing lists one before Task 8.)

- [ ] **Step 7: Commit**

```bash
git add src/shared/types.ts src/shared/channels.ts src/preload/index.ts src/main/devices/session.ts src/main/devices/streams.ts src/main/devices/streams.test.ts
git -c user.email=franco@effektstudios.com commit -m "Devices: iPhones in the shared types; a stream the camera blocks says so at once" -m "Claude-Session: https://claude.ai/code/session_012TidnBvRYbxhSYqPzFZuph"
```

---

### Task 6: The helper's list, in main

Main reads `iphone-screen list`'s lines, turns them into devices and follows the helper with the
`LineTracker`.

**Files:**
- Create: `src/main/devices/ios/iphone.ts`, `src/main/devices/ios/iphone.test.ts`

- [ ] **Step 1: Write the failing tests**

Create `src/main/devices/ios/iphone.test.ts`:

```ts
import { afterEach, beforeEach, describe, expect, it, vi } from 'vitest'
import { iphoneDevices, iphoneIo, IphoneTracker, readScreenList, screenIdOf } from './iphone'
import { fakeProcess, type FakeProcess } from './test-process'

// Made-up capture device IDs: the real ones are UUIDs.
const A = '0A0A0A0A-1111-2222-3333-444444444444'
const B = 'B0B0B0B0-1111-2222-3333-444444444444'
const list = (...devices: unknown[]) => `${JSON.stringify({ devices })}\n`

describe('readScreenList', () => {
  it('reads every screen on offer, once each, and says when a line is no list', () => {
    expect(readScreenList(list({ id: A, name: "Franco's iPhone" }, { id: B, name: 'iPad' }, { id: A, name: 'again' })))
      .toEqual([{ id: A, name: 'again' }, { id: B, name: 'iPad' }])
    expect(readScreenList(list())).toEqual([])
    expect(readScreenList('not json')).toBeNull()
    expect(readScreenList('[]')).toBeNull()
    expect(readScreenList('null')).toBeNull()
  })

  it('skips IDs that could pass for an option or a path, and names a nameless screen', () => {
    expect(readScreenList(list({ id: '--max-size' }, { id: '../x' }, { id: 'a b' }, { id: 7 }, null, { id: A, name: ' ' })))
      .toEqual([{ id: A, name: 'iPhone' }])
  })
})

describe('iphoneDevices', () => {
  it('lists the screens by name, on a cable, view only', () => {
    expect(iphoneDevices([{ id: B, name: 'iPhone 17 Pro' }, { id: A, name: "Franco's iPhone" }])).toEqual([
      { id: `iphone:${A}`, kind: 'iphone', name: "Franco's iPhone", detail: 'iPhone · cable · view only', state: 'ready' },
      { id: `iphone:${B}`, kind: 'iphone', name: 'iPhone 17 Pro', detail: 'iPhone · cable · view only', state: 'ready' },
    ])
    expect(screenIdOf(`iphone:${A}`)).toBe(A)
    expect(screenIdOf('simulator:U1')).toBeNull()
  })
})

describe('IphoneTracker', () => {
  beforeEach(() => vi.useFakeTimers())
  afterEach(() => vi.useRealTimers())

  function setup() {
    const spawned: FakeProcess[] = []
    const published: string[][] = []
    const failures: [string, boolean][] = []
    const tracker = new IphoneTracker({
      list: () => {
        const p = fakeProcess()
        spawned.push(p)
        return p.proc
      },
      publish: (devices) => published.push(devices.map((d) => d.id)),
      failed: (why, listed) => failures.push([why, listed]),
    })
    return { tracker, spawned, published, failures }
  }

  it('publishes every list, read across chunks, and knows which screens are on offer', async () => {
    const { tracker, spawned, published } = setup()
    tracker.start()
    const text = list({ id: A, name: "Franco's iPhone" }) + list()
    spawned[0].stdout.write(text.slice(0, 30))
    spawned[0].stdout.write(text.slice(30, -3))
    await vi.waitFor(() => expect(published).toEqual([[`iphone:${A}`]]))
    expect(tracker.has(A)).toBe(true)
    spawned[0].stdout.write(text.slice(-3))
    await vi.waitFor(() => expect(published).toEqual([[`iphone:${A}`], []]))
    expect(tracker.has(A)).toBe(false)
    tracker.stop()
    expect(spawned[0].killed()).toBe(true)
  })

  it('starts the helper again after 1 s; a run that never listed forgets the screens', async () => {
    const { tracker, spawned, failures } = setup()
    tracker.start()
    spawned[0].stdout.write(list({ id: A, name: 'iPhone' }))
    spawned[0].exit(1)
    await vi.advanceTimersByTimeAsync(0)
    expect(failures).toEqual([['iphone-screen stopped (exit code 1).', true]])
    expect(tracker.has(A)).toBe(true) // a run that listed: its list stands until the next
    await vi.advanceTimersByTimeAsync(1000)
    expect(spawned).toHaveLength(2)
    spawned[1].stderr.write('{"error":"capture","message":"CoreMediaIO failed."}\n')
    spawned[1].exit(1)
    await vi.advanceTimersByTimeAsync(0)
    expect(failures[1]).toEqual(['{"error":"capture","message":"CoreMediaIO failed."}', false])
    expect(tracker.has(A)).toBe(false)
    tracker.stop()
  })
})

describe('iphoneIo', () => {
  it('runs the helper with stdin kept open: list, and stream at 1600 px and 60 frames a second', () => {
    const calls: unknown[][] = []
    const io = iphoneIo('/Deck.app/Contents/Resources/iphone-screen', {
      spawn: (command, args, options) => {
        calls.push([command, args, options.stdio])
        return fakeProcess().proc
      },
    })
    io.list()
    io.stream(A)
    expect(calls).toEqual([
      ['/Deck.app/Contents/Resources/iphone-screen', ['list'], ['pipe', 'pipe', 'pipe']],
      ['/Deck.app/Contents/Resources/iphone-screen', ['stream', A, '--max-size', '1600', '--max-fps', '60'], ['pipe', 'pipe', 'pipe']],
    ])
  })
})
```

- [ ] **Step 2: Run them and watch them fail**

Run: `npx vitest run src/main/devices/ios/iphone.test.ts`
Expected: FAIL: `./iphone` doesn't exist.

- [ ] **Step 3: Implement**

Create `src/main/devices/ios/iphone.ts`:

```ts
import { type ChildProcess, spawn, type SpawnOptions } from 'node:child_process'
import type { DeviceInfo } from '@shared/types'
import { LineTracker } from './tracker'

/** An iPhone's screen, as Deck's helper (native/iphone-screen/) lists it: its capture device's ID (a
 *  UUID macOS gives it: not the phone's UDID, but the same across reconnects and runs) and the
 *  phone's name. */
export interface IphoneScreen {
  id: string
  name: string
}

const PREFIX = 'iphone:'
/** The picture's long side, as scrcpy's max_size for Android. */
const MAX_SIDE = 1600
const MAX_FPS = 60

/** The capture device ID in a device id, or null for another kind of device. */
export const screenIdOf = (id: string): string | null => (id.startsWith(PREFIX) ? id.slice(PREFIX.length) : null)

/** An ID goes into the helper's argv, so only this shape is trusted: a real one is a UUID; this is
 *  generous rather than exact, and never starts with "-". */
const ID_SHAPE = /^[A-Za-z0-9][A-Za-z0-9-]{0,127}$/

/** One line of `iphone-screen list`, `{"devices":[{"id","name"}]}`: every screen on offer. null: a
 *  line that isn't a list. */
export function readScreenList(line: string): IphoneScreen[] | null {
  let raw: unknown
  try {
    raw = JSON.parse(line)
  } catch {
    return null
  }
  const devices = typeof raw === 'object' && raw !== null ? (raw as { devices?: unknown }).devices : undefined
  if (!Array.isArray(devices)) return null
  const screens = new Map<string, IphoneScreen>()
  for (const item of devices) {
    if (typeof item !== 'object' || item === null) continue
    const { id, name } = item as Record<string, unknown>
    if (typeof id !== 'string' || !ID_SHAPE.test(id)) continue
    screens.set(id, { id, name: typeof name === 'string' && name.trim() ? name.trim() : 'iPhone' })
  }
  return [...screens.values()]
}

/** The screens, by name, as devices: on a cable, view only. */
export function iphoneDevices(screens: readonly IphoneScreen[]): DeviceInfo[] {
  return [...screens]
    .sort((a, b) => a.name.localeCompare(b.name) || a.id.localeCompare(b.id))
    .map((s) => ({ id: `${PREFIX}${s.id}`, kind: 'iphone', name: s.name, detail: 'iPhone · cable · view only', state: 'ready' }))
}

export interface IphoneTrackerDeps {
  /** `iphone-screen list`. Spawning it can throw synchronously. */
  list(): ChildProcess
  /** The screens on offer, after each list. */
  publish(devices: DeviceInfo[]): void
  /** The helper stopped (it starts again soon): its last words, and whether *this run* had listed. */
  failed(why: string, listed: boolean): void
}

/** Follows the iPhone screens with the helper's `list`, restarted and timed out as LineTracker does
 *  (tracker.ts). Each line lists every screen on offer, the first 3 s after the start. */
export class IphoneTracker {
  private offered = new Set<string>()
  private readonly lines: LineTracker<IphoneScreen[]>

  constructor(deps: IphoneTrackerDeps) {
    this.lines = new LineTracker({
      name: 'iphone-screen',
      spawn: () => deps.list(),
      parse: (line) => readScreenList(line),
      publish: (screens) => {
        this.offered = new Set(screens.map((s) => s.id))
        deps.publish(iphoneDevices(screens))
      },
      failed: (why, listed) => {
        if (!listed) this.offered = new Set()
        deps.failed(why, listed)
      },
    })
  }

  start(): void {
    this.lines.start()
  }

  stop(): void {
    this.lines.stop()
  }

  /** Whether screen `id` was on offer at the last list. */
  has(id: string): boolean {
    return this.offered.has(id)
  }
}

/** How a session and the tracker run the helper; tests replace it. */
export interface IphoneIo {
  /** `iphone-screen list`. Throws when it can't be started at all. */
  list(): ChildProcess
  /** `iphone-screen stream <id> --max-size 1600 --max-fps 60`. Throws when it can't be started. */
  stream(id: string): ChildProcess
}

export interface IphoneIoDeps {
  spawn(command: string, args: string[], options: SpawnOptions): ChildProcess
}

/** The real helper, at `helper`. Its stdin is a pipe Deck keeps open: the helper ends when it closes,
 *  so a Deck that crashes leaves none behind. */
export function iphoneIo(helper: string, deps: IphoneIoDeps = { spawn }): IphoneIo {
  const options: SpawnOptions = { stdio: ['pipe', 'pipe', 'pipe'] }
  return {
    list: () => deps.spawn(helper, ['list'], options),
    stream: (id) => deps.spawn(helper, ['stream', id, '--max-size', String(MAX_SIDE), '--max-fps', String(MAX_FPS)], options),
  }
}
```

- [ ] **Step 4: Run the tests and the typecheck**

Run: `npx vitest run src/main/devices/ios/iphone.test.ts && npm run typecheck`
Expected: PASS (6 tests).

- [ ] **Step 5: Commit**

```bash
git add src/main/devices/ios/iphone.ts src/main/devices/ios/iphone.test.ts
git -c user.email=franco@effektstudios.com commit -m "iPhones: main follows the helper's list of screens" -m "Claude-Session: https://claude.ai/code/session_012TidnBvRYbxhSYqPzFZuph"
```

---

### Task 7: An iPhone's stream

A session runs `iphone-screen stream <id>`, reads its stdout with scrcpy's reader (from the codec id
on), says its failures in Deck's words (the camera as blocked), asks for key frames on its stdin, and
drops input: an iPhone is view only.

**Files:**
- Modify: `src/main/devices/ios/iphone.ts`, `src/main/devices/ios/iphone.test.ts`

- [ ] **Step 1: Write the failing tests**

In `src/main/devices/ios/iphone.test.ts`, replace the imports with:

```ts
import type { ChildProcess } from 'node:child_process'
import { afterEach, beforeEach, describe, expect, it, vi } from 'vitest'
import type { DeviceBlock } from '@shared/types'
import { CODEC_H264 } from '../android/protocol'
import type { StreamEvents, StreamPacket } from '../session'
import { CAMERA_DENIED, helperFailure, iphoneDevices, iphoneIo, IphoneTracker, readScreenList, screenIdOf, startIphone } from './iphone'
import { fakeProcess, type FakeProcess } from './test-process'
```

and append:

```ts
describe('helperFailure', () => {
  it("says the helper's failures in Deck's words; only the camera is blocked", () => {
    expect(helperFailure('{"error":"camera-denied"}')).toEqual({ why: CAMERA_DENIED, blocked: 'camera' })
    expect(helperFailure('{"error":"not-found"}')?.why).toBe("The iPhone didn't offer its screen. Unlock it, and check that it trusts this Mac.")
    expect(helperFailure('{"error":"capture","message":"The iPhone\'s screen stopped: busy."}')).toEqual({ why: "The iPhone's screen stopped: busy." })
    expect(helperFailure('{"error":"usage"}')).toEqual({ why: 'iphone-screen failed (usage).' })
    expect(helperFailure('2026-11-11 something else')).toBeNull()
    expect(helperFailure('{"message":"no code"}')).toBeNull()
  })
})

/** The helper's stream: scrcpy's, from the codec id on. */
function codec(id = CODEC_H264): Buffer {
  const b = Buffer.alloc(4)
  b.writeUInt32BE(id)
  return b
}
function session(width: number, height: number): Buffer {
  const b = Buffer.alloc(12)
  b.writeUInt32BE(0x80000000, 0)
  b.writeUInt32BE(width, 4)
  b.writeUInt32BE(height, 8)
  return b
}
function packet(flags: bigint, data: number[]): Buffer {
  const head = Buffer.alloc(12)
  head.writeBigUInt64BE(flags, 0)
  head.writeUInt32BE(data.length, 8)
  return Buffer.concat([head, Buffer.from(data)])
}

describe('startIphone', () => {
  function setup(options: Parameters<typeof fakeProcess>[0] = {}) {
    const helper = fakeProcess(options)
    const streamed: string[] = []
    const io = {
      list: (): ChildProcess => {
        throw new Error('not here')
      },
      stream: (id: string) => {
        streamed.push(id)
        return helper.proc
      },
    }
    const sizes: [number, number][] = []
    const packets: StreamPacket[] = []
    const ends: [string, DeviceBlock | undefined][] = []
    const events: StreamEvents = {
      size: (w, h) => sizes.push([w, h]),
      packet: (p) => packets.push(p),
      end: (why, blocked) => ends.push([why, blocked]),
    }
    const stdin: string[] = []
    helper.stdin.on('data', (chunk: Buffer) => stdin.push(chunk.toString()))
    return { helper, io, streamed, sizes, packets, ends, events, stdin }
  }

  it('passes the screen on as it comes, and asks for key frames on stdin; input goes nowhere', async () => {
    const t = setup()
    const live = await startIphone(A, t.events, t.io, new AbortController().signal)
    expect(t.streamed).toEqual([A])
    const bytes = Buffer.concat([codec(), session(736, 1600), packet(1n << 62n, [0, 0, 0, 1, 0x67]), packet((1n << 61n) | 16_666n, [0, 0, 0, 1, 0x65])])
    t.helper.stdout.write(bytes.subarray(0, 9))
    t.helper.stdout.write(bytes.subarray(9))
    await vi.waitFor(() => expect(t.packets).toHaveLength(2))
    expect(t.sizes).toEqual([[736, 1600]])
    expect(t.packets).toEqual([
      { config: true, key: false, data: new Uint8Array([0, 0, 0, 1, 0x67]) },
      { config: false, key: true, data: new Uint8Array([0, 0, 0, 1, 0x65]) },
    ])
    live.keyframe()
    live.input({ type: 'touch', action: 'down', x: 1, y: 1, width: 736, height: 1600 })
    await vi.waitFor(() => expect(t.stdin.join('')).toBe('key\n'))
    const closed = new Promise((resolve) => t.helper.proc.once('close', resolve))
    live.stop()
    expect(t.helper.killed()).toBe(true)
    await closed
    expect(t.ends).toEqual([]) // a stop is never reported as an end
  })

  it("ends with the camera blocked when macOS hasn't let Deck use it", async () => {
    const t = setup()
    await startIphone(A, t.events, t.io, new AbortController().signal)
    t.helper.stderr.write('{"error":"camera-denied"}\n')
    t.helper.exit(1)
    await vi.waitFor(() => expect(t.ends).toEqual([[CAMERA_DENIED, 'camera']]))
  })

  it("ends in the helper's words, else a line that reads as a failure, else how it ended", async () => {
    const found = setup()
    await startIphone(A, found.events, found.io, new AbortController().signal)
    found.helper.stderr.write('{"error":"not-found"}\n')
    found.helper.exit(1)
    await vi.waitFor(() => expect(found.ends).toEqual([["The iPhone didn't offer its screen. Unlock it, and check that it trusts this Mac.", undefined]]))

    const crashed = setup()
    await startIphone(A, crashed.events, crashed.io, new AbortController().signal)
    crashed.helper.stderr.write('Fatal error: Unexpectedly found nil\n')
    crashed.helper.exit(133)
    await vi.waitFor(() => expect(crashed.ends).toEqual([['Fatal error: Unexpectedly found nil', undefined]]))

    const quiet = setup()
    await startIphone(A, quiet.events, quiet.io, new AbortController().signal)
    quiet.helper.exit(3)
    await vi.waitFor(() => expect(quiet.ends).toEqual([['iphone-screen stopped (exit code 3).', undefined]]))
  })

  it('a stream that makes no sense ends it, and stops the helper', async () => {
    const t = setup()
    await startIphone(A, t.events, t.io, new AbortController().signal)
    t.helper.stdout.write(Buffer.concat([codec(), session(0, 1600)]))
    await vi.waitFor(() => expect(t.ends).toEqual([["Deck's iPhone helper sent a 0×1600 screen.", undefined]]))
    expect(t.helper.killed()).toBe(true)

    const other = setup()
    await startIphone(A, other.events, other.io, new AbortController().signal)
    other.helper.stdout.write(codec(0x68323635))
    await vi.waitFor(() => expect(other.ends).toEqual([["Deck's iPhone helper sent another codec.", undefined]]))
  })

  it('a helper that fails to start: the spawn error, or a rejected start; a stopped start spawns nothing', async () => {
    const t = setup({ spawnError: Object.assign(new Error('spawn /x/iphone-screen ENOENT'), { code: 'ENOENT' }) })
    await startIphone(A, t.events, t.io, new AbortController().signal)
    await vi.waitFor(() => expect(t.ends).toEqual([['spawn /x/iphone-screen ENOENT', undefined]]))

    const throwing = { list: () => fakeProcess().proc, stream: (): ChildProcess => { throw new Error('spawn ENOEXEC') } }
    await expect(startIphone(A, t.events, throwing, new AbortController().signal)).rejects.toThrow('spawn ENOEXEC')

    const stopped = setup()
    const signal = AbortSignal.abort()
    await expect(startIphone(A, stopped.events, stopped.io, signal)).rejects.toThrow('Stopped.')
    expect(stopped.streamed).toEqual([])
  })
})
```

- [ ] **Step 2: Run them and watch them fail**

Run: `npx vitest run src/main/devices/ios/iphone.test.ts`
Expected: FAIL: `helperFailure`, `startIphone` and `CAMERA_DENIED` aren't exported.

- [ ] **Step 3: Implement**

In `src/main/devices/ios/iphone.ts`, replace the imports with:

```ts
import { type ChildProcess, spawn, type SpawnOptions } from 'node:child_process'
import type { DeviceBlock, DeviceInfo } from '@shared/types'
import { CODEC_H264, VideoReader } from '../android/protocol'
import type { DeviceSession, StreamEvents } from '../session'
import { asFailure, endedHow, lastLine, stopper } from './process'
import { LineTracker } from './tracker'
```

and append:

```ts
/** What the panel says, under "Camera not allowed". */
export const CAMERA_DENIED = "macOS hasn't let Deck use the camera, which is how it shows an iPhone's screen."

/** The helper's failure line (`{"error":"<code>","message":"…"}`) as Deck says it, and what only the
 *  user can change; null for any other line. */
export function helperFailure(line: string): { why: string; blocked?: DeviceBlock } | null {
  let raw: unknown
  try {
    raw = JSON.parse(line)
  } catch {
    return null
  }
  if (typeof raw !== 'object' || raw === null) return null
  const { error, message } = raw as Record<string, unknown>
  if (typeof error !== 'string') return null
  switch (error) {
    case 'camera-denied':
      return { why: CAMERA_DENIED, blocked: 'camera' }
    case 'not-found':
      return { why: "The iPhone didn't offer its screen. Unlock it, and check that it trusts this Mac." }
    case 'no-picture':
      return { why: 'The iPhone sent no picture. Unlock it, and check that its screen is on.' }
    case 'disconnected':
      return { why: 'The iPhone was disconnected.' }
    default:
      return { why: typeof message === 'string' && message ? message : `iphone-screen failed (${error}).` }
  }
}

/** Starts iPhone screen `id`'s stream: the helper asks for the camera (macOS treats the screen as
 *  one; the prompt shows once, for Deck), finds the screen and captures it. Resolves once the helper
 *  runs, so the streams' 20 s start deadline doesn't cover the prompt, which waits for an answer; the
 *  first picture follows in about 3 s after that. The helper gives up by itself when the screen isn't
 *  offered within 10 s or sends nothing in 15 s. View only: input is dropped. */
export async function startIphone(id: string, events: StreamEvents, io: IphoneIo, signal: AbortSignal): Promise<DeviceSession> {
  if (signal.aborted) throw new Error('Stopped.')
  // A spawn that throws (ENOEXEC) rejects the start here, with nothing opened.
  const proc = io.stream(id)
  const stop = stopper(proc)
  let over = false
  /** The helper's own failure line, which explains more than how it ended. */
  let failure: { why: string; blocked?: DeviceBlock } | null = null
  const said = lastLine(proc.stderr, (line) => {
    const known = helperFailure(line)
    if (known) failure = known
    return known ? known.why : asFailure(line) || null
  })
  const end = (why: string, blocked?: DeviceBlock) => {
    if (over) return
    over = true
    stop()
    events.end(why, blocked)
  }
  const finish = (fallback: string) => (failure ? end(failure.why, failure.blocked) : end(said() || fallback))

  const reader = new VideoReader({ from: 'codec', sender: "Deck's iPhone helper" })
  proc.stdout?.on('data', (chunk: Buffer) => {
    for (const event of reader.feed(chunk)) {
      if (over) return
      if (event.type === 'error') return end(event.message)
      if (event.type === 'codec' && event.codec !== CODEC_H264) return end("Deck's iPhone helper sent another codec.")
      if (event.type === 'size') events.size(event.width, event.height)
      else if (event.type === 'packet') events.packet({ config: event.config, key: event.key, data: event.data })
    }
  })
  // Writing to a helper that has just gone can fail (EPIPE): its 'close' says why.
  proc.stdin?.on('error', () => {})
  // A spawn that fails once under way (ENOENT, EACCES) says so in 'error', then 'close'. Unheard, the
  // 'error' would reach main's uncaught exception handler.
  proc.on('error', (err) => finish(err.message))
  proc.on('close', (code: number | null, sig: NodeJS.Signals | null) => finish(endedHow('iphone-screen', code, sig)))

  return {
    input: () => {}, // view only: Apple offers no way to tap a real iPhone remotely
    keyframe: () => {
      if (!over && proc.stdin?.writable) proc.stdin.write('key\n')
    },
    stop: () => {
      if (over) return
      over = true
      stop()
    },
  }
}
```

- [ ] **Step 4: Run the tests, on both Nodes, and the typecheck**

Run: `npx vitest run src/main/devices/ios && ELECTRON_RUN_AS_NODE=1 ./node_modules/.bin/electron ./node_modules/vitest/vitest.mjs run src/main/devices/ios && npm run typecheck`
Expected: PASS (`iphone.test.ts`: 12 tests).

- [ ] **Step 5: Commit**

```bash
git add src/main/devices/ios/iphone.ts src/main/devices/ios/iphone.test.ts
git -c user.email=franco@effektstudios.com commit -m "iPhones: a stream session on the helper, view only, the camera's refusal as blocked" -m "Claude-Session: https://claude.ai/code/session_012TidnBvRYbxhSYqPzFZuph"
```

---

### Task 8: Main lists and streams iPhones

The helper's list becomes a third source while devices are watched (macOS, with the helper), iOS is
pending until both the simulators and the iPhones have listed, a viewed iPhone streams through the
helper, and `devices:camera-settings` opens System Settings. `index.ts` finds the helper once, at
start.

**Files:**
- Modify: `src/main/devices/registry.ts`, `src/main/devices/registry.test.ts`, `src/main/devices/ipc.ts`,
  `src/main/devices/ipc.test.ts`, `src/main/devices/ipc.ios.test.ts`,
  `src/main/devices/ipc.watch.test.ts`, `src/main/index.ts`

- [ ] **Step 1: Write the failing tests**

Replace `src/main/devices/registry.test.ts` with:

```ts
import { describe, expect, it } from 'vitest'
import type { DeviceInfo } from '@shared/types'
import { combineLists, type IphoneState } from './registry'

const phone: DeviceInfo = { id: 'android:X1', kind: 'android', name: 'C66', detail: 'Android 13 · USB', state: 'ready' }
const emulator: DeviceInfo = { id: 'emulator:Pixel_9', kind: 'emulator', name: 'Pixel 9', detail: 'Emulator · Android 15', state: 'ready' }
const sim: DeviceInfo = { id: 'simulator:U1', kind: 'simulator', name: 'iPhone 17', detail: 'Simulator · iOS 27.0', state: 'ready' }
const iphone: DeviceInfo = { id: 'iphone:C1', kind: 'iphone', name: "Franco's iPhone", detail: 'iPhone · cable · view only', state: 'ready' }
const noIphones: IphoneState = { pending: false, devices: [], problem: null }

describe('combineLists', () => {
  it("lists adb's devices, then the simulators, with each source's problem", () => {
    expect(combineLists({ pending: false, devices: [phone], problem: null }, { pending: false, devices: [sim], problem: null }, noIphones))
      .toEqual({ devices: [phone, sim], problem: null, iosProblem: null, pending: [] })
    expect(combineLists({ pending: false, devices: [], problem: 'no-adb' }, { pending: false, devices: [], problem: 'no-idb' }, noIphones))
      .toEqual({ devices: [], problem: 'no-adb', iosProblem: 'no-idb', pending: [] })
  })

  it('says which kinds are still pending', () => {
    expect(combineLists({ pending: false, devices: [phone], problem: null }, { pending: true, devices: [], problem: null }, noIphones).pending).toEqual(['ios'])
    expect(combineLists({ pending: true, devices: [], problem: null }, { pending: false, devices: [sim], problem: null }, noIphones).pending).toEqual(['android'])
  })

  it('puts iPhones with the phones, before emulators and simulators; iOS waits for them too', () => {
    const iphones: IphoneState = { pending: false, devices: [iphone], problem: null }
    expect(combineLists({ pending: false, devices: [phone, emulator], problem: null }, { pending: false, devices: [sim], problem: null }, iphones).devices)
      .toEqual([phone, iphone, emulator, sim])
    expect(combineLists({ pending: false, devices: [], problem: null }, { pending: false, devices: [sim], problem: null }, { ...iphones, pending: true }).pending)
      .toEqual(['ios'])
  })
})
```

In `src/main/devices/ipc.watch.test.ts`:
- import `import { IphoneTracker } from './ios/iphone'` above the `SimulatorTracker` import;
- under `const notifiers = …`:

```ts
const iphoneLists = () => spawned.calls.map((c, i) => ({ ...c, fp: procAt(i) })).filter((c) => c.args[0] === 'list')
```

- under `const SIM = …`:

```ts
/** A made-up capture device ID, and the helper's list with it. */
const SCREEN = '0A0A0A0A-1111-2222-3333-444444444444'
const SCREENS = `{"devices":[{"id":"${SCREEN}","name":"Franco's iPhone"}]}\n`
const IPHONE = { id: `iphone:${SCREEN}`, kind: 'iphone' as const, name: "Franco's iPhone", detail: 'iPhone · cable · view only', state: 'ready' as const }
```

- `setup` takes the helper: `function setup(platform: 'darwin' | 'linux' = 'darwin', iphoneHelper: string | null = null) {`,
  and its `registerDeviceIpc({…})` gains `iphoneHelper,` after `socketDir`;
- and at the end of the `describe` block:

```ts
  it('iPhones join the list from the helper; iOS waits for the simulators and the iPhones', async () => {
    const t = setup('darwin', '/fake/iphone-screen')
    h.findIdb = async () => IDB
    t.watch()
    await tick()
    expect(iphoneLists().map((c) => [c.cmd, c.args])).toEqual([['/fake/iphone-screen', ['list']]])
    notifiers()[0].fp.stdout.write(LINE)
    await tick()
    expect(t.list()).toEqual({ devices: [SIM], problem: 'no-adb', iosProblem: null, pending: ['ios'] })
    iphoneLists()[0].fp.stdout.write(SCREENS)
    await tick()
    expect(t.list()).toEqual({ devices: [IPHONE, SIM], problem: 'no-adb', iosProblem: null, pending: [] })
    t.unwatch()
    expect(iphoneLists()[0].fp.killed()).toBe(true)
  })

  it('a helper that fails before it lists: no iPhones, quietly, and nothing waits on them', async () => {
    const t = setup('darwin', '/fake/iphone-screen')
    const logged = vi.spyOn(console, 'error').mockImplementation(() => {})
    try {
      t.watch()
      await tick()
      iphoneLists()[0].fp.stderr.write('{"error":"capture","message":"CoreMediaIO failed."}\n')
      iphoneLists()[0].fp.exit(1)
      await tick()
      expect(t.list()).toEqual({ devices: [], problem: 'no-adb', iosProblem: null, pending: [] })
      expect(logged).toHaveBeenCalledWith('devices: the iPhone helper stopped:', '{"error":"capture","message":"CoreMediaIO failed."}')
    } finally {
      logged.mockRestore()
    }
  })

  it('no helper (null), or not macOS: no iPhones are looked for', async () => {
    const mac = setup('darwin', null)
    mac.watch()
    await tick()
    expect(iphoneLists()).toHaveLength(0)
    expect(mac.list()?.pending).toEqual([])
    mac.devices.dispose()
    const linux = setup('linux', '/fake/iphone-screen')
    linux.watch()
    await tick()
    expect(iphoneLists()).toHaveLength(0)
  })

  it('streams an iPhone on offer with the helper', async () => {
    const t = setup('darwin', '/fake/iphone-screen')
    t.watch()
    await tick()
    iphoneLists()[0].fp.stdout.write(SCREENS)
    await tick()
    t.view(IPHONE.id)
    await tick()
    expect(spawned.calls.filter((c) => c.args[0] === 'stream')).toEqual([
      { cmd: '/fake/iphone-screen', args: ['stream', SCREEN, '--max-size', '1600', '--max-fps', '60'] },
    ])
    expect(t.streamEvents(IPHONE.id)).toEqual([{ type: 'state', state: 'connecting' }])
    t.unview(IPHONE.id)
  })

  it('an iPhone listed when viewed but no longer offered when its start asks says so', async () => {
    const t = setup('darwin', '/fake/iphone-screen')
    t.watch()
    await tick()
    iphoneLists()[0].fp.stdout.write(SCREENS)
    await tick()
    const spy = vi.spyOn(IphoneTracker.prototype, 'has').mockReturnValue(false)
    vi.useFakeTimers()
    try {
      t.view(IPHONE.id)
      await vi.advanceTimersByTimeAsync(1000 + 2000 + 5000) // DeviceStreams' own three retries
      expect(t.streamEvents(IPHONE.id).at(-1)).toEqual({ type: 'state', state: 'error', message: "The iPhone isn't connected." })
      expect(spawned.calls.filter((c) => c.args[0] === 'stream')).toHaveLength(0)
    } finally {
      t.unview(IPHONE.id)
      spy.mockRestore()
    }
  })
```

In `src/main/devices/ipc.test.ts`, the registration gains, after `socketDir`:

```ts
  iphoneHelper: '/never/run/iphone-screen', // off macOS (this registration is 'linux'): never run
```

and add before the test "ignores input it cannot use and views of nothing":

```ts
  it("System Settings' camera page is macOS's: elsewhere the call does nothing", () => {
    expect(() => emit(IPC.devicesCameraSettings)).not.toThrow()
  })

```

In `src/main/devices/ipc.ios.test.ts`, the `electron` mock gains a `shell` that records what it's
asked to open:

```ts
/** The URLs shell.openExternal was asked to open. */
const opened = vi.hoisted(() => [] as string[])
vi.mock('electron', () => ({
  ipcMain: {
    handle: (channel: string, fn: (...args: unknown[]) => unknown) => ipc.handlers.set(channel, fn),
    on: (channel: string, fn: (...args: unknown[]) => void) => ipc.listeners.set(channel, fn),
  },
  powerMonitor: { on: () => {} },
  shell: {
    openExternal: async (url: string) => {
      opened.push(url)
    },
  },
}))
```

its registration gains `iphoneHelper: null,` after `socketDir`, and add at the end of its `describe`
block:

```ts
  it('opens System Settings at Privacy & Security › Camera', () => {
    ipc.listeners.get(IPC.devicesCameraSettings)!({})
    expect(opened).toEqual(['x-apple.systempreferences:com.apple.preference.security?Privacy_Camera'])
  })
```

- [ ] **Step 2: Run them and watch them fail**

Run: `npx vitest run src/main/devices`
Expected: FAIL: `combineLists` ignores its third source, no helper is run, and nothing listens on
`devices:camera-settings`.

- [ ] **Step 3: Three sources in one list**

Replace `src/main/devices/registry.ts` with:

```ts
import type { DeviceInfo, DeviceList, DevicePlatform } from '@shared/types'

/** What one source of devices knows: adb's, idb's simulators, or the iPhone helper's screens. */
export interface SourceState<P> {
  /** Still finding its first devices. */
  pending: boolean
  devices: DeviceInfo[]
  problem: P
}

export type AndroidState = SourceState<DeviceList['problem']>
export type IosState = SourceState<DeviceList['iosProblem']>
/** iPhones have no problem to show: without the helper, or with one that fails, there are none. */
export type IphoneState = SourceState<null>

/** One list from the three sources, phones first (Android's, as adb's tracker orders them, then
 *  iPhones), then emulators, then simulators. iOS is pending while the simulators or the iPhones
 *  are. */
export function combineLists(android: AndroidState, ios: IosState, iphones: IphoneState): DeviceList {
  const pending: DevicePlatform[] = []
  if (android.pending) pending.push('android')
  if (ios.pending || iphones.pending) pending.push('ios')
  const phones = android.devices.filter((d) => d.kind === 'android')
  const emulators = android.devices.filter((d) => d.kind !== 'android')
  return { devices: [...phones, ...iphones.devices, ...emulators, ...ios.devices], problem: android.problem, iosProblem: ios.problem, pending }
}
```

- [ ] **Step 4: `ipc.ts`**

In `src/main/devices/ipc.ts`:
- import `shell` beside `ipcMain` and `powerMonitor` from `electron`;
  `import { iphoneIo, IphoneTracker, screenIdOf, startIphone } from './ios/iphone'` above the
  `./ios/simulator` import; and `type IphoneState` beside `type IosState` from `./registry`;
- in `DeviceIpcOptions`, after `socketDir`:

```ts
  /** Deck's iPhone helper (macOS), or null without one: a build on a Mac without Xcode's command line
   *  tools has none, and no iPhones. */
  iphoneHelper: string | null
```

- under `isPng`:

```ts
/** System Settings › Privacy & Security › Camera, where Deck is let use the camera (an iPhone's
 *  screen is one to macOS). */
const CAMERA_SETTINGS = 'x-apple.systempreferences:com.apple.preference.security?Privacy_Camera'
```

- `registerDeviceIpc`'s doc:

```ts
/** The device panel's main side: Android devices adb sees and, on macOS, booted simulators
 *  idb-companion sees and iPhones on a cable (each looked for only while a tab needs them), each
 *  project's device, streams for the devices viewed (scrcpy for Android, idb-companion's sim-video
 *  for simulators, Deck's helper for iPhones), and screenshots for Claude. */
```

- the state: after `let simulators: SimulatorTracker | null = null`, add
  `let iphoneTracker: IphoneTracker | null = null`; after `let ios: IosState = …`, add:

```ts
  let iphones: IphoneState = { pending: false, devices: [], problem: null }
  /** iPhones show on macOS, with the helper. */
  const iphoneHelper = opts.platform === 'darwin' ? opts.iphoneHelper : null
```

- the streams' `start` begins with the iPhone's case:

```ts
    start: async (id, events, signal) => {
      const screen = screenIdOf(id)
      if (screen !== null) {
        if (!iphoneHelper || !iphoneTracker?.has(screen)) throw new Error("The iPhone isn't connected.")
        return startIphone(screen, events, iphoneIo(iphoneHelper), signal)
      }
      const udid = udidOf(id)
```

- `update()` counts the third source:

```ts
  const update = () => {
    if (watchers > 0 && (list !== null || !android.pending || !ios.pending || !iphones.pending)) publish(combineLists(android, ios, iphones))
  }
```

- above `startWatching`:

```ts
  /** iPhones: macOS, with the helper, which lists the screens on offer 3 s after it starts, then on
   *  each change. Quiet when it fails: the list then has no iPhones (a run that had listed keeps its
   *  list while the helper is started again), and the reason goes to main's log. */
  const watchIphones = (helper: string) => {
    iphoneTracker = new IphoneTracker({
      list: () => iphoneIo(helper).list(),
      publish: (devices) => {
        iphones = { pending: false, devices, problem: null }
        update()
      },
      failed: (why, listed) => {
        console.error('devices: the iPhone helper stopped:', why)
        if (listed) return
        iphones = { pending: false, devices: [], problem: null }
        update()
      },
    })
    iphoneTracker.start()
  }
```

- `startWatching` sets `iphones = { pending: iphoneHelper !== null, devices: [], problem: null }` after
  `ios`, and ends with `if (iphoneHelper) watchIphones(iphoneHelper)`; `stopWatching` and `dispose()`
  each add, after `simulators = null`:

```ts
    iphoneTracker?.stop()
    iphoneTracker = null
```

- before the `devices:screenshot` handler:

```ts
  ipcMain.on(IPC.devicesCameraSettings, () => {
    if (opts.platform === 'darwin') void shell.openExternal(CAMERA_SETTINGS)
  })
```

No look again at a focus: the helper ships with Deck, and a dev build gets it at `npm ci`.

- [ ] **Step 5: `index.ts` finds the helper**

In `src/main/index.ts`, above `hasPwsh`:

```ts
/** Deck's iPhone helper (macOS): in the app's resources when packaged, where `npm ci` builds it in a
 *  dev build (scripts/build-iphone-helper.mjs). null off macOS, and without one: a Mac without
 *  Xcode's command line tools builds none, and then shows no iPhones. */
function iphoneHelper(): string | null {
  if (process.platform !== 'darwin') return null
  const path = app.isPackaged ? join(process.resourcesPath, 'iphone-screen') : join(app.getAppPath(), 'native', 'iphone-screen', 'out', 'iphone-screen')
  try {
    return statSync(path).isFile() ? path : null
  } catch {
    return null
  }
}
```

and `registerDeviceIpc({…})` gains, after `socketDir`:

```ts
    iphoneHelper: iphoneHelper(),
```

- [ ] **Step 6: Run the tests and the typecheck**

Run: `npx vitest run src/main/devices && npm run typecheck`
Expected: PASS. (The earlier watch tests stand as they were: their registrations have no helper.)

- [ ] **Step 7: Commit**

```bash
git add src/main/devices src/main/index.ts
git -c user.email=franco@effektstudios.com commit -m "iPhones: listed beside adb and the simulators, streamed through the helper" -m "Claude-Session: https://claude.ai/code/session_012TidnBvRYbxhSYqPzFZuph"
```

---

### Task 9: The panel for iPhones

iPhones fit iOS apps; an iPhone's header has only the camera; its screen takes no input and never the
keyboard; "Camera not allowed" offers **Open System Settings** beside **Try again**; "No devices
connected" mentions an iPhone where iOS is wanted (macOS).

**Files:**
- Modify: `src/renderer/src/device/pick.ts`, `src/renderer/src/device/pick.test.ts`,
  `src/renderer/src/device/DevicePanel.tsx`, `src/renderer/src/device/DeviceScreen.tsx`,
  `src/renderer/src/device/device.css`

- [ ] **Step 1: Write the failing tests**

In `src/renderer/src/device/pick.test.ts`, under `const sim = …`:

```ts
const iphone: DeviceInfo = { id: 'iphone:C1', kind: 'iphone', name: "Franco's iPhone", detail: 'iPhone · cable · view only', state: 'ready' }
```

At the end of `describe('choosePanel', …)`:

```ts
  it('iPhones fit an iOS app, beside simulators, and never an Android one', () => {
    expect(choosePanel({ ...base, android: false, ios: true, devices: [c66, iphone] })).toEqual({ kind: 'device', device: iphone })
    expect(choosePanel({ ...base, android: false, ios: true, devices: [iphone, sim] })).toEqual({ kind: 'choose', devices: [iphone, sim] })
    expect(choosePanel({ ...base, devices: [c66, iphone] })).toEqual({ kind: 'device', device: c66 })
  })
```

In `describe('menuOrder', …)`'s test, a third expectation:

```ts
    expect(menuOrder([c66, iphone, emu, sim], { android: false, ios: true })).toEqual([iphone, sim, c66, emu])
```

At the end of `describe('stillLooking', …)`:

```ts
  it("waits for iOS for an iPhone picked by the tab or the project, as for a simulator", () => {
    const android = { android: true, ios: false, picks: [] }
    expect(stillLooking(list(['ios']), android, false, iphone.id)).toBe(true)
    expect(stillLooking(list(['ios']), { ...android, picks: [iphone.id] }, false, undefined)).toBe(true)
  })
```

- [ ] **Step 2: Run them and watch them fail**

Run: `npx vitest run src/renderer/src/device/pick.test.ts`
Expected: FAIL (3 tests): an iPhone is taken for an Android device.

- [ ] **Step 3: `pick.ts`**

```ts
/** What a device runs: phones and emulators Android, simulators and iPhones iOS. */
const platformOf = (kind: DeviceInfo['kind']): DevicePlatform => (kind === 'simulator' || kind === 'iphone' ? 'ios' : 'android')

/** A stored id's platform, from its prefix, connected or not. */
const platformOfId = (id: string): DevicePlatform => (id.startsWith('simulator:') || id.startsWith('iphone:') ? 'ios' : 'android')
```

and `choosePanel`'s doc says "(phones and emulators an Android one, simulators and iPhones an iOS
one)":

```ts
/** The device a tab's panel shows: its own pick, else the latest of its project's picks that's
 *  connected. Nothing picked yet, the only device that fits an app for its platform (phones and
 *  emulators an Android one, simulators and iPhones an iOS one); with several the panel asks. Once
 *  something has been picked, a device the project never picked doesn't open the panel (the C66's
 *  project doesn't open on the S25 meanwhile), unless it was asked for. With none there's no panel. */
```

- [ ] **Step 4: `DevicePanel.tsx`**

The header's buttons: Home for a simulator, Android's four for phones and emulators, and an iPhone
nothing but the camera:

```tsx
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
```

In `Nothing`, the last lines become:

```tsx
  // iOS is wanted only on macOS, where iPhones show too.
  const detail = wants.android && wants.ios
    ? 'Plug in an Android phone with USB debugging on or an iPhone, start an emulator, or boot a simulator.'
    : wants.ios ? 'Plug in an iPhone, or boot a simulator in Xcode or with simctl.' : 'Plug in an Android phone with USB debugging on, or start an emulator.'
  return <State title="No devices connected" detail={detail} />
```

- [ ] **Step 5: `DeviceScreen.tsx`**

`kind`'s doc in `DeviceScreenProps`:

```ts
  /** Simulators take HID keys and no wheel; an iPhone takes nothing (view only) and never the
   *  keyboard. */
  kind: DeviceInfo['kind']
```

`interactive` (every pointer, wheel, key and paste handler already returns while it's false):

```ts
  /** Apple offers no way to tap a real iPhone remotely: its screen is only shown. */
  const takesInput = kind !== 'iphone'
  const interactive = takesInput && live && !message && broken === null
```

Above `const failure = …`:

```ts
  // macOS hasn't let Deck use the camera (an iPhone's screen is one): System Settings changes that.
  const camera = stream.state === 'error' && stream.blocked === 'camera'
```

The canvas never takes the keyboard for an iPhone (its comment gains "An iPhone's never takes it."):

```tsx
        <canvas ref={canvasRef} className={dim ? 'dp-screen dim' : 'dp-screen'} tabIndex={takesInput ? (interactive ? 0 : -1) : undefined}
```

and the failure's overlay:

```tsx
        <div className="dp-overlay error" role="alert">
          <strong>{camera ? 'Camera not allowed' : `Couldn't show ${name}`}</strong>
          {failure.detail && <span className="dp-overlay-detail">{failure.detail}</span>}
          <span className="dp-overlay-buttons">
            {camera && <button className="button" onClick={() => window.deck.devices.openCameraSettings()}>Open System Settings</button>}
            <button className="button" onClick={failure.retry}>Try again</button>
          </span>
        </div>
```

(The detail is main's: "macOS hasn't let Deck use the camera, which is how it shows an iPhone's
screen." Not interactive, a press on the screen keeps the keyboard where it was: `onMouseDown`
prevents the default already.)

- [ ] **Step 6: `device.css`**

After `.dp-overlay .button { … }`:

```css
.dp-overlay-buttons { display: flex; flex-wrap: wrap; justify-content: center; gap: 6px; }
```

- [ ] **Step 7: Typecheck, tests and the build**

Run: `npm run typecheck && npm test && npm run build`
Expected: PASS, and the build succeeds.

- [ ] **Step 8: Commit**

```bash
git add src/renderer
git -c user.email=franco@effektstudios.com commit -m "Device panel: iPhones fit iOS apps, view only, with Camera not allowed" -m "Claude-Session: https://claude.ai/code/session_012TidnBvRYbxhSYqPzFZuph"
```

---

### Task 10: Packaging, and the page never gets the camera

The helper ships in the Mac app's resources and is signed with the camera entitlement; the app's
`Info.plist` says why it asks; a Mac build without the helper stops; and the page is refused the
camera and microphone, which the entitlement would otherwise open to it.

**Files:**
- Create: `src/main/permissions.ts`, `src/main/permissions.test.ts`
- Modify: `src/main/index.ts`, `electron-builder.yml`, `build/entitlements.mac.plist`,
  `scripts/before-pack.cjs`

- [ ] **Step 1: Write the failing test**

Create `src/main/permissions.test.ts`:

```ts
import type { Session } from 'electron'
import { describe, expect, it } from 'vitest'
import { denyMedia } from './permissions'

type RequestHandler = (contents: unknown, permission: string, callback: (granted: boolean) => void) => void
type CheckHandler = (contents: unknown, permission: string) => boolean

describe('denyMedia', () => {
  it('refuses the page the camera and the microphone, and nothing else', () => {
    const handlers: { request?: RequestHandler; check?: CheckHandler } = {}
    const session = {
      setPermissionRequestHandler: (handler: RequestHandler) => (handlers.request = handler),
      setPermissionCheckHandler: (handler: CheckHandler) => (handlers.check = handler),
    }
    denyMedia(session as unknown as Session)
    const answers: boolean[] = []
    handlers.request?.(null, 'media', (granted) => answers.push(granted))
    handlers.request?.(null, 'clipboard-sanitized-write', (granted) => answers.push(granted))
    expect(answers).toEqual([false, true])
    expect(handlers.check?.(null, 'media')).toBe(false)
    expect(handlers.check?.(null, 'fullscreen')).toBe(true)
  })
})
```

- [ ] **Step 2: Run it and watch it fail**

Run: `npx vitest run src/main/permissions.test.ts`
Expected: FAIL: `./permissions` doesn't exist.

- [ ] **Step 3: Implement, and use it**

Create `src/main/permissions.ts`:

```ts
import type { Session } from 'electron'

/** Deck's page never uses the camera or the microphone, so it never gets them. Deck holds the camera
 *  entitlement for its iPhone helper (macOS treats an iPhone's screen as a camera), and once macOS
 *  has let Deck use the camera, Electron would grant a page's request for it too: it grants every
 *  permission it isn't told otherwise about. Every other permission keeps that answer. */
export function denyMedia(session: Pick<Session, 'setPermissionRequestHandler' | 'setPermissionCheckHandler'>): void {
  session.setPermissionRequestHandler((_contents, permission, callback) => callback(permission !== 'media'))
  session.setPermissionCheckHandler((_contents, permission) => permission !== 'media')
}
```

In `src/main/index.ts`, import `session` beside `Menu` from `electron` and
`import { denyMedia } from './permissions'` under the `./open-args` import, and before
`win = createWindow()`:

```ts
  // The camera entitlement is the iPhone helper's: the page never gets the camera.
  denyMedia(session.defaultSession)
```

- [ ] **Step 4: The app's resources, entitlements and `Info.plist`**

In `electron-builder.yml`'s `mac:` section, replace the two entitlements lines with:

```yaml
  # The app and everything in it, the iPhone helper included, are signed with the same entitlements
  # (the helper needs the camera's under the hardened runtime: macOS treats an iPhone's screen as one).
  entitlements: build/entitlements.mac.plist
  entitlementsInherit: build/entitlements.mac.plist
  # Deck's iPhone helper (scripts/build-iphone-helper.mjs builds it; before-pack.cjs stops a build
  # without it), beside scrcpy's server.
  extraResources:
    - from: native/iphone-screen/out/iphone-screen
      to: iphone-screen
```

and add to its `extendInfo`:

```yaml
    # macOS's camera prompt shows it: the helper captures a connected iPhone's screen.
    NSCameraUsageDescription: Deck shows a connected iPhone's screen, which macOS treats as a camera.
```

In `build/entitlements.mac.plist`, after `com.apple.security.network.client`:

```xml
  <!-- iPhone screens: macOS treats a connected iPhone's screen as a camera (native/iphone-screen/) -->
  <key>com.apple.security.device.camera</key><true/>
```

(One file for both: `entitlements` is the app's, `entitlementsInherit` every other binary's, the
helper's included. Whether TCC checks the camera entitlement on the app that's asked for or on the
helper that captures isn't documented, so both have it; the page can't use the app's (Step 3).)

Replace `scripts/before-pack.cjs` with:

```js
// electron-builder's beforePack. electron-builder only warns about a missing extraResources
// file, so a build without scrcpy's server would ship without Android devices, and a Mac build
// without the iPhone helper without iPhones: stop it instead.
const { createHash } = require('node:crypto')
const { existsSync, readFileSync } = require('node:fs')
const { join } = require('node:path')

exports.default = async function beforePack(context) {
  const resources = join(__dirname, '..', 'resources')
  const info = JSON.parse(readFileSync(join(resources, 'scrcpy-server.json'), 'utf8'))
  let hash = ''
  try {
    hash = createHash('sha256').update(readFileSync(join(resources, 'scrcpy-server'))).digest('hex')
  } catch {
    // missing: the hash stays empty
  }
  if (hash !== info.sha256) {
    throw new Error(`resources/scrcpy-server is missing or isn't scrcpy's server ${info.version}: run npm run fetch:scrcpy`)
  }
  // npm ci builds it on a Mac with Xcode's command line tools (scripts/build-iphone-helper.mjs).
  const helper = join(__dirname, '..', 'native', 'iphone-screen', 'out', 'iphone-screen')
  if (context.electronPlatformName === 'darwin' && !existsSync(helper)) {
    throw new Error("native/iphone-screen/out/iphone-screen is missing: run npm run build:iphone (it needs Xcode's command line tools)")
  }
}
```

- [ ] **Step 5: Typecheck, tests and the build**

Run: `npm run typecheck && npm test && npm run build`
Expected: PASS, and the build succeeds.

- [ ] **Step 6: An unsigned app, looked at (no device)**

Run:
```bash
CSC_IDENTITY_AUTO_DISCOVERY=false npx electron-builder --mac --dir --arm64 -c.mac.notarize=false -c.mac.identity=null
ls -l dist/mac-arm64/Deck.app/Contents/Resources/iphone-screen
plutil -p dist/mac-arm64/Deck.app/Contents/Info.plist | grep NSCamera
dist/mac-arm64/Deck.app/Contents/Resources/iphone-screen selftest | wc -c
```
Expected: `-rwxr-xr-x … iphone-screen`; `"NSCameraUsageDescription" => "Deck shows a connected iPhone's
screen, which macOS treats as a camera."`; about 154000.

Then the stop without the helper:
```bash
mv native/iphone-screen/out/iphone-screen native/iphone-screen/out/iphone-screen.away
CSC_IDENTITY_AUTO_DISCOVERY=false npx electron-builder --mac --dir --arm64 -c.mac.notarize=false -c.mac.identity=null 2>&1 | grep missing
mv native/iphone-screen/out/iphone-screen.away native/iphone-screen/out/iphone-screen
rm -rf dist
```
Expected: `⨯ native/iphone-screen/out/iphone-screen is missing: run npm run build:iphone (it needs
Xcode's command line tools)`.

- [ ] **Step 7: Commit**

```bash
git add src/main/permissions.ts src/main/permissions.test.ts src/main/index.ts electron-builder.yml build/entitlements.mac.plist scripts/before-pack.cjs
git -c user.email=franco@effektstudios.com commit -m "iPhones: the helper in the Mac app, signed with the camera entitlement; the page never gets the camera" -m "Claude-Session: https://claude.ai/code/session_012TidnBvRYbxhSYqPzFZuph"
```

---

### Task 11: Docs

**Files:**
- Modify: `docs/superpowers/specs/2026-11-03-device-panel-design.md`, `CLAUDE.md`, `README.md`,
  `docs/DECK.md`, `docs/TESTING.md`

- [ ] **Step 1: The spec**

In `docs/superpowers/specs/2026-11-03-device-panel-design.md`:
- after the update of 2026-11-11 (its five bullets), a new paragraph: "Updated 2026-11-11 with step 3
  built (`docs/superpowers/plans/2026-11-11-device-panel-iphones.md`). It refines this design in
  these places, written into the sections below:" and, one bullet each, the ten points of "Where this
  plan departs from, or refines, the design calls and the spec" at the top of this plan, each with
  its reason;
- **Finding devices › iPhones** ("the helper reports screen capture devices as they come and go")
  becomes: `iphone-screen list` prints every screen on offer as a JSON line, the first 3 s after it
  starts, then 200 ms after the last connect or disconnect, and looks again every 5 s (an unchanged
  list isn't sent again); main follows it as it does the notifier (`LineTracker`: restarts 1 s
  doubling to 30 s, 20 s for a first list doubling to 2 minutes), with its stdin a pipe the helper
  ends on; a helper that fails lists no iPhones, quietly; iOS is pending until both the simulators
  and the iPhones have listed;
- **States › Camera not allowed:** shown at once, not after the retries, with **Open System
  Settings** and **Try again**; **Nothing connected:** "Plug in an Android phone with USB debugging on
  or an iPhone, start an emulator, or boot a simulator." where both are wanted, "Plug in an iPhone,
  or boot a simulator in Xcode or with simctl." for iOS alone (macOS only: Windows says what it says
  now);
- **How › iPhones:** the commands and their failures (`camera-denied`, `not-found` within 10 s,
  `no-picture` 15 s after the capture starts, `disconnected`, `capture`, `encoder`, `usage`; JSON on
  stderr, exit 1, `usage` 64; stdin's end exits 0); the stream (420v capture, `VTPixelTransferSession`
  to even sizes within 1600 px and never larger, H.264 High in real time, no reordering, 8 Mbit/s, a
  key frame at least every 10 s; scrcpy's video stream from the codec id on; a session header and a
  new encoder per size; a config packet before every key frame; `key` on stdin); the session
  resolving once the helper runs (the prompt), dropping input; the camera asked once, for the
  responsible app (Deck; a dev build's launcher); built with `swiftc` at install (macOS 13, arm64,
  Swift 5 mode), skipped without Xcode's command line tools, a packaged build stopped without it; the
  page refused the camera and microphone;
- **The view › Keeping up:** "the helper's request" is a key frame it forces, behind a config packet;
- **Code:** `ios/tracker.ts` (`LineTracker`, the notifier's and the helper's), `ios/iphone.ts` (the
  helper's lists, `IphoneTracker`, a session), `native/iphone-screen/` (`main.swift`, `Output.swift`,
  `Encoder.swift`, `Screens.swift`, `SelfTest.swift`), `scripts/build-iphone-helper.mjs`,
  `src/main/permissions.ts`;
- **Packaging:** done as written, plus `entitlementsInherit` (the same file) for the helper;
- **Known limits:** an iPad lists as "iPhone · cable · view only"; while macOS's camera prompt is up
  the panel says "Connecting to …"; a camera restricted by a profile reads as "Camera not allowed"
  too; whether the capture device's ID survives a restart of the Mac isn't known; a Mac without
  Xcode's command line tools builds no helper and shows no iPhones;
- **Build order:** step 3 built (the date it's merged);
- **Testing › Unit:** the helper's selftest read with scrcpy's reader (CI, macOS), its lists, the
  tracker, a session against fake processes, the blocked stream, the three sources' list and races.

- [ ] **Step 2: `CLAUDE.md`**

- **Current state:** after the step 2 sentence, "Step 3 (iPhones: plan
  `docs/superpowers/plans/2026-11-11-device-panel-iphones.md`; built <date>): an iPhone on a cable in
  an iOS project's tabs, view only, through a Swift helper (`native/iphone-screen/`) that captures
  macOS's iPhone screen device and encodes H.264. Checked in unit tests and the helper's selftest; the
  hands-on checks with Franco's iPhone are <done/to do> (Device panel › iPhones)." and drop "iPhones
  are step 3.";
- **The paths table:** the `src/main/devices/` row's `ios/` gains "and Deck's iPhone helper: its
  lists and a session (`iphone.ts`); `tracker.ts`, the restarting `LineTracker` both run on", and
  `registry.ts` "(one list from the three sources)"; a new row after `resources/`:
  `| native/iphone-screen/ | Deck's iPhone helper (Swift): lists the iPhone screens macOS offers and streams one as scrcpy's video stream; built at install by scripts/build-iphone-helper.mjs into its ignored out/ |`
  (with the paths in backticks);
- **Device panel**, after the **Simulators** bullet, a new bullet:

```markdown
  - **iPhones** (`native/iphone-screen/`, `ios/iphone.ts`, macOS only; measured 2026-11-11 with
    Franco's iPhone 17 Pro on iOS 27):
    - **The screen is a capture device** once a process sets CoreMediaIO's
      `kCMIOHardwarePropertyAllowScreenCaptureDevices` (QuickTime's switch, per process): model "iOS
      Device", muxed, `.external`, the phone's name, one `muxx` format of 0×0 until frames come; 0.5 s
      after the switch with the phone plugged in, 2.5 s after a replug. The phone's Continuity Camera
      ("… iPhone Camera", `iPhone18,1`, video only) is listed too and never opened. Its `uniqueID` (a
      UUID) isn't the UDID but stayed the same across runs and replugs: the device id is
      `iphone:<uniqueID>`. Whether it survives a restart of the Mac isn't known.
    - **The helper** (Swift 5 mode, `-target arm64-apple-macos13.0`: Electron 45's minimum) is built by
      `scripts/build-iphone-helper.mjs` from postinstall into `native/iphone-screen/out/` (ignored),
      and skipped while newer than its sources; `npm run build:iphone` after changing it. Without a
      developer folder it's skipped with a note (`/usr/bin/swiftc` would offer the command line tools
      in a dialog; `xcode-select -p` only answers); a failed compile stops `npm ci`; `before-pack.cjs`
      stops a Mac build without it. Packaged it's `Resources/iphone-screen`, signed like every binary
      there (`entitlementsInherit`, hardened runtime, timestamp). A global in `main.swift` is set up
      as its top-level code reaches it, so the rest lives in other files; it's built under its final
      name in a temporary folder, since the linker's ad hoc signature takes the output's name.
    - **`list`** prints `{"devices":[{"id","name"}]}` lines: the first 3 s after it starts (so the
      screens offered in the first moments are in it and the first-list wait isn't fooled), then
      200 ms after the last connect or disconnect, and a look every 5 s; an unchanged list isn't sent
      again. Main follows it with the notifier's `LineTracker` (`ios/tracker.ts`), its stdin a pipe:
      the helper ends when it closes, a crashed Deck's included. A failing helper is quiet (main's log):
      no iPhones. iOS stays `pending` until the simulators and the iPhones have both listed, so an iOS
      tab says "Looking for devices…" for about 3 s.
    - **`stream <id> --max-size 1600 --max-fps 60`** asks for the camera, waits up to 10 s for the
      screen (`not-found`), captures 420v, scales with `VTPixelTransferSession` (even sizes, never
      larger: 1206×2622 → 736×1600) and encodes H.264 High in real time, no reordering, 8 Mbit/s, a
      key frame at least every 10 s. stdout is scrcpy's video stream from the codec id on
      (`VideoReader({ from: 'codec' })`): a session header per size (a rotation makes a new encoder),
      and a config packet before *every* key frame, since a viewer that joins or a decoder behind asks
      for one (`key` on stdin) and can't decode it without. No frame 15 s after the capture starts:
      `no-picture`. Failures are one JSON line on stderr (`camera-denied`, `not-found`, `no-picture`,
      `disconnected`, `capture`, `encoder`, `usage`), exit 1 (`usage` 64); stdin's end exits 0.
      `selftest` runs the encoder and the framing on made-up frames (`iphone-helper.test.ts`, in CI):
      `|ckppckpp|ckppppp` on the hardware encoder and on VideoToolbox's software one.
    - **The session** (`startIphone`) resolves once the helper runs, so the streams' 20 s start
      deadline doesn't cut the camera prompt short, and drops input (view only). `camera-denied` ends
      it blocked (`blocked: 'camera'`): "Camera not allowed" at once, with Open System Settings
      (`x-apple.systempreferences:com.apple.preference.security?Privacy_Camera`) and Try again, never
      retried.
    - **The camera:** asked once, for the responsible app (Deck), with `NSCameraUsageDescription`;
      `com.apple.security.device.camera` is in the one entitlements file the app and the helper are
      both signed with. The page is refused `media` permissions (`src/main/permissions.ts`): Electron
      grants every request it isn't told about, and the camera would be open to the page once allowed.
      A dev build started from a terminal is that terminal's child, so macOS most likely asks (or
      refuses) for the terminal: start it through LaunchServices for a check (`open -n
      node_modules/electron/dist/Electron.app --args …`), as the step 3 plan's Task 12 does.
    - **Known limits:** view only; an iPad lists as "iPhone · cable · view only"; while macOS's camera
      prompt is up the panel says "Connecting to …"; a camera restricted by a profile reads as "Camera
      not allowed" too.
```

- **Simulators › One list:** "adb's devices, then the simulators" becomes "Android phones, then
  iPhones, then emulators, then simulators (`registry.ts`, three sources)";
- **Which device a tab shows:** "simulators an iOS one" becomes "simulators and iPhones an iOS one";
- **The screen › Touch:** add "An iPhone takes no input and never the keyboard.";
- **Not yet checked:** add "an iPhone: Task 12 of the step 3 plan" until it's done;
- **Branding and packaging:** the entitlements row reads "(JIT, node-pty, network, the camera for the
  iPhone helper)"; the `electron-builder.yml` row adds "and, on macOS, the iPhone helper
  (`mac.extraResources`) and `NSCameraUsageDescription`; `beforePack` also stops a Mac build without
  the helper";
- **Next steps 5:** "step 3 (iPhones, a Swift helper on CoreMediaIO) built <date>; next the hands-on
  checks with Franco's iPhone (plan Task 12)";
- **Security (M4):** "Deny permission requests." becomes "Deny permission requests (the camera and
  microphone are, since step 3: `src/main/permissions.ts`).";
- **Handy commands:** under the `ios/` tests line, `npm run build:iphone   # the iPhone helper, after changing native/iphone-screen/`.

- [ ] **Step 3: `README.md`**

The **Device panel** paragraph's first two sentences become:

```markdown
- **Device panel** (top of the right pane in an Android or iOS app's tabs; Cmd/Ctrl+Shift+D hides it,
  or shows it in any other tab): the phone, emulator or, on macOS, simulator (with idb-companion from
  Homebrew) or iPhone on a cable the app runs on, live. Click to tap, drag to swipe, scroll with the
  wheel (drag on a simulator), and type and paste with the screen selected (Option and Cmd editing
  keys work as on a Mac); Back, Home, Recent apps and Power in its header (Home for a simulator) and,
  while Claude runs, a camera that adds a screenshot to Claude's prompt. An iPhone is view only (its
  header has just the camera), and the first time macOS asks to let Deck use the camera, which is how
  it shows an iPhone's screen.
```

(the rest of the paragraph as it is).

- [ ] **Step 4: `docs/DECK.md`**

The **Device panel** line: "(step 1, Android, built 2026-11-03/04, Windows to test; step 2,
simulators, built 2026-11-10, macOS; step 3, iPhones, built <date>, macOS): … (scrcpy's server over
adb, idb-companion's `sim-video` and `idb_companion` for a simulator, or Deck's Swift helper on
CoreMediaIO for an iPhone; decoded with WebCodecs), with touch, keys, paste (an iPhone is view only)
and a screenshot for Claude." and drop "iPhones (a Swift helper on CoreMediaIO) are step 3."

- [ ] **Step 5: `docs/TESTING.md`**

Append a macOS section at the end of the file (its steps numbered apart from Windows'):

```markdown
## macOS: an iPhone on a cable

Install the latest draft or release (`Deck-<version>-mac-arm64.dmg`). An iPhone that trusts this Mac,
unlocked, on a cable, and a folder with an Xcode project in a git repository.

i1. Open Deck in the iOS project's folder: after about 3 s ("Looking for devices…") the device panel
    shows the iPhone, or asks between it and a booted simulator. Its ▾ menu says
    `iPhone · cable · view only`; the phone's own camera isn't offered.
i2. The first time, macOS asks whether Deck may use the camera: "Deck shows a connected iPhone's
    screen, which macOS treats as a camera." Allow: the screen shows within a few seconds.
i3. The header has no Back, Home or Power. With Claude running in the tab, the camera adds a
    screenshot to Claude's prompt as [Image #N]. Clicking the screen does nothing, and typing still
    goes to the terminal.
i4. Turn the phone to landscape in an app that turns (Photos): the picture turns with it.
i5. Switch to another tab and back within 10 s: the picture is back at once.
i6. Lock the phone, then unlock it: note what the panel shows.
i7. Unplug it: "disconnected" over the dimmed picture, and the panel goes 10 s later. Plug it in
    again: it's back within a few seconds.
i8. In System Settings › Privacy & Security › Camera, turn Deck off. In Deck, switch to another tab
    for 15 s, then back: "Camera not allowed" at once (no "Reconnecting…"), with **Open System
    Settings**, which opens that page. Turn Deck on, then **Try again**: the screen shows.
i9. Quit Deck: Activity Monitor shows no `iphone-screen` left.
```

- [ ] **Step 6: Commit**

```bash
git add docs CLAUDE.md README.md
git -c user.email=franco@effektstudios.com commit -m "Docs: the device panel, step 3 (iPhones)" -m "Claude-Session: https://claude.ai/code/session_012TidnBvRYbxhSYqPzFZuph"
```

---

### Task 12: On Franco's iPhone

For the controller, with Franco: the first runs of `list` and `stream` against a real phone. A dev
build with its own userData, started through LaunchServices so the camera is asked for Electron
itself, not for the terminal that ran the commands. No Claude prompt is sent (no tokens in checks):
Claude may run in the tab for the camera button, but nothing is submitted. Franco answers macOS's
prompts himself.

- [ ] **Step 1: Build, and a throwaway iOS project**

```bash
npm ci && npm test && npm run build
[ -d node_modules/electron/dist ] || node node_modules/electron/install.js
SCR=<the session's scratchpad>; REPO="$SCR/ios-check"
mkdir -p "$REPO/App.xcodeproj" && git -C "$REPO" init -q
```

- [ ] **Step 2: The dev build, through LaunchServices**

Franco's iPhone plugged in, unlocked, trusting this Mac:

```bash
open -n node_modules/electron/dist/Electron.app --args --inspect=9229 "$PWD" \
  --user-data-dir="$SCR/deck-iphone-data" --remote-debugging-port=9333 --open "$REPO"
```

(Electron.app is then its own responsible process, and its `Info.plist` has a camera usage string:
the prompt names "Electron". `npm run dev` from a terminal would most likely ask for the terminal
instead, or be refused without a prompt when it has no camera usage string.)

- [ ] **Step 3: Check, through `Runtime.evaluate`, `pgrep` and Franco's eyes**

Read the panel with `Runtime.evaluate` on the page (CLAUDE.md, Handy commands):
`document.querySelector('.dp-name')?.textContent`, `.dp-detail`, the `.dp-buttons` titles,
`.dp-overlay`'s text, and the `.dp-screen` canvas's `width`, `height` and `tabIndex`.

- the panel says "Looking for devices…" for about 3 s, then shows the phone by its name with
  `iPhone · cable · view only`; the ▾ menu has no "… iPhone Camera"; `pgrep -fl "iphone-screen list"`
  shows one;
- macOS asks for the camera, naming Electron; Franco allows; the picture comes within about 3 s;
  `pgrep -fl "iphone-screen stream"` shows one with `--max-size 1600 --max-fps 60`; the canvas is
  736×1600 in proportion; the header has no buttons, or only "Add screenshot to Claude" with Claude
  running (then a press types the path; don't submit it); the canvas has no `tabindex` attribute,
  and after a click on it `document.activeElement` is still the terminal's;
- turning the phone in an app that rotates: the canvas turns (record the sizes). If the picture turns
  inside a portrait frame instead, the phone letterboxes: note it;
- another tab and back within 10 s: the same `iphone-screen stream` pid, the picture back within
  about a second;
- the phone locked, then unlocked: record what the panel shows (a frozen picture, black, or
  "Couldn't show …" with "The iPhone sent no picture…" after 15 s and the retries);
- the cable pulled: "disconnected" over the dimmed picture, the panel gone 10 s later, no
  `iphone-screen stream` left; plugged back: listed again within about 3 s;
- the camera refused: quit the dev build, `tccutil reset Camera com.github.Electron`, start it again
  (Step 2); Franco answers "Don't Allow": "Camera not allowed" at once with the detail, **Open System
  Settings** and **Try again**, and no "Reconnecting…" before it. Open System Settings shows Privacy &
  Security › Camera (it's `x-apple.systempreferences:…?Privacy_Camera`; if macOS 27 lands elsewhere,
  record where). Franco turns Electron on; Try again: the picture;
- the cost, with something moving on the phone for 30 s:
  `ps -o pid,%cpu,rss,command -p "$(pgrep -d, -f iphone-screen)"` and Electron's own processes;
- quitting (`app.quit()` through `--inspect`): no `iphone-screen` left. Then start it again, stream,
  and `pkill -9 -f deck-iphone-data` (a crash): within a second no `iphone-screen` is left either
  (their stdin closed).

- [ ] **Step 4: The packaged app's own prompt**

```bash
CSC_IDENTITY_AUTO_DISCOVERY=false npx electron-builder --mac --dir --arm64 -c.mac.notarize=false -c.mac.identity=null
tccutil reset Camera com.effektstudios.deck
open -n dist/mac-arm64/Deck.app --args --user-data-dir="$SCR/deck-iphone-packaged" --open "$REPO"
```

Expected: macOS names "Deck", with "Deck shows a connected iPhone's screen, which macOS treats as a
camera."; allowed, the picture comes. (The reset also forgets the installed Deck's camera answer: it
had none before step 3.) Quit it and `rm -rf dist`.

- [ ] **Step 5: If something fails**

- The helper refused without a prompt in the packaged app: `log show --last 2m --predicate
  'subsystem == "com.apple.TCC"'` names the process TCC judged. If it wants the helper's own usage
  string, embed one: an `Info.plist` with `NSCameraUsageDescription` linked in by
  `scripts/build-iphone-helper.mjs` (`-Xlinker -sectcreate -Xlinker __TEXT -Xlinker __info_plist
  -Xlinker <plist>`), a new task.
- Plugging or unplugging takes up to 5 s to show: `wasConnected`/`wasDisconnected` aren't posted
  for screen devices, and only the 5 s look catches them; note it (key-value observing
  `DiscoverySession.devices` would be the fix).
- No picture at all after the camera is allowed: `iphone-screen stream`'s stderr (main's log, or
  run the dev build from a terminal with `open -W --stderr`) says which step failed.

- [ ] **Step 6: After the merge: the signed app**

On the release draft CI builds (`gh workflow run release.yml --ref main`), from the dmg:

```bash
codesign -d --entitlements - /Volumes/Deck*/Deck.app/Contents/Resources/iphone-screen
codesign -dv /Volumes/Deck*/Deck.app/Contents/Resources/iphone-screen 2>&1 | grep -E 'flags|TeamIdentifier'
```

Expected: `com.apple.security.device.camera` among the entitlements; `flags=0x10000(runtime)` and
`TeamIdentifier=QT63GS3Q44`. Installed, the notarised Deck shows the iPhone, asking for the camera
once as "Deck".

- [ ] **Step 7: Record and commit**

Write what was checked, and what wasn't, into CLAUDE.md's **iPhones** bullet (as "Checked on a
simulator" does for step 2) and the spec's **Testing › iPhone**, then:

```bash
git add CLAUDE.md docs
git -c user.email=franco@effektstudios.com commit -m "Docs: step 3 checked with Franco's iPhone" -m "Claude-Session: https://claude.ai/code/session_012TidnBvRYbxhSYqPzFZuph"
```
