import { createContext, memo, useCallback, useContext, useEffect, useLayoutEffect, useMemo, useRef, useState, type KeyboardEvent, type ReactNode } from 'react'
import type { ClaudeFeedItem } from '@shared/types'
import { sameItem, toolKind, toolLabel, type ToolKind } from './feedItems'
import { ImageTiles } from './ImageTiles'
import { MarkdownView } from './MarkdownView'
import { NearView, type Observe } from './useThumbnail'

interface FeedProps {
  /** Oldest first. */
  items: ClaudeFeedItem[]
  /** Each item's React key, kept from snapshot to snapshot (feedKeys). */
  keys: number[]
  showThinking: boolean
  /** A turn is open: running tools pulse. (One a killed Claude left running doesn't.) */
  live: boolean
  /** The folder the snapshot came from: its images are asked for there. */
  folder: string
  /** Thumbnails, or "▣ N images" while they're hidden. */
  showImages: boolean
  /** Counts the panel's showings: a thumbnail that couldn't be shown asks again at the next. */
  shown: number
  /** Opens the viewer on image `<row key>:<index>`. */
  onOpenImage(key: string): void
}

/** This close to the end counts as at the end (px). */
const AT_END = 24

interface FeedContextValue {
  pause(): void
  folder: string
  showImages: boolean
  shown: number
  openImage(key: string): void
  observe: Observe
}

const FeedContext = createContext<FeedContextValue>({
  pause: () => {},
  folder: '',
  showImages: true,
  shown: 0,
  openImage: () => {},
  observe: () => () => {},
})

/** Prompts, thinking, replies, tool calls and notices, newest at the bottom. It follows
 *  the end while the view is there; scrolling up pauses it (like the prototype's f, End
 *  or the "↓ N new" button follow again). Rows keep their keys from snapshot to snapshot
 *  and only re-render when their content changed, so a streaming turn stays smooth; and
 *  while paused, the browser's scroll anchoring keeps the rows in view in place when a
 *  row above changes (a tool done) or old ones drop off the top. */
