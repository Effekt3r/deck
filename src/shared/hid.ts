/** USB HID keyboard usages (page 7) for the named keys a simulator gets; typing goes as text. */
export const HID_KEY = {
  ENTER: 40, ESCAPE: 41, BACKSPACE: 42, TAB: 43, HOME: 74, PAGE_UP: 75, DELETE: 76, END: 77,
  PAGE_DOWN: 78, RIGHT: 79, LEFT: 80, DOWN: 81, UP: 82,
} as const

/** The modifiers sent with a simulator's key, as bits; main presses their keys around it. */
export const HID_MOD = { SHIFT: 1, CTRL: 2, ALT: 4, CMD: 8 } as const
