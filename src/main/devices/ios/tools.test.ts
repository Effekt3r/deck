import { chmodSync, mkdirSync, mkdtempSync, realpathSync, rmSync, symlinkSync, writeFileSync } from 'node:fs'
import { tmpdir } from 'node:os'
import { delimiter, join } from 'node:path'
import { afterAll, describe, expect, it } from 'vitest'
import { findIdb, idbCandidates, simulatorBooted } from './tools'

// realpath'd: findIdb resolves the symlink, and on macOS tmpdir() is itself under /var, a symlink
// to /private/var, so the raw mkdtemp path wouldn't match what realpath resolves to (same fix as
// install.test.ts's "a cd inside a command line" case).
const root = realpathSync(mkdtempSync(join(tmpdir(), 'deck-idb-')))
afterAll(() => rmSync(root, { recursive: true, force: true }))

function tool(path: string) {
  mkdirSync(join(path, '..'), { recursive: true })
  writeFileSync(path, '#!/bin/sh\n')
  chmodSync(path, 0o755)
}

describe('idbCandidates', () => {
  it("looks in PATH's absolute folders, then Homebrew's", () => {
    const env = { PATH: ['/usr/bin', 'relative', '/opt/homebrew/bin'].join(delimiter) }
    expect(idbCandidates(env)).toEqual(['/usr/bin', '/opt/homebrew/bin', '/usr/local/bin'].map((d) => join(d, 'idb_companion')))
  })

  it('takes DECK_IDB_COMPANION alone, for checks', () => {
    expect(idbCandidates({ PATH: '/usr/bin', DECK_IDB_COMPANION: '/nowhere/idb_companion' })).toEqual(['/nowhere/idb_companion'])
  })
})

describe('findIdb', () => {
  it.skipIf(process.platform === 'win32')('finds sim-video beside the real idb_companion, through a link', async () => {
    const libexec = join(root, 'Cellar', 'idb-companion', '1.6.1', 'libexec')
    tool(join(libexec, 'idb_companion'))
    tool(join(libexec, 'sim-video'))
    mkdirSync(join(root, 'bin'))
    symlinkSync(join(libexec, 'idb_companion'), join(root, 'bin', 'idb_companion'))
    expect(await findIdb([join(root, 'missing', 'idb_companion'), join(root, 'bin', 'idb_companion')]))
      .toEqual({ companion: join(root, 'bin', 'idb_companion'), simVideo: join(libexec, 'sim-video') })
  })

  it('says when sim-video is missing, and when nothing is found', async () => {
    tool(join(root, 'old', 'idb_companion'))
    expect(await findIdb([join(root, 'old', 'idb_companion')])).toEqual({ companion: join(root, 'old', 'idb_companion'), simVideo: null })
    expect(await findIdb([join(root, 'none', 'idb_companion')])).toBeNull()
  })
})

describe('simulatorBooted', () => {
  const run = (answers: Record<string, string | Error>) => async (cmd: string) => {
    const answer = answers[cmd]
    if (answer instanceof Error) throw answer
    return answer ?? ''
  }

  it('asks simctl only with a developer folder selected', async () => {
    expect(await simulatorBooted(run({ 'xcode-select': new Error('no developer folder') }))).toBe(false)
    const booted = JSON.stringify({ devices: { 'com.apple.CoreSimulator.SimRuntime.iOS-27-0': [{ state: 'Booted' }] } })
    expect(await simulatorBooted(run({ 'xcode-select': '/Applications/Xcode.app\n', xcrun: booted }))).toBe(true)
    expect(await simulatorBooted(run({ 'xcode-select': '/x\n', xcrun: JSON.stringify({ devices: {} }) }))).toBe(false)
    expect(await simulatorBooted(run({ 'xcode-select': '/x\n', xcrun: 'not json' }))).toBe(false)
  })
})
