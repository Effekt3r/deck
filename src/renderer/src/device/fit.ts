export interface Box {
  width: number
  height: number
}

/** The largest size of the frame's shape that fits in the box, in whole CSS pixels. The box is
 *  floored first (ResizeObserver and percentage heights give fractional ones), so the clamp below
 *  can't hand back a fractional edge. */
export function fitSize(box: Box, frame: Box): Box {
  const boxWidth = Math.floor(box.width)
  const boxHeight = Math.floor(box.height)
  if (boxWidth <= 0 || boxHeight <= 0 || frame.width <= 0 || frame.height <= 0) return { width: 0, height: 0 }
  const scale = Math.min(boxWidth / frame.width, boxHeight / frame.height)
  return {
    width: Math.max(1, Math.min(boxWidth, Math.round(frame.width * scale))),
    height: Math.max(1, Math.min(boxHeight, Math.round(frame.height * scale))),
  }
}

/** A point on the drawn screen (CSS px from its top-left corner) as a pixel of the frame, inside
 *  it. Needs drawn and frame to both be positive in each dimension: a 0×0 drawn size (fitSize's
 *  empty-box result) has nothing to scale from. */
export function toFrame(x: number, y: number, drawn: Box, frame: Box): { x: number; y: number } {
  const inside = (v: number, size: number) => Math.min(Math.max(v, 0), size - 1)
  return {
    x: inside(Math.round((x / drawn.width) * frame.width), frame.width),
    y: inside(Math.round((y / drawn.height) * frame.height), frame.height),
  }
}
