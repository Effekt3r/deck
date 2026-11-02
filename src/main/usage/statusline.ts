import { posix } from 'node:path'
import { quotePath } from '@shared/quote'
import type { Platform } from '@shared/types'

/** Where the status line command saves Claude Code's input, in Deck's usage folder. */
export const REPORT_FILE = 'statusline.json'
/** The script the command runs on macOS and Linux, in the same folder. */
export const SCRIPT_FILE = 'statusline.sh'

/** The status line command Deck puts in Claude Code's settings. It saves Claude Code's input (which
 *  holds the plan usage) to `<dir>/statusline.json` and prints nothing. null when `dir` can't be
 *  put in a command safely. */
export function statusLineCommand(platform: Platform, dir: string): string | null {
  if (platform === 'win32') return windowsCommand(dir)
  const script = quotePath(posix.join(dir, SCRIPT_FILE), platform)
  return script && `/bin/sh ${script}`
}

/** The script statusLineCommand runs on macOS and Linux. It writes a temp file and moves it over the
 *  report, so main never reads half of one. null when `dir` can't be quoted. */
export function statusLineScript(dir: string): string | null {
  const quoted = quotePath(dir, 'darwin')
  if (!quoted) return null
  return [
    '#!/bin/sh',
    "# Claude Code runs this as its status line: Deck's Usage card set it (Connect), and Disconnect",
    '# there takes it out again. It saves what Claude Code passes, which holds the plan usage, and',
    '# prints nothing.',
    `dir=${quoted}`,
    'tmp="$dir/.statusline.$$.tmp"',
    `cat > "$tmp" && mv -f "$tmp" "$dir/${REPORT_FILE}"`,
    '',
  ].join('\n')
}

/** Windows: inline, because the default execution policy (Restricted) won't run a .ps1 and Deck
 *  doesn't pass -ExecutionPolicy Bypass, which security tools flag.
 *  - .NET calls only, no cmdlets: a Windows PowerShell started under pwsh 7 (Deck's tab shell when
 *    it's installed, then claude, then Git Bash or PowerShell) inherits pwsh 7's PSModulePath, and
 *    cmdlets such as Move-Item then fail to load. .NET Framework's File.Move can't overwrite, hence
 *    the Delete; the finally removes the temp file when the move fails.
 *  - Stdin is read as UTF-8: [Console]::In decodes in the console's code page.
 *  - Claude Code runs status line commands through Git Bash when it's installed, else PowerShell,
 *    so the script uses nothing either would change: no $, backtick, " or backslash, and only
 *    single quotes inside its double quotes. */
function windowsCommand(dir: string): string | null {
  const slashed = dir.replace(/\\/g, '/')
  if (/[$`"]/.test(slashed)) return null
  const target = quotePath(`${slashed}/${REPORT_FILE}`, 'win32')
  const prefix = quotePath(`${slashed}/.statusline.`, 'win32')
  if (!target || !prefix) return null
  const tmp = `(${prefix} + [Diagnostics.Process]::GetCurrentProcess().Id + '.tmp')`
  const read = '[IO.StreamReader]::new([Console]::OpenStandardInput(), [Text.Encoding]::UTF8).ReadToEnd()'
  const script = `[IO.File]::WriteAllText(${tmp}, ${read}); try { [IO.File]::Delete(${target}); [IO.File]::Move(${tmp}, ${target}) } finally { [IO.File]::Delete(${tmp}) }`
  return `powershell -NoProfile -NonInteractive -Command "${script}"`
}
