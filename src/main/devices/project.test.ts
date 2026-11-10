import { mkdirSync, symlinkSync, writeFileSync } from 'node:fs'
import { dirname, join } from 'node:path'
import { afterAll, describe, expect, it } from 'vitest'
import { commit, makeDir, makeRepo, removeRepos, run } from '../git/test-repo'
import { describeProject, isAndroidApp, isIosApp, projectRoot } from './project'

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

  it("finds a module three levels down in a Gradle build two levels down: a monorepo's apps/, an app's mobile/android/", async () => {
    const mono = makeDir('deck-dev-')
    touch(join(mono, 'apps', 'bridge', 'settings.gradle.kts'))
    touch(join(mono, 'apps', 'bridge', 'app-kiosk', 'src', 'main', 'AndroidManifest.xml'))
    expect(await isAndroidApp(mono)).toBe(true)

    const mobile = makeDir('deck-dev-')
    touch(join(mobile, 'mobile', 'android', 'settings.gradle'))
    touch(join(mobile, 'mobile', 'android', 'app', 'src', 'main', 'AndroidManifest.xml'))
    expect(await isAndroidApp(mobile)).toBe(true)

    const inBuild = makeDir('deck-dev-')
    touch(join(inBuild, 'sdk', 'settings.gradle'))
    touch(join(inBuild, 'sdk', 'demo', 'settings.gradle'))
    touch(join(inBuild, 'sdk', 'demo', 'app', 'src', 'main', 'AndroidManifest.xml'))
    expect(await isAndroidApp(inBuild)).toBe(true)
  })

  it('looks three levels down only inside a Gradle build', async () => {
    const dir = makeDir('deck-dev-')
    touch(join(dir, 'apps', 'bridge', 'app', 'src', 'main', 'AndroidManifest.xml'))
    touch(join(dir, 'apps', 'build', 'settings.gradle'))
    touch(join(dir, 'apps', 'build', 'app', 'src', 'main', 'AndroidManifest.xml'))
    expect(await isAndroidApp(dir)).toBe(false)
  })
})

describe('isIosApp', () => {
  it('finds an Xcode project or workspace at the root or one folder down', async () => {
    const native = makeDir('deck-dev-')
    mkdirSync(join(native, 'App.xcodeproj'))
    expect(await isIosApp(native)).toBe(true)
    const flutter = makeDir('deck-dev-')
    mkdirSync(join(flutter, 'ios', 'Runner.xcworkspace'), { recursive: true })
    expect(await isIosApp(flutter)).toBe(true)
  })

  it('skips deeper ones, build output, dependencies and files named like one', async () => {
    const dir = makeDir('deck-dev-')
    mkdirSync(join(dir, 'libs', 'demo', 'Demo.xcodeproj'), { recursive: true })
    mkdirSync(join(dir, 'Pods', 'Pods.xcodeproj'), { recursive: true })
    mkdirSync(join(dir, 'build', 'X.xcworkspace'), { recursive: true })
    writeFileSync(join(dir, 'notes.xcodeproj'), '')
    expect(await isIosApp(dir)).toBe(false)
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
    expect(await describeProject(tree, home, true)).toEqual({ root: repo, android: true, ios: false })
  })

  it("does not scan a plain folder that isn't itself a Gradle build", async () => {
    const dir = makeDir('deck-dev-')
    touch(join(dir, 'app', 'src', 'main', 'AndroidManifest.xml'))
    const home = makeDir('deck-dev-home-')
    expect(await describeProject(dir, home, true)).toEqual({ root: dir, android: false, ios: false })
  })

  it('scans a plain folder that is itself a Gradle build, directly or through android/', async () => {
    const dir = makeDir('deck-dev-')
    touch(join(dir, 'settings.gradle'))
    touch(join(dir, 'app', 'src', 'main', 'AndroidManifest.xml'))
    const home = makeDir('deck-dev-home-')
    expect(await describeProject(dir, home, true)).toEqual({ root: dir, android: true, ios: false })

    const flutter = makeDir('deck-dev-')
    touch(join(flutter, 'Android', 'settings.gradle'))
    touch(join(flutter, 'Android', 'app', 'src', 'main', 'AndroidManifest.xml'))
    expect(await describeProject(flutter, home, true)).toEqual({ root: flutter, android: true, ios: false })
  })

  it('does not scan the home folder, even inside a repo', async () => {
    const repo = makeRepo()
    commit(repo, 'app', { 'app/src/main/AndroidManifest.xml': '<manifest/>' })
    expect(await describeProject(repo, repo, true)).toEqual({ root: repo, android: false, ios: false })
  })

  it('resolves the home folder through a symlink before comparing', async () => {
    const repo = makeRepo()
    commit(repo, 'app', { 'app/src/main/AndroidManifest.xml': '<manifest/>' })
    const link = join(makeDir('deck-dev-links-'), 'home-link')
    symlinkSync(repo, link, 'junction')
    expect(await describeProject(repo, link, true)).toEqual({ root: repo, android: false, ios: false })
  })

  it('an Xcode project in a repository is an iOS app, and Flutter is both', async () => {
    const home = makeDir('deck-dev-home-')
    const ios = makeRepo()
    commit(ios, 'app', { 'App.xcodeproj/project.pbxproj': '// !$*UTF8*$!' })
    expect(await describeProject(ios, home, true)).toEqual({ root: ios, android: false, ios: true })
    const flutter = makeRepo()
    commit(flutter, 'app', {
      'android/app/src/main/AndroidManifest.xml': '<manifest/>',
      'ios/Runner.xcworkspace/contents.xcworkspacedata': '<Workspace/>',
    })
    expect(await describeProject(flutter, home, true)).toEqual({ root: flutter, android: true, ios: true })
  })

  it('outside git, only the folder itself is looked at for an Xcode project', async () => {
    const home = makeDir('deck-dev-home-')
    const copied = makeDir('deck-dev-')
    mkdirSync(join(copied, 'App.xcworkspace'))
    expect(await describeProject(copied, home, true)).toEqual({ root: copied, android: false, ios: true })
    const plain = makeDir('deck-dev-')
    mkdirSync(join(plain, 'some', 'App.xcodeproj'), { recursive: true })
    expect(await describeProject(plain, home, true)).toEqual({ root: plain, android: false, ios: false })
  })
})
