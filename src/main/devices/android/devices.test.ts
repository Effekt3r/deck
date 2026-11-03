import { describe, expect, it } from 'vitest'
import { type AdbEntry, deviceId, IDENTITY_SCRIPT, type Identity, mergeDevices, parseDeviceLines, parseIdentity, readTrackFrames, type Seen } from './devices'

/** A list as `adb track-devices` sends it: its length in four hex digits, then the lines. */
const frame = (text: string) => Buffer.from(Buffer.byteLength(text).toString(16).padStart(4, '0') + text)

/** The same list, but as adb writes it on Windows: an extra "\r" before each "\n", which the
 *  length (counted on the LF text, as adb does) doesn't include. */
const crlfFrame = (text: string) => Buffer.from(Buffer.byteLength(text).toString(16).padStart(4, '0') + text.replace(/\n/g, '\r\n'))

// As adb listed Franco's devices on 2026-11-03.
const C66 = '8d2e61a              device usb:34603008X product:C66 model:C66 device:C66 transport_id:32410\n'
const S25_USB = 'R5CW20XY7QZ            device usb:17825792X product:r13sxxx model:SM_S731B device:r13s transport_id:32564\n'
const S25_WIFI = 'adb-R5CW20XY7QZ-Xk3Tq9._adb-tls-connect._tcp device product:r13sxxx model:SM_S731B device:r13s transport_id:32565\n'
const EMULATOR = 'emulator-5554          device product:sdk_gphone64_arm64 model:sdk_gphone64_arm64 device:emu64a transport_id:30144\n'
// As adb would list the S25 over USB on Windows: no `usb:` field (Windows' own USB driver gives
// adb no device path).
const S25_USB_WIN = 'R5CW20XY7QZ            device product:r13sxxx model:SM_S731B device:r13s transport_id:3\n'

const identity = (over: Partial<Identity>): Identity => ({ serialNo: '', maker: '', model: '', release: '', booted: true, avd: '', name: '', ...over })
const c66 = identity({ serialNo: '8d2e61a', maker: 'CHAINWAY', model: 'C66', release: '13', name: 'C66' })
const s25 = identity({ serialNo: 'R5CW20XY7QZ', maker: 'samsung', model: 'SM-S731B', release: '17', name: "Franco's S25 FE" })
const emu = identity({ serialNo: 'EMULATOR37X2X12X0', maker: 'Google', model: 'sdk_gphone64_arm64', release: '15', avd: 'Pixel_9', name: 'sdk_gphone64_arm64' })
const entry = (line: string) => parseDeviceLines(line)[0]

describe('parseDeviceLines', () => {
  it('reads the serial, state, cable and connection', () => {
    expect(parseDeviceLines(C66 + S25_WIFI)).toEqual([
      { serial: '8d2e61a', state: 'device', usb: true, model: 'C66', transport: '32410' },
      { serial: 'adb-R5CW20XY7QZ-Xk3Tq9._adb-tls-connect._tcp', state: 'device', usb: false, model: 'SM_S731B', transport: '32565' },
    ])
  })

  it('reads a device not allowed yet, and skips blank lines', () => {
    expect(parseDeviceLines('\n8d2e61a unauthorized usb:34603008X transport_id:7\n\n')).toEqual([
      { serial: '8d2e61a', state: 'unauthorized', usb: true, model: '', transport: '7' },
    ])
  })
})

