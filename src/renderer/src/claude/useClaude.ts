import { useCallback, useEffect, useLayoutEffect, useRef, useState } from 'react'
import type { ClaudeResume, ClaudeSnapshot } from '@shared/types'
import { errorText } from '../git/format'

export interface ClaudeFeedState {
  /** The folder `snapshot` belongs to. Until a new folder's first answer, the old one's
   *  stays (so the panel doesn't vanish and come back while main reads the new one). */
  folder: string
  /** null: no session for the folder (yet). */
  snapshot: ClaudeSnapshot | null
  /** loading: waiting for the first answer for `folder`; error: subscribe failed (updates may still follow). */
  phase: 'loading' | 'ready' | 'error'
  error: string | null
}

/** Follows Claude's session for `folder` while `enabled` (the tab is shown and its panel
 *  isn't hidden): `resume`, the session the tab showed before, or the newest (null). The
 *  last snapshot stays meanwhile. */
export function useClaudeSession(folder: string, enabled: boolean, resume: ClaudeResume | null): ClaudeFeedState & { retry(): void } {
  const [state, setState] = useState<ClaudeFeedState>({ folder, snapshot: null, phase: 'loading', error: null })
  const [attempt, setAttempt] = useState(0)
  // Read when subscribing, never a reason to: it changes with the sessions the panel shows.
  const resumeRef = useRef(resume)
  useLayoutEffect(() => {
    resumeRef.current = resume
  })

  useEffect(() => {
    if (!enabled || !folder) return
    const claude = window.deck.claude
    let live = true
    // Main pushes to this subscription only after answering it. What arrives for the folder
    // before was sent to the one before: this tab's, or another tab's in the same folder, which
    // showed its own session.
    let answered = false
    const accept = (snapshot: unknown) => setState({ folder, snapshot: usable(snapshot), phase: 'ready', error: null })
    const off = claude.onUpdate((f, snapshot) => {
      if (live && answered && f === folder) accept(snapshot)
    })
    setState((s) => (s.folder === folder && s.phase !== 'error' ? s : { ...s, phase: 'loading', error: null }))
    claude.subscribe(folder, resumeRef.current).then(
      (snapshot) => {
        if (!live) return
        answered = true
        accept(snapshot)
      },
      (err: unknown) => {
        if (!live) return
        answered = true // updates may still follow
        setState((s) => ({ folder, snapshot: s.folder === folder ? s.snapshot : null, phase: 'error', error: errorText(err) }))
      },
    )
    return () => {
      live = false
      off()
      claude.unsubscribe(folder)
    }
  }, [folder, enabled, attempt])

  const retry = useCallback(() => setAttempt((a) => a + 1), [])
  return { ...state, retry }
}

/** A snapshot the panel can draw, with its lists filled in; anything else counts as none. */
function usable(value: unknown): ClaudeSnapshot | null {
  if (!value || typeof value !== 'object') return null
  const s = value as Partial<ClaudeSnapshot>
  if (!s.session || typeof s.session !== 'object' || !s.status || typeof s.status !== 'object') return null
  return {
    ...(s as ClaudeSnapshot),
    todos: Array.isArray(s.todos) ? s.todos : [],
    agents: Array.isArray(s.agents) ? s.agents : [],
    feed: Array.isArray(s.feed) ? s.feed : [],
  }
}
