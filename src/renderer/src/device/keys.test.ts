import { describe, expect, it } from 'vitest'
import { deviceKey, KEYCODE, type KeyPress } from './keys'

const k = (key: string, mods: Partial<KeyPress> = {}): KeyPress => ({ key, shiftKey: false, ctrlKey: false, metaKey: false, altKey: false, ...mods })

describe('deviceKey', () => {
  it('editing and moving keys are Android key codes, with Shift', () => {
    expect(deviceKey(k('Enter'), 'darwin')).toEqual({ keycode: KEYCODE.ENTER, meta: 0 })
    expect(deviceKey(k('Backspace'), 'win32')).toEqual({ keycode: KEYCODE.DEL, meta: 0 })
    expect(deviceKey(k('ArrowLeft', { shiftKey: true }), 'darwin')).toEqual({ keycode: KEYCODE.DPAD_LEFT, meta: 1 })
  })

  it('the rest of the key map, with Shift and Alt', () => {
    expect(deviceKey(k('PageUp'), 'darwin')).toEqual({ keycode: KEYCODE.PAGE_UP, meta: 0 })
    expect(deviceKey(k('PageDown'), 'win32')).toEqual({ keycode: KEYCODE.PAGE_DOWN, meta: 0 })
    expect(deviceKey(k('Home'), 'darwin')).toEqual({ keycode: KEYCODE.MOVE_HOME, meta: 0 })
    expect(deviceKey(k('End'), 'win32')).toEqual({ keycode: KEYCODE.MOVE_END, meta: 0 })
    expect(deviceKey(k('Tab', { shiftKey: true }), 'darwin')).toEqual({ keycode: KEYCODE.TAB, meta: 1 })
    expect(deviceKey(k('ArrowUp', { altKey: true }), 'win32')).toEqual({ keycode: KEYCODE.DPAD_UP, meta: 2 })
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

  it("macOS Option is word-wise (Android's own Alt deletes the line), keeping Shift", () => {
    expect(deviceKey(k('Backspace', { altKey: true }), 'darwin')).toEqual({ keycode: KEYCODE.DEL, meta: 0x1000 })
    expect(deviceKey(k('Delete', { altKey: true }), 'darwin')).toEqual({ keycode: KEYCODE.FORWARD_DEL, meta: 0x1000 })
    expect(deviceKey(k('ArrowRight', { altKey: true }), 'darwin')).toEqual({ keycode: KEYCODE.DPAD_RIGHT, meta: 0x1000 })
    expect(deviceKey(k('ArrowLeft', { altKey: true, shiftKey: true }), 'darwin')).toEqual({ keycode: KEYCODE.DPAD_LEFT, meta: 0x1001 })
  })

  it("Cmd+Left/Right is macOS's line start/end; every other Cmd key stays Deck's", () => {
    expect(deviceKey(k('ArrowRight', { metaKey: true }), 'darwin')).toEqual({ keycode: KEYCODE.MOVE_END, meta: 0 })
    expect(deviceKey(k('ArrowLeft', { metaKey: true, shiftKey: true }), 'darwin')).toEqual({ keycode: KEYCODE.MOVE_HOME, meta: 1 })
    expect(deviceKey(k('v', { metaKey: true }), 'darwin')).toBeNull()
  })

  it("off macOS, Alt alone is a menu or system key, not Deck's to send on", () => {
    expect(deviceKey(k('f', { altKey: true }), 'win32')).toBeNull()
    expect(deviceKey(k(' ', { altKey: true }), 'win32')).toBeNull()
  })

  it('a browser-reported AltGr is trusted over guessing from Ctrl+Alt', () => {
    expect(deviceKey(k('@', { ctrlKey: true, altKey: true, altGraph: true }), 'win32')).toEqual({ text: '@' })
    expect(deviceKey(k('t', { ctrlKey: true, altKey: true, altGraph: false }), 'win32')).toBeNull()
    expect(deviceKey(k('@', { ctrlKey: true, altKey: true }), 'win32')).toEqual({ text: '@' })
    expect(deviceKey(k('ArrowLeft', { altKey: true, altGraph: true }), 'win32')).toEqual({ keycode: KEYCODE.DPAD_LEFT, meta: 0 })
  })
})
