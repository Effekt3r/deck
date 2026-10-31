import type { ClaudeStatus } from '@shared/types'
import { AGENT_TOOLS, ASK_TOOLS, toolLabel } from './describe'
import type { SessionState } from './session'

/** A pending tool this long without a log line may be a permission prompt (they aren't logged). */
export const MAYBE_WAITING_MS = 8_000
/** A turn this long without a log line: Claude was killed or is stuck. */
export const QUIET_MS = 600_000

/** What Claude is doing, from the parsed log and how long it has been silent (prototype: status()). */
export function claudeStatus(s: SessionState, quietMs: number): ClaudeStatus {
  let agents = 0
  for (const a of s.agents.values()) if (!a.done) agents++
  const counts = { agents, background: s.background.size }
  let last: string | undefined
  for (const name of s.pending.values()) last = name
  if (last !== undefined) {
    if (ASK_TOOLS.has(last)) return { state: 'waiting', detail: last, ...counts }
    // A permission prompt leaves no trace in the log: guess from the silence.
    if (quietMs > MAYBE_WAITING_MS && !AGENT_TOOLS.has(last) && s.mode !== 'bypassPermissions') {
      return { state: 'maybe-waiting', detail: toolLabel(last), ...counts }
    }
    return { state: 'tool', detail: toolLabel(last), ...counts }
  }
  if (s.inTurn) return { state: quietMs > QUIET_MS ? 'quiet' : 'working', ...counts }
  if (s.exited) return { state: 'exited', ...counts }
  if (s.error) return { state: 'error', detail: s.error, ...counts }
  return { state: 'idle', ...counts }
}
