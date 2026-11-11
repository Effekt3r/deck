import type { ClaudeFeedItem, ClaudeImage, ClaudeImageData } from '@shared/types'

export interface Size {
  width: number
  height: number
}

/** A feed item that can have images. */
export type ImageItem = Extract<ClaudeFeedItem, { kind: 'prompt' | 'tool' }>

/** Thumbnails fit this box (main makes them at twice it, for Retina screens)… */
export const THUMB_BOX: Size = { width: 240, height: 180 }
/** …and an image whose header gave no size gets a square this big. */
const UNKNOWN_SIDE = 120
/** The viewer leaves this much around its image. */
export const VIEWER_MARGIN = 24
/** Thumbnails kept, by the length of their data: URLs: about 1,000 of the sizes measured. */
export const THUMB_CACHE_CHARS = 24 * 1024 * 1024
/** The renderer's own reason: the request failed, or main's answer wasn't image data. Main's reasons
 *  are in @shared/claude-images. */
export const COULD_NOT_LOAD = "Couldn't load this image"

const FORMAT_LABEL: Record<string, string> = { png: 'PNG', jpeg: 'JPEG', gif: 'GIF', webp: 'WebP' }

/** An item's images, or none (whatever main sent that isn't a list). */
export function itemImages(item: ClaudeFeedItem): ClaudeImage[] {
  return (item.kind === 'prompt' || item.kind === 'tool') && Array.isArray(item.images) ? item.images : []
}

/** Its images and the ones only counted. */
export function imageCount(item: ClaudeFeedItem): number {
  if (item.kind !== 'prompt' && item.kind !== 'tool') return 0
  return itemImages(item).length + (typeof item.moreImages === 'number' && item.moreImages > 0 ? item.moreImages : 0)
}

/** `size` fitted into `box` and never enlarged, in whole pixels. */
function fit(size: Size, box: Size): Size {
  const scale = Math.min(1, box.width / size.width, box.height / size.height)
  return { width: Math.max(1, Math.round(size.width * scale)), height: Math.max(1, Math.round(size.height * scale)) }
}

/** A thumbnail's box: the image fitted into 240×180, never enlarged (a 32 px icon stays 32 px); a
 *  square when its header gave no size. CSS narrows it further to the row's width. */
export function thumbSize(image: Size): Size {
  if (!(image.width > 0) || !(image.height > 0)) return { width: UNKNOWN_SIDE, height: UNKNOWN_SIDE }
  return fit(image, THUMB_BOX)
}

/** The viewer's image: as large as `area` allows with 24 px around it, at no more than one image
 *  pixel per CSS pixel. null when its header gave no size: then it sizes itself. */
export function viewerSize(image: Size, area: Size): Size | null {
  if (!(image.width > 0) || !(image.height > 0)) return null
  const room = { width: Math.max(1, area.width - 2 * VIEWER_MARGIN), height: Math.max(1, area.height - 2 * VIEWER_MARGIN) }
  return fit(image, room)
}

/** 512 B, 212 KB, 2.4 MB (powers of 1,000, as Finder counts). */
export function formatBytes(n: number): string {
  if (n < 1000) return `${n} B`
  if (n < 999_500) return `${Math.round(n / 1000)} KB`
  return `${(n / 1_000_000).toFixed(1)} MB`
}

/** What the image is and its size: "Image #3 · 1440 × 900 · PNG · 212 KB", or for a tool's
 *  "Read · docs/shot.png · 923 × 2000 · PNG · 284 KB". */
export function imageCaption(image: ClaudeImage, item: ImageItem): string {
  const what = item.kind === 'prompt'
    ? [image.paste ? `Image #${image.paste}` : 'Image']
    : [item.name, item.summary].filter(Boolean)
  const size = image.width > 0 && image.height > 0 ? [`${image.width} × ${image.height}`] : []
  return [...what, ...size, FORMAT_LABEL[image.format] ?? String(image.format).toUpperCase(), formatBytes(image.bytes)].join(' · ')
}

/** One of the feed's images, for the viewer. */
export interface FeedImage {
  /** `<row key>:<index>`: the same while its item stays in the feed, even when the same picture shows
   *  twice. */
  key: string
  image: ClaudeImage
  caption: string
}

/** The feed's images, oldest to newest: what the viewer steps through. `keys`: the rows' keys. */
export function feedImages(items: readonly ClaudeFeedItem[], keys: readonly number[]): FeedImage[] {
  const list: FeedImage[] = []
  items.forEach((item, i) => {
    if (item.kind !== 'prompt' && item.kind !== 'tool') return
    itemImages(item).forEach((image, j) => list.push({ key: `${keys[i]}:${j}`, image, caption: imageCaption(image, item) }))
  })
  return list
}

