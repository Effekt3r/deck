import { EventEmitter } from 'node:events'
import { mkdirSync, mkdtempSync, readdirSync, rmSync, writeFileSync } from 'node:fs'
import { tmpdir } from 'node:os'
import { join } from 'node:path'
import { pathToFileURL } from 'node:url'
import { afterAll, afterEach, beforeEach, describe, expect, it, vi } from 'vitest'
import { IPC } from '@shared/channels'
import type { ClipboardPreview } from '@shared/types'
import type { BrowserWindow } from 'electron'
import { registerClipboardIpc } from './ipc'

const ipc = vi.hoisted(() => ({
  handlers: new Map<string, (...args: unknown[]) => unknown>(),
  listeners: new Map<string, (...args: unknown[]) => void>(),
}))
/** The mocked powerMonitor: minimal on/emit/removeAllListeners, so tests can just emit('lock-screen')
 *  etc. (hand-rolled, not the real EventEmitter: vi.hoisted's callback runs before the top-level
 *  `import { EventEmitter }` below is live, so it can't reference that import). */
const power = vi.hoisted(() => {
  const listeners = new Map<string, Set<() => void>>()
  return {
    on(event: string, fn: () => void) {
      if (!listeners.has(event)) listeners.set(event, new Set())
      listeners.get(event)!.add(fn)
    },
    emit(event: string) {
      for (const fn of [...(listeners.get(event) ?? [])]) fn()
    },
    removeAllListeners() {
      listeners.clear()
    },
  }
})
/** nativeImage.createThumbnailFromPath: every file gets one (a PNG the mocked decoder makes 1×1). */
const thumbs = vi.hoisted(() => ({ made: vi.fn(async () => ({ toPNG: () => Buffer.alloc(0) })) }))
const clip = vi.hoisted(() => ({
  /** readClipboard()'s one item: type → data; {} (the default) is an empty clipboard. */
  data: {} as Record<string, string | Uint8Array<ArrayBuffer>>,
  /** Every clipboard.read() call seen so far (readClipboard() makes two per call of its own). */
  calls: 0,
}))

vi.mock('electron', () => {
  const itemFor = (data: Record<string, string | Uint8Array<ArrayBuffer>>) => {
    const types = Object.keys(data)
    if (!types.length) return []
    return [{
      types,
      getType: async (type: string) => {
        if (!(type in data)) throw new Error(`no ${type}`)
        return new Blob([data[type]])
      },
    }]
  }
  return {
    ipcMain: {
      handle: (channel: string, fn: (...args: unknown[]) => unknown) => ipc.handlers.set(channel, fn),
      on: (channel: string, fn: (...args: unknown[]) => void) => ipc.listeners.set(channel, fn),
    },
    powerMonitor: power,
    clipboard: {
      read: async () => {
        clip.calls++
        return itemFor(clip.data)
      },
    },
    // image.ts only needs enough of nativeImage to round-trip a size and a data: URL. No test
    // drives a clipboard image through a focused window's look() (only through paste(), which
    // never touches imageInfo); the thumbnail tests decode createThumbnailFromPath's PNG with it.
    nativeImage: {
      createThumbnailFromPath: thumbs.made,
      createFromBuffer: () => {
        const img = {
          getSize: () => ({ width: 1, height: 1 }),
          isEmpty: () => false,
          toDataURL: () => 'data:image/png;base64,AA==',
          resize: () => img,
        }
        return img
      },
    },
  }
})

const invoke = async (channel: string, ...args: unknown[]) => ipc.handlers.get(channel)?.(undefined, ...args)
const emit = (channel: string, ...args: unknown[]) => ipc.listeners.get(channel)?.(undefined, ...args)

