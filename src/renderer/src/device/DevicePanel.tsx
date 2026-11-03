import { Component, type ErrorInfo, type MouseEvent, type ReactNode, useCallback, useLayoutEffect, useRef, useState } from 'react'
import type { DeviceInfo, DeviceList } from '@shared/types'
import { errorText } from '../git/format'
import { BackIcon, CameraIcon, Caret, HomeIcon, PowerIcon, RecentsIcon } from '../icons'
import { DeviceMenu } from './DeviceMenu'
import { DeviceScreen, type ScreenHandle } from './DeviceScreen'
import { KEYCODE } from './keys'
import type { PanelView } from './pick'
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
}

/** Clicking the header's text leaves the keyboard where it was. */
const keepFocus = (e: MouseEvent) => {
  if (!(e.target as Element).closest('button')) e.preventDefault()
}

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

function PanelBody({ view, devices, problem, looking, open, onToggle, visible, claudeRuns, onPick, onInsert }: DevicePanelProps) {
  const [menuAnchor, setMenuAnchor] = useState<HTMLElement | null>(null)
  const [error, setError] = useState<string | null>(null)
  const [busy, setBusy] = useState(false)
  const screen = useRef<ScreenHandle>(null)
  const anchorRef = useRef<HTMLElement | null>(null)
  useLayoutEffect(() => {
    anchorRef.current = menuAnchor
  }, [menuAnchor])
  const closeMenu = useCallback((refocus: boolean) => {
    const anchor = anchorRef.current
    setMenuAnchor(null)
    if (refocus) anchor?.focus()
  }, [])

  const device = view.kind === 'device' ? view.device : null
  const gone = view.kind === 'device' && view.gone
  const ready = device !== null && device.state === 'ready' && !gone
  let message: string | null = null
  if (device && gone) message = `${device.name} disconnected`
  else if (device?.state === 'unauthorized') message = `Allow USB debugging on ${device.name}: check its screen.`
  else if (device?.state === 'offline') message = `${device.name} isn't answering. Unplug it and plug it back in.`
  else if (device?.state === 'connecting') message = `${device.name} is connecting…`

  const press = (keycode: number) => {
    if (device) window.deck.devices.input(device.id, { type: 'key', keycode, meta: 0 })
  }
  const screenshot = async () => {
    setBusy(true)
    setError(null)
    try {
      const png = await screen.current?.screenshot()
      if (!png) throw new Error('There is no picture yet.')
      const result = await window.deck.devices.screenshot(png)
      if ('text' in result) onInsert(result.text)
      else setError(result.error)
    } catch (err) {
      setError(errorText(err))
    } finally {
      setBusy(false)
    }
  }

  const title = device ? device.name : view.kind === 'choose' ? 'Choose a device' : 'Devices'
  return (
    <div className={open ? 'device-panel' : 'device-panel folded'}>
      <header className="dp-head" onMouseDown={keepFocus}>
        <button className="cp-section-head dp-fold" aria-expanded={open} aria-label="Device panel"
          title={open ? 'Fold the device panel' : 'Unfold the device panel'} onClick={onToggle}>
          <Caret />
        </button>
        <button className="dp-device" aria-haspopup="menu" aria-expanded={menuAnchor !== null} title="The device this tab shows"
          onClick={(e) => {
            const button = e.currentTarget
            setMenuAnchor((a) => (a ? null : button))
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
              <IconButton label="Add screenshot to Claude" disabled={busy} onClick={() => void screenshot()}><CameraIcon /></IconButton>
            )}
          </span>
        )}
      </header>
      {open && error && <div className="dp-error" role="alert">{error}</div>}
      {open && (
        <div className="dp-body">
          {device && (
            <DeviceScreen key={device.id} deviceId={device.id} name={device.name} live={visible && ready} message={message} handle={screen} />
          )}
          {view.kind === 'choose' && (
            <div className="dp-choose">
              <span className="dp-choose-title">Which device should this project show?</span>
              {view.devices.map((d) => (
                <button key={d.id} className="dp-choice" onClick={() => onPick(d.id)}>
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
  if (looking) return <State title="Looking for devices…" />
  if (problem === 'no-adb') {
    return <State title="Deck can't find adb, so it can't see Android devices." detail="Install Android Studio or Android's platform tools." />
  }
  if (problem) return <State error title="adb couldn't list the devices" detail={problem.error} />
  return <State title="No devices connected" detail="Plug in an Android phone with USB debugging on, or start an emulator." />
}

function State({ title, detail, error }: { title: string; detail?: string; error?: boolean }) {
  return (
    <div className={error ? 'cp-state error' : 'cp-state'} role="status">
      <strong>{title}</strong>
      {detail && <span className="cp-state-detail">{detail}</span>}
    </div>
  )
}

/** Pressing one leaves the keyboard where it was: on the device's screen or in the terminal. */
function IconButton({ label, disabled, onClick, children }: { label: string; disabled?: boolean; onClick(): void; children: ReactNode }) {
  return (
    <button className="cp-icon-button dp-icon" aria-label={label} title={label} disabled={disabled}
      onMouseDown={(e) => e.preventDefault()} onClick={onClick}>
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

/** A thrown render (a state main got wrong) costs the panel, never the pane: it disappears, and
 *  another device or view gets another try. */
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
    return this.state.error ? null : this.props.children
  }
}
