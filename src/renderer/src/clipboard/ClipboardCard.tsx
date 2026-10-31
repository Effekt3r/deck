import type { MouseEvent } from 'react'
import type { ClipboardPreview } from '@shared/types'
import { CloseIcon } from '../icons'
import { cardTitle, fileBadge } from './card'
import './clipboard.css'

interface ClipboardCardProps {
  item: ClipboardPreview
  /** Adding is under way. */
  busy: boolean
  /** Why the last Add failed. */
  error: string | null
  onAdd(id: string): void
  onDismiss(id: string): void
}

/** Clicking the card leaves the keyboard where it was: in the terminal. */
const keepFocus = (e: MouseEvent) => e.preventDefault()

/** What was just copied, with Add to Claude; under the Claude panel of a tab where Claude runs. */
export function ClipboardCard({ item, busy, error, onAdd, onDismiss }: ClipboardCardProps) {
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
      {item.kind === 'files' && (
        <ul className="clip-files">
          {item.names.map((name, i) => (
            <li key={`${i}:${name}`} title={name}>
              {fileBadge(name) && <span className="clip-badge">{fileBadge(name)}</span>}
              <span className="clip-name">{name}</span>
            </li>
          ))}
          {item.more > 0 && <li className="clip-more">+{item.more} more</li>}
          <li className="clip-folder" title={item.folder}>{item.folder}</li>
        </ul>
      )}
      {item.kind === 'text' && <pre className="clip-text">{item.lines.join('\n')}</pre>}
      {error && <div className="clip-error" role="alert">{error}</div>}
      <button className="button primary clip-add" disabled={busy} onClick={() => onAdd(item.id)}>
        Add to Claude
      </button>
    </section>
  )
}
