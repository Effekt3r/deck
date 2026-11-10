/** sim-video's fragmented MP4, turned into the packets the view decodes (H.264, Annex B): the init
 *  segment's SPS and PPS as a config packet, then each fragment's picture. fMP4 rather than
 *  sim-video's own Annex B output: that has no delimiters, so a picture is only known to be complete
 *  once the next one starts, and a still screen sends no next one. */

/** A box larger than this is a broken stream, not a picture: scrcpy's packets have the same cap. */
export const MAX_BOX = 16 * 1024 * 1024

export type Fmp4Event =
  /** An init segment: the size pictures come at, and SPS and PPS for the next key frame. */
  | { type: 'config'; width: number; height: number; data: Buffer }
  /** One picture. */
  | { type: 'frame'; key: boolean; data: Buffer }

const START = Buffer.from([0, 0, 0, 1])

/** The child boxes in a box's body. */
function* children(body: Buffer): Generator<[string, Buffer]> {
  let at = 0
  while (at + 8 <= body.length) {
    const size = body.readUInt32BE(at)
    if (size < 8 || at + size > body.length) throw new Error("sim-video's init segment is broken.")
    yield [body.toString('latin1', at + 4, at + 8), body.subarray(at + 8, at + size)]
    at += size
  }
}

function child(body: Buffer, type: string): Buffer | undefined {
  for (const [t, b] of children(body)) if (t === type) return b
  return undefined
}

/** AVCDecoderConfigurationRecord: the NAL length's size, and the SPS and PPS. */
function parseAvcC(record: Buffer): { lengthSize: number; sps: Buffer[]; pps: Buffer[] } {
  const broken = () => new Error("sim-video's H.264 configuration is broken.")
  if (record.length < 7 || record[0] !== 1) throw broken()
  const lengthSize = (record[4] & 0x03) + 1
  if (lengthSize === 3) throw broken()
  let at = 5
  const read = (count: number): Buffer[] => {
    const out: Buffer[] = []
    for (let i = 0; i < count; i++) {
      if (at + 2 > record.length) throw broken()
      const n = record.readUInt16BE(at)
      if (n === 0 || at + 2 + n > record.length) throw broken()
      out.push(record.subarray(at + 2, at + 2 + n))
      at += 2 + n
    }
    return out
  }
  const sps = read(record[at++] & 0x1f)
  if (at >= record.length) throw broken()
  const pps = read(record[at++])
  return { lengthSize, sps, pps }
}

/** Top-level boxes read from a byte stream split anywhere; each is handled once all of it is in.
 *  Chunks are joined only per box, so memory stays about one box, and the join is linear in the
 *  box's size (measured ~1 ms for a 4 MB box arriving in 16 KiB chunks) — unlike
 *  android/protocol.ts's fill(), which preallocates a packet's buffer up front for scrcpy's
 *  longer, chattier stream. */
export class Fmp4Reader {
  private chunks: Buffer[] = []
  private buffered = 0
  /** From the init segment's avcC; 0 until one came. */
  private lengthSize = 0

  push(chunk: Buffer): Fmp4Event[] {
    this.chunks.push(chunk)
    this.buffered += chunk.length
    const events: Fmp4Event[] = []
    for (;;) {
      if (this.buffered < 8) return events
      const head = this.peek(8)
      const size = head.readUInt32BE(0)
      const type = head.toString('latin1', 4, 8)
      // ISO BMFF also lets size be 0 ("to the end of the file") or 1 (a 64-bit largesize follows),
      // but sim-video writes neither: both are already under 8, and a box that large would be over
      // MAX_BOX anyway, so they're refused here like any other broken size.
      if (size < 8 || size > MAX_BOX) throw new Error(`sim-video sent a ${type} box of ${size} bytes.`)
      if (this.buffered < size) return events
      const body = this.take(size).subarray(8)
      if (type === 'moov') events.push(this.init(body))
      else if (type === 'mdat') events.push(this.picture(body))
      // ftyp and each picture's moof: nothing the view needs (it keeps its own timestamps).
    }
  }

  private peek(n: number): Buffer {
    if (this.chunks[0].length < n) this.chunks = [Buffer.concat(this.chunks)]
    return this.chunks[0].subarray(0, n)
  }

  private take(n: number): Buffer {
    const all = this.chunks.length === 1 ? this.chunks[0] : Buffer.concat(this.chunks)
    const rest = all.subarray(n)
    this.chunks = rest.length > 0 ? [rest] : []
    this.buffered -= n
    return all.subarray(0, n)
  }

  /** moov › trak › mdia › minf › stbl › stsd › avc1 › avcC: the video's size, SPS and PPS. */
  private init(moov: Buffer): Fmp4Event {
    let stsd: Buffer | undefined = moov
    for (const type of ['trak', 'mdia', 'minf', 'stbl', 'stsd']) stsd = stsd && child(stsd, type)
    // stsd is a full box with an entry count; avc1 is a visual sample entry, whose 78 bytes of
    // fields (width and height at 24 and 26) come before its own boxes.
    const avc1 = stsd && stsd.length > 8 ? child(stsd.subarray(8), 'avc1') : undefined
    if (!avc1 || avc1.length < 78) throw new Error('sim-video sent no H.264 track.')
    const width = avc1.readUInt16BE(24)
    const height = avc1.readUInt16BE(26)
    const avcC = child(avc1.subarray(78), 'avcC')
    if (!avcC) throw new Error('sim-video sent no H.264 configuration.')
    const { lengthSize, sps, pps } = parseAvcC(avcC)
    if (width === 0 || height === 0 || sps.length === 0 || pps.length === 0) throw new Error("sim-video's video makes no sense.")
    this.lengthSize = lengthSize
    return { type: 'config', width, height, data: Buffer.concat([...sps, ...pps].flatMap((n) => [START, n])) }
  }

  /** An mdat: one picture's NAL units, each behind its length. */
  private picture(mdat: Buffer): Fmp4Event {
    if (this.lengthSize === 0) throw new Error('sim-video sent a picture before its configuration.')
    const parts: Buffer[] = []
    let key = false
    let at = 0
    while (at < mdat.length) {
      if (at + this.lengthSize > mdat.length) throw new Error('sim-video sent a broken picture.')
      const n = mdat.readUIntBE(at, this.lengthSize)
      at += this.lengthSize
      if (n === 0 || at + n > mdat.length) throw new Error('sim-video sent a broken picture.')
      if ((mdat[at] & 0x1f) === 5) key = true // an IDR slice
      parts.push(START, mdat.subarray(at, at + n))
      at += n
    }
    if (parts.length === 0) throw new Error('sim-video sent an empty picture.')
    return { type: 'frame', key, data: Buffer.concat(parts) }
  }
}
