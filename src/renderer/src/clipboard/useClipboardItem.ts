import { useEffect, useState } from 'react'
import type { ClipboardPreview } from '@shared/types'

/** The item the clipboard card offers; one for the whole window. */
export function useClipboardItem(): ClipboardPreview | null {
  const [item, setItem] = useState<ClipboardPreview | null>(null)
  useEffect(() => {
    let live = true
    const off = window.deck.clipboard.onItem((next) => setItem(next))
    // Main sends its answer and its pushes in order, so whichever arrives last is the newest.
    window.deck.clipboard.current().then(
      (now) => {
        if (live) setItem(now)
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
