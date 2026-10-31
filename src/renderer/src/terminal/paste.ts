/** The bracketed-paste markers xterm wraps a paste in, also in their one-character CSI form
 *  (U+009B), which quotePath refuses too. */
const MARKER = /(?:\u001b\[|\u009b)20[01]~/g

/** Text ready for xterm's paste(). xterm wraps a paste in ESC[200~ … ESC[201~ and removes nothing,
 *  so a pasted ESC[201~ would end the paste early, and what follows would act as typed keys
 *  (Ctrl+U, Enter). Removing one marker can join two halves into another, hence the loop. */
export function pasteSafe(text: string): string {
  let out = text
  for (let before = ''; before !== out; ) {
    before = out
    out = out.replace(MARKER, '')
  }
  return out
}
