import { describe, expect, it } from 'vitest'
import { controlMessages } from './input'
import { keycodeMessage, scrollMessage, setClipboardMessage, textMessage, touchMessage } from './protocol'

describe('controlMessages', () => {
  it('a touch, in the frame it was made for', () => {
    expect(controlMessages({ type: 'touch', action: 'move', x: 10, y: 20, width: 720, height: 1440 }))
      .toEqual([touchMessage({ action: 'move', x: 10, y: 20, width: 720, height: 1440 })])
  })

  it('a scroll', () => {
    expect(controlMessages({ type: 'scroll', x: 10, y: 20, width: 720, height: 1440, dx: 0, dy: -1.5 }))
      .toEqual([scrollMessage({ x: 10, y: 20, width: 720, height: 1440, hscroll: 0, vscroll: -1.5 })])
  })

  it('a key is pressed, then let go', () => {
    expect(controlMessages({ type: 'key', keycode: 4, meta: 0 })).toEqual([keycodeMessage('down', 4), keycodeMessage('up', 4)])
    // meta (shift, alt, …) belongs on both halves of the press, not just one.
    expect(controlMessages({ type: 'key', keycode: 4, meta: 1 })).toEqual([keycodeMessage('down', 4, 0, 1), keycodeMessage('up', 4, 0, 1)])
  })

  it('text in pieces; a paste through the clipboard', () => {
    expect(controlMessages({ type: 'text', text: 'hi' })).toEqual([textMessage('hi')])
    expect(controlMessages({ type: 'text', text: 'a'.repeat(301) })).toHaveLength(2)
    expect(controlMessages({ type: 'paste', text: 'line 1\nline 2' })).toEqual([setClipboardMessage('line 1\nline 2', true)])

    const max = 'a'.repeat((1 << 18) - 14)
    expect(controlMessages({ type: 'paste', text: max })).toEqual([setClipboardMessage(max, true)])
  })

  it("nothing for input that isn't valid", () => {
    const junk = [
      null, 'touch', { type: 'shell', command: 'reboot' },
      { type: 'touch', action: 'down', x: 10, y: 20, width: 0, height: 1440 },
      { type: 'touch', action: 'tap', x: 1, y: 1, width: 2, height: 2 },
      { type: 'touch', action: 'down', x: 5, y: Number.NaN, width: 10, height: 10 },
      { type: 'touch', action: 'down', x: 720, y: 10, width: 720, height: 1440 }, // x at width: pixels are 0 … width - 1
      { type: 'touch', action: 'down', x: 800, y: 10, width: 720, height: 1440 }, // x past width
      { type: 'touch', action: 'down', x: 10, y: 10, width: 65536, height: 1440 }, // width over 0xffff
      { type: 'touch', action: 'down', x: 10, y: 10, width: 720.5, height: 1440 }, // width not an integer
      { type: 'scroll', x: 1, y: 1, width: 2, height: 2, dx: 0, dy: 99 },
      { type: 'key', keycode: 4.5, meta: 0 },
      { type: 'text', text: '' },
      { type: 'text', text: 'a'.repeat(10_001) },
      { type: 'paste', text: 42 },
      { type: 'paste', text: 'a'.repeat((1 << 18) - 13) }, // one byte over MAX_PASTE_BYTES
    ]
    for (const input of junk) expect(controlMessages(input), JSON.stringify(input)).toEqual([])
  })
})
