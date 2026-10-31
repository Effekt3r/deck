import { Component, memo, useCallback, useEffect, useLayoutEffect, useRef, useState, type ErrorInfo, type MouseEvent, type ReactNode } from 'react'
import type { ClaudeAgent, ClaudeSnapshot, ClaudeStatus, ClaudeTodo } from '@shared/types'
import { baseName, displayPath } from '../git/format'
import { Feed } from './Feed'
import { SessionPicker } from './SessionPicker'
import { agentsView, formatTokens, modeLabel, modelLabel, statusExtras, statusView, todoView } from './summary'
import type { ClaudeFeedState } from './useClaude'
import './panel.css'

interface ClaudePanelProps {
  /** Where the tab's Claude runs (the tab's cwd). */
  folder: string
  snapshot: ClaudeSnapshot | null
  phase: ClaudeFeedState['phase']
  error: string | null
  /** Claude runs in the tab now (by its process or title). */
  claudeRuns: boolean
  active: boolean
  home: string
  onRetry(): void
}

const THINKING_KEY = 'deck.claudeThinking'
const TODOS_KEY = 'deck.claudeTodosOpen'
const AGENTS_KEY = 'deck.claudeAgentsOpen'
/** A turn is open in these. */
const LIVE: ReadonlySet<ClaudeStatus['state']> = new Set(['working', 'tool', 'waiting', 'maybe-waiting'])

/** What Claude is doing in the tab's folder: status, model, context, branch and title,
 *  the to-do list, sub-agents and the feed. Read-only. A rendering error stays inside. */
export const ClaudePanel = memo(function ClaudePanel(props: ClaudePanelProps) {
  return (
    <Boundary session={props.snapshot?.session.id ?? ''}>
      <PanelBody {...props} />
    </Boundary>
  )
})

function PanelBody({ folder, snapshot, phase, error, claudeRuns, active, home, onRetry }: ClaudePanelProps) {
  const platform = window.deck.platform
  const [showThinking, toggleThinking] = useStoredFlag(THINKING_KEY, true)
  const [menuAnchor, setMenuAnchor] = useState<HTMLElement | null>(null)

  const anchorRef = useRef<HTMLElement | null>(null)
  useLayoutEffect(() => {
    anchorRef.current = menuAnchor
  }, [menuAnchor])
  const closeMenu = useCallback((refocus: boolean) => {
    const anchor = anchorRef.current
    setMenuAnchor(null)
    if (refocus) anchor?.focus()
  }, [])
  useEffect(() => {
    if (!active || !snapshot) setMenuAnchor(null) // it lives in <body>, outside the hidden tab
  }, [active, snapshot])

  if (!snapshot) {
    let body: ReactNode
    if (phase === 'error') {
      body = (
        <PanelState error title="Couldn't read Claude's session logs" detail={error}>
          <button className="button" onClick={onRetry}>Try again</button>
        </PanelState>
      )
    } else if (claudeRuns) body = <PanelState busy title="Waiting for Claude's first message…" />
    else if (phase === 'loading') body = <PanelState busy title="Looking for Claude sessions…" />
    else {
      body = (
        <PanelState title="No Claude Code session in this folder yet">
          <span className="cp-state-detail">Start <code>claude</code> in the terminal.</span>
        </PanelState>
      )
    }
    return (
      <div className="claude-panel">
        <header className="claude-header" onMouseDown={keepFocus}>
          <div className="cp-row">
            <span className="cp-name">Claude</span>
            {folder && <span className="cp-folder" title={displayPath(folder, home, platform)}>{baseName(folder)}</span>}
          </div>
        </header>
        <div className="cp-body">{body}</div>
      </div>
    )
  }

  const { session, status } = snapshot
  const pinned = snapshot.following === 'pinned'
  const extras = statusExtras(status)
  const written = new Date(session.modified).toLocaleString()
  return (
    <div className="claude-panel">
      {/* Clicking the header's text, like the tab bar, leaves the keyboard where it was (the terminal). */}
      <header className="claude-header" onMouseDown={keepFocus}>
        <div className="cp-row">
          <StatusChip status={status} modified={session.modified} />
          {extras.map((x) => <span key={x} className="cp-extra">· {x}</span>)}
          <span className="cp-spacer" />
          <button className="cp-icon-button cp-thinking" aria-pressed={showThinking}
            title={showThinking ? 'Hide thinking' : 'Show thinking'} aria-label="Show thinking" onClick={toggleThinking}>
            ✻
          </button>
        </div>
        <Meta session={session} />
        <div className="cp-row">
          <button className={pinned ? 'cp-session pinned' : 'cp-session'} aria-haspopup="menu" aria-expanded={menuAnchor !== null}
            title={`${session.title || 'Untitled session'}\n${session.id}\nLast written ${written}\n${pinned ? 'Pinned: click to follow the newest session again or pick another' : 'Click to pick another session'}`}
            onClick={(e) => {
              const button = e.currentTarget
              setMenuAnchor((a) => (a ? null : button))
            }}>
            <span className={session.title ? 'cp-title' : 'cp-title untitled'}>{session.title || 'Untitled session'}</span>
            {pinned && <span className="cp-pinned">pinned</span>}
            <Chevron />
          </button>
        </div>
      </header>
      {snapshot.todos.length > 0 && <Todos todos={snapshot.todos} />}
      {snapshot.agents.length > 0 && <Agents agents={snapshot.agents} />}
      {phase === 'error' && error && <div className="cp-banner" role="alert">{error}</div>}
      <Feed key={session.id} items={snapshot.feed} showThinking={showThinking} live={LIVE.has(status.state)} />
      {menuAnchor && (
        <SessionPicker folder={folder} current={session.id} following={snapshot.following} anchor={menuAnchor} onClose={closeMenu} />
      )}
    </div>
  )
}

