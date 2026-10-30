# Deck M1 — Electron shell Implementation Plan

> **For agentic workers:** REQUIRED SUB-SKILL: Use superpowers:subagent-driven-development (recommended) or superpowers:executing-plans to implement this plan task-by-task. Steps use checkbox (`- [ ]`) syntax for tracking.

**Goal:** A Deck desktop app with a fixed Projects tab plus terminal tabs (xterm.js + node-pty) that get shell integration automatically, on macOS and Windows: milestone M1 in `docs/DECK.md`.

**Architecture:** electron-vite builds three targets. The main process owns ptys, the shell-integration files, projects config/scan and native menus. The renderer (React, sandboxed, no Node) owns tab state and xterm instances and reaches main only through the typed `window.deck` bridge from `src/preload`. Anything that can be pure lives in a small module with a vitest file next to it.

**Tech Stack:** Node 22, Electron 45, electron-vite 6, Vite 8, React 19, TypeScript 7, @xterm/xterm 6 (+ fit, webgl, unicode11, search, web-links), node-pty 1.1 (N-API prebuilds), vitest 5, electron-builder 26.

## Ground rules (read `CLAUDE.md` first)

- Everything must work on **macOS (Apple silicon) and Windows 11**. Branch on `process.platform` (main) or `window.deck.platform` (renderer); never hard-code `/` paths or Mac keys in shared code.
- Renderer: `contextIsolation: true`, `sandbox: true`, `nodeIntegration: false`, strict CSP, no remote content.
- Git calls set `GIT_OPTIONAL_LOCKS=0`.
- Never copy real `~/.claude` session logs into the repo (they hold client code and prompts).
- Use Node 22 for every npm/npx command: `export PATH="$HOME/.nvm/versions/node/v22.19.0/bin:$PATH"` (the default nvm node, 20.11, is too old for Vite 8).
- Work on branch `m1-electron-shell`. Implementer subagents do **not** commit; the coordinating session reviews and commits each task as `Franco Landman <franco@effektstudios.com>` (`git -c user.email=franco@effektstudios.com commit`), no `Co-Authored-By`, ending with the session's `Claude-Session:` line.
- The WezTerm prototype (`*.py`, `wezterm.lua`, `install.*`) stays untouched and working.

## Spec coverage (DECK.md → M1)

| Requirement | Task |
|---|---|
| Projects tab first, can't be closed | 8 |
| Pinned folders, then repos under scan roots, newest activity first | 5, 9 |
| Name, branch, dirty state, last activity, "open" marker | 5, 9 |
| Double-click → new tab in the folder running the command | 9, 8 |
| Context menu: open shell only, pin/unpin, reveal, copy path | 5, 9 |
| Filter box; settings for command, scan roots, depth | 9 |
| xterm.js with WebGL, Unicode 11, search, links, 50k scrollback | 7 |
| Shell integration without editing dotfiles (zsh `ZDOTDIR`, PowerShell `-NoExit -Command`) | 3 |
| OSC 7 + OSC 1337 SetUserVar parsed via `registerOscHandler` | 7 |
| Shift+Enter → `ESC CR` | 7 |
| Tab title: repo + Claude's title while Claude runs, else branch | 8 |
| "Open in Deck" (`--open <folder>` from the NSIS menu, macOS open-file) | 6 |

Out of scope: git panel (M2), Claude panel (M3), signing (M4), notifications, auto-update and general settings (M5).

## File structure

| Path | Responsibility |
|---|---|
| `.nvmrc`, `package.json`, `package-lock.json` | Node 22, scripts, dependencies |
| `electron.vite.config.ts` | main / preload / renderer builds |
| `tsconfig.json`, `tsconfig.node.json`, `tsconfig.web.json` | typecheck projects (node side, web side) |
| `vitest.config.ts` | unit tests (`src/**/*.test.ts`, node environment) |
| `src/shared/types.ts` | IPC contract types, `DeckApi` |
| `src/shared/channels.ts` | IPC channel names |
| `src/preload/index.ts` | `contextBridge` → `window.deck` |
| `src/main/index.ts` | app lifecycle, single instance, IPC registration |
| `src/main/window.ts` | `BrowserWindow` with security settings and per-platform title bar |
| `src/main/menu.ts` | application menu, platform shortcuts → `MenuCommand` |
| `src/main/open-args.ts` | `--open <folder>` parsing |
| `src/main/shell/launch.ts` | which shell, which args, which env (pure) |
| `src/main/shell/install.ts` | writes the integration scripts into userData |
| `src/main/shell/scripts/zsh/{zshenv,zprofile,zshrc,zlogin}` | ZDOTDIR wrappers (installed with a leading dot) |
| `src/main/shell/scripts/zsh/deck.zsh`, `src/main/shell/scripts/pwsh/deck.ps1` | prompt hooks |
| `src/main/pty/batcher.ts` | coalesces pty output per tab before IPC |
| `src/main/pty/startup-command.ts` | types the tab's command after the first prompt |
| `src/main/pty/manager.ts` | node-pty sessions per tab |
| `src/main/projects/config.ts` | `projects.json` in userData, defaults, prototype import |
| `src/main/projects/git-head.ts` | branch from `.git/HEAD` (worktrees too) |
| `src/main/projects/scan.ts` | the project list (port of `project_dashboard.py`) |
| `src/main/projects/status.ts` | dirty counts via `git status` |
| `src/main/projects/ipc.ts` | `projects:*` handlers + native context menu |
| `src/renderer/index.html` | CSP, root element |
| `src/renderer/src/main.tsx`, `App.tsx`, `styles.css` | app shell, layout |
| `src/renderer/src/env.d.ts` | `window.deck` typing |
| `src/renderer/src/tabs/{tabs.ts,title.ts,TabBar.tsx}` | tab model, tab titles, tab bar |
| `src/renderer/src/terminal/{osc.ts,keys.ts,theme.ts,TerminalView.tsx,SearchBar.tsx}` | terminal |
| `src/renderer/src/projects/{filter.ts,ProjectsView.tsx,Settings.tsx}` | Projects tab |

Unit tests live next to their module as `*.test.ts`.

## Execution waves

- **Wave 1 (alone):** Task 1, Task 2.
- **Wave 2 (in parallel, disjoint files):** Agent A: Tasks 3 → 4. Agent B: Task 5. Agent C: Tasks 7 → 8 → 9.
- **Wave 3:** Task 6 (main wiring needs 3, 4, 5), then Task 10 (real-app verification, docs).

No one but Task 1 edits `package.json`; every dependency is installed up front.

---

### Task 1: Tooling scaffold

**Files:**
- Create: `.nvmrc`, `package.json`, `electron.vite.config.ts`, `tsconfig.json`, `tsconfig.node.json`, `tsconfig.web.json`, `vitest.config.ts`, `src/main/index.ts` (temporary), `src/preload/index.ts` (temporary), `src/renderer/index.html`, `src/renderer/src/main.tsx` (temporary)
- Modify: `.gitignore`

- [ ] **Step 1: Branch and Node**

```bash
git switch -c m1-electron-shell
echo 22 > .nvmrc
export PATH="$HOME/.nvm/versions/node/v22.19.0/bin:$PATH"; node --version   # v22.19.0
```

- [ ] **Step 2: package.json**

```json
{
  "name": "deck",
  "productName": "Deck",
  "version": "0.1.0",
  "description": "A terminal built around Claude Code: every project in a tab, its git history on the left and what Claude is doing on the right.",
  "author": "Effekt Studios",
  "private": true,
  "main": "./out/main/index.js",
  "engines": { "node": ">=22.12" },
  "scripts": {
    "dev": "electron-vite dev",
    "build": "electron-vite build",
    "start": "electron-vite preview",
    "test": "vitest run",
    "typecheck": "tsc -p tsconfig.node.json --noEmit && tsc -p tsconfig.web.json --noEmit",
    "dist": "npm run build && electron-builder",
    "dist:mac": "npm run build && electron-builder --mac",
    "dist:win": "npm run build && electron-builder --win"
  }
}
```

Then install (versions current on 2026-10-30):

```bash
npm install node-pty@^1.1.0
npm install -D electron@^45.2.0 electron-vite@^6.0.0 electron-builder@^26.18.0 vite@^8.3.5 \
  @vitejs/plugin-react@^6.1.2 react@^19.3.1 react-dom@^19.3.1 typescript@^7.0.2 vitest@^5.0.5 \
  @types/node@^26.6.6 @types/react@^19.3.0 @types/react-dom@^19.3.0 \
  @xterm/xterm@^6.0.0 @xterm/addon-fit@^0.11.0 @xterm/addon-webgl@^0.19.0 \
  @xterm/addon-unicode11@^0.9.0 @xterm/addon-search@^0.16.0 @xterm/addon-web-links@^0.12.0
```

- [ ] **Step 3: Build and test config**

`electron.vite.config.ts`:

```ts
import { resolve } from 'node:path'
import { defineConfig, externalizeDepsPlugin } from 'electron-vite'
import react from '@vitejs/plugin-react'

export default defineConfig({
  main: {
    plugins: [externalizeDepsPlugin()],
    resolve: { alias: { '@shared': resolve('src/shared') } },
  },
  preload: {
    plugins: [externalizeDepsPlugin()],
    resolve: { alias: { '@shared': resolve('src/shared') } },
  },
  renderer: {
    plugins: [react()],
    resolve: { alias: { '@shared': resolve('src/shared') } },
  },
})
```

`tsconfig.json`:

```json
{ "files": [], "references": [{ "path": "./tsconfig.node.json" }, { "path": "./tsconfig.web.json" }] }
```

`tsconfig.node.json`:

```json
{
  "compilerOptions": {
    "target": "ES2023", "module": "ESNext", "moduleResolution": "Bundler",
    "strict": true, "skipLibCheck": true, "isolatedModules": true, "noEmit": true,
    "types": ["node", "vite/client"], "lib": ["ES2023"],
    "paths": { "@shared/*": ["./src/shared/*"] }
  },
  "include": ["electron.vite.config.ts", "vitest.config.ts", "src/main/**/*", "src/preload/**/*", "src/shared/**/*"]
}
```

`tsconfig.web.json`:

