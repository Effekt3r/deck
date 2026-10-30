import { memo, useCallback, useEffect, useLayoutEffect, useMemo, useRef, useState, type KeyboardEvent, type ReactNode } from 'react'
import type { GitCommit, GitCounts, GitSnapshot, GitSummary } from '@shared/types'
import { CommitDetails } from './CommitDetails'
import { baseName, displayPath, errorText } from './format'
import { GraphView } from './GraphView'
import { layoutGraph } from './lanes'
import { loadSize, saveSize, Splitter } from './Splitter'
import { TargetMenu } from './TargetMenu'
import './panel.css'

interface GitPanelProps {
  /** The tab's GIT_REPO: the work tree its shell is in. */
  repo: string
  /** Subscribed only while its tab is shown; the last snapshot stays meanwhile. */
  active: boolean
  home: string
}

/** main's LOG_PAGE. */
const PAGE = 1000
/** Older history read again with an update; main's logPage takes at most 10 pages. */
const REREAD_MAX = 9 * PAGE
const DETAILS_KEY = 'deck.gitDetailsHeight'
const DETAILS_MIN = 110
const GRAPH_MIN = 120
const NO_COMMITS: GitCommit[] = []

const OPERATION: Record<NonNullable<GitSummary['operation']>, string> = {
  merge: 'MERGING',
  rebase: 'REBASING',
  'cherry-pick': 'CHERRY-PICKING',
  revert: 'REVERTING',
}
const SOURCE: Record<NonNullable<GitSummary['target']>['source'], string> = {
  auto: 'chosen automatically',
  'git-config': 'from git config',
  deck: 'pinned in Deck',
}

interface Page {
  commits: GitCommit[]
  hasMore: boolean
}

/** Header (branch, merge target, upstream, work tree), the commit graph and,
 *  for the selected commit, its details. */
