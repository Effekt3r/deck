import { isAbsolute } from 'node:path'
import { ipcMain, type WebContents } from 'electron'
import { IPC } from '@shared/channels'
import type { GitCommit, GitCommitDetails, GitSnapshot } from '@shared/types'
import { readDetails } from './details'
import { LOG_PAGE, readLog } from './log'
import { targetChoices } from './merge-target'
import { readSnapshot } from './snapshot'
import { type Client, RepoSubscriptions } from './subscriptions'
import { gitDirs } from './summary'
import { TargetsStore } from './targets-store'
import { repoProbe, watchRepo } from './watcher'

// The renderer sends the shell's GIT_REPO, so a folder is absolute; a relative one would be
// resolved against the app's own working directory.
const isFolder = (x: unknown): x is string => typeof x === 'string' && x !== '' && isAbsolute(x)
const isInt = (x: unknown, min: number, max: number): x is number => Number.isInteger(x) && (x as number) >= min && (x as number) <= max
// A branch or ref name as git allows it, and never something git would read as an option.
const isRefName = (x: unknown): x is string =>
  typeof x === 'string' && x !== '' && x.length < 1024 && !x.startsWith('-') && !/[\s\x00-\x1f\x7f]/.test(x)

export function registerGitIpc(deps: { targetsFile: string }): void {
  const targets = new TargetsStore(deps.targetsFile)
  const hub = new RepoSubscriptions({
    resolve: gitDirs,
    snapshot: (dirs) => readSnapshot(dirs.root, targets),
    // Polls only rebuild when status or the git dir's key files changed (a full snapshot of a
    // large repo costs ~350 ms of CPU; the probe is one `git status`).
    watch: (dirs, onChange) => watchRepo(dirs, onChange, { probe: () => repoProbe(dirs) }),
  })

  const seen = new Set<number>()
  const client = (wc: WebContents): Client => {
    const id = wc.id
    if (!seen.has(id)) {
      seen.add(id)
      wc.once('destroyed', () => {
        seen.delete(id)
        hub.drop(id)
      })
      // A reload starts a renderer that has subscribed to nothing yet.
      wc.on('did-start-loading', () => hub.drop(id))
      wc.on('render-process-gone', () => hub.drop(id))
    }
    return {
      id,
      send: (repo, snapshot) => {
        if (!wc.isDestroyed()) wc.send(IPC.gitUpdate, repo, snapshot)
      },
    }
  }

  ipcMain.handle(IPC.gitSubscribe, (e, repo: unknown): Promise<GitSnapshot | null> | null =>
    isFolder(repo) ? hub.subscribe(client(e.sender), repo) : null)
  // An `on` listener that throws shows an error dialog, so this one only acts on valid arguments.
  ipcMain.on(IPC.gitUnsubscribe, (e, repo: unknown) => {
    if (isFolder(repo)) hub.unsubscribe(e.sender.id, repo)
  })
  ipcMain.handle(IPC.gitLogPage, async (_e, repo: unknown, skip: unknown, limit: unknown): Promise<GitCommit[]> => {
    if (!isFolder(repo) || !isInt(skip, 0, 10_000_000) || !isInt(limit, 1, 10 * LOG_PAGE)) return []
    return readLog(repo, skip, limit).catch(() => [])
  })
  ipcMain.handle(IPC.gitDetails, async (_e, repo: unknown, hash: unknown): Promise<GitCommitDetails | null> =>
    isFolder(repo) && typeof hash === 'string' ? readDetails(repo, hash) : null)
  ipcMain.handle(IPC.gitTargets, async (_e, repo: unknown): Promise<string[]> => (isFolder(repo) ? targetChoices(repo) : []))
  ipcMain.handle(IPC.gitSetTarget, async (_e, repo: unknown, branch: unknown, target: unknown): Promise<void> => {
    if (!isFolder(repo) || !isRefName(branch) || !(target === null || isRefName(target))) return
    const dirs = await gitDirs(repo)
    if (!dirs) return
    await targets.set(dirs.root, branch, target)
    await hub.refresh(dirs.root) // the new target is pushed before this resolves
  })
}
