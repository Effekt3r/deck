import { isAbsolute } from 'node:path'
import { ipcMain, type WebContents } from 'electron'
import { IPC } from '@shared/channels'
import type { ClaudeSessionSummary, ClaudeSnapshot } from '@shared/types'
import { scanFolder } from './locator'
import { agentSteps } from './subagents'
import { type Client, ClaudeSubscriptions } from './subscriptions'
import { JsonlTail } from './tail'
import { readTitle } from './titles'
import { watchDirs } from './watch'

// The renderer sends the tab's folder, so it is absolute; a relative one would be resolved against
// the app's own working directory.
const isFolder = (x: unknown): x is string => typeof x === 'string' && x !== '' && x.length < 4096 && isAbsolute(x)
// Session ids are log file names (UUIDs); they're looked up in the folder's list, never joined into a path.
const isSessionId = (x: unknown): x is string => typeof x === 'string' && /^[A-Za-z0-9][A-Za-z0-9._-]{0,127}$/.test(x)

/** `claude:*` handlers. Read-only: Deck never writes to Claude's files. `env` (tests) decides
 *  where Claude's home is ($CLAUDE_CONFIG_DIR). */
export function registerClaudeIpc(opts: { env?: NodeJS.ProcessEnv } = {}): void {
  const env = opts.env ?? process.env
  const hub = new ClaudeSubscriptions({
    scan: (folder) => scanFolder(folder, env),
    open: (path) => new JsonlTail(path),
    steps: agentSteps,
    title: readTitle,
    watch: watchDirs,
    now: Date.now,
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
      send: (folder, snapshot) => {
        if (!wc.isDestroyed()) wc.send(IPC.claudeUpdate, folder, snapshot)
      },
    }
  }

  ipcMain.handle(IPC.claudeSubscribe, (e, folder: unknown): Promise<ClaudeSnapshot | null> | null =>
    isFolder(folder) ? hub.subscribe(client(e.sender), folder).catch(() => null) : null)
  // An `on` listener that throws shows an error dialog, so this one only acts on valid arguments.
  ipcMain.on(IPC.claudeUnsubscribe, (e, folder: unknown) => {
    if (isFolder(folder)) hub.unsubscribe(e.sender.id, folder)
  })
  ipcMain.handle(IPC.claudeSessions, async (_e, folder: unknown): Promise<ClaudeSessionSummary[]> =>
    isFolder(folder) ? hub.sessions(folder).catch(() => []) : [])
  ipcMain.handle(IPC.claudeFollow, async (_e, folder: unknown, sessionId: unknown): Promise<void> => {
    if (!isFolder(folder) || !(sessionId === null || isSessionId(sessionId))) return
    await hub.follow(folder, sessionId).catch(() => {})
  })
}
