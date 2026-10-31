import type { ClaudeResume, ClaudeSnapshot } from '@shared/types'
import type { TerminalTab } from '../tabs/tabs'

/** What a tab keeps of its Claude panel (TerminalTab.claudeSession). */
export type ShownSession = NonNullable<TerminalTab['claudeSession']>

/** The session a snapshot shows, as the tab keeps it. undefined for none (no session yet): the tab
 *  keeps what it had, which subscribing again then resumes if it is still the folder's. */
export function shownSession(snapshot: ClaudeSnapshot | null): ShownSession | undefined {
  return snapshot ? { id: snapshot.session.id, pinned: snapshot.following === 'pinned' } : undefined
}

/** What subscribe() is given: the session the tab showed, or null for the newest. */
export function toResume(shown: ShownSession | undefined): ClaudeResume | null {
  return shown ? { sessionId: shown.id, pinned: shown.pinned } : null
}
