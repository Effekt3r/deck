import { spawnSync } from 'node:child_process'
import { mkdtemp, rm, writeFile } from 'node:fs/promises'
import { tmpdir } from 'node:os'
import { join } from 'node:path'
import { afterEach, describe, expect, it } from 'vitest'
import type { ClaudePresence } from '@shared/types'
import { activityOf, alive, matchProcesses, parsePresence, parseProcessTable, PRESENCE_FILE, type PresenceEntry, PresenceWatch, type ProcessRow, psTable } from './presence'

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

const dirs: string[] = []
afterEach(async () => {
  for (const d of dirs.splice(0)) await rm(d, { recursive: true, force: true })
})

describe('PresenceWatch', () => {
  const started = 'Tue Nov 24 06:01:36 2026'
  const table = new Map<number, ProcessRow>([[400, { ppid: 1, started }], [500, { ppid: 400, started }], [600, { ppid: 1, started }]])
  const write = (dir: string, pid: number, p: Record<string, unknown> = {}) =>
    writeFile(join(dir, `${pid}.json`), JSON.stringify({ pid, sessionId: `s${pid}`, cwd: '/w/a', status: 'busy', procStart: started, ...p }))

  async function setup(opts: { ps?: boolean } = {}) {
    const dir = await mkdtemp(join(tmpdir(), 'deck-presence-'))
    dirs.push(dir)
    const published: ClaudePresence[][] = []
    const living = new Set([500, 600])
    let psRuns = 0
    const watch = new PresenceWatch({
      dir,
      shells: () => new Map([[400, 'pty-a']]),
      processes: opts.ps === false ? null : async () => {
        psRuns++
        return table
      },
      alive: (pid) => living.has(pid),
      publish: (list) => published.push(list),
      watch: () => null,
      pollMs: 60_000,
    })
    return { dir, published, living, watch, psRuns: () => psRuns }
  }

  it("publishes a Claude with its tab's pty, then its changes, then its going", async () => {
    const { dir, published, watch, psRuns } = await setup()
    await write(dir, 500)
    await watch.refresh()
    expect(published.at(-1)).toEqual([{ pid: 500, sessionId: 's500', cwd: '/w/a', state: 'working', ptyId: 'pty-a' }])
    expect(watch.current()).toEqual(published.at(-1))
    await write(dir, 500, { status: 'waiting', waitingFor: 'dialog open' })
    await watch.refresh()
    expect(published.at(-1)?.[0]).toMatchObject({ state: 'waiting', waitingFor: 'dialog open', ptyId: 'pty-a' })
    expect(psRuns()).toBe(1) // the same Claude: ps isn't run again
    await rm(join(dir, '500.json'))
    await watch.refresh()
    expect(published.at(-1)).toEqual([])
    watch.stop()
  })

  it('publishes only changes', async () => {
    const { dir, published, watch } = await setup()
    await write(dir, 500)
    await watch.refresh()
    await watch.refresh()
    expect(published).toHaveLength(1)
    watch.stop()
  })

  it("leaves out other files, broken ones, and Claudes whose process is gone", async () => {
    const { dir, published, living, watch } = await setup()
    await write(dir, 500)
    await writeFile(join(dir, '500.f2ef5ab0ef195a82.key'), 'secret')
    await writeFile(join(dir, '600.json'), '{"pid": 600, "sessi')
    await writeFile(join(dir, 'notes.json'), '{}')
    await write(dir, 700) // a file naming a pid with no process: gone
    await writeFile(join(dir, '800.json'), JSON.stringify({ pid: 801, sessionId: 's', cwd: '/w/a', status: 'busy' })) // its name isn't its pid
    await watch.refresh()
    expect(published.at(-1)?.map((p) => p.pid)).toEqual([500])
    living.delete(500)
    await watch.refresh()
    expect(published.at(-1)).toEqual([])
    watch.stop()
  })

  it('reads a file caught mid-write again on the next look', async () => {
    const { dir, published, watch } = await setup()
    await writeFile(join(dir, '600.json'), '{"pid": 600, "sessi')
    await watch.refresh()
    expect(published).toHaveLength(0)
    await write(dir, 600)
    await watch.refresh()
    expect(published.at(-1)?.map((p) => p.pid)).toEqual([600])
    watch.stop()
  })

  it('Windows (no ps): lists the running Claudes without ptys', async () => {
    const { dir, published, watch } = await setup({ ps: false })
    await write(dir, 500)
    await watch.refresh()
    expect(published.at(-1)).toEqual([{ pid: 500, sessionId: 's500', cwd: '/w/a', state: 'working' }])
    watch.stop()
  })

  it('a missing sessions folder is no Claudes', async () => {
    const published: ClaudePresence[][] = []
    const watch = new PresenceWatch({ dir: join(tmpdir(), 'deck-no-such-folder-6c1f'), shells: () => new Map(), processes: null, alive: () => true, publish: (l) => published.push(l), watch: () => null, pollMs: 60_000 })
    await watch.refresh()
    expect(watch.current()).toEqual([])
    expect(published).toHaveLength(0)
    watch.stop()
  })
})

describe('alive', () => {
  it('knows a live process and one that has exited', () => {
    expect(alive(process.pid)).toBe(true)
    const child = spawnSync(process.execPath, ['-e', ''])
    expect(alive(child.pid as number)).toBe(false)
  })
})

describe.skipIf(process.platform === 'win32')('psTable', () => {
  it('lists this process under its parent, with a UTC start time', async () => {
    const t = await psTable()
    expect(t.get(process.pid)?.ppid).toBe(process.ppid)
    expect(t.get(process.pid)?.started).toMatch(/^[A-Z][a-z]{2} [A-Z][a-z]{2} \d{1,2} \d\d:\d\d:\d\d \d{4}$/)
  })
})
