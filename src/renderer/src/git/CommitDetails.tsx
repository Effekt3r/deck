import { useEffect, useMemo, useState } from 'react'
import type { GitCommit, GitCommitDetails, GitFileChange } from '@shared/types'
import { CloseIcon } from '../icons'
import { ago } from '../projects/filter'
import { errorText } from './format'

interface CommitDetailsProps {
  repo: string
  hash: string
  /** The commit from the loaded list, shown at once while the details load. */
  commit?: GitCommit
  onClose(): void
  /** A parent's hash was clicked. */
  onSelect(hash: string): void
}

/** Wait this long after the selection moves before asking git, so holding ↓ doesn't spawn a process per row. */
const DEBOUNCE_MS = 90
const MAX_FILES = 500

// Commits never change, so their details can be kept; bounded, oldest out first.
const cache = new Map<string, GitCommitDetails>()
const CACHE_SIZE = 200
function remember(key: string, details: GitCommitDetails) {
  cache.delete(key)
  cache.set(key, details)
  if (cache.size > CACHE_SIZE) cache.delete(cache.keys().next().value!)
}

type Loaded = { hash: string; details: GitCommitDetails | null; error?: string }

export function CommitDetails({ repo, hash, commit, onClose, onSelect }: CommitDetailsProps) {
  const key = `${repo}\0${hash}`
  const [loaded, setLoaded] = useState<Loaded | null>(() => (cache.has(key) ? { hash, details: cache.get(key)! } : null))
  const [copied, setCopied] = useState(false)

  useEffect(() => {
    const hit = cache.get(key)
    if (hit) {
      setLoaded({ hash, details: hit })
      return
    }
    let live = true
    const timer = setTimeout(() => {
      window.deck.git.details(repo, hash).then(
        (details) => {
          if (!live) return
          if (details) remember(key, details)
          setLoaded({ hash, details })
        },
        (err: unknown) => {
          if (live) setLoaded({ hash, details: null, error: errorText(err) })
        },
      )
    }, DEBOUNCE_MS)
    return () => {
      live = false
      clearTimeout(timer)
    }
  }, [repo, hash, key])

  useEffect(() => setCopied(false), [hash])
  useEffect(() => {
    if (!copied) return
    const timer = setTimeout(() => setCopied(false), 1500)
    return () => clearTimeout(timer)
  }, [copied])

  const current = loaded?.hash === hash ? loaded : null
  const details = current?.details ?? null
  const message = details?.message ?? commit?.subject ?? ''
  const newline = message.indexOf('\n')
  const subject = newline < 0 ? message : message.slice(0, newline)
  const body = newline < 0 ? '' : message.slice(newline + 1).replace(/^\s*\n/, '').trimEnd()
  const author = details?.author ?? commit?.author
  const time = details?.time ?? commit?.time
  const parents = details?.parents ?? commit?.parents ?? []

  const copy = () => {
    window.deck.app.copyText(hash)
    setCopied(true)
  }

  return (
    <section className="commit-details" aria-label="Commit details">
      <div className="cd-bar">
        <span className="cd-hash" title={hash}>{hash.slice(0, 10)}</span>
        <button className={copied ? 'cd-copy copied' : 'cd-copy'} onClick={copy} title={`Copy ${hash}`}>
          {copied ? '✓ Copied' : 'Copy hash'}
        </button>
        <span className="cd-spacer" />
        <button className="icon-button" title="Close (Esc)" aria-label="Close details" onClick={onClose}>
          <CloseIcon size={12} />
        </button>
      </div>
      <div className="cd-scroll">
        {subject && <h3 className="cd-subject">{subject}</h3>}
        {body && <p className="cd-body">{body}</p>}
        <dl className="cd-meta">
          {author && (
            <>
              <dt>Author</dt>
              <dd title={details?.email ? `${author} <${details.email}>` : author}>
                {author}{details?.email && <span className="cd-email"> &lt;{details.email}&gt;</span>}
              </dd>
            </>
          )}
          {time !== undefined && (
            <>
              <dt>Date</dt>
              <dd>{new Date(time).toLocaleString(undefined, { dateStyle: 'medium', timeStyle: 'short' })}
                <span className="cd-ago"> · {ago(time, Date.now())} ago</span></dd>
            </>
          )}
          {parents.length > 0 && (
            <>
              <dt>{parents.length > 1 ? 'Parents' : 'Parent'}</dt>
              <dd className="cd-parents">
                {parents.map((p) => (
                  <button key={p} className="cd-parent" title={`Show ${p}`} onClick={() => onSelect(p)}>{p.slice(0, 7)}</button>
                ))}
              </dd>
            </>
          )}
        </dl>
        <Files current={current} merge={parents.length > 1} />
      </div>
    </section>
  )
}

function Files({ current, merge }: { current: Loaded | null; merge: boolean }) {
  const files = current?.details?.files
  const totals = useMemo(() => {
    let add = 0
    let del = 0
    for (const f of files ?? []) {
      add += f.additions ?? 0
      del += f.deletions ?? 0
    }
    return { add, del }
  }, [files])

  if (!current) return <p className="cd-note">Loading changes…</p>
  if (current.error) return <p className="cd-note error">Couldn't read this commit: {current.error}</p>
  if (!files) return <p className="cd-note">This commit isn't in the repository any more.</p>
  return (
    <>
      <div className="cd-files-head">
        <span>{files.length === 1 ? '1 file' : `${files.length} files`}</span>
        {totals.add > 0 && <span className="cd-add">+{totals.add}</span>}
        {totals.del > 0 && <span className="cd-del">−{totals.del}</span>}
        {merge && <span className="cd-against">against the first parent</span>}
      </div>
      {files.length === 0 && <p className="cd-note">No changes.</p>}
      <ul className="cd-files">
        {files.slice(0, MAX_FILES).map((f) => <FileRow key={`${f.status}:${f.oldPath ?? ''}:${f.path}`} file={f} />)}
      </ul>
      {files.length > MAX_FILES && <p className="cd-note">…and {files.length - MAX_FILES} more files.</p>}
    </>
  )
}

const STATUS: Record<string, string> = {
  A: 'Added', M: 'Modified', D: 'Deleted', R: 'Renamed', C: 'Copied', T: 'Type changed', U: 'Unmerged',
}

function FileRow({ file }: { file: GitFileChange }) {
  const status = file.status.charAt(0) || '?'
  const cut = file.path.lastIndexOf('/') + 1 // git prints '/' on every platform
  const title = `${STATUS[status] ?? status}: ${file.oldPath ? `${file.oldPath} → ` : ''}${file.path}`
  return (
    <li className="cd-file" title={title}>
      <span className={`cd-status s-${status}`}>{status}</span>
      <span className="cd-path">
        {file.oldPath && <span className="cd-dir">{file.oldPath} → </span>}
        <span className="cd-dir">{file.path.slice(0, cut)}</span>
        <span className="cd-base">{file.path.slice(cut)}</span>
      </span>
      <span className="cd-stat">
        {file.additions === null || file.deletions === null
          ? <span className="cd-bin">bin</span>
          : (
            <>
              {file.additions > 0 && <span className="cd-add">+{file.additions}</span>}
              {file.deletions > 0 && <span className="cd-del"> −{file.deletions}</span>}
            </>
          )}
      </span>
    </li>
  )
}
