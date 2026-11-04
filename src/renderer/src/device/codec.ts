/** The NAL units of an Annex B buffer, each after a 00 00 01 or 00 00 00 01 start code. */
export function nalUnits(data: Uint8Array): Uint8Array[] {
  const starts: number[] = []
  for (let i = 0; i + 2 < data.length; i++) {
    if (data[i] === 0 && data[i + 1] === 0 && data[i + 2] === 1) {
      starts.push(i + 3)
      i += 2
    }
  }
  return starts.map((start, n) => {
    if (n + 1 === starts.length) return data.subarray(start)
    let end = starts[n + 1] - 3
    if (end > start && data[end - 1] === 0) end-- // the extra zero of a four-byte start code
    return data.subarray(start, end)
  })
}

const hex2 = (n: number) => n.toString(16).padStart(2, '0')

/** WebCodecs' codec string for the H.264 stream a config packet opens: avc1.PPCCLL (profile,
 *  constraint flags and level, from its SPS); null when it holds no SPS. The constraint byte's two
 *  reserved bits are masked off: some encoders set them, and Chromium refuses a codec string that
 *  carries them. */
export function avcCodec(config: Uint8Array): string | null {
  for (const nal of nalUnits(config)) {
    if ((nal[0] & 0x1f) === 7 && nal.length >= 4) return `avc1.${hex2(nal[1])}${hex2(nal[2] & 0xfc)}${hex2(nal[3])}`
  }
  return null
}

/** `a` then `b` in one buffer: a key frame with the config (SPS, PPS) in front, as the decoder takes it. */
export function joined(a: Uint8Array, b: Uint8Array): Uint8Array {
  const out = new Uint8Array(a.length + b.length)
  out.set(a, 0)
  out.set(b, a.length)
  return out
}
