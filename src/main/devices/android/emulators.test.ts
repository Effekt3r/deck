import { chmodSync, mkdirSync, mkdtempSync, readFileSync, rmSync, writeFileSync } from 'node:fs'
import { tmpdir } from 'node:os'
import { join } from 'node:path'
import { afterAll, describe, expect, it, vi } from 'vitest'
import { avdNames, emulatorCandidates, findEmulator, isAvdName, killEmulator, listAvds, startableEmulators, startAvd } from './emulators'

const root = mkdtempSync(join(tmpdir(), 'deck-emulators-'))
afterAll(() => rmSync(root, { recursive: true, force: true }))

/** A shell script standing in for a program, in its own folder under `root`: `body` runs with the
 *  arguments it was given, and `$DIR` is that folder. */
function script(name: string, file: string, body: string): string {
  const dir = join(root, name)
  mkdirSync(dir, { recursive: true })
  const path = join(dir, file)
  writeFileSync(path, `#!/bin/sh\nDIR='${dir}'\n${body}\n`)
  chmodSync(path, 0o755)
  return path
}
const argsOf = (name: string) => readFileSync(join(root, name, 'args'), 'utf8')

describe('avdNames', () => {
  it("keeps the AVDs' names, each once, and drops the emulator's own lines and blank ones", () => {
    const out = 'INFO    | Storing crashdata in: /tmp/android-f/emu-crash-37.2.12.db\n\nPixel_8_API_35\r\nMedium_Phone_API_36.1\nPixel_8_API_35\nWARNING | Something odd\n'
    expect(avdNames(out)).toEqual(['Pixel_8_API_35', 'Medium_Phone_API_36.1'])
    expect(avdNames('')).toEqual([])
  })

  it("refuses a name avdmanager wouldn't make, or one starting with a dash", () => {
    expect(['my avd', '-avd', 'a/b', 'x;y', '', 'a'.repeat(201)].filter(isAvdName)).toEqual([])
    expect(['Pixel_9', 'a.b-c_d', '_x'].every(isAvdName)).toBe(true)
  })
})

describe('emulatorCandidates and findEmulator', () => {
  it("is each SDK's emulator/emulator, emulator.exe on Windows", () => {
    expect(emulatorCandidates(['/sdk1', '/sdk2'], 'darwin')).toEqual(['/sdk1/emulator/emulator', '/sdk2/emulator/emulator'])
    expect(emulatorCandidates(['C:\\Sdk'], 'win32')).toEqual(['C:\\Sdk\\emulator\\emulator.exe'])
  })

  it.skipIf(process.platform === 'win32')('takes the first one that can be run', async () => {
    mkdirSync(join(root, 'sdk2', 'emulator'), { recursive: true })
    writeFileSync(join(root, 'sdk2', 'emulator', 'emulator'), '#!/bin/sh\n')
    chmodSync(join(root, 'sdk2', 'emulator', 'emulator'), 0o755)
    mkdirSync(join(root, 'sdk1', 'emulator'), { recursive: true })
    writeFileSync(join(root, 'sdk1', 'emulator', 'emulator'), '') // there, but can't be run
    expect(await findEmulator([join(root, 'sdk0'), join(root, 'sdk1'), join(root, 'sdk2')], process.platform)).toBe(join(root, 'sdk2', 'emulator', 'emulator'))
    expect(await findEmulator([join(root, 'sdk0')], process.platform)).toBeNull()
  })
})

describe('startableEmulators', () => {
  it('offers each AVD by name, with the id and the name it has once running', () => {
    expect(startableEmulators(['Pixel_9', 'Medium_Phone_API_36.1'])).toEqual([
      { id: 'emulator:Medium_Phone_API_36.1', kind: 'emulator', name: 'Medium Phone API 36.1', detail: 'Emulator' },
      { id: 'emulator:Pixel_9', kind: 'emulator', name: 'Pixel 9', detail: 'Emulator' },
    ])
  })
})

