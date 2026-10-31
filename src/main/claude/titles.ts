import { type FileHandle, open, stat } from 'node:fs/promises'
import { SessionState } from './session'
import { sessionTitle } from './snapshot'

// Claude re-appends the title lines as a session goes on: in 149 real logs the last ai-title was
// at most 34 KB from the end, and a custom title always came after it. The first prompt is near
// the start.
const TAIL_BYTES = 64 * 1024
const HEAD_BYTES = 64 * 1024
const CACHED = 500

const cache = new Map<string, { size: number; modified: number; title: string }>()

async function readRange(fh: FileHandle, start: number, end: number): Promise<string> {
  const buf = Buffer.alloc(Math.max(0, end - start))
  const { bytesRead } = await fh.read(buf, 0, buf.length, start)
  return buf.subarray(0, bytesRead).toString('utf8')
}

/** Ingests the whole lines of `text` (the first one is skipped when it was cut). */
function parse(text: string, cutFirst: boolean, cutLast: boolean): SessionState {
  const s = new SessionState('')
  const lines = text.split('\n')
  if (cutFirst) lines.shift()
  if (cutLast) lines.pop()
  for (const line of lines) {
    try {
      if (line.trim()) s.ingest(JSON.parse(line))
    } catch {
      // a broken line
    }
  }
  return s
}

/** A session's title for the picker without parsing its whole log: custom title > AI title >
 *  first prompt > ''. Cached until the log changes. */
export async function readTitle(path: string): Promise<string> {
  let size: number
  let modified: number
  try {
    const st = await stat(path)
    size = st.size
    modified = st.mtimeMs
  } catch {
    return ''
  }
  const hit = cache.get(path)
  if (hit && hit.size === size && hit.modified === modified) return hit.title
  let title = ''
  try {
    const fh = await open(path, 'r')
    try {
      const tailStart = Math.max(0, size - TAIL_BYTES)
      const tail = parse(await readRange(fh, tailStart, size), tailStart > 0, false)
      const front = tailStart > 0 ? parse(await readRange(fh, 0, Math.min(size, HEAD_BYTES)), false, size > HEAD_BYTES) : tail
      title = tail.customTitle || front.customTitle || tail.aiTitle || front.aiTitle || sessionTitle(front)
    } finally {
      await fh.close()
    }
  } catch {
    return ''
  }
  cache.delete(path)
  cache.set(path, { size, modified, title })
  if (cache.size > CACHED) cache.delete(cache.keys().next().value as string)
  return title
}
