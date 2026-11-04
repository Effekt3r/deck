import { type KeyboardEvent, useEffect, useLayoutEffect, useRef, useState } from 'react'
import { createPortal } from 'react-dom'
import type { DeviceInfo } from '@shared/types'
import { placeBelow } from '../claude/SessionPicker'

interface DeviceMenuProps {
  devices: DeviceInfo[]
  /** The device shown now. */
  current: string | null
  /** The button it hangs from. */
  anchor: HTMLElement
  onPick(id: string): void
  /** How it closed: `back` (Esc, a choice: the keyboard goes back where it was), `tab` (to the button,
   *  and the browser's Tab moves on from there), `leave` (a click elsewhere, a blur, a resize). */
  onClose(how: MenuClose): void
}

export type MenuClose = 'back' | 'tab' | 'leave'

const STATE_WORDS: Record<DeviceInfo['state'], string> = { ready: '', connecting: 'connecting', unauthorized: 'not allowed yet', offline: 'offline' }

/** Which device the tab shows, from every device adb sees. Rendered into <body> like the session menu. */
export function DeviceMenu({ devices, current, anchor, onPick, onClose }: DeviceMenuProps) {
  // The cursor is a device, not a place in the list, which can change under it (one unplugged).
  const [cursorId, setCursorId] = useState<string | null>(() => current ?? devices[0]?.id ?? null)
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

  const at = Math.max(0, devices.findIndex((d) => d.id === cursorId))
  const move = (i: number) => setCursorId(devices[Math.min(Math.max(i, 0), devices.length - 1)]?.id ?? null)
  // Choosing the device shown picks it too: shown as the only one that fits, it becomes the tab's and
  // the project's device.
  const choose = (device: DeviceInfo | undefined) => {
    if (device) onPick(device.id)
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
        move(devices.length - 1)
        break
      case 'Enter':
        choose(devices[at])
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

  return createPortal(
    <div className="cp-menu" ref={menuRef} role="menu" aria-label="Device to show" tabIndex={-1} style={place} onKeyDown={onKeyDown}>
      <div className="cpm-title">Devices</div>
      <div className="cpm-list">
        {devices.map((device, i) => {
          const checked = device.id === current
          const word = STATE_WORDS[device.state]
          return (
            <div key={device.id} role="menuitemradio" aria-checked={checked} className={`cpm-item${i === at ? ' cursor' : ''}`}
              title={`${device.name}\n${device.detail}${word ? ` · ${word}` : ''}`}
              onMouseMove={() => device.id !== cursorId && setCursorId(device.id)} onClick={() => choose(device)}>
              <span className="cpm-check" aria-hidden="true">{checked ? '✓' : ''}</span>
              <span className="cpm-label">{device.name}</span>
              <span className="cpm-hint">{word || device.detail}</span>
            </div>
          )
        })}
        {devices.length === 0 && <div className="cpm-note">No devices connected.</div>}
      </div>
    </div>,
    document.body,
  )
}
