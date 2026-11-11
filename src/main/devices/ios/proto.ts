/** idb's gRPC messages, as Deck uses them, written by hand: HID events (touches, the Home button,
 *  keys) and describe's answer. Field numbers follow idb's proto/idb.proto (MIT, Meta Platforms; see
 *  resources/THIRD-PARTY-NOTICES.txt). Fields are all written, as protobufjs writes them. */

export const DESCRIBE_PATH = '/idb.CompanionService/describe'
export const HID_PATH = '/idb.CompanionService/hid'

/** HIDEvent.HIDButtonType.HOME */
export const HOME_BUTTON = 1

function varint(n: number): number[] {
  if (!Number.isSafeInteger(n) || n < 0) throw new Error(`A varint for ${n}.`)
  const out: number[] = []
  let v = n
  do {
    let byte = v % 128
    v = Math.floor(v / 128)
    if (v > 0) byte |= 0x80
    out.push(byte)
  } while (v > 0)
  return out
}

const tag = (field: number, wire: number) => varint(field * 8 + wire)
const bytesField = (field: number, payload: Buffer) => Buffer.concat([Buffer.from([...tag(field, 2), ...varint(payload.length)]), payload])
const varintField = (field: number, n: number) => Buffer.from([...tag(field, 0), ...varint(n)])

function doubleField(field: number, x: number): Buffer {
  const out = Buffer.alloc(9)
  out[0] = tag(field, 1)[0] // fields 1 and 2: a one-byte tag
  out.writeDoubleLE(x, 1)
  return out
}

/** HIDEvent { press: HIDPress { action, direction } }: direction DOWN 0, UP 1. */
function press(action: Buffer, up: boolean): Buffer {
  return bytesField(1, Buffer.concat([bytesField(1, action), varintField(2, up ? 1 : 0)]))
}

/** A finger down or up at a point, in the screen's points. idb has no move: a finger put down
 *  somewhere else moves there. */
export function touchEvent(x: number, y: number, up: boolean): Buffer {
  const point = Buffer.concat([doubleField(1, x), doubleField(2, y)])
  return press(bytesField(1, bytesField(1, point)), up) // HIDPressAction.touch: HIDTouch { point }
}

/** A hardware button (HIDButtonType) pressed or let go. */
export function buttonEvent(button: number, up: boolean): Buffer {
  return press(bytesField(2, varintField(1, button)), up)
}

/** A key, by its USB HID usage (keyboard page), pressed or let go. */
export function keyEvent(usage: number, up: boolean): Buffer {
  return press(bytesField(3, varintField(1, usage)), up)
}

interface Field {
  field: number
  wire: number
  value: number | Buffer
}

/** A message's fields in order: varints and doubles as numbers, length-delimited ones as bytes. */
function fields(buf: Buffer): Field[] {
  const out: Field[] = []
  let at = 0
  const need = (n: number) => {
    if (at + n > buf.length) throw new Error("idb's answer is truncated.")
  }
  const readVarint = (): number => {
    let result = 0
    let scale = 1
    for (;;) {
      need(1)
      const byte = buf[at++]
      result += (byte & 0x7f) * scale
      if (byte < 0x80) return result
      scale *= 128
      if (scale > 2 ** 63) throw new Error("idb's answer has a varint too long.")
    }
  }
  while (at < buf.length) {
    const key = readVarint()
    const field = Math.floor(key / 8)
    const wire = key % 8
    if (wire === 0) out.push({ field, wire, value: readVarint() })
    else if (wire === 1) {
      need(8)
      out.push({ field, wire, value: buf.readDoubleLE(at) })
      at += 8
    } else if (wire === 2) {
      const n = readVarint()
      need(n)
      out.push({ field, wire, value: buf.subarray(at, at + n) })
      at += n
    } else if (wire === 5) {
      need(4)
      at += 4 // a 32-bit field: none that Deck reads
    } else throw new Error(`Wire type ${wire} isn't protobuf's.`)
  }
  return out
}

const message = (fs: Field[], n: number): Buffer | undefined => {
  const f = fs.find((x) => x.field === n && x.wire === 2)
  return f ? (f.value as Buffer) : undefined
}
const number = (fs: Field[], n: number): number => {
  const f = fs.find((x) => x.field === n && x.wire !== 2)
  return typeof f?.value === 'number' ? f.value : 0
}

/** A simulator's screen: in pixels, and in the points touches are given in. */
export interface ScreenSize {
  width: number
  height: number
  widthPoints: number
  heightPoints: number
}

/** describe's answer: TargetDescriptionResponse.target_description.screen_dimensions. */
export function parseDescribe(answer: Buffer): ScreenSize {
  const target = message(fields(answer), 1)
  const screen = target && message(fields(target), 3)
  if (!screen) throw new Error("The simulator didn't say its screen size.")
  const s = fields(screen)
  const size = { width: number(s, 1), height: number(s, 2), widthPoints: number(s, 4), heightPoints: number(s, 5) }
  if (Object.values(size).some((v) => !Number.isInteger(v) || v <= 0 || v > 65535)) {
    throw new Error("The simulator's screen size makes no sense.")
  }
  return size
}

/** gRPC's length-prefixed message: a zero byte (not compressed), then the length, big-endian. */
export function grpcFrame(payload: Buffer): Buffer {
  const head = Buffer.alloc(5)
  head.writeUInt32BE(payload.length, 1)
  return Buffer.concat([head, payload])
}

/** The messages in a gRPC body. Deck asks for no compression, so a compressed one is refused. */
export function grpcMessages(body: Buffer): Buffer[] {
  const out: Buffer[] = []
  let at = 0
  while (at < body.length) {
    if (at + 5 > body.length) throw new Error('A truncated gRPC message.')
    if (body[at] !== 0) throw new Error('A compressed gRPC message.')
    const n = body.readUInt32BE(at + 1)
    if (at + 5 + n > body.length) throw new Error('A truncated gRPC message.')
    out.push(body.subarray(at + 5, at + 5 + n))
    at += 5 + n
  }
  return out
}
