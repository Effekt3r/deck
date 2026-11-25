import { type MouseEvent, type PointerEvent as ReactPointerEvent, useEffect, useLayoutEffect, useRef, useState } from 'react'
import type { Platform } from '@shared/types'
import { CloseIcon, PlusIcon } from '../icons'
import { dropIndex, edgeScroll, shownShift, slideFor, type Slot } from './drag'
import type { Tab } from './tabs'
import { tabTitle } from './title'
import type { TabStatus } from './useTabStatus'

interface Props {
  tabs: Tab[]
  active: string
  platform: Platform
  /** Claude's status, for the tabs whose Claude Deck knows. */
  statuses: ReadonlyMap<string, TabStatus>
  onActivate(id: string): void
  onClose(id: string): void
  /** A terminal tab dropped at place `index` (1 or more: Projects stays first). */
  onMove(id: string, index: number): void
  /** A shell tab in the active tab's folder. */
  onNew(): void
}

/** A press on a terminal tab. It becomes a drag once it moves more than DRAG_START sideways. */
interface Press {
  id: string
  pointerId: number
  /** The pressed tab: it captures the pointer once the drag starts. */
  el: HTMLElement
  startX: number
  /** The strip's scroll at the press, so a drag that scrolls the strip carries the tab along. */
  startScroll: number
  /** The pointer's latest x. */
  x: number
  /** Set when the drag starts: every tab's place in the strip. */
  slots: Slot[] | null
  /** The dragged tab's index in `slots`. */
  from: number
}

/** What the strip shows while a tab is dragged. */
interface Drag {
  id: string
  from: number
  /** Where it lands if dropped now. */
  to: number
  /** How far it is drawn from its place, kept within the strip's tabs. */
  dx: number
  width: number
}

/** Pixels a press moves sideways before it's a drag; less is a click. */
const DRAG_START = 4

// Clicking chrome must not take focus from the terminal; this also stops
// middle-click autoscroll.
const keepFocus = (e: MouseEvent) => e.preventDefault()

/** The window's title bar: macOS traffic lights on the left, Windows caption
 *  buttons on the right; the empty area drags the window. Terminal tabs can be
 *  dragged into another order (the Projects tab stays first). */