export const GitPanel = memo(function GitPanel({ repo, active, home }: GitPanelProps) {
  const platform = window.deck.platform
  const [snapshot, setSnapshot] = useState<GitSnapshot | null>(null)
  /** History after the first page, read with logPage as the list scrolls. */
  const [more, setMore] = useState<Page | null>(null)
  const [phase, setPhase] = useState<'loading' | 'ready' | 'none' | 'error'>('loading')
  const [error, setError] = useState<string | null>(null)
  const [attempt, setAttempt] = useState(0)
  const [selected, setSelected] = useState<string | null>(null)
  const [detailsOpen, setDetailsOpen] = useState(false)
  const [detailsHeight, setDetailsHeight] = useState(() => loadSize(DETAILS_KEY, 0))
  const [menuAnchor, setMenuAnchor] = useState<HTMLElement | null>(null)
  const panelRef = useRef<HTMLDivElement>(null)
  const headerRef = useRef<HTMLElement>(null)
  const detailsRef = useRef<HTMLDivElement>(null)

  const commits = useMemo(() => {
    if (!snapshot) return NO_COMMITS
    return more?.commits.length ? snapshot.commits.concat(more.commits) : snapshot.commits
  }, [snapshot, more])
  const rows = useMemo(() => layoutGraph(commits), [commits])
  const toMerge = useMemo(() => new Set(snapshot?.toMerge), [snapshot])
  const hasMore = more ? more.hasMore : (snapshot?.hasMore ?? false)

  // Every snapshot starts a generation; pages asked for in an older one are dropped.
  const generation = useRef(0)
  const latest = useRef({ commits, more })
  useLayoutEffect(() => {
    latest.current = { commits, more }
  })

  useEffect(() => {
    if (!active) return
    const { git } = window.deck
    let live = true
    const accept = (snap: GitSnapshot) => {
      const gen = ++generation.current
      const apply = (page: Page | null) => {
        if (!live || gen !== generation.current) return
        setSnapshot(snap)
        setMore(page)
        setPhase('ready')
        setError(null)
      }
      // Pages read before are read again with the new first page: a commit made
      // meanwhile mustn't cut the list back to one page under someone reading history.
      // (In one call, which main allows up to 10 pages; an empty answer is git failing.)
      const extra = Math.min(latest.current.more?.commits.length ?? 0, REREAD_MAX)
      if (extra === 0 || !snap.hasMore) return apply(null)
      git.logPage(repo, snap.commits.length, extra).then(
        (page) => apply(page.length ? { commits: unseen(snap.commits, page), hasMore: page.length >= extra } : null),
        () => apply(null),
      )
    }
    const off = git.onUpdate((r, snap) => {
      if (live && r === repo) accept(snap)
    })
    git.subscribe(repo).then(
      (snap) => {
        if (!live) return
        if (snap) return accept(snap)
        generation.current++
        setSnapshot(null)
        setMore(null)
        setPhase('none')
      },
      (err: unknown) => {
        if (!live) return
        setError(errorText(err))
        setPhase((p) => (p === 'ready' ? p : 'error')) // with a snapshot: keep it, show the error above it
      },
    )
    return () => {
      live = false
      off()
      git.unsubscribe(repo)
    }
  }, [active, repo, attempt])

  const paging = useRef(-1) // the generation a page request is in flight for
  const onNeedMore = useCallback(() => {
    const gen = generation.current
    if (paging.current === gen) return
    paging.current = gen
    const have = latest.current.commits
    window.deck.git.logPage(repo, have.length, PAGE).then(
      (page) => {
        if (gen === generation.current) {
          setMore((m) => ({ commits: (m?.commits ?? []).concat(unseen(have, page)), hasMore: page.length >= PAGE }))
        }
      },
      (err: unknown) => {
        if (gen !== generation.current) return
        setMore((m) => ({ commits: m?.commits ?? [], hasMore: false }))
        setError(`Couldn't load older commits: ${errorText(err)}`)
      },
    ).finally(() => {
      if (paging.current === gen) paging.current = -1
    })
  }, [repo])

  const select = useCallback((hash: string) => {
    setSelected(hash)
    setDetailsOpen(true)
  }, [])
  const closeDetails = useCallback(() => {
    setDetailsOpen(false)
    panelRef.current?.querySelector<HTMLElement>('.graph')?.focus() // the keyboard stays in the list
  }, [])

  const anchorRef = useRef<HTMLElement | null>(null)
  useLayoutEffect(() => {
    anchorRef.current = menuAnchor
  }, [menuAnchor])
  const closeMenu = useCallback((refocus: boolean) => {
    const anchor = anchorRef.current
    setMenuAnchor(null)
    if (refocus) anchor?.focus()
  }, [])
  useEffect(() => {
    if (!active) setMenuAnchor(null) // it lives in <body>, outside the hidden tab
  }, [active])

  const onKeyDown = (e: KeyboardEvent<HTMLDivElement>) => {
    if (e.key !== 'Escape' || !detailsOpen || e.metaKey || e.ctrlKey || e.altKey) return
    e.preventDefault()
    closeDetails()
  }

  const clampDetails = (px: number) => {
    const room = (panelRef.current?.clientHeight ?? 0) - (headerRef.current?.offsetHeight ?? 0) - GRAPH_MIN
    return Math.round(Math.max(DETAILS_MIN, Math.min(px, room)))
  }

  const summary = snapshot?.summary
  const root = summary?.root || repo
  const selectedCommit = useMemo(() => commits.find((c) => c.hash === selected), [commits, selected])

  let body: ReactNode
  if (!snapshot) {
    body = phase === 'none'
      ? <PanelState title="Not a git repository" detail={displayPath(repo, home, platform)} />
      : phase === 'error'
        ? (
          <PanelState error title="Couldn't read the repository" detail={error}>
            <button className="button" onClick={() => setAttempt((a) => a + 1)}>Try again</button>
          </PanelState>
        )
        : <PanelState busy title="Reading history…" />
  } else if (commits.length === 0) {
    body = <PanelState title="No commits yet" detail="The graph starts with the first commit." />
  } else {
    body = (
      <GraphView commits={commits} rows={rows} toMerge={toMerge} selected={selected} onSelect={select}
        hasMore={hasMore} onNeedMore={onNeedMore} />
    )
  }

  return (
    <div className="git-panel" ref={panelRef} onKeyDown={onKeyDown}>
      {/* Clicking the header's text, like the tab bar, leaves the keyboard where it was (the terminal). */}
      <header className="git-header" ref={headerRef}
        onMouseDown={(e) => !(e.target as Element).closest('button') && e.preventDefault()}>
        <div className="gh-row">
          <span className="gh-repo" title={displayPath(root, home, platform)}>{baseName(root)}</span>
          {summary?.operation && <span className="gh-op">{OPERATION[summary.operation]}</span>}
        </div>
        {summary && (
          <SummaryRows summary={summary} menuOpen={menuAnchor !== null}
            onTargetMenu={(button) => setMenuAnchor((a) => (a ? null : button))} />
        )}
      </header>
      {snapshot && error && <div className="git-banner" role="alert">{error}</div>}
      <div className="git-body">{body}</div>
      {snapshot && detailsOpen && selected && (
        <>
          <Splitter orientation="horizontal" label="Resize the commit details" direction={-1}
            getSize={() => detailsRef.current?.offsetHeight ?? DETAILS_MIN}
            onResize={(px) => setDetailsHeight(clampDetails(px))}
            onResizeEnd={(px) => {
              const h = clampDetails(px)
              setDetailsHeight(h)
              saveSize(DETAILS_KEY, h)
            }}
            onReset={() => {
              setDetailsHeight(0)
              saveSize(DETAILS_KEY, null)
            }} />
          <div className="git-details" ref={detailsRef} style={detailsHeight > 0 ? { height: detailsHeight } : undefined}>
            <CommitDetails repo={repo} hash={selected} commit={selectedCommit} onClose={closeDetails} onSelect={select} />
          </div>
        </>
      )}
      {menuAnchor && summary?.branch && (
        <TargetMenu repo={repo} branch={summary.branch} target={summary.target} anchor={menuAnchor} onClose={closeMenu} />
      )}
    </div>
  )
})

