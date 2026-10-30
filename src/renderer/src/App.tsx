import { useCallback, useEffect, useLayoutEffect, useReducer, useRef, useState } from 'react'
import type { AppInfo, MenuCommand, ProjectAction } from '@shared/types'
import { ProjectsView } from './projects/ProjectsView'
import { TabBar } from './tabs/TabBar'
import { initialTabs, isTerminal, PROJECTS_ID, tabsReducer, type TerminalPatch } from './tabs/tabs'
import { tabTitle } from './tabs/title'
import { TerminalView } from './terminal/TerminalView'

// Main holds --open folders until the first ready(); StrictMode runs effects twice.
let readySent = false

export function App() {
  const platform = window.deck.platform
  const [state, dispatch] = useReducer(tabsReducer, initialTabs)
  const [info, setInfo] = useState<AppInfo | null>(null)
  const [findRequests, setFindRequests] = useState<Record<string, number>>({})

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
  }, [newTab, open])

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
          <TerminalView key={tab.id} tab={tab} active={tab.id === state.active} windowsBuild={info?.windowsBuild}
            findRequest={findRequests[tab.id] ?? 0} onUpdate={update} onClose={close} />
        ))}
      </main>
    </div>
  )
}
