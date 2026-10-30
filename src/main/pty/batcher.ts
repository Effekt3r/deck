/** Coalesces pty output so the renderer gets one IPC message per tab every few
 *  ms rather than one per read; a full buffer goes out at once. */
export class DataBatcher {
  private readonly flush: (id: string, data: string) => void
  private readonly delayMs: number
  private readonly maxChars: number
  private readonly buffers = new Map<string, string>()
  private timer: ReturnType<typeof setTimeout> | null = null

  constructor(flush: (id: string, data: string) => void, opts: { delayMs?: number; maxChars?: number } = {}) {
    this.flush = flush
    this.delayMs = opts.delayMs ?? 5
    this.maxChars = opts.maxChars ?? 65536
  }

  push(id: string, data: string): void {
    const buffered = (this.buffers.get(id) ?? '') + data
    if (buffered.length >= this.maxChars) {
      this.buffers.delete(id)
      this.flush(id, buffered)
      return
    }
    this.buffers.set(id, buffered)
    this.timer ??= setTimeout(() => this.flushAll(), this.delayMs)
  }

  flushAll(): void {
    this.clearTimer()
    const pending = [...this.buffers]
    this.buffers.clear()
    for (const [id, data] of pending) this.flush(id, data)
  }

  dispose(): void {
    this.clearTimer()
    this.buffers.clear()
  }

  private clearTimer(): void {
    if (this.timer) clearTimeout(this.timer)
    this.timer = null
  }
}
