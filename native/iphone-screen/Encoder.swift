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
