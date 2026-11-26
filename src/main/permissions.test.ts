import type { Session } from 'electron'
import { describe, expect, it } from 'vitest'
import { denyMedia } from './permissions'

type RequestHandler = (contents: unknown, permission: string, callback: (granted: boolean) => void) => void
type CheckHandler = (contents: unknown, permission: string) => boolean

function installed(): { request?: RequestHandler; check?: CheckHandler } {
  const handlers: { request?: RequestHandler; check?: CheckHandler } = {}
  const session = {
    setPermissionRequestHandler: (handler: RequestHandler) => (handlers.request = handler),
    setPermissionCheckHandler: (handler: CheckHandler) => (handlers.check = handler),
  }
  denyMedia(session as unknown as Session)
  return handlers
}

describe('denyMedia', () => {
  it('refuses the page the camera, the microphone and the screen, asked for or checked', () => {
    const handlers = installed()
    const answers: boolean[] = []
    handlers.request?.(null, 'media', (granted) => answers.push(granted))
    handlers.request?.(null, 'display-capture', (granted) => answers.push(granted))
    expect(answers).toEqual([false, false])
    expect(handlers.check?.(null, 'media')).toBe(false)
    expect(handlers.check?.(null, 'display-capture')).toBe(false)
  })

  it("keeps Electron's own answer to everything else, its no to document.execCommand('paste') included", () => {
    const handlers = installed()
    const answers: boolean[] = []
    handlers.request?.(null, 'clipboard-sanitized-write', (granted) => answers.push(granted))
    handlers.request?.(null, 'fullscreen', (granted) => answers.push(granted))
    expect(answers).toEqual([true, true])
    expect(handlers.check?.(null, 'fullscreen')).toBe(true)
    expect(handlers.check?.(null, 'clipboard-sanitized-write')).toBe(true)
    expect(handlers.check?.(null, 'deprecated-sync-clipboard-read')).toBe(false)
  })
})