/** The image `delta` steps from the one with `key`; null past either end. One that has gone (its
 *  item left the feed's window, so it was older than every image left) steps forward to the oldest. */
export function stepImage(list: readonly FeedImage[], key: string, delta: -1 | 1): FeedImage | null {
  const at = list.findIndex((e) => e.key === key)
  if (at < 0) return delta > 0 ? (list[0] ?? null) : null
  return list[at + delta] ?? null
}

/** A click closes the viewer only when it's a single click that both started and ended on the
 *  backdrop: a double-click on a thumbnail opens the viewer under its first click, and its second lands
 *  on the backdrop; a drag from the caption or the image ends there, and one from the backdrop may end
 *  on the image. Where it started and ended are pointerdown's and pointerup's targets: the click itself
 *  goes to their nearest common ancestor, which is the backdrop whenever either end is on it. */
export function backdropCloses(click: { detail: number; pressedOnBackdrop: boolean; releasedOnBackdrop: boolean }): boolean {
  return click.detail <= 1 && click.pressedOnBackdrop && click.releasedOnBackdrop
}

/** Where the keyboard went when it left one of the viewer's elements: still inside it, somewhere else
 *  in Deck (the terminal's search, another tab), or nowhere (another app took it, or the button it was
 *  on became disabled). */
export type KeyboardMove = 'inside' | 'outside' | 'nowhere'

/** What the viewer does about it. 'close', leaving the keyboard where it went: the viewer never stays
 *  up without it, or the next Esc would reach the terminal (Claude's interrupt). 'take' it back: a
 *  button that went disabled dropped it to <body>, out of reach of Esc and the arrows. Else 'stay'. */
export function viewerBlur(move: KeyboardMove, fromDisabledButton: boolean): 'close' | 'take' | 'stay' {
  if (move === 'outside') return 'close'
  return move === 'nowhere' && fromDisabledButton ? 'take' : 'stay'
}

/** An answer from main, checked: a data: URL of an image, or a reason. Any `url` must be an image's
 *  data: URL, even beside a reason, since the cache keeps whatever URL an answer has. */
export function isImageData(x: unknown): x is ClaudeImageData {
  if (typeof x !== 'object' || x === null) return false
  const { url, error } = x as Record<string, unknown>
  return 'url' in x ? typeof url === 'string' && url.startsWith('data:image/') : typeof error === 'string'
}

/**
 * Thumbnails by image id, for the window's life: least recently used out first, past `limit`
 * characters of data: URL. A request already on its way is shared. A failure is answered but not
 * kept, so a thumbnail asks again when it's shown again.
 */
export class ThumbCache {
  private readonly urls = new Map<string, string>()
  private readonly loading = new Map<string, Promise<ClaudeImageData>>()
  private chars = 0

  constructor(private readonly limit = THUMB_CACHE_CHARS) {}

  /** The cached URL (now the most recently used), or undefined. */
  peek(id: string): string | undefined {
    const url = this.urls.get(id)
    if (url !== undefined) {
      this.urls.delete(id)
      this.urls.set(id, url)
    }
    return url
  }

  /** The thumbnail: cached, on its way, or asked for with `load`. Never rejects. */
  get(id: string, load: () => Promise<unknown>): Promise<ClaudeImageData> {
    const url = this.peek(id)
    if (url !== undefined) return Promise.resolve({ url })
    let pending = this.loading.get(id)
    if (!pending) {
      pending = Promise.resolve()
        .then(load)
        .then((data): ClaudeImageData => (isImageData(data) ? data : { error: COULD_NOT_LOAD }), (): ClaudeImageData => ({ error: COULD_NOT_LOAD }))
        .then((data) => {
          this.loading.delete(id)
          if ('url' in data) this.keep(id, data.url)
          return data
        })
      this.loading.set(id, pending)
    }
    return pending
  }

  private keep(id: string, url: string): void {
    if (url.length > this.limit) return
    const old = this.urls.get(id)
    if (old !== undefined) this.chars -= old.length
    this.urls.delete(id)
    this.urls.set(id, url)
    this.chars += url.length
    for (const [key, value] of this.urls) {
      if (this.chars <= this.limit) break
      this.urls.delete(key)
      this.chars -= value.length
    }
  }
}
