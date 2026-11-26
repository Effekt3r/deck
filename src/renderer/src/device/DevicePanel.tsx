import { Component, type ErrorInfo, type MouseEvent, type ReactNode, useCallback, useEffect, useLayoutEffect, useRef, useState } from 'react'
import type { DeviceInfo, DeviceList, StartableDevice } from '@shared/types'
import { errorText } from '../git/format'
import { BackIcon, CameraIcon, Caret, HomeIcon, PowerIcon, RecentsIcon } from '../icons'
import { DeviceMenu, type MenuClose } from './DeviceMenu'
import { DeviceScreen, type ScreenHandle } from './DeviceScreen'
import { KEYCODE } from './keys'
import { emptyTitle, type PanelView, startButtons } from './pick'
import '../claude/panel.css'
import './device.css'

interface DevicePanelProps {
  /** A device (maybe gone for now), the devices to choose from, or none: the panel was asked for. */
  view: PanelView
  /** Every device Deck sees, for the menu, those that fit first. */
  devices: DeviceInfo[]
  /** What can be started, those that fit first (DeviceList.startable). */
  startable: StartableDevice[]
  /** The SDK's emulator lists no AVDs. */
  noAvds: boolean
  /** The tab's device (its own pick, else the project's latest): its Start button comes first. */
  pick: string | null
  problem: DeviceList['problem']
  /** Why simulators can't be listed (macOS). */
  iosProblem: DeviceList['iosProblem']
  /** The kinds of device the tab shows, for what to say with none. */
  wants: { android: boolean; ios: boolean }
  /** adb or idb-companion still finding their first devices the tab may show. */
  looking: boolean
  /** Unfolded: one flag for the window, so every tab's panel folds together. */
  open: boolean
  onToggle(): void
  /** The tab is in front and the window can be seen: the screen may stream. */
  visible: boolean
  /** Claude runs in the tab: the screenshot button shows. */
  claudeRuns: boolean
  onPick(id: string): void
  /** A device stopped from the panel: the tab keeps it, so the panel stays with its Start button. */
  onKeep(id: string): void
  /** Types text into the tab's terminal: the screenshot's path. */
  onInsert(text: string): void
  /** A device was chosen from the keyboard and its button went with the chooser: the tab gives the
   *  keyboard to its terminal. */
  onFocusLost(): void
}

/** Clicks in the header and the chooser leave the keyboard where it was. (The device menu takes it
 *  itself, and gives it back to its button.) */
const keepFocus = (e: MouseEvent) => e.preventDefault()

/** A device's screen at the top of the right pane: a header (fold, the device menu, the device's
 *  buttons, the screenshot), then the screen, a choice of devices, or why there's none. A thrown
 *  render costs the panel only. */
export function DevicePanel(props: DevicePanelProps) {
  const shown = props.view.kind === 'device' || props.view.kind === 'starting' ? props.view.device.id : props.view.kind
  return (
    <Boundary resetKey={shown}>
      <PanelBody {...props} />
    </Boundary>
  )
}

