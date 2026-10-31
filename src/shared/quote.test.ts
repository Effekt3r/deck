import { execFileSync, spawnSync } from 'node:child_process'
import { existsSync } from 'node:fs'
import { describe, expect, it } from 'vitest'
import { quotePath, quotePaths } from './quote'

// vitest can't interrupt a synchronous child process, so every spawnSync/execFileSync below gets
// this hard timeout: a hung shell fails (or skips) instead of blocking CI.
const SPAWN_TIMEOUT = { timeout: 20_000 }

const hasZsh = process.platform !== 'win32' && existsSync('/bin/zsh')

function canRun(exe: string): boolean {
  return spawnSync(exe, ['-NoProfile', '-NonInteractive', '-Command', 'exit 0'], SPAWN_TIMEOUT).status === 0
}

/** pwsh if it runs, else, on win32 only (where Deck itself falls back the same way), Windows
 *  PowerShell; null when nothing usable was found. Off Windows, no pwsh just skips the suite below;
 *  on Windows, with neither usable, the suite still runs, and fails instead of skipping silently. */
const powershellExe = canRun('pwsh') ? 'pwsh' : process.platform === 'win32' && canRun('powershell.exe') ? 'powershell.exe' : null
const skipPowerShell = powershellExe === null && process.platform !== 'win32'

describe('quotePath', () => {
  it('wraps a path in single quotes for zsh', () => {
    expect(quotePath('/Users/franco/Desktop/shot one.png', 'darwin')).toBe("'/Users/franco/Desktop/shot one.png'")
  })

  it("writes a ' inside as '\\'' for zsh", () => {
    expect(quotePath("/tmp/it's here.txt", 'darwin')).toBe("'/tmp/it'\\''s here.txt'")
  })

  it('keeps accents and other non-ASCII as they are', () => {
    expect(quotePath('/tmp/café/résumé.pdf', 'darwin')).toBe("'/tmp/café/résumé.pdf'")
  })

  it('doubles quotes for PowerShell, the curly ones it also ends strings at included', () => {
    expect(quotePath("C:\\Users\\franco\\it's.png", 'win32')).toBe("'C:\\Users\\franco\\it''s.png'")
    expect(quotePath('C:\\tmp\\Franco’s file.txt', 'win32')).toBe("'C:\\tmp\\Franco’’s file.txt'")
  })

  it.each(["'", '\u2018', '\u2019', '\u201A', '\u201B'])(
    'doubles every PowerShell quote character, %s included',
    (q) => {
      expect(quotePath(`C:\\a${q}b.txt`, 'win32')).toBe(`'C:\\a${q}${q}b.txt'`)
    },
  )
})

describe('quotePath refuses control characters', () => {
  const controls: [string, string][] = [
    ['ESC', '\u001b'],
    ['CR', '\r'],
    ['LF', '\n'],
    ['TAB', '\t'],
    ['DEL', '\u007f'],
    ['U+009B', '\u009b'],
    ['NUL', '\u0000'],
  ]

  it.each(controls)('%s makes a path unsafe to paste, on zsh and PowerShell alike', (_name, c) => {
    expect(quotePath(`/tmp/a${c}b`, 'darwin')).toBeNull()
    expect(quotePath(`C:\\a${c}b`, 'win32')).toBeNull()
  })

  it('an empty path is null', () => {
    expect(quotePath('', 'darwin')).toBeNull()
  })
})

describe('quotePaths', () => {
  it('separates quoted paths with spaces', () => {
    expect(quotePaths(['/a b', '/c'], 'darwin')).toBe("'/a b' '/c'")
  })

  it('is null when any path cannot be quoted safely', () => {
    expect(quotePaths(['/ok', '/bad\rname'], 'darwin')).toBeNull()
  })

  it('is null for an empty list', () => {
    expect(quotePaths([], 'darwin')).toBeNull()
  })
})

// These catch what string assertions can't: run quotePath's output through the real shells it's
// quoting for.
describe.skipIf(!hasZsh)('quotePath round-trips through zsh', () => {
  // '/tmp/!!' covers history-expansion punctuation: `zsh -c` is non-interactive, so '!' history
  // expansion never triggers here anyway, and single quotes block it in interactive shells too.
  const names = ["/tmp/it's here", '/tmp/$HOME `id` $(id)', '/tmp/a\\b "c"', '/tmp/*?[x]{a,b}', '/tmp/café ’‘‚‛', '/tmp/!!']

  it.each(names)('%s', (name) => {
    const out = execFileSync('/bin/zsh', ['-f', '-c', `print -rn -- ${quotePath(name, 'darwin')!}`], { encoding: 'utf8', ...SPAWN_TIMEOUT })
    expect(out).toBe(name)
  })
})

describe.skipIf(skipPowerShell)('quotePath round-trips through PowerShell', () => {
  const names = ["C:\\x\\it's ‘a’ ‚b‛.png", 'C:\\x\\$env:USERPROFILE `n [x].png', 'C:\\x\\a;b & c.png']

  it.each(names)('%s', (name) => {
    // On win32, neither pwsh nor Windows PowerShell could run (checked above); fail here rather
    // than skip, since Deck falls back the same way and a silent skip would hide that.
    if (!powershellExe) throw new Error('no usable PowerShell (pwsh or powershell.exe) found on PATH')
    // ToCharArray then ForEach-Object [int]$_ gives UTF-16 code units in pwsh and in Windows
    // PowerShell 5.1 alike (overload resolution for [string]::Join(',', [int[]][char[]](…)) can
    // differ between them), so this compares code units, not bytes in some console code page.
    const out = execFileSync(
      powershellExe,
      ['-NoProfile', '-NonInteractive', '-Command', `((${quotePath(name, 'win32')!}).ToCharArray() | ForEach-Object { [int]$_ }) -join ','`],
      { encoding: 'utf8', ...SPAWN_TIMEOUT },
    ).trim()
    const expected = Array.from({ length: name.length }, (_, i) => name.charCodeAt(i)).join(',')
    expect(out).toBe(expected)
  })
})
