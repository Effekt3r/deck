import { type CSSProperties, memo, useCallback, useEffect, useLayoutEffect, useReducer, useRef, useState } from 'react'
import type { AppInfo, ClipboardPreview, DeviceInfo, MenuCommand, ProjectAction, UsageState } from '@shared/types'
import { ClaudePanel } from './claude/ClaudePanel'
import { shownSession, toResume } from './claude/resume'
import { useClaudeSession } from './claude/useClaude'
import { ClipboardCard } from './clipboard/ClipboardCard'
import { useClipboardItem } from './clipboard/useClipboardItem'
import { DevicePanel } from './device/DevicePanel'
import { devicesNeeded, menuOrder, panelRules } from './device/pick'
import { useDeviceList, useDeviceProject, useHeldView } from './device/useDevices'
import { GitPanel } from './git/GitPanel'
import { loadSize, saveSize, Splitter } from './git/Splitter'
import { usePageVisible, useStoredFlag } from './hooks'
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
/** The right pane's width (device and Claude panels), shared by every tab: 260 px … 45 % of the
 *  window. Its key is from before the device panel. */
const CLAUDE_WIDTH_KEY = 'deck.claudeWidth'
const CLAUDE_WIDTH = 380
const CLAUDE_MIN = 260
const CLAUDE_MAX_SHARE = 0.45
/** What a drag leaves the terminal when both panels are open (and styles.css: .terminal-view). */
const TERMINAL_MIN = 280
/** The usage card's fold, shared by every tab. */
const USAGE_OPEN_KEY = 'deck.usageOpen'
/** The device panel's fold, shared by every tab. */
const DEVICE_OPEN_KEY = 'deck.deviceOpen'
/** The device panel's share of the right pane's height above the Claude panel, shared by every tab,
 *  stored in thousandths: 15 … 85 %. */
const DEVICE_SHARE_KEY = 'deck.deviceShare'
const DEVICE_SHARE = 0.6
const SHARE_MIN = 0.15
const SHARE_MAX = 0.85
/** The device panel keeps its header and 120 px of screen; the Claude panel under it 160 px (and
 *  device.css: .claude-pane.with-device), the usage and clipboard cards below that their own heights.
 *  A window too short for all of it takes the room from the device panel first. */
const DEVICE_MIN = 152
const CLAUDE_MIN_BELOW = 160
const NO_DEVICES: DeviceInfo[] = []

/** `px` within min … share of the window, and within `room` (what the other panel and the terminal leave). */
const clampWidth = (px: number, min: number, share: number, room = Infinity) =>
  Math.round(Math.min(Math.max(px, min), Math.max(min, Math.min(window.innerWidth * share, room))))
const clampGitWidth = (px: number, room?: number) => clampWidth(px, GIT_MIN, GIT_MAX_SHARE, room)
const clampClaudeWidth = (px: number, room?: number) => clampWidth(px, CLAUDE_MIN, CLAUDE_MAX_SHARE, room)
const clampShare = (share: number) => Math.min(Math.max(share, SHARE_MIN), SHARE_MAX)

