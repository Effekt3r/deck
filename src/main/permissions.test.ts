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
  it('refuses the page the camera and the microphone, and nothing else', () => {
    const handlers = installed()
    const answers: boolean[] = []
    handlers.request?.(null, 'media', (granted) => answers.push(granted))
    handlers.request?.(null, 'clipboard-sanitized-write', (granted) => answers.push(granted))
    expect(answers).toEqual([false, true])
    expect(handlers.check?.(null, 'media')).toBe(false)
    expect(handlers.check?.(null, 'fullscreen')).toBe(true)
  })

  it("keeps Electron's own no to document.execCommand('paste')", () => {
    expect(installed().check?.(null, 'deprecated-sync-clipboard-read')).toBe(false)
  })
})
