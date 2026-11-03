import type { DeviceInfo } from '@shared/types'

/** One line of `adb track-devices -l`. */
export interface AdbEntry {
  /** adb's name for it: `8d2e61a`, `emulator-5554`, `adb-R5CW20XY7QZ-Xk3Tq9._adb-tls-connect._tcp`,
   *  `192.168.1.5:5555`. */
  serial: string
  /** device, unauthorized, offline, authorizing, connecting, recovery … */
  state: string
  /** By cable: adb lists a `usb:` field. */
  usb: boolean
  /** adb's model field (`SM_S731B`); '' when adb doesn't know it. */
  model: string
  /** New with every connection, so a device that reconnects (or another emulator on the same port)
   *  is asked again what it is. */
  transport: string
}

/** Lines like `8d2e61a   device usb:34603008X product:C66 model:C66 device:C66 transport_id:32410`. */
export function parseDeviceLines(text: string): AdbEntry[] {
  const entries: AdbEntry[] = []
  for (const line of text.split('\n')) {
    const [serial, state, ...fields] = line.trim().split(/\s+/)
    if (!serial || !state) continue
    const attrs = new Map<string, string>()
    for (const field of fields) {
      const i = field.indexOf(':')
      if (i > 0) attrs.set(field.slice(0, i), field.slice(i + 1))
    }
    entries.push({ serial, state, usb: attrs.has('usb'), model: attrs.get('model') ?? '', transport: attrs.get('transport_id') ?? '' })
  }
  return entries
}

/** `adb track-devices -l` writes each list as four hex digits of length, then that many bytes. The
 *  lists complete in `buf`, and what's left of the next one. Throws on a length that isn't hex. */
export function readTrackFrames(buf: Buffer): { lists: AdbEntry[][]; rest: Buffer } {
  const lists: AdbEntry[][] = []
  let at = 0
  while (buf.length - at >= 4) {
    const head = buf.toString('latin1', at, at + 4)
    if (!/^[0-9a-f]{4}$/i.test(head)) throw new Error(`adb track-devices: unexpected output ${JSON.stringify(head)}`)
    const length = Number.parseInt(head, 16)
    if (buf.length - at - 4 < length) break
    lists.push(parseDeviceLines(buf.toString('utf8', at + 4, at + 4 + length)))
    at += 4 + length
  }
  return { lists, rest: buf.subarray(at) }
}

/** What Deck asks a device, in one `adb shell` call: one `key=value` line each. */
export const IDENTITY_SCRIPT = [
  'echo "serial=$(getprop ro.serialno)"',
  'echo "maker=$(getprop ro.product.manufacturer)"',
  'echo "model=$(getprop ro.product.model)"',
  'echo "release=$(getprop ro.build.version.release)"',
  // ro.boot on recent emulator images, ro.kernel on older ones; empty on phones.
  'echo "avd=$(getprop ro.boot.qemu.avd_name)$(getprop ro.kernel.qemu.avd_name)"',
  'echo "name=$(settings get global device_name 2>/dev/null)"',
].join('; ')

export interface Identity {
  serialNo: string
  maker: string
  model: string
  release: string
  /** An emulator's AVD name; '' on a phone. */
  avd: string
  /** The name set on the phone; '' when there's none. */
  name: string
}

export function parseIdentity(stdout: string): Identity {
  const values = new Map<string, string>()
  for (const line of stdout.split(/\r?\n/)) {
    const i = line.indexOf('=')
    if (i > 0) values.set(line.slice(0, i).trim(), line.slice(i + 1).trim())
  }
  // `settings get` prints "null" for a setting that isn't there.
  const get = (key: string) => {
    const value = values.get(key) ?? ''
    return value === 'null' ? '' : value
  }
  return { serialNo: get('serial'), maker: get('maker'), model: get('model'), release: get('release'), avd: get('avd'), name: get('name') }
}

