export interface Box {
  width: number
  height: number
}

/** The largest size of the frame's shape that fits in the box, in whole CSS pixels. */
export function fitSize(box: Box, frame: Box): Box {
  if (box.width <= 0 || box.height <= 0 || frame.width <= 0 || frame.height <= 0) return { width: 0, height: 0 }
  const scale = Math.min(box.width / frame.width, box.height / frame.height)
  return {
    width: Math.max(1, Math.min(box.width, Math.round(frame.width * scale))),
    height: Math.max(1, Math.min(box.height, Math.round(frame.height * scale))),
  }
}

/** A point on the drawn screen (CSS px from its top-left corner) as a pixel of the frame, inside it. */
export function toFrame(x: number, y: number, drawn: Box, frame: Box): { x: number; y: number } {
  const inside = (v: number, size: number) => Math.min(Math.max(v, 0), size - 1)
  return {
    x: inside(Math.round((x / drawn.width) * frame.width), frame.width),
    y: inside(Math.round((y / drawn.height) * frame.height), frame.height),
  }
}
