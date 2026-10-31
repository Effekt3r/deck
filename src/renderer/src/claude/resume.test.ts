import { describe, expect, it } from 'vitest'
import type { ClaudeSnapshot } from '@shared/types'
import { shownSession, toResume } from './resume'

const snapshot = (id: string, following: ClaudeSnapshot['following']): ClaudeSnapshot => ({
  session: { id, path: `/c/${id}.jsonl`, title: '', modified: 0, model: '', contextTokens: 0, branch: '', mode: '', pr: null },
  status: { state: 'idle', agents: 0, background: 0 },
  todos: [],
  agents: [],
  feed: [],
  following,
})

describe('shownSession', () => {
  it('is the session a snapshot shows and whether it is pinned; nothing for no session', () => {
    expect(shownSession(snapshot('s1', 'pinned'))).toEqual({ id: 's1', pinned: true })
    expect(shownSession(snapshot('s2', 'newest'))).toEqual({ id: 's2', pinned: false })
    expect(shownSession(null)).toBeUndefined()
  })
})

describe('toResume', () => {
  it("is what subscribe() resumes: the tab's session, or null (the newest) when it has none", () => {
    expect(toResume({ id: 's1', pinned: true })).toEqual({ sessionId: 's1', pinned: true })
    expect(toResume({ id: 's2', pinned: false })).toEqual({ sessionId: 's2', pinned: false })
    expect(toResume(undefined)).toBeNull()
  })
})
