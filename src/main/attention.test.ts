import { describe, expect, it } from 'vitest'
import { attentionSignal } from './attention'

describe('attentionSignal', () => {
  it('badges the count, and draws the eye only when it rises while Deck is in the background', () => {
    expect(attentionSignal(0, 1, false)).toEqual({ badge: '1', alert: true })
    expect(attentionSignal(0, 1, true)).toEqual({ badge: '1', alert: false })
    expect(attentionSignal(1, 2, false)).toEqual({ badge: '2', alert: true })
    expect(attentionSignal(2, 1, false)).toEqual({ badge: '1', alert: false })
    expect(attentionSignal(1, 1, false)).toEqual({ badge: '1', alert: false })
    expect(attentionSignal(1, 0, false)).toEqual({ badge: '', alert: false })
  })
})
