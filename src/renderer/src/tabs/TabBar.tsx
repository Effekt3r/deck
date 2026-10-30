import { useEffect, useRef, type MouseEvent } from 'react'
import type { Platform } from '@shared/types'
import { CloseIcon, PlusIcon } from '../icons'
import type { Tab } from './tabs'
import { tabTitle } from './title'

interface Props {
  tabs: Tab[]
  active: string
  platform: Platform
  onActivate(id: string): void
  onClose(id: string): void
  /** A shell tab in the active tab's folder. */
  onNew(): void
}

// Clicking chrome must not take focus from the terminal; this also stops
// middle-click autoscroll.
const keepFocus = (e: MouseEvent) => e.preventDefault()

/** The window's title bar: macOS traffic lights on the left, Windows caption
 *  buttons on the right; the empty area drags the window. */
export function TabBar({ tabs, active, platform, onActivate, onClose, onNew }: Props) {
  const stripRef = useRef<HTMLDivElement>(null)

  useEffect(() => {
    stripRef.current?.querySelector('.tab.active')?.scrollIntoView({ block: 'nearest', inline: 'nearest' })
  }, [active, tabs.length])

  return (
    <header className="tabbar" data-platform={platform}>
      <div className="tab-strip" role="tablist" ref={stripRef}>
        {tabs.map((tab) => {
          const isActive = tab.id === active
          if (tab.kind === 'projects') {
            return (
              <div key={tab.id} role="tab" aria-selected={isActive} title="Projects"
                className={isActive ? 'tab tab-projects active' : 'tab tab-projects'}
                onMouseDown={keepFocus} onClick={() => onActivate(tab.id)}>
                <span className="tab-home" aria-hidden="true">⌂</span>
                <span className="tab-label">Projects</span>
              </div>
            )
          }
          const title = tabTitle(tab, platform)
          const classes = ['tab', isActive && 'active', tab.exited !== undefined && 'exited'].filter(Boolean).join(' ')
          return (
            <div key={tab.id} role="tab" aria-selected={isActive} className={classes} title={title}
              onMouseDown={keepFocus}
              onClick={() => onActivate(tab.id)}
              onAuxClick={(e) => e.button === 1 && onClose(tab.id)}>
              <span className="tab-label">{title}</span>
              <button className="tab-close" aria-label="Close tab" tabIndex={-1}
                onClick={(e) => {
                  e.stopPropagation()
                  onClose(tab.id)
                }}>
                <CloseIcon size={10} />
              </button>
            </div>
          )
        })}
      </div>
      <button className="tab-new" title="New tab" aria-label="New tab" tabIndex={-1} onMouseDown={keepFocus} onClick={onNew}>
        <PlusIcon size={13} />
      </button>
    </header>
  )
}
