import { execFileSync, spawnSync } from 'node:child_process'
import { existsSync } from 'node:fs'
import { describe, expect, it } from 'vitest'
import { quotePath, quotePaths } from './quote'

const hasZsh = process.platform !== 'win32' && existsSync('/bin/zsh')
const pwshAvailable = spawnSync('pwsh', ['-NoProfile', '-NonInteractive', '-Command', 'exit 0']).status === 0

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
  const names = ["/tmp/it's here", '/tmp/$HOME `id` $(id)', '/tmp/a\\b "c"', '/tmp/*?[x]{a,b}', '/tmp/café ’‘‚‛', '/tmp/!!']

  it.each(names)('%s', (name) => {
    const out = execFileSync('/bin/zsh', ['-f', '-c', `print -rn -- ${quotePath(name, 'darwin')!}`], { encoding: 'utf8' })
    expect(out).toBe(name)
  })
})

describe.skipIf(!pwshAvailable)('quotePath round-trips through PowerShell', () => {
  const names = ["C:\\x\\it's ‘a’ ‚b‛.png", 'C:\\x\\$env:USERPROFILE `n [x].png', 'C:\\x\\a;b & c.png']

  it.each(names)('%s', (name) => {
    // [char[]] then [int[]] gives UTF-16 code units, so this compares code units, not bytes in some
    // console code page.
    const out = execFileSync(
      'pwsh',
      ['-NoProfile', '-NonInteractive', '-Command', `[string]::Join(',', [int[]][char[]](${quotePath(name, 'win32')!}))`],
      { encoding: 'utf8' },
    ).trim()
    const expected = Array.from({ length: name.length }, (_, i) => name.charCodeAt(i)).join(',')
    expect(out).toBe(expected)
  })
})
