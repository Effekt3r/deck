/** A tab's place in the strip, in the strip's own coordinates (offsetLeft, offsetWidth): unaffected
 *  by the strip's scrolling and by the transforms that slide tabs during a drag. */
export interface Slot {
  left: number
  width: number
}

const middle = (s: Slot) => s.left + s.width / 2

/**
 * The place a dragged tab would take if dropped now. `slots` are every tab in the strip, the
 * Projects tab first; `from` is the dragged tab's place and `center` its middle now. It passes a
 * tab once its middle crosses that tab's, and never lands before `first` (Projects stays first).
 */
export function dropIndex(slots: readonly Slot[], from: number, center: number, first = 1): number {
  let to = from
  while (to + 1 < slots.length && center > middle(slots[to + 1])) to++
  if (to !== from) return to
  while (to - 1 >= first && center < middle(slots[to - 1])) to--
  return to
}

/** How far tab `i` slides aside while tab `from` is dragged to `to`: the dragged tab's width. */
export function slideFor(i: number, from: number, to: number, width: number): number {
  if (from < to && i > from && i <= to) return -width
  if (to < from && i >= to && i < from) return width
  return 0
}

/**
 * How far the dragged tab is drawn from its place: `dx`, kept between the Projects tab's neighbour
 * place (`first`) and the last tab's end. Drawn further, it would widen the strip it scrolls in, and
 * scrolling at the strip's end would never stop. Where it lands comes from the unclamped `dx`, or a
 * wide tab could never pass a narrow last tab's middle.
 */
export function shownShift(slots: readonly Slot[], from: number, dx: number, first = 1): number {
  const s = slots[from]
  const last = slots[slots.length - 1]
  return Math.min(Math.max(dx, slots[first].left - s.left), last.left + last.width - (s.left + s.width))
}

/** Within 32 px of the strip's ends a drag scrolls it: up to 8 px a frame, faster closer in. */
export function edgeScroll(x: number, left: number, right: number): number {
  const ZONE = 32
  const MAX = 8
  if (x < left + ZONE) return -Math.ceil(MAX * Math.min(1, (left + ZONE - x) / ZONE))
  if (x > right - ZONE) return Math.ceil(MAX * Math.min(1, (x - (right - ZONE)) / ZONE))
  return 0
}