function PanelBody({ view, devices, startable, noAvds, pick, problem, iosProblem, wants, looking, open, onToggle, visible, claudeRuns, onPick, onKeep, onInsert, onFocusLost }: DevicePanelProps) {
  const [menuAnchor, setMenuAnchor] = useState<HTMLElement | null>(null)
  /** A screenshot that failed, and the device it was of. */
  const [error, setError] = useState<{ device: string; text: string } | null>(null)
  const [busy, setBusy] = useState(false)
  const screen = useRef<ScreenHandle>(null)
  const deviceButton = useRef<HTMLButtonElement>(null)
  /** Where the keyboard was when the menu opened: the terminal for a click, the button from the keyboard. */
  const returnTo = useRef<Element | null>(null)
  /** The menu closed and the keyboard has to be put back, once it's gone (below). */
  const putBack = useRef<MenuClose | null>(null)
  const closeMenu = useCallback((how: MenuClose) => {
    setMenuAnchor(null)
    // Tab moves on from the button, so the button takes the keyboard before the browser's Tab does.
    if (how === 'tab') deviceButton.current?.focus()
    else putBack.current = how
  }, [])
  // Once the menu is gone, and a device it chose has taken the screen's place, the keyboard goes back
  // where it was when the menu opened if that's still there (not a screen that went with its device),
  // else to the button. After a click elsewhere, what was clicked keeps it if it took it.
  useLayoutEffect(() => {
    const how = putBack.current
    if (menuAnchor || !how) return
    putBack.current = null
    const focused = document.activeElement
    if (how === 'leave' && focused && focused !== document.body) return
    const back = returnTo.current
    if (back instanceof HTMLElement && back.isConnected && back !== document.body) back.focus()
    else deviceButton.current?.focus()
  })
  useEffect(() => {
    if (!visible) setMenuAnchor(null) // it lives in <body>, outside the hidden tab
  }, [visible])

  const device = view.kind === 'device' ? view.device : null
  const starting = view.kind === 'starting' ? view.device : null
  const gone = view.kind === 'device' && view.gone
  const ready = device !== null && device.state === 'ready' && !gone
  // A failed screenshot's error goes with its device, and with Claude.
  useEffect(() => {
    setError(null)
  }, [device?.id, claudeRuns])
  // A start or stop that couldn't be done says so while the panel shows what it showed when the
  // answer came (for a refused start, whatever the pick fell back to).
  const viewKey = device?.id ?? starting?.id ?? view.kind
  const viewNow = useRef(viewKey)
  useLayoutEffect(() => {
    viewNow.current = viewKey
  })
  const [actionError, setActionError] = useState<{ view: string; text: string } | null>(null)
  // A new view (another device, or the same one's kind changing) clears a start/stop error, rather
  // than letting a stale one reappear if the view later matches again.
  useEffect(() => setActionError(null), [viewKey])
  const say = (text: string) => setActionError({ view: viewNow.current, text })
  // Choosing one to start picks it for the tab and the project, as choosing a connected device does;
  // the list then says how the start goes.
  const start = (item: StartableDevice) => {
    setActionError(null)
    onPick(item.id)
    window.deck.devices.start(item.id).then(
      (result) => {
        if (result) say(`Couldn't start ${item.name}: ${result.error}`)
      },
      (err: unknown) => say(`Couldn't start ${item.name}: ${errorText(err)}`),
    )
  }
  const stop = (target: DeviceInfo) => {
    setActionError(null)
    onKeep(target.id)
    window.deck.devices.stop(target.id).then(
      (result) => {
        if (result) say(`Couldn't stop ${target.name}: ${result.error}`)
      },
      (err: unknown) => say(`Couldn't stop ${target.name}: ${errorText(err)}`),
    )
  }
  const shownActionError = actionError && actionError.view === viewKey ? actionError.text : null
  let message: string | null = null
  if (device && gone) message = `${device.name} disconnected`
  else if (device?.state === 'booting') message = `Starting ${device.name}…`
  else if (device?.state === 'unauthorized') message = `Allow USB debugging on ${device.name}: check its screen.`
  else if (device?.state === 'offline') message = `${device.name} isn't answering. Unplug it and plug it back in.`
  else if (device?.state === 'connecting') message = `${device.name} is connecting…`

  const press = (keycode: number) => {
    if (device) window.deck.devices.input(device.id, { type: 'key', keycode, meta: 0 })
  }
  const screenshot = async () => {
    if (!device || busy) return
    const of = device.id
    setBusy(true)
    setError(null)
    try {
      const png = await screen.current?.screenshot()
      if (!png) throw new Error("There's no live picture to add yet.")
      const result = await window.deck.devices.screenshot(png)
      if ('text' in result) onInsert(result.text)
      else setError({ device: of, text: result.error })
    } catch (err) {
      setError({ device: of, text: errorText(err) })
    } finally {
      setBusy(false)
    }
  }
  // An error belongs to its device's screenshot button: it goes when the device or Claude does.
  const shownError = error && error.device === device?.id && claudeRuns ? error.text : null

  const title = device?.name ?? starting?.name ?? (view.kind === 'choose' ? 'Choose a device' : 'Devices')
  return (
    <div className={open ? 'device-panel' : 'device-panel folded'}>
      <header className="dp-head" onMouseDown={keepFocus}>
        <button className="cp-section-head dp-fold" aria-expanded={open} aria-label="Device panel"
          title={open ? 'Fold the device panel' : 'Unfold the device panel'} onClick={onToggle}>
          <Caret />
        </button>
        <button ref={deviceButton} className="dp-device" aria-haspopup="menu" aria-expanded={menuAnchor !== null} title="The device this tab shows"
          onClick={(e) => {
            if (menuAnchor) return closeMenu('back')
            returnTo.current = document.activeElement
            setMenuAnchor(e.currentTarget)
          }}>
          <span className="dp-name">{title}</span>
          <Chevron />
        </button>
        {device && <span className={gone ? 'dp-detail gone' : 'dp-detail'}>{gone ? 'disconnected' : device.detail}</span>}
        {starting && <span className="dp-detail">{starting.detail}</span>}
        <span className="cp-spacer" />
        {open && ready && device && (
          <span className="dp-buttons">
            {/* An iPhone is view only: it gets the camera alone. */}
            {device.kind === 'simulator' && (
              <IconButton label="Home" onClick={() => window.deck.devices.input(device.id, { type: 'button', button: 'home' })}><HomeIcon /></IconButton>
            )}
            {(device.kind === 'android' || device.kind === 'emulator') && (
              <>
                <IconButton label="Back" onClick={() => press(KEYCODE.BACK)}><BackIcon /></IconButton>
                <IconButton label="Home" onClick={() => press(KEYCODE.HOME)}><HomeIcon /></IconButton>
                <IconButton label="Recent apps" onClick={() => press(KEYCODE.APP_SWITCH)}><RecentsIcon /></IconButton>
                <IconButton label="Power" onClick={() => press(KEYCODE.POWER)}><PowerIcon /></IconButton>
              </>
            )}
            {claudeRuns && (
              <IconButton label="Add screenshot to Claude" busy={busy} onClick={() => void screenshot()}><CameraIcon /></IconButton>
            )}
          </span>
        )}
      </header>
      {open && shownError && <div className="dp-error" role="alert">{shownError}</div>}
      {open && shownActionError && <div className="dp-error" role="alert">{shownActionError}</div>}
      {open && (
        <div className="dp-body">
          {device && (
            <DeviceScreen key={device.id} deviceId={device.id} name={device.name} kind={device.kind} live={visible && ready} message={message}
              busy={device.state === 'booting' && !gone} handle={screen} />
          )}
          {starting && (starting.error !== undefined ? (
            <State error title={`Couldn't start ${starting.name}`} detail={starting.error}>
              <button className="button" onMouseDown={keepFocus} onClick={(e) => {
                // From the keyboard, the button had it, and it goes with the view once "Starting …"
                // replaces this button.
                const k = e.currentTarget === document.activeElement
                start(starting)
                if (k) onFocusLost()
              }}>Try again</button>
            </State>
          ) : (
            <State busy title={`Starting ${starting.name}…`} />
          ))}
          {view.kind === 'choose' && (
            <div className="dp-choose" onMouseDown={keepFocus}>
              <span className="dp-choose-title">Which device should this project show?</span>
              {view.devices.map((d) => (
                <button key={d.id} className="dp-choice" onClick={(e) => {
                  // From the keyboard, the button had it, and it goes with the chooser.
                  const fromKeyboard = e.currentTarget === document.activeElement
                  onPick(d.id)
                  if (fromKeyboard) onFocusLost()
                }}>
                  <span>{d.name}</span>
                  <span className="dp-choice-detail">{d.detail}</span>
                </button>
              ))}
            </div>
          )}
          {view.kind === 'none' && (
            <Nothing devices={devices} problem={problem} iosProblem={iosProblem} wants={wants} looking={looking} startable={startable} noAvds={noAvds} pick={pick}
              onStart={(item, fromKeyboard) => {
                start(item)
                // From the keyboard, the button had it, and it goes with the empty panel.
                if (fromKeyboard) onFocusLost()
              }} />
          )}
        </div>
      )}
      {menuAnchor && (
        <DeviceMenu devices={devices} startable={startable} noAvds={noAvds && wants.android} current={device?.id ?? starting?.id ?? null}
          shown={device && !gone ? device : null} anchor={menuAnchor} onPick={onPick} onStart={start} onStop={stop} onClose={closeMenu} />
      )}
    </div>
  )
}