```json
{
  "compilerOptions": {
    "target": "ES2023", "module": "ESNext", "moduleResolution": "Bundler", "jsx": "react-jsx",
    "strict": true, "skipLibCheck": true, "isolatedModules": true, "noEmit": true,
    "lib": ["ES2023", "DOM", "DOM.Iterable"], "types": ["vite/client"],
    "paths": { "@shared/*": ["./src/shared/*"] }
  },
  "include": ["src/renderer/**/*", "src/shared/**/*"]
}
```

`vitest.config.ts`:

```ts
import { resolve } from 'node:path'
import { defineConfig } from 'vitest/config'

export default defineConfig({
  resolve: { alias: { '@shared': resolve('src/shared') } },
  test: { include: ['src/**/*.test.ts'], environment: 'node', passWithNoTests: true },
})
```

- [ ] **Step 4: Temporary entry points** (replaced in Tasks 2, 6, 8)

`src/main/index.ts`:

```ts
import { join } from 'node:path'
import { app, BrowserWindow } from 'electron'

app.whenReady().then(() => {
  const win = new BrowserWindow({
    width: 1000, height: 700,
    webPreferences: { preload: join(__dirname, '../preload/index.js'), sandbox: true, contextIsolation: true },
  })
  if (process.env.ELECTRON_RENDERER_URL) win.loadURL(process.env.ELECTRON_RENDERER_URL)
  else win.loadFile(join(__dirname, '../renderer/index.html'))
})
app.on('window-all-closed', () => app.quit())
```

`src/preload/index.ts`: `export {}`

`src/renderer/index.html`:

```html
<!doctype html>
<html lang="en">
  <head>
    <meta charset="UTF-8" />
    <meta http-equiv="Content-Security-Policy"
      content="default-src 'self'; script-src 'self'; style-src 'self' 'unsafe-inline'; img-src 'self' data:; font-src 'self' data:; object-src 'none'; base-uri 'none'" />
    <title>Deck</title>
  </head>
  <body>
    <div id="root"></div>
    <script type="module" src="./src/main.tsx"></script>
  </body>
</html>
```

`src/renderer/src/main.tsx`: `document.getElementById('root')!.textContent = 'Deck'`

- [ ] **Step 5: .gitignore** — append `node_modules/`, `out/`, `dist/`.

- [ ] **Step 6: Verify**

```bash
npm run typecheck && npm test && npm run build && ls out/main/index.js out/preload/index.js out/renderer/index.html
node -e "require('node-pty')" && echo node-pty loads   # N-API prebuild, no rebuild
```

Expected: all succeed. Then `npm run dev` opens a window that says "Deck" (close it).

- [ ] **Step 7: Commit** — `M1: scaffold the Electron app (electron-vite, React, vitest)`.

---

### Task 2: IPC contract and preload bridge

**Files:**
- Create: `src/shared/types.ts`, `src/shared/channels.ts`, `src/renderer/src/env.d.ts`
- Replace: `src/preload/index.ts`

- [ ] **Step 1: `src/shared/types.ts`**

```ts
export type Platform = 'darwin' | 'win32' | 'linux'

/** projects.json in the app's userData folder. */
export interface ProjectsConfig {
  /** Typed into a new tab opened with "Claude", e.g. `claude --effort max …`. */
  command: string
  /** Folders always listed first, in this order (absolute or `~/…`). */
  pinned: string[]
  /** Folders whose sub-folders and git repos are listed. */
  scan: string[]
  /** How deep to look for git repos under each scan folder (1 = direct children). */
  depth: number
}

export interface ProjectItem {
  /** Absolute, normalised path. */
  path: string
  name: string
  /** Branch name; short sha when detached; '?' for an unreadable worktree pointer; null when not a git repo. */
  branch: string | null
  pinned: boolean
  /** ms since epoch: newest of .git/index, .git/HEAD, .git/FETCH_HEAD and the folder itself. */
  activity: number
}

export interface ProjectStatus {
  path: string
  /** Staged or modified paths. */
  changed: number
  untracked: number
  conflicts: number
}

export interface PtyCreateOptions {
  /** Absolute folder the shell starts in. */
  cwd: string
  /** Typed into the shell (followed by Enter) once its first prompt appears. */
  command?: string
  cols: number
  rows: number
}

export interface PtyInfo {
  id: string
  /** Shell executable, e.g. /bin/zsh or pwsh.exe. */
  shell: string
  pid: number
}

export type MenuCommand =
  | { type: 'new-tab' }
  | { type: 'close-tab' }
  | { type: 'next-tab' }
  | { type: 'prev-tab' }
  | { type: 'select-tab'; index: number } // 1-based, 9 = last tab
  | { type: 'projects' }
  | { type: 'find' }

export type ProjectAction = 'claude' | 'shell'

export interface AppInfo {
  home: string
  version: string
}

export interface DeckApi {
  platform: Platform
  pty: {
    create(opts: PtyCreateOptions): Promise<PtyInfo>
    write(id: string, data: string): void
    resize(id: string, cols: number, rows: number): void
    kill(id: string): void
    onData(cb: (id: string, data: string) => void): () => void
    onExit(cb: (id: string, exitCode: number) => void): () => void
    /** The pty's foreground process changed (e.g. 'zsh' → 'claude'). */
    onProcess(cb: (id: string, name: string) => void): () => void
  }
  projects: {
    list(): Promise<ProjectItem[]>
    status(paths: string[]): Promise<ProjectStatus[]>
    getConfig(): Promise<ProjectsConfig>
    setConfig(config: ProjectsConfig): Promise<ProjectsConfig>
    togglePin(path: string): Promise<ProjectsConfig>
    /** Native context menu. Pin, reveal and copy are handled in main; open choices come back. */
    contextMenu(path: string): Promise<ProjectAction | null>
  }
  app: {
    info(): Promise<AppInfo>
    openExternal(url: string): void
    copyText(text: string): void
    readText(): Promise<string>
    /** A folder to open in a new shell tab: --open, macOS open-file, second launch. */
    onOpenFolder(cb: (path: string) => void): () => void
    onMenu(cb: (cmd: MenuCommand) => void): () => void
    /** Renderer is listening; main then delivers queued folders. */
    ready(): void
  }
}
```

- [ ] **Step 2: `src/shared/channels.ts`**

```ts
export const IPC = {
  ptyCreate: 'pty:create',
  ptyWrite: 'pty:write',
  ptyResize: 'pty:resize',
  ptyKill: 'pty:kill',
  ptyData: 'pty:data',
  ptyExit: 'pty:exit',
  ptyProcess: 'pty:process',
  projectsList: 'projects:list',
  projectsStatus: 'projects:status',
  projectsGetConfig: 'projects:get-config',
  projectsSetConfig: 'projects:set-config',
  projectsTogglePin: 'projects:toggle-pin',
  projectsContextMenu: 'projects:context-menu',
  appInfo: 'app:info',
  appOpenExternal: 'app:open-external',
  appCopyText: 'app:copy-text',
  appReadText: 'app:read-text',
  appOpenFolder: 'app:open-folder',
  appMenu: 'app:menu',
  appReady: 'app:ready',
} as const
```

- [ ] **Step 3: `src/preload/index.ts`**

```ts
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
```

- [ ] **Step 4: `src/renderer/src/env.d.ts`**

```ts
/// <reference types="vite/client" />
import type { DeckApi } from '@shared/types'

declare global {
  interface Window {
    deck: DeckApi
  }
}
```

- [ ] **Step 5: Verify** — `npm run typecheck && npm run build` pass.

- [ ] **Step 6: Commit** — `M1: typed IPC contract and preload bridge`.

---

### Task 3: Shell integration

Shells get Deck's hooks without the user's dotfiles changing. zsh: `ZDOTDIR` points at wrapper files that load the user's own files (from `DECK_USER_ZDOTDIR`) and then the hook. PowerShell: `-NoExit -Command ". '<hook>'"` runs after the profile. The hook is a port of `wezterm-git.zsh` / `wezterm-git.ps1` without the `TERM_PROGRAM` guard.

**Files:**
- Create: `src/main/shell/launch.ts`, `src/main/shell/launch.test.ts`, `src/main/shell/install.ts`, `src/main/shell/install.test.ts`, `src/main/shell/scripts/zsh/{zshenv,zprofile,zshrc,zlogin,deck.zsh}`, `src/main/shell/scripts/pwsh/deck.ps1`

**Interface (Task 4 depends on it):**

```ts
export interface ShellLaunch { file: string; args: string[]; env: Record<string, string> }
export interface ShellLaunchOptions {
  platform: NodeJS.Platform
  env: Record<string, string | undefined>
  /** Folder installShellIntegration() wrote to (has zsh/ and pwsh/). */
  integrationDir: string
  appVersion: string
  /** Windows: pwsh.exe is on PATH. */
  hasPwsh?: boolean
}
export const SCRUBBED_ENV: readonly string[]
export function shellLaunch(opts: ShellLaunchOptions): ShellLaunch
export function installShellIntegration(dir: string): Promise<string>   // returns dir
```

- [ ] **Step 1: Write the failing tests** — `src/main/shell/launch.test.ts`:

