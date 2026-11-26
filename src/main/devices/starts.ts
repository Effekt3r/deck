import type { DeviceInfo, StartableDevice } from '@shared/types'

/** How long a start may take before it's given up: until the device is listed, which for an
 *  emulator's cold boot can be over a minute. */
export const START_DEADLINE_MS = 3 * 60_000

/** "1 minute", "3 minutes": whole minutes, singular only for exactly one. */
function minutesText(ms: number): string {
  const minutes = Math.round(ms / 60_000)
  return `${minutes} minute${minutes === 1 ? '' : 's'}`
}

interface Start {
  /** As it was offered when started. */
  device: StartableDevice
  /** Why it failed; null while it's starting. */
  error: string | null
  timer: ReturnType<typeof setTimeout> | null
}

/** How a start's own command reports back, about that start only: once it's no longer the device's
 *  start (listed, forgotten, cleared, or started again), both do nothing, so an older command of the
 *  same device (an emulator still closing after Stop, then Start) can't touch a newer start. */
export interface StartHandle {
  /** Its command failed: the start keeps `why` until it's started again (Try again). Only the first
   *  failure counts. */
  fail(why: string): void
  /** It ended without failing (the emulator's window closed cleanly): forgotten, as forget(id) does. */
  forget(): void
}

/** The emulators and simulators started from the panel, from the click until they're listed among
 *  the devices, for 3 minutes at most. One whose command fails, or that runs out of time, keeps its
 *  error until it's started again (Try again). Merged into what the panel can start. */
export class Starts {
  private readonly starts = new Map<string, Start>()

  /** `changed`: a start failed or ran out of time, so what can be started changed. */
  constructor(private readonly changed: () => void, private readonly deadlineMs = START_DEADLINE_MS) {}

  /** `device` starts now: how its command reports back (StartHandle), or null when it's already
   *  starting (a second click). Starting one that failed (Try again) clears its error. */
  begin(device: StartableDevice): StartHandle | null {
    const known = this.starts.get(device.id)
    if (known && known.error === null) return null
    if (known?.timer) clearTimeout(known.timer)
    const start: Start = { device: { id: device.id, kind: device.kind, name: device.name, detail: device.detail }, error: null, timer: null }
    this.starts.set(device.id, start)
    // Only this start: a later start of the same device has its own.
    const current = () => this.starts.get(device.id) === start
    const fail = (why: string) => {
      if (!current() || start.error !== null) return
      if (start.timer) clearTimeout(start.timer)
      start.timer = null
      start.error = why
      this.changed()
    }
    start.timer = setTimeout(() => fail(`It didn't start within ${minutesText(this.deadlineMs)}.`), this.deadlineMs)
    return {
      fail,
      forget: () => {
        if (current()) this.forget(device.id)
      },
    }
  }

  /** Ends the starts whose device is listed now: it has started, whatever its command said. */
  listed(devices: readonly DeviceInfo[]): void {
    for (const device of devices) {
      const start = this.starts.get(device.id)
      if (!start) continue
      if (start.timer) clearTimeout(start.timer)
      this.starts.delete(device.id)
    }
  }

  /** Forgets `id`'s start outright, whichever start it is, deadline included: Stop was clicked, so its
   *  command's own outcome, even a late one, must never show as an error. A silent no-op without a
   *  start to forget (already ended, or never began). */
  forget(id: string): void {
    const start = this.starts.get(id)
    if (!start) return
    if (start.timer) clearTimeout(start.timer)
    this.starts.delete(id)
    this.changed()
  }

  /** What the panel can start: `offered` (the AVDs, the shut-down simulators) less the devices
   *  running, each with its start's state, and the starts no longer offered (a simulator booting);
   *  emulators first, each kind by name. Stands on its own: a start whose device is among `devices`
   *  is skipped here too, so a running device never comes back as starting even without a prior
   *  `listed()` call for it. */
  merge(offered: readonly StartableDevice[], devices: readonly DeviceInfo[]): StartableDevice[] {
    const running = new Set(devices.map((d) => d.id))
    const items = new Map<string, StartableDevice>()
    for (const device of offered) if (!running.has(device.id)) items.set(device.id, device)
    for (const [id, start] of this.starts) {
      if (running.has(id)) continue
      const base = items.get(id) ?? start.device
      items.set(id, start.error === null ? { ...base, starting: true } : { ...base, error: start.error })
    }
    return [...items.values()].sort((a, b) =>
      a.kind === b.kind ? a.name.localeCompare(b.name, undefined, { numeric: true }) || a.id.localeCompare(b.id) : a.kind === 'emulator' ? -1 : 1)
  }

  /** Forgets every start: nothing watches any more, or Deck quits. */
  clear(): void {
    for (const start of this.starts.values()) if (start.timer) clearTimeout(start.timer)
    this.starts.clear()
  }
}
