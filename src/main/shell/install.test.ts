import { execFileSync } from 'node:child_process'
import { existsSync, mkdirSync, mkdtempSync, readFileSync, writeFileSync } from 'node:fs'
import { tmpdir } from 'node:os'
import { join } from 'node:path'
import { describe, expect, it } from 'vitest'
import { installShellIntegration } from './install'
import { shellLaunch } from './launch'

const hasZsh = process.platform !== 'win32' && existsSync('/bin/zsh')

describe('installShellIntegration', () => {
  it('writes the zsh wrappers, the zsh hook and the PowerShell hook', async () => {
    const dir = mkdtempSync(join(tmpdir(), 'deck-shell-'))
    await installShellIntegration(dir)
    for (const f of ['zsh/.zshenv', 'zsh/.zprofile', 'zsh/.zshrc', 'zsh/.zlogin', 'zsh/deck.zsh', 'pwsh/deck.ps1']) {
      expect(existsSync(join(dir, f)), f).toBe(true)
    }
    expect(readFileSync(join(dir, 'zsh/deck.zsh'), 'utf8')).toContain('SetUserVar')
    expect(readFileSync(join(dir, 'pwsh/deck.ps1'), 'utf8')).toContain('SetUserVar')
    await installShellIntegration(dir) // idempotent
  })

  it.skipIf(!hasZsh)('loads the user files, the hook, and restores ZDOTDIR', async () => {
    const dir = mkdtempSync(join(tmpdir(), 'deck-shell-'))
    const home = mkdtempSync(join(tmpdir(), 'deck-home-'))
    mkdirSync(join(home, 'zd'))
    writeFileSync(join(home, '.zshenv'), 'export ZDOTDIR="$HOME/zd"\n')         // user moves ZDOTDIR
    writeFileSync(join(home, 'zd', '.zshrc'), 'export DECK_TEST_RC=loaded\n')
    await installShellIntegration(dir)
    const l = shellLaunch({ platform: 'darwin', env: { HOME: home, PATH: '/usr/bin:/bin', SHELL: '/bin/zsh' }, integrationDir: dir, appVersion: 't' })
    const out = execFileSync(l.file, ['-i', '-c', 'print -r -- "$DECK_TEST_RC|$ZDOTDIR|$(whence -w __deck_precmd)"'],
      { env: l.env, encoding: 'utf8' })
    expect(out.trim().split('\n').pop()).toBe(`loaded|${join(home, 'zd')}|__deck_precmd: function`)
  })
})
