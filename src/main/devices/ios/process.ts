import type { ChildProcess } from 'node:child_process'

/** SIGTERM, then SIGKILL this long after if the process still runs: idb_companion handles SIGTERM
 *  itself on a dispatch queue, so a hung one may never act on it. */
const FORCE_KILL_AFTER = 2000
/** A process's words, as shown, are cut here, as runAdb's are. */
const MAX_LINE = 500
/** A line with no end yet is kept to this much, so a run of garbage can't grow memory. */
const MAX_REST = 4096
/** Words that mark a line as a failure. Kept simple on purpose: enough to tell sim-video's and
 *  idb_companion's failures (a Swift "Fatal error: …", "The operation couldn’t be completed.", the
 *  companion's own "Target is no longer booted, companion going offline") from their routine info
 *  lines ("Overlay setup: screenInfo=…"). */
const FAILURE = /error|fatal|\bfail|couldn[’']?t|could not|\bcan[’']?t\b|cannot|\bunable\b|no longer/i

/** How a process ended: by a signal, with an exit code, or plainly. */
export function endedHow(name: string, code: number | null, signal: NodeJS.Signals | null): string {
  if (signal) return `${name} was stopped (${signal}).`
  return code ? `${name} stopped (exit code ${code}).` : `${name} stopped.`
}

/** `line` when it reads as a failure (FAILURE's words), else nothing: a routine info line would only
 *  hide how the process ended. */
export const asFailure = (line: string): string => (FAILURE.test(line) ? line : '')

/** Ends `child`, once: its stdin (sim-video stops when that ends), SIGTERM, then SIGKILL if it hasn't
 *  closed FORCE_KILL_AFTER later. Made as the child is spawned, so it knows when there's nothing left
 *  to end. */
export function stopper(child: ChildProcess): () => void {
  let closed = false
  let stopped = false
  let force: ReturnType<typeof setTimeout> | null = null
  child.once('close', () => {
    closed = true
    if (force) clearTimeout(force)
  })
  return () => {
    if (stopped || closed) return
    stopped = true
    child.stdin?.end()
    // A spawn that failed has no process, and its pid stays undefined: a kill() in the same tick as
    // that spawn would signal pid 0, which on Node 22 is the caller's whole process group.
    if (child.pid === undefined) return
    child.kill()
    force = setTimeout(() => child.kill('SIGKILL'), FORCE_KILL_AFTER)
  }
}

/** Reads `stream` to its end, so a child's pipe never fills, and keeps the last line `keep` takes:
 *  `keep` gets each line trimmed and returns it as shown, or null to pass it by (by default any line
 *  with text is kept). The getter's line is cut to 500 characters. */
export function lastLine(stream: NodeJS.ReadableStream | null, keep: (line: string) => string | null = (line) => line || null): () => string {
  let last = ''
  let rest = ''
  stream?.setEncoding('utf8')
  stream?.on('data', (text: string) => {
    const lines = (rest + text).split('\n')
    rest = (lines.pop() ?? '').slice(-MAX_REST)
    for (const line of lines) {
      const shown = keep(line.trim())
      if (shown) last = shown
    }
  })
  return () => ((rest.trim() && keep(rest.trim())) || last).slice(0, MAX_LINE)
}
