# Usage card Implementation Plan

> **For agentic workers:** REQUIRED SUB-SKILL: Use superpowers:subagent-driven-development (recommended) or superpowers:executing-plans to implement this plan task-by-task. Steps use checkbox (`- [ ]`) syntax for tracking.

**Goal:** A card at the bottom of the Claude pane, above the clipboard card, that shows Claude's
plan usage (weekly and 5-hour limits) as a donut. Deck gets the numbers by being Claude Code's
status line, which the user turns on with Connect.

**Architecture:** Connect writes a `statusLine` command into Claude Code's user settings. Claude
Code runs that command after every reply, and the command saves Claude Code's JSON input to
`<userData>/usage/statusline.json`. Main watches that folder, merges `rate_limits` into
`usage.json` and pushes a `UsageState` to the renderer. The renderer draws it with a pure view
model (`view.ts`) and an SVG donut. Spec:
`docs/superpowers/specs/2026-11-02-usage-card-design.md`.

**Tech Stack:** Electron 45 (main/preload/renderer), React, TypeScript, vitest (node
environment), plain CSS with the tokens in `src/renderer/src/styles.css`.

**Conventions:**
- Node 22: `export PATH="$HOME/.nvm/versions/node/v22.19.0/bin:$PATH"` before npm commands.
- Commits use `git -c user.email=franco@effektstudios.com commit` and never carry
  `Co-Authored-By`. They end with
  `Claude-Session: https://claude.ai/code/session_012TidnD5ajWnitu5TEgV7qD`.
- Comments explain why, in the repo's plain style. Tests sit next to their source as `*.test.ts`.

---

## File structure

| File | Responsibility |
|---|---|
| `src/shared/types.ts` (modify) | `UsageWindow`, `UsageLink`, `UsageState`, `UsageChange`, `DeckApi.usage` |
| `src/shared/channels.ts` (modify) | `usage:get`, `usage:changed`, `usage:connect`, `usage:disconnect` |
| `src/preload/index.ts` (modify) | `window.deck.usage` |
| `src/main/fs/atomic.ts` (create) | `renameRetrying` (moved from `git/targets-store.ts`), `writeFileAtomic` |
| `src/main/usage/report.ts` (create) | status line JSON → `{ five_hour?, seven_day? }` (pure) |
| `src/main/usage/merge.ts` (create) | which of two reports of a window to keep (pure) |
| `src/main/usage/statusline.ts` (create) | the status line command and the macOS/Linux script (pure) |
| `src/main/usage/settings.ts` (create) | Claude Code's settings file: link state, connect, disconnect |
| `src/main/usage/store.ts` (create) | the kept numbers, `usage.json` |
| `src/main/usage/watch.ts` (create) | reading a report file, watching the folder, removing leftovers |
| `src/main/usage/ipc.ts` (create) | wiring: start-up, IPC handlers, pushes, window focus |
| `src/main/index.ts` (modify) | registers and attaches the usage IPC |
| `src/renderer/src/hooks.ts` (create) | `useStoredFlag`, `useTick` (moved from `ClaudePanel.tsx`) |
| `src/renderer/src/icons.tsx` (modify) | `Caret` (moved from `ClaudePanel.tsx`) |
| `src/renderer/src/usage/view.ts` (create) | state + now → rings, texts, tones (pure) |
| `src/renderer/src/usage/Donut.tsx` (create) | the SVG donut |
| `src/renderer/src/usage/UsageCard.tsx` (create) | the card and its states |
| `src/renderer/src/usage/useUsage.ts` (create) | subscribes to `window.deck.usage` |
| `src/renderer/src/usage/usage.css` (create) | the card's styles |
| `src/renderer/src/App.tsx` (modify) | the card between `ClaudePanel` and `ClipboardCard` |
| `CLAUDE.md`, `README.md`, `docs/TESTING.md` (modify) | docs |

---

### Task 1: The IPC contract

**Files:**
- Modify: `src/shared/types.ts` (after `InsertResult`, and inside `DeckApi` after `clipboard`)
- Modify: `src/shared/channels.ts`
- Modify: `src/preload/index.ts`

- [ ] **Step 1: Add the types.** In `src/shared/types.ts`, after
  `export type InsertResult = { text: string } | { error: string }`, add:

```ts
/** One of Claude's plan limits, as Claude Code's status line last reported it (`rate_limits`). */
export interface UsageWindow {
  /** 0–100. */
  usedPercentage: number
  /** When the window resets: ms since the epoch. */
  resetsAt: number
}

/** Deck and Claude Code's status line, which is how Deck gets the numbers. */
export type UsageLink =
  /** Deck's command is the status line in Claude Code's user settings. */
  | { state: 'connected' }
  /** No status line is set. */
  | { state: 'off' }
  /** Another status line is set: `command` is what it runs. */
  | { state: 'other'; command: string }
  /** Claude Code's settings can't be read, so Deck won't write them. */
  | { state: 'error'; message: string }

/** What the usage card shows. */
export interface UsageState {
  link: UsageLink
  /** Claude Code's user settings file, which Connect changes. */
  settingsFile: string
  fiveHour: UsageWindow | null
  sevenDay: UsageWindow | null
  /** When Claude Code last reported (ms since the epoch); null before its first report. */
  updatedAt: number | null
}

/** Connect's or Disconnect's outcome: the new state, or what went wrong. */
export type UsageChange = { state: UsageState } | { error: string }
```

  In `DeckApi`, after the `clipboard: { … }` block, add:

```ts
  usage: {
    /** The usage card's state now. */
    get(): Promise<UsageState>
    /** A newer state: a report from Claude Code, a changed link, Connect or Disconnect. */
    onChange(cb: (state: UsageState) => void): () => void
    /** Makes Deck Claude Code's status line. `replace`: also when another status line is set
     *  (Disconnect puts that one back). */
    connect(replace: boolean): Promise<UsageChange>
    /** Puts back the status line Claude Code had before Connect, or none. */
    disconnect(): Promise<UsageChange>
  }
```

- [ ] **Step 2: Add the channels.** In `src/shared/channels.ts`, after
  `clipboardDismiss: 'clipboard:dismiss',` add:

```ts
  usageGet: 'usage:get',
  usageChanged: 'usage:changed',
  usageConnect: 'usage:connect',
  usageDisconnect: 'usage:disconnect',
```

- [ ] **Step 3: Expose it in the preload.** In `src/preload/index.ts`, add `UsageState` to the
  type import from `@shared/types`, and after the `clipboard: { … },` block add:

```ts
  usage: {
    get: () => ipcRenderer.invoke(IPC.usageGet),
    onChange: (cb) => on<[UsageState]>(IPC.usageChanged, cb),
    connect: (replace) => ipcRenderer.invoke(IPC.usageConnect, replace),
    disconnect: () => ipcRenderer.invoke(IPC.usageDisconnect),
  },
```

- [ ] **Step 4: Typecheck.** Run: `npm run typecheck`. Expected: no errors.

- [ ] **Step 5: Commit.**

```bash
git add src/shared/types.ts src/shared/channels.ts src/preload/index.ts
git -c user.email=franco@effektstudios.com commit -m "Usage: the IPC contract" -m "Claude-Session: https://claude.ai/code/session_012TidnD5ajWnitu5TEgV7qD"
```

---

### Task 2: Atomic writes in one place

**Files:**
- Create: `src/main/fs/atomic.ts`
- Modify: `src/main/git/targets-store.ts` (its private `renameRetrying` moves out)
- Test: `src/main/fs/atomic.test.ts`

- [ ] **Step 1: Write the failing test** `src/main/fs/atomic.test.ts`:

```ts
import { mkdtempSync, readdirSync, readFileSync, rmSync, statSync, writeFileSync } from 'node:fs'
import { tmpdir } from 'node:os'
import { join } from 'node:path'
import { afterAll, describe, expect, it } from 'vitest'
import { writeFileAtomic } from './atomic'

const root = mkdtempSync(join(tmpdir(), 'deck-atomic-'))
afterAll(() => rmSync(root, { recursive: true, force: true }))

describe('writeFileAtomic', () => {
  it('writes a new file and replaces an old one, leaving no temp file', async () => {
    const file = join(root, 'a.json')
    await writeFileAtomic(file, 'one')
    await writeFileAtomic(file, 'two')
    expect(readFileSync(file, 'utf8')).toBe('two')
    expect(readdirSync(root).filter((n) => n.startsWith('a.json'))).toEqual(['a.json'])
  })

  it.skipIf(process.platform === 'win32')('gives the new file the mode it is asked for', async () => {
    const file = join(root, 'b.json')
    writeFileSync(file, 'old', { mode: 0o600 })
    await writeFileAtomic(file, 'new', 0o600)
    expect(statSync(file).mode & 0o777).toBe(0o600)
  })

  it('rejects when the folder is missing', async () => {
    await expect(writeFileAtomic(join(root, 'missing', 'c.json'), 'x')).rejects.toThrow()
  })
})
```

- [ ] **Step 2: Run it.** `npx vitest run src/main/fs` → FAIL (cannot find `./atomic`).

- [ ] **Step 3: Implement** `src/main/fs/atomic.ts`:

```ts
import { chmod, rename, rm, writeFile } from 'node:fs/promises'

/** Two writes of one file in flight at once still get their own temp files. */
let seq = 0

/** Windows: a virus scanner or indexer briefly holding the target makes rename fail with
 *  EPERM/EBUSY; a few short retries get past it. */
export async function renameRetrying(from: string, to: string): Promise<void> {
  for (let attempt = 0; ; attempt++) {
    try {
      return await rename(from, to)
    } catch (err) {
      const code = (err as NodeJS.ErrnoException).code
      if (attempt >= 4 || (code !== 'EPERM' && code !== 'EBUSY' && code !== 'EACCES')) throw err
      await new Promise((resolve) => setTimeout(resolve, 50 * (attempt + 1)))
    }
  }
}

/** `text` written beside `file` and renamed over it, so a reader never sees half a file. `mode`
 *  (permission bits) is set on the new file before it takes the old one's place. */
export async function writeFileAtomic(file: string, text: string, mode?: number): Promise<void> {
  const tmp = `${file}.${process.pid}.${++seq}.tmp`
  try {
    await writeFile(tmp, text, 'utf8')
    if (mode !== undefined) await chmod(tmp, mode)
    await renameRetrying(tmp, file)
  } catch (err) {
    await rm(tmp, { force: true }).catch(() => {})
    throw err
  }
}
```

- [ ] **Step 4: Use it in the targets store.** In `src/main/git/targets-store.ts`, delete the
  `renameRetrying` function at the end of the file (with its comment), change the first import
  to `import { mkdir, readFile, writeFile } from 'node:fs/promises'`, and add
  `import { renameRetrying } from '../fs/atomic'` below the other imports.

- [ ] **Step 5: Run the tests.** `npx vitest run src/main/fs src/main/git/targets-store.test.ts`
  → PASS. Then `npm run typecheck` → no errors.

- [ ] **Step 6: Commit.**

```bash
git add src/main/fs src/main/git/targets-store.ts
git -c user.email=franco@effektstudios.com commit -m "Main: atomic writes in one place" -m "Claude-Session: https://claude.ai/code/session_012TidnD5ajWnitu5TEgV7qD"
```

---

### Task 3: Reading a report

**Files:**
- Create: `src/main/usage/report.ts`
- Test: `src/main/usage/report.test.ts`

- [ ] **Step 1: Write the failing test** `src/main/usage/report.test.ts`:

```ts
import { describe, expect, it } from 'vitest'
import { readReport } from './report'

describe('readReport', () => {
  it("takes both windows from Claude Code's status line input, resets_at in ms", () => {
    const input = {
      session_id: 's',
      cwd: '/x',
      rate_limits: {
        five_hour: { used_percentage: 34.5, resets_at: 1_793_620_800 },
        seven_day: { used_percentage: 85, resets_at: 1_793_653_200 },
      },
    }
    expect(readReport(input)).toEqual({
      five_hour: { usedPercentage: 34.5, resetsAt: 1_793_620_800_000 },
      seven_day: { usedPercentage: 85, resetsAt: 1_793_653_200_000 },
    })
  })

  it('keeps a window that comes alone (seen live: only seven_day)', () => {
    expect(readReport({ rate_limits: { seven_day: { used_percentage: 85, resets_at: 1_793_653_200 } } }))
      .toEqual({ seven_day: { usedPercentage: 85, resetsAt: 1_793_653_200_000 } })
  })

  it('is empty before the first API response, and for anything that is not a report', () => {
    for (const input of [{}, { rate_limits: null }, { rate_limits: [] }, null, 'x', 42, []]) {
      expect(readReport(input)).toEqual({})
    }
  })

  it('skips windows without finite numbers or a real reset time, and limits it does not show', () => {
    expect(readReport({
      rate_limits: {
        five_hour: { used_percentage: '34', resets_at: 1_793_620_800 },
        seven_day: { used_percentage: 85, resets_at: 0 },
        spend_limit: { used_percentage: 12, resets_at: 1_793_653_200 },
      },
    })).toEqual({})
  })

  it('keeps the percentage within 0–100', () => {
    const report = readReport({
      rate_limits: {
        five_hour: { used_percentage: 120, resets_at: 1 },
        seven_day: { used_percentage: -3, resets_at: 1 },
      },
    })
    expect(report.five_hour?.usedPercentage).toBe(100)
    expect(report.seven_day?.usedPercentage).toBe(0)
  })
})
```

- [ ] **Step 2: Run it.** `npx vitest run src/main/usage/report.test.ts` → FAIL (no module).

- [ ] **Step 3: Implement** `src/main/usage/report.ts`:

```ts
import type { UsageWindow } from '@shared/types'

/** The windows the card shows, by the keys of Claude Code's status line input. */
export const WINDOWS = ['five_hour', 'seven_day'] as const
export type WindowKey = (typeof WINDOWS)[number]
export type UsageReport = Partial<Record<WindowKey, UsageWindow>>

/** The plan usage in Claude Code's status line input (`rate_limits`): a window counts with a
 *  finite `used_percentage` and a `resets_at` (Unix seconds) after the epoch. Everything else in
 *  the input is ignored. */
export function readReport(input: unknown): UsageReport {
  const report: UsageReport = {}
  const limits = isObject(input) ? input.rate_limits : undefined
  if (!isObject(limits)) return report
  for (const key of WINDOWS) {
    const window = limits[key]
    if (!isObject(window)) continue
    const used = window.used_percentage
    const resets = window.resets_at
    if (typeof used !== 'number' || !Number.isFinite(used)) continue
    if (typeof resets !== 'number' || !Number.isFinite(resets) || resets <= 0) continue
    report[key] = { usedPercentage: Math.min(Math.max(used, 0), 100), resetsAt: resets * 1000 }
  }
  return report
}

const isObject = (v: unknown): v is Record<string, unknown> => typeof v === 'object' && v !== null && !Array.isArray(v)
```

- [ ] **Step 4: Run it.** `npx vitest run src/main/usage/report.test.ts` → PASS.

- [ ] **Step 5: Commit.**

```bash
git add src/main/usage/report.ts src/main/usage/report.test.ts
git -c user.email=franco@effektstudios.com commit -m "Usage: read the plan usage from Claude Code's status line input" -m "Claude-Session: https://claude.ai/code/session_012TidnD5ajWnitu5TEgV7qD"
```

---

### Task 4: Which report of a window to keep

**Files:**
- Create: `src/main/usage/merge.ts`
- Test: `src/main/usage/merge.test.ts`

- [ ] **Step 1: Write the failing test** `src/main/usage/merge.test.ts`:

```ts
import { describe, expect, it } from 'vitest'
import { mergeWindow } from './merge'

const H = 3_600_000
const w = (usedPercentage: number, resetsAt: number) => ({ usedPercentage, resetsAt })

describe('mergeWindow', () => {
  it('takes the first report', () => {
    expect(mergeWindow(null, w(40, 10 * H))).toEqual(w(40, 10 * H))
  })

  it('keeps the higher percentage within one window: a lower one is older data', () => {
    const now = w(85, 10 * H)
    expect(mergeWindow(now, w(80, 10 * H))).toBe(now)
    expect(mergeWindow(now, w(87, 10 * H))).toEqual(w(87, 10 * H))
    const equal = w(85, 10 * H + 30 * 60_000) // the same window, half an hour apart
    expect(mergeWindow(now, equal)).toBe(equal)
  })

  it('takes a later window even when it is lower, and ignores an earlier one', () => {
    const now = w(85, 10 * H)
    expect(mergeWindow(now, w(3, 15 * H))).toEqual(w(3, 15 * H))
    expect(mergeWindow(now, w(99, 5 * H))).toBe(now)
  })
})
```

- [ ] **Step 2: Run it.** `npx vitest run src/main/usage/merge.test.ts` → FAIL.

- [ ] **Step 3: Implement** `src/main/usage/merge.ts`:

```ts
import type { UsageWindow } from '@shared/types'

/** Reset times this close together belong to one window: Claude's windows last 5 hours and 7 days. */
const SAME_WINDOW_MS = 60 * 60_000

/** The window to keep when a report arrives: `current` or `next` itself. Usage only rises within
 *  a window, so a lower percentage for the same window is older data (each session reports its
 *  own last API response, and an idle session's status line still runs on a mode change or at a
 *  reset). A report of an earlier window is older still. */
export function mergeWindow(current: UsageWindow | null, next: UsageWindow): UsageWindow {
  if (!current) return next
  if (Math.abs(next.resetsAt - current.resetsAt) < SAME_WINDOW_MS) {
    return next.usedPercentage >= current.usedPercentage ? next : current
  }
  return next.resetsAt > current.resetsAt ? next : current
}
```

- [ ] **Step 4: Run it.** `npx vitest run src/main/usage/merge.test.ts` → PASS.

- [ ] **Step 5: Commit.**

```bash
git add src/main/usage/merge.ts src/main/usage/merge.test.ts
git -c user.email=franco@effektstudios.com commit -m "Usage: keep the newest numbers of each window" -m "Claude-Session: https://claude.ai/code/session_012TidnD5ajWnitu5TEgV7qD"
```

---

### Task 5: The status line command and script

**Files:**
- Create: `src/main/usage/statusline.ts`
- Test: `src/main/usage/statusline.test.ts`

- [ ] **Step 1: Write the failing test** `src/main/usage/statusline.test.ts`:

