import { mkdirSync, symlinkSync, writeFileSync } from 'node:fs'
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

  it('finds a nested Gradle build of its own, an android folder in any case, and androidMain', async () => {
    const demo = makeDir('deck-dev-')
    touch(join(demo, 'android-demo', 'settings.gradle'))
    touch(join(demo, 'android-demo', 'app', 'src', 'main', 'AndroidManifest.xml'))
    expect(await isAndroidApp(demo)).toBe(true)

    const sdk = makeDir('deck-dev-')
    touch(join(sdk, 'sdk', 'settings.gradle.kts'))
    touch(join(sdk, 'sdk', 'app', 'src', 'main', 'AndroidManifest.xml'))
    expect(await isAndroidApp(sdk)).toBe(true)

    const compose = makeDir('deck-dev-')
    touch(join(compose, 'composeApp', 'src', 'androidMain', 'AndroidManifest.xml'))
    expect(await isAndroidApp(compose)).toBe(true)

    const cased = makeDir('deck-dev-')
    touch(join(cased, 'Android', 'app', 'src', 'main', 'AndroidManifest.xml'))
    expect(await isAndroidApp(cased)).toBe(true)
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

  it('resolves a symlink to its real path, not the path it was given', async () => {
    const repo = makeRepo()
    commit(repo, 'first', { 'a.txt': 'a' })
    mkdirSync(join(repo, 'sub'))
    const links = makeDir('deck-dev-links-')

    const toRepo = join(links, 'to-repo')
    symlinkSync(repo, toRepo, 'junction')
    expect(await projectRoot(toRepo)).toBe(repo)

    const toSub = join(links, 'to-sub')
    symlinkSync(join(repo, 'sub'), toSub, 'junction')
    expect(await projectRoot(toSub)).toBe(repo)

    const plain = makeDir('deck-dev-')
    const toPlain = join(links, 'to-plain')
    symlinkSync(plain, toPlain, 'junction')
    expect(await projectRoot(toPlain)).toBe(plain)
  })
})

describe('describeProject', () => {
  it("a worktree of an Android app is that app", async () => {
    const repo = makeRepo()
    commit(repo, 'app', { 'app/src/main/AndroidManifest.xml': '<manifest/>' })
    const tree = join(makeDir('deck-dev-wt-'), 'task')
    run(repo, 'worktree', 'add', '-q', '-b', 'task', tree)
    const home = makeDir('deck-dev-home-')
    expect(await describeProject(tree, home)).toEqual({ root: repo, android: true })
  })

  it('does not scan a plain folder outside git', async () => {
    const dir = makeDir('deck-dev-')
    touch(join(dir, 'x', 'app', 'src', 'main', 'AndroidManifest.xml'))
    const home = makeDir('deck-dev-home-')
    expect(await describeProject(dir, home)).toEqual({ root: dir, android: false })
  })

  it('does not scan the home folder, even inside a repo', async () => {
    const repo = makeRepo()
    commit(repo, 'app', { 'app/src/main/AndroidManifest.xml': '<manifest/>' })
    expect(await describeProject(repo, repo)).toEqual({ root: repo, android: false })
  })
})
