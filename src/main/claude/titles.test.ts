import { resolve, sep } from 'node:path'
import { afterAll, beforeAll, describe, expect, it } from 'vitest'
import { makeClaudeHome, removeClaudeHomes, sessionLog } from './test-log'
import { readTitle } from './titles'

const FOLDER = resolve(sep, 'Users', 'me', 'app')
let home = ''
beforeAll(() => {
  home = makeClaudeHome()
})
afterAll(removeClaudeHomes)

const filler = (log: ReturnType<typeof sessionLog>, kb: number) => {
  for (let i = 0; i < kb; i++) log.reply(`${'x'.repeat(1000)} ${i}`, { stopReason: 'tool_use' })
  return log
}

describe('readTitle', () => {
  it('custom title > AI title > first prompt > nothing', async () => {
    expect(await readTitle(sessionLog(home, FOLDER).prompt('First prompt\nmore').path)).toBe('First prompt')
    expect(await readTitle(sessionLog(home, FOLDER).prompt('p').aiTitle('AI title').path)).toBe('AI title')
    expect(await readTitle(sessionLog(home, FOLDER).aiTitle('AI').customTitle('Mine').aiTitle('AI 2').path)).toBe('Mine')
    expect(await readTitle(sessionLog(home, FOLDER).permissionMode('default').path)).toBe('')
    expect(await readTitle(resolve(home, 'missing.jsonl'))).toBe('')
  })

  it('in a long log: the latest titles near the end, the first prompt from the start', async () => {
    const titled = filler(sessionLog(home, FOLDER).prompt('Early prompt').aiTitle('Old title'), 300).aiTitle('Current title')
    expect(await readTitle(titled.path)).toBe('Current title')
    const untitled = filler(sessionLog(home, FOLDER).prompt('Only the first prompt names it'), 300)
    expect(await readTitle(untitled.path)).toBe('Only the first prompt names it')
  })

  it('reads the log again once it changed', async () => {
    const log = sessionLog(home, FOLDER).prompt('Before')
    expect(await readTitle(log.path)).toBe('Before')
    log.customTitle('After')
    expect(await readTitle(log.path)).toBe('After')
  })
})