const keepFocus = (e: MouseEvent) => {
  if (!(e.target as Element).closest('button')) e.preventDefault()
}

function StatusChip({ status, modified }: { status: ClaudeStatus; modified: number }) {
  useTick(15_000) // "quiet for Nm" moves on without a new snapshot
  const view = statusView(status, modified, Date.now())
  return (
    <span className={`cp-chip ${view.tone}`} title={view.title}>
      {view.spin ? <span className="cp-glyph spin" aria-hidden="true" /> : <span className="cp-glyph" aria-hidden="true">{view.glyph}</span>}
      <span className="cp-chip-label">{view.label}</span>
    </span>
  )
}

function Meta({ session }: { session: ClaudeSnapshot['session'] }) {
  const parts: ReactNode[] = []
  const model = modelLabel(session.model)
  if (model) parts.push(<span key="model" className="cp-model" title={session.model}>{model}</span>)
  if (session.contextTokens > 0) {
    parts.push(
      <span key="ctx" className="cp-ctx" title={`${session.contextTokens.toLocaleString()} tokens of context`}>
        ctx {formatTokens(session.contextTokens)}
      </span>,
    )
  }
  if (session.branch) parts.push(<span key="branch" className="cp-branch" title={session.branch}>⎇ {session.branch}</span>)
  const mode = modeLabel(session.mode)
  if (mode) parts.push(<span key="mode" className={`cp-mode m-${session.mode}`} title={`Permission mode: ${session.mode}`}>{mode}</span>)
  if (session.pr) parts.push(<span key="pr" className="cp-pr">{session.pr}</span>)
  return parts.length ? <div className="cp-row cp-meta">{parts}</div> : null
}

function Todos({ todos }: { todos: ClaudeTodo[] }) {
  const [open, toggle] = useStoredFlag(TODOS_KEY, true)
  const view = todoView(todos)
  const share = view.total ? view.done / view.total : 0
  return (
    <section className="cp-section" aria-label="To-do list">
      <button className="cp-section-head" aria-expanded={open} onClick={toggle}>
        <Caret />
        <span className="cp-section-name">To-do</span>
        <span className="cp-count">{view.done}/{view.total}</span>
        <span className="cp-progress" aria-hidden="true"><span style={{ width: `${Math.round(share * 100)}%` }} /></span>
      </button>
      {open && (
        <ul className="cp-list">
          {view.shown.map((todo, i) => {
            const state = todo.status === 'completed' ? 'done' : todo.status === 'in_progress' ? 'doing' : 'pending'
            return (
              <li key={i} className={`cp-todo ${state}`} title={todo.text}>
                <span className="cp-mark" aria-hidden="true">{state === 'done' ? '✓' : state === 'doing' ? '▸' : '○'}</span>
                <span className="cp-todo-text">{todo.text}</span>
              </li>
            )
          })}
          {view.hidden > 0 && <li className="cp-more">+{view.hidden} more</li>}
        </ul>
      )}
    </section>
  )
}

