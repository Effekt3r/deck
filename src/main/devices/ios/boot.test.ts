import { chmodSync, existsSync, mkdirSync, mkdtempSync, readFileSync, rmSync, writeFileSync } from 'node:fs'
import { tmpdir } from 'node:os'
import { join } from 'node:path'
import { afterAll, beforeAll, describe, expect, it } from 'vitest'
import { bootSimulator, shutdownSimulator } from './boot'

// Shell scripts stand in for idb_companion; simulators are macOS's anyway.
describe.skipIf(process.platform === 'win32')('bootSimulator and shutdownSimulator', () => {
  let root: string
  beforeAll(() => {
    root = mkdtempSync(join(tmpdir(), 'deck-boot-'))
  })
  afterAll(() => rmSync(root, { recursive: true, force: true }))

  /** A stand-in idb_companion in its own folder: writes its arguments there, then runs `body`. */
  const idb = (name: string, body: string): string => {
    const dir = join(root, name)
    mkdirSync(dir)
    const file = join(dir, 'idb_companion')
    writeFileSync(file, `#!/bin/sh\necho "$@" > '${dir}/args'\n${body}\n`)
    chmodSync(file, 0o755)
    return file
  }
  const argsOf = (name: string) => readFileSync(join(root, name, 'args'), 'utf8').trim()

  it("boots and shuts down in Xcode's own set, at --log-level info", async () => {
    const file = idb('plain', `echo '{"state":"Booted"}'`)
    await bootSimulator(file, 'DEADBEEF-DEAD-BEEF-DEAD-BEEFDEADBEEF', { set: null })
    expect(argsOf('plain')).toBe('--boot DEADBEEF-DEAD-BEEF-DEAD-BEEFDEADBEEF --log-level info')
    await shutdownSimulator(file, 'DEADBEEF-DEAD-BEEF-DEAD-BEEFDEADBEEF', { set: null })
    expect(argsOf('plain')).toBe('--shutdown DEADBEEF-DEAD-BEEF-DEAD-BEEFDEADBEEF --log-level info')
  })

  it('names a private device set', async () => {
    const file = idb('set', 'exit 0')
    await bootSimulator(file, 'DEADBEEF-DEAD-BEEF-DEAD-BEEFDEADBEEF', { set: '/tmp/deck-set' })
    expect(argsOf('set')).toBe('--boot DEADBEEF-DEAD-BEEF-DEAD-BEEFDEADBEEF --device-set-path /tmp/deck-set --log-level info')
  })

  it('rejects with its last line that reads as a failure, without the timestamp', async () => {
    // As idb-companion 1.6.1 said it, booting a UDID its set doesn't have (2026-11-25); boot.ts only
    // checks the shape of what it's given, not whether the UDID is real.
    const file = idb('fail', [
      "echo '2026-11-25 15:22:03.140+0200 Booting 00000000-0000-0000-0000-000000000000' >&2",
      "echo '2026-11-25 15:22:03.218+0200 00000000-0000-0000-0000-000000000000 could not be resolved to any target in [FBSimulatorControl.SimulatorSet]' >&2",
      "echo '2026-11-25 15:22:03.219+0200 Loaded All Private Frameworks [CoreSimulator]' >&2",
      'exit 1',
    ].join('\n'))
    await expect(bootSimulator(file, '00000000-0000-0000-0000-000000000000', { set: null })).rejects.toThrow(new Error('00000000-0000-0000-0000-000000000000 could not be resolved to any target in [FBSimulatorControl.SimulatorSet]'))
  })

  it('says how it ended when no line reads as a failure', async () => {
    const file = idb('quiet', "echo '2026-11-25 15:22:03.140+0200 Booting DEADBEEF-DEAD-BEEF-DEAD-BEEFDEADBEEF' >&2\nexit 4")
    await expect(bootSimulator(file, 'DEADBEEF-DEAD-BEEF-DEAD-BEEFDEADBEEF', { set: null })).rejects.toThrow(new Error('idb_companion stopped (exit code 4).'))
  })

  it('an abort ends it at once with Stopped., and so does running out of time', async () => {
    const slow = idb('slow', 'exec sleep 30')
    const started = Date.now()
    const controller = new AbortController()
    const booting = bootSimulator(slow, 'DEADBEEF-DEAD-BEEF-DEAD-BEEFDEADBEEF', { set: null, signal: controller.signal })
    setTimeout(() => controller.abort(), 100)
    await expect(booting).rejects.toThrow(new Error('Stopped.'))
    await expect(shutdownSimulator(slow, 'DEADBEEF-DEAD-BEEF-DEAD-BEEFDEADBEEF', { set: null, timeoutMs: 200 })).rejects.toThrow(new Error("idb_companion didn't finish within 1 s."))
    expect(Date.now() - started).toBeLessThan(5000)
  })

  it('an abort before the start runs nothing', async () => {
    const file = idb('never', 'exit 0')
    await expect(bootSimulator(file, 'DEADBEEF-DEAD-BEEF-DEAD-BEEFDEADBEEF', { set: null, signal: AbortSignal.abort() })).rejects.toThrow(new Error('Stopped.'))
    expect(existsSync(join(root, 'never', 'args'))).toBe(false)
  })

  it("refuses anything that isn't a UDID, before spawning idb_companion", async () => {
    const file = idb('udid-check', 'exit 0')
    for (const bad of ['not-a-udid', '../../etc/passwd', 'DEADBEEF-DEAD-BEEF-DEAD-BEEFDEADBEE', 'DEADBEEF-DEAD-BEEF-DEAD-BEEFDEADBEEFF', '']) {
      await expect(bootSimulator(file, bad, { set: null })).rejects.toThrow(`"${bad}" isn't a UDID.`)
      await expect(shutdownSimulator(file, bad, { set: null })).rejects.toThrow(`"${bad}" isn't a UDID.`)
    }
    expect(existsSync(join(root, 'udid-check', 'args'))).toBe(false)
  })

  it("rejects synchronously when idb_companion can't be spawned (ENOEXEC)", async () => {
    // No "#!": execve refuses it outright, synchronously, rather than failing once spawned.
    const dir = join(root, 'noexec')
    mkdirSync(dir)
    const file = join(dir, 'idb_companion')
    writeFileSync(file, 'not a script\n')
    chmodSync(file, 0o755)
    await expect(bootSimulator(file, 'DEADBEEF-DEAD-BEEF-DEAD-BEEFDEADBEEF', { set: null })).rejects.toThrow('spawn ENOEXEC')
  })

  it("rejects asynchronously (idb_companion's own 'error' event) when its path doesn't exist (ENOENT)", async () => {
    await expect(bootSimulator(join(root, 'missing', 'idb_companion'), 'DEADBEEF-DEAD-BEEF-DEAD-BEEFDEADBEEF', { set: null })).rejects.toThrow('ENOENT')
  })
})
