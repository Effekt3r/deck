import { useEffect, useLayoutEffect, useMemo, useRef, useState, type CSSProperties, type KeyboardEvent } from 'react'
import { createPortal } from 'react-dom'
import type { ClaudeSessionSummary } from '@shared/types'
import { errorText } from '../git/format'
import { ago } from '../projects/filter'

interface SessionPickerProps {
  folder: string
  /** The session shown now. */
  current: string
  following: 'newest' | 'pinned'
  /** The button it hangs from. */
  anchor: HTMLElement
  /** `refocus`: give the keyboard back to the button (Esc, a choice), not after a click elsewhere. */
  onClose(refocus: boolean): void
}

const FILTER_FROM = 8

/** Which session the panel shows: "Follow newest session" (main switches to a newer one
 *  once the current one has been quiet a while), or one picked from the folder's
 *  sessions, which stays. Rendered into <body> like the merge-target menu. */
export function SessionPicker({ folder, current, following, anchor, onClose }: SessionPickerProps) {
  const [sessions, setSessions] = useState<ClaudeSessionSummary[] | null>(null)
  const [error, setError] = useState<string | null>(null)
  const [busy, setBusy] = useState(false)
  const [query, setQuery] = useState('')
  const [cursor, setCursor] = useState(0)
  // Placed once: the menu closes when the window resizes.
  const [place] = useState(() => placeBelow(anchor))
  const [now] = useState(() => Date.now())
  const menuRef = useRef<HTMLDivElement>(null)
  const listRef = useRef<HTMLDivElement>(null)
  const filterRef = useRef<HTMLInputElement>(null)
  /** null: follow the newest. */
  const chosen = following === 'pinned' ? current : null

  useEffect(() => {
    let live = true
    window.deck.claude.sessions(folder).then(
      (list) => {
        if (!live) return
        const all = Array.isArray(list) ? list : []
        setSessions(all)
        const i = chosen === null ? -1 : all.findIndex((s) => s.id === chosen)
        setCursor(i < 0 ? 0 : i + 1)
      },
      (err: unknown) => {
        if (!live) return
        setSessions([])
        setError(`Couldn't list the sessions: ${errorText(err)}`)
      },
    )
    return () => {
      live = false
    }
  }, [folder]) // `chosen` only picks the first cursor

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

  const showFilter = (sessions?.length ?? 0) >= FILTER_FROM
  useEffect(() => {
    if (showFilter) filterRef.current?.focus()
  }, [showFilter])

  // null is "Follow newest session", always first.
  const items = useMemo(() => {
    const q = query.trim().toLowerCase()
    const match = (s: ClaudeSessionSummary) => !q || s.title.toLowerCase().includes(q) || s.id.toLowerCase().startsWith(q)
    return [null, ...(sessions ?? []).filter(match)]
  }, [sessions, query])
  const at = Math.min(cursor, items.length - 1)

  useEffect(() => {
    listRef.current?.querySelector(`[data-index="${at}"]`)?.scrollIntoView({ block: 'nearest' })
  }, [at])

  const choose = (id: string | null) => {
    if (busy) return
    if (id === chosen) return onClose(true)
    setBusy(true)
    setError(null)
    window.deck.claude.follow(folder, id).then(
      () => onClose(true), // the session's snapshot arrives as an update
      (err: unknown) => {
        setBusy(false)
        setError(`Couldn't switch: ${errorText(err)}`)
      },
    )
  }

  const onKeyDown = (e: KeyboardEvent<HTMLDivElement>) => {
    switch (e.key) {
      case 'Escape':
        e.stopPropagation()
        onClose(true)
        break
      case 'ArrowDown':
        setCursor(Math.min(items.length - 1, at + 1))
        break
      case 'ArrowUp':
        setCursor(Math.max(0, at - 1))
        break
      case 'Home':
        if (e.target === filterRef.current) return
        setCursor(0)
        break
      case 'End':
        if (e.target === filterRef.current) return
        setCursor(items.length - 1)
        break
      case 'Enter':
        choose(items[at]?.id ?? null)
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
    <div className="cp-menu" ref={menuRef} role="menu" aria-label="Session to show" aria-busy={busy} tabIndex={-1}
      style={place} onKeyDown={onKeyDown}>
      <div className="cpm-title">Claude sessions in this folder</div>
      {showFilter && (
        <input ref={filterRef} className="cpm-filter" value={query} placeholder="Filter sessions" spellCheck={false}
          onChange={(e) => {
            setQuery(e.target.value)
            setCursor(e.target.value.trim() ? 1 : 0) // first match
          }} />
      )}
      <div className="cpm-list" ref={listRef}>
        {items.map((s, i) => {
          const checked = (s?.id ?? null) === chosen
          const showing = s !== null && s.id === current
          return (
            <div key={s?.id ?? ''} data-index={i}>
              <div role="menuitemradio" aria-checked={checked}
                className={`cpm-item${s === null ? ' newest' : ''}${showing ? ' showing' : ''}${i === at ? ' cursor' : ''}`}
                title={s ? `${s.title || 'Untitled session'}\n${s.id}\nLast written ${new Date(s.modified).toLocaleString()}` : undefined}
                onMouseMove={() => i !== at && setCursor(i)}
                onClick={() => choose(s?.id ?? null)}>
                <span className="cpm-check" aria-hidden="true">{checked ? '✓' : ''}</span>
                <span className="cpm-label">{s ? s.title || <span className="cpm-untitled">Untitled · {s.id.slice(0, 8)}</span> : 'Follow newest session'}</span>
                {s && <span className="cpm-hint">{showing ? 'showing · ' : ''}{ago(s.modified, now)} ago</span>}
              </div>
              {s === null && (sessions === null || sessions.length > 0) && <div className="cpm-sep" />}
            </div>
          )
        })}
        {sessions === null && <div className="cpm-note">Loading sessions…</div>}
        {sessions !== null && sessions.length > 0 && items.length === 1 && <div className="cpm-note">No session matches “{query.trim()}”.</div>}
        {sessions !== null && sessions.length === 0 && !error && <div className="cpm-note">No sessions in this folder yet.</div>}
      </div>
      {error && <div className="cpm-error">{error}</div>}
    </div>,
    document.body,
  )
}

/** Under the button, inside the window. */
export function placeBelow(anchor: HTMLElement): CSSProperties {
  const r = anchor.getBoundingClientRect()
  const width = Math.min(340, window.innerWidth - 16)
  const top = r.bottom + 4
  return {
    left: Math.max(8, Math.min(r.left, window.innerWidth - width - 8)),
    top,
    width,
    maxHeight: Math.max(150, window.innerHeight - top - 12),
  }
}