```ts
import { spawnSync } from 'node:child_process'
import { mkdtempSync, readdirSync, readFileSync, rmSync, writeFileSync } from 'node:fs'
import { tmpdir } from 'node:os'
import { join } from 'node:path'
import { afterAll, describe, expect, it } from 'vitest'
import { statusLineCommand, statusLineScript } from './statusline'

describe('statusLineCommand', () => {
  it('runs the script with /bin/sh on macOS and Linux, quoted for a POSIX shell', () => {
    expect(statusLineCommand('darwin', '/Users/me/Library/Application Support/Deck/usage'))
      .toBe("/bin/sh '/Users/me/Library/Application Support/Deck/usage/statusline.sh'")
    expect(statusLineCommand('linux', "/home/o'neil/.config/Deck/usage"))
      .toBe("/bin/sh '/home/o'\\''neil/.config/Deck/usage/statusline.sh'")
  })

  it('is inline PowerShell on Windows, with nothing Git Bash or PowerShell would change', () => {
    const command = statusLineCommand('win32', 'C:\\Users\\me\\AppData\\Roaming\\Deck\\usage')!
    const tmp = "('C:/Users/me/AppData/Roaming/Deck/usage/.statusline.' + [Diagnostics.Process]::GetCurrentProcess().Id + '.tmp')"
    expect(command).toBe(
      'powershell -NoProfile -NonInteractive -Command "' +
        `[IO.File]::WriteAllText(${tmp}, [Console]::In.ReadToEnd()); ` +
        `Move-Item -Force -LiteralPath ${tmp} -Destination 'C:/Users/me/AppData/Roaming/Deck/usage/statusline.json'"`,
    )
    expect(command.slice(command.indexOf('"') + 1, -1)).not.toMatch(/[$`"\\]/)
  })

  it("doubles a quote in a Windows path, and gives up on a folder it can't put in a command", () => {
    expect(statusLineCommand('win32', "C:\\Users\\o'neil\\Deck\\usage"))
      .toContain("'C:/Users/o''neil/Deck/usage/statusline.json'")
    expect(statusLineCommand('win32', 'C:\\Users\\$me\\Deck')).toBeNull()
    expect(statusLineCommand('darwin', '/tmp/a\nb')).toBeNull()
  })
})

describe('statusLineScript', () => {
  const root = mkdtempSync(join(tmpdir(), 'deck usage ')) // a space, like Application Support
  afterAll(() => rmSync(root, { recursive: true, force: true }))

  it.skipIf(process.platform === 'win32')('saves its input whole as statusline.json and prints nothing', () => {
    const script = join(root, 'statusline.sh')
    writeFileSync(script, statusLineScript(root)!)
    const input = JSON.stringify({ rate_limits: { seven_day: { used_percentage: 85, resets_at: 1_793_653_200 } } })
    const run = spawnSync('/bin/sh', [script], { input, encoding: 'utf8' })
    expect(run.status).toBe(0)
    expect(run.stdout).toBe('')
    expect(readFileSync(join(root, 'statusline.json'), 'utf8')).toBe(input)
    expect(readdirSync(root).filter((n) => n.endsWith('.tmp'))).toEqual([])
  })
})
```

- [ ] **Step 2: Run it.** `npx vitest run src/main/usage/statusline.test.ts` → FAIL.

- [ ] **Step 3: Implement** `src/main/usage/statusline.ts`:

```ts
import { posix } from 'node:path'
import { quotePath } from '@shared/quote'
import type { Platform } from '@shared/types'

/** Where the status line command saves Claude Code's input, in Deck's usage folder. */
export const REPORT_FILE = 'statusline.json'
/** The script the command runs on macOS and Linux, in the same folder. */
export const SCRIPT_FILE = 'statusline.sh'

/** The status line command Deck puts in Claude Code's settings. It saves Claude Code's input (which
 *  holds the plan usage) to `<dir>/statusline.json` and prints nothing. null when `dir` can't be
 *  put in a command safely. */
export function statusLineCommand(platform: Platform, dir: string): string | null {
  if (platform === 'win32') return windowsCommand(dir)
  const script = quotePath(posix.join(dir, SCRIPT_FILE), platform)
  return script && `/bin/sh ${script}`
}

/** The script statusLineCommand runs on macOS and Linux. It writes a temp file and moves it over the
 *  report, so main never reads half of one. null when `dir` can't be quoted. */
export function statusLineScript(dir: string): string | null {
  const quoted = quotePath(dir, 'darwin')
  if (!quoted) return null
  return [
    '#!/bin/sh',
    "# Claude Code runs this as its status line: Deck's Usage card set it (Connect), and Disconnect",
    '# there takes it out again. It saves what Claude Code passes, which holds the plan usage, and',
    '# prints nothing.',
    `dir=${quoted}`,
    'tmp="$dir/.statusline.$$.tmp"',
    `cat > "$tmp" && mv -f "$tmp" "$dir/${REPORT_FILE}"`,
    '',
  ].join('\n')
}

/** Windows: inline, because the default execution policy (Restricted) won't run a .ps1 and Deck
 *  doesn't pass -ExecutionPolicy Bypass, which security tools flag. Claude Code runs status line
 *  commands through Git Bash when it's installed, else PowerShell, so the script uses nothing
 *  either would change: no $, backtick or backslash, and only single quotes inside its double
 *  quotes. */
function windowsCommand(dir: string): string | null {
  const slashed = dir.replace(/\\/g, '/')
  if (/[$`"]/.test(slashed)) return null
  const target = quotePath(`${slashed}/${REPORT_FILE}`, 'win32')
  const prefix = quotePath(`${slashed}/.statusline.`, 'win32')
  if (!target || !prefix) return null
  const tmp = `(${prefix} + [Diagnostics.Process]::GetCurrentProcess().Id + '.tmp')`
  const script = `[IO.File]::WriteAllText(${tmp}, [Console]::In.ReadToEnd()); Move-Item -Force -LiteralPath ${tmp} -Destination ${target}`
  return `powershell -NoProfile -NonInteractive -Command "${script}"`
}
```

- [ ] **Step 4: Run it.** `npx vitest run src/main/usage/statusline.test.ts` → PASS.

- [ ] **Step 5: Commit.**

```bash
git add src/main/usage/statusline.ts src/main/usage/statusline.test.ts
git -c user.email=franco@effektstudios.com commit -m "Usage: the status line command and script" -m "Claude-Session: https://claude.ai/code/session_012TidnD5ajWnitu5TEgV7qD"
```

---

### Task 6: Claude Code's settings: link, connect, disconnect

**Files:**
- Create: `src/main/usage/settings.ts`
- Test: `src/main/usage/settings.test.ts`

- [ ] **Step 1: Write the failing test** `src/main/usage/settings.test.ts`:

```ts
import { existsSync, lstatSync, mkdirSync, mkdtempSync, readFileSync, rmSync, statSync, symlinkSync, writeFileSync } from 'node:fs'
import { tmpdir } from 'node:os'
import { join } from 'node:path'
import { afterAll, describe, expect, it } from 'vitest'
import { claudeSettingsFile, connect, currentLink, disconnect } from './settings'

const root = mkdtempSync(join(tmpdir(), 'deck-usage-settings-'))
afterAll(() => rmSync(root, { recursive: true, force: true }))

let n = 0
/** A fresh Claude config folder and Deck usage folder; `settings` is written as is when given. */
function setup(settings?: string) {
  const base = join(root, String(++n))
  mkdirSync(join(base, 'claude'), { recursive: true })
  const file = join(base, 'claude', 'settings.json')
  if (settings !== undefined) writeFileSync(file, settings)
  return { file, dir: join(base, 'usage'), command: "/bin/sh '/deck/usage/statusline.sh'" }
}
const read = (file: string) => JSON.parse(readFileSync(file, 'utf8')) as Record<string, unknown>

describe('claudeSettingsFile', () => {
  it('follows CLAUDE_CONFIG_DIR, like the session logs', () => {
    expect(claudeSettingsFile({ CLAUDE_CONFIG_DIR: join('x', 'cfg') })).toBe(join('x', 'cfg', 'settings.json'))
  })
})

describe('connect and disconnect', () => {
  it('adds the status line, keeping every other key in its place, and takes it out again', async () => {
    const o = setup(JSON.stringify({ model: 'opus', permissions: { allow: ['Bash'] }, theme: 'dark' }, null, 2))
    expect(await currentLink(o.file, o.command)).toEqual({ state: 'off' })
    expect(await connect({ ...o, replace: false })).toEqual({ state: 'connected' })
    const connected = read(o.file)
    expect(Object.keys(connected)).toEqual(['model', 'permissions', 'theme', 'statusLine'])
    expect(connected.statusLine).toEqual({ type: 'command', command: o.command })
    expect(readFileSync(o.file, 'utf8')).toMatch(/^\{\n {2}"model"/) // 2-space JSON
    expect(await currentLink(o.file, o.command)).toEqual({ state: 'connected' })
    expect(await disconnect(o)).toEqual({ state: 'off' })
    expect(read(o.file)).toEqual({ model: 'opus', permissions: { allow: ['Bash'] }, theme: 'dark' })
    expect(existsSync(join(o.dir, 'connection.json'))).toBe(false)
  })

  it('creates the settings file when Claude Code has none yet', async () => {
    const o = setup()
    await connect({ ...o, replace: false })
    expect(read(o.file)).toEqual({ statusLine: { type: 'command', command: o.command } })
    await disconnect(o)
    expect(read(o.file)).toEqual({})
  })

  it('replaces another status line only when asked, and puts it back on disconnect', async () => {
    const theirs = { type: 'command', command: '~/.claude/statusline.sh', padding: 0 }
    const o = setup(JSON.stringify({ statusLine: theirs, model: 'opus' }))
    expect(await currentLink(o.file, o.command)).toEqual({ state: 'other', command: '~/.claude/statusline.sh' })
    await expect(connect({ ...o, replace: false })).rejects.toThrow('already has a status line')
    expect(read(o.file).statusLine).toEqual(theirs)
    await connect({ ...o, replace: true })
    expect(read(o.file).statusLine).toEqual({ type: 'command', command: o.command })
    expect(read(join(o.dir, 'settings.backup.json')).statusLine).toEqual(theirs)
    await disconnect(o)
    expect(read(o.file)).toEqual({ statusLine: theirs, model: 'opus' })
  })

  it('leaves a status line set since connecting alone', async () => {
    const o = setup('{}')
    await connect({ ...o, replace: false })
    writeFileSync(o.file, JSON.stringify({ statusLine: { type: 'command', command: 'mine' } }))
    expect(await disconnect(o)).toEqual({ state: 'other', command: 'mine' })
    expect(read(o.file)).toEqual({ statusLine: { type: 'command', command: 'mine' } })
  })

  it('changes nothing when connected already', async () => {
    const o = setup('{"model":"opus"}')
    await connect({ ...o, replace: false })
    const before = readFileSync(o.file, 'utf8')
    expect(await connect({ ...o, replace: false })).toEqual({ state: 'connected' })
    expect(readFileSync(o.file, 'utf8')).toBe(before)
    await disconnect(o)
    expect(read(o.file)).toEqual({ model: 'opus' })
  })

  it("never writes settings it can't parse", async () => {
    for (const text of ['{ "model": "opus", }', '[1, 2]', '"text"']) {
      const o = setup(text)
      expect((await currentLink(o.file, o.command)).state).toBe('error')
      await expect(connect({ ...o, replace: true })).rejects.toThrow('leaves it alone')
      await expect(disconnect(o)).rejects.toThrow('leaves it alone')
      expect(readFileSync(o.file, 'utf8')).toBe(text)
    }
  })

  it.skipIf(process.platform === 'win32')('writes through a symlink and keeps the mode', async () => {
    const o = setup()
    const real = join(root, `dotfiles-${n}.json`)
    writeFileSync(real, '{"model":"opus"}', { mode: 0o600 })
    symlinkSync(real, o.file)
    await connect({ ...o, replace: false })
    expect(lstatSync(o.file).isSymbolicLink()).toBe(true)
    expect(read(real).statusLine).toEqual({ type: 'command', command: o.command })
    expect(statSync(real).mode & 0o777).toBe(0o600)
  })
})
```

- [ ] **Step 2: Run it.** `npx vitest run src/main/usage/settings.test.ts` → FAIL.

- [ ] **Step 3: Implement** `src/main/usage/settings.ts`:

```ts
import { copyFile, mkdir, readFile, realpath, rm, stat } from 'node:fs/promises'
import { dirname, join } from 'node:path'
import type { UsageLink } from '@shared/types'
import { claudeHome } from '../claude/locator'
import { writeFileAtomic } from '../fs/atomic'

type Settings = Record<string, unknown>

/** In Deck's usage folder: the status line Connect replaced, for Disconnect to put back. */
const CONNECTION_FILE = 'connection.json'
/** In Deck's usage folder: Claude Code's settings as they were before the last Connect. */
const BACKUP_FILE = 'settings.backup.json'

export interface LinkOptions {
  /** Claude Code's user settings file. */
  file: string
  /** Deck's status line command (statusLineCommand). */
  command: string
  /** Deck's usage folder. */
  dir: string
}

/** Claude Code's user settings: $CLAUDE_CONFIG_DIR/settings.json, else ~/.claude/settings.json. */
export function claudeSettingsFile(env: NodeJS.ProcessEnv = process.env): string {
  return join(claudeHome(env), 'settings.json')
}

/** The settings as an object. A missing or empty file is {}; anything else that isn't a JSON
 *  object is an error, and Deck never writes a file it couldn't parse. */
export async function readSettings(file: string): Promise<{ settings: Settings } | { error: string }> {
  let text: string
  try {
    text = await readFile(file, 'utf8')
  } catch (err) {
    if ((err as NodeJS.ErrnoException).code === 'ENOENT') return { settings: {} }
    return { error: `Couldn't read ${file}: ${(err as Error).message}` }
  }
  if (text.trim() === '') return { settings: {} }
  let parsed: unknown
  try {
    parsed = JSON.parse(text)
  } catch {
    return { error: `${file} isn't valid JSON, so Deck leaves it alone.` }
  }
  if (!isObject(parsed)) return { error: `${file} doesn't hold a JSON object, so Deck leaves it alone.` }
  return { settings: parsed }
}

/** Where Deck stands with the settings' status line. */
export function linkOf(settings: Settings, command: string): UsageLink {
  const line = settings.statusLine
  if (line === undefined || line === null) return { state: 'off' }
  if (isObject(line) && line.command === command) return { state: 'connected' }
  return { state: 'other', command: isObject(line) && typeof line.command === 'string' ? line.command : JSON.stringify(line) }
}

/** The link as the settings file has it now; an unreadable file is the error state. */
export async function currentLink(file: string, command: string): Promise<UsageLink> {
  const read = await readSettings(file)
  return 'error' in read ? { state: 'error', message: read.error } : linkOf(read.settings, command)
}

/** Makes Deck's command Claude Code's status line, remembering the one it replaces. Throws, with a
 *  message for the card, when the settings can't be read, or another status line is set and
 *  `replace` is false. */
export async function connect(opts: LinkOptions & { replace: boolean }): Promise<UsageLink> {
  const settings = await settingsOrThrow(opts.file)
  const link = linkOf(settings, opts.command)
  if (link.state === 'connected') return link
  if (link.state === 'other' && !opts.replace) throw new Error('Claude Code already has a status line.')
  await mkdir(opts.dir, { recursive: true })
  const record = { command: opts.command, previous: settings.statusLine ?? null }
  await writeFileAtomic(join(opts.dir, CONNECTION_FILE), `${JSON.stringify(record, null, 2)}\n`)
  await copyFile(opts.file, join(opts.dir, BACKUP_FILE)).catch((err: NodeJS.ErrnoException) => {
    if (err.code !== 'ENOENT') throw err // no settings file yet: nothing to back up
  })
  await writeSettings(opts.file, { ...settings, statusLine: { type: 'command', command: opts.command } })
  return { state: 'connected' }
}

/** Puts back the status line Connect replaced (or none) while Deck's is still the one set, and
 *  leaves the settings alone otherwise. Forgets the connection either way. */
export async function disconnect(opts: LinkOptions): Promise<UsageLink> {
  const settings = await settingsOrThrow(opts.file)
  let link = linkOf(settings, opts.command)
  if (link.state === 'connected') {
    const previous = await previousStatusLine(opts.dir, opts.command)
    const { statusLine: _deck, ...rest } = settings
    const next = previous === null ? rest : { ...settings, statusLine: previous }
    await writeSettings(opts.file, next)
    link = linkOf(next, opts.command)
  }
  await rm(join(opts.dir, CONNECTION_FILE), { force: true })
  return link
}

async function settingsOrThrow(file: string): Promise<Settings> {
  const read = await readSettings(file)
  if ('error' in read) throw new Error(read.error)
  return read.settings
}

/** The status line Connect replaced; null when there was none, or the record is missing, unreadable
 *  or another command's (another Deck's). */
async function previousStatusLine(dir: string, command: string): Promise<unknown> {
  try {
    const record = JSON.parse(await readFile(join(dir, CONNECTION_FILE), 'utf8')) as unknown
    if (!isObject(record) || record.command !== command) return null
    const previous = record.previous ?? null
    return isObject(previous) && previous.command === command ? null : previous
  } catch {
    return null
  }
}

/** Written beside the file and renamed over it, so Claude Code never reads half of it. A symlink
 *  (dotfiles kept in a repo) is followed, so it stays a link; the file's mode is kept. */
async function writeSettings(file: string, settings: Settings): Promise<void> {
  const target = await realpath(file).catch(() => file)
  const mode = await stat(target).then((s) => s.mode & 0o777, () => undefined)
  await mkdir(dirname(target), { recursive: true })
  await writeFileAtomic(target, `${JSON.stringify(settings, null, 2)}\n`, mode)
}

const isObject = (v: unknown): v is Record<string, unknown> => typeof v === 'object' && v !== null && !Array.isArray(v)
```

- [ ] **Step 4: Run it.** `npx vitest run src/main/usage/settings.test.ts` → PASS.

- [ ] **Step 5: Commit.**

```bash
git add src/main/usage/settings.ts src/main/usage/settings.test.ts
git -c user.email=franco@effektstudios.com commit -m "Usage: connect to and disconnect from Claude Code's status line" -m "Claude-Session: https://claude.ai/code/session_012TidnD5ajWnitu5TEgV7qD"
```

---

### Task 7: The kept numbers

**Files:**
- Create: `src/main/usage/store.ts`
- Test: `src/main/usage/store.test.ts`

- [ ] **Step 1: Write the failing test** `src/main/usage/store.test.ts`:

```ts
import { mkdtempSync, rmSync, writeFileSync } from 'node:fs'
import { tmpdir } from 'node:os'
import { join } from 'node:path'
import { afterAll, describe, expect, it } from 'vitest'
import { UsageStore } from './store'

const root = mkdtempSync(join(tmpdir(), 'deck-usage-store-'))
afterAll(() => rmSync(root, { recursive: true, force: true }))
let n = 0
const file = () => join(root, `usage-${++n}.json`)
const H = 3_600_000

describe('UsageStore', () => {
  it('keeps what counted, saves it and reads it back after a restart', async () => {
    const f = file()
    const store = new UsageStore(f)
    await store.load()
    expect(store.get()).toEqual({ windows: {}, updatedAt: null })
    expect(store.add({ seven_day: { usedPercentage: 85, resetsAt: 100 * H } }, 1000)).toBe(true)
    expect(store.add({
      five_hour: { usedPercentage: 34, resetsAt: 20 * H },
      seven_day: { usedPercentage: 86, resetsAt: 100 * H },
    }, 2000)).toBe(true)
    await store.flush()
    const again = new UsageStore(f)
    await again.load()
    expect(again.get()).toEqual({
      windows: { five_hour: { usedPercentage: 34, resetsAt: 20 * H }, seven_day: { usedPercentage: 86, resetsAt: 100 * H } },
      updatedAt: 2000,
    })
  })

  it("ignores a report that doesn't count, and doesn't call it an update", async () => {
    const store = new UsageStore(file())
    store.add({ seven_day: { usedPercentage: 85, resetsAt: 100 * H } }, 5000)
    expect(store.add({ seven_day: { usedPercentage: 80, resetsAt: 100 * H } }, 6000)).toBe(false) // older data
    expect(store.add({}, 7000)).toBe(false)
    expect(store.get().updatedAt).toBe(5000)
    expect(store.get().windows.seven_day?.usedPercentage).toBe(85)
    await store.flush()
  })

  it('starts empty from a broken file', async () => {
    const f = file()
    writeFileSync(f, '{ not json')
    const store = new UsageStore(f)
    await store.load()
    expect(store.get()).toEqual({ windows: {}, updatedAt: null })
    writeFileSync(f, JSON.stringify({ windows: { seven_day: { usedPercentage: 'x', resetsAt: 1 } }, updatedAt: 'y' }))
    await store.load()
    expect(store.get()).toEqual({ windows: {}, updatedAt: null })
  })
})
```

- [ ] **Step 2: Run it.** `npx vitest run src/main/usage/store.test.ts` → FAIL.

- [ ] **Step 3: Implement** `src/main/usage/store.ts`:

```ts
import { readFile } from 'node:fs/promises'
import type { UsageWindow } from '@shared/types'
import { writeFileAtomic } from '../fs/atomic'
import { mergeWindow } from './merge'
import { type UsageReport, WINDOWS, type WindowKey } from './report'

export interface Readings {
  windows: Partial<Record<WindowKey, UsageWindow>>
  /** When the newest report that counted was written (ms since the epoch); null before any. */
  updatedAt: number | null
}

/** The numbers Claude Code last reported, kept in usage.json so a restart shows them. */
export class UsageStore {
  private readonly file: string
  private readings: Readings = { windows: {}, updatedAt: null }
  private saving: Promise<void> = Promise.resolve()

  constructor(file: string) {
    this.file = file
  }

  /** Reads usage.json; a missing or broken file leaves the store empty. */
  async load(): Promise<void> {
    try {
      this.readings = sanitize(JSON.parse(await readFile(this.file, 'utf8')))
    } catch {
      this.readings = { windows: {}, updatedAt: null }
    }
  }

  get(): Readings {
    return this.readings
  }

  /** Merges a report written at `at` by mergeWindow's rules. True when it counted (a window was
   *  taken from it); the store is then saved in the background. */
  add(report: UsageReport, at: number): boolean {
    const windows = { ...this.readings.windows }
    let counted = false
    for (const key of WINDOWS) {
      const next = report[key]
      if (!next || mergeWindow(windows[key] ?? null, next) !== next) continue
      windows[key] = next
      counted = true
    }
    if (!counted) return false
    this.readings = { windows, updatedAt: Math.max(at, this.readings.updatedAt ?? 0) }
    const text = `${JSON.stringify(this.readings, null, 2)}\n`
    this.saving = this.saving
      .then(() => writeFileAtomic(this.file, text))
      .catch((err: unknown) => console.error('usage: saving usage.json failed', err))
    return true
  }

  /** Resolves once every save so far has finished. */
  flush(): Promise<void> {
    return this.saving
  }
}

/** Only windows with finite numbers survive; anything else reads as nothing kept. */
function sanitize(data: unknown): Readings {
  const readings: Readings = { windows: {}, updatedAt: null }
  if (typeof data !== 'object' || data === null) return readings
  const { windows, updatedAt } = data as { windows?: unknown; updatedAt?: unknown }
  if (typeof updatedAt === 'number' && Number.isFinite(updatedAt)) readings.updatedAt = updatedAt
  if (typeof windows !== 'object' || windows === null) return readings
  for (const key of WINDOWS) {
    const w = (windows as Record<string, unknown>)[key]
    if (typeof w !== 'object' || w === null) continue
    const { usedPercentage, resetsAt } = w as { usedPercentage?: unknown; resetsAt?: unknown }
    if (typeof usedPercentage !== 'number' || !Number.isFinite(usedPercentage)) continue
    if (typeof resetsAt !== 'number' || !Number.isFinite(resetsAt)) continue
    readings.windows[key] = { usedPercentage, resetsAt }
  }
  return readings
}
```

- [ ] **Step 4: Run it.** `npx vitest run src/main/usage/store.test.ts` → PASS.

- [ ] **Step 5: Commit.**

```bash
git add src/main/usage/store.ts src/main/usage/store.test.ts
git -c user.email=franco@effektstudios.com commit -m "Usage: keep the last numbers in usage.json" -m "Claude-Session: https://claude.ai/code/session_012TidnD5ajWnitu5TEgV7qD"
```

---

### Task 8: Reading and watching report files

**Files:**
- Create: `src/main/usage/watch.ts`
- Test: `src/main/usage/watch.test.ts`

- [ ] **Step 1: Write the failing test** `src/main/usage/watch.test.ts`:

```ts
import { existsSync, mkdirSync, mkdtempSync, renameSync, rmSync, utimesSync, writeFileSync } from 'node:fs'
import { tmpdir } from 'node:os'
import { join } from 'node:path'
import { afterAll, describe, expect, it, vi } from 'vitest'
import { readReportFile, removeLeftovers, watchReports } from './watch'

const root = mkdtempSync(join(tmpdir(), 'deck-usage-watch-'))
afterAll(() => rmSync(root, { recursive: true, force: true }))
let n = 0
const dir = () => {
  const d = join(root, String(++n))
  mkdirSync(d)
  return d
}
const report = JSON.stringify({ rate_limits: { seven_day: { used_percentage: 85, resets_at: 1_793_653_200 } } })

describe('readReportFile', () => {
  it("reads the report, dated by the file's modification time", async () => {
    const f = join(dir(), 'statusline.json')
    writeFileSync(f, report)
    utimesSync(f, 1_700_000_000, 1_700_000_000)
    expect(await readReportFile(f)).toEqual({
      report: { seven_day: { usedPercentage: 85, resetsAt: 1_793_653_200_000 } },
      at: 1_700_000_000_000,
    })
  })

  it('gives null for a missing file, half a file and an oversized one', async () => {
    const f = join(dir(), 'statusline.json')
    expect(await readReportFile(f)).toBeNull()
    writeFileSync(f, report.slice(0, 20))
    expect(await readReportFile(f)).toBeNull()
    writeFileSync(f, ' '.repeat(1024 * 1024 + 1))
    expect(await readReportFile(f)).toBeNull()
  })
})

describe('watchReports', () => {
  it('calls back once a report is moved into place', async () => {
    const d = dir()
    const changed = vi.fn()
    const stop = watchReports(d, changed, 20)
    try {
      writeFileSync(join(d, '.statusline.1.tmp'), report)
      renameSync(join(d, '.statusline.1.tmp'), join(d, 'statusline.json'))
      await vi.waitFor(() => expect(changed).toHaveBeenCalled(), { timeout: 3000 })
    } finally {
      stop()
    }
  })
})

describe('removeLeftovers', () => {
  it('removes temp files older than a minute, and nothing else', async () => {
    const d = dir()
    for (const name of ['.statusline.1.tmp', '.statusline.2.tmp', 'statusline.json']) writeFileSync(join(d, name), 'x')
    const old = Date.now() / 1000 - 120
    utimesSync(join(d, '.statusline.1.tmp'), old, old)
    utimesSync(join(d, 'statusline.json'), old, old)
    await removeLeftovers(d)
    expect(existsSync(join(d, '.statusline.1.tmp'))).toBe(false)
    expect(existsSync(join(d, '.statusline.2.tmp'))).toBe(true)
    expect(existsSync(join(d, 'statusline.json'))).toBe(true)
  })
})
```

- [ ] **Step 2: Run it.** `npx vitest run src/main/usage/watch.test.ts` → FAIL.

- [ ] **Step 3: Implement** `src/main/usage/watch.ts`:

```ts
import { type FSWatcher, watch } from 'node:fs'
import { readdir, readFile, rm, stat } from 'node:fs/promises'
import { join } from 'node:path'
import { readReport, type UsageReport } from './report'
import { REPORT_FILE } from './statusline'

/** Far more than a status line input (a few kB); a bigger file isn't one. */
const MAX_BYTES = 1024 * 1024
/** Temp files of status line runs (statusline.ts); one a minute old was cancelled mid-write. */
const LEFTOVER = /^\.statusline\..+\.tmp$/

/** The report in `file`, dated by its modification time. null when the file is missing, too big
 *  or not JSON (on Windows, a write still under way: the next change reads it again). */
export async function readReportFile(file: string): Promise<{ report: UsageReport; at: number } | null> {
  try {
    const info = await stat(file)
    if (!info.isFile() || info.size > MAX_BYTES) return null
    return { report: readReport(JSON.parse(await readFile(file, 'utf8'))), at: info.mtimeMs }
  } catch {
    return null
  }
}

/** Calls `onChange`, debounced, when a status line run writes `<dir>/statusline.json`. The folder
 *  is watched, not the file: each run replaces the file by a rename. Returns a stop function. */
export function watchReports(dir: string, onChange: () => void, debounceMs = 100): () => void {
  let timer: NodeJS.Timeout | null = null
  let watcher: FSWatcher | null = null
  try {
    watcher = watch(dir, (_event, name) => {
      if (name !== null && name !== REPORT_FILE) return
      if (timer) clearTimeout(timer)
      timer = setTimeout(() => {
        timer = null
        onChange()
      }, debounceMs)
    })
    watcher.on('error', (err) => console.error('usage: watching the reports failed', err))
  } catch (err) {
    console.error('usage: watching the reports failed', err)
  }
  return () => {
    if (timer) clearTimeout(timer)
    watcher?.close()
  }
}

/** Removes temp files of status line runs that were cancelled mid-write (a minute old or more). */
export async function removeLeftovers(dir: string, now = Date.now()): Promise<void> {
  const names = await readdir(dir).catch(() => [] as string[])
  await Promise.all(names.filter((name) => LEFTOVER.test(name)).map(async (name) => {
    const file = join(dir, name)
    const info = await stat(file).catch(() => null)
    if (info && now - info.mtimeMs >= 60_000) await rm(file, { force: true }).catch(() => {})
  }))
}
```

- [ ] **Step 4: Run it.** `npx vitest run src/main/usage/watch.test.ts` → PASS.

- [ ] **Step 5: Commit.**

```bash
git add src/main/usage/watch.ts src/main/usage/watch.test.ts
git -c user.email=franco@effektstudios.com commit -m "Usage: read and watch Claude Code's reports" -m "Claude-Session: https://claude.ai/code/session_012TidnD5ajWnitu5TEgV7qD"
```

---

### Task 9: The usage IPC in main

**Files:**
- Create: `src/main/usage/ipc.ts`
- Modify: `src/main/index.ts`
- Test: `src/main/usage/ipc.test.ts`

- [ ] **Step 1: Write the failing test** `src/main/usage/ipc.test.ts`:

```ts
import { EventEmitter } from 'node:events'
import { mkdirSync, mkdtempSync, readFileSync, renameSync, rmSync, writeFileSync } from 'node:fs'
import { tmpdir } from 'node:os'
import { join } from 'node:path'
import { afterAll, describe, expect, it, vi } from 'vitest'
import { IPC } from '@shared/channels'
import type { UsageChange, UsageState } from '@shared/types'
import type { BrowserWindow } from 'electron'
import { registerUsageIpc } from './ipc'
import { statusLineCommand } from './statusline'

const ipc = vi.hoisted(() => ({ handlers: new Map<string, (...args: unknown[]) => unknown>() }))
vi.mock('electron', () => ({
  ipcMain: {
    handle: (channel: string, fn: (...args: unknown[]) => unknown) => ipc.handlers.set(channel, fn),
  },
}))

const root = mkdtempSync(join(tmpdir(), 'deck-usage-ipc-'))
afterAll(() => rmSync(root, { recursive: true, force: true }))
let n = 0

/** Deck's usage folder and a Claude settings file holding `settings`. */
function setup(settings: string) {
  const base = join(root, String(++n))
  mkdirSync(join(base, 'claude'), { recursive: true })
  const settingsFile = join(base, 'claude', 'settings.json')
  writeFileSync(settingsFile, settings)
  return { dir: join(base, 'usage'), settingsFile }
}

/** A window that records the states it's sent. */
function fakeWindow() {
  const sent: UsageState[] = []
  const win = Object.assign(new EventEmitter(), {
    isDestroyed: () => false,
    webContents: { isDestroyed: () => false, send: (_channel: string, state: UsageState) => sent.push(state) },
  })
  return { win: win as unknown as BrowserWindow, sent }
}

const call = <T>(channel: string, ...args: unknown[]) => ipc.handlers.get(channel)!({}, ...args) as Promise<T>

describe('registerUsageIpc', () => {
  it('connects, picks up a report Claude Code writes, and disconnects', async () => {
    const { dir, settingsFile } = setup('{"model":"opus"}')
    const usage = registerUsageIpc({ dir, settingsFile, platform: 'darwin' })
    const { win, sent } = fakeWindow()
    usage.attach(win)
    try {
      expect(await call<UsageState>(IPC.usageGet)).toEqual({
        link: { state: 'off' }, settingsFile, fiveHour: null, sevenDay: null, updatedAt: null,
      })

      expect(await call<UsageChange>(IPC.usageConnect, false)).toMatchObject({ state: { link: { state: 'connected' } } })
      expect(JSON.parse(readFileSync(settingsFile, 'utf8')).statusLine)
        .toEqual({ type: 'command', command: statusLineCommand('darwin', dir) })

      // What the status line script does with each report:
      writeFileSync(join(dir, '.statusline.1.tmp'), JSON.stringify({ rate_limits: { seven_day: { used_percentage: 85, resets_at: 1_793_653_200 } } }))
      renameSync(join(dir, '.statusline.1.tmp'), join(dir, 'statusline.json'))
      await vi.waitFor(() => expect(sent.at(-1)?.sevenDay).toEqual({ usedPercentage: 85, resetsAt: 1_793_653_200_000 }), { timeout: 3000 })

      expect(await call<UsageChange>(IPC.usageDisconnect)).toMatchObject({ state: { link: { state: 'off' }, sevenDay: { usedPercentage: 85 } } })
      expect(JSON.parse(readFileSync(settingsFile, 'utf8'))).toEqual({ model: 'opus' })
    } finally {
      usage.dispose()
    }
  })

  it("shows settings it can't read as an error, and Connect fails without writing", async () => {
    const { dir, settingsFile } = setup('{ broken')
    const usage = registerUsageIpc({ dir, settingsFile, platform: 'darwin' })
    usage.attach(fakeWindow().win)
    try {
      expect((await call<UsageState>(IPC.usageGet)).link.state).toBe('error')
      expect(await call<UsageChange>(IPC.usageConnect, true)).toEqual({ error: expect.stringContaining('leaves it alone') })
      expect(readFileSync(settingsFile, 'utf8')).toBe('{ broken')
    } finally {
      usage.dispose()
    }
  })
})
```

- [ ] **Step 2: Run it.** `npx vitest run src/main/usage/ipc.test.ts` → FAIL (no `./ipc`).

- [ ] **Step 3: Implement** `src/main/usage/ipc.ts`:

```ts
import { mkdir, writeFile } from 'node:fs/promises'
import { join } from 'node:path'
import { type BrowserWindow, ipcMain } from 'electron'
import { IPC } from '@shared/channels'
import type { Platform, UsageChange, UsageLink, UsageState } from '@shared/types'
import { connect, currentLink, disconnect } from './settings'
import { REPORT_FILE, SCRIPT_FILE, statusLineCommand, statusLineScript } from './statusline'
import { UsageStore } from './store'
import { readReportFile, removeLeftovers, watchReports } from './watch'

export interface UsageIpcOptions {
  /** Deck's usage folder (userData/usage): the script, Claude Code's reports and usage.json. */
  dir: string
  /** Claude Code's user settings file (claudeSettingsFile). */
  settingsFile: string
  platform: Platform
}

export interface UsageIpc {
  /** Pushes go to this window; when it comes to the front, the link and the report are read again. */
  attach(win: BrowserWindow): void
  /** At quit: stop watching. */
  dispose(): void
}

/** Claude's plan usage for the usage card. Connect makes Deck Claude Code's status line, whose runs
 *  then write each report into `dir`; main reads them and keeps the numbers. */
export function registerUsageIpc({ dir, settingsFile, platform }: UsageIpcOptions): UsageIpc {
  const command = statusLineCommand(platform, dir)
  const unusable = `Deck's folder can't be used in a status line command: ${dir}`
  const store = new UsageStore(join(dir, 'usage.json'))
  let link: UsageLink = { state: 'off' }
  let win: BrowserWindow | null = null
  let stopWatching = () => {}
  /** Connect and Disconnect each read, then write, Claude Code's settings: one at a time. */
  let changing: Promise<unknown> = Promise.resolve()

  const state = (): UsageState => {
    const { windows, updatedAt } = store.get()
    return { link, settingsFile, fiveHour: windows.five_hour ?? null, sevenDay: windows.seven_day ?? null, updatedAt }
  }
  const push = () => {
    if (win && !win.isDestroyed() && !win.webContents.isDestroyed()) win.webContents.send(IPC.usageChanged, state())
  }
  const setLink = (next: UsageLink) => {
    if (JSON.stringify(next) === JSON.stringify(link)) return
    link = next
    push()
  }
  const checkLink = async () => {
    setLink(command ? await currentLink(settingsFile, command) : { state: 'error', message: unusable })
  }
  const takeReport = async () => {
    const read = await readReportFile(join(dir, REPORT_FILE))
    if (read && store.add(read.report, read.at)) push()
  }

  const ready = (async () => {
    await mkdir(dir, { recursive: true })
    // Written at every start, so a newer script reaches a Deck that is connected already.
    const script = statusLineScript(dir)
    if (platform !== 'win32' && script) await writeFile(join(dir, SCRIPT_FILE), script, 'utf8')
    await removeLeftovers(dir)
    await store.load()
    await takeReport()
    await checkLink()
    stopWatching = watchReports(dir, () => void takeReport())
  })().catch((err: unknown) => console.error('usage: starting failed', err))

  const change = (run: (command: string) => Promise<UsageLink>): Promise<UsageChange> => {
    const result = changing.then(async (): Promise<UsageChange> => {
      await ready
      try {
        if (!command) throw new Error(unusable)
        setLink(await run(command))
        return { state: state() }
      } catch (err) {
        await checkLink() // whatever got written, the card shows what the settings say now
        return { error: err instanceof Error ? err.message : String(err) }
      }
    })
    changing = result
    return result
  }

  ipcMain.handle(IPC.usageGet, async () => {
    await ready
    return state()
  })
  ipcMain.handle(IPC.usageConnect, (_e, replace: unknown) =>
    change((cmd) => connect({ file: settingsFile, command: cmd, dir, replace: replace === true })))
  ipcMain.handle(IPC.usageDisconnect, () => change((cmd) => disconnect({ file: settingsFile, command: cmd, dir })))

  return {
    attach(w) {
      if (win) throw new Error('registerUsageIpc: attach() runs once')
      win = w
      // Claude Code's settings may have changed while Deck was in the background, and a report the
      // watch missed is read again.
      w.on('focus', () => {
        void ready.then(() => Promise.all([checkLink(), takeReport()]))
      })
    },
    dispose() {
      stopWatching()
    },
  }
}
```

- [ ] **Step 4: Wire it into main.** In `src/main/index.ts`:
  - add the imports `import { registerUsageIpc } from './usage/ipc'` and
    `import { claudeSettingsFile } from './usage/settings'` (keep the imports sorted by path as
    they are now: after `./shell/launch`, before `./window`);
  - after the `const clip = registerClipboardIpc({ … })` statement, add:

```ts
  const usage = registerUsageIpc({
    dir: join(userData, 'usage'),
    settingsFile: claudeSettingsFile(),
    platform: process.platform as Platform,
  })
```

  - after `clip.attach(win)`, add `usage.attach(win)`;
  - replace `app.on('will-quit', () => clip.dispose())` with:

```ts
  app.on('will-quit', () => {
    clip.dispose()
    usage.dispose()
  })
```

- [ ] **Step 5: Run the tests and typecheck.** `npx vitest run src/main/usage` → PASS;
  `npm run typecheck` → no errors.

- [ ] **Step 6: Commit.**

```bash
git add src/main/usage/ipc.ts src/main/usage/ipc.test.ts src/main/index.ts
git -c user.email=franco@effektstudios.com commit -m "Usage: main side, from Claude Code's reports to the renderer" -m "Claude-Session: https://claude.ai/code/session_012TidnD5ajWnitu5TEgV7qD"
```

---

### Task 10: Share the panel's hooks and caret

**Files:**
- Create: `src/renderer/src/hooks.ts`
- Modify: `src/renderer/src/claude/ClaudePanel.tsx` (remove `useStoredFlag`, `useTick`, `Caret`; import them)
- Modify: `src/renderer/src/icons.tsx` (add `Caret`)

- [ ] **Step 1: Create** `src/renderer/src/hooks.ts`, moving the two hooks verbatim from the end
  of `ClaudePanel.tsx`:

```ts
import { useCallback, useEffect, useState } from 'react'

/** A remembered on/off setting (localStorage; per window when that's unavailable). */
export function useStoredFlag(key: string, fallback: boolean): [boolean, () => void] {
  const [value, setValue] = useState(() => {
    try {
      const stored = localStorage.getItem(key)
      return stored === null ? fallback : stored === '1'
    } catch {
      return fallback
    }
  })
  useEffect(() => {
    try {
      localStorage.setItem(key, value ? '1' : '0')
    } catch {
      // Storage unavailable: it lasts until the window closes.
    }
  }, [key, value])
  return [value, useCallback(() => setValue((v) => !v), [])]
}

/** Re-renders every `ms`. */
export function useTick(ms: number): void {
  const [, setTick] = useState(0)
  useEffect(() => {
    const timer = setInterval(() => setTick((t) => t + 1), ms)
    return () => clearInterval(timer)
  }, [ms])
}
```

- [ ] **Step 2: Move the caret.** Add to the end of `src/renderer/src/icons.tsx`:

```tsx
/** A section's fold marker (panel.css: .cp-caret turns it while folded). */
export const Caret = () => (
  <svg className="cp-caret" width="9" height="9" viewBox="0 0 16 16" fill="currentColor" aria-hidden="true">
    <path d="M3.5 5.5h9L8 11z" />
  </svg>
)
```

- [ ] **Step 3: Use them in the panel.** In `src/renderer/src/claude/ClaudePanel.tsx`, delete the
  `useStoredFlag` and `useTick` functions (with their doc comments) and the `const Caret = …`
  block, and add these imports after `import { baseName, displayPath } from '../git/format'`:

```ts
import { useStoredFlag, useTick } from '../hooks'
import { Caret } from '../icons'
```

- [ ] **Step 4: Typecheck and test.** `npm run typecheck && npx vitest run src/renderer` → no
  errors, PASS.

- [ ] **Step 5: Commit.**

```bash
git add src/renderer/src/hooks.ts src/renderer/src/icons.tsx src/renderer/src/claude/ClaudePanel.tsx
git -c user.email=franco@effektstudios.com commit -m "Renderer: share the panel's stored flag, tick and caret" -m "Claude-Session: https://claude.ai/code/session_012TidnD5ajWnitu5TEgV7qD"
```

---

### Task 11: The card's view model

**Files:**
- Create: `src/renderer/src/usage/view.ts`
- Test: `src/renderer/src/usage/view.test.ts`

- [ ] **Step 1: Write the failing test** `src/renderer/src/usage/view.test.ts`:

```ts
import { describe, expect, it } from 'vitest'
import type { UsageWindow } from '@shared/types'
import { type Formats, resetText, toneOf, updatedText, usageView } from './view'

const MIN = 60_000
const H = 60 * MIN
const DAY = 24 * H
/** UTC, 24-hour, English day names: the tests don't depend on the machine's zone or locale. */
const utc: Formats = {
  clock: (ms) => new Date(ms).toISOString().slice(11, 16),
  weekday: (ms) => ['Sun', 'Mon', 'Tue', 'Wed', 'Thu', 'Fri', 'Sat'][new Date(ms).getUTCDay()],
  dayNumber: (ms) => Math.floor(ms / DAY),
}
/** Monday 2 November 2026, 11:44 UTC. */
const now = Date.UTC(2026, 10, 2, 11, 44)
const win = (usedPercentage: number, resetsAt: number): UsageWindow => ({ usedPercentage, resetsAt })

describe('toneOf', () => {
  it('turns amber from 75% and red from 90%', () => {
    expect([0, 74, 75, 89, 90, 100].map(toneOf)).toEqual(['ok', 'ok', 'high', 'high', 'max', 'max'])
  })
})

describe('resetText', () => {
  it('counts down within 5 hours', () => {
    expect(resetText(now + 2 * H + 10 * MIN, now, utc)).toBe('resets in 2 h 10 m')
    expect(resetText(now + 3 * H, now, utc)).toBe('resets in 3 h')
    expect(resetText(now + 25 * MIN, now, utc)).toBe('resets in 25 m')
    expect(resetText(now + 30_000, now, utc)).toBe('resets in 1 m')
  })
  it('names the time later today, tomorrow or on a weekday', () => {
    expect(resetText(Date.UTC(2026, 10, 2, 23, 0), now, utc)).toBe('resets 23:00')
    expect(resetText(Date.UTC(2026, 10, 3, 9, 0), now, utc)).toBe('resets tomorrow 09:00')
    expect(resetText(Date.UTC(2026, 10, 5, 9, 0), now, utc)).toBe('resets Thu 09:00')
  })
  it('says when a past window reset', () => {
    expect(resetText(Date.UTC(2026, 10, 2, 9, 0), now, utc)).toBe('reset at 09:00')
    expect(resetText(Date.UTC(2026, 10, 1, 23, 0), now, utc)).toBe('reset Sun 23:00')
  })
})

describe('updatedText', () => {
  it('says how long ago Claude Code reported', () => {
    expect(updatedText(null, now, utc)).toBe('')
    expect(updatedText(now - 30_000, now, utc)).toBe('updated just now')
    expect(updatedText(now + 5000, now, utc)).toBe('updated just now') // clocks disagree
    expect(updatedText(now - 2 * MIN, now, utc)).toBe('updated 2 min ago')
    expect(updatedText(now - 3 * H, now, utc)).toBe('updated 3 h ago')
    expect(updatedText(now - 2 * DAY, now, utc)).toBe('updated Sat 11:44')
  })
})

describe('usageView', () => {
  const week = win(85, Date.UTC(2026, 10, 2, 23, 0))
  const fiveHour = win(34.4, now + 2 * H + 10 * MIN)

  it('draws the week outside and the 5-hour window inside, the fuller one in the middle', () => {
    const v = usageView({ sevenDay: week, fiveHour, updatedAt: now - 2 * MIN }, now, utc)
    expect(v.rings.map((r) => [r.key, r.label, r.percent, r.tone, r.reset])).toEqual([
      ['week', 'Week', 85, 'high', 'resets 23:00'],
      ['5h', '5-hour', 34, 'ok', 'resets in 2 h 10 m'],
    ])
    expect(v.top?.key).toBe('week')
    expect(v.summary).toBe('week 85% · 5h 34%')
    expect(v.label).toBe('Week 85% used, 5-hour 34% used')
    expect(v.updated).toBe('updated 2 min ago')
    expect(usageView({ sevenDay: week, fiveHour: win(95, fiveHour.resetsAt), updatedAt: now }, now, utc).top?.key).toBe('5h')
  })

  it('leaves out a window Claude Code did not report', () => {
    const v = usageView({ sevenDay: week, fiveHour: null, updatedAt: now }, now, utc)
    expect(v.rings.map((r) => r.key)).toEqual(['week'])
    expect(v.summary).toBe('week 85%')
  })

  it('shows a window whose reset has passed as 0% until the next report', () => {
    const v = usageView({ sevenDay: null, fiveHour: win(97, now - 10 * MIN), updatedAt: now - 3 * H }, now, utc)
    expect(v.rings[0]).toMatchObject({ percent: 0, tone: 'ok', past: true, reset: 'reset at 11:34' })
  })

  it('has nothing to draw before the first report', () => {
    expect(usageView({ sevenDay: null, fiveHour: null, updatedAt: null }, now, utc))
      .toMatchObject({ rings: [], top: null, summary: '', updated: '', label: '' })
  })

  it('keeps percentages within 0–100', () => {
    expect(usageView({ sevenDay: win(130, week.resetsAt), fiveHour: null, updatedAt: now }, now, utc).rings[0].percent).toBe(100)
  })
})
```

- [ ] **Step 2: Run it.** `npx vitest run src/renderer/src/usage` → FAIL.

- [ ] **Step 3: Implement** `src/renderer/src/usage/view.ts`:

```ts
import type { UsageState, UsageWindow } from '@shared/types'

/** From these percentages up, a window shows amber, then red. */
export const HIGH = 75
export const MAX = 90
const MIN = 60_000
const HOUR = 60 * MIN
const DAY = 24 * HOUR

export type Tone = 'ok' | 'high' | 'max'

export interface Ring {
  key: 'week' | '5h'
  /** 'Week', '5-hour'. */
  label: string
  /** 0–100 as drawn: 0 once the window has reset. */
  percent: number
  tone: Tone
  /** 'resets 23:00', 'resets in 2 h 10 m'; 'reset at 23:00' once past. */
  reset: string
  past: boolean
}

export interface UsageView {
  /** Outer first: the week, then the 5-hour window; only what Claude Code reported. */
  rings: Ring[]
  /** The fullest ring, for the donut's middle; null with none. */
  top: Ring | null
  /** 'week 85% · 5h 34%'. */
  summary: string
  /** 'updated 2 min ago'; '' before the first report. */
  updated: string
  /** The donut's accessible label: 'Week 85% used, 5-hour 34% used'. */
  label: string
}

/** Time formatting, passed in so tests don't depend on the machine's locale and time zone. */
export interface Formats {
  /** A time of day: '23:00', or '11:00 PM' where clocks have 12 hours. */
  clock(ms: number): string
  /** A short weekday: 'Thu'. */
  weekday(ms: number): string
  /** The local calendar day, as a number that goes up by one each day. */
  dayNumber(ms: number): number
}

export const localFormats: Formats = {
  clock: (ms) => new Date(ms).toLocaleTimeString([], { hour: '2-digit', minute: '2-digit' }),
  weekday: (ms) => new Date(ms).toLocaleDateString([], { weekday: 'short' }),
  dayNumber: (ms) => {
    const d = new Date(ms)
    return Math.round(Date.UTC(d.getFullYear(), d.getMonth(), d.getDate()) / DAY)
  },
}

export function toneOf(percent: number): Tone {
  return percent >= MAX ? 'max' : percent >= HIGH ? 'high' : 'ok'
}

/** When a window resets: counted down within 5 hours, else the time today, tomorrow or on a weekday. */
export function resetText(at: number, now: number, f: Formats): string {
  if (at <= now) return f.dayNumber(at) === f.dayNumber(now) ? `reset at ${f.clock(at)}` : `reset ${f.weekday(at)} ${f.clock(at)}`
  if (at - now < 5 * HOUR) return `resets in ${duration(at - now)}`
  const days = f.dayNumber(at) - f.dayNumber(now)
  if (days === 0) return `resets ${f.clock(at)}`
  if (days === 1) return `resets tomorrow ${f.clock(at)}`
  return `resets ${f.weekday(at)} ${f.clock(at)}`
}

/** How long ago Claude Code last reported. */
export function updatedText(at: number | null, now: number, f: Formats): string {
  if (at === null) return ''
  const ago = Math.max(0, now - at)
  if (ago < MIN) return 'updated just now'
  if (ago < HOUR) return `updated ${Math.floor(ago / MIN)} min ago`
  if (ago < DAY) return `updated ${Math.floor(ago / HOUR)} h ago`
  return `updated ${f.weekday(at)} ${f.clock(at)}`
}

/** What the usage card draws for `state` at `now`. */
export function usageView(
  state: Pick<UsageState, 'fiveHour' | 'sevenDay' | 'updatedAt'>,
  now: number,
  f: Formats = localFormats,
): UsageView {
  const rings: Ring[] = []
  if (state.sevenDay) rings.push(ring('week', 'Week', state.sevenDay, now, f))
  if (state.fiveHour) rings.push(ring('5h', '5-hour', state.fiveHour, now, f))
  const top = rings.reduce<Ring | null>((best, r) => (best === null || r.percent > best.percent ? r : best), null)
  return {
    rings,
    top,
    summary: rings.map((r) => `${r.key} ${r.percent}%`).join(' · '),
    updated: updatedText(state.updatedAt, now, f),
    label: rings.map((r) => `${r.label} ${r.percent}% used`).join(', '),
  }
}

function ring(key: Ring['key'], label: string, w: UsageWindow, now: number, f: Formats): Ring {
  const past = w.resetsAt <= now
  const percent = past ? 0 : Math.round(Math.min(Math.max(w.usedPercentage, 0), 100))
  return { key, label, percent, tone: toneOf(percent), reset: resetText(w.resetsAt, now, f), past }
}

/** '2 h 10 m', '3 h', '25 m'; part of a minute counts as one. */
function duration(ms: number): string {
  const minutes = Math.ceil(ms / MIN)
  if (minutes < 60) return `${minutes} m`
  const h = Math.floor(minutes / 60)
  const m = minutes % 60
  return m ? `${h} h ${m} m` : `${h} h`
}
```

- [ ] **Step 4: Run it.** `npx vitest run src/renderer/src/usage` → PASS.

- [ ] **Step 5: Commit.**

```bash
git add src/renderer/src/usage/view.ts src/renderer/src/usage/view.test.ts
git -c user.email=franco@effektstudios.com commit -m "Usage card: what it draws, as a tested view model" -m "Claude-Session: https://claude.ai/code/session_012TidnD5ajWnitu5TEgV7qD"
```

---

### Task 12: The card

**Files:**
- Create: `src/renderer/src/usage/Donut.tsx`, `UsageCard.tsx`, `useUsage.ts`, `usage.css`
- Modify: `src/renderer/src/App.tsx`

- [ ] **Step 1: The donut** `src/renderer/src/usage/Donut.tsx`:

```tsx
import type { Ring } from './view'

const SIZE = 64
const STROKE = 6
const GAP = 2
const MID = SIZE / 2

/** A ring per window on a dim track, the first outermost, and the fullest window's percentage and
 *  name in the middle. */
export function Donut({ rings, top, label }: { rings: Ring[]; top: Ring | null; label: string }) {
  return (
    <svg className="usage-donut" width={SIZE} height={SIZE} viewBox={`0 0 ${SIZE} ${SIZE}`} role="img" aria-label={label}>
      {rings.map((ring, i) => {
        const r = MID - STROKE / 2 - i * (STROKE + GAP)
        const length = 2 * Math.PI * r
        return (
          <g key={ring.key} className={`ring-${ring.key}`}>
            <circle className="usage-track" cx={MID} cy={MID} r={r} fill="none" strokeWidth={STROKE} />
            {ring.percent > 0 && (
              <circle className="usage-arc" cx={MID} cy={MID} r={r} fill="none" strokeWidth={STROKE}
                strokeDasharray={`${(length * ring.percent) / 100} ${length}`} transform={`rotate(-90 ${MID} ${MID})`} />
            )}
          </g>
        )
      })}
      {top && (
        <>
          <text className={`usage-mid tone-${top.tone}`} x={MID} y={MID - 1} textAnchor="middle">{top.percent}%</text>
          <text className="usage-mid-name" x={MID} y={MID + 10} textAnchor="middle">{top.key}</text>
        </>
      )}
    </svg>
  )
}
```

- [ ] **Step 2: The hook** `src/renderer/src/usage/useUsage.ts`:

```ts
import { useEffect, useState } from 'react'
import type { UsageState } from '@shared/types'

/** Claude's plan usage and Deck's link to Claude Code's status line; one for the whole window. */
export function useUsage(): UsageState | null {
  const [state, setState] = useState<UsageState | null>(null)
  useEffect(() => {
    let live = true
    let pushed = false
    // A push can arrive before get()'s reply: once one has, it's the newer answer.
    const off = window.deck.usage.onChange((next) => {
      pushed = true
      setState(next)
    })
    window.deck.usage.get().then(
      (now) => {
        if (live && !pushed) setState(now)
      },
      () => {},
    )
    return () => {
      live = false
      off()
    }
  }, [])
  return state
}
```

- [ ] **Step 3: The card** `src/renderer/src/usage/UsageCard.tsx`:

```tsx
import { Component, type ErrorInfo, type MouseEvent, type ReactNode, useState } from 'react'
import type { UsageChange, UsageLink, UsageState } from '@shared/types'
import { displayPath } from '../git/format'
import { useStoredFlag, useTick } from '../hooks'
import { Caret } from '../icons'
import { Donut } from './Donut'
import { type UsageView, usageView } from './view'
import './usage.css'

const OPEN_KEY = 'deck.usageOpen'

interface UsageCardProps {
  state: UsageState
  /** For the settings path: '~/…' under it. */
  home: string
}

/** Clicking the card leaves the keyboard where it was: in the terminal. */
const keepFocus = (e: MouseEvent) => e.preventDefault()

/** Claude's plan usage, as Claude Code's status line last reported it: at the bottom of the Claude
 *  pane, above the clipboard card. A thrown render costs only the card. */
export function UsageCard(props: UsageCardProps) {
  return (
    <Boundary>
      <CardBody {...props} />
    </Boundary>
  )
}

function CardBody({ state, home }: UsageCardProps) {
  const [open, toggle] = useStoredFlag(OPEN_KEY, true)
  const [busy, setBusy] = useState(false)
  const [error, setError] = useState<string | null>(null)
  useTick(30_000) // countdowns and "updated … ago" move on without a new state
  const view = usageView(state, Date.now())
  const { link } = state

  const run = (action: () => Promise<UsageChange>) => {
    setBusy(true)
    setError(null)
    action()
      .then(
        (result) => setError('error' in result ? result.error : null),
        (err: unknown) => setError(err instanceof Error ? err.message : String(err)),
      )
      .finally(() => setBusy(false))
  }
  const connect = (replace: boolean) => run(() => window.deck.usage.connect(replace))
  const disconnect = () => run(() => window.deck.usage.disconnect())

  return (
    <section className="usage-card" aria-label="Claude usage" onMouseDown={keepFocus}>
      <button className="cp-section-head usage-head" aria-expanded={open} onClick={toggle}>
        <Caret />
        <span className="cp-section-name">Usage</span>
        <Summary link={link} view={view} />
      </button>
      {open && (
        <div className="usage-body">
          {link.state === 'connected' && view.rings.length > 0 && (
            <div className="usage-main">
              <Donut rings={view.rings} top={view.top} label={view.label} />
              <ul className="usage-legend">
                {view.rings.map((r) => (
                  <li key={r.key}>
                    <span className={`usage-dot ring-${r.key}`} aria-hidden="true" />
                    <span className="usage-name">{r.label}</span>
                    <span className={`usage-pct tone-${r.tone}`}>{r.percent}%</span>
                    <span className={r.past ? 'usage-reset past' : 'usage-reset'}>{r.reset}</span>
                  </li>
                ))}
              </ul>
            </div>
          )}
          {link.state === 'connected' && view.rings.length === 0 && (
            <p className="usage-text">
              Waiting for Claude's next reply.
              <span className="usage-note">Claude Code reports usage on Pro, Max and Ultra plans.</span>
            </p>
          )}
          {link.state === 'off' && (
            <>
              <p className="usage-text">See your Claude plan usage here. Deck reads it from Claude Code's status line.</p>
              <div className="usage-actions">
                <button className="button primary" disabled={busy} onClick={() => connect(false)}>
                  {busy ? 'Connecting…' : 'Connect'}
                </button>
              </div>
              <p className="usage-note">
                Adds a status line to Claude Code's settings
                (<code>{displayPath(state.settingsFile, home, window.deck.platform)}</code>). Claude Code then hides
                its footer hints, like “esc to interrupt”. Disconnect undoes it.
              </p>
            </>
          )}
          {link.state === 'other' && (
            <>
              <p className="usage-text">Claude Code already has a status line:</p>
              <code className="usage-command" title={link.command}>{link.command}</code>
              <div className="usage-actions">
                <button className="button" disabled={busy} onClick={() => connect(true)}>
                  {busy ? 'Connecting…' : 'Replace it'}
                </button>
              </div>
              <p className="usage-note">Deck reads usage through the status line, so connecting replaces this one; Disconnect puts it back.</p>
            </>
          )}
          {link.state === 'error' && <div className="usage-error" role="alert">{link.message}</div>}
          {error && <div className="usage-error" role="alert">{error}</div>}
          {link.state === 'connected' && (
            <div className="usage-foot">
              <span>{view.updated}</span>
              <span className="usage-spacer" />
              <button className="link-button" disabled={busy} onClick={disconnect}>Disconnect</button>
            </div>
          )}
        </div>
      )}
    </section>
  )
}

/** The heading's summary: the percentages when connected, else the link's state. */
function Summary({ link, view }: { link: UsageLink; view: UsageView }) {
  if (link.state !== 'connected') return <span className="usage-sum">{link.state === 'error' ? 'unavailable' : 'not connected'}</span>
  if (!view.rings.length) return <span className="usage-sum">waiting for Claude</span>
  return (
    <span className="usage-sum" title={view.summary}>
      {view.rings.map((r, i) => (
        <span key={r.key}>
          {i > 0 && ' · '}
          {r.key} <span className={`cp-count tone-${r.tone}`}>{r.percent}%</span>
        </span>
      ))}
    </span>
  )
}

/** A thrown render (a state main got wrong) costs the card, never the panel or terminal next to it. */
class Boundary extends Component<{ children: ReactNode }, { error: Error | null }> {
  state: { error: Error | null } = { error: null }

  static getDerivedStateFromError(error: unknown) {
    return { error: error instanceof Error ? error : new Error(String(error)) }
  }

  componentDidCatch(error: unknown, info: ErrorInfo) {
    console.error('Usage card:', error, info.componentStack)
  }

  render() {
    return this.state.error ? null : this.props.children
  }
}
```

- [ ] **Step 4: The styles** `src/renderer/src/usage/usage.css`:

```css
/* The usage card, at the bottom of the Claude pane above the clipboard card (App.tsx: Workspace).
   Its heading is the Claude panel's section heading (panel.css: .cp-section-head). */
.usage-card {
  flex: none;
  display: flex;
  flex-direction: column;
  margin: 8px;
  padding: 2px 0;
  border: 1px solid var(--line-strong);
  border-radius: 8px;
  background: var(--surface);
  color: var(--text);
  font: 12px/1.4 var(--font-ui);
}
.usage-card + .clip-card { margin-top: 0; }
.usage-sum { min-width: 0; overflow: hidden; color: var(--muted); font-weight: 500; letter-spacing: 0; text-overflow: ellipsis; white-space: nowrap; }

.usage-body { display: flex; flex-direction: column; gap: 8px; padding: 4px 10px 6px; }
.usage-main { display: flex; align-items: center; gap: 12px; min-width: 0; }
.usage-donut { flex: none; }
.usage-track { stroke: var(--line); }
.ring-week .usage-arc { stroke: var(--violet); }
.ring-5h .usage-arc { stroke: var(--teal); }
.usage-mid { fill: var(--ink); font: 600 13px var(--font-ui); font-variant-numeric: tabular-nums; }
.usage-mid-name { fill: var(--muted); font: 9px var(--font-ui); }

.usage-legend { display: flex; flex: 1; flex-direction: column; gap: 4px; min-width: 0; margin: 0; padding: 0; list-style: none; }
.usage-legend li { display: grid; grid-template-columns: 8px 1fr auto; align-items: center; column-gap: 6px; min-width: 0; }
.usage-dot { width: 8px; height: 8px; border-radius: 50%; }
.usage-dot.ring-week { background: var(--violet); }
.usage-dot.ring-5h { background: var(--teal); }
.usage-pct { font-weight: 600; font-variant-numeric: tabular-nums; }
.usage-reset { grid-column: 2 / -1; overflow: hidden; color: var(--muted); font-size: 11px; text-overflow: ellipsis; white-space: nowrap; }
.usage-reset.past { color: var(--faint); }

/* After .cp-count, which sets its own colour. */
.usage-card .tone-high { color: var(--amber); fill: var(--amber); }
.usage-card .tone-max { color: var(--red); fill: var(--red); }

.usage-text { margin: 0; }
.usage-note { display: block; margin: 0; color: var(--muted); font-size: 11px; }
.usage-text .usage-note { margin-top: 2px; }
.usage-note code { font: 10.5px var(--font-mono); overflow-wrap: anywhere; }
.usage-command { display: block; overflow: hidden; padding: 4px 6px; border-radius: 4px; background: var(--field); font: 11px/1.4 var(--font-mono); text-overflow: ellipsis; white-space: nowrap; }
.usage-actions { display: flex; gap: 8px; }
.usage-actions .button { height: 26px; }
.usage-error { color: var(--red); overflow-wrap: anywhere; }
.usage-foot { display: flex; align-items: center; gap: 8px; color: var(--faint); font-size: 11px; }
.usage-spacer { flex: 1; }
.usage-foot .link-button { font-size: 11px; }
```

- [ ] **Step 5: Put it in the pane.** In `src/renderer/src/App.tsx`:
  - add `UsageState` to the type import from `@shared/types`, and the imports
    `import { UsageCard } from './usage/UsageCard'` and `import { useUsage } from './usage/useUsage'`
    after `import { TerminalView } from './terminal/TerminalView'`;
  - in `App`, after `const clipItem = useClipboardItem()`, add:

```tsx
  /** Claude's plan usage, shown at the bottom of every Claude pane. */
  const usage = useUsage()
```

  - pass it to each `Workspace`: add `usage={usage}` after `clipItem={clipItem}`;
  - in `WorkspaceProps`, after `clipItem: ClipboardPreview | null`, add:

```tsx
  /** Claude's plan usage (one for the window). */
  usage: UsageState | null
```

  - in `Workspace`, add `usage` to the first destructuring line (after `clipItem`);
  - in the `claude-pane` div, between `<ClaudePanel … />` and `{claudeRuns && clipItem && (`, add:

```tsx
          {usage && <UsageCard state={usage} home={home} />}
```

- [ ] **Step 6: Typecheck, test, build.** `npm run typecheck && npm test && npm run build` → no
  errors, all PASS, build succeeds.

- [ ] **Step 7: Commit.**

```bash
git add src/renderer/src/usage src/renderer/src/App.tsx
git -c user.email=franco@effektstudios.com commit -m "Usage card: the donut above the clipboard card" -m "Claude-Session: https://claude.ai/code/session_012TidnD5ajWnitu5TEgV7qD"
```

---

### Task 13: Check it in the running app

No real settings are touched: the dev build gets its own userData, and `CLAUDE_CONFIG_DIR` points
at a temp folder whose `projects` links to the real logs, so the Claude panel still finds sessions.
A throwaway Claude session (Haiku, one word) runs Deck's command as its status line through
`--settings`.

`$S` below is the session scratchpad.

- [ ] **Step 1: A temp Claude config.**

```bash
mkdir -p "$S/claude-config" && ln -sfn ~/.claude/projects "$S/claude-config/projects"
printf '{\n  "model": "opus"\n}\n' > "$S/claude-config/settings.json"
```

- [ ] **Step 2: Start the dev build** (background):
  `CLAUDE_CONFIG_DIR="$S/claude-config" npx electron-vite dev --remoteDebuggingPort 9333 -- --user-data-dir="$S/deck-dev"`.
  Then open a tab in the repo by handing the folder to it:
  `./node_modules/.bin/electron . --user-data-dir="$S/deck-dev" --open "$PWD"` (needs `npm run build`
  first; the second process hands `--open` over and quits).

- [ ] **Step 3: A CDP helper** `$S/cdp.mjs` (Node 22 has `fetch` and `WebSocket`):

```js
// node cdp.mjs eval '<expression>'      → prints the value
// node cdp.mjs shot <file.png> [selector] → screenshot (of the selector's box, with a margin)
import { writeFileSync } from 'node:fs'

const [, , cmd, arg, selector] = process.argv
const page = (await (await fetch('http://127.0.0.1:9333/json')).json()).find((t) => t.type === 'page')
const ws = new WebSocket(page.webSocketDebuggerUrl)
await new Promise((resolve) => ws.addEventListener('open', resolve, { once: true }))
let id = 0
const send = (method, params = {}) => new Promise((resolve, reject) => {
  const mine = ++id
  const onMessage = (e) => {
    const msg = JSON.parse(e.data)
    if (msg.id !== mine) return
    ws.removeEventListener('message', onMessage)
    if (msg.error) reject(new Error(msg.error.message))
    else resolve(msg.result)
  }
  ws.addEventListener('message', onMessage)
  ws.send(JSON.stringify({ id: mine, method, params }))
})
const evaluate = async (expression) =>
  (await send('Runtime.evaluate', { expression, awaitPromise: true, returnByValue: true })).result.value
if (cmd === 'eval') {
  console.log(JSON.stringify(await evaluate(arg), null, 1))
} else if (cmd === 'shot') {
  let clip
  if (selector) {
    const r = await evaluate(`(() => { const b = document.querySelector(${JSON.stringify(selector)}).getBoundingClientRect(); return { x: b.x, y: b.y, width: b.width, height: b.height } })()`)
    clip = { x: Math.max(0, r.x - 8), y: Math.max(0, r.y - 8), width: r.width + 16, height: r.height + 16, scale: 2 }
  }
  const { data } = await send('Page.captureScreenshot', { format: 'png', ...(clip ? { clip } : {}) })
  writeFileSync(arg, Buffer.from(data, 'base64'))
  console.log('saved', arg)
}
ws.close()
```

- [ ] **Step 4: Not connected.** `node $S/cdp.mjs shot $S/usage-1.png .claude-pane` and look at it:
  the Usage card shows above where the clipboard card goes, with Connect and the small print
  naming `…/claude-config/settings.json`.

- [ ] **Step 5: Connect.**
  `node $S/cdp.mjs eval "document.querySelector('.usage-card .button.primary').click(), 'clicked'"`,
  then `cat "$S/claude-config/settings.json"`. Expected: `"model": "opus"` first, then
  `"statusLine": { "type": "command", "command": "/bin/sh '<S>/deck-dev/usage/statusline.sh'" }`.
  The card says "Waiting for Claude's next reply."

- [ ] **Step 6: A real report.** Write `$S/usage-probe/deck-settings.json` holding just that
  `statusLine`, then run the probe from the brainstorm (`look.py`), with `--settings` pointing at
  this file, a one-word Haiku prompt, and accepting nothing but the folder trust it already has.
  Expected: `$S/deck-dev/usage/statusline.json` appears; within a second the card shows the donut
  with the week ring (and 5-hour if reported). `shot $S/usage-2.png .usage-card`, then compare the
  numbers with the probe's footer ("You've used N% of your weekly limit").

- [ ] **Step 7: Fold and Disconnect.** Click the heading (`.usage-head`): the card folds to its
  summary line (`shot`). Unfold, then click Disconnect (`.usage-foot .link-button`). Expected:
  `settings.json` is `{"model": "opus"}` again and the card offers Connect.

- [ ] **Step 8: Quit the dev build** (kill the electron-vite process started in step 2) and remove
  `$S/deck-dev` and `$S/claude-config`.

Nothing to commit; note anything that looked wrong and fix it before going on.

---

### Task 14: Docs

**Files:**
- Modify: `CLAUDE.md`, `README.md`, `docs/TESTING.md`

- [ ] **Step 1: CLAUDE.md.**
  - Under "**M5, in progress:**", after the clipboard previews sentence, add: "Also the usage card
    (`…/2026-11-02-usage-card-design.md`, built 2026-11-02): Claude's plan limits above the
    clipboard card."
  - In the paths table, add a row after `src/main/clipboard/`:
    `| \`src/main/usage/\` | Claude's plan usage: the status line command and script, Claude Code's settings (connect/disconnect), reading and merging reports, \`usage.json\` |`
    and add `usage/` (card, donut, view) to the renderer row's list.
  - After the Clipboard notes, add:

```markdown
- Usage card (`src/main/usage/`):
  - **Source:** Claude Code's status line input: `rate_limits.five_hour` / `seven_day`, each
    `used_percentage` (0–100) and `resets_at` (Unix seconds). It comes only on Pro/Max/Ultra and
    only after a session's first API response, and either window can be missing (2026-11-02,
    2.1.283: only `seven_day` came).
  - **Never Claude's login:** Deck never reads Claude Code's OAuth token or calls `/api/oauth/usage`,
    which is what `/usage` does. Anthropic's terms forbid other apps collecting or using Claude.ai
    credentials.
  - **Connect** writes `statusLine` into Claude Code's user settings
    (`$CLAUDE_CONFIG_DIR` or `~/.claude`, then `settings.json`):
    - key order and the file's mode are kept, and a symlink is followed;
    - the old value goes to `userData/usage/connection.json` for Disconnect, and a copy of the file
      to `settings.backup.json`;
    - Deck never writes a settings file it can't parse;
    - while connected, Claude Code hides its footer hints ("esc to interrupt").
  - **Connected** means the settings' command equals this Deck's. That command holds the userData
    path, so a dev build started with `--user-data-dir` is another Deck.
  - **The command:**
    - **macOS:** `/bin/sh '<userData>/usage/statusline.sh'`, which writes a temp file and `mv`s it
      over `statusline.json`.
    - **Windows:** inline `powershell -NoProfile -NonInteractive -Command "…"`. The Restricted
      policy won't run a `.ps1`, and Deck doesn't pass `-ExecutionPolicy Bypass`. Claude Code runs
      the command through Git Bash, or PowerShell when that's missing, so it has no `$`, backtick
      or backslash. Untested on Windows.
  - **Merging:** within a window (reset times under an hour apart) the higher percentage wins. An
    idle session's status line re-runs (on a mode change or a reset) with its own older numbers.
  - **Testing without touching real settings:** start the dev build with `CLAUDE_CONFIG_DIR` set
    to a temp folder whose `projects` links to `~/.claude/projects`. Feed it reports with a
    throwaway `claude --settings <file with Deck's statusLine>` run.
```

- [ ] **Step 2: README.md.** In the Claude panel's list, change "Deck only
  reads Claude's files." to "Deck only reads Claude's files, apart from the status line the usage
  card's Connect adds." After the **Clipboard** item, add:

```markdown
  - **Usage:** your plan's weekly and 5-hour limits as a donut above the clipboard card,
    with when each resets. It updates whenever Claude replies. **Connect** on the card
    makes Deck Claude Code's status line, which is how Claude Code hands out these
    numbers: it adds a `statusLine` to `~/.claude/settings.json`, and Claude Code then
    hides its footer hints. **Disconnect** puts back what was there.
```

- [ ] **Step 3: docs/TESTING.md.** After step 18l, add:

```markdown
18m. Usage card: a Claude tab's pane shows a **Usage** card above the clipboard card. Click
     **Connect**: `%USERPROFILE%\.claude\settings.json` gains a `statusLine` whose command starts
     `powershell -NoProfile`. Give Claude a small task: a second or two after its reply the card
     shows the week ring (and the 5-hour one when Claude reports it) with reset times. They match
     what `/usage` says.
18n. Do 18m with Git for Windows installed (Claude Code then runs status lines through Git Bash)
     and, if you can, on a PC without it (PowerShell). In both, Claude's status line row stays
     empty: no "not recognized" and no PowerShell error in it.
18o. Click **Disconnect**: the `statusLine` leaves settings.json (or goes back to what was there
     before), and the card offers Connect again.
```

- [ ] **Step 4: Commit.**

```bash
git add CLAUDE.md README.md docs/TESTING.md
git -c user.email=franco@effektstudios.com commit -m "Docs: the usage card" -m "Claude-Session: https://claude.ai/code/session_012TidnD5ajWnitu5TEgV7qD"
```

---

### Task 15: Review and pull request

- [ ] **Step 1: Everything green.** `npm test && npm run typecheck && npm run build` → all PASS.
- [ ] **Step 2: Review.** Have a reviewer check the branch against the spec (superpowers
  code-reviewer) and fix what holds up.
- [ ] **Step 3: Push and open the PR.**

```bash
git push -u origin m5-usage-card
gh pr create --base main --title "Usage card: Claude's plan limits in the Claude pane" --body-file <body>
```

  The body says what the card does and how it gets the numbers (status line, never the login),
  what was checked (unit tests, the app with a real Claude reply) and what's left (Windows,
  `docs/TESTING.md` 18m–18o). It ends with
  `https://claude.ai/code/session_012TidnD5ajWnitu5TEgV7qD`.
