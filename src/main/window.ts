import { join } from 'node:path'
import { BrowserWindow, shell } from 'electron'

const BACKGROUND = '#0E1022'
const CHROME = '#12142A'

export function createWindow(): BrowserWindow {
  const mac = process.platform === 'darwin'
  const win = new BrowserWindow({
    width: 1400,
    height: 900,
    minWidth: 800,
    minHeight: 500,
    show: false,
    backgroundColor: BACKGROUND,
    title: 'Deck',
    // Tabs live in the title bar: macOS keeps its traffic lights, Windows draws
    // its caption buttons over our tab bar.
    ...(mac
      ? { titleBarStyle: 'hiddenInset' as const, trafficLightPosition: { x: 14, y: 12 } }
      : process.platform === 'win32'
        ? { titleBarStyle: 'hidden' as const, titleBarOverlay: { color: CHROME, symbolColor: '#F4F5FB', height: 36 } }
        : { icon: join(__dirname, '../../build/icon.png') }),
    webPreferences: {
      preload: join(__dirname, '../preload/index.js'),
      contextIsolation: true,
      sandbox: true,
      nodeIntegration: false,
      spellcheck: false,
    },
  })

  win.once('ready-to-show', () => win.show())

  // No remote content: links open in the browser, the window never navigates.
  win.webContents.setWindowOpenHandler(({ url }) => {
    if (/^https?:\/\//i.test(url)) void shell.openExternal(url)
    return { action: 'deny' }
  })
  const devUrl = process.env.ELECTRON_RENDERER_URL
  win.webContents.on('will-navigate', (e, url) => {
    if (!devUrl || !url.startsWith(devUrl)) e.preventDefault()
  })

  if (devUrl) void win.loadURL(devUrl)
  else void win.loadFile(join(__dirname, '../renderer/index.html'))
  return win
}