interface SummaryRowsProps {
  summary: GitSummary
  menuOpen: boolean
  onTargetMenu(button: HTMLElement): void
}

/** The prototype's header lines: branch, merge target, upstream and work tree. */
function SummaryRows({ summary, menuOpen, onTargetMenu }: SummaryRowsProps) {
  const { branch, head, target, upstream, counts } = summary
  const release = branch === 'main' || branch === 'master'
  return (
    <>
      <div className="gh-row">
        {branch !== null
          ? <span className="gh-branch" title={branch}>⎇ {branch}</span>
          : <span className="gh-detached" title="HEAD is not on a branch">detached @ {head || '?'}</span>}
        {!head && <span className="gh-faint">no commits yet</span>}
      </div>
      {branch !== null && (
        <div className="gh-row">
          <span className="gh-faint" aria-hidden="true">↳</span>
          {target ? (
            <>
              <span className="gh-dim">into</span>
              <button className={target.source === 'deck' ? 'gh-target pinned' : 'gh-target'} aria-haspopup="menu"
                aria-expanded={menuOpen} title={`Merges into ${target.ref} (${SOURCE[target.source]}). Click to change.`}
                onClick={(e) => onTargetMenu(e.currentTarget)}>
                <span className="gh-target-name">{target.ref}</span>
                <Chevron />
              </button>
              {target.ahead > 0
                ? <span className="gh-merge" title={`${target.ahead} commits on this branch aren't in ${target.ref} yet`}><span className="gh-count">{target.ahead}</span> to merge</span>
                : <span className="gh-faint">nothing to merge</span>}
              {target.behind > 0 && <span className="gh-behind" title={`${target.ref} has ${target.behind} commits this branch doesn't`}>· {target.behind} behind</span>}
            </>
          ) : (
            <>
              <span className="gh-dim gh-shrink">{release ? 'Release branch (no merge target)' : 'No merge target'}</span>
              <button className="gh-target icon" aria-haspopup="menu" aria-expanded={menuOpen} aria-label="Choose a merge target"
                title="Choose a merge target" onClick={(e) => onTargetMenu(e.currentTarget)}>
                <Chevron />
              </button>
            </>
          )}
        </div>
      )}
      <div className="gh-row gh-wrap">
        <Upstream branch={branch} upstream={upstream} />
        <Counts counts={counts} />
      </div>
    </>
  )
}

function Upstream({ branch, upstream }: Pick<GitSummary, 'branch' | 'upstream'>) {
  if (!upstream) return branch !== null ? <span className="gh-faint" title="No upstream branch">not pushed</span> : null
  const { ref, ahead, behind } = upstream
  return (
    <span className="gh-upstream" title={`${ref}: ${ahead} ahead, ${behind} behind`}>
      <span className="gh-upstream-ref">{ref}</span>
      {ahead === 0 && behind === 0 && <span className="gh-faint">in sync</span>}
      {ahead > 0 && <span className="gh-ahead">↑{ahead}</span>}
      {behind > 0 && <span className="gh-behind">↓{behind}</span>}
    </span>
  )
}

function Counts({ counts }: { counts: GitCounts }) {
  const { staged, changed, untracked, conflicts } = counts
  if (!staged && !changed && !untracked && !conflicts) return <span className="st-clean">✓ clean</span>
  return (
    <span className="gh-counts">
      {conflicts > 0 && <span className="st-conflicts">✖ {conflicts} {conflicts === 1 ? 'conflict' : 'conflicts'}</span>}
      {staged > 0 && <span className="st-staged">● {staged} staged</span>}
      {changed > 0 && <span className="st-changed">✚ {changed} changed</span>}
      {untracked > 0 && <span className="st-new">? {untracked} new</span>}
    </span>
  )
}

function PanelState({ title, detail, busy, error, children }: {
  title: string
  detail?: string | null
  busy?: boolean
  error?: boolean
  children?: ReactNode
}) {
  return (
    <div className={error ? 'git-state error' : 'git-state'} role="status">
      {busy && <span className="git-spinner" aria-hidden="true" />}
      <strong>{title}</strong>
      {detail && <span className="git-state-detail">{detail}</span>}
      {children}
    </div>
  )
}

const Chevron = () => (
  <svg width="10" height="10" viewBox="0 0 16 16" fill="none" stroke="currentColor" strokeWidth="2" strokeLinecap="round"
    strokeLinejoin="round" aria-hidden="true">
    <path d="M4 6l4 4 4-4" />
  </svg>
)

/** `page` without the commits already in `have` (a page boundary can overlap after history moved). */
function unseen(have: GitCommit[], page: GitCommit[]): GitCommit[] {
  const seen = new Set(have.map((c) => c.hash))
  return page.filter((c) => !seen.has(c.hash))
}
