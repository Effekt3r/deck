// Why the Claude panel can't show an image: main answers claude.image() with one of these, and the
// panel shows it as it is (a thumbnail's tooltip, the viewer's message). Also fitInto(), the one bit
// of image-sizing arithmetic main and the renderer both do (to 480×360 there, to the thumbnail or
// viewer box here).

/** A width and height in whole pixels. */
export interface Size {
  width: number
  height: number
}

/** `size` fitted into `box`, never enlarged, in whole pixels. */
export function fitInto(size: Size, box: Size): Size {
  const scale = Math.min(1, box.width / size.width, box.height / size.height)
  return { width: Math.max(1, Math.round(size.width * scale)), height: Math.max(1, Math.round(size.height * scale)) }
}

/** The image isn't in the line it was listed from any more (the log was rewritten or deleted), the
 *  session that listed it isn't the folder's followed one, or the request made no sense. */
export const GONE = 'No longer in the session log'
/** More than 16,384 px a side or 40 MP by its header (never decoded; Open still shows it), or its
 *  line is too long to read again. */
export const TOO_LARGE = 'Too large to show'
/** Its header gives no size, or the decoder failed. */
export const UNDECODABLE = "Couldn't decode this image"
/** A thumbnail that would have to be the image itself, which is over 1 MiB (a GIF, a WebP or a JPEG
 *  turned by its EXIF orientation): the viewer and Open still show it. */
export const NO_PREVIEW = 'No preview'
/** The log's line didn't come back in time (a hung network volume, say). */
export const UNREADABLE = "Couldn't read the session log"
