import { execFile } from 'node:child_process'
import { statSync } from 'node:fs'
import { homedir, release } from 'node:os'
import { join, resolve } from 'node:path'
import { app, type BrowserWindow, clipboard, ipcMain, Menu, shell } from 'electron'
import { IPC } from '@shared/channels'
import type { AppInfo, PtyCreateOptions } from '@shared/types'
import { buildMenu } from './menu'
import { registerGitIpc } from './git/ipc'
import { folderFromArgv } from './open-args'
import { registerProjectsIpc } from './projects/ipc'
import { PtyManager } from './pty/manager'
import { installShellIntegration } from './shell/install'
import { shellLaunch } from './shell/launch'
import { createWindow } from './window'

let win: BrowserWindow | null = null
let rendererReady = false
const pendingFolders: string[] = []

function isDir(p: string): boolean {
  try {
    return statSync(p).isDirectory()
  } catch {
    return false
  }
}

function send(channel: string, ...args: unknown[]): void {
  if (win && !win.isDestroyed()) win.webContents.send(channel, ...args)
}

/** Open `folder` in a new shell tab once the renderer is listening. */
function openFolder(folder: string | null): void {
  if (!folder || !isDir(folder)) return
  if (rendererReady) send(IPC.appOpenFolder, folder)
  else pendingFolders.push(folder)
}

function hasPwsh(): Promise<boolean> {
  const where = join(process.env.SystemRoot ?? 'C:\\Windows', 'System32', 'where.exe')
  return new Promise((resolve) => execFile(where, ['pwsh'], { windowsHide: true }, (err) => resolve(!err)))
}

async function start(): Promise<void> {
  // Windows runs `git`, `pwsh` and the like from the current folder before PATH, and Explorer's
  // "Open in Deck" may start us in a folder someone downloaded. --open folders are resolved already.
  if (process.platform === 'win32') process.chdir(homedir())
  const userData = app.getPath('userData')
  const integrationDir = await installShellIntegration(join(userData, 'shell-integration'))
  const pwsh = process.platform === 'win32' && (await hasPwsh())

  const ptys = new PtyManager(
    () => shellLaunch({ platform: process.platform, env: process.env, integrationDir, appVersion: app.getVersion(), hasPwsh: pwsh }),
    {
      data: (id, data) => send(IPC.ptyData, id, data),
      exit: (id, code) => send(IPC.ptyExit, id, code),
      process: (id, name) => send(IPC.ptyProcess, id, name),
    },
  )

  // ipcMain.on listeners can't reject like handle() can: a throw there becomes an
  // error dialog, so arguments are checked first (the pty calls guard themselves).
  ipcMain.handle(IPC.ptyCreate, (_e, opts: PtyCreateOptions) =>
    ptys.create({ ...opts, cwd: typeof opts?.cwd === 'string' && isDir(opts.cwd) ? opts.cwd : homedir() }))
  ipcMain.on(IPC.ptyWrite, (_e, id: unknown, data: unknown) => {
    if (typeof id === 'string' && typeof data === 'string') ptys.write(id, data)
  })
  ipcMain.on(IPC.ptyResize, (_e, id: unknown, cols: unknown, rows: unknown) => {
    if (typeof id === 'string' && typeof cols === 'number' && typeof rows === 'number') ptys.resize(id, cols, rows)
  })
  ipcMain.on(IPC.ptyAck, (_e, id: unknown, chars: unknown) => {
    if (typeof id === 'string' && typeof chars === 'number') ptys.ack(id, chars)
  })
  ipcMain.on(IPC.ptyKill, (_e, id: unknown) => {
    if (typeof id === 'string') ptys.kill(id)
  })

  ipcMain.handle(IPC.appInfo, (): AppInfo => ({
    home: homedir(),
    version: app.getVersion(),
    windowsBuild: process.platform === 'win32' ? Number(release().split('.')[2]) || undefined : undefined,
  }))
  ipcMain.on(IPC.appOpenExternal, (_e, url: unknown) => {
    if (typeof url === 'string' && /^https?:\/\//i.test(url)) void shell.openExternal(url)
  })
  ipcMain.on(IPC.appCopyText, (_e, text: unknown) => {
    if (typeof text === 'string') clipboard.writeText(text)
  })
  ipcMain.handle(IPC.appReadText, () => clipboard.readText())
  ipcMain.on(IPC.appReady, () => {
    rendererReady = true
    for (const folder of pendingFolders.splice(0)) send(IPC.appOpenFolder, folder)
  })

  registerProjectsIpc({
    configFile: join(userData, 'projects.json'),
    home: homedir(),
    // First run takes over the WezTerm prototype's dashboard settings.
    importFrom: join(homedir(), '.config', 'wezterm', 'projects.json'),
  })

  registerGitIpc({ targetsFile: join(userData, 'git-targets.json') })

  Menu.setApplicationMenu(buildMenu((cmd) => send(IPC.appMenu, cmd)))
  win = createWindow()
  // A reload starts a fresh renderer whose tabs know nothing of the old shells.
  win.webContents.on('did-start-loading', () => {
    rendererReady = false
    ptys.killAll()
  })
  win.webContents.on('render-process-gone', () => ptys.killAll())
  win.on('closed', () => {
    ptys.killAll()
    win = null
  })
  app.on('before-quit', () => ptys.killAll())
}

// A stray error in the main process is logged, not shown as a modal dialog over
// every open terminal.
process.on('uncaughtException', (err) => console.error('main: uncaught exception', err))
process.on('unhandledRejection', (reason) => console.error('main: unhandled rejection', reason))

// Passed to the running instance as additionalData: the argv it receives can be
// reordered by Chromium, which separates `--open` from its folder.
const launchFolder = folderFromArgv(process.argv)
if (!app.requestSingleInstanceLock({ folder: launchFolder })) {
  app.quit()
} else {
  app.on('second-instance', (_e, argv, workingDirectory, data) => {
    if (win) {
      if (win.isMinimized()) win.restore()
      win.focus()
    }
    const folder = (data as { folder?: string | null } | null)?.folder ?? folderFromArgv(argv)
    openFolder(folder ? resolve(workingDirectory, folder) : null)
  })
  // macOS: a folder dropped on the Dock icon, or `open -a Deck <folder>`.
  app.on('open-file', (e, path) => {
    e.preventDefault()
    openFolder(path)
  })
  openFolder(launchFolder ? resolve(launchFolder) : null)
  app.on('window-all-closed', () => app.quit())
  void app.whenReady().then(start)
}
