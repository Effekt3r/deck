import { afterEach, beforeEach, describe, expect, it, vi } from 'vitest'
import { DataBatcher } from './batcher'

describe('DataBatcher', () => {
  beforeEach(() => vi.useFakeTimers())
  afterEach(() => vi.useRealTimers())

  it('sends one message per tab after the delay', () => {
    const out: [string, string][] = []
    const b = new DataBatcher((id, d) => out.push([id, d]), { delayMs: 5 })
    b.push('a', 'he'); b.push('b', 'x'); b.push('a', 'llo')
    expect(out).toEqual([])
    vi.advanceTimersByTime(5)
    expect(out).toEqual([['a', 'hello'], ['b', 'x']])
  })
  it('flushes at once when a buffer is full', () => {
    const out: string[] = []
    const b = new DataBatcher((_id, d) => out.push(d), { delayMs: 5, maxChars: 4 })
    b.push('a', 'abcdef')
    expect(out).toEqual(['abcdef'])
    vi.advanceTimersByTime(10)
    expect(out).toEqual(['abcdef'])
  })
  it('flushAll empties every buffer; dispose drops timers', () => {
    const out: string[] = []
    const b = new DataBatcher((_id, d) => out.push(d))
    b.push('a', '1'); b.flushAll()
    expect(out).toEqual(['1'])
    b.push('a', '2'); b.dispose(); vi.advanceTimersByTime(50)
    expect(out).toEqual(['1'])
  })
})
