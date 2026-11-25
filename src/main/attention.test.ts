import { beforeEach, describe, expect, it, vi } from 'vitest'
import { IPC } from '@shared/channels'
import { attentionSignal, registerAttention } from './attention'

const electron = vi.hoisted(() => ({
  listeners: new Map<string, (...args: unknown[]) => void>(),
  dock: { setBadge: vi.fn(), bounce: vi.fn() },
}))
vi.mock('electron', () => ({
  app: { dock: electron.dock },
  ipcMain: { on: (channel: string, fn: (...args: unknown[]) => void) => electron.listeners.set(channel, fn) },
}))

describe('attentionSignal', () => {
  it('badges the count, and draws the eye only when it rises while Deck is in the background', () => {
    expect(attentionSignal(0, 1, false)).toEqual({ badge: '1', alert: true })
    expect(attentionSignal(0, 1, true)).toEqual({ badge: '1', alert: false })
    expect(attentionSignal(1, 2, false)).toEqual({ badge: '2', alert: true })
    expect(attentionSignal(2, 1, false)).toEqual({ badge: '1', alert: false })
    expect(attentionSignal(1, 1, false)).toEqual({ badge: '1', alert: false })
    expect(attentionSignal(1, 0, false)).toEqual({ badge: '', alert: false })
  })
})

describe('registerAttention', () => {
  /** The parts of BrowserWindow it uses. */
  function fakeWindow(focused: boolean, destroyed = false) {
    const handlers = new Map<string, () => void>()
    return {
      isDestroyed: () => destroyed,
      isFocused: () => focused,
      flashFrame: vi.fn(),
      on: (event: string, fn: () => void) => handlers.set(event, fn),
      emit: (event: string) => handlers.get(event)?.(),
    }
  }
  const send = (waiting: unknown) => electron.listeners.get(IPC.appAttention)?.({}, waiting)

  beforeEach(() => {
    electron.listeners.clear()
    electron.dock.setBadge.mockClear()
    electron.dock.bounce.mockClear()
  })

  it('macOS: badges the count, bounces once when it rises in the background, and ignores what isn’t a count', () => {
    registerAttention('darwin').attach(fakeWindow(false) as never)
    for (const bad of ['2', -1, 1.5, Number.NaN, 1000, null]) expect(() => send(bad)).not.toThrow()
    expect(electron.dock.setBadge).not.toHaveBeenCalled()
    send(2)
    expect(electron.dock.setBadge).toHaveBeenLastCalledWith('2')
    expect(electron.dock.bounce).toHaveBeenCalledTimes(1)
    send(1)
    expect(electron.dock.setBadge).toHaveBeenLastCalledWith('1')
    expect(electron.dock.bounce).toHaveBeenCalledTimes(1)
    send(0)
    expect(electron.dock.setBadge).toHaveBeenLastCalledWith('')
  })

  it('macOS: no bounce while Deck is in front', () => {
    registerAttention('darwin').attach(fakeWindow(true) as never)
    send(1)
    expect(electron.dock.setBadge).toHaveBeenLastCalledWith('1')
    expect(electron.dock.bounce).not.toHaveBeenCalled()
  })

  it('Windows: flashes the taskbar on a rise in the background, until Deck comes to the front', () => {
    const win = fakeWindow(false)
    registerAttention('win32').attach(win as never)
    send(1)
    expect(win.flashFrame).toHaveBeenLastCalledWith(true)
    win.emit('focus')
    expect(win.flashFrame).toHaveBeenLastCalledWith(false)
    expect(electron.dock.setBadge).not.toHaveBeenCalled()
  })

  it('a destroyed window draws no eye, and nothing throws', () => {
    const win = fakeWindow(false, true)
    registerAttention('win32').attach(win as never)
    expect(() => send(1)).not.toThrow()
    expect(win.flashFrame).not.toHaveBeenCalled()
  })
})