```ts
import { describe, expect, it } from 'vitest'
import { shellLaunch } from './launch'

const mac = { HOME: '/Users/f', PATH: '/usr/bin:/bin', SHELL: '/bin/zsh' }
const opts = { integrationDir: '/data/shell', appVersion: '0.1.0' }

describe('shellLaunch on macOS', () => {
  it('starts zsh as a login shell reading the wrappers', () => {
    const l = shellLaunch({ platform: 'darwin', env: mac, ...opts })
    expect(l.file).toBe('/bin/zsh')
    expect(l.args).toEqual(['-l'])
    expect(l.env.ZDOTDIR).toBe('/data/shell/zsh')
    expect(l.env.DECK_USER_ZDOTDIR).toBe('/Users/f')
    expect(l.env).toMatchObject({ TERM: 'xterm-256color', COLORTERM: 'truecolor', TERM_PROGRAM: 'Deck', TERM_PROGRAM_VERSION: '0.1.0' })
    expect(l.env.PATH).toBe('/usr/bin:/bin')
  })
  it('remembers a ZDOTDIR the user already had', () => {
    const l = shellLaunch({ platform: 'darwin', env: { ...mac, ZDOTDIR: '/Users/f/.config/zsh' }, ...opts })
    expect(l.env.DECK_USER_ZDOTDIR).toBe('/Users/f/.config/zsh')
  })
  it('adds a UTF-8 locale only when none is set', () => {
    expect(shellLaunch({ platform: 'darwin', env: mac, ...opts }).env.LANG).toBe('en_US.UTF-8')
    expect(shellLaunch({ platform: 'darwin', env: { ...mac, LANG: 'af_ZA.UTF-8' }, ...opts }).env.LANG).toBe('af_ZA.UTF-8')
    expect(shellLaunch({ platform: 'darwin', env: { ...mac, LC_ALL: 'C.UTF-8' }, ...opts }).env.LANG).toBeUndefined()
  })
  it('falls back to /bin/zsh without SHELL', () => {
    const { SHELL: _, ...env } = mac
    expect(shellLaunch({ platform: 'darwin', env, ...opts }).file).toBe('/bin/zsh')
  })
  it('runs other shells as plain login shells', () => {
    const l = shellLaunch({ platform: 'darwin', env: { ...mac, SHELL: '/opt/homebrew/bin/fish' }, ...opts })
    expect(l.file).toBe('/opt/homebrew/bin/fish')
    expect(l.args).toEqual(['-l'])
    expect(l.env.ZDOTDIR).toBeUndefined()
  })
  it('drops variables that tie a shell to a parent Claude Code session or Electron', () => {
    const env = { ...mac, CLAUDECODE: '1', CLAUDE_CODE_SESSION_ID: 'x', CLAUDE_CODE_MESSAGING_TOKEN: 't',
      AI_AGENT: 'claude-code', ELECTRON_RUN_AS_NODE: '1', CLAUDE_CODE_USE_BEDROCK: '1' }
    const l = shellLaunch({ platform: 'darwin', env, ...opts })
    expect(l.env.CLAUDECODE).toBeUndefined()
    expect(l.env.CLAUDE_CODE_SESSION_ID).toBeUndefined()
    expect(l.env.CLAUDE_CODE_MESSAGING_TOKEN).toBeUndefined()
    expect(l.env.AI_AGENT).toBeUndefined()
    expect(l.env.ELECTRON_RUN_AS_NODE).toBeUndefined()
    expect(l.env.CLAUDE_CODE_USE_BEDROCK).toBe('1') // user configuration stays
  })
})

describe('shellLaunch on Windows', () => {
  const win = { USERPROFILE: 'C:\\Users\\f', Path: 'C:\\Windows' }
  const wopts = { integrationDir: 'C:\\data\\shell', appVersion: '0.1.0' }
  it('starts PowerShell 7 with the hook when pwsh exists', () => {
    const l = shellLaunch({ platform: 'win32', env: win, ...wopts, hasPwsh: true })
    expect(l.file).toBe('pwsh.exe')
    expect(l.args).toEqual(['-NoLogo', '-NoExit', '-Command', ". 'C:\\data\\shell\\pwsh\\deck.ps1'"])
    expect(l.env.TERM_PROGRAM).toBe('Deck')
    expect(l.env.Path).toBe('C:\\Windows')
    expect(l.env.LANG).toBeUndefined()
  })
  it('falls back to Windows PowerShell', () => {
    expect(shellLaunch({ platform: 'win32', env: win, ...wopts, hasPwsh: false }).file).toBe('powershell.exe')
  })
  it('escapes single quotes in the hook path', () => {
    const l = shellLaunch({ platform: 'win32', env: win, integrationDir: "C:\\Users\\O'Neil\\shell", appVersion: '0.1.0' })
    expect(l.args[3]).toBe(". 'C:\\Users\\O''Neil\\shell\\pwsh\\deck.ps1'")
  })
})
```

`src/main/shell/install.test.ts`:

```ts
import { execFileSync } from 'node:child_process'
import { existsSync, mkdirSync, mkdtempSync, readFileSync, writeFileSync } from 'node:fs'
import { tmpdir } from 'node:os'
import { join } from 'node:path'
import { describe, expect, it } from 'vitest'
import { installShellIntegration } from './install'
import { shellLaunch } from './launch'

const hasZsh = process.platform !== 'win32' && existsSync('/bin/zsh')

describe('installShellIntegration', () => {
  it('writes the zsh wrappers, the zsh hook and the PowerShell hook', async () => {
    const dir = mkdtempSync(join(tmpdir(), 'deck-shell-'))
    await installShellIntegration(dir)
    for (const f of ['zsh/.zshenv', 'zsh/.zprofile', 'zsh/.zshrc', 'zsh/.zlogin', 'zsh/deck.zsh', 'pwsh/deck.ps1']) {
      expect(existsSync(join(dir, f)), f).toBe(true)
    }
    expect(readFileSync(join(dir, 'zsh/deck.zsh'), 'utf8')).toContain('SetUserVar')
    expect(readFileSync(join(dir, 'pwsh/deck.ps1'), 'utf8')).toContain('SetUserVar')
    await installShellIntegration(dir) // idempotent
  })

  it.skipIf(!hasZsh)('loads the user files, the hook, and restores ZDOTDIR', async () => {
    const dir = mkdtempSync(join(tmpdir(), 'deck-shell-'))
    const home = mkdtempSync(join(tmpdir(), 'deck-home-'))
    mkdirSync(join(home, 'zd'))
    writeFileSync(join(home, '.zshenv'), 'export ZDOTDIR="$HOME/zd"\n')         // user moves ZDOTDIR
    writeFileSync(join(home, 'zd', '.zshrc'), 'export DECK_TEST_RC=loaded\n')
    await installShellIntegration(dir)
    const l = shellLaunch({ platform: 'darwin', env: { HOME: home, PATH: '/usr/bin:/bin', SHELL: '/bin/zsh' }, integrationDir: dir, appVersion: 't' })
    const out = execFileSync(l.file, ['-i', '-c', 'print -r -- "$DECK_TEST_RC|$ZDOTDIR|$(whence -w __deck_precmd)"'],
      { env: l.env, encoding: 'utf8' })
    expect(out.trim().split('\n').pop()).toBe(`loaded|${join(home, 'zd')}|__deck_precmd: function`)
  })
})
```

- [ ] **Step 2: Run them to verify they fail** — `npx vitest run src/main/shell` → FAIL (`./launch` not found).

- [ ] **Step 3: The scripts**

`src/main/shell/scripts/zsh/zshenv` (installed as `.zshenv`; the other wrappers follow the same pattern):

```zsh
# Deck shell integration. ZDOTDIR points at this folder so zsh reads these
# wrappers; each loads the user's own file from DECK_USER_ZDOTDIR.
DECK_ZDOTDIR=$ZDOTDIR
if [[ -f "$DECK_USER_ZDOTDIR/.zshenv" ]]; then
  ZDOTDIR=$DECK_USER_ZDOTDIR
  . "$DECK_USER_ZDOTDIR/.zshenv"
  DECK_USER_ZDOTDIR=$ZDOTDIR   # the user's .zshenv may move ZDOTDIR
  ZDOTDIR=$DECK_ZDOTDIR
fi
```

`zprofile`:

```zsh
if [[ -f "$DECK_USER_ZDOTDIR/.zprofile" ]]; then
  ZDOTDIR=$DECK_USER_ZDOTDIR
  . "$DECK_USER_ZDOTDIR/.zprofile"
  DECK_USER_ZDOTDIR=$ZDOTDIR
  ZDOTDIR=$DECK_ZDOTDIR
fi
```

`zshrc`:

```zsh
# /etc/zshrc set HISTFILE from ZDOTDIR, i.e. into this folder: point it home.
[[ $HISTFILE == "$DECK_ZDOTDIR"/* ]] && HISTFILE="$DECK_USER_ZDOTDIR/.zsh_history"
if [[ -f "$DECK_USER_ZDOTDIR/.zshrc" ]]; then
  ZDOTDIR=$DECK_USER_ZDOTDIR
  . "$DECK_USER_ZDOTDIR/.zshrc"
  DECK_USER_ZDOTDIR=$ZDOTDIR
  ZDOTDIR=$DECK_ZDOTDIR
fi
. "$DECK_ZDOTDIR/deck.zsh"
# Non-login shells never read .zlogin, so hand ZDOTDIR back now.
[[ -o login ]] || { ZDOTDIR=$DECK_USER_ZDOTDIR; unset DECK_ZDOTDIR DECK_USER_ZDOTDIR; }
```

`zlogin`:

```zsh
ZDOTDIR=$DECK_USER_ZDOTDIR
[[ -f "$ZDOTDIR/.zlogin" ]] && . "$ZDOTDIR/.zlogin"
unset DECK_ZDOTDIR DECK_USER_ZDOTDIR
```

`deck.zsh`:

```zsh
# Deck: at every prompt, report the cwd (OSC 7) and the git repo and branch
# (OSC 1337 SetUserVar). Same protocol as the WezTerm prototype.
__deck_setvar() {
  printf '\033]1337;SetUserVar=%s=%s\007' "$1" "$(printf '%s' "$2" | base64 | tr -d '\n')"
}
__deck_precmd() {
  local root branch
  root=$(git rev-parse --show-toplevel 2>/dev/null)
  if [[ -n $root ]]; then
    branch=$(git branch --show-current 2>/dev/null)
    [[ -z $branch ]] && branch=$(git rev-parse --short HEAD 2>/dev/null)
  fi
  __deck_setvar GIT_REPO "$root"
  __deck_setvar GIT_BRANCH "$branch"
  printf '\033]7;file://%s%s\033\\' "${HOST:-localhost}" "${${PWD//\%/%25}// /%20}"
}
autoload -Uz add-zsh-hook
add-zsh-hook precmd __deck_precmd
```

`src/main/shell/scripts/pwsh/deck.ps1`:

```powershell
# Deck: at every prompt, report the cwd (OSC 7) and the git repo and branch
# (OSC 1337 SetUserVar). Dot-sourced after the user's profile.
function global:__DeckSetVar([string]$Name, [string]$Value) {
  $b64 = [Convert]::ToBase64String([Text.Encoding]::UTF8.GetBytes($Value))
  [Console]::Write("$([char]27)]1337;SetUserVar=$Name=$b64$([char]7)")
}

if (-not $global:__DeckOrigPrompt) { $global:__DeckOrigPrompt = $function:prompt }

function global:prompt {
  $code = $global:LASTEXITCODE
  $root = ''; $branch = ''
  if (Get-Command git -ErrorAction SilentlyContinue) {
    $root = (git rev-parse --show-toplevel 2>$null)
    if ($root) {
      $branch = (git branch --show-current 2>$null)
      if (-not $branch) { $branch = (git rev-parse --short HEAD 2>$null) }
    }
  }
  __DeckSetVar 'GIT_REPO' "$root"
  __DeckSetVar 'GIT_BRANCH' "$branch"
  $p = ($PWD.ProviderPath -replace '\\', '/') -replace ' ', '%20'
  [Console]::Write("$([char]27)]7;file://$env:COMPUTERNAME/$p$([char]27)\")
  $global:LASTEXITCODE = $code
  & $global:__DeckOrigPrompt
}
```

- [ ] **Step 4: `src/main/shell/launch.ts`**

```ts
import { posix, win32 } from 'node:path'

export interface ShellLaunch { file: string; args: string[]; env: Record<string, string> }
export interface ShellLaunchOptions {
  platform: NodeJS.Platform
  env: Record<string, string | undefined>
  integrationDir: string
  appVersion: string
  hasPwsh?: boolean
}

/** Set by a parent Claude Code session or by Electron; they must not leak into
 *  shells, or a `claude` started in Deck acts as that session's child. */
export const SCRUBBED_ENV = [
  'CLAUDECODE', 'CLAUDE_CODE_SESSION_ID', 'CLAUDE_CODE_BRIDGE_SESSION_ID', 'CLAUDE_CODE_CHILD_SESSION',
  'CLAUDE_CODE_ENTRYPOINT', 'CLAUDE_CODE_EXECPATH', 'CLAUDE_CODE_MESSAGING_SOCKET', 'CLAUDE_CODE_MESSAGING_TOKEN',
  'CLAUDE_CODE_SESSION_ATTENDED', 'CLAUDE_PID', 'CLAUDE_EFFORT', 'AI_AGENT',
  'ELECTRON_RUN_AS_NODE', 'ELECTRON_NO_ATTACH_CONSOLE',
] as const

export function shellLaunch(o: ShellLaunchOptions): ShellLaunch {
  const env: Record<string, string> = {}
  for (const [k, v] of Object.entries(o.env)) {
    if (v !== undefined && !(SCRUBBED_ENV as readonly string[]).includes(k)) env[k] = v
  }
  Object.assign(env, { TERM: 'xterm-256color', COLORTERM: 'truecolor', TERM_PROGRAM: 'Deck', TERM_PROGRAM_VERSION: o.appVersion })

  if (o.platform === 'win32') {
    const hook = win32.join(o.integrationDir, 'pwsh', 'deck.ps1').replace(/'/g, "''")
    return { file: o.hasPwsh ? 'pwsh.exe' : 'powershell.exe', args: ['-NoLogo', '-NoExit', '-Command', `. '${hook}'`], env }
  }

  if (!env.LANG && !env.LC_ALL && !env.LC_CTYPE) env.LANG = 'en_US.UTF-8' // GUI apps start without a locale
  const file = env.SHELL || (o.platform === 'darwin' ? '/bin/zsh' : '/bin/bash')
  if (posix.basename(file) === 'zsh') {
    env.DECK_USER_ZDOTDIR = env.ZDOTDIR || env.HOME || ''
    env.ZDOTDIR = posix.join(o.integrationDir, 'zsh')
  }
  return { file, args: ['-l'], env }
}
```

- [ ] **Step 5: `src/main/shell/install.ts`** — import each script with Vite's `?raw` suffix (bundled as strings, so nothing extra to package), write `zsh/.zshenv`, `zsh/.zprofile`, `zsh/.zshrc`, `zsh/.zlogin`, `zsh/deck.zsh`, `pwsh/deck.ps1` under `dir` (create folders, overwrite only when content differs), return `dir`. Add `declare module '*?raw' { const s: string; export default s }` if `vite/client` types don't already cover it.

- [ ] **Step 6: Run the tests** — `npx vitest run src/main/shell` → PASS (the zsh test runs on macOS).

---

### Task 4: PTY manager

**Files:**
- Create: `src/main/pty/batcher.ts`, `src/main/pty/batcher.test.ts`, `src/main/pty/startup-command.ts`, `src/main/pty/startup-command.test.ts`, `src/main/pty/manager.ts`, `src/main/pty/manager.test.ts`

**Interfaces:**

```ts
// batcher.ts — coalesce output so the renderer gets one IPC message per tab per few ms
export class DataBatcher {
  constructor(flush: (id: string, data: string) => void, opts?: { delayMs?: number; maxChars?: number })
  push(id: string, data: string): void   // flushes at once when the buffer reaches maxChars (default 65536)
  flushAll(): void
  dispose(): void                        // drops pending timers
}

// startup-command.ts — type the tab's command once the shell is ready
export const PROMPT_MARK = '\x1b]1337;SetUserVar=GIT_REPO='
export class StartupCommand {
  constructor(command: string, write: (data: string) => void, opts?: { timeoutMs?: number })  // default 4000
  onData(chunk: string): void   // writes `${command}\r` at the first PROMPT_MARK, once
  dispose(): void
}

// manager.ts
export type Launcher = (cwd: string) => ShellLaunch   // from ../shell/launch
export interface PtyEvents {
  data(id: string, data: string): void
  exit(id: string, exitCode: number): void
  process(id: string, name: string): void
}
export class PtyManager {
  constructor(launcher: Launcher, events: PtyEvents, opts?: { processPollMs?: number })  // default 1000
  create(opts: PtyCreateOptions): PtyInfo
  write(id: string, data: string): void
  resize(id: string, cols: number, rows: number): void
  kill(id: string): void
  killAll(): void
}
```

- [ ] **Step 1: Write the failing tests**

`batcher.test.ts`:

```ts
import { afterEach, beforeEach, describe, expect, it, vi } from 'vitest'
import { DataBatcher } from './batcher'

describe('DataBatcher', () => {
  beforeEach(() => vi.useFakeTimers())
  afterEach(() => vi.useRealTimers())

  it('sends one message per tab after the delay', () => {
    const out: [string, string][] = []
    const b = new DataBatcher((id, d) => out.push([id, d]), { delayMs: 5 })
    b.push('a', 'he'); b.push('b', 'x'); b.push('a', 'llo')
    expect(out).toEqual([])
    vi.advanceTimersByTime(5)
    expect(out).toEqual([['a', 'hello'], ['b', 'x']])
  })
  it('flushes at once when a buffer is full', () => {
    const out: string[] = []
    const b = new DataBatcher((_id, d) => out.push(d), { delayMs: 5, maxChars: 4 })
    b.push('a', 'abcdef')
    expect(out).toEqual(['abcdef'])
    vi.advanceTimersByTime(10)
    expect(out).toEqual(['abcdef'])
  })
  it('flushAll empties every buffer; dispose drops timers', () => {
    const out: string[] = []
    const b = new DataBatcher((_id, d) => out.push(d))
    b.push('a', '1'); b.flushAll()
    expect(out).toEqual(['1'])
    b.push('a', '2'); b.dispose(); vi.advanceTimersByTime(50)
    expect(out).toEqual(['1'])
  })
})
```

`startup-command.test.ts`:

```ts
import { afterEach, beforeEach, describe, expect, it, vi } from 'vitest'
import { PROMPT_MARK, StartupCommand } from './startup-command'

describe('StartupCommand', () => {
  beforeEach(() => vi.useFakeTimers())
  afterEach(() => vi.useRealTimers())

  it('types the command at the first prompt, once', () => {
    const w: string[] = []
    const s = new StartupCommand('claude', (d) => w.push(d))
    s.onData('Last login: …')
    expect(w).toEqual([])
    s.onData(`x${PROMPT_MARK}L1VzZXJz\x07`)
    s.onData(`${PROMPT_MARK}Lw==\x07`)
    expect(w).toEqual(['claude\r'])
  })
  it('falls back to a timeout when no prompt mark arrives', () => {
    const w: string[] = []
    new StartupCommand('claude', (d) => w.push(d), { timeoutMs: 4000 })
    vi.advanceTimersByTime(3999); expect(w).toEqual([])
    vi.advanceTimersByTime(1); expect(w).toEqual(['claude\r'])
  })
  it('does nothing after dispose', () => {
    const w: string[] = []
    const s = new StartupCommand('claude', (d) => w.push(d))
    s.dispose(); s.onData(PROMPT_MARK); vi.advanceTimersByTime(10000)
    expect(w).toEqual([])
  })
})
```

`manager.test.ts` (real pty, no user shell):

```ts
import { describe, expect, it } from 'vitest'
import { PtyManager } from './manager'

const echo = process.platform === 'win32'
  ? () => ({ file: 'cmd.exe', args: ['/c', 'echo deck-ok'], env: process.env as Record<string, string> })
  : () => ({ file: '/bin/sh', args: ['-c', 'printf deck-ok'], env: process.env as Record<string, string> })

describe('PtyManager', () => {
  it('streams output and reports the exit', async () => {
    let out = ''
    const exited = new Promise<number>((resolve) => {
      const m = new PtyManager(echo, {
        data: (_id, d) => { out += d },
        exit: (_id, code) => resolve(code),
        process: () => {},
      })
      const info = m.create({ cwd: process.cwd(), cols: 80, rows: 24 })
      expect(info.pid).toBeGreaterThan(0)
    })
    expect(await exited).toBe(0)
    expect(out).toContain('deck-ok')
  })
})
```

- [ ] **Step 2: Run to verify they fail** — `npx vitest run src/main/pty` → FAIL.

- [ ] **Step 3: Implement** `batcher.ts`, `startup-command.ts` to the interfaces above, then `manager.ts`:
  - `create`: `const launch = this.launcher(opts.cwd)`; `pty.spawn(launch.file, launch.args, { name: 'xterm-256color', cols, rows, cwd: opts.cwd, env: launch.env })` (node-pty uses ConPTY on Windows by default); id = `crypto.randomUUID()`.
  - Output: `p.onData` → `startup?.onData(d)` and `batcher.push(id, d)`; the batcher calls `events.data`.
  - `opts.command` → `new StartupCommand(opts.command, (d) => p.write(d))`.
  - `p.onExit(({ exitCode }))` → `batcher.flushAll()`, `events.exit(id, exitCode)`, forget the session.
  - Every `processPollMs`, for each session read `p.process`; when it changed, `events.process(id, name)` (on Windows it stays the shell's name; that's fine).
  - `kill`/`killAll` stop the poll timers and dispose the `StartupCommand`s; calls on unknown ids are ignored.