export function App() {
  const platform = window.deck.platform
  const [state, dispatch] = useReducer(tabsReducer, initialTabs)
  const [info, setInfo] = useState<AppInfo | null>(null)
  const [findRequests, setFindRequests] = useState<Record<string, number>>({})
  const [gitWidth, setGitWidth] = useState(() => loadSize(GIT_WIDTH_KEY, GIT_WIDTH))
  const [claudeWidth, setClaudeWidth] = useState(() => loadSize(CLAUDE_WIDTH_KEY, CLAUDE_WIDTH))
  /** View → Claude Panel, per tab: the tab knows whether its panel shows. */
  const [claudeToggles, setClaudeToggles] = useState<Record<string, number>>({})
  /** View → Device Panel, per tab, likewise. */
  const [deviceToggles, setDeviceToggles] = useState<Record<string, number>>({})
  /** What was just copied, offered under the Claude panel of tabs where Claude runs. */
  const clipItem = useClipboardItem()
  /** Claude's plan usage, shown at the bottom of every Claude pane, which all fold together. */
  const usage = useUsage()
  const [usageOpen, toggleUsage] = useStoredFlag(USAGE_OPEN_KEY, true)
  const [deviceOpen, toggleDevice] = useStoredFlag(DEVICE_OPEN_KEY, true)
  const [deviceShare, setDeviceShare] = useState(() => clampShare(loadSize(DEVICE_SHARE_KEY, DEVICE_SHARE * 1000) / 1000))
  /** Device screens stream only while the window can be seen. */
  const pageVisible = usePageVisible()

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
  const storeDeviceShare = useCallback((share: number) => {
    const next = clampShare(share)
    setDeviceShare(next)
    saveSize(DEVICE_SHARE_KEY, Math.round(next * 1000))
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
        case 'toggle-device': {
          const tab = stateRef.current.tabs.find((t) => t.id === active)
          if (tab && isTerminal(tab)) setDeviceToggles((t) => ({ ...t, [active]: (t[active] ?? 0) + 1 }))
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
            usageOpen={usageOpen} onUsageToggle={toggleUsage}
            deviceToggle={deviceToggles[tab.id] ?? 0} deviceOpen={deviceOpen} onDeviceToggle={toggleDevice}
            deviceShare={deviceShare} onDeviceShare={storeDeviceShare} pageVisible={pageVisible}
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
  /** The right pane's; likewise, 260 px … 45 %. */
  claudeWidth: number
  findRequest: number
  /** Incremented by View → Claude Panel. */
  claudeToggle: number
  windowsBuild?: number
  /** The clipboard card's item (one for the window). */
  clipItem: ClipboardPreview | null
  /** Claude's plan usage (one for the window). */
  usage: UsageState | null
  /** The usage card is unfolded (one flag for the window). */
  usageOpen: boolean
  onUsageToggle(): void
  /** Incremented by View → Device Panel. */
  deviceToggle: number
  /** The device panel is unfolded (one flag for the window). */
  deviceOpen: boolean
  onDeviceToggle(): void
  /** The device panel's share of the right pane's height above the Claude panel. */
  deviceShare: number
  /** A drag ended (or a reset): clamp, store and share it. */
  onDeviceShare(share: number): void
  /** The window can be seen: a device screen may stream. */
  pageVisible: boolean
  /** A drag ended (or a reset): clamp, store and share the width. */
  onGitWidth(px: number): void
  onClaudeWidth(px: number): void
  onUpdate(id: string, patch: TerminalPatch): void
  onClose(id: string): void
}

/** A terminal tab: the git panel while the shell is in a repo (unless hidden with View → Git
 *  Panel), the terminal, and the right pane: the device panel while a device fits the project, or a
 *  booted simulator Deck can't show asks for idb-companion (unless hidden with View → Device Panel),
 *  above the Claude panel while Claude runs in the tab or the folder has a session (unless hidden
 *  with View → Claude Panel). Inactive tabs stay mounted. */
const Workspace = memo(function Workspace(props: WorkspaceProps) {
  const { tab, active, home, gitWidth, claudeWidth, findRequest, claudeToggle, windowsBuild, clipItem } = props
  const { usage, usageOpen, onUsageToggle, onGitWidth, onClaudeWidth, onUpdate, onClose } = props
  const { deviceToggle, deviceOpen, onDeviceToggle, deviceShare, onDeviceShare, pageVisible } = props
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
  /** A button that had the keyboard went (the usage card's, a device chosen from the keyboard): the
   *  terminal gets it. */
  const focusTerminal = useCallback(() => {
    rootRef.current?.querySelector<HTMLElement>('.xterm-helper-textarea')?.focus()
  }, [])

  // The device panel: the tab's project (read when the tab comes to the front), every device adb
  // and, on macOS, idb-companion see while this tab may show one (null until known), and which one
  // it shows. Shown by hand, it works without a project too.
  const [project, pickForProject, projectFresh] = useDeviceProject(folder, active)
  // A tab's device and its View → Device Panel choice hold in the project they were made in: in
  // another one they don't count, from its first render (the effect below then clears them), so a cd
  // can't start a stream for a device that was never to show there.
  const deviceRoot = project?.root ?? null
  const deviceRootSeen = useRef<string | null>(null)
  const movedOn = deviceRoot !== null && deviceRootSeen.current !== null && deviceRoot !== deviceRootSeen.current
  const tabDevice = movedOn ? undefined : tab.device
  const tabHidden = movedOn ? undefined : tab.deviceHidden
  const platform = window.deck.platform
  // devicesNeeded gates useDeviceList; pick.ts's panelRules has the rest, once it answers.
  const deviceNeeded = devicesNeeded({ project, tabDevice, tabHidden, platform })
  const deviceList = useDeviceList(deviceNeeded)
  const devices = deviceList?.devices ?? NO_DEVICES
  const { byHand, apps, wants, looking: deviceLooking, choice, iosHint } = panelRules({ project, tabDevice, tabHidden, list: deviceList, platform })
  const deviceView = useHeldView(choice, devices, deviceRoot, tabDevice ?? project?.picks[0] ?? null)
  const showDevice = tabHidden !== true && (deviceView.kind !== 'none' || byHand || iosHint)
  const shownDevice = deviceView.kind === 'device' ? deviceView.device.id : null
  const showRight = showClaude || showDevice
  const [deviceDrag, setDeviceDrag] = useState<number | null>(null)
  const deviceRef = useRef<HTMLDivElement>(null)
  const pickDevice = useCallback((id: string) => {
    onUpdate(tab.id, { device: id })
    pickForProject(id)
  }, [tab.id, onUpdate, pickForProject])
  const insert = useCallback((text: string) => pasteRef.current?.(text), [])

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

  // View → Device Panel, likewise; shown with nothing to show, it offers every device.
  const deviceToggleSeen = useRef(deviceToggle)
  useEffect(() => {
    if (deviceToggle === deviceToggleSeen.current) return
    deviceToggleSeen.current = deviceToggle
    onUpdate(tab.id, { deviceHidden: showDevice })
  }, [deviceToggle]) // showDevice, tab.id and onUpdate as of this render

  // A tab's device and its View → Device Panel choice hold in the project they were made in (above).
  useEffect(() => {
    if (!deviceRoot) return
    if (deviceRootSeen.current !== null && deviceRootSeen.current !== deviceRoot) onUpdate(tab.id, { device: undefined, deviceHidden: undefined })
    deviceRootSeen.current = deviceRoot
  }, [deviceRoot, tab.id, onUpdate])

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

  // Hiding a panel while it had the keyboard would leave it with nobody: give it to the terminal. So
  // would folding the device panel, or another device taking the screen's place.
  useEffect(() => {
    if (!active) return
    const focused = document.activeElement
    if (!focused || focused === document.body) rootRef.current?.querySelector<HTMLElement>('.xterm-helper-textarea')?.focus()
  }, [showGit, showClaude, showDevice, deviceOpen, shownDevice, active])

  // A drag cut short (the splitter went: the Claude panel hidden mid-drag) leaves no height behind.
  const deviceSplit = showDevice && showClaude && deviceOpen
  useEffect(() => {
    if (!deviceSplit) setDeviceDrag(null)
  }, [deviceSplit])

  /** What a panel can have: the workspace less the other panel, the splitters and the terminal's minimum. */
  const roomBeside = (other: HTMLDivElement | null) =>
    (rootRef.current?.clientWidth ?? window.innerWidth) - (other?.offsetWidth ?? 0) - 2 - TERMINAL_MIN

  /** The device panel's height for a drag: within its share's bounds (as stored, so it doesn't jump on
   *  release) and its minimum, and leaving the Claude panel under it its minimum (the cards below it
   *  keep their heights, so the room is what the two panels have now). */
  const clampDevice = (px: number) => {
    const pane = claudeRef.current?.clientHeight ?? window.innerHeight
    const claudePanel = claudeRef.current?.querySelector<HTMLElement>('.claude-panel')
    const room = (deviceRef.current?.offsetHeight ?? 0) + (claudePanel?.offsetHeight ?? 0) - CLAUDE_MIN_BELOW
    const min = Math.max(DEVICE_MIN, pane * SHARE_MIN)
    const max = Math.max(min, Math.min(room, pane * SHARE_MAX))
    return Math.round(Math.min(Math.max(px, min), max))
  }
  // Alone, the device panel takes the pane; folded, its header; else its share, which gives way when
  // the window is too short for it and the Claude panel's minimum.
  const deviceStyle: CSSProperties = !showClaude
    ? { flex: '1 1 0' }
    : !deviceOpen
      ? { flex: 'none' }
      : { flex: '0 1 auto', height: deviceDrag ?? `${deviceShare * 100}%`, minHeight: DEVICE_MIN, maxHeight: `calc(100% - ${CLAUDE_MIN_BELOW}px)` }

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
      {showRight && (
        <Splitter orientation="vertical" label="Resize the right pane" direction={-1}
          getSize={() => claudeRef.current?.offsetWidth ?? claudeWidth}
          onResize={(px) => setClaudeDrag(clampClaudeWidth(px, roomBeside(paneRef.current)))}
          onResizeEnd={(px) => {
            setClaudeDrag(null)
            onClaudeWidth(clampClaudeWidth(px, roomBeside(paneRef.current)))
          }}
          onReset={() => onClaudeWidth(CLAUDE_WIDTH)} />
      )}
      {showRight && (
        <div className={deviceSplit ? 'claude-pane with-device' : 'claude-pane'} ref={claudeRef} style={{ width: claudeDrag ?? claudeWidth }}>
          {showDevice && (
            <div className="device-slot" ref={deviceRef} style={deviceStyle}>
              <DevicePanel view={deviceView} devices={menuOrder(devices, apps)} problem={deviceList?.problem ?? null}
                iosProblem={deviceList?.iosProblem ?? null} wants={wants} looking={deviceLooking}
                open={deviceOpen} onToggle={onDeviceToggle} visible={active && pageVisible && projectFresh} claudeRuns={claudeRuns}
                onPick={pickDevice} onInsert={insert} onFocusLost={focusTerminal} />
            </div>
          )}
          {deviceSplit && (
            <Splitter orientation="horizontal" label="Resize the device panel"
              getSize={() => deviceRef.current?.offsetHeight ?? DEVICE_MIN}
              onResize={(px) => setDeviceDrag(clampDevice(px))}
              onResizeEnd={(px) => {
                setDeviceDrag(null)
                const pane = claudeRef.current?.clientHeight ?? 0
                if (pane > 0) onDeviceShare(clampDevice(px) / pane)
              }}
              onReset={() => onDeviceShare(DEVICE_SHARE)} />
          )}
          {showClaude && (
            <ClaudePanel folder={folder} snapshot={claude.snapshot} phase={claude.phase} error={claude.error}
              claudeRuns={claudeRuns} active={active} home={home} onRetry={claude.retry} />
          )}
          {showClaude && usage && (
            <UsageCard state={usage} home={home} open={usageOpen} onToggle={onUsageToggle} onFocusLost={focusTerminal} />
          )}
          {showClaude && claudeRuns && clipItem && (
            <ClipboardCard item={clipItem} home={home} busy={clipState?.busy ?? false} error={clipState?.error ?? null}
              onAdd={addClip} onDismiss={dismissClip} />
          )}
        </div>
      )}
    </div>
  )
})
