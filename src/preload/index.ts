import { contextBridge, ipcRenderer, webUtils, type IpcRendererEvent } from 'electron'
import { IPC } from '@shared/channels'
import type { ClaudeSnapshot, ClipboardPreview, DeckApi, GitSnapshot, MenuCommand, Platform, UsageState } from '@shared/types'

function on<A extends unknown[]>(channel: string, cb: (...args: A) => void): () => void {
  const listener = (_e: IpcRendererEvent, ...args: unknown[]) => cb(...(args as A))
  ipcRenderer.on(channel, listener)
  return () => ipcRenderer.removeListener(channel, listener)
}

const api: DeckApi = {
  platform: process.platform as Platform,
  pty: {
    create: (opts) => ipcRenderer.invoke(IPC.ptyCreate, opts),
    write: (id, data) => ipcRenderer.send(IPC.ptyWrite, id, data),
    resize: (id, cols, rows) => ipcRenderer.send(IPC.ptyResize, id, cols, rows),
    kill: (id) => ipcRenderer.send(IPC.ptyKill, id),
    ack: (id, chars) => ipcRenderer.send(IPC.ptyAck, id, chars),
    onData: (cb) => on<[string, string]>(IPC.ptyData, cb),
    onExit: (cb) => on<[string, number]>(IPC.ptyExit, cb),
    onProcess: (cb) => on<[string, string]>(IPC.ptyProcess, cb),
  },
  projects: {
    list: () => ipcRenderer.invoke(IPC.projectsList),
    status: (paths) => ipcRenderer.invoke(IPC.projectsStatus, paths),
    getConfig: () => ipcRenderer.invoke(IPC.projectsGetConfig),
    setConfig: (config) => ipcRenderer.invoke(IPC.projectsSetConfig, config),
    togglePin: (path) => ipcRenderer.invoke(IPC.projectsTogglePin, path),
    contextMenu: (path) => ipcRenderer.invoke(IPC.projectsContextMenu, path),
  },
  git: {
    subscribe: (repo) => ipcRenderer.invoke(IPC.gitSubscribe, repo),
    unsubscribe: (repo) => ipcRenderer.send(IPC.gitUnsubscribe, repo),
    onUpdate: (cb) => on<[string, GitSnapshot]>(IPC.gitUpdate, cb),
    logPage: (repo, skip, limit) => ipcRenderer.invoke(IPC.gitLogPage, repo, skip, limit),
    details: (repo, hash) => ipcRenderer.invoke(IPC.gitDetails, repo, hash),
    targets: (repo) => ipcRenderer.invoke(IPC.gitTargets, repo),
    setTarget: (repo, branch, target) => ipcRenderer.invoke(IPC.gitSetTarget, repo, branch, target),
  },
  claude: {
    subscribe: (folder, resume) => ipcRenderer.invoke(IPC.claudeSubscribe, folder, resume ?? null),
    unsubscribe: (folder) => ipcRenderer.send(IPC.claudeUnsubscribe, folder),
    onUpdate: (cb) => on<[string, ClaudeSnapshot | null]>(IPC.claudeUpdate, cb),
    sessions: (folder) => ipcRenderer.invoke(IPC.claudeSessions, folder),
    follow: (folder, sessionId) => ipcRenderer.invoke(IPC.claudeFollow, folder, sessionId),
  },
  clipboard: {
    current: () => ipcRenderer.invoke(IPC.clipboardCurrent),
    onItem: (cb) => on<[ClipboardPreview | null]>(IPC.clipboardItem, cb),
    add: (id) => ipcRenderer.invoke(IPC.clipboardAdd, id),
    paste: (opts) => ipcRenderer.invoke(IPC.clipboardPaste, opts),
    dismiss: (id) => ipcRenderer.send(IPC.clipboardDismiss, id),
  },
  usage: {
    get: () => ipcRenderer.invoke(IPC.usageGet),
    onChange: (cb) => on<[UsageState]>(IPC.usageChanged, cb),
    connect: (replace) => ipcRenderer.invoke(IPC.usageConnect, replace),
    disconnect: () => ipcRenderer.invoke(IPC.usageDisconnect),
  },
  app: {
    info: () => ipcRenderer.invoke(IPC.appInfo),
    openExternal: (url) => ipcRenderer.send(IPC.appOpenExternal, url),
    copyText: (text) => ipcRenderer.send(IPC.appCopyText, text),
    pathForFile: (file) => {
      try {
        return webUtils.getPathForFile(file)
      } catch {
        return '' // not a File; a File that isn't on disk gives '' without throwing
      }
    },
    onOpenFolder: (cb) => on<[string]>(IPC.appOpenFolder, cb),
    onMenu: (cb) => on<[MenuCommand]>(IPC.appMenu, cb),
    ready: () => ipcRenderer.send(IPC.appReady),
  },
}

// Every terminal tab listens on the pty channels; past 10 tabs EventEmitter
// would warn about a leak that isn't one.
ipcRenderer.setMaxListeners(0)

contextBridge.exposeInMainWorld('deck', api)