- [ ] **Step 4: Run the tests** — `npx vitest run src/main/pty` → PASS.

---

### Task 5: Projects backend

Port of `project_dashboard.py`: config, the folder scan and git branch reading, plus dirty counts and the native context menu.

**Files:**
- Create: `src/main/projects/config.ts`, `config.test.ts`, `git-head.ts`, `git-head.test.ts`, `scan.ts`, `scan.test.ts`, `status.ts`, `status.test.ts`, `ipc.ts`

**Interfaces (Task 6 depends on them):**

```ts
// config.ts
export const DEFAULT_COMMAND = 'claude --effort max --model claude-opus-5-5 --remote-control'
export function defaultConfig(): ProjectsConfig          // { command: DEFAULT_COMMAND, pinned: [], scan: ['~/Development'], depth: 2 }
export function expandHome(p: string, home: string): string   // '~' and '~/x' (and '~\\x'); anything else unchanged
export function normalizeConfig(raw: unknown): ProjectsConfig   // field-by-field: keep valid values, default the rest; depth integer 1..6
export function loadConfig(file: string, opts?: { importFrom?: string }): Promise<ProjectsConfig>
  // file missing → read importFrom (the WezTerm prototype's ~/.config/wezterm/projects.json) if it exists,
  // else defaults; normalise, save to file, return.
  // file present but not valid JSON → defaults, and the file is left as it is (don't destroy hand edits)
export function saveConfig(file: string, config: ProjectsConfig): Promise<ProjectsConfig>   // normalises, writes pretty JSON

// git-head.ts
export function readBranch(dir: string): Promise<string | null>

// scan.ts
export const SKIP: ReadonlySet<string>   // node_modules build Pods DerivedData .gradle venv .venv dist target out
export function scanProjects(config: ProjectsConfig, home: string): Promise<ProjectItem[]>

// status.ts
export function projectStatus(paths: string[], opts?: { concurrency?: number; timeoutMs?: number }): Promise<ProjectStatus[]>
  // git status --porcelain=v1 with GIT_OPTIONAL_LOCKS=0; non-repos are left out; default concurrency 4, timeout 3000 ms

// ipc.ts
export function registerProjectsIpc(deps: { configFile: string; home: string; importFrom: string }): void
```

- [ ] **Step 1: Write the failing tests**

`config.test.ts`:

```ts
import { mkdtempSync, readFileSync, writeFileSync } from 'node:fs'
import { tmpdir } from 'node:os'
import { join } from 'node:path'
import { describe, expect, it } from 'vitest'
import { DEFAULT_COMMAND, defaultConfig, expandHome, loadConfig, normalizeConfig, saveConfig } from './config'

const tmp = () => mkdtempSync(join(tmpdir(), 'deck-cfg-'))

describe('projects config', () => {
  it('expands ~ only at the start', () => {
    expect(expandHome('~', '/Users/f')).toBe('/Users/f')
    expect(expandHome('~/Development', '/Users/f')).toBe(join('/Users/f', 'Development'))
    expect(expandHome('/Volumes/wyobi', '/Users/f')).toBe('/Volumes/wyobi')
    expect(expandHome('a/~/b', '/Users/f')).toBe('a/~/b')
  })
  it('keeps valid fields and defaults the rest', () => {
    expect(normalizeConfig({ command: 'claude', pinned: ['/a', 3], scan: 'nope', depth: 99 }))
      .toEqual({ command: 'claude', pinned: ['/a'], scan: defaultConfig().scan, depth: 6 })
    expect(normalizeConfig(null)).toEqual(defaultConfig())
    expect(normalizeConfig({ command: '  ' }).command).toBe(DEFAULT_COMMAND)
  })
  it('creates the file with defaults on first load', async () => {
    const f = join(tmp(), 'projects.json')
    expect(await loadConfig(f)).toEqual(defaultConfig())
    expect(JSON.parse(readFileSync(f, 'utf8'))).toEqual(defaultConfig())
  })
  it('imports the WezTerm prototype config on first load', async () => {
    const d = tmp()
    const proto = join(d, 'wezterm-projects.json')
    writeFileSync(proto, JSON.stringify({ command: 'claude', pinned: ['/Volumes/wyobi/X'], scan: ['/Volumes/wyobi'], depth: 2 }))
    const cfg = await loadConfig(join(d, 'projects.json'), { importFrom: proto })
    expect(cfg).toEqual({ command: 'claude', pinned: ['/Volumes/wyobi/X'], scan: ['/Volumes/wyobi'], depth: 2 })
  })
  it('survives a broken file and round-trips saves', async () => {
    const f = join(tmp(), 'projects.json')
    writeFileSync(f, '{ not json')
    expect(await loadConfig(f)).toEqual(defaultConfig())
    const saved = await saveConfig(f, { ...defaultConfig(), pinned: ['/x'] })
    expect(await loadConfig(f)).toEqual(saved)
  })
})
```

`git-head.test.ts`:

```ts
import { mkdirSync, mkdtempSync, writeFileSync } from 'node:fs'
import { tmpdir } from 'node:os'
import { join } from 'node:path'
import { describe, expect, it } from 'vitest'
import { readBranch } from './git-head'

function repo(head: string) {
  const d = mkdtempSync(join(tmpdir(), 'deck-git-'))
  mkdirSync(join(d, '.git'))
  writeFileSync(join(d, '.git', 'HEAD'), head)
  return d
}

describe('readBranch', () => {
  it('reads the branch', async () => expect(await readBranch(repo('ref: refs/heads/feature/x\n'))).toBe('feature/x'))
  it('shortens a detached HEAD', async () => expect(await readBranch(repo('0123456789abcdef\n'))).toBe('0123456'))
  it('follows a worktree pointer (relative and absolute)', async () => {
    const main = repo('ref: refs/heads/main\n')
    const wtGit = join(main, '.git', 'worktrees', 'w')
    mkdirSync(wtGit, { recursive: true })
    writeFileSync(join(wtGit, 'HEAD'), 'ref: refs/heads/wt-branch\n')
    const wt = mkdtempSync(join(tmpdir(), 'deck-wt-'))
    writeFileSync(join(wt, '.git'), `gitdir: ${wtGit}\n`)
    expect(await readBranch(wt)).toBe('wt-branch')
  })
  it("returns '?' for a broken pointer and null without .git", async () => {
    const wt = mkdtempSync(join(tmpdir(), 'deck-wt-'))
    writeFileSync(join(wt, '.git'), 'garbage')
    expect(await readBranch(wt)).toBe('?')
    expect(await readBranch(mkdtempSync(join(tmpdir(), 'deck-plain-')))).toBeNull()
  })
})
```

`scan.test.ts`:

```ts
import { mkdirSync, mkdtempSync, utimesSync, writeFileSync } from 'node:fs'
import { tmpdir } from 'node:os'
import { join } from 'node:path'
import { describe, expect, it } from 'vitest'
import { defaultConfig } from './config'
import { scanProjects } from './scan'

function tree() {
  const root = mkdtempSync(join(tmpdir(), 'deck-scan-'))
  const mk = (rel: string, gitAgeSec?: number) => {
    const p = join(root, rel)
    mkdirSync(p, { recursive: true })
    if (gitAgeSec !== undefined) {
      mkdirSync(join(p, '.git'))
      writeFileSync(join(p, '.git', 'HEAD'), 'ref: refs/heads/main\n')
      const t = Date.now() / 1000 - gitAgeSec
      utimesSync(join(p, '.git', 'HEAD'), t, t)
      utimesSync(p, t, t)
    }
    return p
  }
  return { root, mk }
}

describe('scanProjects', () => {
  it('lists pinned first, then level-1 folders and deeper repos, newest first', async () => {
    const { root, mk } = tree()
    const old = Date.now() / 1000 - 10_000
    const a = mk('a'); utimesSync(a, old, old)                 // plain folder at level 1: listed
    const b = mk('b', 100)                                       // repo
    const d = mk('c/d', 10)                                      // repo at level 2: listed
    mk('c/e')                                                    // plain folder at level 2: not listed
    mk('b/inner', 1); mk('node_modules/x', 1); mk('.hidden', 1) // inside a repo / skipped / hidden
    const c = join(root, 'c'); utimesSync(c, old - 1, old - 1)  // after its children were created
    const pinned = mkdtempSync(join(tmpdir(), 'deck-pinned-'))     // outside the scan root
    const items = await scanProjects({ ...defaultConfig(), pinned: [pinned, b, join(root, 'missing')], scan: [root], depth: 2 }, '/home/none')
    expect(items.map((i) => i.path)).toEqual([pinned, b, d, a, c])
    expect(items.map((i) => i.pinned)).toEqual([true, true, false, false, false])
    expect(items.find((i) => i.path === d)).toMatchObject({ name: 'd', branch: 'main' })
    expect(items.find((i) => i.path === a)?.branch).toBeNull()
  })
  it('honours depth', async () => {
    const { root, mk } = tree()
    mk('x/y/z', 5)
    expect((await scanProjects({ ...defaultConfig(), scan: [root], depth: 2 }, '/h')).map((i) => i.name)).toEqual(['x'])
    expect((await scanProjects({ ...defaultConfig(), scan: [root], depth: 3 }, '/h')).map((i) => i.name)).toContain('z')
  })
})
```

`status.test.ts`:

```ts
import { execFileSync } from 'node:child_process'
import { mkdtempSync, writeFileSync } from 'node:fs'
import { tmpdir } from 'node:os'
import { join } from 'node:path'
import { describe, expect, it } from 'vitest'
import { projectStatus } from './status'

describe('projectStatus', () => {
  it('counts changed and untracked files and skips non-repos', async () => {
    const d = mkdtempSync(join(tmpdir(), 'deck-status-'))
    const git = (...a: string[]) => execFileSync('git', ['-C', d, ...a], { stdio: 'ignore' })
    git('init', '-q'); git('config', 'user.email', 't@t'); git('config', 'user.name', 't')
    writeFileSync(join(d, 'a.txt'), '1'); git('add', 'a.txt'); git('commit', '-qm', 'init')
    writeFileSync(join(d, 'a.txt'), '2'); writeFileSync(join(d, 'new.txt'), 'n')
    const plain = mkdtempSync(join(tmpdir(), 'deck-plain-'))
    expect(await projectStatus([d, plain])).toEqual([{ path: d, changed: 1, untracked: 1, conflicts: 0 }])
  })
})
```

