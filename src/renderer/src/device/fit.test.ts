import { describe, expect, it } from 'vitest'
import { fitSize, toFrame } from './fit'

describe('fitSize', () => {
  it('fits a tall screen by its height and a wide one by its width', () => {
    expect(fitSize({ width: 380, height: 572 }, { width: 1080, height: 2340 })).toEqual({ width: 264, height: 572 })
    expect(fitSize({ width: 380, height: 572 }, { width: 2340, height: 1080 })).toEqual({ width: 380, height: 175 })
  })

  it('nothing in an empty box', () => {
    expect(fitSize({ width: 0, height: 100 }, { width: 720, height: 1440 })).toEqual({ width: 0, height: 0 })
  })

  it('floors a fractional box first, so the fit is always whole CSS px', () => {
    expect(fitSize({ width: 380, height: 513.6 }, { width: 1080, height: 2340 })).toEqual({ width: 237, height: 513 })
    expect(fitSize({ width: 300.7, height: 1000 }, { width: 1080, height: 2340 })).toEqual({ width: 300, height: 650 })
  })
})

describe('toFrame', () => {
  it('scales a point on the drawn screen to the frame, and keeps it inside', () => {
    expect(toFrame(132, 286, { width: 264, height: 572 }, { width: 1080, height: 2340 })).toEqual({ x: 540, y: 1170 })
    expect(toFrame(-5, 600, { width: 264, height: 572 }, { width: 1080, height: 2340 })).toEqual({ x: 0, y: 2339 })
  })

  it('maps a point correctly on a landscape frame too', () => {
    expect(toFrame(190, 87.5, { width: 380, height: 175 }, { width: 2340, height: 1080 })).toEqual({ x: 1170, y: 540 })
  })
})
