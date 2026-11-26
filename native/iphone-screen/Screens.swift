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
  _exit(0)
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
  // The capture owns the session and takes its frames: it lives as long as the run loop, not as long
  // as something happens to hold it.
  withExtendedLifetime(capture) { RunLoop.main.run() }
  _exit(0)
}

private func number(_ text: String?, within range: ClosedRange<Int>) -> Int {
  guard let text, let value = Int(text), range.contains(value) else {
    fail("usage", "iphone-screen stream <id> [--max-size N] [--max-fps N]", status: 64)
  }
  return value
}

/// A capture error as a failure. macOS refusing the camera, and a pulled cable, have failures of their
/// own: the first isn't retried, and the second says what happened.
private func failCapture(_ error: Error?, _ message: String) -> Never {
  switch (error as? AVError)?.code {
  case .applicationIsNotAuthorizedToUseDevice?: fail("camera-denied")
  case .deviceWasDisconnected?: fail("disconnected")
  default: fail("capture", message)
  }
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
  /// Where the capture starts (open()).
  private let starting = DispatchQueue(label: "iphone-screen.start")
  /// On `frames`: the newest frame captured, the time of the last one encoded, and how many were.
  private var newest: CVPixelBuffer?
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

  /// The next frame is a key frame. A still screen most likely sends no frames, which would leave a
  /// viewer that joins, or a decoder that fell behind, blank until something moves: so when none has
  /// been encoded 100 ms later, the newest is encoded again as that key frame, 1 ms after the last.
  func requestKeyFrame() {
    frames.async {
      self.encoder.requestKeyFrame()
      let before = self.encoded
      self.frames.asyncAfter(deadline: .now() + 0.1) {
        guard self.encoded == before, let frame = self.newest else { return }
        self.encode(frame, at: CMTimeAdd(self.lastFrame, CMTime(value: 1, timescale: 1000)))
      }
    }
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
      failCapture(error, "The iPhone's screen couldn't be opened: \(error.localizedDescription)")
    }
    // Deck shows the picture only, and an audio stream that's taken may also bring the phone's sound
    // to the Mac, as QuickTime does. Not yet checked on a phone.
    for port in input.ports where port.mediaType == .audio { port.isEnabled = false }
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
      failCapture(error, "The iPhone's screen stopped: \(error?.localizedDescription ?? "no reason given").")
    }
    // An interrupted capture just sends no more frames: without this, the last picture would stay up
    // with no error. macOS gives no reason.
    NotificationCenter.default.addObserver(forName: AVCaptureSession.wasInterruptedNotification, object: session, queue: .main) { _ in
      fail("capture", "The iPhone's screen was interrupted (another app may have taken it).")
    }
    NotificationCenter.default.addObserver(forName: AVCaptureDevice.wasDisconnectedNotification, object: device, queue: .main) { _ in
      fail("disconnected")
    }
    // startRunning() blocks until the capture runs: not on the main thread, nor on `frames`, where
    // the check below must run even if it never returns.
    starting.async { self.session.startRunning() }
    DispatchQueue.main.asyncAfter(deadline: .now() + Self.firstFrameWithin) {
      self.frames.async { if self.encoded == 0 { fail("no-picture") } }
    }
  }

  func captureOutput(_ output: AVCaptureOutput, didOutput sampleBuffer: CMSampleBuffer, from connection: AVCaptureConnection) {
    guard let frame = CMSampleBufferGetImageBuffer(sampleBuffer) else { return }
    let time = CMSampleBufferGetPresentationTimeStamp(sampleBuffer)
    newest = frame
    // --max-fps: a frame sooner than ¾ of its gap after the last is skipped, so the jitter of a
    // 60 Hz screen doesn't thin it at 60.
    if lastFrame.isValid, CMTimeGetSeconds(CMTimeSubtract(time, lastFrame)) < 0.75 / Double(maxFrameRate) { return }
    encode(frame, at: time)
  }

  /// On `frames`. Times only ever go up: a frame captured too soon after the last is skipped (above).
  private func encode(_ frame: CVPixelBuffer, at time: CMTime) {
    lastFrame = time
    encoded += 1
    encoder.encode(frame, at: time)
  }
}
