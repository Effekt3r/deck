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
  if (context.electronPlatformName === 'darwin') {
    // npm ci builds the helper; built again here if a source changed since (a current one is left
    // alone), so a package never ships a stale one. A failed build stops this one as it stops the install.
    const { buildIphoneHelper, IPHONE_HELPER } = await import('./build-iphone-helper.mjs')
    buildIphoneHelper()
    // Still none: a Mac without Xcode's command line tools builds none, with only a note.
    if (!existsSync(IPHONE_HELPER)) {
      throw new Error("native/iphone-screen/out/iphone-screen is missing: run npm run build:iphone (it needs Xcode's command line tools)")
    }
  }
}
