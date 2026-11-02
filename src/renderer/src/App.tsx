import { memo, useCallback, useEffect, useLayoutEffect, useReducer, useRef, useState } from 'react'
import type { AppInfo, ClipboardPreview, MenuCommand, ProjectAction, UsageState } from '@shared/types'
import { ClaudePanel } from './claude/ClaudePanel'
import { shownSession, toResume } from './claude/resume'
import { useClaudeSession } from './claude/useClaude'
import { ClipboardCard } from './clipboard/ClipboardCard'
import { useClipboardItem } from './clipboard/useClipboardItem'
import { GitPanel } from './git/GitPanel'
import { loadSize, saveSize, Splitter } from './git/Splitter'
import { ProjectsView } from './projects/ProjectsView'
import { TabBar } from './tabs/TabBar'
import { initialTabs, isTerminal, PROJECTS_ID, tabsReducer, type TerminalPatch, type TerminalTab } from './tabs/tabs'
import { runsClaude, tabTitle } from './tabs/title'
import { TerminalView } from './terminal/TerminalView'
import { UsageCard } from './usage/UsageCard'
import { useUsage } from './usage/useUsage'

// Main holds --open folders until the first ready(); StrictMode runs effects twice.
let readySent = false

/** The git panel's width, shared by every tab: 240 px … 55 % of the window. */
const GIT_WIDTH_KEY = 'deck.gitWidth'
const GIT_WIDTH = 360
const GIT_MIN = 240
const GIT_MAX_SHARE = 0.55
/** The Claude panel's width, shared by every tab: 260 px … 45 % of the window. */
const CLAUDE_WIDTH_KEY = 'deck.claudeWidth'
const CLAUDE_WIDTH = 380
const CLAUDE_MIN = 260
const CLAUDE_MAX_SHARE = 0.45
/** What a drag leaves the terminal when both panels are open (and styles.css: .terminal-view). */
const TERMINAL_MIN = 280

/** `px` within min … share of the window, and within `room` (what the other panel and the terminal leave). */
const clampWidth = (px: number, min: number, share: number, room = Infinity) =>
  Math.round(Math.min(Math.max(px, min), Math.max(min, Math.min(window.innerWidth * share, room))))
const clampGitWidth = (px: number, room?: number) => clampWidth(px, GIT_MIN, GIT_MAX_SHARE, room)
const clampClaudeWidth = (px: number, room?: number) => clampWidth(px, CLAUDE_MIN, CLAUDE_MAX_SHARE, room)