/** An adb entry and what the device said it is: null before it answered, or when it can't
 *  (unauthorized, offline). */
export interface Seen {
  entry: AdbEntry
  identity: Identity | null
}

type State = DeviceInfo['state']
/** Best first. */
const STATES: readonly State[] = ['ready', 'connecting', 'unauthorized', 'offline']

function stateOf(adbState: string): State {
  if (adbState === 'device') return 'ready'
  if (adbState === 'unauthorized') return 'unauthorized'
  if (adbState === 'authorizing' || adbState === 'connecting') return 'connecting'
  return 'offline'
}

const isEmulator = (s: Seen) => s.entry.serial.startsWith('emulator-') || (s.identity?.avd ?? '') !== ''

/** A phone's serial number (its adb name over USB; inside its mDNS name over Wi-Fi, until it
 *  answers); an emulator's AVD name. */
export function deviceId(s: Seen): string {
  if (isEmulator(s)) return `emulator:${s.identity?.avd || s.entry.serial}`
  if (s.identity?.serialNo) return `android:${s.identity.serialNo}`
  const mdns = /^adb-(.+)-[^-.]+\._adb-tls-connect\._tcp\.?$/.exec(s.entry.serial)
  return `android:${mdns ? mdns[1] : s.entry.serial}`
}

/** A ready connection first, then by state; USB before Wi-Fi. */
const rank = (s: Seen) => STATES.indexOf(stateOf(s.entry.state)) * 2 + (s.entry.usb ? 0 : 1)

/** One device per phone or emulator (a phone over USB and Wi-Fi is one), phones first, by name;
 *  and the adb name to reach each by. */
export function mergeDevices(seen: readonly Seen[]): { devices: DeviceInfo[]; serials: Map<string, string> } {
  const groups = new Map<string, Seen[]>()
  for (const s of seen) {
    const id = deviceId(s)
    groups.set(id, [...(groups.get(id) ?? []), s])
  }
  const devices: DeviceInfo[] = []
  const serials = new Map<string, string>()
  for (const [id, group] of groups) {
    const best = [...group].sort((a, b) => rank(a) - rank(b))[0]
    const state = stateOf(best.entry.state)
    const identity = group.find((s) => s.identity)?.identity ?? null
    const emulator = id.startsWith('emulator:')
    serials.set(id, best.entry.serial)
    devices.push({
      id,
      kind: emulator ? 'emulator' : 'android',
      name: nameOf(best.entry, identity, emulator),
      // Only the connections in the best state: a cable that's offline isn't "USB + Wi-Fi".
      detail: detailOf(group.filter((s) => stateOf(s.entry.state) === state), identity, emulator),
      state,
    })
  }
  devices.sort((a, b) => (a.kind === b.kind ? a.name.localeCompare(b.name) : a.kind === 'android' ? -1 : 1))
  return { devices, serials }
}

const capitalised = (s: string) => s.charAt(0).toUpperCase() + s.slice(1)

function nameOf(entry: AdbEntry, identity: Identity | null, emulator: boolean): string {
  if (emulator) return (identity?.avd || entry.serial).replace(/_/g, ' ')
  if (identity?.name) return identity.name
  if (identity?.model) {
    const maker = identity.maker
    return maker && !identity.model.toLowerCase().startsWith(maker.toLowerCase()) ? `${capitalised(maker)} ${identity.model}` : identity.model
  }
  return entry.model.replace(/_/g, ' ') || entry.serial
}

function detailOf(connections: readonly Seen[], identity: Identity | null, emulator: boolean): string {
  const version = identity?.release ? `Android ${identity.release}` : ''
  if (emulator) return ['Emulator', version].filter(Boolean).join(' · ')
  const usb = connections.some((s) => s.entry.usb)
  const wifi = connections.some((s) => !s.entry.usb)
  return [version, usb && wifi ? 'USB + Wi-Fi' : usb ? 'USB' : 'Wi-Fi'].filter(Boolean).join(' · ')
}
