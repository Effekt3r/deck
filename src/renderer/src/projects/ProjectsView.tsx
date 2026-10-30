import { useCallback, useEffect, useMemo, useRef, useState, type KeyboardEvent } from 'react'
import type { ProjectAction, ProjectItem, ProjectsConfig, ProjectStatus } from '@shared/types'
import { SearchIcon, SettingsIcon } from '../icons'
import type { TerminalTab } from '../tabs/tabs'
import { ago, filterProjects, isInside, shortPath } from './filter'
import { Settings } from './Settings'

interface Props {
  active: boolean
  openTabs: TerminalTab[]
  /** From app.info(); paths stay unshortened until it arrives. */
  home: string
  /** Incremented by the Find menu command: focus the filter. */
  findRequest: number
  onOpen(path: string, action: ProjectAction): void
}

const REFRESH_MS = 60_000
const PAGE = 10

export function ProjectsView({ active, openTabs, home, findRequest, onOpen }: Props) {
  const platform = window.deck.platform
  const [config, setConfig] = useState<ProjectsConfig | null>(null)
  const [items, setItems] = useState<ProjectItem[] | null>(null)
  const [status, setStatus] = useState<ReadonlyMap<string, ProjectStatus>>(new Map())
  const [error, setError] = useState<string | null>(null)
  const [now, setNow] = useState(() => Date.now())
  const [query, setQuery] = useState('')
  const [selected, setSelected] = useState<string | null>(null)
  const [editing, setEditing] = useState(false)
  const rootRef = useRef<HTMLDivElement>(null)
  const filterRef = useRef<HTMLInputElement>(null)
  const listRef = useRef<HTMLDivElement>(null)
  const loads = useRef(0)
  const revealSelection = useRef(false)

  /** Config and list, then dirty counts for the git repos; a newer load wins. */
  const refresh = useCallback(async () => {
    const n = ++loads.current
    try {
      const [cfg, list] = await Promise.all([window.deck.projects.getConfig(), window.deck.projects.list()])
      if (n !== loads.current) return
      setConfig(cfg)
      setItems(list)
      setNow(Date.now())
      setError(null)
      const repos = list.filter((i) => i.branch !== null).map((i) => i.path)
      const counts = repos.length ? await window.deck.projects.status(repos) : []
      if (n === loads.current) setStatus(new Map(counts.map((s) => [s.path, s])))
    } catch (e) {
      if (n === loads.current) setError(e instanceof Error ? e.message : String(e))
    }
  }, [])

  // On mount, whenever the tab is shown, and every minute while it's visible.
  useEffect(() => {
    if (!active) {
      if (loads.current === 0) void refresh()
      return
    }
    void refresh()
    const timer = setInterval(refresh, REFRESH_MS)
    return () => clearInterval(timer)
  }, [active, refresh])

  // Keys go to this view when it's shown (a hidden terminal may still hold focus).
  useEffect(() => {
    if (active && !editing) rootRef.current?.focus({ preventScroll: true })
  }, [active, editing])

  useEffect(() => {
    if (findRequest > 0) {
      filterRef.current?.focus()
      filterRef.current?.select()
    }
  }, [findRequest])

  const shown = useMemo(() => filterProjects(items ?? [], query), [items, query])
  const index = Math.max(0, shown.findIndex((i) => i.path === selected))
  const current = shown[index] as ProjectItem | undefined

  useEffect(() => {
    if (!revealSelection.current) return
    revealSelection.current = false
    listRef.current?.querySelector('[aria-selected="true"]')?.scrollIntoView({ block: 'nearest' })
  }, [index, shown])

  const move = (delta: number) => {
    if (!shown.length) return
    revealSelection.current = true
    setSelected(shown[Math.min(shown.length - 1, Math.max(0, index + delta))].path)
  }

  const openContextMenu = async (path: string) => {
    setSelected(path)
    const choice = await window.deck.projects.contextMenu(path)
    if (choice) onOpen(path, choice)
    void refresh() // pin / unpin may have changed the list
  }

  const onKeyDown = (e: KeyboardEvent<HTMLDivElement>) => {
    if (editing || e.metaKey || e.ctrlKey || e.altKey) return
    const inFilter = e.target === filterRef.current
    if (!inFilter && e.target !== rootRef.current && e.target !== listRef.current) return // buttons keep their keys
    switch (e.key) {
      case 'ArrowDown':
        move(1)
        break
      case 'ArrowUp':
        move(-1)
        break
      case 'PageDown':
        move(PAGE)
        break
      case 'PageUp':
        move(-PAGE)
        break
      case 'Enter':
        if (current) onOpen(current.path, 'claude')
        break
      case 'Escape':
        if (query) setQuery('')
        else if (inFilter) rootRef.current?.focus()
        break
      case '/':
        if (inFilter) return
        filterRef.current?.focus()
        break
      case 'o':
      case 'O':
        if (inFilter) return
        if (current) onOpen(current.path, 'shell')
        break
      default:
        return
    }
    e.preventDefault()
  }

  const cwds = openTabs.map((t) => t.cwd)
  const isOpen = (path: string) => cwds.some((cwd) => isInside(cwd, path, platform))

  return (
    <div className={active ? 'projects' : 'projects is-hidden'} ref={rootRef} tabIndex={-1} onKeyDown={onKeyDown}>
      <div className="projects-inner">
        <header className="projects-header">
          <div className="projects-heading">
            <h1>
              <span className="projects-home" aria-hidden="true">⌂</span> Projects
            </h1>
            <p className="projects-command">
              Double-click opens a tab and runs <code title={config?.command}>{config?.command ?? '…'}</code>
            </p>
          </div>
          <div className="projects-tools">
            <label className="filter">
              <SearchIcon />
              <input ref={filterRef} value={query} placeholder="Filter projects" spellCheck={false}
                onChange={(e) => {
                  setQuery(e.target.value)
                  setSelected(null) // the best match goes first
                }} />
              {!query && <kbd>/</kbd>}
            </label>
            <button className="button" onClick={() => setEditing(true)} disabled={!config}>
              <SettingsIcon /> Settings
            </button>
          </div>
        </header>

        <div className="project-list" role="listbox" aria-label="Projects" ref={listRef} tabIndex={0}>
          {shown.map((item) => (
            <ProjectRow key={item.path} item={item} selected={item === current} open={isOpen(item.path)}
              status={status.get(item.path)} now={now} home={home}
              onSelect={() => setSelected(item.path)}
              onOpen={() => onOpen(item.path, 'claude')}
              onContextMenu={() => void openContextMenu(item.path)} />
          ))}
          <Empty error={error} loading={items === null} total={items?.length ?? 0} shown={shown.length} query={query}
            onRetry={() => void refresh()} />
        </div>

        <footer className="projects-footer">
          <span><kbd>↵</kbd> or double-click: Claude</span>
          <span><kbd>O</kbd> shell only</span>
          <span><kbd>/</kbd> filter</span>
          <span>Right-click for pin, reveal and copy path</span>
        </footer>
      </div>

      {editing && config && (
        <Settings config={config} onCancel={() => setEditing(false)}
          onSaved={(cfg) => {
            setConfig(cfg)
            setEditing(false)
            void refresh()
          }} />
      )}
    </div>
  )
}

