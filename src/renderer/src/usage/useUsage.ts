import { useEffect, useState } from 'react'
import type { UsageState } from '@shared/types'

/** Claude's plan usage and Deck's link to Claude Code's status line; one for the whole window. */
export function useUsage(): UsageState | null {
  const [state, setState] = useState<UsageState | null>(null)
  useEffect(() => {
    let live = true
    let pushed = false
    // A push can arrive before get()'s reply: once one has, it's the newer answer.
    const off = window.deck.usage.onChange((next) => {
      pushed = true
      setState(next)
    })
    window.deck.usage.get().then(
      (now) => {
        if (live && !pushed) setState(now)
      },
      () => {},
    )
    return () => {
      live = false
      off()
    }
  }, [])
  return state
}