describe('readTrackFrames', () => {
  it('reads every complete list and keeps the rest for the next chunk', () => {
    const all = Buffer.concat([frame(C66), frame(C66 + EMULATOR), frame(S25_USB)])
    const cut = all.length - 5
    const first = readTrackFrames(all.subarray(0, cut))
    expect(first.lists.map((list) => list.map((e) => e.serial))).toEqual([['8d2e61a'], ['8d2e61a', 'emulator-5554']])
    const second = readTrackFrames(Buffer.concat([first.rest, all.subarray(cut)]))
    expect(second.lists.map((list) => list.map((e) => e.serial))).toEqual([['R5CW20XY7QZ']])
    expect(second.rest.length).toBe(0)
  })

  it('reads an empty list: every device unplugged', () => {
    expect(readTrackFrames(Buffer.from('0000')).lists).toEqual([[]])
  })

  it("refuses output that isn't a list", () => {
    expect(() => readTrackFrames(Buffer.from('* daemon started'))).toThrow(/unexpected output/)
  })

  it('keeps a 4-digit header cut between chunks', () => {
    const first = readTrackFrames(frame(C66).subarray(0, 2))
    expect(first.lists).toEqual([])
    expect(first.rest.equals(frame(C66).subarray(0, 2))).toBe(true)
    const second = readTrackFrames(Buffer.concat([first.rest, frame(C66).subarray(2)]))
    expect(second.lists.map((list) => list.map((e) => e.serial))).toEqual([['8d2e61a']])
  })

  it('drops Windows CRLF line endings, which the hex length does not count', () => {
    const all = Buffer.concat([crlfFrame(C66 + S25_USB), crlfFrame(EMULATOR)])
    let rest: Buffer = Buffer.alloc(0)
    const lists: AdbEntry[][] = []
    for (let at = 0; at < all.length; at += 7) {
      const result = readTrackFrames(Buffer.concat([rest, all.subarray(at, at + 7)]))
      lists.push(...result.lists)
      rest = result.rest
    }
    expect(lists.map((list) => list.map((e) => `${e.serial} ${e.transport}`))).toEqual([
      ['8d2e61a 32410', 'R5CW20XY7QZ 32564'],
      ['emulator-5554 30144'],
    ])
    expect(rest.length).toBe(0)
  })
})

describe('parseIdentity', () => {
  it("reads the script's lines, CRLF and the \"null\" of a missing setting included", () => {
    expect(parseIdentity('serial=8d2e61a\r\nmaker=CHAINWAY\r\nmodel=C66\r\nrelease=13\r\nbooted=1\r\navd=\r\nname=null\r\n'))
      .toEqual(identity({ serialNo: '8d2e61a', maker: 'CHAINWAY', model: 'C66', release: '13' }))
  })

  it('asks for everything it reads', () => {
    for (const key of ['serial=', 'maker=', 'model=', 'release=', 'booted=', 'avd=', 'avd_old=', 'name=']) expect(IDENTITY_SCRIPT).toContain(key)
  })

  it('prefers the newer AVD property over the older one', () => {
    expect(parseIdentity('avd=\navd_old=Pixel_4\n').avd).toBe('Pixel_4')
  })

  it('keeps the first value for a key, not a later one', () => {
    expect(parseIdentity('serial=REAL\nname=x\nserial=FAKE\n').serialNo).toBe('REAL')
  })
})

describe('deviceId', () => {
  it("is a phone's serial number, or an emulator's AVD name", () => {
    expect(deviceId({ entry: entry(C66), identity: c66 })).toBe('android:8d2e61a')
    expect(deviceId({ entry: entry(EMULATOR), identity: emu })).toBe('emulator:Pixel_9')
  })

  it("before the device answers: its USB name, or the serial inside a Wi-Fi (mDNS) name", () => {
    expect(deviceId({ entry: entry(C66), identity: null })).toBe('android:8d2e61a')
    expect(deviceId({ entry: entry(S25_WIFI), identity: null })).toBe('android:R5CW20XY7QZ')
  })

  it('reads the serial out of a Wi-Fi (mDNS) name with a trailing dot', () => {
    const line = 'adb-R5CW20XY7QZ-Xk3Tq9._adb-tls-connect._tcp. device product:r13sxxx model:SM_S731B device:r13s transport_id:1\n'
    expect(deviceId({ entry: entry(line), identity: null })).toBe('android:R5CW20XY7QZ')
  })

  it("is an ip:port Wi-Fi phone's own address before it answers", () => {
    const line = '192.168.1.5:5555 device product:r13sxxx model:SM_S731B device:r13s transport_id:40\n'
    expect(deviceId({ entry: entry(line), identity: null })).toBe('android:192.168.1.5:5555')
  })
})

