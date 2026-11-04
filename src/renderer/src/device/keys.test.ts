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
    expect(deviceKey(k('PageUp', { altKey: true }), 'darwin')).toEqual({ keycode: KEYCODE.PAGE_UP, meta: 2 })
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

  it("macOS Option deletes by word (Android's own Alt deletes the line), never with Shift", () => {
    expect(deviceKey(k('Backspace', { altKey: true }), 'darwin')).toEqual({ keycode: KEYCODE.DEL, meta: 0x1000 })
    expect(deviceKey(k('Delete', { altKey: true }), 'darwin')).toEqual({ keycode: KEYCODE.FORWARD_DEL, meta: 0x1000 })
    // Option+Shift+Backspace/Delete still just deletes a word, as on a Mac: Android's text fields
    // do nothing for Ctrl+Shift+Backspace, so Shift must not be carried along.
    expect(deviceKey(k('Backspace', { altKey: true, shiftKey: true }), 'darwin')).toEqual({ keycode: KEYCODE.DEL, meta: 0x1000 })
    expect(deviceKey(k('Delete', { altKey: true, shiftKey: true }), 'darwin')).toEqual({ keycode: KEYCODE.FORWARD_DEL, meta: 0x1000 })
  })

  it('macOS Option selects by word left/right, keeping Shift', () => {
    expect(deviceKey(k('ArrowRight', { altKey: true }), 'darwin')).toEqual({ keycode: KEYCODE.DPAD_RIGHT, meta: 0x1000 })
    expect(deviceKey(k('ArrowLeft', { altKey: true, shiftKey: true }), 'darwin')).toEqual({ keycode: KEYCODE.DPAD_LEFT, meta: 0x1001 })
  })

  it("macOS Option+Up/Down is a plain arrow (Android's Alt+Up/Down jumps to the text's start/end, which Option+Up/Down never does on a Mac)", () => {
    expect(deviceKey(k('ArrowUp', { altKey: true }), 'darwin')).toEqual({ keycode: KEYCODE.DPAD_UP, meta: 0 })
    expect(deviceKey(k('ArrowDown', { altKey: true, shiftKey: true }), 'darwin')).toEqual({ keycode: KEYCODE.DPAD_DOWN, meta: 1 })
  })

  it("Cmd+Left/Right/Up/Down is macOS's line or text start/end; every other Cmd key stays Deck's", () => {
    expect(deviceKey(k('ArrowRight', { metaKey: true }), 'darwin')).toEqual({ keycode: KEYCODE.MOVE_END, meta: 0 })
    expect(deviceKey(k('ArrowLeft', { metaKey: true, shiftKey: true }), 'darwin')).toEqual({ keycode: KEYCODE.MOVE_HOME, meta: 1 })
    // Cmd+Up/Down is the whole text's start/end, not just the line's: Android reaches that with
    // Ctrl+Home/Ctrl+End.
    expect(deviceKey(k('ArrowUp', { metaKey: true }), 'darwin')).toEqual({ keycode: KEYCODE.MOVE_HOME, meta: 0x1000 })
    expect(deviceKey(k('ArrowDown', { metaKey: true, shiftKey: true }), 'darwin')).toEqual({ keycode: KEYCODE.MOVE_END, meta: 0x1001 })
    expect(deviceKey(k('v', { metaKey: true }), 'darwin')).toBeNull()
    // Android's nearest key, Alt+Backspace, deletes the whole line, not just up to the cursor.
    expect(deviceKey(k('Backspace', { metaKey: true }), 'darwin')).toBeNull()
  })

  it("off macOS, Alt alone is a menu or system key, not Deck's to send on", () => {
    expect(deviceKey(k('f', { altKey: true }), 'win32')).toBeNull()
    expect(deviceKey(k(' ', { altKey: true }), 'win32')).toBeNull()
    // Android's Alt+Backspace deletes the whole line; Alt+arrows are Windows' back and forward.
    expect(deviceKey(k('Backspace', { altKey: true }), 'win32')).toBeNull()
    expect(deviceKey(k('ArrowUp', { altKey: true }), 'win32')).toBeNull()
  })

  it('off macOS, Ctrl+Backspace/Delete/←/→ edit by word and Ctrl+Home/End go to the text\'s ends, as on Android', () => {
    expect(deviceKey(k('Backspace', { ctrlKey: true }), 'win32')).toEqual({ keycode: KEYCODE.DEL, meta: 0x1000 })
    expect(deviceKey(k('Delete', { ctrlKey: true, shiftKey: true }), 'win32')).toEqual({ keycode: KEYCODE.FORWARD_DEL, meta: 0x1000 })
    expect(deviceKey(k('ArrowLeft', { ctrlKey: true, shiftKey: true }), 'win32')).toEqual({ keycode: KEYCODE.DPAD_LEFT, meta: 0x1001 })
    expect(deviceKey(k('End', { ctrlKey: true }), 'win32')).toEqual({ keycode: KEYCODE.MOVE_END, meta: 0x1000 })
    // Every other Ctrl key stays Deck's, and on macOS Ctrl isn't the editing modifier.
    expect(deviceKey(k('a', { ctrlKey: true }), 'win32')).toBeNull()
    expect(deviceKey(k('Tab', { ctrlKey: true }), 'win32')).toBeNull()
    expect(deviceKey(k('Backspace', { ctrlKey: true }), 'darwin')).toBeNull()
  })

  it('a browser-reported AltGr can only add to the Ctrl+Alt guess, never remove it', () => {
    expect(deviceKey(k('@', { ctrlKey: true, altKey: true, altGraph: true }), 'win32')).toEqual({ text: '@' })
    // Windows itself treats Ctrl+Alt as AltGr whenever it produces a character, and Chromium may
    // report AltGraph only for the right-hand key, so a reported false must not drop it.
    expect(deviceKey(k('t', { ctrlKey: true, altKey: true, altGraph: false }), 'win32')).toEqual({ text: 't' })
    expect(deviceKey(k('@', { ctrlKey: true, altKey: true }), 'win32')).toEqual({ text: '@' })
    expect(deviceKey(k('ArrowLeft', { altKey: true, altGraph: true }), 'win32')).toEqual({ keycode: KEYCODE.DPAD_LEFT, meta: 0 })
    expect(deviceKey(k('@', { altGraph: true }), 'win32')).toEqual({ text: '@' })
  })
})
