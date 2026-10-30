import { describe, expect, it } from 'vitest'
import { PtyManager } from './manager'

const echo = process.platform === 'win32'
  ? () => ({ file: 'cmd.exe', args: ['/c', 'echo deck-ok'], env: process.env as Record<string, string> })
  : () => ({ file: '/bin/sh', args: ['-c', 'printf deck-ok'], env: process.env as Record<string, string> })

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
})
