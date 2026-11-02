import { spawnSync } from 'node:child_process'
import { mkdtempSync, readdirSync, readFileSync, rmSync, writeFileSync } from 'node:fs'
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
    expect(command).toBe(
      'powershell -NoProfile -NonInteractive -Command "' +
        `[IO.File]::WriteAllText(${tmp}, [Console]::In.ReadToEnd()); ` +
        `Move-Item -Force -LiteralPath ${tmp} -Destination 'C:/Users/me/AppData/Roaming/Deck/usage/statusline.json'"`,
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
