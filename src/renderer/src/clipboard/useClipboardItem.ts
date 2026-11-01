import { useEffect, useState } from 'react'
import type { ClipboardPreview } from '@shared/types'

/** The item the clipboard card offers; one for the whole window. */
export function useClipboardItem(): ClipboardPreview | null {
  const [item, setItem] = useState<ClipboardPreview | null>(null)
  useEffect(() => {
    let live = true
    let pushed = false
    // A push can arrive, and even be handled, before current()'s own reply: once one has, it's the
    // newer answer, so the reply is dropped rather than trusted to still be in order behind it.
    const off = window.deck.clipboard.onItem((next) => {
      pushed = true
      setItem(next)
    })
    window.deck.clipboard.current().then(
      (now) => {
        if (live && !pushed) setItem(now)
      },
      () => {},
    )
    return () => {
      live = false
      off()
    }
  }, [])
  return item
}