export function TabBar({ tabs, active, platform, statuses, onActivate, onClose, onMove, onNew }: Props) {
  const stripRef = useRef<HTMLDivElement>(null)
  const pressRef = useRef<Press | null>(null)
  const dragRef = useRef<Drag | null>(null)
  const [drag, setDrag] = useState<Drag | null>(null)
  // The window listeners below are added once; they call the latest callbacks through this.
  const latest = useRef({ onActivate, onMove })
  // Set inside the listeners effect below: cancels a drag in progress.
  const cancelRef = useRef<() => void>(() => {})
  useEffect(() => {
    latest.current = { onActivate, onMove }
  })

  // The tabs' order: a drag ends when it changes under it (below), and a moved front tab is kept in view.
  const order = tabs.map((t) => t.id).join('\n')

  useEffect(() => {
    stripRef.current?.querySelector('.tab.active')?.scrollIntoView({ block: 'nearest', inline: 'nearest' })
  }, [active, order])

  useEffect(() => {
    let frame = 0
    let swallowEsc = false
    const show = (next: Drag | null) => {
      dragRef.current = next
      setDrag(next)
    }
    /** The dragged tab follows the pointer and the strip's scroll: where would it land? */
    const follow = (p: Press) => {
      const strip = stripRef.current
      if (!strip || !p.slots) return
      const slot = p.slots[p.from]
      const dx = p.x - p.startX + (strip.scrollLeft - p.startScroll)
      show({ id: p.id, from: p.from, to: dropIndex(p.slots, p.from, slot.left + slot.width / 2 + dx), dx: shownShift(p.slots, p.from, dx), width: slot.width })
    }
    /** Near the strip's ends, scrolls it every frame while the pointer stays there. */
    const scroll = () => {
      frame = 0
      const p = pressRef.current
      const strip = stripRef.current
      if (!p?.slots || !strip) return
      const rect = strip.getBoundingClientRect()
      const step = edgeScroll(p.x, rect.left, rect.right)
      if (step === 0) return
      const before = strip.scrollLeft
      strip.scrollLeft += step
      if (strip.scrollLeft === before) return // already at that end
      follow(p)
      frame = requestAnimationFrame(scroll)
    }
    /** Ends a press: a drag drops where it would land (`drop`), or goes back. */
    const end = (drop: boolean) => {
      const p = pressRef.current
      pressRef.current = null
      cancelAnimationFrame(frame)
      frame = 0
      if (!p?.slots) return
      document.body.classList.remove('dragging-tab')
      if (p.el.hasPointerCapture(p.pointerId)) p.el.releasePointerCapture(p.pointerId)
      const d = dragRef.current
      show(null)
      if (drop && d && d.to !== d.from) latest.current.onMove(d.id, d.to)
    }
    cancelRef.current = () => {
      if (pressRef.current?.slots) end(false)
    }
    const onPointerMove = (e: PointerEvent) => {
      const p = pressRef.current
      if (!p || e.pointerId !== p.pointerId) return
      // The button was let go where this window didn't hear it; like a lost pointer, the tab goes back.
      if ((e.buttons & 1) === 0) return end(false)
      p.x = e.clientX
      if (!p.slots) {
        if (Math.abs(p.x - p.startX) <= DRAG_START) return
        const els = [...(stripRef.current?.querySelectorAll<HTMLElement>(':scope > .tab') ?? [])]
        const from = els.indexOf(p.el)
        if (from < 1) {
          pressRef.current = null
          return
        }
        p.slots = els.map((el) => ({ left: el.offsetLeft, width: el.offsetWidth }))
        p.from = from
        p.el.setPointerCapture(p.pointerId)
        document.body.classList.add('dragging-tab')
        latest.current.onActivate(p.id) // as in browsers, the dragged tab comes to the front
      }
      follow(p)
      if (!frame) frame = requestAnimationFrame(scroll)
    }
    const onPointerUp = (e: PointerEvent) => {
      if (pressRef.current?.pointerId === e.pointerId) end(true)
    }
    const onPointerCancel = (e: PointerEvent) => {
      if (pressRef.current?.pointerId === e.pointerId) end(false)
    }
    // Captured before xterm sees it: an Esc reaching a Claude tab would interrupt Claude.
    const onKeyDown = (e: KeyboardEvent) => {
      if (e.key !== 'Escape') return
      // A lost keyup (the window lost focus while Esc was held) must not swallow a later, separate
      // Esc press: only the held key's own repeats are ever swallowed.
      if (!pressRef.current?.slots && !e.repeat) swallowEsc = false
      if (pressRef.current?.slots) {
        e.preventDefault()
        e.stopPropagation()
        swallowEsc = true
        end(false)
      } else if (swallowEsc && e.repeat) {
        // The key that cancelled a drag is still held; its repeats mustn't reach Claude either.
        e.preventDefault()
        e.stopPropagation()
      }
    }
    const onKeyUp = (e: KeyboardEvent) => {
      if (e.key === 'Escape') swallowEsc = false
    }
    const onBlur = () => end(false)
    window.addEventListener('pointermove', onPointerMove)
    window.addEventListener('pointerup', onPointerUp)
    window.addEventListener('pointercancel', onPointerCancel)
    window.addEventListener('keydown', onKeyDown, true)
    window.addEventListener('keyup', onKeyUp, true)
    window.addEventListener('blur', onBlur)
    return () => {
      window.removeEventListener('pointermove', onPointerMove)
      window.removeEventListener('pointerup', onPointerUp)
      window.removeEventListener('pointercancel', onPointerCancel)
      window.removeEventListener('keydown', onKeyDown, true)
      window.removeEventListener('keyup', onKeyUp, true)
      window.removeEventListener('blur', onBlur)
      cancelAnimationFrame(frame)
      document.body.classList.remove('dragging-tab')
    }
  }, [])

  // A tab opened or closed during a drag (Cmd+W, a shell that exits, --open) moves the others
  // under it: the drag ends where it started.
  useLayoutEffect(() => {
    cancelRef.current()
  }, [order])

  const press = (e: ReactPointerEvent<HTMLDivElement>, id: string) => {
    if (e.button !== 0 || pressRef.current?.slots || (e.target as HTMLElement).closest('.tab-close')) return
    pressRef.current = {
      id,
      pointerId: e.pointerId,
      el: e.currentTarget,
      startX: e.clientX,
      startScroll: stripRef.current?.scrollLeft ?? 0,
      x: e.clientX,
      slots: null,
      from: -1,
    }
  }

  return (
    <header className="tabbar" data-platform={platform}>
      <div className={drag ? 'tab-strip reordering' : 'tab-strip'} role="tablist" ref={stripRef}>
        {tabs.map((tab, i) => {
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
          const status = statuses.get(tab.id)
          // Deck draws the status itself where it knows it: Claude's own glyph stands still in
          // background tabs (Claude animates it only with focus).
          const title = tabTitle(tab, platform, { glyph: status === undefined })
          const tip = status?.mark ? `${title}\n${status.text}` : title
          const dragged = drag?.id === tab.id
          const slide = drag === null ? 0 : dragged ? drag.dx : slideFor(i, drag.from, drag.to, drag.width)
          const classes = ['tab', isActive && 'active', tab.exited !== undefined && 'exited', dragged && 'dragging', status?.mark && `mark-${status.mark}`].filter(Boolean).join(' ')
          return (
            <div key={tab.id} role="tab" aria-selected={isActive} className={classes} title={tip}
              style={slide ? { transform: `translateX(${slide}px)` } : undefined}
              onMouseDown={keepFocus}
              onPointerDown={(e) => press(e, tab.id)}
              onClick={() => onActivate(tab.id)}
              onAuxClick={(e) => e.button === 1 && onClose(tab.id)}>
              {status?.mark && <span className={`tab-mark ${status.mark}`} role="img" aria-label={status.text} />}
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