type Sent = [channel: string, item: ClipboardPreview | null]
/** The parts of BrowserWindow (and its WebContents) the clipboard IPC uses. */
class FakeWindow extends EventEmitter {
  focused = true
  destroyed = false
  readonly webContents = {
    sent: [] as Sent[],
    destroyed: false,
    send(channel: string, item: ClipboardPreview | null) {
      this.sent.push([channel, item])
    },
    isDestroyed() {
      return this.destroyed
    },
  }
  isFocused() {
    return this.focused
  }
  isDestroyed() {
    return this.destroyed
  }
}
// registerClipboardIpc().attach() takes a real BrowserWindow; FakeWindow only models the parts it uses.
const bw = (w: FakeWindow) => w as unknown as BrowserWindow

const roots: string[] = []
function freshTempDir(): string {
  const dir = mkdtempSync(join(tmpdir(), 'deck-clipboard-ipc-'))
  roots.push(dir)
  return dir
}
afterAll(() => {
  for (const dir of roots) rmSync(dir, { recursive: true, force: true })
})

beforeEach(() => {
  vi.useFakeTimers()
  clip.data = {}
  clip.calls = 0
})
afterEach(() => {
  vi.useRealTimers()
  vi.unstubAllEnvs()
  power.removeAllListeners()
})