describe('mergeDevices', () => {
  it('lists one device per phone, reached over USB first, phones before emulators', () => {
    const seen: Seen[] = [
      { entry: entry(EMULATOR), identity: emu },
      { entry: entry(S25_WIFI), identity: s25 },
      { entry: entry(C66), identity: c66 },
      { entry: entry(S25_USB), identity: s25 },
    ]
    const { devices, serials } = mergeDevices(seen)
    expect(devices).toEqual([
      { id: 'android:8d2e61a', kind: 'android', name: 'C66', detail: 'Android 13 · USB', state: 'ready' },
      { id: 'android:R5CW20XY7QZ', kind: 'android', name: "Franco's S25 FE", detail: 'Android 17 · USB + Wi-Fi', state: 'ready' },
      { id: 'emulator:Pixel_9', kind: 'emulator', name: 'Pixel 9', detail: 'Emulator · Android 15', state: 'ready' },
    ])
    expect(serials.get('android:R5CW20XY7QZ')).toBe('R5CW20XY7QZ')
    expect(serials.get('emulator:Pixel_9')).toBe('emulator-5554')
  })

  it('carries on over Wi-Fi when the cable is pulled, or its connection is offline', () => {
    const wifi = 'adb-R5CW20XY7QZ-Xk3Tq9._adb-tls-connect._tcp'
    const pulled = mergeDevices([{ entry: entry(S25_WIFI), identity: s25 }])
    expect(pulled.devices[0].detail).toBe('Android 17 · Wi-Fi')
    expect(pulled.serials.get('android:R5CW20XY7QZ')).toBe(wifi)
    const offline = mergeDevices([{ entry: { ...entry(S25_USB), state: 'offline' }, identity: null }, { entry: entry(S25_WIFI), identity: s25 }])
    expect(offline.devices).toEqual([{ id: 'android:R5CW20XY7QZ', kind: 'android', name: "Franco's S25 FE", detail: 'Android 17 · Wi-Fi', state: 'ready' }])
    expect(offline.serials.get('android:R5CW20XY7QZ')).toBe(wifi)
  })

  it("names a device that couldn't answer by adb's model, else its adb name", () => {
    const { devices } = mergeDevices([
      { entry: entry('8d2e61a unauthorized usb:1 transport_id:7\n'), identity: null },
      { entry: entry(S25_WIFI), identity: null },
    ])
    expect(devices.map((d) => [d.name, d.state, d.detail])).toEqual([
      ['8d2e61a', 'unauthorized', 'USB'],
      ['SM S731B', 'ready', 'Wi-Fi'],
    ])
  })

  it('treats a cable with no usb: field (Windows) as USB, merged with its Wi-Fi connection', () => {
    const win = entry(S25_USB_WIN)
    expect(win.usb).toBe(true)
    const { devices, serials } = mergeDevices([
      { entry: entry(S25_WIFI), identity: s25 },
      { entry: win, identity: s25 },
    ])
    expect(devices).toEqual([
      { id: 'android:R5CW20XY7QZ', kind: 'android', name: "Franco's S25 FE", detail: 'Android 17 · USB + Wi-Fi', state: 'ready' },
    ])
    expect(serials.get('android:R5CW20XY7QZ')).toBe('R5CW20XY7QZ')
  })

  it('lists nothing for an emulator still starting (offline, unanswered)', () => {
    expect(mergeDevices([{ entry: entry('emulator-5554 offline transport_id:9\n'), identity: null }]).devices).toEqual([])
  })

  it('joins an ip:port (Wi-Fi) phone with its USB connection once it answers', () => {
    const line = '192.168.1.5:5555 device product:r13sxxx model:SM_S731B device:r13s transport_id:40\n'
    const { devices } = mergeDevices([
      { entry: entry(line), identity: s25 },
      { entry: entry(S25_USB), identity: s25 },
    ])
    expect(devices).toEqual([
      { id: 'android:R5CW20XY7QZ', kind: 'android', name: "Franco's S25 FE", detail: 'Android 17 · USB + Wi-Fi', state: 'ready' },
    ])
  })

  it('names a phone by its maker and model when it has none of its own', () => {
    const noName = identity({ serialNo: 'AAA111', maker: 'samsung', model: 'SM-S731B', release: '14' })
    const named = mergeDevices([{ entry: entry('AAA111 device usb:1 transport_id:1\n'), identity: noName }])
    expect(named.devices[0].name).toBe('Samsung SM-S731B')

    const moto = identity({ serialNo: 'BBB222', maker: 'motorola', model: 'motorola edge', release: '14' })
    const namedMoto = mergeDevices([{ entry: entry('BBB222 device usb:1 transport_id:2\n'), identity: moto }])
    expect(namedMoto.devices[0].name).toBe('motorola edge')
  })
})