export function App() {
  const platform = window.deck.platform
  const [state, dispatch] = useReducer(tabsReducer, initialTabs)
  const [info, setInfo] = useState<AppInfo | null>(null)
  const [findRequests, setFindRequests] = useState<Record<string, number>>({})
  const [gitWidth, setGitWidth] = useState(() => loadSize(GIT_WIDTH_KEY, GIT_WIDTH))
  const [claudeWidth, setClaudeWidth] = useState(() => loadSize(CLAUDE_WIDTH_KEY, CLAUDE_WIDTH))
  /** View → Claude Panel, per tab: the tab knows whether its panel shows. */
  const [claudeToggles, setClaudeToggles] = useState<Record<string, number>>({})
  /** What was just copied, offered under the Claude panel of tabs where Claude runs. */
  const clipItem = useClipboardItem()
  /** Claude's plan usage, shown at the bottom of every Claude pane. */
  const usage = useUsage()

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
  const storeClaudeWidth = useCallback((px: number) => {
    const width = clampClaudeWidth(px)
    setClaudeWidth(width)
    saveSize(CLAUDE_WIDTH_KEY, width)
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
        case 'toggle-claude': {
          const tab = stateRef.current.tabs.find((t) => t.id === active)
          if (tab && isTerminal(tab)) setClaudeToggles((t) => ({ ...t, [active]: (t[active] ?? 0) + 1 }))
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
            gitWidth={gitWidth} claudeWidth={claudeWidth} windowsBuild={info?.windowsBuild}
            findRequest={findRequests[tab.id] ?? 0} claudeToggle={claudeToggles[tab.id] ?? 0} clipItem={clipItem} usage={usage}
            onGitWidth={storeGitWidth} onClaudeWidth={storeClaudeWidth} onUpdate={update} onClose={close} />
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
  /** Likewise, 260 px … 45 %. */
  claudeWidth: number
  findRequest: number
  /** Incremented by View → Claude Panel. */
  claudeToggle: number
  windowsBuild?: number
  /** The clipboard card's item (one for the window). */
  clipItem: ClipboardPreview | null
  /** Claude's plan usage (one for the window). */
  usage: UsageState | null
  /** A drag ended (or a reset): clamp, store and share the width. */
  onGitWidth(px: number): void
  onClaudeWidth(px: number): void
  onUpdate(id: string, patch: TerminalPatch): void
  onClose(id: string): void
}

/** A terminal tab: the git panel while the shell is in a repo (unless hidden with
 *  View → Git Panel), the terminal, and the Claude panel while Claude runs in the tab
 *  or the folder has a session (unless hidden with View → Claude Panel), each panel
 *  with its splitter. Inactive tabs stay mounted. */
const Workspace = memo(function Workspace(props: WorkspaceProps) {
  const { tab, active, home, gitWidth, claudeWidth, findRequest, claudeToggle, windowsBuild, clipItem, usage } = props
  const { onGitWidth, onClaudeWidth, onUpdate, onClose } = props
  const repo = tab.vars.GIT_REPO ?? ''
  const showGit = repo !== '' && !tab.gitHidden
  // Claude logs under the folder it was started in: the tab's cwd, which stays put while
  // it runs (no prompts, so no OSC 7; zsh reports a cd within the command line at once).
  const folder = tab.cwd || repo
  const claudeRuns = runsClaude(tab.process, tab.title)
  const claudeLive = active && tab.claudeHidden !== true
  const claude = useClaudeSession(folder, claudeLive, toResume(tab.claudeSession))
  // claudeHidden: true = hidden with View → Claude Panel; false = shown with it, even
  // with nothing to show yet; unset = shown when there is something to show.
  const showClaude = tab.claudeHidden !== true && (tab.claudeHidden === false || claudeRuns || claude.snapshot !== null)
  const [dragWidth, setDragWidth] = useState<number | null>(null)
  const [claudeDrag, setClaudeDrag] = useState<number | null>(null)
  const rootRef = useRef<HTMLDivElement>(null)
  const paneRef = useRef<HTMLDivElement>(null)
  const claudeRef = useRef<HTMLDivElement>(null)
  /** Pastes into this tab's terminal (TerminalView sets it). */
  const pasteRef = useRef<((text: string) => void) | null>(null)
  /** Add's progress for one item: a newer item starts clean, nothing to reset. */
  const [clip, setClip] = useState<{ id: string; busy: boolean; error: string | null } | null>(null)
  const clipState = clip && clip.id === clipItem?.id ? clip : null
  const addClip = useCallback((id: string) => {
    setClip({ id, busy: true, error: null })
    const settle = (error: string | null) => setClip((c) => (c?.id === id ? { id, busy: false, error } : c))
    window.deck.clipboard.add(id).then(
      (result) => {
        if ('text' in result) {
          pasteRef.current?.(result.text)
          settle(null)
        } else settle(result.error)
      },
      (err: unknown) => settle(err instanceof Error ? err.message : String(err)),
    )
  }, [])
  const dismissClip = useCallback((id: string) => {
    window.deck.clipboard.dismiss(id)
    // × via the keyboard leaves focus on the card's button, about to unmount: give it to the terminal.
    if (claudeRef.current?.contains(document.activeElement)) rootRef.current?.querySelector<HTMLElement>('.xterm-helper-textarea')?.focus()
  }, [])

  // Hidden for the repo it was hidden in: like the prototype's q, entering another repo shows it again.
  const hiddenIn = useRef<string | null>(null)
  useEffect(() => {
    if (!tab.gitHidden) hiddenIn.current = null
    else if (hiddenIn.current === null) hiddenIn.current = repo
    else if (repo && repo !== hiddenIn.current) onUpdate(tab.id, { gitHidden: false })
  }, [tab.gitHidden, tab.id, repo, onUpdate])

  // View → Claude Panel: hides the panel when it shows, else shows it.
  const toggleSeen = useRef(claudeToggle)
  useEffect(() => {
    if (claudeToggle === toggleSeen.current) return
    toggleSeen.current = claudeToggle
    onUpdate(tab.id, { claudeHidden: showClaude })
  }, [claudeToggle]) // showClaude, tab.id and onUpdate as of this render

  // The session the panel shows is the tab's: main's follow state is per folder, so subscribing
  // again (a tab switch) hands it back, rather than taking what another tab there followed. (The
  // same session again changes nothing: the reducer compares it by content.)
  useEffect(() => {
    const shown = claude.folder === folder ? shownSession(claude.snapshot) : undefined
    if (shown) onUpdate(tab.id, { claudeSession: shown })
  }, [claude.snapshot, claude.folder, folder, tab.id, onUpdate])

  // Claude starting in the tab: from now on its panel follows the newest session, which will
  // be Claude's own, not one this tab showed before; a pin it holds now is let go at once.
  const ranClaude = useRef(claudeRuns)
  useEffect(() => {
    if (claudeRuns === ranClaude.current) return
    ranClaude.current = claudeRuns
    if (!claudeRuns) return
    onUpdate(tab.id, { claudeSession: undefined })
    if (claudeLive && claude.folder === folder && claude.snapshot?.following === 'pinned') {
      window.deck.claude.follow(folder, null).catch(() => {}) // its snapshot arrives as an update
    }
  }, [claudeRuns]) // the rest as of this render

  // Like the git panel's: the choice holds in the repo (or folder) it was made in.
  const claudeKey = repo || folder
  const claudeChoiceIn = useRef<string | null>(null)
  useEffect(() => {
    if (tab.claudeHidden === undefined) claudeChoiceIn.current = null
    else if (claudeChoiceIn.current === null) claudeChoiceIn.current = claudeKey
    else if (claudeKey && claudeKey !== claudeChoiceIn.current) onUpdate(tab.id, { claudeHidden: undefined })
  }, [tab.claudeHidden, tab.id, claudeKey, onUpdate])

  // Hiding a panel while it had the keyboard would leave it with nobody: give it to the terminal.
  useEffect(() => {
    if (!active) return
    const focused = document.activeElement
    if (!focused || focused === document.body) rootRef.current?.querySelector<HTMLElement>('.xterm-helper-textarea')?.focus()
  }, [showGit, showClaude, active])

  /** What a panel can have: the workspace less the other panel, the splitters and the terminal's minimum. */
  const roomBeside = (other: HTMLDivElement | null) =>
    (rootRef.current?.clientWidth ?? window.innerWidth) - (other?.offsetWidth ?? 0) - 2 - TERMINAL_MIN

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
          onResize={(px) => setDragWidth(clampGitWidth(px, roomBeside(claudeRef.current)))}
          onResizeEnd={(px) => {
            setDragWidth(null)
            onGitWidth(clampGitWidth(px, roomBeside(claudeRef.current)))
          }}
          onReset={() => onGitWidth(GIT_WIDTH)} />
      )}
      <TerminalView tab={tab} active={active} windowsBuild={windowsBuild} findRequest={findRequest}
        pasteRef={pasteRef} onUpdate={onUpdate} onClose={onClose} />
      {showClaude && (
        <Splitter orientation="vertical" label="Resize the Claude panel" direction={-1}
          getSize={() => claudeRef.current?.offsetWidth ?? claudeWidth}
          onResize={(px) => setClaudeDrag(clampClaudeWidth(px, roomBeside(paneRef.current)))}
          onResizeEnd={(px) => {
            setClaudeDrag(null)
            onClaudeWidth(clampClaudeWidth(px, roomBeside(paneRef.current)))
          }}
          onReset={() => onClaudeWidth(CLAUDE_WIDTH)} />
      )}
      {showClaude && (
        <div className="claude-pane" ref={claudeRef} style={{ width: claudeDrag ?? claudeWidth }}>
          <ClaudePanel folder={folder} snapshot={claude.snapshot} phase={claude.phase} error={claude.error}
            claudeRuns={claudeRuns} active={active} home={home} onRetry={claude.retry} />
          {usage && <UsageCard state={usage} home={home} />}
          {claudeRuns && clipItem && (
            <ClipboardCard item={clipItem} home={home} busy={clipState?.busy ?? false} error={clipState?.error ?? null}
              onAdd={addClip} onDismiss={dismissClip} />
          )}
        </div>
      )}
    </div>
  )
})
