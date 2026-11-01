import { describe, expect, it } from 'vitest'
import { PasteQueue } from './pasteQueue'

/** A queue over a fake terminal: paste() emits its (bracketed, here just wrapped in [ ]) text back
 *  through input(), the way xterm 6's term.paste() -> onData does, synchronously. */
function setup() {
  const sent: string[] = []
  let queue!: PasteQueue
  queue = new PasteQueue(
    (data) => sent.push(data),
    (text) => queue.input(`[${text}]`),
  )
  return { queue, sent: () => sent.join('') }
}

describe('PasteQueue', () => {
  it('one paste, then typed input: the paste lands first, then the typing', () => {
    const { queue, sent } = setup()
    const id = queue.begin()
    queue.input('\r')
    queue.settle(id, 'ONE')
    expect(sent()).toBe('[ONE]\r')
  })

  it('two pastes, typing between, then more typing: everything keeps its place', () => {
    const { queue, sent } = setup()
    const id1 = queue.begin()
    queue.input(' and ')
    const id2 = queue.begin()
    queue.input('\r')
    queue.settle(id1, 'ONE')
    queue.settle(id2, 'TWO')
    expect(sent()).toBe('[ONE] and [TWO]\r')
  })

  it('two pastes settled in reverse order still land in the order they were asked for', () => {
    const { queue, sent } = setup()
    const id1 = queue.begin()
    const id2 = queue.begin()
    queue.settle(id2, 'TWO') // the second paste's read finishes first ...
    expect(sent()).toBe('') // ... but it waits: the first hasn't settled yet
    queue.settle(id1, 'ONE')
    expect(sent()).toBe('[ONE][TWO]')
  })

  it('a timeout settling null, then a late real reply for the same id: nothing extra pastes, and later input is not stuck', () => {
    const { queue, sent } = setup()
    const id = queue.begin()
    queue.input('x')
    queue.settle(id, null) // the 1 s timeout fires first
    queue.settle(id, 'LATE') // the reply, arriving after: ignored, not reordered in
    expect(sent()).toBe('x')
    queue.input('y')
    expect(sent()).toBe('xy')
  })

  it('Shift+Enter between a pending paste and typing keeps its place', () => {
    const { queue, sent } = setup()
    const id = queue.begin()
    queue.input('\x1b\r') // Shift+Enter, sent as input like any other key
    queue.input('more')
    queue.settle(id, 'ONE')
    expect(sent()).toBe('[ONE]\x1b\rmore')
  })

  it('nothing pending: input is written at once, not queued', () => {
    const { queue, sent } = setup()
    queue.input('a')
    queue.input('b')
    expect(sent()).toBe('ab')
  })

  it('a null settle with nothing typed after it pastes nothing', () => {
    const { queue, sent } = setup()
    const id = queue.begin()
    queue.settle(id, null)
    expect(sent()).toBe('')
  })

  it('an empty-string settle pastes nothing, same as null', () => {
    const { queue, sent } = setup()
    const id = queue.begin()
    queue.input('after')
    queue.settle(id, '')
    expect(sent()).toBe('after')
  })

  it('settling the same id twice outside a timeout race is ignored the second time', () => {
    const { queue, sent } = setup()
    const id = queue.begin()
    queue.settle(id, 'ONE')
    queue.settle(id, 'TWO')
    expect(sent()).toBe('[ONE]')
  })

  it('settling an id that was never begun does nothing', () => {
    const { queue, sent } = setup()
    queue.settle(999, 'NOPE')
    expect(sent()).toBe('')
  })
})