describe('clipboard IPC', () => {
  it('answers a bad add() with an error, and dismiss() never throws', async () => {
    registerClipboardIpc({ tempDir: freshTempDir(), platform: 'darwin' })
    for (const bad of [42, {}, undefined]) {
      expect(await invoke(IPC.clipboardAdd, bad)).toEqual({ error: 'No clipboard item given.' })
      expect(() => emit(IPC.clipboardDismiss, bad)).not.toThrow()
    }
  })

  it('paste({ claude: "yes" }) is not Claude: an image on the clipboard pastes nothing', async () => {
    registerClipboardIpc({ tempDir: freshTempDir(), platform: 'darwin' })
    clip.data = { 'image/png': new Uint8Array([137, 80, 78, 71]) }
    expect(await invoke(IPC.clipboardPaste, { claude: 'yes' })).toBeNull()
  })

  it('while focused, reads happen on polls; lock-screen stops them, resume while still locked stays stopped, unlock-screen restarts them', async () => {
    const clipIpc = registerClipboardIpc({ tempDir: freshTempDir(), platform: 'darwin' })
    clip.data = { 'text/plain': 'hello' }
    const win = new FakeWindow()
    clipIpc.attach(bw(win))
    await vi.advanceTimersByTimeAsync(3500) // baseline, the arrival look, and a few polls
    expect(clip.calls).toBeGreaterThan(0)

    power.emit('lock-screen')
    await vi.advanceTimersByTimeAsync(100) // the one "leaving" look lock-screen triggers
    const locked = clip.calls
    await vi.advanceTimersByTimeAsync(3500)
    expect(clip.calls).toBe(locked) // locked: no more reads

    power.emit('resume') // woke still locked (no unlock-screen yet): stays stopped
    await vi.advanceTimersByTimeAsync(3500)
    expect(clip.calls).toBe(locked)

    power.emit('unlock-screen')
    await vi.advanceTimersByTimeAsync(3500)
    expect(clip.calls).toBeGreaterThan(locked) // unlocked: polling again

    clipIpc.dispose()
  })

  it('unlock-screen does not start polling when the window is not focused', async () => {
    const clipIpc = registerClipboardIpc({ tempDir: freshTempDir(), platform: 'darwin' })
    clip.data = { 'text/plain': 'hello' }
    const win = new FakeWindow()
    win.focused = false
    clipIpc.attach(bw(win)) // baseline() reads once; not focused, so focus() is never called
    await vi.advanceTimersByTimeAsync(0)
    const afterAttach = clip.calls

    power.emit('unlock-screen')
    await vi.advanceTimersByTimeAsync(3500)
    expect(clip.calls).toBe(afterAttach) // still not polling

    clipIpc.dispose()
  })

  it('suspend stops polling and resume restarts it, when unlocked and focused', async () => {
    const clipIpc = registerClipboardIpc({ tempDir: freshTempDir(), platform: 'darwin' })
    clip.data = { 'text/plain': 'hello' }
    const win = new FakeWindow()
    clipIpc.attach(bw(win))
    await vi.advanceTimersByTimeAsync(3500)
    expect(clip.calls).toBeGreaterThan(0)

    power.emit('suspend')
    await vi.advanceTimersByTimeAsync(100) // the one "leaving" look suspend triggers
    const suspended = clip.calls
    await vi.advanceTimersByTimeAsync(3500)
    expect(clip.calls).toBe(suspended)

    power.emit('resume') // never locked: resumes
    await vi.advanceTimersByTimeAsync(3500)
    expect(clip.calls).toBeGreaterThan(suspended)

    clipIpc.dispose()
  })

  it('nothing is sent once the window, or its webContents, is destroyed', async () => {
    for (const kind of ['window', 'webContents'] as const) {
      const clipIpc = registerClipboardIpc({ tempDir: freshTempDir(), platform: 'darwin' })
      clip.data = { 'text/plain': `destroyed ${kind}` }
      const win = new FakeWindow()
      if (kind === 'window') win.destroyed = true
      else win.webContents.destroyed = true
      clipIpc.attach(bw(win))
      await vi.advanceTimersByTimeAsync(3500)
      expect(win.webContents.sent).toEqual([])
      clipIpc.dispose()
    }
  })

  it.each([
    { platform: 'darwin', env: undefined, made: true },
    { platform: 'win32', env: undefined, made: false },
    { platform: 'win32', env: '1', made: true },
  ] as const)('copied image files get thumbnails on $platform with DECK_FILE_THUMBNAILS=$env: $made', async ({ platform, env, made }) => {
    if (env) vi.stubEnv('DECK_FILE_THUMBNAILS', env)
    thumbs.made.mockClear()
    const shot = join(freshTempDir(), 'shot.png')
    writeFileSync(shot, 'png')
    const clipIpc = registerClipboardIpc({ tempDir: freshTempDir(), platform })
    const win = new FakeWindow()
    clipIpc.attach(bw(win))
    await vi.advanceTimersByTimeAsync(100) // the baseline (empty) and the arrival look
    clip.data = { 'text/uri-list': pathToFileURL(shot).href }
    await vi.advanceTimersByTimeAsync(1000) // the next poll offers the file
    const items = () => win.webContents.sent.map(([, item]) => item)
    expect(items()[0]).toMatchObject({ kind: 'files', names: ['shot.png'] })
    expect(items()[0]).not.toHaveProperty('thumbnails')
    if (made) {
      // The thumbnail waits on a real stat(), which may finish during the timer advance above or
      // only after it.
      await vi.waitFor(() => expect(items()).toHaveLength(2))
      expect(items()[1]).toMatchObject({ id: items()[0]!.id, thumbnails: ['data:image/png;base64,AA=='] })
    } else {
      expect(thumbs.made).not.toHaveBeenCalled()
      expect(items()).toHaveLength(1)
    }
    clipIpc.dispose()
  })

  it('attach() runs once', () => {
    const clipIpc = registerClipboardIpc({ tempDir: freshTempDir(), platform: 'darwin' })
    clipIpc.attach(bw(new FakeWindow()))
    expect(() => clipIpc.attach(bw(new FakeWindow()))).toThrow('attach() runs once')
    clipIpc.dispose()
  })

  it("removes the temp folder's own files at register, and again at dispose", () => {
    const tempDir = freshTempDir()
    const file = join(tempDir, 'clipboard-0123456789abcdef.png')
    writeFileSync(file, 'x')

    const clipIpc = registerClipboardIpc({ tempDir, platform: 'darwin' })
    expect(() => readdirSync(tempDir)).toThrow() // the leftover file, and the now-empty folder, are gone

    mkdirSync(tempDir)
    writeFileSync(file, 'x')
    clipIpc.dispose()
    expect(() => readdirSync(tempDir)).toThrow()
  })
})
