import { open, stat } from 'node:fs/promises'

const NL = 0x0a

/** Where a line is in its file, in bytes (its newline not included). */
export interface LinePlace {
  offset: number
  length: number
}

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
  /** Where that line starts in the file. */
  private partialStart = 0
  /** Size and modification time (ms) at the last read; 0 before the first. */
  size = 0
  modified = 0

  constructor(readonly path: string) {}

  /**
   * Entries appended since the last call (parsed objects; bad lines skipped; a partial last line
   * waits for its newline; a file that shrank is read again from the start and `reset` is true),
   * and each entry's place in the file, at the same index. At most `maxBytes` are read per call;
   * `more` says there is more to read already.
   */
  async read(maxBytes = Number.POSITIVE_INFINITY): Promise<{ entries: unknown[]; places: LinePlace[]; reset: boolean; more: boolean }> {
    let size: number
    try {
      const st = await stat(this.path)
      size = st.size
      this.modified = st.mtimeMs
    } catch {
      return { entries: [], places: [], reset: false, more: false } // not written yet, or deleted
    }
    let reset = false
    if (size < this.pos) {
      // Rewritten: start again (the caller drops what it parsed).
      this.pos = 0
      this.partial = []
      this.partialStart = 0
      reset = true
    }
    this.size = size
    if (size === this.pos) return { entries: [], places: [], reset, more: false }

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
      return { entries: [], places: [], reset, more: false }
    }
    const start = this.pos
    this.pos += got
    const data = chunk.subarray(0, got)
    const entries: unknown[] = []
    const places: LinePlace[] = []
    // Each line is decoded on its own (a newline byte never sits inside a multi-byte character), so
    // its place is exact in bytes whatever text comes before it.
    let from = 0
    for (let nl = data.indexOf(NL); nl >= 0; nl = data.indexOf(NL, from)) {
      const offset = this.partial.length ? this.partialStart : start + from
      const line = this.partial.length ? Buffer.concat([...this.partial, data.subarray(from, nl)]) : data.subarray(from, nl)
      this.partial = []
      from = nl + 1
      const text = line.toString('utf8')
      if (!text.trim()) continue
      try {
        entries.push(JSON.parse(text))
        places.push({ offset, length: line.length })
      } catch {
        // A broken line (a crash mid-write, a different program); the rest still counts.
      }
    }
    if (from < data.length) {
      if (!this.partial.length) this.partialStart = start + from
      // Copied, so the rest of the chunk can be freed (unless it's all of it).
      this.partial.push(from === 0 ? data : Buffer.from(data.subarray(from)))
    }
    return { entries, places, reset, more: this.pos < size }
  }
}
