/** Test data for the simulator code: protobuf from protobufjs, fMP4 built box by box. */

/** idb's describe answer: udid "U1", name "iPhone 17", state "Booted", 1206×2622 px at 3×,
 *  402×874 points (protobufjs, 2026-11-10). */
export const DESCRIBE_ANSWER = Buffer.from(
  '0a2e0a02553112096950686f6e652031371a1508b60910be1419000000000000084020920328ea062206426f6f746564',
  'hex',
)

const u16 = (n: number) => {
  const b = Buffer.alloc(2)
  b.writeUInt16BE(n)
  return b
}
const u32 = (n: number) => {
  const b = Buffer.alloc(4)
  b.writeUInt32BE(n)
  return b
}

/** An MP4 box: its size, its type, then its body. */
export function box(type: string, ...body: Buffer[]): Buffer {
  const content = Buffer.concat(body)
  const head = Buffer.alloc(8)
  head.writeUInt32BE(8 + content.length)
  head.write(type, 4, 'latin1')
  return Buffer.concat([head, content])
}

export const SPS = Buffer.from([0x67, 0x64, 0x00, 0x1f, 0xac, 0xd9])
export const PPS = Buffer.from([0x68, 0xeb, 0xe3, 0xcb])

/** A NAL unit of `header`'s type (0x65 an IDR slice, 0x41 a P slice) and `n` bytes. */
export const nal = (header: number, n = 6) => Buffer.from([header, ...Array<number>(n - 1).fill(0xab)])

/** The init segment sim-video writes: ftyp, then moov › trak › mdia › minf › stbl › stsd › avc1
 *  (`width`×`height`) › avcC with one SPS and one PPS, `lengthSize`-byte NAL lengths, and `extra`
 *  bytes appended (a High-profile avcC's ISO/IEC 14496-15 extension: chroma format, luma and
 *  chroma bit depth, and further SPSes — none here). */
export function initSegment(width = 604, height = 1312, lengthSize = 4, extra: Buffer = Buffer.alloc(0)): Buffer {
  const avcC = box('avcC', Buffer.from([1, 0x64, 0x00, 0x1f, 0xfc | (lengthSize - 1), 0xe1]), u16(SPS.length), SPS, Buffer.from([1]), u16(PPS.length), PPS, extra)
  const fields = Buffer.alloc(78) // a visual sample entry's fields, width and height at 24 and 26
  fields.writeUInt16BE(width, 24)
  fields.writeUInt16BE(height, 26)
  const stsd = box('stsd', Buffer.from([0, 0, 0, 0, 0, 0, 0, 1]), box('avc1', fields, avcC))
  const trak = box('trak', box('tkhd', Buffer.alloc(84)), box('mdia', box('mdhd', Buffer.alloc(24)), box('minf', box('stbl', stsd))))
  return Buffer.concat([box('ftyp', Buffer.from('isom')), box('moov', box('mvhd', Buffer.alloc(100)), trak)])
}

/** One fragment: a moof, then an mdat with `nals`, each behind a `lengthSize`-byte length. */
export function fragment(nals: Buffer[], lengthSize = 4): Buffer {
  const lengths = nals.map((x) => {
    const b = Buffer.alloc(lengthSize)
    b.writeUIntBE(x.length, 0, lengthSize)
    return Buffer.concat([b, x])
  })
  return Buffer.concat([box('moof', Buffer.alloc(92)), box('mdat', ...lengths)])
}

export { u16, u32 }
