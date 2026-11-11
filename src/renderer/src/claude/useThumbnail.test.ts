import { afterEach, beforeEach, describe, expect, it, vi } from 'vitest'
import { GONE, TOO_LARGE } from '@shared/claude-images'
import { NearView, tileData } from './useThumbnail'

/** A stand-in for the browser's IntersectionObserver (the tests run in node): it records what it
 *  watches, and `fire` tells it an element came into (or left) its margin. */
class FakeObserver {
  static last: FakeObserver | null = null
  readonly watched = new Set<object>()
  disconnected = false
  constructor(readonly callback: (entries: { target: object; isIntersecting: boolean }[]) => void, readonly options: { root: object; rootMargin: string }) {
    FakeObserver.last = this
  }
  observe(el: object) {
    this.watched.add(el)
  }
  unobserve(el: object) {
    this.watched.delete(el)
  }
  disconnect() {
    this.disconnected = true
    this.watched.clear()
  }
  fire(target: object, isIntersecting = true) {
    this.callback([{ target, isIntersecting }])
  }
}

beforeEach(() => {
  vi.stubGlobal('IntersectionObserver', FakeObserver)
})
afterEach(() => {
  vi.unstubAllGlobals()
})

describe('NearView', () => {
  it("watches with the feed's scroller as the root and one feed-height above and below", () => {
    const root = {}
    new NearView(root as Element)
    expect(FakeObserver.last?.options).toEqual({ root, rootMargin: '100% 0px' })
  })

  it('tells an element once when it comes near, and stops watching it', () => {
    const view = new NearView({} as Element)
    const observer = FakeObserver.last!
    const el = {} as Element
    const near = vi.fn()
    view.watch(el, near)
    observer.fire(el, false)
    expect(near).not.toHaveBeenCalled()
    observer.fire(el)
    observer.fire(el)
    expect(near).toHaveBeenCalledTimes(1)
    expect(observer.watched.has(el)).toBe(false)
  })

  it('stop() and dispose() leave nothing watched, and a late callback calls nobody', () => {
    const view = new NearView({} as Element)
    const observer = FakeObserver.last!
    const a = {} as Element
    const b = {} as Element
    const nearA = vi.fn()
    const nearB = vi.fn()
    const stopA = view.watch(a, nearA)
    view.watch(b, nearB)
    stopA()
    stopA() // twice is fine
    expect(observer.watched.has(a)).toBe(false)
    observer.fire(a)
    expect(nearA).not.toHaveBeenCalled()
    view.dispose()
    expect(observer.disconnected).toBe(true)
    observer.fire(b)
    expect(nearB).not.toHaveBeenCalled()
  })
})

describe('tileData', () => {
  const picture = { url: 'data:image/png;base64,AA==' }

  it('waits (null) until the tile has an answer; a picture stays however often the panel is shown', () => {
    expect(tileData(null, 1)).toBeNull()
    expect(tileData({ data: picture, shown: 1 }, 1)).toEqual(picture)
    expect(tileData({ data: picture, shown: 1 }, 4)).toEqual(picture)
  })

  it('an error lasts until the panel is shown again, when the tile waits to ask again', () => {
    // A rewritten log: the image's line moved, so main didn't find it until the panel read the log
    // again (its tab came to the front, or its subscribe was answered again).
    expect(tileData({ data: { error: GONE }, shown: 1 }, 1)).toEqual({ error: GONE })
    expect(tileData({ data: { error: GONE }, shown: 1 }, 2)).toBeNull()
    expect(tileData({ data: { error: TOO_LARGE }, shown: 2 }, 3)).toBeNull()
  })
})
