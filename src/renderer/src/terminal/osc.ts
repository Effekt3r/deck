// xterm hands OSC handlers the payload after "7;" / "1337;".

/** 'file://host/Users/f/My%20Dir' → '/Users/f/My Dir'; 'file://PC/C:/x' → 'C:/x'. */
export function parseOsc7(data: string): string | null {
  const m = /^file:\/\/[^/]*(\/.*)$/s.exec(data)
  if (!m) return null
  let path = m[1]
  try {
    path = decodeURIComponent(path)
  } catch {
    // The PowerShell hook doesn't encode '%': keep the path as it came.
  }
  return /^\/[A-Za-z]:/.test(path) ? path.slice(1) : path
}

/** 'SetUserVar=NAME=<base64 utf-8>' → { name, value }. */
export function parseSetUserVar(data: string): { name: string; value: string } | null {
  const m = /^SetUserVar=([^=]+)=(.*)$/s.exec(data)
  if (!m) return null
  const value = decodeBase64(m[2])
  return value === null ? null : { name: m[1], value }
}

function decodeBase64(s: string): string | null {
  try {
    const bytes = Uint8Array.from(atob(s), (c) => c.charCodeAt(0))
    return new TextDecoder().decode(bytes)
  } catch {
    return null
  }
}
