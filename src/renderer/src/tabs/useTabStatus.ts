import { useEffect, useMemo, useState } from 'react'
import type { ClaudePresence, Platform } from '@shared/types'
import { type Attention, markOf, markText, nextAttention, presenceFor, sameAttention, type TabAttention } from './attention'
import { isTerminal, type Tab } from './tabs'

/** A tab whose Claude Deck knows (its presence file): the mark it shows, if any. */
export interface TabStatus {
  /** null: Claude is idle, and the tab has been seen since its last turn ended. */
  mark: Attention | null
  /** The mark's words: the tab's tooltip line and the mark's accessible name ('' without a mark). */
  text: string
}

/** Every running Claude Code (main's presence list), kept current. */
function usePresence(): readonly ClaudePresence[] {
  const [list, setList] = useState<readonly ClaudePresence[]>([])
  useEffect(() => {
    let live = true
    let pushed = false
    const off = window.deck.claude.onPresence((next) => {
      pushed = true
      setList(next)
    })
    // A push that came first is at least as new as this answer.
    window.deck.claude.presence().then(
      (first) => {
        if (live && !pushed) setList(first)
      },
      () => {},
    )
    return () => {
      live = false
      off()
    }
  }, [])
  return list
}

/**
 * Each terminal tab's status, by id, for the tabs whose Claude Deck knows. `seen` is the tab being
 * looked at (the front tab while Deck's window has focus), if any. Also tells main how many tabs
 * need the user, for the Dock's badge.
 */
export function useTabStatus(tabs: readonly Tab[], seen: string | null, platform: Platform): ReadonlyMap<string, TabStatus> {
  const list = usePresence()
  const presences = useMemo(() => {
    const terminals = tabs.filter(isTerminal)
    return new Map(terminals.map((t) => [t.id, presenceFor(t, terminals, list, platform)]))
  }, [tabs, list, platform])

  // Whether a finished turn is unseen depends on what came before, so it's kept. Where it goes next
  // is worked out during render, so a finishing tab never paints a frame without its mark (the
  // strip would jump by the mark's width); the effect only stores it. nextAttention gives the same
  // result applied twice, so this settles after one store.
  const [attention, setAttention] = useState<ReadonlyMap<string, TabAttention>>(() => new Map())
  const next = useMemo(() => {
    const now = new Map([...presences].map(([id, p]) => [id, p?.state ?? null]))
    const moved = nextAttention(attention, now, seen)
    return sameAttention(attention, moved) ? attention : moved
  }, [attention, presences, seen])
  useEffect(() => {
    if (next !== attention) setAttention(next)
  }, [next, attention])

  const statuses = useMemo(() => {
    const out = new Map<string, TabStatus>()
    for (const [id, p] of presences) {
      if (!p) continue
      const mark = markOf(p.state, next.get(id)?.unseen === true)
      out.set(id, { mark, text: mark ? markText(mark, p.waitingFor) : '' })
    }
    return out
  }, [presences, next])

  const waiting = useMemo(() => [...statuses.values()].filter((s) => s.mark === 'waiting').length, [statuses])
  useEffect(() => {
    window.deck.app.attention(waiting)
  }, [waiting])
  return statuses
}
