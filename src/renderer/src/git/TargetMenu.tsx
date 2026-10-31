import { useEffect, useLayoutEffect, useMemo, useRef, useState, type CSSProperties, type KeyboardEvent } from 'react'
import { createPortal } from 'react-dom'
import type { GitSummary } from '@shared/types'
import { errorText } from './format'

interface TargetMenuProps {
  repo: string
  branch: string
  target: GitSummary['target']
  /** The button it hangs from. */
  anchor: HTMLElement
  /** `refocus`: give the keyboard back to the button (Esc, a choice), not after a click elsewhere. */
  onClose(refocus: boolean): void
}

const SOURCE: Record<NonNullable<GitSummary['target']>['source'], string> = {
  auto: 'auto',
  'git-config': 'git config',
  deck: 'pinned in Deck',
}
const FILTER_FROM = 8

/** Pick where `branch` merges next: Automatic (Deck's rules, or git config's
 *  branch.<b>.mergeTarget) or a ref pinned in Deck. Rendered into <body>: the
 *  panel clips its content. */
export function TargetMenu({ repo, branch, target, anchor, onClose }: TargetMenuProps) {
  const [refs, setRefs] = useState<string[] | null>(null)
  const [error, setError] = useState<string | null>(null)
  const [busy, setBusy] = useState(false)
  const [query, setQuery] = useState('')
  const [cursor, setCursor] = useState(0)
  // Placed once: the menu closes when the window resizes.
  const [place] = useState(() => placeBelow(anchor))
  const menuRef = useRef<HTMLDivElement>(null)
  const listRef = useRef<HTMLDivElement>(null)
  const filterRef = useRef<HTMLInputElement>(null)
  const pinned = target?.source === 'deck' ? target.ref : null

  useEffect(() => {
    let live = true
    window.deck.git.targets(repo).then(
      (all) => {
        if (!live) return
        const list = all.filter((r) => r !== branch) // not a target for itself
        setRefs(list)
        const i = pinned === null ? -1 : list.indexOf(pinned)
        setCursor(i < 0 ? 0 : i + 1)
      },
      (err: unknown) => {
        if (!live) return
        setRefs([])
        setError(`Couldn't list branches: ${errorText(err)}`)
      },
    )
    return () => {
      live = false
    }
  }, [repo, branch]) // `pinned` only picks the first cursor

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

  const showFilter = (refs?.length ?? 0) >= FILTER_FROM
  useEffect(() => {
    if (showFilter) filterRef.current?.focus()
  }, [showFilter])

  // null is Automatic, always first.
  const items = useMemo(() => {
    const q = query.trim().toLowerCase()
    return [null, ...(refs ?? []).filter((r) => !q || r.toLowerCase().includes(q))]
  }, [refs, query])
  const at = Math.min(cursor, items.length - 1)

  useEffect(() => {
    listRef.current?.querySelector(`[data-index="${at}"]`)?.scrollIntoView({ block: 'nearest' })
  }, [at])

  const choose = (ref: string | null) => {
    if (busy) return
    if (ref === pinned) return onClose(true)
    setBusy(true)
    setError(null)
    window.deck.git.setTarget(repo, branch, ref).then(
      () => onClose(true), // main refreshes the repo; the new target arrives with the update
      (err: unknown) => {
        setBusy(false)
        setError(`Couldn't change the target: ${errorText(err)}`)
      },
    )
  }

  const onKeyDown = (e: KeyboardEvent<HTMLDivElement>) => {
    switch (e.key) {
      case 'Escape':
        e.stopPropagation() // the panel would close the commit details too
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
        choose(items[at])
        break
      case 'Tab':
        onClose(false)
        return
      default:
        return
    }
    e.preventDefault()
  }

  const hintFor = (ref: string | null) => {
    if (ref === null) return target && target.source !== 'deck' ? `${target.ref} · ${SOURCE[target.source]}` : pinned ? '' : 'none found'
    return ref === target?.ref ? SOURCE[target.source] : ''
  }

  return createPortal(
    <div className="target-menu" ref={menuRef} role="menu" aria-label={`Merge target for ${branch}`} aria-busy={busy}
      tabIndex={-1} style={place} onKeyDown={onKeyDown}>
      <div className="tm-title">Merge target for <b>{branch}</b></div>
      {showFilter && (
        <input ref={filterRef} className="tm-filter" value={query} placeholder="Filter branches" spellCheck={false}
          onChange={(e) => {
            setQuery(e.target.value)
            setCursor(e.target.value.trim() ? 1 : 0) // first match
          }} />
      )}
      <div className="tm-list" ref={listRef}>
        {items.map((ref, i) => (
          <div key={ref ?? ''} data-index={i}>
            <div role="menuitemradio" aria-checked={ref === pinned}
              className={`tm-item${ref === null ? ' auto' : ''}${i === at ? ' cursor' : ''}`}
              onMouseMove={() => i !== at && setCursor(i)}
              onClick={() => choose(ref)}>
              <span className="tm-check" aria-hidden="true">{ref === pinned ? '✓' : ''}</span>
              <span className="tm-label" title={ref ?? undefined}>{ref ?? 'Automatic'}</span>
              {hintFor(ref) && <span className="tm-hint">{hintFor(ref)}</span>}
            </div>
            {ref === null && (refs === null || refs.length > 0) && <div className="tm-sep" />}
          </div>
        ))}
        {refs === null && <div className="tm-note">Loading branches…</div>}
        {refs !== null && refs.length > 0 && items.length === 1 && <div className="tm-note">No branch matches “{query.trim()}”.</div>}
        {refs !== null && refs.length === 0 && !error && <div className="tm-note">No other branches.</div>}
      </div>
      {error && <div className="tm-error">{error}</div>}
    </div>,
    document.body,
  )
}

/** Under the button, inside the window. */
function placeBelow(anchor: HTMLElement): CSSProperties {
  const r = anchor.getBoundingClientRect()
  const width = Math.min(300, window.innerWidth - 16)
  const top = r.bottom + 4
  return {
    left: Math.max(8, Math.min(r.left, window.innerWidth - width - 8)),
    top,
    width,
    maxHeight: Math.max(150, window.innerHeight - top - 12),
  }
}
