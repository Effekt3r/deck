import type { IPty } from 'node-pty'
import { describe, expect, it } from 'vitest'
import { PtyManager } from './manager'

const echo = process.platform === 'win32'
  ? () => ({ file: 'cmd.exe', args: ['/c', 'echo deck-ok'], env: process.env as Record<string, string> })
  : () => ({ file: '/bin/sh', args: ['-c', 'printf deck-ok'], env: process.env as Record<string, string> })
const noEvents = { data: () => {}, exit: () => {}, process: () => {} }

/** Enough of IPty for the manager, with a switch for "the shell already exited". */
class FakePty {
  pid = 42
  process = 'zsh'
  dead = false
  paused = false
  emit: (d: string) => void = () => {}
  onData(cb: (d: string) => void) { this.emit = cb; return { dispose() {} } }
  onExit() { return { dispose() {} } }
  // node-pty throws on these once the process is gone (ConPTY: until its exit event, ~1 s later).
  write() { if (this.dead) throw new Error('EBADF') }
  resize() { if (this.dead) throw new Error('Cannot resize a pty that has already exited') }
  kill() { if (this.dead) throw new Error('already exited') }
  pause() { this.paused = true }
  resume() { this.paused = false }
}

function fakeManager() {
  const pty = new FakePty()
  const m = new PtyManager(echo, noEvents, { spawn: () => pty as unknown as IPty })
  const { id } = m.create({ cwd: process.cwd(), cols: 80, rows: 24 })
  return { m, pty, id }
}

describe('PtyManager', () => {
  it('streams output and reports the exit', async () => {
    let out = ''
    const exited = new Promise<number>((resolve) => {
      const m = new PtyManager(echo, {
        data: (_id, d) => { out += d },
        exit: (_id, code) => resolve(code),
        process: () => {},
      })
      const info = m.create({ cwd: process.cwd(), cols: 80, rows: 24 })
      expect(info.pid).toBeGreaterThan(0)
    })
    expect(await exited).toBe(0)
    expect(out).toContain('deck-ok')
  })

  it("doesn't throw when a pty that already exited is written to, resized or killed", () => {
    const { m, pty, id } = fakeManager()
    pty.dead = true
    expect(() => m.resize(id, 100, 30)).not.toThrow()
    expect(() => m.write(id, 'ls\r')).not.toThrow()
    expect(() => m.kill(id)).not.toThrow()
  })

  it('pauses a flooding pty until the renderer has caught up', () => {
    const { m, pty, id } = fakeManager()
    pty.emit('x'.repeat(60_000))
    expect(pty.paused).toBe(false)
    pty.emit('x'.repeat(60_000)) // 120k unacknowledged
    expect(pty.paused).toBe(true)
    m.ack(id, 60_000) // 60k left: still too far behind
    expect(pty.paused).toBe(true)
    m.ack(id, 55_000) // 5k left
    expect(pty.paused).toBe(false)
    m.killAll()
  })
})
