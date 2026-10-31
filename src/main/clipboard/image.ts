import { nativeImage } from 'electron'
import type { ImageInfo } from './item'

const THUMB_WIDTH = 240

/** An image's size and a thumbnail that fits both the card's width and height, as a data: URL (the
 *  renderer's CSP allows data: images). Built straight from the PNG bytes' own buffer (no copy).
 *  An image that fails to decode, or decodes to 0×0, gets a '' thumbnail. */
export function imageInfo(png: Uint8Array): ImageInfo {
  const image = nativeImage.createFromBuffer(Buffer.from(png.buffer, png.byteOffset, png.byteLength))
  const { width, height } = image.getSize()
  if (!width || !height) return { width, height, thumbnail: '' } // guards the scale below against NaN/Infinity
  const scale = Math.min(1, THUMB_WIDTH / width, 280 / height) // the card shows ≤140 px, at 2×
  const thumb = scale < 1 ? image.resize({ width: Math.max(1, Math.round(width * scale)), quality: 'good' }) : image
  return { width, height, thumbnail: thumb.isEmpty() ? '' : thumb.toDataURL() }
}
