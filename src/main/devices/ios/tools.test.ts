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

  it.skipIf(process.platform === 'win32')("prefers Homebrew's stable opt link over the versioned Cellar path", async () => {
    // brew2/bin/idb_companion -> brew2/Cellar/idb-companion/2.0.0/libexec/idb_companion, with a
    // DIFFERENT sim-video beside the real file: the stable opt link must still win, since a
    // `brew upgrade` can delete the versioned Cellar path a running Deck had realpath'd.
    const prefix = join(root, 'brew2')
    const cellarLibexec = join(prefix, 'Cellar', 'idb-companion', '2.0.0', 'libexec')
    tool(join(cellarLibexec, 'idb_companion'))
    tool(join(cellarLibexec, 'sim-video'))
    tool(join(prefix, 'opt', 'idb-companion', 'libexec', 'sim-video'))
    mkdirSync(join(prefix, 'bin'), { recursive: true })
    symlinkSync(join(cellarLibexec, 'idb_companion'), join(prefix, 'bin', 'idb_companion'))
    expect(await findIdb([join(prefix, 'bin', 'idb_companion')])).toEqual({
      companion: join(prefix, 'bin', 'idb_companion'),
      simVideo: join(prefix, 'opt', 'idb-companion', 'libexec', 'sim-video'),
    })
  })

  it('falls back beside the real file when the stable opt link has no sim-video', async () => {
    // brew3/bin/idb_companion exists (so a stable path is computed), but brew3/opt/... doesn't, so
    // this must fall back to beside the realpath'd file like the "missing" tree above.
    const prefix = join(root, 'brew3')
    const cellarLibexec = join(prefix, 'Cellar', 'idb-companion', '3.0.0', 'libexec')
    tool(join(cellarLibexec, 'idb_companion'))
    tool(join(cellarLibexec, 'sim-video'))
    mkdirSync(join(prefix, 'bin'), { recursive: true })
    symlinkSync(join(cellarLibexec, 'idb_companion'), join(prefix, 'bin', 'idb_companion'))
    expect(await findIdb([join(prefix, 'bin', 'idb_companion')])).toEqual({
      companion: join(prefix, 'bin', 'idb_companion'),
      simVideo: join(cellarLibexec, 'sim-video'),
    })
  })
})

describe('simulatorBooted', () => {
  function deps(opts: { xcodeSelect?: string | Error; exists?: boolean; simctl?: string | Error }) {
    const calls: string[] = []
    return {
      calls,
      run: async (cmd: string) => {
        calls.push(cmd)
        if (cmd === '/usr/bin/xcode-select') {
          if (opts.xcodeSelect instanceof Error) throw opts.xcodeSelect
          return opts.xcodeSelect ?? '/Applications/Xcode.app\n'
        }
        if (opts.simctl instanceof Error) throw opts.simctl
        return opts.simctl ?? ''
      },
      exists: async () => opts.exists ?? true,
    }
  }

  it('says false with no developer folder, even though simctl would say booted (no xcrun to fall back to)', async () => {
    const booted = JSON.stringify({ devices: { 'com.apple.CoreSimulator.SimRuntime.iOS-27-0': [{ state: 'Booted' }] } })
    const d = deps({ xcodeSelect: new Error('no developer folder'), simctl: booted })
    expect(await simulatorBooted(d)).toBe(false)
    expect(d.calls).toEqual(['/usr/bin/xcode-select']) // never reaches simctl
  })

  it('says false when simctl is missing at the developer folder, never running xcrun', async () => {
    const d = deps({ exists: false })
    expect(await simulatorBooted(d)).toBe(false)
    expect(d.calls).toEqual(['/usr/bin/xcode-select'])
    expect(d.calls).not.toContain('xcrun')
  })

  it('runs simctl directly at <developer dir>/usr/bin/simctl', async () => {
    const booted = JSON.stringify({ devices: { 'com.apple.CoreSimulator.SimRuntime.iOS-27-0': [{ state: 'Booted' }] } })
    const d = deps({ xcodeSelect: '/Applications/Xcode.app\n', simctl: booted })
    expect(await simulatorBooted(d)).toBe(true)
    expect(d.calls).toEqual(['/usr/bin/xcode-select', join('/Applications/Xcode.app', 'usr', 'bin', 'simctl')])
  })

  it('says false for no booted devices, or unparseable JSON', async () => {
    expect(await simulatorBooted(deps({ xcodeSelect: '/x\n', simctl: JSON.stringify({ devices: {} }) }))).toBe(false)
    expect(await simulatorBooted(deps({ xcodeSelect: '/x\n', simctl: 'not json' }))).toBe(false)
  })
})
