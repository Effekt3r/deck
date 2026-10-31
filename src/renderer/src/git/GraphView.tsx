import { memo, useCallback, useEffect, useId, useLayoutEffect, useMemo, useRef, useState, type CSSProperties, type KeyboardEvent } from 'react'
import type { GitCommit, GitRef } from '@shared/types'
import { ago } from '../projects/filter'
import type { GraphRow, Segment } from './lanes'
import { refPills } from './pills'
import './graph.css'

export const ROW_HEIGHT = 24
const HALF = ROW_HEIGHT / 2
const LANE_WIDTH = 14
const DOT_RADIUS = 4
const LINE_WIDTH = 2
/** Rows rendered above and below the viewport. */
const OVERSCAN = 20
/** The rendered range moves in steps of this many rows, so scrolling re-renders less often. */
const STEP = 8
const NEED_MORE_WITHIN = 50

/** Lane colours, in the order new chains get them (lanes.ts counts colours up; the view wraps). */
export const LANE_COLORS = ['#3DDCC1', '#FF9F43', '#A78BFA', '#7AA2F7', '#F7768E', '#9ECE6A', '#E0AF68', '#7DCFFF']

/** Panel width from which rows show the author's first name. */
const AUTHOR_FROM = 420

const laneX = (lane: number) => 4 + lane * LANE_WIDTH + LANE_WIDTH / 2
const gutterFor = (lanes: number) => lanes * LANE_WIDTH + 8

interface GraphViewProps {
  commits: GitCommit[]
  /** layoutGraph(commits), memoised by the caller. */
  rows: GraphRow[]
  toMerge: ReadonlySet<string>
  selected: string | null
  onSelect(hash: string): void
  hasMore: boolean
  /** Near the end of the list and hasMore. */
  onNeedMore(): void
}

interface View {
  /** Rendered rows: [start, end). */
  start: number
  end: number
  width: number
  /** 0 while the tab is hidden. */
  height: number
}

/** The commit list: lanes on one canvas behind virtualised DOM rows. The canvas
 *  scrolls with the rows and covers the rendered range only (the viewport plus
 *  the overscan), so lines and dots never drift from their rows mid-scroll. */
