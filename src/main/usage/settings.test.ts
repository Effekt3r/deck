import { chmodSync, existsSync, lstatSync, mkdirSync, mkdtempSync, readFileSync, rmSync, statSync, symlinkSync, writeFileSync } from 'node:fs'
import { tmpdir } from 'node:os'
import { join } from 'node:path'
import { afterAll, describe, expect, it } from 'vitest'
import { claudeSettingsFile, connect, currentLink, disconnect, writeSettings } from './settings'

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
    expect(existsSync(join(o.dir, 'settings.backup.json'))).toBe(false) // there was nothing to back up
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

  it.skipIf(process.platform === 'win32')('leaves a link to a missing file alone, rather than putting a file in its place', async () => {
    const o = setup()
    const missing = join(root, `dotfiles-missing-${n}.json`)
    symlinkSync(missing, o.file)
    const message = `${o.file} links to a file that doesn't exist (${missing}), so Deck leaves it alone.`
    expect(await currentLink(o.file, o.command)).toEqual({ state: 'error', message })
    await expect(connect({ ...o, replace: false })).rejects.toThrow(message)
    expect(lstatSync(o.file).isSymbolicLink()).toBe(true)
    expect(existsSync(missing)).toBe(false)
  })

  it('reads a file that starts with a byte order mark', async () => {
    const o = setup('\uFEFF{\n  "model": "opus"\n}\n') // as PowerShell 5.1 writes UTF-8
    expect(await currentLink(o.file, o.command)).toEqual({ state: 'off' })
    await connect({ ...o, replace: false })
    expect(read(o.file)).toEqual({ model: 'opus', statusLine: { type: 'command', command: o.command } })
  })

  it('writes the file back with its own indentation, or two spaces when it has none', async () => {
    const before = { model: 'opus', permissions: { allow: ['Bash'] } }
    for (const indent of ['\t', '    ']) {
      const o = setup(`${JSON.stringify(before, null, indent)}\n`)
      await connect({ ...o, replace: false })
      const after = { ...before, statusLine: { type: 'command', command: o.command } }
      expect(readFileSync(o.file, 'utf8')).toBe(`${JSON.stringify(after, null, indent)}\n`)
      await disconnect(o)
      expect(readFileSync(o.file, 'utf8')).toBe(`${JSON.stringify(before, null, indent)}\n`)
    }
    const o = setup('{"model":"opus"}')
    await connect({ ...o, replace: false })
    expect(readFileSync(o.file, 'utf8')).toMatch(/^\{\n {2}"model": "opus",\n {2}"statusLine"/)
  })

  it('leaves a read-only file alone, and still reads it', async () => {
    const o = setup('{"model":"opus"}')
    await connect({ ...o, replace: false })
    const connected = readFileSync(o.file, 'utf8')
    chmodSync(o.file, 0o444)
    try {
      const message = `${o.file} is read-only, so Deck leaves it alone.`
      expect(await currentLink(o.file, o.command)).toEqual({ state: 'connected' })
      await expect(disconnect(o)).rejects.toThrow(message)
      expect(readFileSync(o.file, 'utf8')).toBe(connected)
      expect(statSync(o.file).mode & 0o777).toBe(0o444)

      const other = setup('{"model":"opus"}')
      chmodSync(other.file, 0o444)
      await expect(connect({ ...other, replace: false })).rejects.toThrow(`${other.file} is read-only, so Deck leaves it alone.`)
      expect(readFileSync(other.file, 'utf8')).toBe('{"model":"opus"}')
      chmodSync(other.file, 0o644)
    } finally {
      chmodSync(o.file, 0o644)
    }
  })
})

describe('writeSettings', () => {
  const changed = "Claude Code's settings changed while Deck was writing them; try again."

  it('writes only over the text the new settings were made from', async () => {
    const o = setup('{"model":"opus"}')
    await expect(writeSettings(o.file, { model: 'sonnet' }, '{"model":"haiku"}')).rejects.toThrow(changed)
    await expect(writeSettings(o.file, { model: 'sonnet' }, null)).rejects.toThrow(changed) // made when there was no file
    expect(readFileSync(o.file, 'utf8')).toBe('{"model":"opus"}')
    await writeSettings(o.file, { model: 'sonnet' }, '{"model":"opus"}')
    expect(read(o.file)).toEqual({ model: 'sonnet' })
  })

  it('writes a missing file only while it is still missing', async () => {
    const o = setup()
    await expect(writeSettings(o.file, { model: 'sonnet' }, '{}')).rejects.toThrow(changed) // removed meanwhile
    expect(existsSync(o.file)).toBe(false)
    await writeSettings(o.file, { model: 'sonnet' }, null)
    expect(read(o.file)).toEqual({ model: 'sonnet' })
  })
})
