import { open, stat } from 'node:fs/promises'

const NL = 0x0a

/**
 * Reads a JSONL file incrementally: each read() returns the lines appended since the last one.
 * Claude appends to its logs, so only the new bytes are read; a 15 MB log is read once.
 */
export class JsonlTail {
  /** Bytes consumed (complete lines plus the pending partial line). */
  private pos = 0
  /** The start of a line whose newline hasn't been written yet, as raw bytes: a UTF-8 character
   *  may be cut in half at the end of what's been read. */
  private partial: Buffer[] = []
  /** Size and modification time (ms) at the last read; 0 before the first. */
  size = 0
  modified = 0

  constructor(readonly path: string) {}

  /**
   * Entries appended since the last call (parsed objects; bad lines skipped; a partial last line
   * waits for its newline; a file that shrank is read again from the start and `reset` is true).
   * At most `maxBytes` are read per call; `more` says there is more to read already.
   */
  async read(maxBytes = Number.POSITIVE_INFINITY): Promise<{ entries: unknown[]; reset: boolean; more: boolean }> {
    let size: number
    try {
      const st = await stat(this.path)
      size = st.size
      this.modified = st.mtimeMs
    } catch {
      return { entries: [], reset: false, more: false } // not written yet, or deleted
    }
    let reset = false
    if (size < this.pos) {
      // Rewritten: start again (the caller drops what it parsed).
      this.pos = 0
      this.partial = []
      reset = true
    }
    this.size = size
    if (size === this.pos) return { entries: [], reset, more: false }

    const want = Math.min(size - this.pos, Math.max(1, maxBytes))
    const chunk = Buffer.allocUnsafe(want)
    let got = 0
    try {
      const fh = await open(this.path, 'r')
      try {
        while (got < want) {
          const { bytesRead } = await fh.read(chunk, got, want - got, this.pos + got)
          if (bytesRead === 0) break // truncated while reading; the next read sees the new size
          got += bytesRead
        }
      } finally {
        await fh.close()
      }
    } catch {
      return { entries: [], reset, more: false }
    }
    this.pos += got
    const data = chunk.subarray(0, got)
    const entries: unknown[] = []
    const last = data.lastIndexOf(NL)
    if (last < 0) {
      this.partial.push(data)
    } else {
      // Everything up to the last newline is whole lines (a newline byte never sits inside a
      // multi-byte character), so it decodes in one go.
      const text = Buffer.concat([...this.partial, data.subarray(0, last + 1)]).toString('utf8')
      // Copied, so the rest of the chunk can be freed.
      this.partial = last + 1 < data.length ? [Buffer.from(data.subarray(last + 1))] : []
      for (const line of text.split('\n')) {
        if (!line.trim()) continue
        try {
          entries.push(JSON.parse(line))
        } catch {
          // A broken line (a crash mid-write, a different program); the rest still counts.
        }
      }
    }
    return { entries, reset, more: this.pos < size }
  }
}