interface NothingProps {
  /** Every device Deck sees, just to say whether any are connected (`emptyTitle`). */
  devices: DeviceInfo[]
  problem: DeviceList['problem']
  iosProblem: DeviceList['iosProblem']
  wants: { android: boolean; ios: boolean }
  looking: boolean
  startable: StartableDevice[]
  noAvds: boolean
  pick: string | null
  /** A Start button was pressed; `fromKeyboard`: it had the keyboard. */
  onStart(item: StartableDevice, fromKeyboard: boolean): void
}

/** The panel was asked for (or a simulator can't be shown) and there's nothing to show: why, and
 *  Start buttons for up to 3 emulators or simulators that fit. */
function Nothing({ devices, problem, iosProblem, wants, looking, startable, noAvds, pick, onStart }: NothingProps) {
  if (looking) return <State busy title="Looking for devices…" />
  // Nested so each problem narrows.
  if (wants.ios) {
    if (iosProblem === 'no-idb') {
      const command = 'brew install facebook/fb/idb-companion'
      return <Install key={command} title="Deck shows simulators with idb-companion:" command={command} />
    }
    if (iosProblem === 'old-idb') {
      const command = 'brew upgrade idb-companion'
      return <Install key={command} title="This idb-companion can't stream a simulator's screen. Update it:" command={command} />
    }
    if (iosProblem) return <State error title="Deck couldn't list the simulators" detail={iosProblem.error} />
  }
  if (wants.android) {
    if (problem === 'no-adb') {
      return <State title="Deck can't find adb, so it can't see Android devices." detail="Install Android Studio or Android's platform tools." />
    }
    if (problem) return <State error title="adb couldn't list the devices" detail={problem.error} />
  }
  const { buttons, more } = startButtons(startable, wants, pick)
  const title = emptyTitle(devices, startable.find((d) => d.id === pick) ?? null)
  // iOS is wanted only on macOS, where iPhones show too: unlocked, since one isn't listed while it's
  // locked or doesn't trust the Mac.
  const plugIn = wants.android && wants.ios
    ? 'Plug in an unlocked iPhone or an Android phone with USB debugging on'
    : wants.ios ? 'Plug in an unlocked iPhone' : 'Plug in an Android phone with USB debugging on'
  const detail = title !== 'No devices connected' && buttons.length > 0
    ? 'Start it below, or choose another device in the ▾ menu.'
    : buttons.length > 0
    ? `${plugIn}, or start one below.`
    : wants.android && wants.ios
      ? `${plugIn}, start an emulator, or boot a simulator.`
      : wants.ios ? `${plugIn}, or boot a simulator in Xcode or with simctl.` : `${plugIn}, or start an emulator.`
  return (
    <State title={title} detail={detail}>
      {buttons.length > 0 && (
        <span className="dp-starts">
          {buttons.map((item) => (
            <button key={item.id} className="button" title={`${item.name}\n${item.error ?? item.detail}`} onMouseDown={keepFocus}
              onClick={(e) => onStart(item, e.currentTarget === document.activeElement)}>
              <span className="dp-start-label">Start {item.name}</span>
            </button>
          ))}
        </span>
      )}
      {more && <span className="cp-state-detail">More in the ▾ menu</span>}
      {wants.android && noAvds && <span className="cp-state-detail">No emulators: make one in Android Studio's Device Manager</span>}
    </State>
  )
}

/** What to run in a terminal, with Copy. */
function Install({ title, command }: { title: string; command: string }) {
  const [copied, setCopied] = useState(false)
  useEffect(() => {
    if (!copied) return
    const timer = setTimeout(() => setCopied(false), 1500)
    return () => clearTimeout(timer)
  }, [copied])
  return (
    <State title={title}>
      <code className="dp-command">{command}</code>
      <button className="button" title="Copy the command" onMouseDown={keepFocus} onClick={() => {
        window.deck.app.copyText(command)
        setCopied(true)
      }}>{copied ? '✓ Copied' : 'Copy'}</button>
    </State>
  )
}

function State({ title, detail, busy, error, children }: { title: string; detail?: string; busy?: boolean; error?: boolean; children?: ReactNode }) {
  return (
    <div className={error ? 'cp-state error' : 'cp-state'} role="status">
      {busy && <span className="cp-spinner" aria-hidden="true" />}
      <strong>{title}</strong>
      {detail && <span className="cp-state-detail">{detail}</span>}
      {children}
    </div>
  )
}

/** Busy, it stays enabled (a disabled button would drop the keyboard) and ignores presses. */
function IconButton({ label, busy, onClick, children }: { label: string; busy?: boolean; onClick(): void; children: ReactNode }) {
  return (
    <button className="cp-icon-button dp-icon" aria-label={label} title={label} aria-disabled={busy || undefined}
      onClick={() => !busy && onClick()}>
      {children}
    </button>
  )
}

const Chevron = () => (
  <svg className="cp-chevron" width="10" height="10" viewBox="0 0 16 16" fill="none" stroke="currentColor" strokeWidth="2"
    strokeLinecap="round" strokeLinejoin="round" aria-hidden="true">
    <path d="M4 6l4 4 4-4" />
  </svg>
)

/** A thrown render (a state main got wrong) costs the panel, never the pane: it says so, with Try
 *  again, and another device or view gets another try by itself. */
class Boundary extends Component<{ resetKey: string; children: ReactNode }, { error: Error | null }> {
  state: { error: Error | null } = { error: null }

  static getDerivedStateFromError(error: unknown) {
    return { error: error instanceof Error ? error : new Error(String(error)) }
  }

  componentDidCatch(error: unknown, info: ErrorInfo) {
    console.error('Device panel:', error, info.componentStack)
  }

  componentDidUpdate(prev: { resetKey: string }) {
    if (this.state.error && prev.resetKey !== this.props.resetKey) this.setState({ error: null })
  }

  render() {
    if (!this.state.error) return this.props.children
    return (
      <div className="device-panel">
        <div className="dp-body">
          <State error title="The device panel couldn't show this" detail={this.state.error.message}>
            <button className="button" onClick={() => this.setState({ error: null })}>Try again</button>
          </State>
        </div>
      </div>
    )
  }
}
