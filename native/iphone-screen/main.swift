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
