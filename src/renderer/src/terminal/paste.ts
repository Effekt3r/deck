/** Characters the tty acts on before the program reads them. zsh's line editor keeps ISIG on, so a
 *  pasted ^C throws away the unread input (the paste's ESC[200~ too) and what follows arrives as typed
 *  keys (checked with zsh 5.9). ^Z and ^\ can do the same where the line editor leaves them on. */
const SIGNALS = /[\u0003\u001a\u001c]/g
/** The bracketed-paste markers, also in their one-character CSI form (U+009B). Not global: used with test(). */
const MARKER = /(?:\u001b\[|\u009b)20[01]~/

/** Text ready for xterm's paste(), which wraps it in ESC[200~ … ESC[201~ and filters nothing: without
 *  the signal characters and without anything that would end the paste early. */
export function pasteSafe(text: string): string {
  const out = text.replace(SIGNALS, '') // can join a marker; the check below runs after it
  return MARKER.test(out) ? withoutMarkers(out) : out
}

/** One pass. A marker can only form ending at the '~' just kept, so check the kept text's end there.
 *  Repeating replace() until nothing changes is quadratic on nested markers. */
function withoutMarkers(text: string): string {
  const kept = new Uint16Array(text.length)
  let n = 0
  for (let i = 0; i < text.length; i++) {
    const c = text.charCodeAt(i)
    kept[n++] = c
    if (c !== 0x7e || n < 5 || (kept[n - 2] !== 0x30 && kept[n - 2] !== 0x31) || kept[n - 3] !== 0x30 || kept[n - 4] !== 0x32) continue
    if (kept[n - 5] === 0x9b) n -= 5
    else if (n >= 6 && kept[n - 5] === 0x5b && kept[n - 6] === 0x1b) n -= 6
  }
  let s = ''
  for (let i = 0; i < n; i += 8192) s += String.fromCharCode(...kept.subarray(i, Math.min(n, i + 8192)))
  return s
}
