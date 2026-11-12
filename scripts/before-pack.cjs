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
