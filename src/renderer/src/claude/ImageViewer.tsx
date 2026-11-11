import { useEffect, useLayoutEffect, useRef, useState, type FocusEvent, type KeyboardEvent, type MouseEvent } from 'react'
import { createPortal } from 'react-dom'
import { UNDECODABLE } from '@shared/claude-images'
import type { ClaudeImageData } from '@shared/types'
import { errorText } from '../git/format'
import { CloseIcon, PictureIcon } from '../icons'
import { COULD_NOT_LOAD, type FeedImage, isImageData, type Size, stepImage, VIEWER_MARGIN, viewerSize } from './images'
import { thumbs } from './useThumbnail'

interface ImageViewerProps {
  /** The folder the snapshot came from: the image is asked for there. */
  folder: string
  /** The feed's images, oldest first: ← and → step through them. */
  list: FeedImage[]
  /** The one shown (kept even when its item has left the feed). */
  entry: FeedImage
  onStep(entry: FeedImage): void
  onClose(): void
}

/** Where the tab bar ends (styles.css: .tabbar is 36 px): the viewer covers the window below it, so
 *  the tabs and the window's own buttons stay usable. */
const tabBarBottom = () => document.querySelector('.tabbar')?.getBoundingClientRect().bottom ?? 36

/** Moves the keyboard to the next (or previous) enabled button inside `root`, round and round. */
function cycleFocus(root: HTMLElement | null, back: boolean): void {
  const buttons = root ? [...root.querySelectorAll<HTMLButtonElement>('button:not(:disabled)')] : []
  if (!buttons.length) return
  const at = buttons.indexOf(document.activeElement as HTMLButtonElement)
  const next = at < 0 ? (back ? buttons.length - 1 : 0) : (at + (back ? -1 : 1) + buttons.length) % buttons.length
  buttons[next].focus()
}

/** An image of the feed, large, over the window below the tab bar: as large as fits with 24 px around
 *  it and never past one image pixel per CSS pixel, over a checkerboard. Esc, ×, or a click on the
 *  backdrop closes it; ← and → step through the feed's images; Open shows a copy in the default image
 *  app. It takes only Esc, ←, → and Tab, so Deck's own shortcuts still work. Rendered into <body>. */
export function ImageViewer({ folder, list, entry, onStep, onClose }: ImageViewerProps) {
  const rootRef = useRef<HTMLDivElement>(null)
  const stageRef = useRef<HTMLDivElement>(null)
  const [top] = useState(tabBarBottom)
  const [area, setArea] = useState<Size>({ width: 0, height: 0 })
  const [full, setFull] = useState<{ id: string; data: ClaudeImageData } | null>(null)
  const [broken, setBroken] = useState<string | null>(null)
  const [opening, setOpening] = useState<{ id: string; busy: boolean; error: string | null } | null>(null)
  const { image } = entry
  const id = image.id

  useLayoutEffect(() => {
    rootRef.current?.focus()
  }, [])

  useLayoutEffect(() => {
    const stage = stageRef.current
    if (!stage) return
    const measure = () => setArea({ width: stage.clientWidth, height: stage.clientHeight })
    measure()
    const observer = new ResizeObserver(measure)
    observer.observe(stage)
    return () => observer.disconnect()
  }, [])

  // The full image, one at a time: stepping on drops an answer still on its way.
  useEffect(() => {
    let live = true
    window.deck.claude.image(folder, id, 'full').then(
      (data) => {
        if (live) setFull({ id, data: isImageData(data) ? data : { error: COULD_NOT_LOAD } })
      },
      (err: unknown) => {
        if (live) setFull({ id, data: { error: errorText(err) } })
      },
    )
    return () => {
      live = false
    }
  }, [folder, id])

  const shown = full?.id === id ? full.data : null
  const error = broken === id ? UNDECODABLE : shown && 'error' in shown ? shown.error : null
  const url = !error && shown && 'url' in shown ? shown.url : null
  // Until the full image is here, its thumbnail stands in, scaled up.
  const stand = !url && !error ? thumbs.peek(id) : undefined
  const box = viewerSize(image, area)
  const room = { maxWidth: Math.max(1, area.width - 2 * VIEWER_MARGIN), maxHeight: Math.max(1, area.height - 2 * VIEWER_MARGIN) }
  const at = list.findIndex((e) => e.key === entry.key)
  const prev = stepImage(list, entry.key, -1)
  const next = stepImage(list, entry.key, 1)
  const open = opening?.id === id ? opening : null

  const openCopy = () => {
    setOpening({ id, busy: true, error: null })
    window.deck.claude.openImage(folder, id).then(
      (r) => setOpening({ id, busy: false, error: r && typeof r.error === 'string' ? r.error : null }),
      (err: unknown) => setOpening({ id, busy: false, error: errorText(err) }),
    )
  }

  const onKeyDown = (e: KeyboardEvent<HTMLDivElement>) => {
    if (e.metaKey || e.ctrlKey || e.altKey) return // Deck's shortcuts (Ctrl+Tab is the next tab)
    if (e.key === 'Escape') onClose()
    else if (e.key === 'ArrowLeft') {
      if (prev) onStep(prev)
    } else if (e.key === 'ArrowRight') {
      if (next) onStep(next)
    } else if (e.key === 'Tab') cycleFocus(rootRef.current, e.shiftKey)
    else return
    e.preventDefault()
    e.stopPropagation()
  }

  const onBackdrop = (e: MouseEvent) => {
    if (e.target === e.currentTarget || e.target === stageRef.current) onClose()
  }

  // A button that goes disabled while it has the keyboard (› onto the last image, Open while it
  // works) drops it to <body>, where Esc and the arrows don't reach the viewer: it takes it back.
  const onBlur = (e: FocusEvent<HTMLDivElement>) => {
    if (e.target instanceof HTMLButtonElement && e.target.disabled && !e.relatedTarget) rootRef.current?.focus()
  }

  return createPortal(
    <div className="iv" ref={rootRef} style={{ top }} role="dialog" aria-modal="true" aria-label={entry.caption} tabIndex={-1}
      onKeyDown={onKeyDown} onBlur={onBlur} onClick={onBackdrop}>
      <div className="iv-stage" ref={stageRef}>
        <div className={box ? 'iv-frame' : 'iv-frame auto'} style={box ?? undefined}>
          {url && <img src={url} alt={entry.caption} draggable={false} style={box ? undefined : room} onError={() => setBroken(id)} />}
          {stand && <img src={stand} alt="" draggable={false} style={box ? undefined : room} />}
          {error && (
            <span className="iv-error" role="status">
              <PictureIcon size={22} />
              {error}
            </span>
          )}
        </div>
        <button className="iv-step prev" aria-label="Previous image" title="Previous image (←)" disabled={!prev}
          onClick={() => prev && onStep(prev)}>‹</button>
        <button className="iv-step next" aria-label="Next image" title="Next image (→)" disabled={!next}
          onClick={() => next && onStep(next)}>›</button>
      </div>
      <div className="iv-bar">
        <span className="iv-caption" title={entry.caption}>{entry.caption}</span>
        {list.length > 1 && at >= 0 && <span className="iv-count">{at + 1} of {list.length}</span>}
        {open?.error && <span className="iv-open-error" role="alert" title={open.error}>{open.error}</span>}
        <button className="button iv-open" disabled={open?.busy === true} title="Open a copy in your image app" onClick={openCopy}>
          Open
        </button>
        <button className="icon-button" aria-label="Close" title="Close (Esc)" onClick={onClose}>
          <CloseIcon size={12} />
        </button>
      </div>
    </div>,
    document.body,
  )
}