export function Feed({ items, keys, showThinking, live, folder, showImages, shown, onOpenImage }: FeedProps) {
  const scrollRef = useRef<HTMLDivElement>(null)
  const contentRef = useRef<HTMLDivElement>(null)

  const following = useRef(true)
  /** A pointer is down on the rows (selecting text): no jumping to the end under it. */
  const holding = useRef(false)
  /** While paused: the newest key when it paused ("N new" counts what came after). */
  const [pausedAfter, setPausedAfter] = useState<number | null>(null)
  const lastKey = keys.length ? keys[keys.length - 1] : -1
  const lastKeyRef = useRef(lastKey)
  useLayoutEffect(() => {
    lastKeyRef.current = lastKey
  })

  const toEnd = useCallback(() => {
    const el = scrollRef.current
    if (el && !holding.current) el.scrollTop = el.scrollHeight
  }, [])
  const pause = useCallback(() => {
    if (!following.current) return
    following.current = false
    setPausedAfter(lastKeyRef.current)
  }, [])
  const follow = useCallback(() => {
    following.current = true
    holding.current = false
    setPausedAfter(null)
    toEnd()
  }, [toEnd])
  // Thumbnails ask for their pixels when they come near view: one observer for the feed, made once
  // the scroller is there (a child's effect runs after the refs are set).
  const nearRef = useRef<NearView | null>(null)
  const observe = useCallback<Observe>((el, near) => {
    const root = scrollRef.current
    if (!root) return () => {}
    nearRef.current ??= new NearView(root)
    return nearRef.current.watch(el, near)
  }, [])
  useEffect(() => () => {
    nearRef.current?.dispose()
    nearRef.current = null
  }, [])
  const context = useMemo(() => ({ pause, folder, showImages, shown, openImage: onOpenImage, observe }),
    [pause, folder, showImages, shown, onOpenImage, observe])

  // After every change: at the end while following.
  useLayoutEffect(() => {
    if (following.current) toEnd()
  }, [items, showThinking, toEnd])

  useEffect(() => {
    const el = scrollRef.current
    const content = contentRef.current
    if (!el || !content) return
    const resume = () => {
      following.current = true
      setPausedAfter(null)
    }
    const onScroll = () => {
      if (el.clientHeight === 0) return // the tab is hidden
      const atEnd = fromEnd(el) <= AT_END
      if (atEnd && !following.current) resume()
      else if (!atEnd && following.current) pause()
    }
    // The wheel pauses before the scroll happens, so an update arriving in between can't
    // pull the view back down; only when it leaves the end, not for a nudge.
    const onWheel = (e: WheelEvent) => {
      const dy = e.deltaMode === 1 ? e.deltaY * 16 : e.deltaMode === 2 ? e.deltaY * el.clientHeight : e.deltaY
      if (dy < 0 && el.scrollTop > 0 && fromEnd(el) - dy > AT_END) pause()
    }
    // Rows growing (a code block laid out, the panel narrower) and the view resizing; a
    // paused view that finds itself at the end (the feed got shorter) follows again.
    const observer = new ResizeObserver(() => {
      if (el.clientHeight === 0) return
      if (following.current) toEnd()
      else if (!holding.current && fromEnd(el) <= AT_END) resume()
    })
    observer.observe(el)
    observer.observe(content)
    el.addEventListener('scroll', onScroll, { passive: true })
    el.addEventListener('wheel', onWheel, { passive: true })
    const release = () => {
      if (!holding.current) return
      holding.current = false
      if (following.current) toEnd()
    }
    window.addEventListener('pointerup', release, true)
    window.addEventListener('pointercancel', release, true)
    window.addEventListener('blur', release)
    return () => {
      observer.disconnect()
      el.removeEventListener('scroll', onScroll)
      el.removeEventListener('wheel', onWheel)
      window.removeEventListener('pointerup', release, true)
      window.removeEventListener('pointercancel', release, true)
      window.removeEventListener('blur', release)
    }
  }, [pause, toEnd])

  const onKeyDown = (e: KeyboardEvent<HTMLDivElement>) => {
    if (e.metaKey || e.ctrlKey || e.altKey) return
    if (e.key === 'End' || e.key === 'f' || e.key === 'F') {
      e.preventDefault()
      follow()
    } else if (e.key === 'ArrowUp' || e.key === 'PageUp' || e.key === 'Home' || (e.key === ' ' && e.shiftKey)) {
      if ((scrollRef.current?.scrollTop ?? 0) > 0) pause() // the key scrolls up next
    }
  }

  const fresh = useMemo(() => {
    if (pausedAfter === null) return 0
    let n = 0
    for (let i = keys.length - 1; i >= 0 && keys[i] > pausedAfter; i--) if (showThinking || items[i].kind !== 'thinking') n++
    return n
  }, [keys, items, pausedAfter, showThinking])

  const rows: ReactNode[] = []
  for (let i = 0; i < items.length; i++) {
    if (showThinking || items[i].kind !== 'thinking') rows.push(<Row key={keys[i]} rowKey={keys[i]} item={items[i]} />)
  }

  return (
    <FeedContext.Provider value={context}>
      <div className="feed-wrap">
        <div className={live ? 'feed live' : 'feed'} ref={scrollRef} tabIndex={0} role="log" aria-live="off"
          aria-label="Claude's activity" onKeyDown={onKeyDown}
          onPointerDown={(e) => {
            if (e.button === 0 && e.target !== e.currentTarget) holding.current = true // not the scrollbar
          }}>
          <div className="feed-content" ref={contentRef}>
            {rows.length > 0 ? rows : <div className="feed-empty">{items.length ? 'Only thinking so far (hidden).' : 'No prompts in this session yet.'}</div>}
          </div>
        </div>
        {pausedAfter !== null && (
          <button className={fresh > 0 ? 'feed-jump fresh' : 'feed-jump'} title="Follow the newest (End)" onClick={follow}>
            <span aria-hidden="true">↓</span> {fresh > 0 ? `${fresh} new` : 'Latest'}
          </button>
        )}
      </div>
    </FeedContext.Provider>
  )
}

