// Builds Deck's iPhone helper (native/iphone-screen/, Swift) into native/iphone-screen/out/, on macOS
// only: run by postinstall (scripts/postinstall.mjs), so dev and CI builds have it, or by hand with
// `npm run build:iphone` after changing it. A Mac without Xcode or its command line tools gets no
// helper, and so no iPhones in the device panel, with a note: a packaged build then stops
// (scripts/before-pack.cjs), and on CI the install stops at once. A toolchain that's there but fails
// to build it stops the install.
import { execFileSync } from 'node:child_process'
import { existsSync, mkdirSync, mkdtempSync, readdirSync, realpathSync, renameSync, rmSync, statSync } from 'node:fs'
import { dirname, join } from 'node:path'
import { fileURLToPath } from 'node:url'

const sources = fileURLToPath(new URL('../native/iphone-screen/', import.meta.url))
export const IPHONE_HELPER = join(sources, 'out', 'iphone-screen')
/** Apple silicon only, like Deck; macOS 13, Electron 45's own minimum (its LSMinimumSystemVersion). */
const TARGET = 'arm64-apple-macos13.0'

/** Whether there's a developer folder, Xcode's or the command line tools'. Without one,
 *  /usr/bin/swiftc (a shim) would offer to install the tools in a dialog: xcode-select only answers.
 *  It also names a folder that has since been deleted (or a DEVELOPER_DIR that isn't there) and
 *  exits 0, so the folder must exist too. */
function hasDeveloperFolder() {
  try {
    const folder = execFileSync('/usr/bin/xcode-select', ['-p'], { encoding: 'utf8', stdio: ['ignore', 'pipe', 'ignore'] }).trim()
    return folder !== '' && existsSync(folder)
  } catch {
    return false
  }
}

export function buildIphoneHelper() {
  if (process.platform !== 'darwin') return
  if (!hasDeveloperFolder()) {
    // CI and releases stop here, since the selftest (iphone-helper.test.ts) must check the encoder;
    // a local install carries on.
    if (process.env.CI) throw new Error('iphone-screen: no Xcode command line tools to build it with')
    console.warn('iphone-screen: no Xcode command line tools, so no iPhones (xcode-select --install, then npm run build:iphone)')
    return
  }
  const files = readdirSync(sources).filter((name) => name.endsWith('.swift')).sort().map((name) => join(sources, name))
  // The folder's own time too: a source removed changes no file's.
  const newest = Math.max(...[sources, ...files, fileURLToPath(import.meta.url)].map((file) => statSync(file).mtimeMs))
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
