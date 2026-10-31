import { memo, type RefObject, useEffect, useRef, useState } from 'react'
import { FitAddon } from '@xterm/addon-fit'
import { SearchAddon } from '@xterm/addon-search'
import { Unicode11Addon } from '@xterm/addon-unicode11'
import { WebLinksAddon } from '@xterm/addon-web-links'
import { WebglAddon } from '@xterm/addon-webgl'
import { Terminal } from '@xterm/xterm'
import { quotePaths } from '@shared/quote'
import type { TerminalPatch, TerminalTab } from '../tabs/tabs'
import { runsClaude } from '../tabs/title'
import { keyAction } from './keys'
import { parseOsc7, parseSetUserVar } from './osc'
import { pasteSafe } from './paste'
import { SearchBar } from './SearchBar'
import { FONT_FAMILY, FONT_SIZE, theme } from './theme'

interface Props {
  tab: TerminalTab
  active: boolean
  /** Incremented by the Find menu command. */
  findRequest: number
  /** Windows build number; lets xterm reflow ConPTY output on resize. */
  windowsBuild?: number
  /** Set while mounted: pastes text into this terminal (the clipboard card's Add) and focuses it. */
  pasteRef?: RefObject<((text: string) => void) | null>
  onUpdate(id: string, patch: TerminalPatch): void
  onClose(id: string): void
}

/** One xterm and one pty per mount. Hidden tabs stay mounted (display: none)
 *  so their scrollback survives. */
