import { useState, type FormEvent, type KeyboardEvent } from 'react'
import type { ProjectsConfig } from '@shared/types'
import { CloseIcon } from '../icons'

interface Props {
  config: ProjectsConfig
  onSaved(config: ProjectsConfig): void
  onCancel(): void
}

const lines = (text: string) => text.split(/\r?\n/).map((l) => l.trim()).filter(Boolean)

/** 1–6; an empty or non-numeric field keeps the current depth. */
function parseDepth(text: string, current: number): number {
  const n = Math.round(Number(text))
  return text.trim() && Number.isFinite(n) ? Math.min(6, Math.max(1, n)) : current
}

/** Edits projects.json; main normalises what it gets (empty command → default, depth 1–6). */
export function Settings({ config, onSaved, onCancel }: Props) {
  const [command, setCommand] = useState(config.command)
  const [scan, setScan] = useState(config.scan.join('\n'))
  const [depth, setDepth] = useState(String(config.depth))
  const [pinned, setPinned] = useState(config.pinned.join('\n'))
  const [saving, setSaving] = useState(false)
  const [error, setError] = useState<string | null>(null)

  const save = async (e: FormEvent) => {
    e.preventDefault()
    setSaving(true)
    setError(null)
    try {
      const next = await window.deck.projects.setConfig({
        command: command.trim(),
        scan: lines(scan),
        pinned: lines(pinned),
        depth: parseDepth(depth, config.depth),
      })
      onSaved(next)
    } catch (err) {
      setError(err instanceof Error ? err.message : String(err))
      setSaving(false)
    }
  }

  const onKeyDown = (e: KeyboardEvent) => {
    if (e.key === 'Escape') {
      e.preventDefault()
      onCancel()
    }
  }

  return (
    <div className="settings-backdrop" onMouseDown={(e) => e.target === e.currentTarget && onCancel()}>
      <form className="settings" onSubmit={save} onKeyDown={onKeyDown} aria-label="Projects settings">
        <div className="settings-title">
          <h2>Projects settings</h2>
          <button type="button" className="icon-button" title="Close (Esc)" onClick={onCancel}>
            <CloseIcon size={12} />
          </button>
        </div>

        <label className="field">
          <span className="field-label">Command</span>
          <input value={command} onChange={(e) => setCommand(e.target.value)} spellCheck={false} autoFocus />
          <span className="field-hint">Typed into the new tab when you double-click a project.</span>
        </label>

        <label className="field">
          <span className="field-label">Scan folders</span>
          <textarea value={scan} onChange={(e) => setScan(e.target.value)} rows={3} spellCheck={false} />
          <span className="field-hint">One per line. Their sub-folders and the git repos inside them are listed.</span>
        </label>

        <label className="field field-depth">
          <span className="field-label">Depth</span>
          <input type="number" min={1} max={6} value={depth} onChange={(e) => setDepth(e.target.value)} />
          <span className="field-hint">How deep to look for git repos under each scan folder (1 = direct children).</span>
        </label>

        <label className="field">
          <span className="field-label">Pinned</span>
          <textarea value={pinned} onChange={(e) => setPinned(e.target.value)} rows={3} spellCheck={false} />
          <span className="field-hint">One per line; always listed first, in this order.</span>
        </label>

        {error && <p className="settings-error">Couldn't save: {error}</p>}

        <div className="settings-actions">
          <button type="button" className="button" onClick={onCancel}>Cancel</button>
          <button type="submit" className="button primary" disabled={saving}>{saving ? 'Saving…' : 'Save'}</button>
        </div>
      </form>
    </div>
  )
}
