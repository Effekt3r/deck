// Deck runs scrcpy's server on Android devices (src/main/devices/android/scrcpy.ts). It isn't
// committed: this downloads the version resources/scrcpy-server.json names from scrcpy's GitHub
// release and keeps it only when its SHA-256 matches. postinstall runs it; so can
// `npm run fetch:scrcpy`.
import { createHash } from 'node:crypto'
import { readFileSync, renameSync, rmSync, writeFileSync } from 'node:fs'
import { dirname, join } from 'node:path'
import { fileURLToPath } from 'node:url'

const resources = join(dirname(fileURLToPath(import.meta.url)), '..', 'resources')
const info = JSON.parse(readFileSync(join(resources, 'scrcpy-server.json'), 'utf8'))
const file = join(resources, 'scrcpy-server')
const sha256 = (bytes) => createHash('sha256').update(bytes).digest('hex')

function present() {
  try {
    return sha256(readFileSync(file)) === info.sha256
  } catch {
    return false
  }
}

async function fetchServer() {
  if (present()) return console.log(`scrcpy server ${info.version}: already here`)
  const res = await fetch(info.url, { redirect: 'follow', signal: AbortSignal.timeout(120_000) })
  if (!res.ok) throw new Error(`${info.url}: HTTP ${res.status}`)
  const bytes = Buffer.from(await res.arrayBuffer())
  const got = sha256(bytes)
  if (got !== info.sha256) throw new Error(`scrcpy server ${info.version}: SHA-256 ${got}, expected ${info.sha256}`)
  const tmp = `${file}.${process.pid}.tmp`
  try {
    writeFileSync(tmp, bytes)
    renameSync(tmp, file)
  } finally {
    rmSync(tmp, { force: true })
  }
  console.log(`scrcpy server ${info.version}: downloaded`)
}

fetchServer().catch((err) => {
  const cause = err.cause ? ` (${err.cause.message ?? err.cause})` : ''
  console.error(`Couldn't fetch scrcpy's server: ${err.message}${cause}`)
  // Without it Deck can't show Android devices. CI and releases stop here; a local install carries
  // on, and the device panel says what's missing.
  if (process.env.CI) process.exit(1)
})
