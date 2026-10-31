export const PROJECTS_ID = 'projects'

export interface ProjectsTab {
  id: typeof PROJECTS_ID
  kind: 'projects'
}

export interface TerminalTab {
  id: string
  kind: 'terminal'
  /** Updated from OSC 7. */
  cwd: string
  /** Typed at the first prompt. */
  command?: string
  ptyId?: string
  /** The terminal's own title (OSC 0/2). */
  title: string
  /** OSC 1337 user vars: GIT_REPO, GIT_BRANCH. */
  vars: Record<string, string>
  /** Foreground process name from main. */
  process: string
  exited?: number
  /** The git panel was closed in this tab (View → Git Panel). */
  gitHidden?: boolean
  /** The Claude panel was closed in this tab (View → Claude Panel). */
  claudeHidden?: boolean
}

export type Tab = ProjectsTab | TerminalTab
export type TerminalPatch = Partial<Omit<TerminalTab, 'id' | 'kind'>>

export interface TabsState {
  tabs: Tab[]
  active: string
}

export type TabsAction =
  | { type: 'open'; cwd: string; command?: string; id: string }
  | { type: 'close'; id: string }
  | { type: 'activate'; id: string }
  | { type: 'next' }
  | { type: 'prev' }
  | { type: 'select'; index: number } // 1-based over all tabs; 9 = last
  | { type: 'update'; id: string; patch: TerminalPatch }

export const initialTabs: TabsState = { tabs: [{ id: PROJECTS_ID, kind: 'projects' }], active: PROJECTS_ID }

export const isTerminal = (tab: Tab): tab is TerminalTab => tab.kind === 'terminal'

export function tabsReducer(state: TabsState, action: TabsAction): TabsState {
  switch (action.type) {
    case 'open': {
      const tab: TerminalTab = { id: action.id, kind: 'terminal', cwd: action.cwd, title: '', vars: {}, process: '' }
      if (action.command) tab.command = action.command
      return { tabs: [...state.tabs, tab], active: tab.id }
    }
    case 'close': {
      const i = state.tabs.findIndex((t) => t.id === action.id)
      if (i < 0 || action.id === PROJECTS_ID) return state
      const tabs = state.tabs.filter((t) => t.id !== action.id)
      const active = state.active === action.id ? (tabs[i] ?? tabs[i - 1]).id : state.active
      return { tabs, active }
    }
    case 'activate':
      return activate(state, state.tabs.findIndex((t) => t.id === action.id))
    case 'next':
    case 'prev': {
      const i = state.tabs.findIndex((t) => t.id === state.active)
      const n = state.tabs.length
      return activate(state, (i + (action.type === 'next' ? 1 : n - 1)) % n)
    }
    case 'select':
      return activate(state, action.index === 9 ? state.tabs.length - 1 : action.index - 1)
    case 'update': {
      const i = state.tabs.findIndex((t) => t.id === action.id)
      const tab = state.tabs[i]
      if (!tab || !isTerminal(tab) || !changes(tab, action.patch)) return state
      const tabs = state.tabs.slice()
      tabs[i] = { ...tab, ...action.patch }
      return { ...state, tabs }
    }
  }
}

function activate(state: TabsState, index: number): TabsState {
  const tab = state.tabs[index]
  return tab && tab.id !== state.active ? { ...state, active: tab.id } : state
}

/** Whether applying the patch would change the tab; vars compare by content. */
function changes(tab: TerminalTab, patch: TerminalPatch): boolean {
  return (Object.keys(patch) as (keyof TerminalPatch)[]).some((k) =>
    k === 'vars' ? !sameVars(tab.vars, patch.vars ?? {}) : !Object.is(tab[k], patch[k]),
  )
}

function sameVars(a: Record<string, string>, b: Record<string, string>): boolean {
  const ka = Object.keys(a)
  return ka.length === Object.keys(b).length && ka.every((k) => a[k] === b[k])
}
