import { describe, expect, it } from 'vitest'
import { dropIndex, edgeScroll, shownShift, slideFor, type Slot } from './drag'

// Projects (40 px), then a, b and c (100 px each): their middles are at 90, 190 and 290.
const slots: Slot[] = [{ left: 0, width: 40 }, { left: 40, width: 100 }, { left: 140, width: 100 }, { left: 240, width: 100 }]

describe('dropIndex', () => {
  it("stays put until the dragged tab's middle crosses a neighbour's", () => {
    expect(dropIndex(slots, 1, 90)).toBe(1)
    expect(dropIndex(slots, 1, 189)).toBe(1)
    expect(dropIndex(slots, 1, 191)).toBe(2)
    expect(dropIndex(slots, 1, 291)).toBe(3)
    expect(dropIndex(slots, 1, 9999)).toBe(3)
  })
  it('moves left past middles, never before the Projects tab', () => {
    expect(dropIndex(slots, 3, 191)).toBe(3)
    expect(dropIndex(slots, 3, 189)).toBe(2)
    expect(dropIndex(slots, 3, 89)).toBe(1)
    expect(dropIndex(slots, 3, -500)).toBe(1)
  })
  it('handles tabs of different widths', () => {
    // Projects, a wide tab (middle 190) and a narrow one (middle 380).
    const mixed: Slot[] = [{ left: 0, width: 40 }, { left: 40, width: 300 }, { left: 340, width: 80 }]
    expect(dropIndex(mixed, 2, 200)).toBe(2)
    expect(dropIndex(mixed, 2, 180)).toBe(1)
    expect(dropIndex(mixed, 1, 381)).toBe(2)
  })
})

describe('slideFor', () => {
  it('slides the tabs between the old and the new place aside by the dragged width', () => {
    expect([1, 2, 3].map((i) => slideFor(i, 1, 3, 100))).toEqual([0, -100, -100]) // a dragged to 3
    expect([1, 2, 3].map((i) => slideFor(i, 3, 1, 100))).toEqual([100, 100, 0]) // c dragged to 1
    expect([1, 2, 3].map((i) => slideFor(i, 2, 2, 100))).toEqual([0, 0, 0])
  })
})

describe('shownShift', () => {
  it("keeps the dragged tab between Projects and the strip's last tab", () => {
    expect(shownShift(slots, 1, 50)).toBe(50)
    expect(shownShift(slots, 1, 500)).toBe(200) // a's right edge stops at c's
    expect(shownShift(slots, 1, -100)).toBe(0) // a can't cover Projects
    expect(shownShift(slots, 3, 100)).toBe(0)
    expect(shownShift(slots, 3, -500)).toBe(-200)
  })
})

describe('edgeScroll', () => {
  it('scrolls only near the ends, faster closer to them', () => {
    expect(edgeScroll(500, 0, 1000)).toBe(0)
    expect(edgeScroll(32, 0, 1000)).toBe(0)
    expect(edgeScroll(16, 0, 1000)).toBe(-4)
    expect(edgeScroll(0, 0, 1000)).toBe(-8)
    expect(edgeScroll(-50, 0, 1000)).toBe(-8)
    expect(edgeScroll(984, 0, 1000)).toBe(4)
    expect(edgeScroll(1200, 0, 1000)).toBe(8)
  })
})
