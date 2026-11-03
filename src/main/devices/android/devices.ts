import type { DeviceInfo } from '@shared/types'

/** One line of `adb track-devices -l`. */
export interface AdbEntry {
  /** adb's name for it: `8d2e61a`, `emulator-5554`, `adb-R5CW20XY7QZ-Xk3Tq9._adb-tls-connect._tcp`,
   *  `192.168.1.5:5555`. */
  serial: string
  /** device, unauthorized, offline, authorizing, connecting, recovery … */
  state: string
  /** By cable: adb lists a `usb:` field, except with Windows' own USB driver, so a name that isn't
   *  an emulator's or a network one counts as a cable too. */
  usb: boolean
  /** adb's model field (`SM_S731B`); '' when adb doesn't know it. */
  model: string
  /** New with every connection, so a device that reconnects (or another emulator on the same port)
   *  is asked again what it is. */
  transport: string
}

/** A network connection's adb name: `ip:port`, or an mDNS service name (Wi-Fi debugging). */
const NETWORK = /:\d+$|\._adb(-tls-connect)?\._tcp\.?$/

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
    // Windows' own USB driver gives adb no device path, so a cable there lists no `usb:` field
    // either: a name that isn't an emulator's or a network one counts as a cable too.
    const usb = attrs.has('usb') || !(serial.startsWith('emulator-') || NETWORK.test(serial))
    entries.push({ serial, state, usb, model: attrs.get('model') ?? '', transport: attrs.get('transport_id') ?? '' })
  }
  return entries
}

/** `adb track-devices -l` writes each list as four hex digits of length, then that many bytes. The
 *  lists complete in `buf`, and what's left of the next one. Throws on a length that isn't hex. */
export function readTrackFrames(input: Buffer): { lists: AdbEntry[][]; rest: Buffer } {
  // On Windows adb writes this stream in text mode, so each "\n" may arrive as "\r\n", which the
  // lengths don't count. adb's own lists hold no "\r": drop them all before counting.
  const buf = input.includes(0x0d) ? Buffer.from(input.toString('latin1').replace(/\r/g, ''), 'latin1') : input
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
  'echo "booted=$(getprop sys.boot_completed)"',
  // ro.boot on recent emulator images, ro.kernel on older ones; both empty on phones.
  'echo "avd=$(getprop ro.boot.qemu.avd_name)"',
  'echo "avd_old=$(getprop ro.kernel.qemu.avd_name)"',
  'echo "name=$(settings get global device_name 2>/dev/null)"',
].join('; ')

export interface Identity {
  serialNo: string
  maker: string
  model: string
  release: string
  /** Android has finished starting; before that the phone's own name can't be read. */
  booted: boolean
  /** An emulator's AVD name; '' on a phone. */
  avd: string
  /** The name set on the phone; '' when there's none. */
  name: string
}

export function parseIdentity(stdout: string): Identity {
  const values = new Map<string, string>()
  for (const line of stdout.split(/\r?\n/)) {
    const i = line.indexOf('=')
    if (i <= 0) continue
    const key = line.slice(0, i).trim()
    // The first value for a key wins: the name is printed last, and one holding a newline plus
    // "serial=…" must not replace the device's real serial.
    if (!values.has(key)) values.set(key, line.slice(i + 1).trim())
  }
  // `settings get` prints "null" for a setting that isn't there.
  const get = (key: string) => {
    const value = values.get(key) ?? ''
    return value === 'null' ? '' : value
  }
  return {
    serialNo: get('serial'),
    maker: get('maker'),
    model: get('model'),
    release: get('release'),
    booted: get('booted') === '1',
    avd: get('avd') || get('avd_old'),
    name: get('name'),
  }
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
    // An emulator that hasn't answered yet (still starting) is known only by its port: listed, its
    // name and id would change once it answers.
    if (isEmulator(s) && !s.identity && stateOf(s.entry.state) !== 'ready') continue
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
