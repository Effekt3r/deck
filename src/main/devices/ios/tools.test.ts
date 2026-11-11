import { chmodSync, mkdirSync, mkdtempSync, realpathSync, rmSync, symlinkSync, writeFileSync } from 'node:fs'
import { tmpdir } from 'node:os'
import { delimiter, join } from 'node:path'
import { afterAll, describe, expect, it } from 'vitest'
import { anySimulatorBooted, findIdb, idbCandidates } from './tools'

// realpath'd: findIdb resolves the symlink, and on macOS tmpdir() is itself under /var, a symlink
// to /private/var, so the raw mkdtemp path wouldn't match what realpath resolves to (same fix as
// install.test.ts's "a cd inside a command line" case). The native binding, not realpathSync's own
// JS fallback: on Windows the fallback keeps mkdtemp's short "RUNNER~1" form, while findIdb's
// realpath returns the long one (test-repo.ts, test-log.ts use the same fix).
const root = realpathSync.native(mkdtempSync(join(tmpdir(), 'deck-idb-')))
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

  it('ignores a relative DECK_IDB_COMPANION, as a relative PATH entry would mean "the current folder"', () => {
    const env = { PATH: '/usr/bin', DECK_IDB_COMPANION: 'idb_companion' }
    expect(idbCandidates(env)).toEqual(idbCandidates({ PATH: '/usr/bin' }))
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

  it.skipIf(process.platform === 'win32')('falls back beside the real file when the stable opt link has no sim-video', async () => {
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

describe('anySimulatorBooted', () => {
  it('says true when pgrep -x launchd_sim finds one', async () => {
    const calls: [string, string[]][] = []
    const run = async (cmd: string, args: string[]) => {
      calls.push([cmd, args])
      return '1234\n'
    }
    expect(await anySimulatorBooted({ run })).toBe(true)
    expect(calls).toEqual([['/usr/bin/pgrep', ['-x', 'launchd_sim']]])
  })

  it('says false when pgrep exits 1 (no match), or fails outright', async () => {
    const noMatch = async () => {
      throw Object.assign(new Error('Command failed'), { code: 1 })
    }
    expect(await anySimulatorBooted({ run: noMatch })).toBe(false)
    const broken = async () => {
      throw new Error('pgrep: not found')
    }
    expect(await anySimulatorBooted({ run: broken })).toBe(false)
  })

  it('says false even if pgrep somehow exits 0 with no output', async () => {
    expect(await anySimulatorBooted({ run: async () => '' })).toBe(false)
    expect(await anySimulatorBooted({ run: async () => '\n' })).toBe(false)
  })
})
