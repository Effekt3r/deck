/** Something term.onData emitted while nothing is pending. */
interface Typed {
  kind: 'data'
  value: string
}

/** A smart paste's place in line: filled in once its answer (or a timeout) arrives. */
interface Slot {
  kind: 'slot'
  id: number
  filled: boolean
  text: string | null
}

type Entry = Typed | Slot

/** Orders what a terminal sends while smart pastes are in flight: input typed meanwhile waits
 *  behind the paste it followed, and pastes land in the order they were asked for, not the order
 *  their clipboard reads happen to resolve in (a later Cmd+V can finish first). */
export class PasteQueue {
  private queue: Entry[] = []
  private readonly slots = new Map<number, Slot>()
  private nextId = 1
  /** True only for the synchronous extent of a paste() call: its own bracketed-paste text comes
   *  back through input() and must go straight to the terminal, not queue behind itself. */
  private draining = false

  constructor(
    private readonly write: (data: string) => void,
    private readonly paste: (text: string) => void,
  ) {}

  /** A smart paste starts: returns its slot id, kept even if a later paste settles first. */
  begin(): number {
    const slot: Slot = { kind: 'slot', id: this.nextId++, filled: false, text: null }
    this.slots.set(slot.id, slot)
    this.queue.push(slot)
    return slot.id
  }

  /** `text`: what to paste, or null for nothing (a shell tab, an error, or a timed-out read). A
   *  second settle of the same id — a timeout firing either side of the real reply — is ignored. */
  settle(id: number, text: string | null): void {
    const slot = this.slots.get(id)
    if (!slot || slot.filled) return
    slot.filled = true
    slot.text = text
    this.drain()
  }

  /** Everything the terminal emits (term.onData): sent at once when nothing is pending, else
   *  queued behind it. */
  input(data: string): void {
    if (this.draining || this.queue.length === 0) this.write(data)
    else this.queue.push({ kind: 'data', value: data })
  }

  /** Sends entries from the front — typed data, or a slot already filled — stopping at the first
   *  paste still waiting on its answer. */
  private drain(): void {
    while (this.queue.length > 0) {
      const entry = this.queue[0]
      if (entry.kind === 'data') {
        this.queue.shift()
        this.write(entry.value)
        continue
      }
      if (!entry.filled) break
      this.queue.shift()
      this.slots.delete(entry.id)
      if (!entry.text) continue
      this.draining = true
      try {
        this.paste(entry.text)
      } finally {
        this.draining = false
      }
    }
  }
}
