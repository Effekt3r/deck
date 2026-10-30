import { memo, useCallback, useEffect, useLayoutEffect, useReducer, useRef, useState } from 'react'
import type { AppInfo, MenuCommand, ProjectAction } from '@shared/types'
import { GitPanel } from './git/GitPanel'
import { loadSize, saveSize, Splitter } from './git/Splitter'
import { ProjectsView } from './projects/ProjectsView'
import { TabBar } from './tabs/TabBar'
import { initialTabs, isTerminal, PROJECTS_ID, tabsReducer, type TerminalPatch, type TerminalTab } from './tabs/tabs'
import { tabTitle } from './tabs/title'
import { TerminalView } from './terminal/TerminalView'

// Main holds --open folders until the first ready(); StrictMode runs effects twice.
let readySent = false

/** The git panel's width, shared by every tab: 240 px … 55 % of the window. */
const GIT_WIDTH_KEY = 'deck.gitWidth'
const GIT_WIDTH = 360
const GIT_MIN = 240
const GIT_MAX_SHARE = 0.55
const clampGitWidth = (px: number) =>
  Math.round(Math.min(Math.max(px, GIT_MIN), Math.max(GIT_MIN, window.innerWidth * GIT_MAX_SHARE)))

export function App() {
  const platform = window.deck.platform
  const [state, dispatch] = useReducer(tabsReducer, initialTabs)
  const [info, setInfo] = useState<AppInfo | null>(null)
  const [findRequests, setFindRequests] = useState<Record<string, number>>({})
  const [gitWidth, setGitWidth] = useState(() => loadSize(GIT_WIDTH_KEY, GIT_WIDTH))

  // Menu commands and IPC events read the latest state through refs.
  const stateRef = useRef(state)
  const homeRef = useRef('')
  useLayoutEffect(() => {
    stateRef.current = state
  }, [state])

  useEffect(() => {
    void window.deck.app.info().then((i) => {
      homeRef.current = i.home
      setInfo(i)
    })
  }, [])

  const open = useCallback((cwd: string, command?: string) => {
    dispatch({ type: 'open', id: crypto.randomUUID(), cwd, command })
  }, [])

  /** A shell tab in the active terminal's folder; from Projects, the home folder (main also falls back to it). */
  const newTab = useCallback(() => {
    const { tabs, active } = stateRef.current
    const tab = tabs.find((t) => t.id === active)
    open(tab && isTerminal(tab) ? tab.cwd : homeRef.current)
  }, [open])

  const openProject = useCallback(
    async (path: string, action: ProjectAction) => {
      // Read the command when it's used, so a Settings change applies at once.
      const command = action === 'claude'
        ? await window.deck.projects.getConfig().then((c) => c.command, () => undefined)
        : undefined
      open(path, command)
    },
    [open],
  )

  const update = useCallback((id: string, patch: TerminalPatch) => dispatch({ type: 'update', id, patch }), [])
  const close = useCallback((id: string) => dispatch({ type: 'close', id }), [])
  const activate = useCallback((id: string) => dispatch({ type: 'activate', id }), [])
  const storeGitWidth = useCallback((px: number) => {
    const width = clampGitWidth(px)
    setGitWidth(width)
    saveSize(GIT_WIDTH_KEY, width)
  }, [])

  useEffect(() => {
    const onMenu = (cmd: MenuCommand) => {
      const { active } = stateRef.current
      switch (cmd.type) {
        case 'new-tab':
          return newTab()
        case 'close-tab':
          return dispatch({ type: 'close', id: active }) // the reducer keeps the Projects tab
        case 'next-tab':
          return dispatch({ type: 'next' })
        case 'prev-tab':
          return dispatch({ type: 'prev' })
        case 'select-tab':
          return dispatch({ type: 'select', index: cmd.index })
        case 'projects':
          return dispatch({ type: 'activate', id: PROJECTS_ID })
        case 'find':
          return setFindRequests((f) => ({ ...f, [active]: (f[active] ?? 0) + 1 }))
        case 'toggle-git': {
          // Only where there is a panel to show or hide.
          const tab = stateRef.current.tabs.find((t) => t.id === active)
          if (tab && isTerminal(tab) && tab.vars.GIT_REPO) update(tab.id, { gitHidden: !tab.gitHidden })
          return
        }
      }
    }
    const offMenu = window.deck.app.onMenu(onMenu)
    const offOpen = window.deck.app.onOpenFolder((path) => open(path))
    if (!readySent) {
      readySent = true
      window.deck.app.ready()
    }
    return () => {
      offMenu()
      offOpen()
    }
  }, [newTab, open, update])

  const activeTab = state.tabs.find((t) => t.id === state.active)
  const windowTitle = activeTab && isTerminal(activeTab) ? tabTitle(activeTab, platform) : 'Deck'
  useEffect(() => {
    document.title = windowTitle
  }, [windowTitle])

  const terminals = state.tabs.filter(isTerminal)

  return (
    <div className="app">
      <TabBar tabs={state.tabs} active={state.active} platform={platform}
        onActivate={activate} onClose={close} onNew={newTab} />
      <main className="content">
        <ProjectsView active={state.active === PROJECTS_ID} openTabs={terminals} home={info?.home ?? ''}
          findRequest={findRequests[PROJECTS_ID] ?? 0} onOpen={openProject} />
        {terminals.map((tab) => (
          <Workspace key={tab.id} tab={tab} active={tab.id === state.active} home={info?.home ?? ''}
            gitWidth={gitWidth} windowsBuild={info?.windowsBuild} findRequest={findRequests[tab.id] ?? 0}
            onGitWidth={storeGitWidth} onUpdate={update} onClose={close} />
        ))}
      </main>
    </div>
  )
}

