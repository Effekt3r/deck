import { useState, type MouseEvent } from 'react'
import { UNDECODABLE } from '@shared/claude-images'
import type { ClaudeImage } from '@shared/types'
import { PictureIcon } from '../icons'
import { imageCaption, imageCount, type ImageItem, itemImages, thumbSize } from './images'
import { type Observe, useThumbnail } from './useThumbnail'

interface ImageTilesProps {
  item: ImageItem
  /** The item's row key: its images are `<rowKey>:<index>` to the viewer. */
  rowKey: number
  /** The folder the snapshot came from: thumbnails are asked for there. */
  folder: string
  /** Off: no thumbnails are made; a dim "▣ N images" opens the viewer instead. */
  show: boolean
  /** Counts the panel's showings: a thumbnail that couldn't be shown asks again at the next. */
  shown: number
  onOpen(key: string): void
  observe: Observe
}

/** Pressing one leaves the keyboard where it was: in the terminal. */
const keepFocus = (e: MouseEvent) => e.preventDefault()

/** An item's images: thumbnails in the order they came (at most 10, then "+N more"), or "▣ N images"
 *  while images are hidden. Each opens the viewer. */
export function ImageTiles({ item, rowKey, folder, show, shown, onOpen, observe }: ImageTilesProps) {
  const images = itemImages(item)
  const total = imageCount(item)
  if (!total) return null
  if (!show) {
    return (
      <button className="fi-images-hidden" disabled={!images.length} onMouseDown={keepFocus} onClick={() => onOpen(`${rowKey}:0`)}
        title="Images are hidden: open this one in the viewer">
        <span aria-hidden="true">▣</span> {total} image{total === 1 ? '' : 's'}
      </button>
    )
  }
  return (
    <div className="fi-images">
      {images.map((image, i) => (
        <Thumb key={`${i}:${image.id}`} image={image} caption={imageCaption(image, item)} folder={folder} shown={shown} observe={observe}
          onOpen={() => onOpen(`${rowKey}:${i}`)} />
      ))}
      {item.moreImages ? <span className="fi-images-more">+{item.moreImages} more</span> : null}
    </div>
  )
}

function Thumb({ image, caption, folder, shown, observe, onOpen }: {
  image: ClaudeImage
  caption: string
  folder: string
  shown: number
  observe: Observe
  onOpen(): void
}) {
  const { ref, data } = useThumbnail(folder, image.id, observe, shown)
  // The browser couldn't draw what main sent.
  const [broken, setBroken] = useState(false)
  const box = thumbSize(image)
  const error = broken ? UNDECODABLE : data && 'error' in data ? data.error : null
  const url = !error && data && 'url' in data ? data.url : null
  return (
    // Its box is set from the start (the snapshot carries the size), so the feed doesn't jump when
    // the picture arrives; CSS narrows it to the row.
    <button ref={ref} className={error ? 'fi-thumb failed' : 'fi-thumb'} draggable={false} aria-label={caption}
      title={error ?? caption} style={{ width: box.width, aspectRatio: `${box.width} / ${box.height}` }}
      onMouseDown={keepFocus} onClick={onOpen}>
      {url && <img src={url} alt="" draggable={false} onError={() => setBroken(true)} />}
      {error && <PictureIcon size={16} />}
    </button>
  )
}
