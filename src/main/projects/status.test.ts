import { execFileSync } from 'node:child_process'
import { mkdtempSync, writeFileSync } from 'node:fs'
import { tmpdir } from 'node:os'
import { join } from 'node:path'
import { describe, expect, it } from 'vitest'
import { countStatus, projectStatus } from './status'

describe('projectStatus', () => {
  it('counts changed and untracked files and skips non-repos', async () => {
    const d = mkdtempSync(join(tmpdir(), 'deck-status-'))
    const git = (...a: string[]) => execFileSync('git', ['-C', d, ...a], { stdio: 'ignore' })
    git('init', '-q'); git('config', 'user.email', 't@t'); git('config', 'user.name', 't')
    git('config', 'commit.gpgsign', 'false') // a global signing setup would fail the commit
    writeFileSync(join(d, 'a.txt'), '1'); git('add', 'a.txt'); git('commit', '-qm', 'init')
    writeFileSync(join(d, 'a.txt'), '2'); writeFileSync(join(d, 'new.txt'), 'n')
    const plain = mkdtempSync(join(tmpdir(), 'deck-plain-'))
    expect(await projectStatus([d, plain])).toEqual([{ path: d, changed: 1, untracked: 1, conflicts: 0 }])
  })
  it('counts conflicts like the prototype', () => {
    expect(countStatus('UU a\nAA b\nDD c\nDU d\nMM e\nA  f\nR  g -> h\n?? i\n'))
      .toEqual({ changed: 3, untracked: 1, conflicts: 4 })
  })
})