- [ ] **Step 2: Run to verify they fail** — `npx vitest run src/main/projects` → FAIL.

- [ ] **Step 3: Implement**
  - `git-head.ts`: port of `git_branch()` in `project_dashboard.py` (async `fs.promises`).
  - `scan.ts`: port of `scan()`: pinned in order (expanded, `path.normalize`d, existing dirs, deduped); then each scan root walked with `fs.promises.readdir({ withFileTypes: true })` sorted case-insensitively; skip non-directories, names starting with `.` and `SKIP`; at level 1 list every folder, deeper only repos (`.git` file or dir exists); never descend into a repo; descend while `level < depth`. `activity` = max mtime (ms) of `.git/index`, `.git/HEAD`, `.git/FETCH_HEAD` and the folder. Unpinned sorted by `activity` desc. Unreadable folders are skipped silently.
  - `status.ts`: run `git -C <path> status --porcelain=v1` (`execFile`, env `GIT_OPTIONAL_LOCKS=0`, timeout) with a small promise pool; count like `status_counts()` in `git_graph_pane.py` (`??` untracked; `U` in either column or `AA`/`DD` conflict; else changed); a failing git (not a repo, timeout) leaves the path out.
  - `config.ts`: per the interface; JSON written with 2-space indent and a trailing newline; `mkdir -p` the folder.
  - `ipc.ts`: `ipcMain.handle` for `projectsList` (load config → scan), `projectsStatus`, `projectsGetConfig`, `projectsSetConfig`, `projectsTogglePin` (path added at the end or removed; save; return config) and `projectsContextMenu`: a native `Menu` (popup on the sender's window) with **Open with Claude**, **Open shell only**, separator, **Pin** / **Unpin**, **Reveal in Finder** (Windows: **Show in Explorer**, `shell.showItemInFolder`), **Copy path** (`clipboard.writeText`); resolve with `'claude'`, `'shell'` or `null` (also `null` when the menu closes without a choice).

- [ ] **Step 4: Run the tests** — `npx vitest run src/main/projects` → PASS.

---

### Task 6: Main process wiring

**Files:**
- Create: `src/main/window.ts`, `src/main/menu.ts`, `src/main/open-args.ts`, `src/main/open-args.test.ts`
- Replace: `src/main/index.ts`

- [ ] **Step 1: Failing test** — `open-args.test.ts`:

```ts
import { describe, expect, it } from 'vitest'
import { folderFromArgv } from './open-args'

describe('folderFromArgv', () => {
  it('reads --open <folder> and --open=<folder>', () => {
    expect(folderFromArgv(['Deck.exe', '--open', 'C:\\Work\\X'])).toBe('C:\\Work\\X')
    expect(folderFromArgv(['/Applications/Deck.app/Contents/MacOS/Deck', '--open=/Users/f/x'])).toBe('/Users/f/x')
  })
  it('ignores everything else', () => {
    expect(folderFromArgv(['Deck.exe'])).toBeNull()
    expect(folderFromArgv(['Deck.exe', '--open'])).toBeNull()
    expect(folderFromArgv(['Deck.exe', '--inspect', '--open', ''])).toBeNull()
  })
})
```

- [ ] **Step 2: Implement**
  - `open-args.ts`: `folderFromArgv(argv: string[]): string | null` as tested.
  - `window.ts`: `createWindow(): BrowserWindow` — 1400×900, min 800×500, `show: false` until `ready-to-show`, `backgroundColor: '#0E1022'`; macOS `titleBarStyle: 'hiddenInset'`, `trafficLightPosition: { x: 14, y: 12 }`; Windows `titleBarStyle: 'hidden'` with `titleBarOverlay: { color: '#12142A', symbolColor: '#F4F5FB', height: 36 }`; Linux default frame; `icon: build/icon.png` off macOS. `webPreferences: { preload: join(__dirname, '../preload/index.js'), contextIsolation: true, sandbox: true, nodeIntegration: false, spellcheck: false }`. `setWindowOpenHandler` → deny, open `http(s)` URLs with `shell.openExternal`. `will-navigate` → `preventDefault()` unless it's the dev server URL. Load `ELECTRON_RENDERER_URL` in dev, else `../renderer/index.html`.
  - `menu.ts`: `buildMenu(send: (cmd: MenuCommand) => void, platform)`. macOS: app menu (About, Hide, Quit roles), **Shell** (New Tab ⌘T, Close Tab ⌘W, Projects ⇧⌘O), **Edit** (undo/redo/cut/copy/paste/selectAll roles, Find ⌘F), **View** (reload + devtools only when `!app.isPackaged`, zoom roles, togglefullscreen), **Window** (Next Tab ⇧⌘], Previous Tab ⇧⌘[, Select Tab 1–9 ⌘1…⌘9 as hidden items, minimize, zoom). Windows/Linux: the same commands on `Ctrl+Shift+T/W/O/F`, next/previous `Ctrl+Tab` / `Ctrl+Shift+Tab`, tabs `Ctrl+Alt+1…9`; no copy/paste roles (the terminal handles Ctrl+Shift+C/V); `autoHideMenuBar`.
  - `index.ts`:
    - `app.requestSingleInstanceLock()`; quit if not obtained. `second-instance` → focus window, deliver `folderFromArgv(argv)`. macOS `open-file` (folders only) → deliver. Startup argv → deliver.
    - Deliveries queue until `appReady`, then `webContents.send(IPC.appOpenFolder, path)`; only existing directories pass.
    - On ready: `installShellIntegration(join(app.getPath('userData'), 'shell-integration'))`; `hasPwsh` on Windows by probing `where pwsh` once.
    - `PtyManager` with `launcher = () => shellLaunch({ platform: process.platform, env: process.env, integrationDir, appVersion: app.getVersion(), hasPwsh })` and events → `webContents.send(IPC.ptyData|ptyExit|ptyProcess, …)` (skip if the window is gone).
    - `ipcMain.handle(IPC.ptyCreate)` (a `cwd` that is empty or not a directory becomes `os.homedir()`), `ipcMain.on(IPC.ptyWrite|ptyResize|ptyKill)`; `appInfo` → `{ home: os.homedir(), version: app.getVersion() }`; `appOpenExternal` (http/https only), `appCopyText`, `appReadText` (`clipboard`).
    - `registerProjectsIpc({ configFile: join(userData, 'projects.json'), home: os.homedir(), importFrom: join(os.homedir(), '.config', 'wezterm', 'projects.json') })`.
    - `before-quit` / window `closed` → `ptys.killAll()`. `window-all-closed` → `app.quit()`.

- [ ] **Step 3: Verify** — `npx vitest run src/main && npm run typecheck && npm run build`.

---

### Task 7: Renderer — terminal

**Files:**
- Create: `src/renderer/src/terminal/osc.ts`, `osc.test.ts`, `keys.ts`, `keys.test.ts`, `theme.ts`, `TerminalView.tsx`, `SearchBar.tsx`

**Interfaces:**

```ts
// osc.ts — xterm hands handlers the payload after "7;" / "1337;"
export function parseOsc7(data: string): string | null          // 'file://host/Users/f/My%20Dir' → '/Users/f/My Dir'; 'file://PC/C:/x' → 'C:/x'
export function parseSetUserVar(data: string): { name: string; value: string } | null   // 'SetUserVar=NAME=<base64 utf-8>'

// keys.ts
export type KeyAction = 'newline' | 'copy' | 'paste' | 'find' | null
export interface KeyInput { type: string; key: string; shiftKey: boolean; ctrlKey: boolean; metaKey: boolean; altKey: boolean }
export function keyAction(e: KeyInput, platform: Platform, hasSelection: boolean): KeyAction
```

- [ ] **Step 1: Failing tests**

`osc.test.ts`:

```ts
import { describe, expect, it } from 'vitest'
import { parseOsc7, parseSetUserVar } from './osc'

const b64 = (s: string) => btoa(String.fromCharCode(...new TextEncoder().encode(s)))

describe('parseOsc7', () => {
  it('decodes a file URL', () => {
    expect(parseOsc7('file://mac.local/Users/f/My%20Dir')).toBe('/Users/f/My Dir')
    expect(parseOsc7('file:///tmp')).toBe('/tmp')
  })
  it('turns /C:/x into C:/x', () => expect(parseOsc7('file://PC/C:/Users/f')).toBe('C:/Users/f'))
  it('rejects other payloads', () => {
    expect(parseOsc7('http://x/y')).toBeNull()
    expect(parseOsc7('file://host')).toBeNull()
  })
})

describe('parseSetUserVar', () => {
  it('decodes base64 UTF-8 values', () => {
    expect(parseSetUserVar(`SetUserVar=GIT_REPO=${b64('/Volumes/Wyobi/AccessControl_Guard')}`))
      .toEqual({ name: 'GIT_REPO', value: '/Volumes/Wyobi/AccessControl_Guard' })
    expect(parseSetUserVar(`SetUserVar=GIT_BRANCH=${b64('feature/über')}`)).toEqual({ name: 'GIT_BRANCH', value: 'feature/über' })
  })
  it('accepts empty values and rejects other 1337 commands', () => {
    expect(parseSetUserVar('SetUserVar=GIT_BRANCH=')).toEqual({ name: 'GIT_BRANCH', value: '' })
    expect(parseSetUserVar('File=inline=1:AAAA')).toBeNull()
    expect(parseSetUserVar('SetUserVar=')).toBeNull()
  })
})
```

`keys.test.ts`:

```ts
import { describe, expect, it } from 'vitest'
import { keyAction, type KeyInput } from './keys'

const k = (key: string, mods: Partial<KeyInput> = {}): KeyInput =>
  ({ type: 'keydown', key, shiftKey: false, ctrlKey: false, metaKey: false, altKey: false, ...mods })

describe('keyAction', () => {
  it('Shift+Enter is a newline for Claude on every platform', () => {
    expect(keyAction(k('Enter', { shiftKey: true }), 'darwin', false)).toBe('newline')
    expect(keyAction(k('Enter', { shiftKey: true }), 'win32', false)).toBe('newline')
    expect(keyAction(k('Enter'), 'darwin', false)).toBeNull()
    expect(keyAction({ ...k('Enter', { shiftKey: true }), type: 'keyup' }, 'darwin', false)).toBeNull()
  })
  it('macOS leaves copy and paste to the Edit menu; Cmd+F finds', () => {
    expect(keyAction(k('c', { metaKey: true }), 'darwin', true)).toBeNull()
    expect(keyAction(k('f', { metaKey: true }), 'darwin', false)).toBe('find')
  })
  it('Windows: Ctrl+Shift+C/V, Ctrl+C only with a selection, Ctrl+V pastes', () => {
    expect(keyAction(k('C', { ctrlKey: true, shiftKey: true }), 'win32', true)).toBe('copy')
    expect(keyAction(k('V', { ctrlKey: true, shiftKey: true }), 'win32', false)).toBe('paste')
    expect(keyAction(k('c', { ctrlKey: true }), 'win32', true)).toBe('copy')
    expect(keyAction(k('c', { ctrlKey: true }), 'win32', false)).toBeNull() // SIGINT goes through
    expect(keyAction(k('v', { ctrlKey: true }), 'win32', false)).toBe('paste')
    expect(keyAction(k('F', { ctrlKey: true, shiftKey: true }), 'win32', false)).toBe('find')
  })
})
```

- [ ] **Step 2: Run to verify they fail**, then implement `osc.ts` and `keys.ts` until `npx vitest run src/renderer` passes.

- [ ] **Step 3: `theme.ts`** — an xterm `ITheme` in the branding palette: background `#0E1022`, foreground `#E6E8F2`, cursor `#FF9F43` (amber), cursorAccent `#0E1022`, selectionBackground `#A78BFA55` (violet); ANSI black `#1A1C33`, red `#F7768E`, green `#3DDCC1` (teal), yellow `#FF9F43`, blue `#7AA2F7`, magenta `#A78BFA`, cyan `#7DCFFF`, white `#C0CAF5`; brights `#414868`, `#FF8FA3`, `#6EF2DB`, `#FFB86B`, `#9ABDFF`, `#C4B0FF`, `#A4E0FF`, `#F4F5FB`. Export `FONT_FAMILY` = `'SF Mono', Menlo, 'Cascadia Mono', Consolas, 'DejaVu Sans Mono', monospace`, `FONT_SIZE = 13`.

- [ ] **Step 4: `TerminalView.tsx`** — props `{ tab: TerminalTab; active: boolean; findRequest: number; onUpdate(id: string, patch: Partial<TerminalTab>): void; onClose(id: string): void }` (`TerminalTab` comes from Task 8's `tabs.ts`; build Task 8's `tabs.ts` first if working alone).
  - On mount: `new Terminal({ scrollback: 50000, fontFamily, fontSize, theme, allowProposedApi: true, cursorBlink: true, macOptionIsMeta: false, ...(platform === 'win32' ? { windowsPty: { backend: 'conpty' } } : {}) })`; load `FitAddon`, `Unicode11Addon` (then `term.unicode.activeVersion = '11'`), `SearchAddon`, `WebLinksAddon((_e, url) => window.deck.app.openExternal(url))`; `term.open(el)`; then try `WebglAddon` (on `onContextLoss` dispose it; xterm falls back to the DOM renderer); `fit()`.
  - `window.deck.pty.create({ cwd: tab.cwd, command: tab.command, cols: term.cols, rows: term.rows })` → `onUpdate(tab.id, { ptyId })`. If the view unmounted before the promise resolved (React StrictMode mounts twice in dev), kill that pty immediately instead.
  - Wire `term.onData → pty.write`, `pty.onData` (only this ptyId) → `term.write`, `term.onResize → pty.resize`, `pty.onProcess` → `onUpdate(tab.id, { process: name })`, `term.onTitleChange` → `onUpdate(tab.id, { title })`. `pty.onExit`: exit code 0 → `onClose(tab.id)`; otherwise `onUpdate(tab.id, { exited: code })`, print a dim `[process exited with code N — press Enter to close]` line, and Enter then calls `onClose(tab.id)`.
  - `term.parser.registerOscHandler(7, d => { const p = parseOsc7(d); if (p) onUpdate(tab.id, { cwd: p }); return true })` and `(1337, d => { const v = parseSetUserVar(d); if (v) onUpdate(tab.id, { vars: { ...latestVars, [v.name]: v.value } }); return true })` (keep `latestVars` in a ref).
  - `term.attachCustomKeyEventHandler(e => …keyAction(e, window.deck.platform, term.hasSelection())…)`: `newline` → `pty.write(ptyId, '\x1b\r')`; `copy` → `window.deck.app.copyText(term.getSelection())`; `paste` → `window.deck.app.readText().then(t => term.paste(t))`; `find` → open the search bar; return `false` for handled keys.
  - `ResizeObserver` on the container → `fit()` (requestAnimationFrame-debounced, skipped while hidden). When `active` turns true: `fit()` and `term.focus()`. Hidden tabs stay mounted (`display: none`) so scrollback survives.
  - On unmount: `pty.kill(ptyId)`, dispose listeners and the terminal.
- [ ] **Step 5: `SearchBar.tsx`** — small overlay at the top right of the terminal: input, Enter `findNext`, Shift+Enter `findPrevious`, Esc closes and refocuses the terminal; opens when `findRequest` increments.

---

### Task 8: Renderer — tabs, titles, app shell

**Files:**
- Create: `src/renderer/src/tabs/tabs.ts`, `tabs.test.ts`, `title.ts`, `title.test.ts`, `TabBar.tsx`, `src/renderer/src/App.tsx`, `src/renderer/src/styles.css`
- Replace: `src/renderer/src/main.tsx`

**Interfaces:**

```ts
// tabs.ts
export const PROJECTS_ID = 'projects'
export interface ProjectsTab { id: typeof PROJECTS_ID; kind: 'projects' }
export interface TerminalTab {
  id: string; kind: 'terminal'
  cwd: string                    // updated from OSC 7
  command?: string               // typed at the first prompt
  ptyId?: string
  title: string                  // the terminal's own title (OSC 0/2)
  vars: Record<string, string>   // OSC 1337 user vars: GIT_REPO, GIT_BRANCH
  process: string                // foreground process name from main
  exited?: number
}
export type Tab = ProjectsTab | TerminalTab
export interface TabsState { tabs: Tab[]; active: string }
export type TabsAction =
  | { type: 'open'; cwd: string; command?: string; id: string }
  | { type: 'close'; id: string }
  | { type: 'activate'; id: string }
  | { type: 'next' } | { type: 'prev' }
  | { type: 'select'; index: number }          // 1-based over all tabs; 9 = last
  | { type: 'update'; id: string; patch: Partial<Omit<TerminalTab, 'id' | 'kind'>> }
export const initialTabs: TabsState   // { tabs: [{ id: PROJECTS_ID, kind: 'projects' }], active: PROJECTS_ID }
export function tabsReducer(state: TabsState, action: TabsAction): TabsState

// title.ts
export function runsClaude(processName: string, title: string): boolean
export function tabTitle(tab: TerminalTab, platform: Platform): string
```

- [ ] **Step 1: Failing tests**

`tabs.test.ts`:

```ts
import { describe, expect, it } from 'vitest'
import { initialTabs, PROJECTS_ID, tabsReducer, type TabsState } from './tabs'

const open = (s: TabsState, id: string) => tabsReducer(s, { type: 'open', id, cwd: `/w/${id}` })

describe('tabsReducer', () => {
  it('starts with the Projects tab and opens new tabs at the end, focused', () => {
    const s = open(open(initialTabs, 'a'), 'b')
    expect(s.tabs.map((t) => t.id)).toEqual([PROJECTS_ID, 'a', 'b'])
    expect(s.active).toBe('b')
    expect(s.tabs[2]).toMatchObject({ kind: 'terminal', cwd: '/w/b', title: '', vars: {}, process: '' })
  })
  it('never closes the Projects tab', () => {
    expect(tabsReducer(initialTabs, { type: 'close', id: PROJECTS_ID })).toBe(initialTabs)
  })
  it('closing the active tab focuses its right neighbour, else the left one', () => {
    let s = open(open(open(initialTabs, 'a'), 'b'), 'c')
    s = tabsReducer({ ...s, active: 'b' }, { type: 'close', id: 'b' })
    expect(s.active).toBe('c')
    s = tabsReducer(s, { type: 'close', id: 'c' })
    expect(s.active).toBe('a')
  })
  it('closing another tab keeps the focus', () => {
    const s = tabsReducer(open(open(initialTabs, 'a'), 'b'), { type: 'close', id: 'a' })
    expect(s.active).toBe('b')
  })
  it('next/prev wrap, select is 1-based and 9 is the last tab', () => {
    const s = open(open(initialTabs, 'a'), 'b')
    expect(tabsReducer(s, { type: 'next' }).active).toBe(PROJECTS_ID)
    expect(tabsReducer({ ...s, active: PROJECTS_ID }, { type: 'prev' }).active).toBe('b')
    expect(tabsReducer(s, { type: 'select', index: 1 }).active).toBe(PROJECTS_ID)
    expect(tabsReducer(s, { type: 'select', index: 9 }).active).toBe('b')
    expect(tabsReducer(s, { type: 'select', index: 5 })).toBe(s)
  })
  it('updates terminal tabs only', () => {
    const s = tabsReducer(open(initialTabs, 'a'), { type: 'update', id: 'a', patch: { title: '✳ Claude Code' } })
    expect(s.tabs[1]).toMatchObject({ title: '✳ Claude Code' })
    expect(tabsReducer(s, { type: 'update', id: PROJECTS_ID, patch: { title: 'x' } })).toBe(s)
  })
})
```

`title.test.ts`:

```ts
import { describe, expect, it } from 'vitest'
import type { TerminalTab } from './tabs'
import { runsClaude, tabTitle } from './title'

const tab = (p: Partial<TerminalTab>): TerminalTab =>
  ({ id: 't', kind: 'terminal', cwd: '/Users/f', title: '', vars: {}, process: 'zsh', ...p })

describe('runsClaude', () => {
  it('knows Claude by process name or by its status title', () => {
    expect(runsClaude('claude', '')).toBe(true)
    expect(runsClaude('claude.exe', '')).toBe(true)
    expect(runsClaude('zsh', '✳ Reply with OK')).toBe(true)
    expect(runsClaude('zsh', '◐ Working on it')).toBe(true)
    expect(runsClaude('zsh', '⠂ Thinking')).toBe(true)
    expect(runsClaude('zsh', '~/Development/deck')).toBe(false)
  })
})

describe('tabTitle', () => {
  const repo = { GIT_REPO: '/Volumes/Wyobi/AccessControl_Guard', GIT_BRANCH: 'dev' }
  it('repo and branch at a shell prompt', () =>
    expect(tabTitle(tab({ vars: repo }), 'darwin')).toBe('AccessControl_Guard ⎇ dev'))
  it("repo and Claude's own title while Claude runs", () => {
    expect(tabTitle(tab({ vars: repo, process: 'claude', title: '◑ Reply with OK' }), 'darwin'))
      .toBe('AccessControl_Guard · ◑ Reply with OK')
    expect(tabTitle(tab({ vars: repo, title: '✳ Claude Code' }), 'darwin')).toBe('AccessControl_Guard · ✳ Claude Code')
  })
  it('outside a repo: the terminal title, else the folder name', () => {
    expect(tabTitle(tab({ title: 'vim notes.md' }), 'darwin')).toBe('vim notes.md')
    expect(tabTitle(tab({ cwd: '/Users/f/Downloads' }), 'darwin')).toBe('Downloads')
    expect(tabTitle(tab({ cwd: 'C:\\Users\\f\\Work', process: 'pwsh.exe' }), 'win32')).toBe('Work')
  })
})
```

- [ ] **Step 2: Run to verify they fail**, implement `tabs.ts` and `title.ts` until `npx vitest run src/renderer` passes. `runsClaude`: process name contains `claude` (case-insensitive) or the title starts with one of `✳ ✶ ✻ ✽ ✢ · ◐ ◑ ◒ ◓` or a braille spinner `U+2801–U+28FF`, followed by a space. `tabTitle`: like `format-tab-title` in `wezterm.lua` (basename handles `/` and `\`).

- [ ] **Step 3: `TabBar.tsx`** — one row: the Projects tab first (`⌂ Projects`, no close button), then terminal tabs (`tabTitle`, ellipsis when long, close `×` on hover/active, middle-click closes), then a `+` button (new shell tab in the active tab's `cwd`, else home). Exited tabs show dimmed. macOS: 78 px left padding for the traffic lights; Windows: 140 px right padding for the title-bar overlay. The empty area is a window drag region (`-webkit-app-region: drag`); tabs and buttons are `no-drag`. Height 36 px.

- [ ] **Step 4: `App.tsx`** — `useReducer(tabsReducer, initialTabs)`; `info` from `window.deck.app.info()` on mount; `findRequests: Record<tabId, number>` in state. Renders `TabBar`, then a content area with `ProjectsView` (visible when the Projects tab is active; gets `home = info.home`) and one `TerminalView` per terminal tab (`display: none` unless active). `open(cwd, command?)` dispatches `open` with `crypto.randomUUID()`. `window.deck.app.onMenu`: `new-tab` → shell tab in the active terminal tab's `cwd`, or `info.home` when the Projects tab is active; `close-tab` → close the active tab (ignored on Projects; also `pty.kill` happens in `TerminalView`'s unmount); `next-tab`/`prev-tab`/`select-tab`/`projects`; `find` → increment the active terminal's `findRequests` entry. `window.deck.app.onOpenFolder(p => open(p))`. Call `window.deck.app.ready()` once the listeners are attached. `document.title` = the active tab's title (`Deck` on Projects).
- [ ] **Step 5: `styles.css`** — full-window flex column; background `#0E1022`; tab bar `#12142A` with active tab `#1C1F3D` and a 2 px teal (`#3DDCC1`) bottom border; text `#F4F5FB`, muted `#8B90B5`; system UI font for chrome. Import `@xterm/xterm/css/xterm.css` in `main.tsx`.
- [ ] **Step 6: `main.tsx`** — `createRoot(document.getElementById('root')!).render(<StrictMode><App /></StrictMode>)` — StrictMode double-mounts effects in dev: `TerminalView` must create its pty only once per mount and kill it on unmount, so a double mount just costs one extra short-lived shell.

---

### Task 9: Renderer — Projects tab

**Files:**
- Create: `src/renderer/src/projects/filter.ts`, `filter.test.ts`, `ProjectsView.tsx`, `Settings.tsx`

**Interfaces:**

```ts
export function filterProjects(items: ProjectItem[], query: string): ProjectItem[]   // case-insensitive, all words must match name or path
export function ago(ms: number, now: number): string   // '<1m', '5m', '3h', '2d', '4mo', '2y'
export function shortPath(path: string, home: string): string   // home prefix → '~'
```

- [ ] **Step 1: Failing test** — `filter.test.ts`:

```ts
import { describe, expect, it } from 'vitest'
import type { ProjectItem } from '@shared/types'
import { ago, filterProjects, shortPath } from './filter'

const p = (path: string): ProjectItem => ({ path, name: path.split('/').pop()!, branch: null, pinned: false, activity: 0 })

describe('filterProjects', () => {
  const items = [p('/Volumes/wyobi/AccessControl_Guard'), p('/Users/f/Development/deck'), p('/Volumes/wyobi/FaceAPI')]
  it('matches every word against name and path, any case', () => {
    expect(filterProjects(items, 'access').map((i) => i.name)).toEqual(['AccessControl_Guard'])
    expect(filterProjects(items, 'WYOBI face').map((i) => i.name)).toEqual(['FaceAPI'])
    expect(filterProjects(items, '  ')).toEqual(items)
  })
})

describe('ago / shortPath', () => {
  const now = 1_800_000_000_000
  it('formats ages like the prototype', () => {
    expect(ago(now - 20_000, now)).toBe('<1m')
    expect(ago(now - 5 * 60_000, now)).toBe('5m')
    expect(ago(now - 3 * 3_600_000, now)).toBe('3h')
    expect(ago(now - 2 * 86_400_000, now)).toBe('2d')
    expect(ago(now - 120 * 86_400_000, now)).toBe('4mo')
    expect(ago(now - 800 * 86_400_000, now)).toBe('2y')
  })
  it('shortens the home folder', () => {
    expect(shortPath('/Users/f/Development/deck', '/Users/f')).toBe('~/Development/deck')
    expect(shortPath('/Volumes/wyobi/X', '/Users/f')).toBe('/Volumes/wyobi/X')
  })
})
```

- [ ] **Step 2: Implement `filter.ts`** until the test passes. Age rules: under 60 s `<1m`; under 1 h minutes; under 1 day hours; under 60 days days; under 365 days months (30-day); else years.

- [ ] **Step 3: `ProjectsView.tsx`** — props `{ active: boolean; openTabs: TerminalTab[]; home: string; onOpen(path: string, action: 'claude' | 'shell'): void }` (`home` from `window.deck.app.info()`, passed down by `App`; until it arrives, show paths unshortened).
  - Load `getConfig()` + `list()` on mount, when `active` turns true, and every 60 s while active. After a list arrives, request `status()` for the git repos (batch) and merge the counts.
  - Header: `⌂ Projects`, the command that double-click runs, a filter input (`/` focuses it, Esc clears) and a **Settings** button.
  - Rows (keyboard-selectable list, ↑/↓, Enter = Claude, `o` = shell): pinned `★`, open marker `●` when a terminal tab's `cwd` is the project or inside it, name, `ago(activity)`, branch (`⎇ name` or `folder`), dirty summary when known (`✚3 ?2`, conflicts in red), path. Single click selects; **double-click** → `onOpen(path, 'claude')`; right-click → `projects.contextMenu(path)` → `onOpen(path, choice)` when a choice comes back, then refresh (pin changes).
  - Empty state: "Nothing found. Add folders to scan in Settings."
- [ ] **Step 4: `Settings.tsx`** — panel with: command (text input), scan folders (textarea, one per line), depth (number 1–6), pinned list (one per line); Save → `setConfig()` → reload list; Cancel closes.
- [ ] **Step 5: Verify** — `npx vitest run src/renderer && npm run typecheck`.

---

### Task 10: Integration, real-app verification, docs

- [ ] **Step 1:** `npm run typecheck && npm test && npm run build` all pass.
- [ ] **Step 2: Run the app** — from a Claude Code shell, start it clean so no parent-session env leaks (shell integration scrubs the known variables, but test the real path): `npm run dev`. Verify with screenshots (`screencapture -l <window id>`), real clicks (`cliclick`) and key presses (`osascript … key code`), as in `CLAUDE.md` → testing tips:
  1. Window opens with the Projects tab; pinned AccessControl_Guard first (imported from the prototype's config); branches, ages, dirty counts shown.
  2. Double-click AccessControl_Guard → new tab, zsh starts with the user's prompt, `claude --effort max …` is typed after the first prompt and runs; tab title becomes `AccessControl_Guard · ✳ Claude Code`.
  3. A shell tab (`+`): `cd` into a repo → title `repo ⎇ branch`; `cd /tmp` → `tmp`; history goes to `~/.zsh_history` (not the integration folder).
  4. Shift+Enter in Claude inserts a newline; Cmd+F search finds text; a URL is clickable and opens in the browser; Cmd+T/W/1–9/Shift+Cmd+O work; Projects tab can't be closed.
  5. Right-click → Reveal in Finder, Copy path, Pin/Unpin; Settings save and rescan.
  6. `--open`: `npx electron-vite preview -- --open /tmp` (or the packaged app) opens a tab in /tmp; a second launch with `--open` reuses the window.
  7. Close a tab → its shell process is gone (`ps`); quit → no orphaned shells.
- [ ] **Step 3: Packaging smoke test** — `npx electron-builder --mac --dir -c.mac.notarize=false` → launch `dist/mac-arm64/Deck.app`, double-click a project; node-pty loads from `app.asar.unpacked`.
- [ ] **Step 4: Docs** — README: a "Deck (Electron app)" section (dev/build/test commands, Node 22). CLAUDE.md: current state (M1 done), file map for `src/`, how to run and test; next steps → M2.
- [ ] **Step 5: Commit** each fix as it lands; final commit `M1: verified on macOS`.
