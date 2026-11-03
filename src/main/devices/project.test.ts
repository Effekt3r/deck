import { mkdirSync, writeFileSync } from 'node:fs'
import { dirname, join } from 'node:path'
import { afterAll, describe, expect, it } from 'vitest'
import { commit, makeDir, makeRepo, removeRepos, run } from '../git/test-repo'
import { describeProject, isAndroidApp, projectRoot } from './project'

afterAll(removeRepos)

function touch(file: string): void {
  mkdirSync(dirname(file), { recursive: true })
  writeFileSync(file, '<manifest/>')
}

describe('isAndroidApp', () => {
  it("finds a module's manifest one level down, and two levels down in android/", async () => {
    const gradle = makeDir('deck-dev-')
    touch(join(gradle, 'app', 'src', 'main', 'AndroidManifest.xml'))
    expect(await isAndroidApp(gradle)).toBe(true)
    const flutter = makeDir('deck-dev-')
    touch(join(flutter, 'android', 'app', 'src', 'main', 'AndroidManifest.xml'))
    expect(await isAndroidApp(flutter)).toBe(true)
  })

  it('skips build output, dependencies and folders deeper down', async () => {
    const dir = makeDir('deck-dev-')
    touch(join(dir, 'build', 'src', 'main', 'AndroidManifest.xml'))
    touch(join(dir, 'node_modules', 'x', 'src', 'main', 'AndroidManifest.xml'))
    touch(join(dir, 'libs', 'app', 'src', 'main', 'AndroidManifest.xml'))
    expect(await isAndroidApp(dir)).toBe(false)
  })
})

describe('projectRoot', () => {
  it("is a worktree's main checkout, a sub-folder's repository, and a plain folder itself", async () => {
    const repo = makeRepo()
    commit(repo, 'first', { 'a.txt': 'a' })
    const tree = join(makeDir('deck-dev-wt-'), 'fix')
    run(repo, 'worktree', 'add', '-q', '-b', 'fix', tree)
    mkdirSync(join(repo, 'sub'))
    expect(await projectRoot(tree)).toBe(repo)
    expect(await projectRoot(join(repo, 'sub'))).toBe(repo)
    const plain = makeDir('deck-dev-')
    expect(await projectRoot(plain)).toBe(plain)
  })
})

describe('describeProject', () => {
  it("a worktree of an Android app is that app", async () => {
    const repo = makeRepo()
    commit(repo, 'app', { 'app/src/main/AndroidManifest.xml': '<manifest/>' })
    const tree = join(makeDir('deck-dev-wt-'), 'task')
    run(repo, 'worktree', 'add', '-q', '-b', 'task', tree)
    expect(await describeProject(tree)).toEqual({ root: repo, android: true })
  })
})
