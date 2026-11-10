import { describe, expect, it } from 'vitest'
import { HID_KEY, HID_MOD } from '@shared/hid'
import { MAX_TEXT, simulatorEvents, typeText } from './input'
import { buttonEvent, HOME_BUTTON, keyEvent, touchEvent } from './proto'

const points = { width: 402, height: 874 }
const down = (u: number) => keyEvent(u, false)
const up = (u: number) => keyEvent(u, true)
const SHIFT = 225

describe('simulatorEvents', () => {
  it("maps a touch in the frame's pixels to the screen's points; a move is a touch down", () => {
    const frame = { width: 604, height: 1312 }
    expect(simulatorEvents({ type: 'touch', action: 'down', x: 302, y: 656, ...frame }, points)).toEqual([touchEvent(201, 437, false)])
    expect(simulatorEvents({ type: 'touch', action: 'move', x: 0, y: 1312, ...frame }, points)).toEqual([touchEvent(0, 874, false)])
    expect(simulatorEvents({ type: 'touch', action: 'up', x: 700, y: -5, ...frame }, points)).toEqual([touchEvent(402, 0, true)])
  })

  it('drops touches that make no sense', () => {
    for (const bad of [
      { type: 'touch', action: 'hover', x: 1, y: 1, width: 10, height: 10 },
      { type: 'touch', action: 'down', x: Number.NaN, y: 1, width: 10, height: 10 },
      { type: 'touch', action: 'down', x: 1, y: 1, width: 0, height: 10 },
      { type: 'touch', action: 'down', x: 1, y: 1, width: 10, height: 70000 },
    ]) expect(simulatorEvents(bad, points)).toEqual([])
  })

  it('types text and pastes as a US keyboard would, Shift held where needed', () => {
    const typed = [down(SHIFT), down(4), up(4), up(SHIFT), down(5), up(5), down(30), up(30), down(SHIFT), down(30), up(30), up(SHIFT)]
    expect(simulatorEvents({ type: 'text', text: 'Ab1!' }, points)).toEqual(typed)
    expect(simulatorEvents({ type: 'paste', text: 'Ab1!' }, points)).toEqual(typed)
  })

  it('presses a named key with its modifiers around it, in order', () => {
    expect(simulatorEvents({ type: 'hid', usage: HID_KEY.BACKSPACE, modifiers: HID_MOD.ALT }, points))
      .toEqual([down(226), down(42), up(42), up(226)])
    expect(simulatorEvents({ type: 'hid', usage: HID_KEY.LEFT, modifiers: HID_MOD.CMD | HID_MOD.SHIFT }, points))
      .toEqual([down(225), down(227), down(80), up(80), up(227), up(225)])
  })

  it('takes only named keys and known modifiers', () => {
    expect(simulatorEvents({ type: 'hid', usage: 4, modifiers: 0 }, points)).toEqual([])
    expect(simulatorEvents({ type: 'hid', usage: HID_KEY.ENTER, modifiers: 16 }, points)).toEqual([])
    expect(simulatorEvents({ type: 'hid', usage: HID_KEY.ENTER, modifiers: 1.5 }, points)).toEqual([])
  })

  it('presses Home, and ignores what a simulator has no use for', () => {
    expect(simulatorEvents({ type: 'button', button: 'home' }, points)).toEqual([buttonEvent(HOME_BUTTON, false), buttonEvent(HOME_BUTTON, true)])
    expect(simulatorEvents({ type: 'button', button: 'power' }, points)).toEqual([])
    expect(simulatorEvents({ type: 'key', keycode: 3, meta: 0 }, points)).toEqual([])
    expect(simulatorEvents({ type: 'scroll', x: 1, y: 1, width: 10, height: 10, dx: 0, dy: 1 }, points)).toEqual([])
    expect(simulatorEvents(null, points)).toEqual([])
  })
})

describe('typeText', () => {
  it('turns newlines into Return and skips what a US keyboard has no key for', () => {
    expect(typeText('a\r\nb')).toEqual([down(4), up(4), down(40), up(40), down(5), up(5)])
    expect(typeText('é✓')).toEqual([])
  })

  it(`types at most ${MAX_TEXT} characters`, () => {
    expect(typeText('a'.repeat(MAX_TEXT + 5))).toHaveLength(MAX_TEXT * 2)
  })
})
