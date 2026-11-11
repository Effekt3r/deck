import type { ClaudeFeedItem, ClaudeImage, ClaudeSessionSummary, ClaudeSnapshot } from '@shared/types'
import { cut } from './describe'
import type { SessionState } from './session'
import { claudeStatus } from './status'

/** Feed items sent to the renderer (the newest). */
export const FEED_ITEMS = 300
// Longest texts sent, cut with '…'.
const CAP = { prompt: 2_000, thinking: 2_000, reply: 8_000, summary: 300, error: 300, notice: 300, short: 300 }

/** Custom title (/rename) > AI title > first prompt > `fallback`. */
export function sessionTitle(s: SessionState, fallback = ''): string {
  return s.customTitle || s.aiTitle || s.firstPrompt || fallback
}

/** Copies of an item's images and their count beyond them: ids, sizes and numbers, never pixels (the
 *  renderer asks for those), and never where their lines are. */
function imageFields(i: { images?: ClaudeImage[]; moreImages?: number }): { images?: ClaudeImage[]; moreImages?: number } {
  return {
    ...(i.images?.length ? { images: i.images.map((image) => ({ ...image })) } : {}),
    ...(i.moreImages ? { moreImages: i.moreImages } : {}),
  }
}

/** A capped copy: the state updates its tool items in place, a snapshot must not change. */
function feedItem(i: ClaudeFeedItem): ClaudeFeedItem {
  switch (i.kind) {
    case 'prompt':
      return { kind: 'prompt', text: cut(i.text, CAP.prompt), ...imageFields(i) }
    case 'thinking':
      return { kind: 'thinking', text: cut(i.text, CAP.thinking) }
    case 'reply':
      return { kind: 'reply', text: cut(i.text, CAP.reply) }
    case 'tool':
      return {
        kind: 'tool', id: i.id, name: i.name, summary: cut(i.summary, CAP.summary), state: i.state,
        ...(i.error === undefined ? {} : { error: cut(i.error, CAP.error) }),
        ...imageFields(i),
      }
    case 'notice':
      return { kind: 'notice', text: cut(i.text, CAP.notice), tone: i.tone }
  }
}

/** What the renderer gets. `steps`: running agents' current step by Agent tool_use id. */
export function buildSnapshot(
  summary: ClaudeSessionSummary,
  s: SessionState,
  quietMs: number,
  steps: Map<string, string>,
  following: 'newest' | 'pinned',
): ClaudeSnapshot {
  return {
    session: {
      id: summary.id,
      path: summary.path,
      title: cut(sessionTitle(s, summary.title), CAP.short),
      modified: summary.modified,
      model: s.model,
      contextTokens: s.contextTokens,
      branch: s.branch,
      mode: s.mode,
      pr: s.pr,
    },
    status: claudeStatus(s, quietMs),
    todos: s.todos().map((t) => ({ status: t.status, text: cut(t.text, CAP.short) })),
    agents: [...s.agents].map(([toolUseId, a]) => {
      const step = a.done ? undefined : steps.get(toolUseId)
      return {
        toolUseId, type: a.type, description: cut(a.description, CAP.short), done: a.done, failed: a.failed,
        ...(step ? { step: cut(step, CAP.short) } : {}),
      }
    }),
    feed: s.feed.slice(-FEED_ITEMS).map(feedItem),
    following,
  }
}
