import { chmodSync, mkdirSync, mkdtempSync, rmSync, writeFileSync } from 'node:fs'
import { tmpdir } from 'node:os'
import { join } from 'node:path'
import { afterAll, describe, expect, it } from 'vitest'
import { AdbError, adbCandidates, findAdb, runAdb } from './adb'

const root = mkdtempSync(join(tmpdir(), 'deck-adb-'))
afterAll(() => rmSync(root, { recursive: true, force: true }))

describe('adbCandidates', () => {
  it('macOS: ANDROID_HOME, the SDK under ~/Library, then PATH and Homebrew', () => {
    expect(adbCandidates({ ANDROID_HOME: '/sdk', PATH: '/usr/bin:/bin' }, 'darwin', '/Users/f')).toEqual([
      '/sdk/platform-tools/adb',
      '/Users/f/Library/Android/sdk/platform-tools/adb',
      '/usr/bin/adb',
      '/bin/adb',
      '/opt/homebrew/bin/adb',
      '/usr/local/bin/adb',
    ])
  })

  it('Windows: the SDK under LOCALAPPDATA, adb.exe, PATH split on ;', () => {
    expect(adbCandidates({ LOCALAPPDATA: 'C:\\Users\\f\\AppData\\Local', PATH: 'C:\\Windows;C:\\tools' }, 'win32', 'C:\\Users\\f')).toEqual([
      'C:\\Users\\f\\AppData\\Local\\Android\\Sdk\\platform-tools\\adb.exe',
      'C:\\Windows\\adb.exe',
      'C:\\tools\\adb.exe',
    ])
  })

  it('lists each file once', () => {
    const files = adbCandidates({ ANDROID_HOME: '/Users/f/Library/Android/sdk', PATH: '' }, 'darwin', '/Users/f')
    expect(files.filter((f) => f === '/Users/f/Library/Android/sdk/platform-tools/adb')).toHaveLength(1)
  })
})

describe('findAdb', () => {
  it('takes the first one that is there', async () => {
    const dir = join(root, 'platform-tools')
    mkdirSync(dir)
    const adb = join(dir, process.platform === 'win32' ? 'adb.exe' : 'adb')
    writeFileSync(adb, '')
    chmodSync(adb, 0o755)
    expect(await findAdb([join(root, 'missing', 'adb'), adb])).toBe(adb)
    expect(await findAdb([join(root, 'missing', 'adb')])).toBeNull()
  })
})

describe('runAdb', () => {
  // Node stands in for adb: what matters is the output and the error.
  it('resolves with stdout', async () => {
    expect(await runAdb(process.execPath, ['-e', 'process.stdout.write("27183\\n")'])).toBe('27183\n')
  })

  it("rejects with adb's last word", async () => {
    const failing = runAdb(process.execPath, ['-e', 'console.error("* daemon started successfully"); console.error("adb: device offline"); process.exit(1)'])
    await expect(failing).rejects.toThrow(new AdbError('adb: device offline'))
  })
})