export const TerminalView = memo(function TerminalView({ tab, active, findRequest, windowsBuild, pasteRef, onUpdate, onClose }: Props) {
  const hostRef = useRef<HTMLDivElement>(null)
  const termRef = useRef<Terminal | null>(null)
  const fitRef = useRef<FitAddon | null>(null)
  const searchRef = useRef<SearchAddon | null>(null)
  const [search, setSearch] = useState({ open: false, focus: 0 })
  const callbacks = useRef({ onUpdate, onClose })
  useEffect(() => {
    callbacks.current = { onUpdate, onClose }
  })

  // The paste handler, set up once per mount, needs the tab's latest process and title.
  const tabRef = useRef(tab)
  useEffect(() => {
    tabRef.current = tab
  })

  // Runs once per mount: the tab's id, starting cwd, command and pasteRef are read here only.
  useEffect(() => {
    const host = hostRef.current
    if (!host) return
    const { platform, pty, app, clipboard } = window.deck
    const id = tab.id
    const update = (patch: TerminalPatch) => callbacks.current.onUpdate(id, patch)
    const close = () => callbacks.current.onClose(id)

    const term = new Terminal({
      scrollback: 50_000,
      fontFamily: FONT_FAMILY,
      fontSize: FONT_SIZE,
      theme,
      allowProposedApi: true,
      cursorBlink: true,
      macOptionIsMeta: false,
      linkHandler: { activate: (_e, uri) => app.openExternal(uri) }, // OSC 8 links
      ...(platform === 'win32' ? { windowsPty: { backend: 'conpty' as const } } : {}),
    })
    const fit = new FitAddon()
    const search = new SearchAddon()
    term.loadAddon(fit)
    term.loadAddon(new Unicode11Addon())
    term.unicode.activeVersion = '11'
    term.loadAddon(search)
    term.loadAddon(new WebLinksAddon((_e, url) => app.openExternal(url)))
    term.open(host)
    try {
      const webgl = new WebglAddon()
      webgl.onContextLoss(() => webgl.dispose()) // xterm falls back to its DOM renderer
      term.loadAddon(webgl)
    } catch {
      // No WebGL2: the DOM renderer it is.
    }
    fit.fit()
    termRef.current = term
    fitRef.current = fit
    searchRef.current = search

    let disposed = false
    let ptyId: string | undefined
    let pending = true
    let exited = false
    let vars = tab.vars
    let title = tab.title
    // Events that arrive before create() resolves; replayed for our pty only.
    const early: { pid: string; run: () => void }[] = []

    const handleExit = (code: number) => {
      exited = true
      if (code === 0) return close()
      update({ exited: code })
      term.write(`\r\n\x1b[2m[process exited with code ${code} — press Enter to close]\x1b[0m\x1b[?25l`)
    }

    // Acknowledged once xterm has processed it, so main can pause a flooding pty.
    const show = (pid: string, data: string) => term.write(data, () => pty.ack(pid, data.length))
    const unsubscribe = [
      pty.onData((pid, data) => {
        if (pid === ptyId) show(pid, data)
        else if (pending) early.push({ pid, run: () => show(pid, data) })
      }),
      pty.onExit((pid, code) => {
        if (pid === ptyId) handleExit(code)
        else if (pending) early.push({ pid, run: () => handleExit(code) })
      }),
      pty.onProcess((pid, name) => {
        if (pid === ptyId) update({ process: name })
      }),
    ]

    const disposables = [
      term.onData((data) => {
        if (!exited) {
          if (ptyId) pty.write(ptyId, data)
        } else if (data === '\r') close()
      }),
      term.onResize(({ cols, rows }) => {
        if (ptyId && !exited) pty.resize(ptyId, cols, rows)
      }),
      term.onTitleChange((t) => {
        title = t
        update({ title: t })
      }),
      term.parser.registerOscHandler(7, (data) => {
        const cwd = parseOsc7(data)
        if (cwd) update({ cwd })
        return true
      }),
      term.parser.registerOscHandler(1337, (data) => {
        const v = parseSetUserVar(data)
        if (!v) return false // another 1337 command, not ours
        vars = { ...vars, [v.name]: v.value }
        const patch: TerminalPatch = { vars }
        // GIT_REPO comes with every prompt: at a prompt the tab shows the folder, so drop the
        // shell's own idle title (oh-my-zsh's user@host:dir, ConPTY's exe path) and any
        // title a finished program left behind (Claude's ✳).
        if (v.name === 'GIT_REPO' && title) {
          title = ''
          patch.title = ''
        }
        update(patch)
        return true
      }),
    ]

    // Cmd/Ctrl+V: main reads the clipboard. Copied files paste as quoted paths and, with Claude
    // running, an image as a saved PNG's path (Claude attaches it); text pastes as it is.
    const paste = (text: string) => term.paste(pasteSafe(text))
    const smartPaste = () => {
      if (exited) return // don't use up the card's item, or save an image, for a dead tab
      const { process: name, title: current } = tabRef.current
      clipboard.paste({ claude: runsClaude(name, current) }).then(
        (result) => {
          if (!result || disposed) return
          if ('text' in result) {
            if (result.text) paste(result.text)
          } else console.warn('paste:', result.error)
        },
        (err: unknown) => console.warn('paste failed', err),
      )
    }
    // macOS Cmd+V (the Edit menu's Paste) and Windows' Shift+Insert arrive as a paste event on
    // xterm's textarea; take it here, in the capture phase, so xterm's own, unfiltered paste
    // handler never runs.
    const onPaste = (e: ClipboardEvent) => {
      e.preventDefault()
      e.stopPropagation()
      smartPaste()
    }
    // Files dropped from Finder or Explorer: their quoted paths, like pasting copied files.
    const onDragOver = (e: DragEvent) => {
      if (!e.dataTransfer?.types.includes('Files')) return
      e.preventDefault()
      e.dataTransfer.dropEffect = 'copy'
    }
    const onDrop = (e: DragEvent) => {
      if (!e.dataTransfer?.types.includes('Files')) return
      e.preventDefault() // even with no File objects below, or Chromium's own drop handling runs
      const files = Array.from(e.dataTransfer.files)
      if (!files.length) return
      const paths = files.map((f) => app.pathForFile(f)).filter((p) => p !== '')
      const text = quotePaths(paths, platform) // null: none, or a name with control characters
      if (text === null) {
        if (paths.length) console.warn("drop: a file name has control characters, so it isn't pasted")
        return
      }
      if (!exited) {
        paste(text + ' ') // trailing space, like Terminal.app/iTerm2: two drops don't run together
        term.focus()
      }
    }
    host.addEventListener('paste', onPaste, true)
    host.addEventListener('dragover', onDragOver)
    host.addEventListener('drop', onDrop)
    const handle = (text: string) => {
      if (exited) return
      paste(text)
      term.focus()
    }
    if (pasteRef) pasteRef.current = handle

    term.attachCustomKeyEventHandler((e) => {
      if (e.isComposing) return true
      const action = keyAction(e, platform, term.hasSelection())
      if (!action) return true
      if (action === 'menu') return false // left uncancelled so the menu accelerator fires
      e.preventDefault() // no keypress after it, and no browser copy/paste on top of ours
      if (action === 'newline') {
        if (ptyId && !exited) pty.write(ptyId, '\x1b\r')
      } else if (action === 'copy') {
        if (term.hasSelection()) app.copyText(term.getSelection()) // Ctrl+Shift+C alone keeps the clipboard
        term.clearSelection()
      } else if (action === 'paste') {
        smartPaste()
      } else {
        setSearch((s) => ({ open: true, focus: s.focus + 1 }))
      }
      return false
    })

    // Hidden tabs measure 0 and are skipped; they fit again when shown.
    let frame = 0
    const observer = new ResizeObserver(() => {
      cancelAnimationFrame(frame)
      frame = requestAnimationFrame(() => {
        if (host.clientWidth > 0 && host.clientHeight > 0) fit.fit()
      })
    })
    observer.observe(host)

    const { cols, rows } = term
    pty.create({ cwd: tab.cwd, command: tab.command, cols, rows }).then(
      (info) => {
        pending = false
        if (disposed) {
          pty.kill(info.id) // unmounted first: React StrictMode mounts twice in dev
          return
        }
        ptyId = info.id
        for (const e of early.splice(0)) if (e.pid === info.id) e.run()
        if (term.cols !== cols || term.rows !== rows) pty.resize(info.id, term.cols, term.rows)
        update({ ptyId: info.id })
      },
      (err: unknown) => {
        pending = false
        early.length = 0
        if (!disposed) term.write(`\x1b[31mCould not start a shell: ${err instanceof Error ? err.message : String(err)}\x1b[0m\r\n`)
      },
    )

    return () => {
      disposed = true
      cancelAnimationFrame(frame)
      observer.disconnect()
      for (const off of unsubscribe) off()
      for (const d of disposables) d.dispose()
      if (ptyId && !exited) pty.kill(ptyId)
      host.removeEventListener('paste', onPaste, true)
      host.removeEventListener('dragover', onDragOver)
      host.removeEventListener('drop', onDrop)
      if (pasteRef?.current === handle) pasteRef.current = null
      term.dispose()
      termRef.current = null
      fitRef.current = null
      searchRef.current = null
    }
  }, [])

  useEffect(() => {
    if (!active) return
    fitRef.current?.fit()
    termRef.current?.focus()
  }, [active])

  useEffect(() => {
    if (windowsBuild && termRef.current) termRef.current.options.windowsPty = { backend: 'conpty', buildNumber: windowsBuild }
  }, [windowsBuild])

  useEffect(() => {
    if (findRequest > 0) setSearch((s) => ({ open: true, focus: s.focus + 1 }))
  }, [findRequest])

  const closeSearch = () => {
    setSearch((s) => ({ ...s, open: false }))
    searchRef.current?.clearDecorations()
    termRef.current?.focus()
  }

  return (
    <div className={active ? 'terminal-view' : 'terminal-view is-hidden'}>
      <div className="terminal-host" ref={hostRef} />
      <SearchBar open={search.open} focusToken={search.focus} searchRef={searchRef} onClose={closeSearch} />
    </div>
  )
})
