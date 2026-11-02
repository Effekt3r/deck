import { Component, type ErrorInfo, type MouseEvent, type ReactNode } from 'react'
import type { ClipboardPreview } from '@shared/types'
import { displayPath } from '../git/format'
import { CloseIcon } from '../icons'
import { cardTitle, fileBadge } from './card'
import './clipboard.css'

interface ClipboardCardProps {
  item: ClipboardPreview
  /** For the folder line: '~/…' under it, as the Claude panel shows its own folder. */
  home: string
  /** Adding is under way. */
  busy: boolean
  /** Why the last Add failed. */
  error: string | null
  onAdd(id: string): void
  onDismiss(id: string): void
}

/** Clicking the card leaves the keyboard where it was: in the terminal. */
const keepFocus = (e: MouseEvent) => e.preventDefault()

/** What was just copied, with Add to Claude; under the Claude panel of a tab where Claude runs.
 *  A thrown render costs only the card, never the terminal next to it. */
export function ClipboardCard(props: ClipboardCardProps) {
  return (
    <Boundary itemId={props.item.id}>
      <CardBody {...props} />
    </Boundary>
  )
}

function CardBody({ item, home, busy, error, onAdd, onDismiss }: ClipboardCardProps) {
  const platform = window.deck.platform
  return (
    <section className="clip-card" aria-label="Clipboard" onMouseDown={keepFocus}>
      <div className="clip-head">
        <span className="clip-label">Clipboard</span>
        <span className="clip-title">{cardTitle(item)}</span>
        <span className="clip-spacer" />
        <button className="icon-button" title="Dismiss" aria-label="Dismiss" onClick={() => onDismiss(item.id)}>
          <CloseIcon size={10} />
        </button>
      </div>
      {item.kind === 'image' && item.thumbnail && <img className="clip-thumb" src={item.thumbnail} alt="Copied image" />}
      {item.kind === 'files' && item.thumbnails?.some(Boolean) && (
        <div className="clip-thumbs">
          {item.thumbnails.map((src, i) =>
            src ? <img key={i} className="clip-thumb" src={src} alt={item.names[i] ?? ''} title={item.names[i]} /> : null)}
        </div>
      )}
      {item.kind === 'files' && (
        <ul className="clip-files">
          {item.names.map((name, i) => (
            <li key={`${i}:${name}`} title={name}>
              {fileBadge(name) && <span className="clip-badge">{fileBadge(name)}</span>}
              <span className="clip-name">{name}</span>
            </li>
          ))}
          {item.more > 0 && <li className="clip-more">+{item.more} more</li>}
          <li className="clip-folder" title={item.folder}>{displayPath(item.folder, home, platform)}</li>
        </ul>
      )}
      {item.kind === 'text' && <pre className="clip-text">{item.lines.join('\n')}</pre>}
      {error && <div className="clip-error" role="alert">{error}</div>}
      <button className="button primary clip-add" disabled={busy}
        title={`Insert into the prompt (${platform === 'darwin' ? '⌘V' : 'Ctrl+V'} does the same)`}
        onClick={() => onAdd(item.id)}>
        {busy ? 'Adding…' : 'Add to Claude'}
      </button>
    </section>
  )
}

/** A thrown render (bad preview data) costs the card, never the terminal next to it. A new item gets another try. */
class Boundary extends Component<{ itemId: string; children: ReactNode }, { error: Error | null }> {
  state: { error: Error | null } = { error: null }

  static getDerivedStateFromError(error: unknown) {
    return { error: error instanceof Error ? error : new Error(String(error)) }
  }

  componentDidCatch(error: unknown, info: ErrorInfo) {
    console.error('Clipboard card:', error, info.componentStack)
  }

  componentDidUpdate(prev: { itemId: string }) {
    if (this.state.error && prev.itemId !== this.props.itemId) this.setState({ error: null })
  }

  render() {
    if (!this.state.error) return this.props.children
    return null
  }
}