interface RowProps {
  item: ProjectItem
  selected: boolean
  open: boolean
  status: ProjectStatus | undefined
  now: number
  home: string
  onSelect(): void
  onOpen(): void
  onContextMenu(): void
}

function ProjectRow({ item, selected, open, status, now, home, onSelect, onOpen, onContextMenu }: RowProps) {
  return (
    <div role="option" aria-selected={selected} className={selected ? 'project-row selected' : 'project-row'}
      onClick={onSelect}
      onDoubleClick={onOpen}
      onContextMenu={(e) => {
        e.preventDefault()
        onContextMenu()
      }}>
      <span className="p-pin" title={item.pinned ? 'Pinned' : undefined}>{item.pinned ? '★' : ''}</span>
      <span className="p-open" title={open ? 'Open in a tab' : undefined}>{open ? '●' : ''}</span>
      <span className={item.branch === null ? 'p-name folder' : 'p-name'}>{item.name}</span>
      <span className="p-age" title={new Date(item.activity).toLocaleString()}>{ago(item.activity, now)}</span>
      {item.branch === null
        ? <span className="p-branch folder">folder</span>
        : <span className="p-branch" title={item.branch}>⎇ {item.branch}</span>}
      <span className="p-dirty"><Dirty status={status} /></span>
      <span className="p-path" title={item.path}>{home ? shortPath(item.path, home) : item.path}</span>
    </div>
  )
}

function Dirty({ status }: { status: ProjectStatus | undefined }) {
  if (!status) return null
  const { changed, untracked, conflicts } = status
  if (!changed && !untracked && !conflicts) return <span className="dirty-clean" title="Clean">✓</span>
  return (
    <>
      {conflicts > 0 && <span className="dirty-conflicts" title={`${conflicts} with conflicts`}>✖{conflicts}</span>}
      {changed > 0 && <span className="dirty-changed" title={`${changed} changed`}>✚{changed}</span>}
      {untracked > 0 && <span className="dirty-untracked" title={`${untracked} untracked`}>?{untracked}</span>}
    </>
  )
}

interface EmptyProps {
  error: string | null
  loading: boolean
  total: number
  shown: number
  query: string
  onRetry(): void
}

function Empty({ error, loading, total, shown, query, onRetry }: EmptyProps) {
  if (error && !total) {
    return (
      <div className="projects-empty">
        Couldn't load projects: {error} <button className="link-button" onClick={onRetry}>Try again</button>
      </div>
    )
  }
  if (loading) return <div className="projects-empty">Looking for projects…</div>
  if (!total) return <div className="projects-empty">Nothing found. Add folders to scan in Settings.</div>
  if (!shown) return <div className="projects-empty">No projects match “{query.trim()}”.</div>
  return null
}
