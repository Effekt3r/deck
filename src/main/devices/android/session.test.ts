import { describe, expect, it, vi } from 'vitest'
import { controlMessages } from './input'
import type { ScrcpySession } from './scrcpy'
import { androidSession } from './session'

function fakeScrcpy() {
  return { send: vi.fn(), stop: vi.fn() } satisfies ScrcpySession
}

describe('androidSession', () => {
  it('keyframe() sends the reset video message: one byte, 0x11', () => {
    const scrcpy = fakeScrcpy()
    androidSession(scrcpy).keyframe()
    expect(scrcpy.send).toHaveBeenCalledWith(Buffer.from([0x11]))
  })

  it('input() sends exactly what controlMessages makes of it', () => {
    const scrcpy = fakeScrcpy()
    const input = { type: 'key', keycode: 3, meta: 0 }
    androidSession(scrcpy).input(input)
    expect(scrcpy.send.mock.calls).toEqual(controlMessages(input).map((message) => [message]))
  })

  it("a simulator-only input (hid, button) sends nothing: scrcpy has no control message for it", () => {
    const scrcpy = fakeScrcpy()
    androidSession(scrcpy).input({ type: 'hid', usage: 40, modifiers: 0 })
    androidSession(scrcpy).input({ type: 'button', button: 'home' })
    expect(scrcpy.send).not.toHaveBeenCalled()
  })

  it('stop() stops scrcpy', () => {
    const scrcpy = fakeScrcpy()
    androidSession(scrcpy).stop()
    expect(scrcpy.stop).toHaveBeenCalled()
  })
})
