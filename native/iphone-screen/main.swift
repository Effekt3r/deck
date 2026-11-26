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
