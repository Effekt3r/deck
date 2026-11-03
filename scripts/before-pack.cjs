// electron-builder's beforePack. electron-builder only warns about a missing extraResources
// file, so a build without scrcpy's server would ship without Android devices: stop it instead.
const { createHash } = require('node:crypto')
const { readFileSync } = require('node:fs')
const { join } = require('node:path')

exports.default = async function beforePack() {
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
}
