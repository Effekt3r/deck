/** Start of the first sequence Deck's prompt hooks (zsh and PowerShell) print
 *  before every prompt. */
export const PROMPT_MARK = '\x1b]1337;SetUserVar=GIT_REPO='

/** zsh's line editor turns bracketed paste on once it is reading the line. Text
 *  typed before that (the hook runs before the prompt is even expanded) is
 *  echoed by the tty and again by the editor, so the command would show twice. */
const EDITOR_READY = '\x1b[?2004h'

/** Types a tab's command (e.g. `claude …`) once the shell is ready: when the line
 *  editor starts after the first prompt mark, `settleMs` after the mark if it
 *  gives no sign (PowerShell), or after `timeoutMs` for shells without the hook
 *  (`null`: no such fallback, for shells that always load it). */
export class StartupCommand {
  private readonly command: string
  private readonly write: (data: string) => void
  private readonly settleMs: number
  private timer: ReturnType<typeof setTimeout> | undefined
  private done = false
  private marked = false
  /** End of the output so far, in case a sequence is split across two chunks. */
  private tail = ''

  constructor(
    command: string,
    write: (data: string) => void,
    opts: { timeoutMs?: number | null; settleMs?: number } = {},
  ) {
    this.command = command
    this.write = write
    this.settleMs = opts.settleMs ?? 500
    const timeoutMs = opts.timeoutMs === undefined ? 4000 : opts.timeoutMs
    if (timeoutMs !== null) this.timer = setTimeout(() => this.fire(), timeoutMs)
  }

  onData(chunk: string): void {
    if (this.done) return
    let text = this.tail + chunk
    if (!this.marked) {
      const at = text.indexOf(PROMPT_MARK)
      if (at < 0) {
        this.tail = text.slice(-(PROMPT_MARK.length - 1))
        return
      }
      this.marked = true
      clearTimeout(this.timer)
      this.timer = setTimeout(() => this.fire(), this.settleMs)
      text = text.slice(at + PROMPT_MARK.length)
    }
    if (text.includes(EDITOR_READY)) this.fire()
    else this.tail = text.slice(-(EDITOR_READY.length - 1))
  }

  dispose(): void {
    this.done = true
    clearTimeout(this.timer)
  }

  private fire(): void {
    if (this.done) return
    this.dispose()
    this.write(`${this.command}\r`)
  }
}
