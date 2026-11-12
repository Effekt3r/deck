import type { Session } from 'electron'

/** Deck's page never uses the camera or the microphone, so it never gets them. Deck holds the camera
 *  entitlement for its iPhone helper (macOS treats an iPhone's screen as a camera), and once macOS
 *  has let Deck use the camera, Electron would grant a page's request for it too: it grants every
 *  request it isn't told otherwise about. Every other permission keeps Electron's own answer, which
 *  is yes but for its check of `document.execCommand('paste')` (made only with the deprecated
 *  `enableDeprecatedPaste` on). */
export function denyMedia(session: Pick<Session, 'setPermissionRequestHandler' | 'setPermissionCheckHandler'>): void {
  session.setPermissionRequestHandler((_contents, permission, callback) => callback(permission !== 'media'))
  session.setPermissionCheckHandler((_contents, permission) => permission !== 'media' && permission !== 'deprecated-sync-clipboard-read')
}
