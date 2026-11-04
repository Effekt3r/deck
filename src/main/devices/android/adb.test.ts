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

  it('lists ANDROID_SDK_ROOT after ANDROID_HOME', () => {
    const files = adbCandidates({ ANDROID_HOME: '/sdk1', ANDROID_SDK_ROOT: '/sdk2', PATH: '' }, 'darwin', '/Users/f')
    expect(files.slice(0, 2)).toEqual(['/sdk1/platform-tools/adb', '/sdk2/platform-tools/adb'])
  })

  it('falls back to home/AppData/Local on Windows when LOCALAPPDATA is unset', () => {
    const files = adbCandidates({ PATH: '' }, 'win32', 'C:\\Users\\f')
    expect(files).toContain('C:\\Users\\f\\AppData\\Local\\Android\\Sdk\\platform-tools\\adb.exe')
  })

  it('keeps only absolute PATH entries, and skips a relative ANDROID_HOME', () => {
    const files = adbCandidates({ ANDROID_HOME: 'sdk', PATH: '.:bin:/usr/bin' }, 'darwin', '/Users/f')
    expect(files).toEqual([
      '/Users/f/Library/Android/sdk/platform-tools/adb',
      '/usr/bin/adb',
      '/opt/homebrew/bin/adb',
      '/usr/local/bin/adb',
    ])
  })

  it('strips surrounding quotes from a Windows PATH entry', () => {
    const files = adbCandidates({ PATH: '"C:\\Program Files\\Android\\platform-tools"' }, 'win32', 'C:\\Users\\f')
    expect(files).toContain('C:\\Program Files\\Android\\platform-tools\\adb.exe')
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

  it.skipIf(process.platform === 'win32')('skips a file that is not executable', async () => {
    const dir = join(root, 'not-executable')
    mkdirSync(dir)
    const notExecutable = join(dir, 'adb')
    writeFileSync(notExecutable, '')
    chmodSync(notExecutable, 0o644)
    const executable = join(dir, 'adb-real')
    writeFileSync(executable, '')
    chmodSync(executable, 0o755)
    expect(await findAdb([notExecutable, executable])).toBe(executable)
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

  it('prefers a real stderr error line over stdout', async () => {
    const failing = runAdb(process.execPath, [
      '-e',
      'process.stdout.write("serial=R5GL\\nmaker=samsung\\n"); console.error("error: closed"); process.exit(1)',
    ])
    await expect(failing).rejects.toThrow(new AdbError('error: closed'))
  })

  it("picks adb's own error line over the hints that follow it", async () => {
    const failing = runAdb(process.execPath, [
      '-e',
      `console.error("adb: device unauthorized."); console.error("This adb server's $ADB_VENDOR_KEYS is not set"); console.error("Try 'adb kill-server' if that seems wrong."); console.error("Otherwise check for a confirmation dialog on your device."); process.exit(1)`,
    ])
    await expect(failing).rejects.toThrow(new AdbError('adb: device unauthorized.'))
  })

  it('names the exit code when adb said nothing', async () => {
    const failing = runAdb(process.execPath, ['-e', 'process.exit(3)'])
    await expect(failing).rejects.toThrow(new AdbError('adb exited with code 3.'))
  })

  it("floors a short timeout's message at 1 s", async () => {
    const failing = runAdb(process.execPath, ['-e', 'setTimeout(() => {}, 10_000)'], 200)
    await expect(failing).rejects.toThrow(new AdbError("adb didn't answer within 1 s."))
  })

  it('a signal aborted mid-run rejects at once with Stopped.', async () => {
    const controller = new AbortController()
    const failing = runAdb(process.execPath, ['-e', 'setTimeout(() => {}, 10_000)'], 15_000, controller.signal)
    setTimeout(() => controller.abort(), 50)
    await expect(failing).rejects.toThrow(new AdbError('Stopped.'))
  })
})
