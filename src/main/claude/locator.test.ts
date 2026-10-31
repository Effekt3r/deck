import { mkdirSync, symlinkSync } from 'node:fs'
import { homedir } from 'node:os'
import { join, resolve, sep } from 'node:path'
import { afterAll, describe, expect, it } from 'vitest'
import { claudeHome, encodeFolder, findSessions, projectDirs } from './locator'
import { makeClaudeHome, makeFolder, removeClaudeHomes, sessionLog } from './test-log'

afterAll(removeClaudeHomes)

/** An absolute folder on this platform (C:\Volumes\… on Windows), which needn't exist. */
const abs = (...parts: string[]) => resolve(sep, ...parts)
const T0 = Date.UTC(2026, 9, 30, 12, 0, 0)

describe('claudeHome', () => {
  it('is $CLAUDE_CONFIG_DIR, else ~/.claude', () => {
    expect(claudeHome({ CLAUDE_CONFIG_DIR: '/x/claude' })).toBe('/x/claude')
    expect(claudeHome({ CLAUDE_CONFIG_DIR: '' })).toBe(join(homedir(), '.claude'))
    expect(claudeHome({})).toBe(join(homedir(), '.claude'))
  })
})

describe('encodeFolder', () => {
  it('replaces every character that is not a letter or digit with -', () => {
    expect(encodeFolder('/Users/me/my_app.v2')).toBe('-Users-me-my-app-v2')
    expect(encodeFolder('/Volumes/Wyobi/AccessControl_Guard')).toBe('-Volumes-Wyobi-AccessControl-Guard')
    expect(encodeFolder('C:\\Users\\me\\proj')).toBe('C--Users-me-proj')
    expect(encodeFolder('/r/.claude/worktrees/feat')).toBe('-r--claude-worktrees-feat')
    expect(encodeFolder('/tmp/café')).toBe('-tmp-caf-')
  })
})

describe('findSessions', () => {
  it('matches the folder case-insensitively, includes its worktrees, not siblings; newest first', async () => {
    const home = makeClaudeHome()
    const env = { CLAUDE_CONFIG_DIR: home }
    // Claude logs under process.cwd(), i.e. the on-disk case (the volume is "Wyobi").
    const main = sessionLog(home, abs('Volumes', 'Wyobi', 'X'), 'main-1').reply('hi').touch(T0 + 1000)
    const older = sessionLog(home, abs('Volumes', 'Wyobi', 'X'), 'main-0').reply('hi').touch(T0)
    const wt = sessionLog(home, abs('Volumes', 'Wyobi', 'X', '.claude', 'worktrees', 'feat'), 'wt-1').reply('hi').touch(T0 + 2000)
    sessionLog(home, abs('Volumes', 'Wyobi', 'X-Old'), 'sibling').reply('hi').touch(T0 + 3000)
    sessionLog(home, abs('Volumes', 'Wyobi', 'XY'), 'other').reply('hi').touch(T0 + 4000)

    const found = await findSessions(abs('Volumes', 'wyobi', 'X'), env)
    expect(found).toEqual([
      { id: 'wt-1', path: wt.path, modified: T0 + 2000 },
      { id: 'main-1', path: main.path, modified: T0 + 1000 },
      { id: 'main-0', path: older.path, modified: T0 },
    ])
    expect(await findSessions(`${abs('Volumes', 'wyobi', 'X')}${sep}`, env)).toEqual(found) // trailing separator
  })

  it('lists only .jsonl files, not the session folders or memory/', async () => {
    const home = makeClaudeHome()
    const log = sessionLog(home, abs('p'), 's1').reply('hi')
    log.subagent('a1', 'toolu_1').reply('sub-agent log, not a session')
    mkdirSync(join(home, 'projects', encodeFolder(abs('p')), 'memory'))
    expect((await findSessions(abs('p'), { CLAUDE_CONFIG_DIR: home })).map((s) => s.id)).toEqual(['s1'])
  })

  it('also finds the logs of the real path when the folder is a symlink', async () => {
    if (process.platform === 'win32') return // symlinks need privileges there
    const home = makeClaudeHome()
    const real = makeFolder()
    const link = join(makeFolder(), 'link')
    symlinkSync(real, link)
    sessionLog(home, real, 'via-real').reply('hi')
    expect((await findSessions(link, { CLAUDE_CONFIG_DIR: home })).map((s) => s.id)).toEqual(['via-real'])
  })

  it('is empty when Claude has no projects folder or none for this folder', async () => {
    const home = makeClaudeHome()
    expect(await findSessions(abs('nothing'), { CLAUDE_CONFIG_DIR: home })).toEqual([])
    expect(await findSessions(abs('nothing'), { CLAUDE_CONFIG_DIR: join(home, 'missing') })).toEqual([])
  })
})

describe('projectDirs', () => {
  it("is the folder's own project folder and its worktrees' (any case)", async () => {
    const home = makeClaudeHome()
    const env = { CLAUDE_CONFIG_DIR: home }
    sessionLog(home, abs('Volumes', 'Wyobi', 'X')).reply('hi')
    sessionLog(home, abs('Volumes', 'Wyobi', 'X', '.claude', 'worktrees', 'feat')).reply('hi')
    sessionLog(home, abs('Volumes', 'Wyobi', 'X-Old')).reply('hi')
    const dirs = await projectDirs(abs('Volumes', 'wyobi', 'X'), env)
    expect(dirs.sort()).toEqual([
      join(home, 'projects', encodeFolder(abs('Volumes', 'Wyobi', 'X'))),
      join(home, 'projects', `${encodeFolder(abs('Volumes', 'Wyobi', 'X'))}--claude-worktrees-feat`),
    ].sort())
    expect(await projectDirs(abs('none'), env)).toEqual([])
  })
})
