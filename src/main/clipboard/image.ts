import { stat } from 'node:fs/promises'
import { type NativeImage, nativeImage } from 'electron'
import type { Platform } from '@shared/types'
import type { ImageInfo } from './item'

/** The card shows thumbnails at most 140 px tall, at 2×. */
const BOX = { width: 240, height: 280 }

/** `image` fitted into BOX (never enlarged) as a data: URL (the renderer's CSP allows data:
 *  images); '' for an image that decoded to nothing. */
function thumbnailOf(image: NativeImage): string {
  const { width, height } = image.getSize()
  if (!width || !height) return '' // guards the scale below against NaN/Infinity
  const scale = Math.min(1, BOX.width / width, BOX.height / height)
  const thumb = scale < 1 ? image.resize({ width: Math.max(1, Math.round(width * scale)), quality: 'good' }) : image
  return thumb.isEmpty() ? '' : thumb.toDataURL()
}

/** An image's size and a thumbnail that fits both the card's width and height. Built straight from
 *  the PNG bytes' own buffer (no copy). An image that fails to decode, or decodes to 0×0, gets a ''
 *  thumbnail. */
export function imageInfo(png: Uint8Array): ImageInfo {
  const image = nativeImage.createFromBuffer(Buffer.from(png.buffer, png.byteOffset, png.byteLength))
  const { width, height } = image.getSize()
  return { width, height, thumbnail: thumbnailOf(image) }
}

/** A thumbnail of an image file, fitted like imageInfo's; '' when there is none: a folder, an
 *  empty, missing or unreadable file, one the OS can't preview, or no thumbnailer (Linux). Never
 *  rejects.
 *  The OS makes it: Quick Look on macOS, off the main thread, and Explorer's thumbnail cache on
 *  Windows, so every format Finder or Explorer previews works, HEIC included. On macOS:
 *  - Electron 45's result claims the whole requested box, and its 2× copy (which resize() also
 *    uses) is stretched to it. Its 1× PNG keeps the image's own shape, fitted inside the box and
 *    never enlarged, so that PNG is decoded and fitted again. Asking for twice the card's box
 *    makes this come out the same whether the PNG is the box at 1× or Quick Look's 2× image halved.
 *  - A file Quick Look can't preview (corrupt, unreadable, a format it doesn't know) still
 *    resolves, with its type's icon: 1024×1024, larger than any thumbnail made for the box.
 *    Windows' cache can hand back a thumbnail larger than asked, so that check is macOS's only. */
export async function fileThumbnail(path: string, platform: Platform): Promise<string> {
  try {
    const file = await stat(path)
    if (!file.isFile() || file.size === 0) return '' // Quick Look would make a folder or file icon
    const box = { width: BOX.width * 2, height: BOX.height * 2 }
    const made = await nativeImage.createThumbnailFromPath(path, box)
    const image = nativeImage.createFromBuffer(made.toPNG())
    const { width, height } = image.getSize()
    if (platform === 'darwin' && (width > box.width || height > box.height)) return '' // its icon
    return thumbnailOf(image)
  } catch {
    return ''
  }
}
