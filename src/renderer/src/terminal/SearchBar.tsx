import { useEffect, useRef, useState, type KeyboardEvent, type RefObject } from 'react'
import type { ISearchOptions, SearchAddon } from '@xterm/addon-search'
import { CloseIcon, DownIcon, UpIcon } from '../icons'

// Every match violet, the current one amber (decoration colours must be #RRGGBB).
const DECORATIONS: ISearchOptions['decorations'] = {
  matchBackground: '#3B3470',
  matchBorder: '#5E52A8',
  matchOverviewRuler: '#A78BFA',
  activeMatchBackground: '#7A4A12',
  activeMatchBorder: '#FF9F43',
  activeMatchColorOverviewRuler: '#FF9F43',
}

interface Props {
  open: boolean
  /** Changes whenever find is asked for again: focus and select the query. */
  focusToken: number
  searchRef: RefObject<SearchAddon | null>
  onClose(): void
}

/** Stays mounted while closed so the query survives for the next Find. */
export function SearchBar({ open, focusToken, searchRef, onClose }: Props) {
  const inputRef = useRef<HTMLInputElement>(null)
  const [query, setQuery] = useState('')
  const [results, setResults] = useState<{ index: number; count: number } | null>(null)

  // Subscribe while open: the addon is created after this component mounts.
  useEffect(() => {
    if (!open) return
    const sub = searchRef.current?.onDidChangeResults(({ resultIndex, resultCount }) =>
      setResults({ index: resultIndex, count: resultCount }))
    return () => sub?.dispose()
  }, [open, searchRef])

  const find = (q: string, opts: { back?: boolean; incremental?: boolean } = {}) => {
    const search = searchRef.current
    if (!search) return
    if (!q) {
      search.clearDecorations()
      setResults(null)
      return
    }
    const options = { decorations: DECORATIONS, incremental: opts.incremental }
    if (opts.back) search.findPrevious(q, options)
    else search.findNext(q, options)
  }

  // Each Find request focuses the query and highlights its matches again.
  useEffect(() => {
    const input = inputRef.current
    if (!open || !input) return
    input.focus()
    input.select()
    if (input.value) find(input.value, { incremental: true })
  }, [open, focusToken])

  const onKeyDown = (e: KeyboardEvent<HTMLInputElement>) => {
    if (e.key === 'Enter') find(query, { back: e.shiftKey })
    else if (e.key === 'Escape') onClose()
    else return
    e.preventDefault()
  }

  const count = !query || !results ? '' : results.count === 0 ? 'No results'
    : results.index < 0 ? `${results.count}+` : `${results.index + 1} of ${results.count}`

  return (
    <div className="search-bar" hidden={!open} onMouseDown={(e) => e.target !== inputRef.current && e.preventDefault()}>
      <input
        ref={inputRef}
        className={query && results?.count === 0 ? 'search-input no-match' : 'search-input'}
        value={query}
        placeholder="Find"
        spellCheck={false}
        onChange={(e) => {
          setQuery(e.target.value)
          find(e.target.value, { incremental: true })
        }}
        onKeyDown={onKeyDown}
      />
      <span className="search-count">{count}</span>
      <button className="icon-button" title="Previous match (Shift+Enter)" onClick={() => find(query, { back: true })}>
        <UpIcon />
      </button>
      <button className="icon-button" title="Next match (Enter)" onClick={() => find(query)}>
        <DownIcon />
      </button>
      <button className="icon-button" title="Close (Esc)" onClick={onClose}>
        <CloseIcon size={12} />
      </button>
    </div>
  )
}
