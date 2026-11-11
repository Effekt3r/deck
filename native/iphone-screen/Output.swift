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
