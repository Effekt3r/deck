import '@xterm/xterm/css/xterm.css'
import './styles.css'
import { StrictMode } from 'react'
import { createRoot } from 'react-dom/client'
import { App } from './App'

const root = document.getElementById('root')!

// StrictMode mounts effects twice in dev: TerminalView kills the pty of the first mount.
if (window.deck) createRoot(root).render(<StrictMode><App /></StrictMode>)
else root.textContent = 'Deck could not start: the preload bridge is missing.'
