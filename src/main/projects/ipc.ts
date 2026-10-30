import { BrowserWindow, Menu, clipboard, ipcMain, shell } from 'electron'
import { IPC } from '@shared/channels'
import type { ProjectAction } from '@shared/types'
import { isPinned, loadConfig, normalizeConfig, saveConfig, togglePinned } from './config'
import { scanProjects } from './scan'
import { projectStatus } from './status'

function folderArg(p: unknown): string {
  if (typeof p !== 'string' || !p) throw new TypeError('expected a folder path')
  return p
}

export function registerProjectsIpc(deps: { configFile: string; home: string; importFrom: string }): void {
  const { configFile, home, importFrom } = deps

  // One config read or write at a time, so two quick pin toggles can't save over each other.
  let queue: Promise<unknown> = Promise.resolve()
  const serial = <T>(fn: () => Promise<T>): Promise<T> => {
    const result = queue.then(fn)
    queue = result.catch(() => undefined)
    return result
  }
  const load = () => loadConfig(configFile, { importFrom })
  const togglePin = (path: string) => serial(async () => saveConfig(configFile, togglePinned(await load(), path, home)))

  ipcMain.handle(IPC.projectsList, async () => scanProjects(await serial(load), home))
  ipcMain.handle(IPC.projectsStatus, (_e, paths: unknown) =>
    projectStatus(Array.isArray(paths) ? paths.filter((p): p is string => typeof p === 'string') : []),
  )
  ipcMain.handle(IPC.projectsGetConfig, () => serial(load))
  ipcMain.handle(IPC.projectsSetConfig, (_e, config: unknown) =>
    serial(() => saveConfig(configFile, normalizeConfig(config))),
  )
  ipcMain.handle(IPC.projectsTogglePin, (_e, path: unknown) => togglePin(folderArg(path)))

  ipcMain.handle(IPC.projectsContextMenu, async (event, arg: unknown): Promise<ProjectAction | null> => {
    const path = folderArg(arg)
    const win = BrowserWindow.fromWebContents(event.sender)
    if (!win) return null
    const pinned = isPinned(await serial(load), path, home)
    return new Promise((resolve) => {
      let saving: Promise<unknown> = Promise.resolve()
      const menu = Menu.buildFromTemplate([
        { label: 'Open with Claude', click: () => resolve('claude') },
        { label: 'Open shell only', click: () => resolve('shell') },
        { type: 'separator' },
        {
          label: pinned ? 'Unpin' : 'Pin',
          click: () => {
            saving = togglePin(path).catch((err) => console.error('projects: pin failed', err))
          },
        },
        {
          label: process.platform === 'win32' ? 'Show in Explorer' : 'Reveal in Finder',
          click: () => shell.showItemInFolder(path),
        },
        { label: 'Copy path', click: () => clipboard.writeText(path) },
      ])
      // Electron runs the chosen item's click before this callback. Resolve only once a pin is
      // saved, so the refresh the renderer does next already sees it.
      menu.popup({ window: win, callback: () => void saving.then(() => resolve(null)) })
    })
  })
}
