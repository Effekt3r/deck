import { describe, expect, it } from 'vitest'
import { keyAction, type KeyInput } from './keys'

const k = (key: string, mods: Partial<KeyInput> = {}): KeyInput =>
  ({ type: 'keydown', key, shiftKey: false, ctrlKey: false, metaKey: false, altKey: false, ...mods })

describe('keyAction', () => {
  it('Shift+Enter is a newline for Claude on every platform', () => {
    expect(keyAction(k('Enter', { shiftKey: true }), 'darwin', false)).toBe('newline')
    expect(keyAction(k('Enter', { shiftKey: true }), 'win32', false)).toBe('newline')
    expect(keyAction(k('Enter'), 'darwin', false)).toBeNull()
    expect(keyAction({ ...k('Enter', { shiftKey: true }), type: 'keyup' }, 'darwin', false)).toBeNull()
  })
  it('macOS leaves copy and paste to the Edit menu; Cmd+F finds', () => {
    expect(keyAction(k('c', { metaKey: true }), 'darwin', true)).toBeNull()
    expect(keyAction(k('f', { metaKey: true }), 'darwin', false)).toBe('find')
  })
  it('Windows: Ctrl+Shift+C/V, Ctrl+C only with a selection, Ctrl+V pastes', () => {
    expect(keyAction(k('C', { ctrlKey: true, shiftKey: true }), 'win32', true)).toBe('copy')
    expect(keyAction(k('V', { ctrlKey: true, shiftKey: true }), 'win32', false)).toBe('paste')
    expect(keyAction(k('c', { ctrlKey: true }), 'win32', true)).toBe('copy')
    expect(keyAction(k('c', { ctrlKey: true }), 'win32', false)).toBeNull() // SIGINT goes through
    expect(keyAction(k('v', { ctrlKey: true }), 'win32', false)).toBe('paste')
    expect(keyAction(k('F', { ctrlKey: true, shiftKey: true }), 'win32', false)).toBe('find')
  })
  it('hands Ctrl+Tab and Ctrl+Shift+Tab to the menu off macOS (xterm would send \\t / ESC [Z)', () => {
    expect(keyAction(k('Tab', { ctrlKey: true }), 'win32', false)).toBe('menu')
    expect(keyAction(k('Tab', { ctrlKey: true, shiftKey: true }), 'win32', false)).toBe('menu')
    expect(keyAction(k('Tab', { ctrlKey: true }), 'darwin', false)).toBeNull()
    expect(keyAction(k('Tab'), 'win32', false)).toBeNull()
    expect(keyAction(k('Tab', { shiftKey: true }), 'win32', false)).toBeNull()
  })
  it("Windows: Deck's own Ctrl+Shift shortcuts go to the menu, not the shell", () => {
    for (const key of ['T', 'W', 'O']) {
      expect(keyAction(k(key, { ctrlKey: true, shiftKey: true, code: `Key${key}` }), 'win32', false)).toBe('menu')
    }
    // Tab N: Shift makes the US key '!', the physical key stays Digit1.
    expect(keyAction(k('!', { ctrlKey: true, shiftKey: true, code: 'Digit1' }), 'win32', false)).toBe('menu')
    expect(keyAction(k('(', { ctrlKey: true, shiftKey: true, code: 'Digit9' }), 'win32', false)).toBe('menu')
    expect(keyAction(k(')', { ctrlKey: true, shiftKey: true, code: 'Digit0' }), 'win32', false)).toBeNull()
    // AltGr (Ctrl+Alt) + digit types characters such as { [ on German layouts.
    expect(keyAction(k('{', { ctrlKey: true, altKey: true, code: 'Digit7' }), 'win32', false)).toBeNull()
  })
  it('matches letters by physical key, so non-Latin layouts work', () => {
    expect(keyAction(k('с', { ctrlKey: true, code: 'KeyC' }), 'win32', true)).toBe('copy') // Cyrillic es
    expect(keyAction(k('м', { ctrlKey: true, code: 'KeyV' }), 'win32', false)).toBe('paste')
    expect(keyAction(k('А', { ctrlKey: true, shiftKey: true, code: 'KeyF' }), 'win32', false)).toBe('find')
    expect(keyAction(k('а', { metaKey: true, code: 'KeyF' }), 'darwin', false)).toBe('find')
  })
  it('leaves other modified Enters and plain Ctrl keys to the terminal', () => {
    expect(keyAction(k('Enter', { shiftKey: true, ctrlKey: true }), 'win32', false)).toBeNull()
    expect(keyAction(k('Enter', { shiftKey: true, metaKey: true }), 'darwin', false)).toBeNull()
    expect(keyAction(k('f', { ctrlKey: true }), 'win32', false)).toBeNull() // readline forward-char
    expect(keyAction(k('f', { ctrlKey: true }), 'darwin', false)).toBeNull()
    expect(keyAction(k('v', { ctrlKey: true }), 'darwin', false)).toBeNull() // literal next
  })
})
