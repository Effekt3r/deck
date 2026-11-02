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
