import { execFile } from 'node:child_process'
import { existsSync } from 'node:fs'
import { resolve } from 'node:path'
import { describe, expect, it } from 'vitest'
import { CODEC_H264, VideoReader } from '../android/protocol'

/** The helper as `npm ci` builds it on macOS (scripts/build-iphone-helper.mjs). */
const HELPER = resolve('native', 'iphone-screen', 'out', 'iphone-screen')

/** The NAL unit types in a packet, by their start codes (H.264 escapes 00 00 00 inside a NAL unit). */
function nalTypes(data: Uint8Array): number[] {
  const types: number[] = []
  for (let i = 0; i + 4 < data.length; i++) {
    if (data[i] === 0 && data[i + 1] === 0 && data[i + 2] === 0 && data[i + 3] === 1) types.push(data[i + 4] & 0x1f)
  }
  return types
}

// No capture device and no camera: `selftest` encodes made-up frames. Skipped off macOS, and on a Mac
// without Xcode's command line tools, which builds no helper.
describe.skipIf(process.platform !== 'darwin' || !existsSync(HELPER))("the iPhone helper's selftest", () => {
  it("scales, encodes and frames made-up frames as scrcpy's stream, with a new session when they turn", async () => {
    const stdout = await new Promise<Buffer>((done, failed) => {
      execFile(HELPER, ['selftest'], { encoding: 'buffer', maxBuffer: 64 * 1024 * 1024, timeout: 20_000 }, (err, out) => (err ? failed(err) : done(out)))
    })
    const events = new VideoReader({ from: 'codec', sender: "Deck's iPhone helper" }).feed(stdout)
    expect(events[0]).toEqual({ type: 'codec', codec: CODEC_H264 })
    expect(events.filter((e) => e.type === 'error')).toEqual([])
    // 1206×2622 within 1600 px, in even numbers, then turned.
    expect(events.filter((e) => e.type === 'size')).toEqual([
      { type: 'size', width: 736, height: 1600 },
      { type: 'size', width: 1600, height: 736 },
    ])
    // | a new size, c a config packet, k a key frame, p any other frame: every key frame behind a
    // config (the first of each size, and the one asked for at the fourth frame).
    const shape = events.slice(1).map((e) => (e.type === 'size' ? '|' : e.type === 'packet' ? (e.config ? 'c' : e.key ? 'k' : 'p') : '?')).join('')
    expect(shape).toBe('|ckppckpp|ckppppp')
    for (const e of events) {
      if (e.type !== 'packet') continue
      if (e.config) expect(nalTypes(e.data)).toEqual([7, 8]) // SPS, PPS
      else if (e.key) expect(nalTypes(e.data)).toContain(5) // an IDR picture
      else expect(nalTypes(e.data)).not.toContain(5)
    }
  }, 30_000)
})
