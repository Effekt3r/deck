import { useEffect, useRef, useState, type PointerEvent as ReactPointerEvent } from 'react'

interface SplitterProps {
  /** The line's direction: 'vertical' sits between left and right and drags sideways. */
  orientation: 'vertical' | 'horizontal'
  label: string
  /** The size being dragged, read when a drag starts (px). */
  getSize(): number
  /** 1: dragging right/down grows the size; -1: it shrinks it. */
  direction?: 1 | -1
  /** While dragging, with start size + movement; the owner clamps. */
  onResize(size: number): void
  /** The drag ended; the owner clamps and stores the size. */
  onResizeEnd(size: number): void
  /** Double-click. */
  onReset?(): void
}

/** A 1 px line with a wider grab area. Drags with pointer capture, so the pointer can
 *  leave the line (or cross the terminal) without losing it. It never takes focus:
 *  the terminal keeps the keyboard. */
export function Splitter({ orientation, label, getSize, direction = 1, onResize, onResizeEnd, onReset }: SplitterProps) {
  const [dragging, setDragging] = useState(false)
  const drag = useRef<{ pointer: number; from: number; size: number; last: number } | null>(null)
  const sideways = orientation === 'vertical'
  const bodyClass = sideways ? 'resizing-col' : 'resizing-row'

  // Unmounted mid-drag (the tab switched, the panel was hidden): don't leave the cursor stuck.
  useEffect(() => () => {
    if (drag.current) document.body.classList.remove(bodyClass)
  }, [bodyClass])

  const finish = (el: HTMLElement) => {
    const d = drag.current
    if (!d) return
    drag.current = null
    if (el.hasPointerCapture(d.pointer)) el.releasePointerCapture(d.pointer)
    document.body.classList.remove(bodyClass)
    setDragging(false)
    onResizeEnd(d.last)
  }

  const onPointerDown = (e: ReactPointerEvent<HTMLDivElement>) => {
    if (e.button !== 0 || drag.current) return
    e.preventDefault()
    const size = getSize()
    drag.current = { pointer: e.pointerId, from: sideways ? e.clientX : e.clientY, size, last: size }
    e.currentTarget.setPointerCapture(e.pointerId)
    document.body.classList.add(bodyClass)
    setDragging(true)
  }

  const onPointerMove = (e: ReactPointerEvent<HTMLDivElement>) => {
    const d = drag.current
    if (!d || e.pointerId !== d.pointer) return
    d.last = d.size + direction * ((sideways ? e.clientX : e.clientY) - d.from)
    onResize(d.last)
  }

  return (
    <div className={dragging ? 'splitter dragging' : 'splitter'} role="separator" aria-orientation={orientation}
      aria-label={label} title={onReset ? `${label} (double-click to reset)` : label}
      onMouseDown={(e) => e.preventDefault()}
      onPointerDown={onPointerDown}
      onPointerMove={onPointerMove}
      onPointerUp={(e) => finish(e.currentTarget)}
      onPointerCancel={(e) => finish(e.currentTarget)}
      onLostPointerCapture={(e) => finish(e.currentTarget)}
      onDoubleClick={onReset} />
  )
}

/** A stored size in px; the fallback when storage is unavailable or holds nothing usable. */
export function loadSize(key: string, fallback: number): number {
  try {
    const value = Number(localStorage.getItem(key))
    return Number.isFinite(value) && value > 0 ? value : fallback
  } catch {
    return fallback
  }
}

export function saveSize(key: string, px: number | null): void {
  try {
    if (px === null) localStorage.removeItem(key)
    else localStorage.setItem(key, String(Math.round(px)))
  } catch {
    // Storage unavailable: the size lasts until the window closes.
  }
}
