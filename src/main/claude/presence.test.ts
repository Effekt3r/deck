import { describe, expect, it } from 'vitest'
import { activityOf, matchProcesses, parsePresence, parseProcessTable, PRESENCE_FILE, type PresenceEntry, type ProcessRow } from './presence'

const file = (p: Record<string, unknown>) => JSON.stringify({ pid: 500, sessionId: 's1', cwd: '/w/a', status: 'busy', ...p })

describe('activityOf', () => {
  it("maps Claude Code's statuses; shell (a background shell running) is idle", () => {
    expect(activityOf('busy')).toBe('working')
    expect(activityOf('waiting')).toBe('waiting')
    expect(activityOf('idle')).toBe('idle')
    expect(activityOf('shell')).toBe('idle')
    expect(activityOf('thinking')).toBeNull()
    expect(activityOf(undefined)).toBeNull()
  })
})

describe('parsePresence', () => {
  it('reads the fields Deck uses', () => {
    expect(parsePresence(file({ procStart: 'Tue Nov 24 06:01:36 2026', kind: 'interactive', version: '2.1.283' })))
      .toEqual({ pid: 500, sessionId: 's1', cwd: '/w/a', state: 'working', procStart: 'Tue Nov 24 06:01:36 2026' })
  })
  it('keeps what a waiting Claude waits on, cut short, and only while it waits', () => {
    expect(parsePresence(file({ status: 'waiting', waitingFor: 'dialog open' }))).toMatchObject({ state: 'waiting', waitingFor: 'dialog open' })
    expect(parsePresence(file({ status: 'waiting', waitingFor: 'x'.repeat(500) }))?.waitingFor).toHaveLength(200)
    expect(parsePresence(file({ status: 'idle', waitingFor: 'dialog open' }))).not.toHaveProperty('waitingFor')
  })
  it("compares start times with runs of spaces collapsed (ps pads a day below 10)", () =>
    expect(parsePresence(file({ procStart: ' Tue Nov  4 06:01:36 2026 ' }))?.procStart).toBe('Tue Nov 4 06:01:36 2026'))
  it("skips anything that isn't a presence file", () => {
    expect(parsePresence('{"pid": 500, "sessionId": "s1", "cwd": "/w/a", "status": "bu')).toBeNull() // caught mid-write
    expect(parsePresence('[]')).toBeNull()
    expect(parsePresence(file({ pid: -1 }))).toBeNull()
    expect(parsePresence(file({ pid: 1.5 }))).toBeNull()
    expect(parsePresence(file({ pid: '500' }))).toBeNull()
    expect(parsePresence(file({ cwd: 3 }))).toBeNull()
    expect(parsePresence(file({ sessionId: '' }))).toBeNull()
    expect(parsePresence(file({ status: 'asleep' }))).toBeNull()
  })
  it('names: <pid>.json only, never the .key files beside them', () => {
    expect(PRESENCE_FILE.test('13508.json')).toBe(true)
    expect(PRESENCE_FILE.test('13508.81f72b69dde09fae.key')).toBe(false)
    expect(PRESENCE_FILE.test('0.json')).toBe(false)
    expect(PRESENCE_FILE.test('../1.json')).toBe(false)
    expect(PRESENCE_FILE.test('1.json.tmp')).toBe(false)
  })
})

describe('parseProcessTable', () => {
  it("reads `ps -A -o pid=,ppid=,lstart=`, collapsing lstart's spaces", () => {
    const out = '    1     0 Mon Nov 23 04:00:00 2026\n13508 13154 Mon Nov  3 04:16:43 2026\nnot a row\n'
    expect(parseProcessTable(out)).toEqual(new Map([
      [1, { ppid: 0, started: 'Mon Nov 23 04:00:00 2026' }],
      [13508, { ppid: 13154, started: 'Mon Nov 3 04:16:43 2026' }],
    ]))
  })
})

describe('matchProcesses', () => {
  const started = 'Tue Nov 24 06:01:36 2026'
  const entry = (pid: number, p: Partial<PresenceEntry> = {}): PresenceEntry => ({ pid, sessionId: `s${pid}`, cwd: '/w/a', state: 'working', procStart: started, ...p })
  // launchd (1) ← Deck (100) ← zsh (200, tab A's shell) ← claude (300) ← sh (301) ← claude -p (302)
  //                         ← zsh (210, tab B's shell) ← wrapper (310) ← claude (311)
  // Terminal.app's zsh (400) ← claude (401)
  const table = new Map<number, ProcessRow>([
    [100, { ppid: 1, started }], [200, { ppid: 100, started }], [300, { ppid: 200, started }],
    [301, { ppid: 300, started }], [302, { ppid: 301, started }], [210, { ppid: 100, started }],
    [310, { ppid: 210, started }], [311, { ppid: 310, started }], [400, { ppid: 1, started }], [401, { ppid: 400, started }],
  ])
  const shells = new Map([[200, 'pty-a'], [210, 'pty-b']])

  it("gives each Claude its tab's pty: a child, or further down (a wrapper script)", () => {
    expect(matchProcesses([entry(300), entry(311)], shells, table)).toEqual([
      { pid: 300, sessionId: 's300', cwd: '/w/a', state: 'working', ptyId: 'pty-a' },
      { pid: 311, sessionId: 's311', cwd: '/w/a', state: 'working', ptyId: 'pty-b' },
    ])
  })
  it("lists a Claude outside Deck's tabs without a pty", () =>
    expect(matchProcesses([entry(401)], shells, table)).toEqual([{ pid: 401, sessionId: 's401', cwd: '/w/a', state: 'working' }]))
  it('gives a pty only the Claude nearest its shell (claude -p run by Claude counts as nothing)', () => {
    const list = matchProcesses([entry(302), entry(300)], shells, table)
    expect(list.find((p) => p.pid === 300)?.ptyId).toBe('pty-a')
    expect(list.find((p) => p.pid === 302)).not.toHaveProperty('ptyId')
  })
  it("drops a Claude whose process is gone, or whose pid now belongs to another process", () => {
    expect(matchProcesses([entry(999)], shells, table)).toEqual([])
    expect(matchProcesses([entry(300, { procStart: 'Mon Nov 23 01:00:00 2026' })], shells, table)).toEqual([])
    // No start time in the file (an older Claude Code): believed.
    expect(matchProcesses([entry(300, { procStart: undefined })], shells, table)[0]?.ptyId).toBe('pty-a')
  })
  it("stops at pid 1 and doesn't loop on a cycle", () => {
    const loop = new Map<number, ProcessRow>([[5, { ppid: 6, started }], [6, { ppid: 5, started }]])
    expect(matchProcesses([entry(5)], shells, loop)).toEqual([{ pid: 5, sessionId: 's5', cwd: '/w/a', state: 'working' }])
  })
})