/** How far the view is from the end (px). */
const fromEnd = (el: HTMLElement) => el.scrollHeight - el.scrollTop - el.clientHeight

const Row = memo(function Row({ item, rowKey }: { item: ClaudeFeedItem; rowKey: number }) {
  switch (item.kind) {
    case 'prompt':
      return (
        <div className={item.text.startsWith('! ') ? 'fi-prompt shell' : 'fi-prompt'}>
          {/* A prompt that is only images shows just them, not "[image]". */}
          {!(item.text === '[image]' && item.images?.length) && <Clamp lines={8}>{item.text}</Clamp>}
          <Images item={item} rowKey={rowKey} />
        </div>
      )
    case 'thinking':
      return (
        <div className="fi fi-thinking">
          <span className="fi-gutter" aria-hidden="true">✻</span>
          {item.text ? <Clamp lines={2}>{item.text}</Clamp> : <span className="fi-text">thinking…</span>}
        </div>
      )
    case 'reply':
      return (
        <div className="fi fi-reply">
          <span className="fi-gutter" aria-hidden="true"><span className="fi-dot" /></span>
          <MarkdownView text={item.text} />
        </div>
      )
    case 'tool':
      return <Tool item={item} rowKey={rowKey} />
    case 'notice':
      return (
        <div className={`fi fi-notice ${item.tone === 'error' ? 'error' : 'info'}`}>
          <span className="fi-gutter" aria-hidden="true">{item.tone === 'error' ? '⚠︎' : '·'}</span>
          <span className="fi-text">{item.text.replace(/^[✗⚠⌘·]︎?\s+/, '')}</span>
        </div>
      )
    default:
      return null
  }
}, (a, b) => a.rowKey === b.rowKey && sameItem(a.item, b.item))

/** The item's thumbnails, with the feed's folder, switch and viewer. */
function Images({ item, rowKey }: { item: Extract<ClaudeFeedItem, { kind: 'prompt' | 'tool' }>; rowKey: number }) {
  const { folder, showImages, shown, openImage, observe } = useContext(FeedContext)
  return <ImageTiles item={item} rowKey={rowKey} folder={folder} show={showImages} shown={shown} onOpen={openImage} observe={observe} />
}

function Tool({ item, rowKey }: { item: Extract<ClaudeFeedItem, { kind: 'tool' }>; rowKey: number }) {
  const kind = toolKind(item.name)
  const name = toolLabel(item.name)
  const title = [item.summary ? `${name}: ${item.summary}` : name, item.state === 'error' && item.error ? item.error : '']
    .filter(Boolean).join('\n')
  return (
    <div className={`fi fi-tool k-${kind} ${item.state}`} title={title}>
      <span className="fi-gutter" aria-hidden="true"><ToolIcon kind={kind} /></span>
      <span className="fi-tool-line">
        <span className="fi-tool-name">{name}</span>
        {item.summary && <span className="fi-tool-summary">{item.summary}</span>}
        {item.state === 'running' && <span className="fi-live" aria-label="running" />}
      </span>
      {item.state === 'error' && item.error && <span className="fi-tool-error">{item.error}</span>}
      <Images item={item} rowKey={rowKey} />
    </div>
  )
}

// One observer for every clamped text: it tells each whether it still overflows its lines
// (shown again after the tab was hidden, the panel resized).
const overflowReports = new Map<Element, (overflows: boolean) => void>()
let overflowObserver: ResizeObserver | null = null

