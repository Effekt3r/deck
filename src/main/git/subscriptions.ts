import { resolve } from 'node:path'
import type { GitSnapshot } from '@shared/types'
import { pathKey } from '../projects/config'
import type { GitDirs } from './summary'

/** A subscriber, i.e. a renderer (webContents). */
export interface Client {
  id: number
  send(repo: string, snapshot: GitSnapshot): void
}

export interface SubscriptionDeps {
  /** null: not a repo. */
  resolve(repo: string): Promise<GitDirs | null>
  snapshot(dirs: GitDirs): Promise<GitSnapshot>
  /** Calls onChange whenever the repo may have changed; returns a stop function. */
  watch(dirs: GitDirs, onChange: () => void): () => void
}

/** One client's subscriptions to one folder (`repo` exactly as it was passed). */
interface Sub {
  client: Client
  repo: string
  count: number
  watched: Watched | null
  gone: boolean
}

/** A watched repo root. */
interface Watched {
  key: string
  dirs: GitDirs
  subs: Set<Sub>
  stop: () => void
  snapshot: GitSnapshot | null
  json: string | null
  error: unknown
  running: Promise<void> | null
  again: boolean
  /** subscribe() calls waiting on a snapshot: they keep the watcher alive. */
  pending: number
  closed: boolean
}

const rootKey = (root: string) => pathKey(resolve(root))
const subKey = (clientId: number, repo: string) => `${clientId}\0${repo}`

/**
 * Who watches which repo: one watcher per repo root, however many clients and folders inside it
 * subscribe; a snapshot is pushed only when it changed, and never built twice at once for a repo.
 */
export class RepoSubscriptions {
  private readonly subs = new Map<string, Sub>()
  private readonly repos = new Map<string, Watched>()

  constructor(private readonly deps: SubscriptionDeps) {}

  /** The repo's current snapshot (null: not a repo); pushes follow until unsubscribe(). Rejects
   *  when there is no snapshot yet because git failed (the subscription stays and recovers). */
  async subscribe(client: Client, repo: string): Promise<GitSnapshot | null> {
    const key = subKey(client.id, repo)
    let sub = this.subs.get(key)
    if (!sub) {
      sub = { client, repo, count: 0, watched: null, gone: false }
      this.subs.set(key, sub)
    }
    sub.count++
    const dirs = sub.watched?.dirs ?? (await this.deps.resolve(repo).catch(() => null))
    if (!dirs) {
      this.release(sub)
      return null
    }
    const watched = sub.watched ?? this.watch(dirs)
    watched.pending++
    try {
      await this.rebuild(watched)
    } finally {
      watched.pending--
    }
    // Attached only now, so the snapshot just built isn't also pushed to this client. An
    // unsubscribe that arrived while git was busy has already made `sub` gone.
    if (!sub.gone && !sub.watched) {
      sub.watched = watched
      watched.subs.add(sub)
    }
    this.closeIfUnused(watched)
    if (!watched.snapshot) throw watched.error
    return watched.snapshot
  }

  unsubscribe(clientId: number, repo: string): void {
    const sub = this.subs.get(subKey(clientId, repo))
    if (sub) this.release(sub)
  }

  /** Everything `clientId` subscribed to (its webContents was destroyed or reloaded). */
  drop(clientId: number): void {
    for (const sub of [...this.subs.values()]) if (sub.client.id === clientId) this.remove(sub)
  }

  /** Rebuild a watched repo's snapshot now, e.g. after its merge-target override changed. */
  async refresh(root: string): Promise<void> {
    const watched = this.repos.get(rootKey(root))
    if (watched) await this.rebuild(watched)
  }

  private watch(dirs: GitDirs): Watched {
    const key = rootKey(dirs.root)
    const existing = this.repos.get(key)
    if (existing) return existing
    const watched: Watched = {
      key, dirs, subs: new Set(), stop: () => {}, snapshot: null, json: null, error: null,
      running: null, again: false, pending: 0, closed: false,
    }
    watched.stop = this.deps.watch(dirs, () => void this.rebuild(watched))
    this.repos.set(key, watched)
    return watched
  }

  /** Builds the snapshot and pushes it if it changed. A change that arrives while a build runs
   *  gets one more build afterwards; the returned promise covers that one too. */
  private rebuild(watched: Watched): Promise<void> {
    if (watched.closed) return Promise.resolve()
    if (watched.running) {
      watched.again = true
      return watched.running
    }
    watched.running = (async () => {
      do {
        watched.again = false
        try {
          const snapshot = await this.deps.snapshot(watched.dirs)
          watched.error = null
          const json = JSON.stringify(snapshot)
          if (json === watched.json) continue
          watched.json = json
          watched.snapshot = snapshot
          for (const sub of watched.subs) {
            try {
              sub.client.send(sub.repo, snapshot)
            } catch {
              // A renderer going away mid-send; the others still get theirs.
            }
          }
        } catch (err) {
          watched.error = err // the last good snapshot stays; the next change or poll retries
        }
      } while (watched.again && !watched.closed)
    })().finally(() => {
      watched.running = null
    })
    return watched.running
  }

  private release(sub: Sub): void {
    if (!sub.gone && --sub.count <= 0) this.remove(sub)
  }

  private remove(sub: Sub): void {
    if (sub.gone) return
    sub.gone = true
    sub.count = 0
    const key = subKey(sub.client.id, sub.repo)
    if (this.subs.get(key) === sub) this.subs.delete(key)
    if (sub.watched) {
      sub.watched.subs.delete(sub)
      this.closeIfUnused(sub.watched)
    }
  }

  private closeIfUnused(watched: Watched): void {
    if (watched.closed || watched.subs.size > 0 || watched.pending > 0) return
    watched.closed = true
    watched.stop()
    if (this.repos.get(watched.key) === watched) this.repos.delete(watched.key)
  }
}
