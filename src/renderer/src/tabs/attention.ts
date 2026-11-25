import type { ClaudeActivity, ClaudePresence, Platform } from '@shared/types'
import type { TerminalTab } from './tabs'
import { runsClaude } from './title'

/** A tab's mark: Claude working, needing the user, or finished with that not yet seen. */
export type Attention = 'working' | 'waiting' | 'done'

/** Per tab: its Claude's state as last seen (null: none), and whether a turn that ended is unseen. */
export interface TabAttention {
  state: ClaudeActivity | null
  unseen: boolean
}

/** A folder for comparing (Windows): case and slash direction ignored, no trailing slash. */
const folderKey = (path: string) => path.replace(/\\/g, '/').replace(/\/+$/, '').toLowerCase()

/**
 * The running Claude whose status a tab shows. By pty (macOS, Linux: main matched it by process);
 * on Windows by folder, when the tab is the only one there running Claude and this the only Claude
 * there. Only while the tab runs Claude, so a presence file a killed Claude left behind (its pid
 * reused since) can't keep a status on a tab whose shell is back at its prompt.
 */
export function presenceFor(tab: TerminalTab, tabs: readonly TerminalTab[], list: readonly ClaudePresence[], platform: Platform): ClaudePresence | undefined {
  if (!runsClaude(tab.process, tab.title)) return undefined
  if (platform !== 'win32') return tab.ptyId === undefined ? undefined : list.find((p) => p.ptyId === tab.ptyId)
  const key = folderKey(tab.cwd)
  if (key === '') return undefined
  const here = list.filter((p) => folderKey(p.cwd) === key)
  if (here.length !== 1) return undefined
  // A tab whose shell has exited runs nothing, whatever its last title says.
  const sharing = tabs.filter((t) => t.exited === undefined && folderKey(t.cwd) === key && runsClaude(t.process, t.title))
  return sharing.length === 1 ? here[0] : undefined
}

/**
 * The tabs' attention after a change. `now` is each terminal tab's Claude state (null: none) and
 * `seen` the tab being looked at (the front tab while Deck's window has focus), if any. A turn that
 * ends (working or waiting, then idle) in a tab that isn't seen stays unseen until the tab is; a new
 * turn, or Claude going away, clears it. Tabs not in `now` are dropped.
 */
export function nextAttention(prev: ReadonlyMap<string, TabAttention>, now: ReadonlyMap<string, ClaudeActivity | null>, seen: string | null): Map<string, TabAttention> {
  const next = new Map<string, TabAttention>()
  for (const [id, state] of now) {
    const before = prev.get(id)
    let unseen = false
    if (state === 'idle') unseen = before?.unseen === true || before?.state === 'working' || before?.state === 'waiting'
    if (id === seen) unseen = false
    next.set(id, { state, unseen })
  }
  return next
}

export function sameAttention(a: ReadonlyMap<string, TabAttention>, b: ReadonlyMap<string, TabAttention>): boolean {
  if (a.size !== b.size) return false
  for (const [id, x] of a) {
    const y = b.get(id)
    if (!y || y.state !== x.state || y.unseen !== x.unseen) return false
  }
  return true
}

/** The mark for a Claude in `state`: needs-you and working as they are, finished while unseen. */
export function markOf(state: ClaudeActivity | null, unseen: boolean): Attention | null {
  if (state === 'waiting') return 'waiting'
  if (state === 'working') return 'working'
  return state === 'idle' && unseen ? 'done' : null
}

/** A mark's words: the tab's tooltip line and the mark's accessible name. */
export function markText(mark: Attention, waitingFor?: string): string {
  switch (mark) {
    case 'working':
      return 'Claude is working'
    case 'waiting':
      return waitingFor ? `Claude needs you (${waitingFor})` : 'Claude needs you'
    case 'done':
      return 'Claude finished'
  }
}
