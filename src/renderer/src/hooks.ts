import { useCallback, useEffect, useState } from 'react'

/** A remembered on/off setting (localStorage; per window when that's unavailable). */
export function useStoredFlag(key: string, fallback: boolean): [boolean, () => void] {
  const [value, setValue] = useState(() => {
    try {
      const stored = localStorage.getItem(key)
      return stored === null ? fallback : stored === '1'
    } catch {
      return fallback
    }
  })
  useEffect(() => {
    try {
      localStorage.setItem(key, value ? '1' : '0')
    } catch {
      // Storage unavailable: it lasts until the window closes.
    }
  }, [key, value])
  return [value, useCallback(() => setValue((v) => !v), [])]
}

/** Re-renders every `ms`. */
export function useTick(ms: number): void {
  const [, setTick] = useState(0)
  useEffect(() => {
    const timer = setInterval(() => setTick((t) => t + 1), ms)
    return () => clearInterval(timer)
  }, [ms])
}

/** The window can be seen: not minimized, hidden or fully covered (the page's visibility). */
export function usePageVisible(): boolean {
  const [visible, setVisible] = useState(() => document.visibilityState === 'visible')
  useEffect(() => {
    const update = () => setVisible(document.visibilityState === 'visible')
    document.addEventListener('visibilitychange', update)
    return () => document.removeEventListener('visibilitychange', update)
  }, [])
  return visible
}

/** Deck's window has the keyboard focus: the user is looking at its front tab. */
export function useWindowFocused(): boolean {
  const [focused, setFocused] = useState(() => document.hasFocus())
  useEffect(() => {
    const on = () => setFocused(true)
    const off = () => setFocused(false)
    window.addEventListener('focus', on)
    window.addEventListener('blur', off)
    // A change between the first render and these listeners (the window is shown after its first
    // paint) would otherwise be missed.
    setFocused(document.hasFocus())
    return () => {
      window.removeEventListener('focus', on)
      window.removeEventListener('blur', off)
    }
  }, [])
  return focused
}
