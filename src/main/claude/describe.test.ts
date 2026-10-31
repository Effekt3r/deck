import { homedir } from 'node:os'
import { join, sep } from 'node:path'
import { describe, expect, it } from 'vitest'
import { describeTool, firstLine, head, own, shortPath, tag, toolLabel } from './describe'

const P = join(homedir(), 'Development', 'app')

describe('shortPath', () => {
  it('is relative inside the project (any case, either separator), ~ under home, else as it is', () => {
    expect(shortPath(join(P, 'src', 'a.ts'), P)).toBe(join('src', 'a.ts'))
    expect(shortPath(`${P.toUpperCase()}/x.ts`, P)).toBe('x.ts')
    expect(shortPath(`${P}\\win\\b.ts`, P)).toBe('win\\b.ts')
    expect(shortPath(`${P}/`, `${P}/`)).toBe('')
    expect(shortPath(join(homedir(), 'notes.md'), P)).toBe(join('~', 'notes.md'))
    expect(shortPath('/etc/hosts', P)).toBe('/etc/hosts')
    expect(shortPath(`${P}-other/x`, P)).toBe(`~${`${P}-other/x`.slice(homedir().length)}`)
  })

  it("is also relative inside the project's real path (Claude's cwd when the folder is a symlink)", () => {
    const real = join(sep, 'Volumes', 'Disk', 'app')
    expect(shortPath(join(real, 'src', 'a.ts'), P, real)).toBe(join('src', 'a.ts'))
    expect(shortPath(join(P, 'b.ts'), P, real)).toBe('b.ts')
    expect(describeTool('Read', { file_path: join(real, 'c.ts') }, P, real)).toBe('c.ts')
  })
})

describe('own', () => {
  it('is the same text (a copy that no longer holds the text it was cut from)', () => {
    const big = `${'✻ first line, with an emoji 🙂\n'}${'x'.repeat(100_000)}`
    expect(own(firstLine(big))).toBe('✻ first line, with an emoji 🙂')
    expect(own(head(big, 30))).toBe(head(big, 30))
    expect(own('')).toBe('')
    expect(own('a')).toBe('a')
  })
})

describe('firstLine / tag', () => {
  it('firstLine: trimmed first line, at most n characters', () => {
    expect(firstLine('  \n first \nsecond')).toBe('first ')
    expect(firstLine('a\r\nb')).toBe('a')
    expect(firstLine('x'.repeat(300))).toHaveLength(200)
    expect(firstLine('abcdef', 3)).toBe('abc')
    expect(firstLine(undefined)).toBe('')
    expect(firstLine(42)).toBe('42')
  })

  it('tag: the first <name>…</name>, trimmed', () => {
    expect(tag('<a> x </a><a>y</a>', 'a')).toBe('x')
    expect(tag('<a>\nmulti\nline\n</a>', 'a')).toBe('multi\nline')
    expect(tag('<a>open only', 'a')).toBe('')
    expect(tag('none', 'a')).toBe('')
  })
})

describe('toolLabel', () => {
  it('shows MCP tools as server:tool', () => {
    expect(toolLabel('mcp__github__create_pull_request')).toBe('github:create_pull_request')
    expect(toolLabel('mcp__claude_ai_Docs__read')).toBe('claude_ai_Docs:read')
    expect(toolLabel('Bash')).toBe('Bash')
  })
})

describe('describeTool', () => {
  const d = (name: string, input: unknown) => describeTool(name, input, P)

  it('Bash: its description, else the first line of the command', () => {
    expect(d('Bash', { command: 'npm test', description: 'Run the tests' })).toBe('Run the tests')
    expect(d('Bash', { command: 'git status\ngit log' })).toBe('git status')
    expect(d('Bash', {})).toBe('')
  })

  it('file tools: the path, short', () => {
    expect(d('Read', { file_path: join(P, 'README.md') })).toBe('README.md')
    for (const name of ['Write', 'Edit', 'MultiEdit']) expect(d(name, { file_path: join(P, 'a.ts') })).toBe('a.ts')
    expect(d('NotebookEdit', { notebook_path: join(P, 'n.ipynb') })).toBe('n.ipynb')
  })

  it('Grep and Glob: the pattern, and where', () => {
    expect(d('Grep', { pattern: 'TODO', path: join(P, 'src') })).toBe('TODO  in src')
    expect(d('Glob', { pattern: '**/*.ts' })).toBe('**/*.ts')
  })

  it('Agent / Task: type and description', () => {
    expect(d('Agent', { subagent_type: 'Explore', description: 'Find the parser', prompt: '…' })).toBe('Explore: Find the parser')
    expect(d('Task', { description: 'Old name' })).toBe('agent: Old name')
  })

  it('web, to-dos and questions', () => {
    expect(d('WebFetch', { url: 'https://example.com' })).toBe('https://example.com')
    expect(d('WebSearch', { query: 'electron fs.watch' })).toBe('electron fs.watch')
    expect(d('TodoWrite', { todos: [{}, {}, {}] })).toBe('3 items')
    expect(d('AskUserQuestion', { questions: [{ question: 'Which one?\nDetails' }, { question: 'Second' }] })).toBe('Which one?')
    expect(d('AskUserQuestion', { questions: [] })).toBe('')
  })

  it('any other tool: the first of the usual fields, first line', () => {
    expect(d('Skill', { skill: 'pdf' })).toBe('pdf')
    expect(d('SendMessage', { to: 'a1', summary: 'Keep going\nmore' })).toBe('Keep going')
    expect(d('TaskStop', { task_id: 'b7' })).toBe('b7')
    expect(d('ExitPlanMode', { plan: '# Plan\n1. x' })).toBe('# Plan')
    expect(d('mcp__github__get_issue', { owner: 'o', repo: 'r' })).toBe('')
    expect(d('Weird', null)).toBe('')
    expect(d('Weird', 'not an object')).toBe('')
  })
})
