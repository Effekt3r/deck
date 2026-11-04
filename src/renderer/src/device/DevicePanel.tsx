import { Component, type ErrorInfo, type MouseEvent, type ReactNode, useCallback, useEffect, useLayoutEffect, useRef, useState } from 'react'
import type { DeviceInfo, DeviceList } from '@shared/types'
import { errorText } from '../git/format'
import { BackIcon, CameraIcon, Caret, HomeIcon, PowerIcon, RecentsIcon } from '../icons'
import { DeviceMenu, type MenuClose } from './DeviceMenu'
import { DeviceScreen, type ScreenHandle } from './DeviceScreen'
import { KEYCODE } from './keys'
import type { PanelView } from './pick'
import '../claude/panel.css'
import './device.css'

interface DevicePanelProps {
  /** A device (maybe gone for now), the devices to choose from, or none: the panel was asked for. */
  view: PanelView
  /** Every device adb sees, for the menu. */
  devices: DeviceInfo[]
  problem: DeviceList['problem']
  /** The devices aren't known yet: adb is starting, or they're still saying what they are. */
  looking: boolean
  /** Unfolded: one flag for the window, so every tab's panel folds together. */
  open: boolean
  onToggle(): void
  /** The tab is in front and the window can be seen: the screen may stream. */
  visible: boolean
  /** Claude runs in the tab: the screenshot button shows. */
  claudeRuns: boolean
  onPick(id: string): void
  /** Types text into the tab's terminal: the screenshot's path. */
  onInsert(text: string): void
  /** A device was chosen from the keyboard and its button went with the chooser: the tab gives the
   *  keyboard to its terminal. */
  onFocusLost(): void
}

/** Clicks in the header and the chooser leave the keyboard where it was. (The device menu takes it
 *  itself, and gives it back to its button.) */
const keepFocus = (e: MouseEvent) => e.preventDefault()

/** A device's screen at the top of the right pane: a header (fold, the device menu, Android's
 *  buttons, the screenshot), then the screen, a choice of devices, or why there's none. A thrown
 *  render costs the panel only. */
export function DevicePanel(props: DevicePanelProps) {
  const shown = props.view.kind === 'device' ? props.view.device.id : props.view.kind
  return (
    <Boundary resetKey={shown}>
      <PanelBody {...props} />
    </Boundary>
  )
}

function PanelBody({ view, devices, problem, looking, open, onToggle, visible, claudeRuns, onPick, onInsert, onFocusLost }: DevicePanelProps) {
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
  const gone = view.kind === 'device' && view.gone
  const ready = device !== null && device.state === 'ready' && !gone
  // A failed screenshot's error goes with its device, and with Claude.
  useEffect(() => {
    setError(null)
  }, [device?.id, claudeRuns])
  let message: string | null = null
  if (device && gone) message = `${device.name} disconnected`
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

  const title = device ? device.name : view.kind === 'choose' ? 'Choose a device' : 'Devices'
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
        <span className="cp-spacer" />
        {open && ready && (
          <span className="dp-buttons">
            <IconButton label="Back" onClick={() => press(KEYCODE.BACK)}><BackIcon /></IconButton>
            <IconButton label="Home" onClick={() => press(KEYCODE.HOME)}><HomeIcon /></IconButton>
            <IconButton label="Recent apps" onClick={() => press(KEYCODE.APP_SWITCH)}><RecentsIcon /></IconButton>
            <IconButton label="Power" onClick={() => press(KEYCODE.POWER)}><PowerIcon /></IconButton>
            {claudeRuns && (
              <IconButton label="Add screenshot to Claude" busy={busy} onClick={() => void screenshot()}><CameraIcon /></IconButton>
            )}
          </span>
        )}
      </header>
      {open && shownError && <div className="dp-error" role="alert">{shownError}</div>}
      {open && (
        <div className="dp-body">
          {device && (
            <DeviceScreen key={device.id} deviceId={device.id} name={device.name} live={visible && ready} message={message} handle={screen} />
          )}
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
          {view.kind === 'none' && <Nothing problem={problem} looking={looking} />}
        </div>
      )}
      {menuAnchor && (
        <DeviceMenu devices={devices} current={device?.id ?? null} anchor={menuAnchor} onPick={onPick} onClose={closeMenu} />
      )}
    </div>
  )
}

/** The panel was asked for and there's nothing to show. */
function Nothing({ problem, looking }: { problem: DeviceList['problem']; looking: boolean }) {
  if (looking) return <State busy title="Looking for devices…" />
  if (problem === 'no-adb') {
    return <State title="Deck can't find adb, so it can't see Android devices." detail="Install Android Studio or Android's platform tools." />
  }
  if (problem) return <State error title="adb couldn't list the devices" detail={problem.error} />
  return <State title="No devices connected" detail="Plug in an Android phone with USB debugging on, or start an emulator." />
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
