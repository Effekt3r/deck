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
  /** `refocus`: give the keyboard back to the button (Esc, a choice), not after a click elsewhere. */
  onClose(refocus: boolean): void
}

const STATE_WORDS: Record<DeviceInfo['state'], string> = { ready: '', connecting: 'connecting', unauthorized: 'not allowed yet', offline: 'offline' }

/** Which device the tab shows, from every device adb sees. Rendered into <body> like the session menu. */
export function DeviceMenu({ devices, current, anchor, onPick, onClose }: DeviceMenuProps) {
  const [cursor, setCursor] = useState(() => Math.max(0, devices.findIndex((d) => d.id === current)))
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
      onClose(false)
    }
    const close = () => onClose(false)
    document.addEventListener('pointerdown', onPointerDown, true)
    window.addEventListener('blur', close)
    window.addEventListener('resize', close)
    return () => {
      document.removeEventListener('pointerdown', onPointerDown, true)
      window.removeEventListener('blur', close)
      window.removeEventListener('resize', close)
    }
  }, [anchor, onClose])

  const at = Math.min(cursor, devices.length - 1)
  const choose = (device: DeviceInfo | undefined) => {
    if (device && device.id !== current) onPick(device.id)
    onClose(true)
  }
  const onKeyDown = (e: KeyboardEvent<HTMLDivElement>) => {
    switch (e.key) {
      case 'Escape':
        e.stopPropagation()
        onClose(true)
        break
      case 'ArrowDown':
        setCursor(Math.min(devices.length - 1, at + 1))
        break
      case 'ArrowUp':
        setCursor(Math.max(0, at - 1))
        break
      case 'Home':
        setCursor(0)
        break
      case 'End':
        setCursor(devices.length - 1)
        break
      case 'Enter':
        choose(devices[at])
        break
      case 'Tab':
        onClose(false)
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
              onMouseMove={() => i !== at && setCursor(i)} onClick={() => choose(device)}>
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