export function GraphView({ commits, rows, toMerge, selected, onSelect, hasMore, onNeedMore }: GraphViewProps) {
  const count = Math.min(commits.length, rows.length)
  const scrollRef = useRef<HTMLDivElement>(null)
  const canvasRef = useRef<HTMLCanvasElement>(null)
  const [view, setView] = useState<View>({ start: 0, end: 0, width: 0, height: 0 })
  const dpr = useDevicePixelRatio()
  const now = useNow(commits)
  const uid = useId()

  const index = useMemo(() => {
    const m = new Map<string, number>()
    for (let i = 0; i < commits.length; i++) m.set(commits[i].hash, i)
    return m
  }, [commits])

  // For the native scroll listener.
  const latest = useRef({ commits, count, onSelect })
  useLayoutEffect(() => {
    latest.current = { commits, count, onSelect }
  })

  const measure = useCallback(() => {
    const el = scrollRef.current
    if (!el) return
    const { clientWidth: width, clientHeight: height } = el
    if (height === 0) {
      setView((v) => (v.height === 0 ? v : { ...v, height: 0 }))
      return
    }
    const n = latest.current.count
    const first = Math.floor(el.scrollTop / ROW_HEIGHT)
    const last = Math.ceil((el.scrollTop + height) / ROW_HEIGHT)
    const end = Math.min(n, Math.ceil((last + OVERSCAN) / STEP) * STEP)
    const start = Math.min(end, Math.max(0, Math.floor((first - OVERSCAN) / STEP) * STEP))
    setView((v) => (v.start === start && v.end === end && v.width === width && v.height === height
      ? v : { start, end, width, height }))
  }, [])

  // The first visible commit while scrolled down, kept in place when the list changes
  // (new commits on top, a rewrite) so reading history isn't interrupted by Claude committing.
  const anchor = useRef<{ hash: string; offset: number } | null>(null)
  useEffect(() => {
    const el = scrollRef.current
    if (!el) return
    const onScroll = () => {
      const top = el.scrollTop
      const i = Math.floor(top / ROW_HEIGHT)
      const c = latest.current.commits[i]
      anchor.current = top >= ROW_HEIGHT && c ? { hash: c.hash, offset: top - i * ROW_HEIGHT } : null
      measure()
    }
    const observer = new ResizeObserver(measure)
    el.addEventListener('scroll', onScroll, { passive: true })
    observer.observe(el)
    return () => {
      el.removeEventListener('scroll', onScroll)
      observer.disconnect()
    }
  }, [measure])

  useLayoutEffect(() => {
    const el = scrollRef.current
    const a = anchor.current
    const i = a ? index.get(a.hash) : undefined
    if (el && a && i !== undefined) {
      const top = i * ROW_HEIGHT + a.offset
      if (Math.abs(el.scrollTop - top) >= 1) el.scrollTop = top
    }
    measure()
  }, [index, measure])

  // Keep the selection in view when it moves (keys, a parent link in the details).
  useLayoutEffect(() => {
    const el = scrollRef.current
    const i = selected ? index.get(selected) : undefined
    if (!el || i === undefined || el.clientHeight === 0) return
    const top = i * ROW_HEIGHT
    if (top < el.scrollTop) el.scrollTop = top
    else if (top + ROW_HEIGHT > el.scrollTop + el.clientHeight) el.scrollTop = top + ROW_HEIGHT - el.clientHeight
  }, [selected]) // not on list changes: those keep the anchor instead

  // Once per list: a failed page isn't retried until the list changes.
  const asked = useRef(-1)
  useEffect(() => {
    asked.current = -1
  }, [commits])
  useEffect(() => {
    if (!hasMore || count === 0 || view.height === 0 || asked.current === count) return
    if (view.end >= count - NEED_MORE_WITHIN) {
      asked.current = count
      onNeedMore()
    }
  }, [hasMore, count, view.end, view.height, onNeedMore])

  // The list may have just shrunk (an update without the older pages): until measure()
  // catches up, never index past it.
  const end = Math.min(view.end, count)
  const start = Math.min(view.start, end)
  let lanes = 1
  for (let i = start; i < end; i++) if (rows[i].width > lanes) lanes = rows[i].width
  const full = gutterFor(lanes)
  // A very wide graph is cut off (with a fade) so the subjects keep their room.
  const cap = Math.max(gutterFor(3), Math.min(Math.floor(view.width * 0.45), view.width - 220))
  const gutter = view.width > 0 ? Math.min(full, cap) : full
  const clipped = full > gutter
  // The author column needs a wide panel (by width alone, so it doesn't come and go
  // while scrolling). Pills that don't fit become "+N": shrinking all of them leaves stubs.
  const author = view.width >= AUTHOR_FROM
  const room = view.width - gutter - 10 - 56 - 18 - 28 - (author ? 72 : 0)
  const maxPills = room >= 420 ? 3 : room >= 250 ? 2 : 1

  useLayoutEffect(() => {
    const canvas = canvasRef.current
    if (!canvas) return
    if (view.height === 0 || end <= start) {
      canvas.width = 0 // a hidden tab gives its backing store back
      canvas.height = 0
      return
    }
    const cssHeight = (end - start) * ROW_HEIGHT
    const w = Math.ceil(gutter * dpr)
    const h = Math.ceil(cssHeight * dpr)
    if (canvas.width !== w) canvas.width = w
    if (canvas.height !== h) canvas.height = h
    const ctx = canvas.getContext('2d')
    if (!ctx) return
    ctx.setTransform(1, 0, 0, 1, 0, 0)
    ctx.clearRect(0, 0, w, h)
    ctx.setTransform(dpr, 0, 0, dpr, 0, 0)
    drawLanes(ctx, rows, commits, start, end)
    if (clipped) {
      ctx.globalCompositeOperation = 'destination-out'
      const fade = ctx.createLinearGradient(gutter - 16, 0, gutter, 0)
      fade.addColorStop(0, 'rgba(0, 0, 0, 0)')
      fade.addColorStop(1, 'rgba(0, 0, 0, 1)')
      ctx.fillStyle = fade
      ctx.fillRect(gutter - 16, 0, 16, cssHeight)
      ctx.globalCompositeOperation = 'source-over'
    }
  }, [rows, commits, start, end, gutter, clipped, dpr, view.height])

  const pick = useCallback((hash: string) => latest.current.onSelect(hash), [])

  const onKeyDown = (e: KeyboardEvent<HTMLDivElement>) => {
    if (e.metaKey || e.ctrlKey || e.altKey || count === 0) return
    const el = scrollRef.current
    const current = selected ? index.get(selected) ?? -1 : -1
    const from = current >= 0 ? current : Math.floor((el?.scrollTop ?? 0) / ROW_HEIGHT)
    const page = Math.max(1, Math.floor((el?.clientHeight ?? 0) / ROW_HEIGHT) - 1)
    let next: number
    switch (e.key) {
      case 'ArrowDown':
        next = current >= 0 ? current + 1 : from
        break
      case 'ArrowUp':
        next = current >= 0 ? current - 1 : from
        break
      case 'PageDown':
        next = from + page
        break
      case 'PageUp':
        next = from - page
        break
      case 'Home':
        next = 0
        break
      case 'End':
        next = count - 1
        break
      case 'Enter':
        if (current < 0) return
        next = current
        break
      default:
        return
    }
    e.preventDefault()
    onSelect(commits[Math.max(0, Math.min(count - 1, next))].hash)
  }

  const items = []
  for (let i = start; i < end; i++) {
    const c = commits[i]
    items.push(
      <CommitRow key={c.hash} id={`${uid}r${i}`} commit={c} top={i * ROW_HEIGHT} selected={c.hash === selected}
        merge={toMerge.has(c.hash)} now={now} maxPills={maxPills} onPick={pick} />,
    )
  }
  const selectedIndex = selected ? index.get(selected) : undefined
  const activeId = selectedIndex !== undefined && selectedIndex >= start && selectedIndex < end ? `${uid}r${selectedIndex}` : undefined

  return (
    <div className={author ? 'graph' : 'graph no-author'} ref={scrollRef} tabIndex={0} role="listbox" aria-label="Commits" aria-activedescendant={activeId}
      style={{ '--gutter': `${gutter}px` } as CSSProperties} onKeyDown={onKeyDown}>
      <div className="graph-content" style={{ height: (count + (hasMore ? 1 : 0)) * ROW_HEIGHT }}>
        {items}
        <canvas ref={canvasRef} className="graph-canvas" aria-hidden="true"
          style={{ top: start * ROW_HEIGHT, width: gutter, height: (end - start) * ROW_HEIGHT }} />
        {hasMore && <div className="graph-more" style={{ top: count * ROW_HEIGHT }}>Loading older commits…</div>}
      </div>
    </div>
  )
}

