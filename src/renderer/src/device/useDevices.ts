import { useCallback, useEffect, useLayoutEffect, useRef, useState } from 'react'
import type { DeviceInfo, DeviceList, DeviceProject } from '@shared/types'
import { GONE_MS, type Held, type PanelChoice, type PanelView, panelView } from './pick'

const NONE: PanelView = { kind: 'none' }

/** The devices Deck sees while `needed` (main runs adb only while some tab needs it); null until
 *  main has its first list. */
export function useDeviceList(needed: boolean): DeviceList | null {
  const [list, setList] = useState<DeviceList | null>(null)
  useEffect(() => {
    if (!needed) return
    let live = true
    let pushed = false
    const stop = window.deck.devices.watch()
    // A push can arrive before list()'s answer: once one has, it's the newer.
    const off = window.deck.devices.onList((next) => {
      pushed = true
      setList(next)
    })
    window.deck.devices.list().then(
      (now) => {
        if (live && !pushed && now) setList(now)
      },
      (err: unknown) => console.error('device panel: listing the devices failed', err),
    )
    return () => {
      live = false
      off()
      stop()
      setList(null)
    }
  }, [needed])
  return list
}

/** The tab's project for the device panel (null until known), read again whenever the tab comes to
 *  the front, as another tab may have picked the project's device meanwhile; and how to pick one.
 *  A read that fails keeps what was known of the same folder. */
export function useDeviceProject(folder: string, active: boolean): [DeviceProject | null, (id: string) => void] {
  const [known, setKnown] = useState<{ folder: string; project: DeviceProject } | null>(null)
  const project = known?.project ?? null
  const current = useRef(project)
  useLayoutEffect(() => {
    current.current = project
  }, [project])
  useEffect(() => {
    if (!folder || !active) return
    let live = true
    window.deck.devices.project(folder).then(
      (next) => {
        if (live) setKnown({ folder, project: next })
      },
      (err: unknown) => {
        if (!live) return
        console.error('device panel: reading the project failed', err)
        setKnown((k) => (k?.folder === folder ? k : null))
      },
    )
    return () => {
      live = false
    }
  }, [folder, active])
  const pick = useCallback((id: string) => {
    const p = current.current
    if (!p) return
    setKnown((k) => (k ? { ...k, project: { ...k.project, pick: id } } : k))
    window.deck.devices.pick(p.root, id).catch((err: unknown) => console.error('device panel: saving the pick failed', err))
  }, [])
  return [project, pick]
}

/** The panel's view (panelView): a shown device that went away stays, as gone, for 10 s, unless the
 *  tab picks another device (`pick`: the tab's, else the project's) or moves to another project
 *  (`root`). Nothing while `choice` is null (the project or the devices aren't known: the panel
 *  isn't needed, or its project couldn't be read), and the hold is let go then. */
export function useHeldView(choice: PanelChoice | null, devices: DeviceInfo[], root: string | null, pick: string | null): PanelView {
  const held = useRef<{ root: string | null; held: Held | null }>({ root: null, held: null })
  const [tick, rerender] = useState(0)
  const kept = held.current.root === root ? held.current.held : null
  const result = choice ? panelView(choice, devices, kept, Date.now(), pick) : { view: NONE, held: null }
  // Written while rendering: for the same inputs panelView answers the same, so a render React runs
  // twice (StrictMode) or throws away holds the same device since the same moment.
  held.current = { root, held: result.held }
  const goneSince = result.held?.goneSince ?? null
  // Timers and Date.now() keep different clocks, so a timer can fire a little early: it's set again
  // (tick) until the hold has run out.
  useEffect(() => {
    if (goneSince === null) return
    const timer = setTimeout(() => rerender((n) => n + 1), Math.max(1, goneSince + GONE_MS - Date.now()))
    return () => clearTimeout(timer)
  }, [goneSince, tick])
  return result.view
}