describe.skipIf(process.platform === 'win32')('running the emulator', () => {
  it('listAvds runs -list-avds and reads the names', async () => {
    const emulator = script('list', 'emulator', 'echo "$@" > "$DIR/args"\nprintf "INFO    | hello\\nPixel_9\\n"')
    expect(await listAvds(emulator)).toEqual(['Pixel_9'])
    expect(argsOf('list')).toBe('-list-avds\n')
  })

  it('listAvds rejects when the emulator fails, or takes too long', async () => {
    await expect(listAvds(script('list-fail', 'emulator', 'exit 3'))).rejects.toMatchObject({ code: 3, killed: false })
    await expect(listAvds(script('list-slow', 'emulator', 'exec sleep 5'), 200)).rejects.toMatchObject({ killed: true, signal: 'SIGTERM' })
  })

  it('startAvd starts the AVD, and hears when the emulator ends', async () => {
    const emulator = script('start', 'emulator', 'echo "$@" > "$DIR/args"\nexec sleep 0.3')
    const ended = vi.fn()
    await startAvd(emulator, 'Pixel_9', ended)
    expect(ended).not.toHaveBeenCalled() // it runs for 0.3 s
    await vi.waitFor(() => expect(ended).toHaveBeenCalledWith('The emulator stopped.'), { timeout: 3000 })
    expect(argsOf('start')).toBe('-avd Pixel_9\n')
  })

  it('startAvd says how an emulator that fails ended', async () => {
    const ended = vi.fn()
    await startAvd(script('start-fail', 'emulator', 'exit 1'), 'Pixel_9', ended)
    await vi.waitFor(() => expect(ended).toHaveBeenCalledWith('The emulator stopped (exit code 1).'), { timeout: 3000 })
  })

  it("startAvd rejects an emulator that can't be started, and a name that isn't an AVD's", async () => {
    await expect(startAvd(join(root, 'missing', 'emulator'), 'Pixel_9')).rejects.toThrow(/ENOENT/)
    await expect(startAvd('/bin/sh', '-help')).rejects.toThrow(`"-help" isn't an AVD's name.`)
  })

  it("startAvd rejects synchronously when the file can't be run (ENOEXEC)", async () => {
    // No "#!": execve refuses it outright, synchronously, rather than failing once spawned.
    const dir = join(root, 'noexec')
    mkdirSync(dir, { recursive: true })
    const file = join(dir, 'emulator')
    writeFileSync(file, 'not a script\n')
    chmodSync(file, 0o755)
    await expect(startAvd(file, 'Pixel_9')).rejects.toThrow('spawn ENOEXEC')
  })

  it("startAvd's ended reason is the emulator's own first ERROR/PANIC/FATAL line from its log", async () => {
    const emulator = script('start-log-fail', 'emulator', [
      'echo "$@" > "$DIR/args"',
      "echo 'ERROR        | Unknown AVD name [X], use -list-avds to see valid list.'",
      "echo '(Note: Directories are searched in the order given above)'",
      'exit 1',
    ].join('\n'))
    const ended = vi.fn()
    await startAvd(emulator, 'Pixel_9', ended, join(root, 'logs-fail'))
    await vi.waitFor(() => expect(ended).toHaveBeenCalledWith('Unknown AVD name [X], use -list-avds to see valid list.'), { timeout: 3000 })
    expect(argsOf('start-log-fail')).toBe('-avd Pixel_9\n')
  })

  it('startAvd falls back to the exit-code wording when the log has no failure line', async () => {
    const ended = vi.fn()
    await startAvd(script('start-log-silent', 'emulator', 'exit 1'), 'Pixel_9', ended, join(root, 'logs-silent'))
    await vi.waitFor(() => expect(ended).toHaveBeenCalledWith('The emulator stopped (exit code 1).'), { timeout: 3000 })
  })

  it("startAvd still starts when logDir can't be made (a file sits where a folder in it should be)", async () => {
    const notADir = script('not-a-dir', 'file', '') // root/not-a-dir/file: a file, not a folder
    const ended = vi.fn()
    await startAvd(script('start-bad-logdir', 'emulator', 'exit 1'), 'Pixel_9', ended, join(notADir, 'nested'))
    await vi.waitFor(() => expect(ended).toHaveBeenCalledWith('The emulator stopped (exit code 1).'), { timeout: 3000 })
  })

  it('killEmulator tells the emulator to close through adb', async () => {
    const adb = script('kill', 'adb', `echo "$@" > "$DIR/args"\necho 'OK: killing emulator, bye bye'`)
    await killEmulator(adb, 'emulator-5554')
    expect(argsOf('kill')).toBe('-s emulator-5554 emu kill\n')
  })

  it("killEmulator refuses an adb name that isn't an emulator's, and says adb's own error", async () => {
    await expect(killEmulator('/nowhere/adb', '8d2e61a')).rejects.toThrow("8d2e61a isn't an emulator.")
    const adb = script('kill-fail', 'adb', "echo 'error: could not connect to TCP port 5554: Connection refused' >&2\nexit 1")
    await expect(killEmulator(adb, 'emulator-5554')).rejects.toThrow('error: could not connect to TCP port 5554: Connection refused')
  })
})