/** Lines first (straight runs merged across rows, curves per segment, one path per
 *  colour), then the dots; HEAD's commit is a ring with its middle punched out. */
function drawLanes(ctx: CanvasRenderingContext2D, rows: GraphRow[], commits: GitCommit[], start: number, end: number) {
  const paths = new Map<number, Path2D>()
  const path = (color: number) => {
    const k = color % LANE_COLORS.length
    let p = paths.get(k)
    if (!p) paths.set(k, (p = new Path2D()))
    return p
  }
  // Open vertical run per lane: [top, bottom) in one colour.
  const runTop: number[] = []
  const runEnd: number[] = []
  const runColor: number[] = []
  const flush = (lane: number) => {
    if (runEnd[lane] > runTop[lane]) {
      const p = path(runColor[lane])
      const x = laneX(lane)
      p.moveTo(x, runTop[lane])
      p.lineTo(x, runEnd[lane])
    }
  }
  const piece = (s: Segment, y0: number, y1: number) => {
    if (s.from === s.to) {
      const lane = s.from
      if (runEnd[lane] === y0 && runColor[lane] === s.color) runEnd[lane] = y1
      else {
        if (runEnd[lane] !== undefined) flush(lane)
        runTop[lane] = y0
        runEnd[lane] = y1
        runColor[lane] = s.color
      }
      return
    }
    // Vertical tangents at both ends: the Sourcetree-like S-curve.
    const x0 = laneX(s.from)
    const x1 = laneX(s.to)
    const mid = (y0 + y1) / 2
    const p = path(s.color)
    p.moveTo(x0, y0)
    p.bezierCurveTo(x0, mid, x1, mid, x1, y1)
  }

  for (let i = start; i < end; i++) {
    const r = rows[i]
    const y = (i - start) * ROW_HEIGHT
    for (const s of r.up) piece(s, y, y + HALF)
    for (const s of r.down) piece(s, y + HALF, y + ROW_HEIGHT)
  }
  for (let lane = 0; lane < runEnd.length; lane++) if (runEnd[lane] !== undefined) flush(lane)

  ctx.lineWidth = LINE_WIDTH
  ctx.lineCap = 'butt'
  for (const [k, p] of paths) {
    ctx.strokeStyle = LANE_COLORS[k]
    ctx.stroke(p)
  }

  for (let i = start; i < end; i++) {
    const r = rows[i]
    const x = laneX(r.lane)
    const y = (i - start) * ROW_HEIGHT + HALF
    const color = LANE_COLORS[r.color % LANE_COLORS.length]
    if (isHead(commits[i])) {
      ctx.globalCompositeOperation = 'destination-out'
      ctx.beginPath()
      ctx.arc(x, y, DOT_RADIUS + 1, 0, Math.PI * 2)
      ctx.fill()
      ctx.globalCompositeOperation = 'source-over'
      ctx.beginPath()
      ctx.arc(x, y, DOT_RADIUS, 0, Math.PI * 2)
      ctx.strokeStyle = color
      ctx.stroke()
    } else {
      ctx.beginPath()
      ctx.arc(x, y, DOT_RADIUS, 0, Math.PI * 2)
      ctx.fillStyle = color
      ctx.fill()
    }
  }
}

