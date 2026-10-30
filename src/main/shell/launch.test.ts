import { describe, expect, it } from 'vitest'
import { shellLaunch } from './launch'

const mac = { HOME: '/Users/f', PATH: '/usr/bin:/bin', SHELL: '/bin/zsh' }
const opts = { integrationDir: '/data/shell', appVersion: '0.1.0' }

describe('shellLaunch on macOS', () => {
  it('starts zsh as a login shell reading the wrappers', () => {
    const l = shellLaunch({ platform: 'darwin', env: mac, ...opts })
    expect(l.file).toBe('/bin/zsh')
    expect(l.args).toEqual(['-l'])
    expect(l.env.ZDOTDIR).toBe('/data/shell/zsh')
    expect(l.env.DECK_USER_ZDOTDIR).toBe('/Users/f')
    expect(l.env).toMatchObject({ TERM: 'xterm-256color', COLORTERM: 'truecolor', TERM_PROGRAM: 'Deck', TERM_PROGRAM_VERSION: '0.1.0' })
    expect(l.env.PATH).toBe('/usr/bin:/bin')
  })
  it('remembers a ZDOTDIR the user already had', () => {
    const l = shellLaunch({ platform: 'darwin', env: { ...mac, ZDOTDIR: '/Users/f/.config/zsh' }, ...opts })
    expect(l.env.DECK_USER_ZDOTDIR).toBe('/Users/f/.config/zsh')
  })
  it('adds a UTF-8 locale only when none is set', () => {
    expect(shellLaunch({ platform: 'darwin', env: mac, ...opts }).env.LANG).toBe('en_US.UTF-8')
    expect(shellLaunch({ platform: 'darwin', env: { ...mac, LANG: 'af_ZA.UTF-8' }, ...opts }).env.LANG).toBe('af_ZA.UTF-8')
    expect(shellLaunch({ platform: 'darwin', env: { ...mac, LC_ALL: 'C.UTF-8' }, ...opts }).env.LANG).toBeUndefined()
  })
  it('falls back to /bin/zsh without SHELL', () => {
    const { SHELL: _, ...env } = mac
    expect(shellLaunch({ platform: 'darwin', env, ...opts }).file).toBe('/bin/zsh')
  })
  it('runs other shells as plain login shells', () => {
    const l = shellLaunch({ platform: 'darwin', env: { ...mac, SHELL: '/opt/homebrew/bin/fish' }, ...opts })
    expect(l.file).toBe('/opt/homebrew/bin/fish')
    expect(l.args).toEqual(['-l'])
    expect(l.env.ZDOTDIR).toBeUndefined()
  })
  it("drops a parent Claude Code session's GIT_EDITOR=true, and only that", () => {
    expect(shellLaunch({ platform: 'darwin', env: { ...mac, CLAUDECODE: '1', GIT_EDITOR: 'true' }, ...opts }).env.GIT_EDITOR).toBeUndefined()
    expect(shellLaunch({ platform: 'darwin', env: { ...mac, CLAUDECODE: '1', GIT_EDITOR: 'nvim' }, ...opts }).env.GIT_EDITOR).toBe('nvim')
    expect(shellLaunch({ platform: 'darwin', env: { ...mac, GIT_EDITOR: 'true' }, ...opts }).env.GIT_EDITOR).toBe('true')
  })
  it("drops the launching terminal's and multiplexer's own variables", () => {
    const env = { ...mac, TMUX: '/tmp/tmux-501/default,1,0', TMUX_PANE: '%1', STY: '1.pts', TERM_SESSION_ID: 'x',
      ITERM_SESSION_ID: 'w0', LC_TERMINAL: 'iTerm2', WEZTERM_PANE: '3', KITTY_WINDOW_ID: '1', VSCODE_PID: '9',
      WT_SESSION: 'g', ELECTRON_RENDERER_URL: 'http://localhost:5173', COLUMNS: '80', LINES: '24' }
    const l = shellLaunch({ platform: 'darwin', env, ...opts })
    for (const k of Object.keys(env)) if (!(k in mac)) expect(l.env[k], k).toBeUndefined()
    expect(l.env.HOME).toBe('/Users/f')
  })
  it('drops variables that tie a shell to a parent Claude Code session or Electron', () => {
    const env = { ...mac, CLAUDECODE: '1', CLAUDE_CODE_SESSION_ID: 'x', CLAUDE_CODE_MESSAGING_TOKEN: 't',
      AI_AGENT: 'claude-code', ELECTRON_RUN_AS_NODE: '1', CLAUDE_CODE_USE_BEDROCK: '1' }
    const l = shellLaunch({ platform: 'darwin', env, ...opts })
    expect(l.env.CLAUDECODE).toBeUndefined()
    expect(l.env.CLAUDE_CODE_SESSION_ID).toBeUndefined()
    expect(l.env.CLAUDE_CODE_MESSAGING_TOKEN).toBeUndefined()
    expect(l.env.AI_AGENT).toBeUndefined()
    expect(l.env.ELECTRON_RUN_AS_NODE).toBeUndefined()
    expect(l.env.CLAUDE_CODE_USE_BEDROCK).toBe('1') // user configuration stays
  })
})

describe('shellLaunch on Windows', () => {
  const win = { USERPROFILE: 'C:\\Users\\f', Path: 'C:\\Windows' }
  const wopts = { integrationDir: 'C:\\data\\shell', appVersion: '0.1.0' }
  it('starts PowerShell 7 with the hook when pwsh exists', () => {
    const l = shellLaunch({ platform: 'win32', env: win, ...wopts, hasPwsh: true })
    expect(l.file).toBe('pwsh.exe')
    expect(l.args).toEqual(['-NoLogo', '-NoExit', '-Command', "try { . 'C:\\data\\shell\\pwsh\\deck.ps1' } catch {}"])
    expect(l.env.TERM_PROGRAM).toBe('Deck')
    expect(l.env.Path).toBe('C:\\Windows')
    expect(l.env.LANG).toBeUndefined()
  })
  it('falls back to Windows PowerShell', () => {
    expect(shellLaunch({ platform: 'win32', env: win, ...wopts, hasPwsh: false }).file).toBe('powershell.exe')
  })
  it('escapes single quotes in the hook path', () => {
    const l = shellLaunch({ platform: 'win32', env: win, integrationDir: "C:\\Users\\O'Neil\\shell", appVersion: '0.1.0' })
    expect(l.args[3]).toBe("try { . 'C:\\Users\\O''Neil\\shell\\pwsh\\deck.ps1' } catch {}")
  })
})
