import { app, Menu, type MenuItemConstructorOptions } from 'electron'
import type { MenuCommand } from '@shared/types'

/** The application menu as data; commands are handled by the renderer (`send`).
 *  macOS uses Cmd shortcuts. Windows/Linux use Ctrl+Shift so plain Ctrl keys
 *  (Ctrl+C, Ctrl+T, …) keep reaching the shell, and never Ctrl+Alt: that is
 *  AltGr on many layouts (German AltGr+7 types `{`). The terminal lets these
 *  keys through to the menu (terminal/keys.ts). */
export function menuTemplate(
  platform: NodeJS.Platform,
  send: (cmd: MenuCommand) => void,
  opts: { packaged: boolean },
): MenuItemConstructorOptions[] {
  const mac = platform === 'darwin'
  const key = (macKey: string, otherKey: string) => (mac ? macKey : otherKey)
  const item = (label: string, accelerator: string, cmd: MenuCommand, extra: MenuItemConstructorOptions = {}) =>
    ({ label, accelerator, click: () => send(cmd), ...extra }) satisfies MenuItemConstructorOptions

  const shellMenu: MenuItemConstructorOptions = {
    label: 'Shell',
    submenu: [
      item('New Tab', key('Cmd+T', 'Ctrl+Shift+T'), { type: 'new-tab' }),
      item('Close Tab', key('Cmd+W', 'Ctrl+Shift+W'), { type: 'close-tab' }),
      { type: 'separator' },
      item('Projects', key('Cmd+Shift+O', 'Ctrl+Shift+O'), { type: 'projects' }),
      ...(mac ? [] : [{ type: 'separator' as const }, { role: 'quit' as const }]),
    ],
  }

  // No copy/paste roles off macOS: their Ctrl+C/Ctrl+V accelerators would
  // swallow SIGINT and literal-next; the terminal handles Ctrl+Shift+C/V.
  const editMenu: MenuItemConstructorOptions = {
    label: 'Edit',
    submenu: [
      ...(mac
        ? ([
            { role: 'undo' }, { role: 'redo' }, { type: 'separator' },
            { role: 'cut' }, { role: 'copy' }, { role: 'paste' }, { role: 'selectAll' }, { type: 'separator' },
          ] satisfies MenuItemConstructorOptions[])
        : []),
      item('Find', key('Cmd+F', 'Ctrl+Shift+F'), { type: 'find' }),
    ],
  }

  const viewMenu: MenuItemConstructorOptions = {
    label: 'View',
    submenu: [
      item('Git Panel', key('Cmd+Shift+G', 'Ctrl+Shift+G'), { type: 'toggle-git' }),
      { type: 'separator' },
      ...(opts.packaged ? [] : ([{ role: 'reload' }, { role: 'toggleDevTools' }, { type: 'separator' }] satisfies MenuItemConstructorOptions[])),
      ...(mac ? ([{ role: 'resetZoom' }, { role: 'zoomIn' }, { role: 'zoomOut' }, { type: 'separator' }] satisfies MenuItemConstructorOptions[]) : []),
      { role: 'togglefullscreen' },
    ],
  }

  const windowMenu: MenuItemConstructorOptions = {
    label: 'Window',
    submenu: [
      item('Next Tab', key('Cmd+Shift+]', 'Ctrl+Tab'), { type: 'next-tab' }),
      item('Previous Tab', key('Cmd+Shift+[', 'Ctrl+Shift+Tab'), { type: 'prev-tab' }),
      { type: 'separator' },
      // Hidden on macOS (the accelerators still fire); listed elsewhere.
      ...Array.from({ length: 9 }, (_, i) =>
        item(i === 8 ? 'Last Tab' : `Tab ${i + 1}`, key(`Cmd+${i + 1}`, `Ctrl+Shift+${i + 1}`),
          { type: 'select-tab', index: i + 1 }, { visible: !mac })),
      ...(mac ? ([{ type: 'separator' }, { role: 'minimize' }, { role: 'zoom' }, { role: 'front' }] satisfies MenuItemConstructorOptions[]) : []),
    ],
  }

  return [...(mac ? [{ role: 'appMenu' as const }] : []), shellMenu, editMenu, viewMenu, windowMenu]
}

export function buildMenu(send: (cmd: MenuCommand) => void): Menu {
  return Menu.buildFromTemplate(menuTemplate(process.platform, send, { packaged: app.isPackaged }))
}