function Agents({ agents }: { agents: ClaudeAgent[] }) {
  const [open, toggle] = useStoredFlag(AGENTS_KEY, true)
  const view = agentsView(agents)
  return (
    <section className="cp-section" aria-label="Sub-agents">
      <button className="cp-section-head" aria-expanded={open} onClick={toggle}>
        <Caret />
        <span className="cp-section-name">Agents</span>
        <span className="cp-count">{view.runningCount} running · {view.doneCount} done</span>
      </button>
      {open && (
        <ul className="cp-list">
          {view.running.map((a) => <AgentRow key={a.toolUseId} agent={a} />)}
          {view.hidden > 0 && <li className="cp-more">+{view.hidden} more running</li>}
          {view.finished.map((a) => <AgentRow key={a.toolUseId} agent={a} />)}
        </ul>
      )}
    </section>
  )
}

function AgentRow({ agent }: { agent: ClaudeAgent }) {
  const state = !agent.done ? 'running' : agent.failed ? 'failed' : 'done'
  const step = state === 'running' ? agent.step : undefined
  const title = `${agent.type}: ${agent.description}${state === 'failed' ? ' (failed)' : state === 'done' ? ' (done)' : ''}${step ? `\n↳ ${step}` : ''}`
  return (
    <li className={`cp-agent ${state}`} title={title}>
      <span className="cp-mark" aria-hidden="true">{state === 'failed' ? '✗' : state === 'done' ? '✓' : ''}</span>
      <span className="cp-agent-main">
        <span className="cp-agent-type">{agent.type}</span>
        <span className="cp-agent-desc">{agent.description}</span>
      </span>
      {step && <span className="cp-agent-step">↳ {step}</span>}
    </li>
  )
}

function PanelState({ title, detail, busy, error, children }: {
  title: string
  detail?: string | null
  busy?: boolean
  error?: boolean
  children?: ReactNode
}) {
  return (
    <div className={error ? 'cp-state error' : 'cp-state'} role="status">
      {busy && <span className="cp-spinner" aria-hidden="true" />}
      <strong>{title}</strong>
      {detail && <span className="cp-state-detail">{detail}</span>}
      {children}
    </div>
  )
}

/** A thrown render (a snapshot main got wrong) costs the panel, never the terminal next to
 *  it. Another session gets another try. */
class Boundary extends Component<{ session: string; children: ReactNode }, { error: Error | null }> {
  state: { error: Error | null } = { error: null }

  static getDerivedStateFromError(error: unknown) {
    return { error: error instanceof Error ? error : new Error(String(error)) }
  }

  componentDidCatch(error: unknown, info: ErrorInfo) {
    console.error('Claude panel:', error, info.componentStack)
  }

  componentDidUpdate(prev: { session: string }) {
    if (this.state.error && prev.session !== this.props.session) this.setState({ error: null })
  }

  render() {
    if (!this.state.error) return this.props.children
    return (
      <div className="claude-panel">
        <div className="cp-body">
          <PanelState error title="The Claude panel couldn't show this session" detail={this.state.error.message}>
            <button className="button" onClick={() => this.setState({ error: null })}>Try again</button>
          </PanelState>
        </div>
      </div>
    )
  }
}

/** A remembered on/off setting (localStorage; per window when that's unavailable). */
function useStoredFlag(key: string, fallback: boolean): [boolean, () => void] {
  const [value, setValue] = useState(() => {
    try {
      const stored = localStorage.getItem(key)
      return stored === null ? fallback : stored === '1'
    } catch {
      return fallback
    }
  })
  useEffect(() => {
    try {
      localStorage.setItem(key, value ? '1' : '0')
    } catch {
      // Storage unavailable: it lasts until the window closes.
    }
  }, [key, value])
  return [value, useCallback(() => setValue((v) => !v), [])]
}

/** Re-renders every `ms`. */
function useTick(ms: number): void {
  const [, setTick] = useState(0)
  useEffect(() => {
    const timer = setInterval(() => setTick((t) => t + 1), ms)
    return () => clearInterval(timer)
  }, [ms])
}

const Chevron = () => (
  <svg className="cp-chevron" width="10" height="10" viewBox="0 0 16 16" fill="none" stroke="currentColor" strokeWidth="2"
    strokeLinecap="round" strokeLinejoin="round" aria-hidden="true">
    <path d="M4 6l4 4 4-4" />
  </svg>
)

const Caret = () => (
  <svg className="cp-caret" width="9" height="9" viewBox="0 0 16 16" fill="currentColor" aria-hidden="true">
    <path d="M3.5 5.5h9L8 11z" />
  </svg>
)
