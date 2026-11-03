import { keycodeMessage, scrollMessage, setClipboardMessage, textMessage, textPieces, touchMessage } from './protocol'

/** scrcpy's own client never sends more than 256 KiB per message; a clipboard message takes 14
 *  bytes of its own. */
const MAX_PASTE_BYTES = (1 << 18) - 14
const ACTIONS = new Set(['down', 'move', 'up'])

const num = (v: unknown, min: number, max: number): v is number => typeof v === 'number' && Number.isFinite(v) && v >= min && v <= max
const int = (v: unknown, min: number, max: number): v is number => num(v, min, max) && Number.isInteger(v)
/** A pixel index into a frame of the given size: 0 … size - 1. */
const coord = (v: unknown, size: number): v is number => typeof v === 'number' && Number.isFinite(v) && v >= 0 && v < size

/** The control messages for input from the renderer (a DeviceInput), checked first as every IPC
 *  listener checks its arguments: none for anything that isn't valid input. */
export function controlMessages(input: unknown): Buffer[] {
  if (typeof input !== 'object' || input === null) return []
  const { type, action, x, y, width, height, dx, dy, keycode, meta, text } = input as Record<string, unknown>
  switch (type) {
    case 'touch':
      if (typeof action !== 'string' || !ACTIONS.has(action)) return []
      if (!int(width, 1, 0xffff) || !int(height, 1, 0xffff) || !coord(x, width) || !coord(y, height)) return []
      return [touchMessage({ action: action as 'down' | 'move' | 'up', x, y, width, height })]
    case 'scroll':
      if (!int(width, 1, 0xffff) || !int(height, 1, 0xffff) || !coord(x, width) || !coord(y, height)) return []
      if (!num(dx, -16, 16) || !num(dy, -16, 16)) return []
      return [scrollMessage({ x, y, width, height, hscroll: dx, vscroll: dy })]
    case 'key':
      if (!int(keycode, 0, 1000) || !int(meta, 0, 0x7fffffff)) return []
      return [keycodeMessage('down', keycode, 0, meta), keycodeMessage('up', keycode, 0, meta)]
    case 'text':
      if (typeof text !== 'string' || text.length === 0 || text.length > 10_000) return []
      return textPieces(text).map(textMessage)
    case 'paste':
      if (typeof text !== 'string' || text.length === 0 || Buffer.byteLength(text, 'utf8') > MAX_PASTE_BYTES) return []
      return [setClipboardMessage(text, true)]
    default:
      return []
  }
}