const isHead = (c: GitCommit) => c.refs.some((r) => r.current || r.kind === 'head')

interface RowProps {
  id: string
  commit: GitCommit
  top: number
  selected: boolean
  merge: boolean
  now: number
  maxPills: number
  onPick(hash: string): void
}

const CommitRow = memo(function CommitRow({ id, commit, top, selected, merge, now, maxPills, onPick }: RowProps) {
  const classes = `graph-row${selected ? ' selected' : ''}${merge ? ' merge' : ''}`
  return (
    <div id={id} role="option" aria-selected={selected} className={classes} style={{ top }} onClick={() => onPick(commit.hash)}>
      <span className="g-hash" title={merge ? 'Goes into the merge target' : undefined}>{commit.hash.slice(0, 7)}</span>
      {commit.refs.length > 0 && <RefPills refs={commit.refs} max={maxPills} />}
      <span className="g-subject" title={`${commit.subject}\n${commit.author}, ${new Date(commit.time).toLocaleString()}`}>{commit.subject}</span>
      <span className="g-author" title={commit.author}>{firstName(commit.author)}</span>
      <span className="g-age">{ago(commit.time, now)}</span>
    </div>
  )
})

const firstName = (name: string) => name.trim().split(/\s+/)[0] ?? ''

function RefPills({ refs, max }: { refs: GitRef[]; max: number }) {
  const pills = useMemo(() => refPills(refs), [refs])
  const rest = pills.slice(max)
  return (
    <span className="g-refs">
      {pills.slice(0, max).map((p) => (
        <span key={`${p.kind}:${p.name}`} className={`g-pill ${p.kind}`} title={p.title}>
          {p.kind === 'tag' && <TagMark />}
          <span className="g-pill-name">{p.name}</span>
          {p.remotes && <CloudMark />}
        </span>
      ))}
      {rest.length > 0 && <span className="g-pill more" title={rest.map((p) => p.title).join('\n')}>+{rest.length}</span>}
    </span>
  )
}

const TagMark = () => (
  <svg className="g-pill-mark" width="9" height="9" viewBox="0 0 16 16" fill="none" stroke="currentColor" strokeWidth="2" aria-hidden="true">
    <path d="M2 2h6l6 6-6 6-6-6z" strokeLinejoin="round" />
    <circle cx="5.5" cy="5.5" r="1" fill="currentColor" stroke="none" />
  </svg>
)

const CloudMark = () => (
  <svg className="g-pill-mark" width="11" height="11" viewBox="0 0 16 16" fill="currentColor" aria-hidden="true">
    <path d="M4.6 13a3.1 3.1 0 0 1-.5-6.2 4.2 4.2 0 0 1 8.1-.6A3.4 3.4 0 0 1 11.8 13z" />
  </svg>
)

/** devicePixelRatio, updated when the window moves to another display or zooms. */
function useDevicePixelRatio(): number {
  const [dpr, setDpr] = useState(() => window.devicePixelRatio || 1)
  useEffect(() => {
    const query = window.matchMedia(`(resolution: ${dpr}dppx)`)
    const update = () => setDpr(window.devicePixelRatio || 1)
    query.addEventListener('change', update)
    return () => query.removeEventListener('change', update)
  }, [dpr])
  return dpr
}

/** Now, refreshed every minute and whenever the list changes (for the ages). */
function useNow(list: unknown): number {
  const [tick, setTick] = useState(0)
  useEffect(() => {
    const timer = setInterval(() => setTick((t) => t + 1), 60_000)
    return () => clearInterval(timer)
  }, [])
  return useMemo(() => Date.now(), [list, tick])
}
