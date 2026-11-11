import { useEffect, useState } from 'react'
import type { ClaudeImageData } from '@shared/types'
import { ThumbCache } from './images'

/** The window's thumbnails, like the markdown cache: a tab switch or another session reuses them. */
export const thumbs = new ThumbCache()

/** Calls `near` once `el` comes near the feed's visible part; the function stops watching. */
export type Observe = (el: Element, near: () => void) => () => void

/**
 * One IntersectionObserver for a feed, with its scroller as the root: it tells each element it
 * watches, once, when it comes within one feed-height of the visible part. Opening a session asks
 * only for what's near the end; scrolling up asks for more. A hidden tab's feed (display: none)
 * intersects nothing, so it asks for nothing.
 */
export class NearView {
  private readonly calls = new Map<Element, () => void>()
  private readonly observer: IntersectionObserver

  constructor(root: Element) {
    this.observer = new IntersectionObserver((entries) => {
      for (const entry of entries) {
        const near = entry.isIntersecting ? this.calls.get(entry.target) : undefined
        if (!near) continue
        this.unwatch(entry.target)
        near()
      }
    }, { root, rootMargin: '100% 0px' })
  }

  watch(el: Element, near: () => void): () => void {
    this.calls.set(el, near)
    this.observer.observe(el)
    return () => this.unwatch(el)
  }

  dispose(): void {
    this.observer.disconnect()
    this.calls.clear()
  }

  private unwatch(el: Element): void {
    if (this.calls.delete(el)) this.observer.unobserve(el)
  }
}

/** A tile's answer, and the panel's showing it was asked in (`shown`, ClaudePanel's count). */
export interface TileAnswer {
  data: ClaudeImageData
  shown: number
}

/** What a tile shows: its thumbnail, or why there's none, which lasts until the panel is shown again
 *  (an image whose line moved is found once the panel has read its log again); null while it waits to
 *  ask, so it asks (again) once it's near view. */
export function tileData(got: TileAnswer | null, shown: number): ClaudeImageData | null {
  return got && ('url' in got.data || got.shown === shown) ? got.data : null
}

/** Image `id`'s thumbnail: from the cache, else asked for from `folder`'s session once its box (the
 *  ref) comes near view. null until then. `shown` counts the panel's showings: an error from an
 *  earlier one is asked for again. */
export function useThumbnail(folder: string, id: string, observe: Observe, shown: number): { ref: (el: HTMLElement | null) => void; data: ClaudeImageData | null } {
  const [got, setGot] = useState<TileAnswer | null>(() => {
    const url = thumbs.peek(id)
    return url === undefined ? null : { data: { url }, shown }
  })
  const [el, setEl] = useState<HTMLElement | null>(null)
  const data = tileData(got, shown)
  const waiting = data === null
  useEffect(() => {
    if (!el || !waiting) return
    let live = true
    const stop = observe(el, () => {
      void thumbs.get(id, () => window.deck.claude.image(folder, id, 'thumb')).then((answer) => {
        if (live) setGot({ data: answer, shown })
      })
    })
    return () => {
      live = false
      stop()
    }
  }, [el, folder, id, observe, waiting, shown])
  return { ref: setEl, data }
}
