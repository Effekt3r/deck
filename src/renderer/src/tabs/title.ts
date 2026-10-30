import type { Platform } from '@shared/types'
import type { TerminalTab } from './tabs'

// Claude Code's title starts with '✳ ' when idle and a spinner frame while working.
const STATUS_GLYPHS = '✳✶✻✽✢·◐◑◒◓'

/** Claude is detected by process name where main can see it (macOS), else by
 *  its status title: native installs run as their version number, npm ones
 *  as node, and on Windows the process stays the shell. */
export function runsClaude(processName: string, title: string): boolean {
  if (processName.toLowerCase().includes('claude')) return true
  if (title[1] !== ' ') return false
  const cp = title.charCodeAt(0)
  return STATUS_GLYPHS.includes(title[0]) || (cp >= 0x2801 && cp <= 0x28ff) // braille spinners
}

/** Like format-tab-title in wezterm.lua: repo · Claude's title while Claude
 *  runs, else repo ⎇ branch; outside a repo the terminal title or the folder. */
export function tabTitle(tab: TerminalTab, platform: Platform): string {
  const repo = tab.vars.GIT_REPO
  if (repo) {
    const name = baseName(repo, platform)
    if (tab.title && runsClaude(tab.process, tab.title)) return `${name} · ${tab.title}`
    const branch = tab.vars.GIT_BRANCH
    return branch ? `${name} ⎇ ${branch}` : name
  }
  return tab.title || baseName(tab.cwd, platform) || 'Terminal'
}

/** Last segment of a '/' or '\' path; roots stay roots ('/', 'C:\'). */
function baseName(path: string, platform: Platform): string {
  const trimmed = path.replace(/[\\/]+$/, '')
  if (/^[A-Za-z]:$/.test(trimmed)) return trimmed + (platform === 'win32' ? '\\' : '/')
  return trimmed.slice(Math.max(trimmed.lastIndexOf('/'), trimmed.lastIndexOf('\\')) + 1) || path
}
