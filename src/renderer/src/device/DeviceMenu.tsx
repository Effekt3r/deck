import { type KeyboardEvent, type ReactNode, useEffect, useLayoutEffect, useRef, useState } from 'react'
import { createPortal } from 'react-dom'
import type { DeviceInfo, StartableDevice } from '@shared/types'
import { placeBelow } from '../claude/SessionPicker'
import { type MenuEntry, menuEntries, startHint } from './menu'

interface DeviceMenuProps {
  devices: DeviceInfo[]
  /** What can be started, those that fit the tab first. */
  startable: StartableDevice[]
  /** Say the SDK has no AVDs (only where emulators fit the tab). */
  noAvds: boolean
  /** The device shown now (or starting). */
  current: string | null
  /** The device on screen, listed and not gone, for Stop; null otherwise. */
  shown: DeviceInfo | null
  /** The button it hangs from. */
  anchor: HTMLElement
  onPick(id: string): void
  onStart(device: StartableDevice): void
  onStop(device: DeviceInfo): void
  /** How it closed: `back` (Esc, a choice: the keyboard goes back where it was), `tab` (to the button,
   *  and the browser's Tab moves on from there), `leave` (a click elsewhere, a blur, a resize). */
  onClose(how: MenuClose): void
}

export type MenuClose = 'back' | 'tab' | 'leave'

const STATE_WORDS: Record<DeviceInfo['state'], string> = { ready: '', booting: 'starting', connecting: 'connecting', unauthorized: 'not allowed yet', offline: 'offline' }

/** Which device the tab shows, from every device Deck sees; what can be started; and Stop for an
 *  emulator or a simulator on screen. Rendered into <body> like the session menu. */
export function DeviceMenu({ devices, startable, noAvds, current, shown, anchor, onPick, onStart, onStop, onClose }: DeviceMenuProps) {
  const entries = menuEntries(devices, startable, shown)
  // The cursor is an item, not a place in the list, which can change under it (one unplugged).
  const [cursor, setCursor] = useState<string | null>(() => (current ? `device:${current}` : (entries[0]?.key ?? null)))
  // Placed once: the menu closes when the window resizes.
  const [place] = useState(() => placeBelow(anchor))
  const menuRef = useRef<HTMLDivElement>(null)

  useLayoutEffect(() => {
    menuRef.current?.focus()
  }, [])

  useEffect(() => {
    const onPointerDown = (e: PointerEvent) => {
      const t = e.target as Node | null
      if (t && (menuRef.current?.contains(t) || anchor.contains(t))) return // the button toggles by itself
      onClose('leave')
    }
    const close = () => onClose('leave')
    document.addEventListener('pointerdown', onPointerDown, true)
    window.addEventListener('blur', close)
    window.addEventListener('resize', close)
    return () => {
      document.removeEventListener('pointerdown', onPointerDown, true)
      window.removeEventListener('blur', close)
      window.removeEventListener('resize', close)
    }
  }, [anchor, onClose])

  const at = Math.max(0, entries.findIndex((e) => e.key === cursor))
  const move = (i: number) => setCursor(entries[Math.min(Math.max(i, 0), entries.length - 1)]?.key ?? null)
  // Choosing the device shown picks it too: shown as the only one that fits, it becomes the tab's and
  // the project's device. Choosing one to start picks it as well (DevicePanel's start).
  const choose = (entry: MenuEntry | undefined) => {
    if (entry?.type === 'device') onPick(entry.device.id)
    else if (entry?.type === 'start') onStart(entry.device)
    else if (entry?.type === 'stop') onStop(entry.device)
    onClose('back')
  }
  const onKeyDown = (e: KeyboardEvent<HTMLDivElement>) => {
    switch (e.key) {
      case 'Escape':
        e.stopPropagation()
        onClose('back')
        break
      case 'ArrowDown':
        move(at + 1)
        break
      case 'ArrowUp':
        move(at - 1)
        break
      case 'Home':
        move(0)
        break
      case 'End':
        move(entries.length - 1)
        break
      case 'Enter':
        choose(entries[at])
        break
      case 'Tab':
        // The button takes the keyboard now, and the browser's own Tab moves on from there.
        onClose('tab')
        return
      default:
        return
    }
    e.preventDefault()
  }

  const row = (entry: MenuEntry, i: number): ReactNode => {
    const className = `cpm-item${i === at ? ' cursor' : ''}`
    const hover = () => entry.key !== cursor && setCursor(entry.key)
    if (entry.type === 'device') {
      const { device } = entry
      const checked = device.id === current
      const word = STATE_WORDS[device.state]
      return (
        <div key={entry.key} role="menuitemradio" aria-checked={checked} className={className}
          title={`${device.name}\n${device.detail}${word ? ` · ${word}` : ''}`} onMouseMove={hover} onClick={() => choose(entry)}>
          <span className="cpm-check" aria-hidden="true">{checked ? '✓' : ''}</span>
          <span className="cpm-label">{device.name}</span>
          <span className="cpm-hint">{word || device.detail}</span>
        </div>
      )
    }
    if (entry.type === 'start') {
      const { device } = entry
      return (
        <div key={entry.key} role="menuitem" className={className} title={`Start ${device.name}\n${device.error ?? device.detail}`}
          onMouseMove={hover} onClick={() => choose(entry)}>
          <span className="cpm-check" aria-hidden="true">▶</span>
          <span className="cpm-label">{device.name}</span>
          <span className="cpm-hint">{startHint(device)}</span>
        </div>
      )
    }
    return (
      <div key={entry.key} role="menuitem" className={className} onMouseMove={hover} onClick={() => choose(entry)}>
        <span className="cpm-check" aria-hidden="true" />
        <span className="cpm-label">Stop {entry.device.name}</span>
      </div>
    )
  }

  return createPortal(
    <div className="cp-menu" ref={menuRef} role="menu" aria-label="Device to show" tabIndex={-1} style={place} onKeyDown={onKeyDown}>
      <div className="cpm-title">Devices</div>
      <div className="cpm-list">
        {entries.map((entry, i) => entry.type === 'device' && row(entry, i))}
        {devices.length === 0 && <div className="cpm-note">No devices connected.</div>}
        {(startable.length > 0 || noAvds) && <div className="cpm-title">Start</div>}
        {entries.map((entry, i) => entry.type === 'start' && row(entry, i))}
        {noAvds && <div className="cpm-note">No emulators: make one in Android Studio's Device Manager</div>}
        {entries.at(-1)?.type === 'stop' && <div className="cpm-sep" />}
        {entries.map((entry, i) => entry.type === 'stop' && row(entry, i))}
      </div>
    </div>,
    document.body,
  )
}
