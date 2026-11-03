import { describe, expect, it } from 'vitest'
import { deviceKey, KEYCODE, type KeyPress } from './keys'

const k = (key: string, mods: Partial<KeyPress> = {}): KeyPress => ({ key, shiftKey: false, ctrlKey: false, metaKey: false, altKey: false, ...mods })

describe('deviceKey', () => {
  it('editing and moving keys are Android key codes, with Shift', () => {
    expect(deviceKey(k('Enter'), 'darwin')).toEqual({ keycode: KEYCODE.ENTER, meta: 0 })
    expect(deviceKey(k('Backspace'), 'win32')).toEqual({ keycode: KEYCODE.DEL, meta: 0 })
    expect(deviceKey(k('ArrowLeft', { shiftKey: true }), 'darwin')).toEqual({ keycode: KEYCODE.DPAD_LEFT, meta: 1 })
  })

  it('typed characters are text, Option and AltGr ones included', () => {
    expect(deviceKey(k('a'), 'darwin')).toEqual({ text: 'a' })
    expect(deviceKey(k('A', { shiftKey: true }), 'darwin')).toEqual({ text: 'A' })
    expect(deviceKey(k('ø', { altKey: true }), 'darwin')).toEqual({ text: 'ø' })
    expect(deviceKey(k('@', { ctrlKey: true, altKey: true }), 'win32')).toEqual({ text: '@' })
  })

  it("Deck's shortcuts, dead keys and keys Android has no use for stay Deck's", () => {
    expect(deviceKey(k('v', { metaKey: true }), 'darwin')).toBeNull()
    expect(deviceKey(k('T', { ctrlKey: true, shiftKey: true }), 'win32')).toBeNull()
    expect(deviceKey(k('c', { ctrlKey: true }), 'darwin')).toBeNull()
    expect(deviceKey(k('Dead', { altKey: true }), 'darwin')).toBeNull()
    expect(deviceKey(k('F5'), 'darwin')).toBeNull()
    expect(deviceKey(k('a', { isComposing: true }), 'darwin')).toBeNull()
  })
})
