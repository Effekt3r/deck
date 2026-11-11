import { isAbsolute } from 'node:path'
import { ipcMain, shell, type WebContents } from 'electron'
import { IPC } from '@shared/channels'
import type { ClaudeImageData, ClaudeResume, ClaudeSessionSummary, ClaudeSnapshot } from '@shared/types'
import type { TempImageExt } from '../clipboard/temp'
import { IMAGE_EXT } from './images'
import { scanFolder } from './locator'
import { GONE, ImagePixels } from './pixels'
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
// Image ids are what main listed: 16 hex digits of a SHA-1. They're looked up, never part of a path.
const isImageId = (x: unknown): x is string => typeof x === 'string' && /^[0-9a-f]{16}$/.test(x)
const isSize = (x: unknown): x is 'thumb' | 'full' => x === 'thumb' || x === 'full'
/** The tab's session to resume; anything else is none (the newest). Only the two fields are kept. */
function resumeOf(x: unknown): ClaudeResume | null {
  if (typeof x !== 'object' || x === null) return null
  const { sessionId, pinned } = x as Record<string, unknown>
  return isSessionId(sessionId) && typeof pinned === 'boolean' ? { sessionId, pinned } : null
}
const message = (err: unknown) => (err instanceof Error ? err.message : String(err))

export interface ClaudeIpcOptions {
  /** Where Claude's home is ($CLAUDE_CONFIG_DIR); tests pass their own. */
  env?: NodeJS.ProcessEnv
  /** Saves a copy of an image for Open (beside the clipboard's pasted images, cleared at start and
   *  quit); resolves with its path. Without it, Open says it can't. */
  saveImage?(bytes: Uint8Array, ext: TempImageExt): Promise<string>
  /** Opens a file in its default app: '' when it did, else why not (shell.openPath). */
  openPath?(path: string): Promise<string>
}

/** `claude:*` handlers. Read-only: Deck never writes to Claude's files. Images are read again from
 *  the log of the session a folder follows, and only those its feed lists. */
export function registerClaudeIpc(opts: ClaudeIpcOptions = {}): void {
  const env = opts.env ?? process.env
  const openPath = opts.openPath ?? ((path: string) => shell.openPath(path))
  const hub = new ClaudeSubscriptions({
    scan: (folder) => scanFolder(folder, env),
    open: (path) => new JsonlTail(path),
    steps: agentSteps,
    title: readTitle,
    watch: watchDirs,
    now: Date.now,
  })
  const pixels = new ImagePixels()

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

  ipcMain.handle(IPC.claudeSubscribe, (e, folder: unknown, resume: unknown): Promise<ClaudeSnapshot | null> | null =>
    isFolder(folder) ? hub.subscribe(client(e.sender), folder, resumeOf(resume)).catch(() => null) : null)
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
  ipcMain.handle(IPC.claudeImage, async (_e, folder: unknown, id: unknown, size: unknown): Promise<ClaudeImageData> => {
    if (!isFolder(folder) || !isImageId(id) || !isSize(size)) return { error: GONE }
    const source = hub.imageSource(folder, id)
    if (!source) return { error: GONE }
    return pixels.get(source, id, size) // never rejects
  })
  ipcMain.handle(IPC.claudeOpenImage, async (_e, folder: unknown, id: unknown): Promise<{ error: string } | null> => {
    if (!isFolder(folder) || !isImageId(id)) return { error: GONE }
    const source = hub.imageSource(folder, id)
    if (!source) return { error: GONE }
    const image = await pixels.bytes(source, id)
    if ('error' in image) return image
    if (!opts.saveImage) return { error: "Deck can't save a copy to open." }
    let file: string
    try {
      // Named by the bytes' own format, so only an image viewer ever opens it.
      file = await opts.saveImage(image.bytes, IMAGE_EXT[image.format])
    } catch (err) {
      return { error: `Couldn't save a copy to open: ${message(err)}` }
    }
    try {
      const problem = await openPath(file)
      return problem ? { error: `Couldn't open the copy: ${problem}` } : null
    } catch (err) {
      return { error: `Couldn't open the copy: ${message(err)}` }
    }
  })
}
