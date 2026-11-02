import { Component, type ErrorInfo, type MouseEvent, type ReactNode, useEffect, useRef, useState } from 'react'
import type { UsageChange, UsageLink, UsageState } from '@shared/types'
import { displayPath } from '../git/format'
import { useTick } from '../hooks'
import { Caret } from '../icons'
import { Donut } from './Donut'
import { type UsageView, usageView } from './view'
import './usage.css'

interface UsageCardProps {
  state: UsageState
  /** For the settings path: '~/…' under it. */
  home: string
  /** Unfolded; one flag for the window, so every tab's card folds together. */
  open: boolean
  onToggle(): void
  /** After Connect, Replace or Disconnect, the keyboard is nowhere (the button that had it is gone
   *  or was disabled): the tab gives it to its terminal. */
  onFocusLost(): void
}

/** Clicking the card leaves the keyboard where it was: in the terminal. */
const keepFocus = (e: MouseEvent) => e.preventDefault()

/** Claude's plan usage, as Claude Code's status line last reported it: at the bottom of the Claude
 *  pane, above the clipboard card. A thrown render costs only the card. */
export function UsageCard(props: UsageCardProps) {
  return (
    <Boundary resetKey={`${props.state.link.state}:${props.state.updatedAt}`}>
      <CardBody {...props} />
    </Boundary>
  )
}

function CardBody({ state, home, open, onToggle, onFocusLost }: UsageCardProps) {
  const [busy, setBusy] = useState(false)
  const [error, setError] = useState<string | null>(null)
  /** An action has just settled: the effect below looks where the keyboard went. */
  const settled = useRef(false)
  useTick(30_000) // countdowns and "updated … ago" move on without a new state
  const view = usageView(state, Date.now())
  const { link } = state

  const run = (action: () => Promise<UsageChange>) => {
    setBusy(true)
    setError(null)
    action()
      .then(
        (result) => setError('error' in result ? result.error : null),
        (err: unknown) => setError(err instanceof Error ? err.message : String(err)),
      )
      .finally(() => {
        settled.current = true
        setBusy(false)
      })
  }
  const connect = (replace: boolean) => run(() => window.deck.usage.connect(replace))
  const disconnect = () => run(() => window.deck.usage.disconnect())

  // By the time an action settles, the card shows its outcome (main pushes the new state before it
  // answers). A button pressed from the keyboard may be gone (Connect turns into the donut) or have
  // lost the keyboard while disabled: rather than nowhere, the keyboard goes back to the terminal.
  useEffect(() => {
    if (busy || !settled.current) return
    settled.current = false
    const focused = document.activeElement
    if (!focused || focused === document.body) onFocusLost()
  }, [busy, onFocusLost])

  return (
    <section className="usage-card" aria-label="Claude usage" onMouseDown={keepFocus}>
      <button className="cp-section-head usage-head" aria-expanded={open} onClick={onToggle}>
        <Caret />
        <span className="cp-section-name">Usage</span>
        <Summary link={link} view={view} />
      </button>
      {open && (
        <div className="usage-body">
          {link.state === 'connected' && view.rings.length > 0 && (
            <div className="usage-main">
              <Donut rings={view.rings} top={view.top} label={view.label} />
              <ul className="usage-legend">
                {view.rings.map((r) => (
                  <li key={r.key}>
                    <span className={`usage-dot ring-${r.key}`} aria-hidden="true" />
                    <span className="usage-name">{r.label}</span>
                    <span className={`usage-pct tone-${r.tone}`}>{r.percent}%</span>
                    <span className={r.past ? 'usage-reset past' : 'usage-reset'}>{r.reset}</span>
                  </li>
                ))}
              </ul>
            </div>
          )}
          {link.state === 'connected' && view.rings.length === 0 && (
            <p className="usage-text">
              Waiting for Claude's next reply.
              <span className="usage-note">
                Claude Code reports usage on Pro, Max and Ultra plans, and runs status lines only in folders you trust
                and while hooks are on.
              </span>
            </p>
          )}
          {link.state === 'off' && (
            <>
              <p className="usage-text">See your Claude plan usage here. Deck reads it from Claude Code's status line.</p>
              <div className="usage-actions">
                <button className="button primary" disabled={busy} onClick={() => connect(false)}>
                  {busy ? 'Connecting…' : 'Connect'}
                </button>
              </div>
              <p className="usage-note">
                Adds a status line to Claude Code's settings
                (<code>{displayPath(state.settingsFile, home, window.deck.platform)}</code>). Claude Code then hides
                its footer hints, like “esc to interrupt”. Disconnect undoes it.
              </p>
            </>
          )}
          {link.state === 'other' && (
            <>
              <p className="usage-text">Claude Code already has a status line:</p>
              <code className="usage-command" title={link.command}>{link.command}</code>
              <div className="usage-actions">
                <button className="button" disabled={busy} onClick={() => connect(true)}>
                  {busy ? 'Connecting…' : 'Replace it'}
                </button>
              </div>
              <p className="usage-note">Deck reads usage through the status line, so connecting replaces this one; Disconnect puts it back.</p>
            </>
          )}
          {link.state === 'error' && <div className="usage-error" role="alert">{link.message}</div>}
          {error && <div className="usage-error" role="alert">{error}</div>}
          {link.state === 'connected' && (
            <div className="usage-foot">
              <span>{view.updated}</span>
              <span className="usage-spacer" />
              <button className="link-button" disabled={busy} onClick={disconnect}>Disconnect</button>
            </div>
          )}
        </div>
      )}
    </section>
  )
}

/** The heading's summary: the percentages when connected, else the link's state. */
function Summary({ link, view }: { link: UsageLink; view: UsageView }) {
  if (link.state !== 'connected') return <span className="usage-sum">{link.state === 'error' ? 'unavailable' : 'not connected'}</span>
  if (!view.rings.length) return <span className="usage-sum">waiting for Claude</span>
  return (
    <span className="usage-sum" title={view.summary}>
      {view.rings.map((r, i) => (
        <span key={r.key}>
          {i > 0 && ' · '}
          {r.key} <span className={`cp-count tone-${r.tone}`}>{r.percent}%</span>
        </span>
      ))}
    </span>
  )
}

/** A thrown render (a state main got wrong) costs the card, never the panel or terminal next to it.
 *  A new state (another link, a newer report) gets another try. */
class Boundary extends Component<{ resetKey: string; children: ReactNode }, { error: Error | null }> {
  state: { error: Error | null } = { error: null }

  static getDerivedStateFromError(error: unknown) {
    return { error: error instanceof Error ? error : new Error(String(error)) }
  }

  componentDidCatch(error: unknown, info: ErrorInfo) {
    console.error('Usage card:', error, info.componentStack)
  }

  componentDidUpdate(prev: { resetKey: string }) {
    if (this.state.error && prev.resetKey !== this.props.resetKey) this.setState({ error: null })
  }

  render() {
    return this.state.error ? null : this.props.children
  }
}