interface WorkspaceProps {
  tab: TerminalTab
  active: boolean
  home: string
  /** The stored width; CSS keeps it within 240 px … 55 % when the window shrinks. */
  gitWidth: number
  findRequest: number
  windowsBuild?: number
  /** A drag ended (or a reset): clamp, store and share the width. */
  onGitWidth(px: number): void
  onUpdate(id: string, patch: TerminalPatch): void
  onClose(id: string): void
}

/** A terminal tab: the git panel while the shell is in a repo (unless hidden with
 *  View → Git Panel), the splitter, the terminal. Inactive tabs stay mounted. */
const Workspace = memo(function Workspace(props: WorkspaceProps) {
  const { tab, active, home, gitWidth, findRequest, windowsBuild, onGitWidth, onUpdate, onClose } = props
  const repo = tab.vars.GIT_REPO ?? ''
  const showGit = repo !== '' && !tab.gitHidden
  const [dragWidth, setDragWidth] = useState<number | null>(null)
  const rootRef = useRef<HTMLDivElement>(null)
  const paneRef = useRef<HTMLDivElement>(null)

  // Hidden for the repo it was hidden in: like the prototype's q, entering another repo shows it again.
  const hiddenIn = useRef<string | null>(null)
  useEffect(() => {
    if (!tab.gitHidden) hiddenIn.current = null
    else if (hiddenIn.current === null) hiddenIn.current = repo
    else if (repo && repo !== hiddenIn.current) onUpdate(tab.id, { gitHidden: false })
  }, [tab.gitHidden, tab.id, repo, onUpdate])

  // Hiding the panel while it had the keyboard would leave it with nobody: give it to the terminal.
  useEffect(() => {
    if (showGit || !active) return
    const focused = document.activeElement
    if (!focused || focused === document.body) rootRef.current?.querySelector<HTMLElement>('.xterm-helper-textarea')?.focus()
  }, [showGit, active])

  return (
    <div className={active ? 'workspace' : 'workspace is-hidden'} ref={rootRef}>
      {showGit && (
        <div className="git-pane" ref={paneRef} style={{ width: dragWidth ?? gitWidth }}>
          <GitPanel key={repo} repo={repo} active={active} home={home} />
        </div>
      )}
      {showGit && (
        <Splitter orientation="vertical" label="Resize the git panel"
          getSize={() => paneRef.current?.offsetWidth ?? gitWidth}
          onResize={(px) => setDragWidth(clampGitWidth(px))}
          onResizeEnd={(px) => {
            setDragWidth(null)
            onGitWidth(px)
          }}
          onReset={() => onGitWidth(GIT_WIDTH)} />
      )}
      <TerminalView tab={tab} active={active} windowsBuild={windowsBuild} findRequest={findRequest}
        onUpdate={onUpdate} onClose={onClose} />
    </div>
  )
})
