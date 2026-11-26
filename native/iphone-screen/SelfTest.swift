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
