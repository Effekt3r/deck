import { chmodSync, existsSync, lstatSync, mkdirSync, mkdtempSync, rmSync, symlinkSync, writeFileSync } from 'node:fs'
import net from 'node:net'
import { tmpdir } from 'node:os'
import { join } from 'node:path'
import { afterEach, describe, expect, it } from 'vitest'
import { simulatorIo, socketDirFor } from './simulator-io'
import { fakeProcess, type FakeProcess } from './test-process'

const flush = () => new Promise((r) => setImmediate(r))

/** The real io, except that its spawns are fakes: nothing here may start an idb_companion or a
 *  sim-video, and these paths don't exist anyway. */
function ioIn(dir: string) {
  const children: FakeProcess[] = []
  const spawned: { command: string; args: string[] }[] = []
  const io = simulatorIo(
    { companion: '/nonexistent/idb_companion', simVideo: '/nonexistent/sim-video', set: '/nonexistent/set', customSet: false, dir },
    {
      spawn: (command, args) => {
        spawned.push({ command, args })
        const p = fakeProcess()
        children.push(p)
        return p.proc
      },
    },
  )
  return { io, children, spawned }
}

describe('socketDirFor', () => {
  it("keeps the socket's path under macOS's 104 bytes", () => {
    expect(socketDirFor('/var/folders/wv/abc/T', 'deadbeef', 501)).toBe('/var/folders/wv/abc/T/deck-deadbeef')
    expect(socketDirFor(`/${'x'.repeat(90)}`, 'deadbeef', 501)).toBe('/tmp/deck-501-deadbeef')
  })

  it("leaves 23 bytes for a socket's name, counting bytes, not characters", () => {
    // 80 bytes of folder and 23 of name make 103, the most macOS takes.
    expect(socketDirFor(`/${'x'.repeat(65)}`, 'deadbeef', 501)).toBe(`/${'x'.repeat(65)}/deck-deadbeef`)
    expect(socketDirFor(`/${'x'.repeat(66)}`, 'deadbeef', 501)).toBe('/tmp/deck-501-deadbeef')
    // 48 characters, but 81 bytes: each é is two.
    expect(socketDirFor(`/${'é'.repeat(33)}`, 'deadbeef', 501)).toBe('/tmp/deck-501-deadbeef')
  })
})

describe('simulatorIo', () => {
  it('names each socket after its simulator and at random, since every start builds its own io', () => {
    const first = ioIn('/private/d').io.socketFor('ABCDEF12-3456-7890')
    const second = ioIn('/private/d').io.socketFor('ABCDEF12-3456-7890')
    expect(first).toMatch(/^\/private\/d\/ABCDEF12-[0-9a-f]{8}\.sock$/)
    expect(second).toMatch(/^\/private\/d\/ABCDEF12-[0-9a-f]{8}\.sock$/)
    expect(second).not.toBe(first)
  })
})

describe.skipIf(process.platform === 'win32')('simulatorIo on macOS', () => {
  // Folders are made inside the tests: a skipped suite still runs this body to collect them.
  const made: string[] = []
  afterEach(() => {
    for (const dir of made.splice(0)) rmSync(dir, { recursive: true, force: true })
  })
  const tempDir = () => {
    const dir = mkdtempSync(join(tmpdir(), 'dk-'))
    made.push(dir)
    return dir
  }

  it('gives every start its own socket: an old companion closing late removes only its own', async () => {
    const dir = tempDir()
    const first = ioIn(dir)
    const old = first.io.socketFor('ABCDEF12-3456')
    expect(old.startsWith(`${dir}/`)).toBe(true) // nothing written outside the test's own folder
    first.io.companion('ABCDEF12-3456', old)
    writeFileSync(old, '') // the socket it made
    const second = ioIn(dir)
    const current = second.io.socketFor('ABCDEF12-3456')
    second.io.companion('ABCDEF12-3456', current)
    writeFileSync(current, '')
    expect(second.spawned[0].args).toEqual(['--udid', 'ABCDEF12-3456', '--grpc-domain-sock', current, '--terminate-offline', 'true', '--log-level', 'info'])
    first.children[0].exit(0) // the old companion, slow to exit, closes now
    await flush()
    expect(existsSync(old)).toBe(false)
    expect(existsSync(current)).toBe(true)
  })

  it("refuses a socket folder that isn't private to this user, before starting anything", () => {
    const shared = join(tempDir(), 'shared')
    mkdirSync(shared)
    chmodSync(shared, 0o755)
    const t = ioIn(shared)
    expect(() => t.io.companion('U1', join(shared, 'U1.sock'))).toThrow("isn't private to this user")
    expect(t.spawned).toEqual([])
  })

  it('refuses a link in its place, even one as private as a folder', () => {
    const base = tempDir()
    const own = join(base, 'own')
    mkdirSync(own, { mode: 0o700 })
    const link = join(base, 'link')
    // macOS gives a link its own mode from the umask: under 077 it's as private as the folder, so
    // only its not being a folder refuses it.
    const umask = process.umask(0o077)
    try {
      symlinkSync(own, link)
    } finally {
      process.umask(umask)
    }
    expect(lstatSync(link).mode & 0o077).toBe(0)
    const t = ioIn(link)
    expect(() => t.io.companion('U1', join(link, 'U1.sock'))).toThrow("isn't private to this user")
    expect(t.spawned).toEqual([])
  })

  it('waits for the socket, and stops waiting when told', async () => {
    const dir = tempDir()
    const { io } = ioIn(dir)
    const socket = join(dir, 'a.sock')
    const ready = io.socketReady(socket, new AbortController().signal)
    const server = net.createServer().listen(socket)
    await ready
    await new Promise((resolve) => server.close(resolve))
    const abort = new AbortController()
    const waiting = io.socketReady(join(dir, 'b.sock'), abort.signal)
    abort.abort()
    await expect(waiting).rejects.toThrow('Stopped.')
  })
})
