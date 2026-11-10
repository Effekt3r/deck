import { HID_KEY, HID_MOD } from '@shared/hid'
import { buttonEvent, HOME_BUTTON, keyEvent, touchEvent } from './proto'

/** The screen in points, as idb takes touches. */
export interface Points {
  width: number
  height: number
}

const SPACE = 44
const LEFT_CTRL = 224
const LEFT_SHIFT = 225
const LEFT_ALT = 226
const LEFT_GUI = 227

/** The renderer's modifier bits as their keys, pressed in this order and let go in reverse. */
const MODIFIERS: [number, number][] = [[HID_MOD.SHIFT, LEFT_SHIFT], [HID_MOD.CTRL, LEFT_CTRL], [HID_MOD.ALT, LEFT_ALT], [HID_MOD.CMD, LEFT_GUI]]

const NAMED = new Set<number>(Object.values(HID_KEY))

/** A US keyboard's characters: [usage, Shift held]. */
const US = new Map<string, [number, boolean]>()
for (let i = 0; i < 26; i++) {
  US.set(String.fromCharCode(97 + i), [4 + i, false])
  US.set(String.fromCharCode(65 + i), [4 + i, true])
}
;[...'1234567890'].forEach((c, i) => US.set(c, [30 + i, false]))
;[...'!@#$%^&*()'].forEach((c, i) => US.set(c, [30 + i, true]))
for (const [plain, shifted, usage] of [
  ['-', '_', 45], ['=', '+', 46], ['[', '{', 47], [']', '}', 48], ['\\', '|', 49], [';', ':', 51],
  ["'", '"', 52], ['`', '~', 53], [',', '<', 54], ['.', '>', 55], ['/', '?', 56],
] as const) {
  US.set(plain, [usage, false])
  US.set(shifted, [usage, true])
}
US.set('\n', [HID_KEY.ENTER, false])
US.set('\t', [HID_KEY.TAB, false])
US.set(' ', [SPACE, false])

/** Text typed or pasted on a simulator goes key by key: at most this many characters. */
export const MAX_TEXT = 1000

function press(modifiers: number[], usage: number): Buffer[] {
  return [
    ...modifiers.map((k) => keyEvent(k, false)),
    keyEvent(usage, false),
    keyEvent(usage, true),
    ...[...modifiers].reverse().map((k) => keyEvent(k, true)),
  ]
}

/** A US keyboard's keys for `text`, newlines as Return. A simulator gets what that keyboard types:
 *  other characters are skipped. A paste goes the same way, not through the simulator's pasteboard,
 *  since iOS would ask "would like to paste from CoreSimulatorBridge" every time. */
export function typeText(text: string): Buffer[] {
  const events: Buffer[] = []
  for (const c of [...text.replace(/\r\n?/g, '\n')].slice(0, MAX_TEXT)) {
    const key = US.get(c)
    if (key) events.push(...press(key[1] ? [LEFT_SHIFT] : [], key[0]))
  }
  return events
}

const finite = (v: unknown): v is number => typeof v === 'number' && Number.isFinite(v)
const clamp = (v: number, max: number) => Math.min(Math.max(v, 0), max)

/** The renderer's input for a simulator, checked and turned into idb's HID events; none for what a
 *  simulator has no use for (Android's key codes, the wheel: a simulator scrolls by dragging). */
export function simulatorEvents(input: unknown, points: Points): Buffer[] {
  if (typeof input !== 'object' || input === null) return []
  const i = input as Record<string, unknown>
  switch (i.type) {
    case 'touch': {
      if (i.action !== 'down' && i.action !== 'move' && i.action !== 'up') return []
      if (!finite(i.x) || !finite(i.y) || !finite(i.width) || !finite(i.height)) return []
      if (i.width < 1 || i.height < 1 || i.width > 65535 || i.height > 65535) return []
      // The frame is the screen scaled down, so a pixel of it scales to points by the same ratios.
      const x = clamp(i.x, i.width) * (points.width / i.width)
      const y = clamp(i.y, i.height) * (points.height / i.height)
      return [touchEvent(x, y, i.action === 'up')]
    }
    case 'text':
    case 'paste':
      return typeof i.text === 'string' ? typeText(i.text) : []
    case 'hid': {
      const { usage, modifiers } = i
      if (typeof usage !== 'number' || !NAMED.has(usage)) return []
      if (typeof modifiers !== 'number' || !Number.isInteger(modifiers) || modifiers < 0 || modifiers > 15) return []
      return press(MODIFIERS.filter(([bit]) => (modifiers & bit) !== 0).map(([, key]) => key), usage)
    }
    case 'button':
      return i.button === 'home' ? [buttonEvent(HOME_BUTTON, false), buttonEvent(HOME_BUTTON, true)] : []
    default:
      return []
  }
}
