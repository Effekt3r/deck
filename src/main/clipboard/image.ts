import { nativeImage } from 'electron'
import type { ImageInfo } from './item'

const THUMB_WIDTH = 240

/** An image's size and a thumbnail at most 240 px wide, as a data: URL (the renderer's CSP allows data: images). */
export function imageInfo(png: Uint8Array): ImageInfo {
  const image = nativeImage.createFromBuffer(Buffer.from(png))
  const { width, height } = image.getSize()
  const thumb = width > THUMB_WIDTH ? image.resize({ width: THUMB_WIDTH, quality: 'good' }) : image
  return { width, height, thumbnail: thumb.isEmpty() ? '' : thumb.toDataURL() }
}
