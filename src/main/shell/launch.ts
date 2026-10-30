import { posix, win32 } from 'node:path'

export interface ShellLaunch { file: string; args: string[]; env: Record<string, string> }
export interface ShellLaunchOptions {
  platform: NodeJS.Platform
  env: Record<string, string | undefined>
  /** Folder installShellIntegration() wrote to (has zsh/ and pwsh/). */
  integrationDir: string
  appVersion: string
  /** Windows: pwsh.exe is on PATH. */
  hasPwsh?: boolean
}

/** Set by a parent Claude Code session or by Electron; they must not leak into
 *  shells, or a `claude` started in Deck acts as that session's child. */
export const SCRUBBED_ENV: readonly string[] = [
  'CLAUDECODE', 'CLAUDE_CODE_SESSION_ID', 'CLAUDE_CODE_BRIDGE_SESSION_ID', 'CLAUDE_CODE_CHILD_SESSION',
  'CLAUDE_CODE_ENTRYPOINT', 'CLAUDE_CODE_EXECPATH', 'CLAUDE_CODE_MESSAGING_SOCKET', 'CLAUDE_CODE_MESSAGING_TOKEN',
  'CLAUDE_CODE_SESSION_ATTENDED', 'CLAUDE_PID', 'CLAUDE_EFFORT', 'AI_AGENT',
  'ELECTRON_RUN_AS_NODE', 'ELECTRON_NO_ATTACH_CONSOLE',
]

/** Which shell a new tab runs, with which arguments and environment. Pure: the
 *  platform and environment come in, so every platform is testable anywhere. */
export function shellLaunch(o: ShellLaunchOptions): ShellLaunch {
  const env: Record<string, string> = {}
  for (const [k, v] of Object.entries(o.env)) {
    if (v !== undefined && !SCRUBBED_ENV.includes(k)) env[k] = v
  }
  // Claude Code runs its own commands with GIT_EDITOR=true; a Deck started from
  // one of its shells shouldn't hand that to tabs, where `git commit` needs an editor.
  if (o.env.CLAUDECODE && env.GIT_EDITOR === 'true') delete env.GIT_EDITOR
  Object.assign(env, { TERM: 'xterm-256color', COLORTERM: 'truecolor', TERM_PROGRAM: 'Deck', TERM_PROGRAM_VERSION: o.appVersion })

  if (o.platform === 'win32') {
    // try/catch: where the execution policy forbids scripts (Windows PowerShell's
    // default), the tab still opens, just without the hook. Not `-ExecutionPolicy
    // Bypass`: security tools flag that switch.
    const hook = win32.join(o.integrationDir, 'pwsh', 'deck.ps1').replace(/'/g, "''")
    return {
      file: o.hasPwsh ? 'pwsh.exe' : 'powershell.exe',
      args: ['-NoLogo', '-NoExit', '-Command', `try { . '${hook}' } catch {}`],
      env,
    }
  }

  if (!env.LANG && !env.LC_ALL && !env.LC_CTYPE) env.LANG = 'en_US.UTF-8' // GUI apps start without a locale
  const file = env.SHELL || (o.platform === 'darwin' ? '/bin/zsh' : '/bin/bash')
  if (posix.basename(file) === 'zsh') {
    env.DECK_USER_ZDOTDIR = env.ZDOTDIR || env.HOME || ''
    env.ZDOTDIR = posix.join(o.integrationDir, 'zsh')
  }
  return { file, args: ['-l'], env }
}
