/**
 * What a link from terminal output or the Claude panel may open: web and mail links only, never
 * file:// or custom schemes. A mailto: loses everything from its `?` (subject, body, and the
 * attach= some mail clients honour). null: not opened.
 */
export function externalUrl(url: unknown): string | null {
  if (typeof url !== 'string') return null
  if (/^https?:\/\//i.test(url)) return url
  if (/^mailto:/i.test(url)) return url.split('?', 1)[0]
  return null
}
