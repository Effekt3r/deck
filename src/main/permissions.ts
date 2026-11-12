import type { Session } from 'electron'

/** The camera and the microphone (`media`), and the screen (`display-capture`: getDisplayMedia, or
 *  getUserMedia with a desktop source). */
const REFUSED: ReadonlySet<string> = new Set(['media', 'display-capture'])

/** Deck's page never uses the camera, the microphone or the screen, so it never gets them. Deck holds
 *  the camera entitlement for its iPhone helper (macOS treats an iPhone's screen as a camera), and once
 *  macOS has let Deck use the camera, Electron would grant a page's request for it too: it grants every
 *  request it isn't told otherwise about. Every other permission keeps Electron's own answer, which is
 *  yes but for its check of `document.execCommand('paste')` (made only with the deprecated
 *  `enableDeprecatedPaste` on). */
export function denyMedia(session: Pick<Session, 'setPermissionRequestHandler' | 'setPermissionCheckHandler'>): void {
  session.setPermissionRequestHandler((_contents, permission, callback) => callback(!REFUSED.has(permission)))
  session.setPermissionCheckHandler((_contents, permission) => !REFUSED.has(permission) && permission !== 'deprecated-sync-clipboard-read')
}
