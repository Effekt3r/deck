import { describe, expect, it } from 'vitest'
import { activityOf, parsePresence, PRESENCE_FILE } from './presence'

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
