import { spawnSync, type SpawnSyncReturns } from 'node:child_process'
import { existsSync, mkdirSync, mkdtempSync, readdirSync, readFileSync, rmSync, writeFileSync } from 'node:fs'
import { tmpdir } from 'node:os'
import { join } from 'node:path'
import { afterAll, describe, expect, it } from 'vitest'
import { statusLineCommand, statusLineScript } from './statusline'

describe('statusLineCommand', () => {
  it('runs the script with /bin/sh on macOS and Linux, quoted for a POSIX shell', () => {
    expect(statusLineCommand('darwin', '/Users/me/Library/Application Support/Deck/usage'))
      .toBe("/bin/sh '/Users/me/Library/Application Support/Deck/usage/statusline.sh'")
    expect(statusLineCommand('linux', "/home/o'neil/.config/Deck/usage"))
      .toBe("/bin/sh '/home/o'\\''neil/.config/Deck/usage/statusline.sh'")
  })

  it('is inline PowerShell on Windows, with nothing Git Bash or PowerShell would change', () => {
    const command = statusLineCommand('win32', 'C:\\Users\\me\\AppData\\Roaming\\Deck\\usage')!
    const tmp = "('C:/Users/me/AppData/Roaming/Deck/usage/.statusline.' + [Diagnostics.Process]::GetCurrentProcess().Id + '.tmp')"
    const target = "'C:/Users/me/AppData/Roaming/Deck/usage/statusline.json'"
    const read = '[IO.StreamReader]::new([Console]::OpenStandardInput(), [Text.Encoding]::UTF8).ReadToEnd()'
    expect(command).toBe(
      'powershell -NoProfile -NonInteractive -Command "' +
        `[IO.File]::WriteAllText(${tmp}, ${read}); ` +
        `try { [IO.File]::Delete(${target}); [IO.File]::Move(${tmp}, ${target}) } finally { [IO.File]::Delete(${tmp}) }"`,
    )
    expect(command.slice(command.indexOf('"') + 1, -1)).not.toMatch(/[$`"\\]/)
  })

  it("doubles a quote in a Windows path, and gives up on a folder it can't put in a command", () => {
    expect(statusLineCommand('win32', "C:\\Users\\o'neil\\Deck\\usage"))
      .toContain("'C:/Users/o''neil/Deck/usage/statusline.json'")
    expect(statusLineCommand('win32', 'C:\\Users\\$me\\Deck')).toBeNull()
    expect(statusLineCommand('darwin', '/tmp/a\nb')).toBeNull()
  })
})

describe('statusLineScript', () => {
  const root = mkdtempSync(join(tmpdir(), 'deck usage ')) // a space, like Application Support
  afterAll(() => rmSync(root, { recursive: true, force: true }))

  it.skipIf(process.platform === 'win32')('saves its input whole as statusline.json and prints nothing', () => {
    const script = join(root, 'statusline.sh')
    writeFileSync(script, statusLineScript(root)!)
    const input = JSON.stringify({ rate_limits: { seven_day: { used_percentage: 85, resets_at: 1_793_653_200 } } })
    const run = spawnSync('/bin/sh', [script], { input, encoding: 'utf8' })
    expect(run.status).toBe(0)
    expect(run.stdout).toBe('')
    expect(readFileSync(join(root, 'statusline.json'), 'utf8')).toBe(input)
    expect(readdirSync(root).filter((n) => n.endsWith('.tmp'))).toEqual([])
  })
})

describe('the Windows command, run for real', () => {
  const gitBash = 'C:\\Program Files\\Git\\bin\\bash.exe'
  const isWindows = process.platform === 'win32'
  const root = isWindows ? mkdtempSync(join(tmpdir(), 'deck usage ')) : '' // a space, as in a user's name
  afterAll(() => {
    if (root) rmSync(root, { recursive: true, force: true })
  })
  let n = 0

  /** Runs the command the way `run` starts it, fed a report holding non-ASCII text, over an older
   *  statusline.json. */
  function check(run: (command: string, input: string) => SpawnSyncReturns<string>) {
    const dir = join(root, `run ${++n}`)
    mkdirSync(dir)
    writeFileSync(join(dir, 'statusline.json'), '{"older":true}')
    const input = JSON.stringify({
      workspace: { current_dir: 'C:/Users/José/✓ project' },
      rate_limits: { seven_day: { used_percentage: 85, resets_at: 1_793_653_200 } },
    })
    const result = run(statusLineCommand('win32', dir)!, input)
    expect(result.status, result.stderr).toBe(0)
    expect(result.stdout).toBe('')
    expect(readFileSync(join(dir, 'statusline.json'))).toEqual(Buffer.from(input, 'utf8'))
    expect(readdirSync(dir).filter((name) => name.endsWith('.tmp'))).toEqual([])
  }

  // CI runs the tests from pwsh 7 (GitHub's default shell on Windows), so Windows PowerShell gets
  // pwsh 7's PSModulePath here, as it does under a Deck tab whose shell is pwsh 7.
  it.runIf(isWindows)('saves the report whole when PowerShell runs it', () => {
    check((command, input) =>
      spawnSync('powershell.exe', ['-NoProfile', '-NonInteractive', '-Command', command], { input, encoding: 'utf8' }))
  })

  it.runIf(isWindows && existsSync(gitBash))('saves the report whole when Git Bash runs it', () => {
    check((command, input) => spawnSync(gitBash, ['-c', command], { input, encoding: 'utf8' }))
  })
})
