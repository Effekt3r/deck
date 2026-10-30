// node-pty 1.1.0 publishes its macOS spawn-helper without the execute bit, so
// after a fresh install every pty.spawn fails with "posix_spawnp failed" (and a
// packaged app can't open a shell). Restore it.
import { chmodSync } from 'node:fs'

for (const arch of ['arm64', 'x64']) {
  try {
    chmodSync(`node_modules/node-pty/prebuilds/darwin-${arch}/spawn-helper`, 0o755)
  } catch {
    // not installed for this platform
  }
}
