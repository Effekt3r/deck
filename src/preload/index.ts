import { contextBridge, ipcRenderer, type IpcRendererEvent } from 'electron'
import { IPC } from '@shared/channels'
import type { DeckApi, MenuCommand, Platform } from '@shared/types'

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
  app: {
    info: () => ipcRenderer.invoke(IPC.appInfo),
    openExternal: (url) => ipcRenderer.send(IPC.appOpenExternal, url),
    copyText: (text) => ipcRenderer.send(IPC.appCopyText, text),
    readText: () => ipcRenderer.invoke(IPC.appReadText),
    onOpenFolder: (cb) => on<[string]>(IPC.appOpenFolder, cb),
    onMenu: (cb) => on<[MenuCommand]>(IPC.appMenu, cb),
    ready: () => ipcRenderer.send(IPC.appReady),
  },
}

contextBridge.exposeInMainWorld('deck', api)