function watchOverflow(el: HTMLElement, report: (overflows: boolean) => void): () => void {
  overflowObserver ??= new ResizeObserver((entries) => {
    for (const entry of entries) {
      if (entry.contentRect.height === 0) continue // hidden
      const t = entry.target as HTMLElement
      overflowReports.get(t)?.(t.scrollHeight > t.clientHeight + 1)
    }
  })
  overflowReports.set(el, report)
  overflowObserver.observe(el)
  return () => {
    overflowReports.delete(el)
    overflowObserver?.unobserve(el)
  }
}

/** Text cut to `lines` lines, with "more" when it doesn't fit. Opening one pauses the
 *  feed: the reader stays on it instead of being taken to the end. */
function Clamp({ lines, children }: { lines: number; children: ReactNode }) {
  const ref = useRef<HTMLDivElement>(null)
  const [open, setOpen] = useState(false)
  const [overflows, setOverflows] = useState(false)
  const { pause } = useContext(FeedContext)
  useLayoutEffect(() => {
    const el = ref.current
    if (!el || open) return
    return watchOverflow(el, setOverflows)
  }, [open])
  return (
    <div className={open ? 'fi-clamp open' : 'fi-clamp'}>
      <div ref={ref} className="fi-text" style={open ? undefined : { WebkitLineClamp: lines }}>{children}</div>
      {(open || overflows) && (
        <button className="fi-more" aria-expanded={open}
          onClick={() => {
            if (!open) pause()
            setOpen(!open)
          }}>
          {open ? 'less' : 'more'}
        </button>
      )}
    </div>
  )
}

/** 16 px stroke icons like icons.tsx, one per kind of tool. */
function ToolIcon({ kind }: { kind: ToolKind }) {
  let body: ReactNode
  switch (kind) {
    case 'terminal':
      body = <><rect x="1.75" y="2.75" width="12.5" height="10.5" rx="2" /><path d="M4.75 6.25 6.75 8l-2 1.75M8.5 10h2.75" /></>
      break
    case 'edit':
      body = <><path d="M10.6 2.9 13.1 5.4 6 12.5H3.5V10z" /><path d="M9.1 4.4l2.5 2.5" /></>
      break
    case 'read':
      body = <><path d="M1.5 8S3.9 3.5 8 3.5 14.5 8 14.5 8 12.1 12.5 8 12.5 1.5 8 1.5 8z" /><circle cx="8" cy="8" r="2" /></>
      break
    case 'search':
      body = <><circle cx="7" cy="7" r="4.25" /><path d="M10.25 10.25 13.75 13.75" /></>
      break
    case 'web':
      body = <><circle cx="8" cy="8" r="6" /><path d="M2 8h12M8 2c1.7 1.8 2.5 3.8 2.5 6S9.7 12.2 8 14M8 2C6.3 3.8 5.5 5.8 5.5 8s.8 4.2 2.5 6" /></>
      break
    case 'agent':
      body = <><circle cx="4.5" cy="3.5" r="1.5" /><circle cx="4.5" cy="12.5" r="1.5" /><circle cx="11.5" cy="5.5" r="1.5" /><path d="M4.5 5v6M11.5 7c0 2.2-2.4 3.1-6.2 4.2" /></>
      break
    case 'question':
      body = <><circle cx="8" cy="8" r="6" /><path d="M6.25 6.4a1.85 1.85 0 0 1 3.6.55c0 1.3-1.85 1.55-1.85 2.75" /><path d="M8 11.6v.1" /></>
      break
    case 'mcp':
      body = <><path d="M6 1.75v3M10 1.75v3M4.25 4.75h7.5v2.5a3.75 3.75 0 0 1-7.5 0zM8 11v3.25" /></>
      break
    default:
      body = <circle cx="8" cy="8" r="2.25" fill="currentColor" stroke="none" />
  }
  return (
    <svg width="13" height="13" viewBox="0 0 16 16" fill="none" stroke="currentColor" strokeWidth="1.6"
      strokeLinecap="round" strokeLinejoin="round" aria-hidden="true">
      {body}
    </svg>
  )
}
