import { mkdir, readFile, writeFile } from 'node:fs/promises'
import { dirname, resolve } from 'node:path'
import { renameRetrying } from '../fs/atomic'
import { pathKey } from '../projects/config'

/** repo root key → branch → ref. Maps, so a branch named `__proto__` is just a name. */
type Targets = Map<string, Map<string, string>>

const repoKey = (root: string) => pathKey(resolve(root))

const isObject = (x: unknown): x is Record<string, unknown> => typeof x === 'object' && x !== null && !Array.isArray(x)

/** Anything that isn't `{ repo: { branch: ref } }` is skipped; a broken file reads as empty. */
function parse(text: string): Targets {
  const targets: Targets = new Map()
  let raw: unknown
  try {
    raw = JSON.parse(text.replace(/^﻿/, ''))
  } catch {
    return targets
  }
  if (!isObject(raw)) return targets
  for (const [repo, branches] of Object.entries(raw)) {
    if (!isObject(branches)) continue
    const refs = new Map<string, string>()
    for (const [branch, ref] of Object.entries(branches)) if (typeof ref === 'string' && ref) refs.set(branch, ref)
    if (refs.size) targets.set(repoKey(repo), refs)
  }
  return targets
}

function serialise(targets: Targets): string {
  const plain = Object.fromEntries([...targets].map(([repo, refs]) => [repo, Object.fromEntries(refs)]))
  return `${JSON.stringify(plain, null, 2)}\n`
}

/**
 * Merge-target overrides chosen in Deck, `{ [repoRoot]: { [branch]: ref } }` in a JSON file in
 * userData: Deck never writes to a repo, so not `git config branch.<b>.mergeTarget`.
 */
export class TargetsStore {
  private cache: Promise<Targets> | null = null
  private queue: Promise<unknown> = Promise.resolve()

  constructor(private readonly file: string) {}

  private load(): Promise<Targets> {
    this.cache ??= readFile(this.file, 'utf8').then(parse, (err: NodeJS.ErrnoException) => {
      if (err.code === 'ENOENT') return new Map()
      this.cache = null // try again next time; never save over a file we couldn't read
      throw err
    })
    return this.cache
  }

  async get(repoRoot: string, branch: string): Promise<string | null> {
    return (await this.load()).get(repoKey(repoRoot))?.get(branch) ?? null
  }

  /** One write at a time, each written beside the file and renamed over it: never half a file. */
  set(repoRoot: string, branch: string, ref: string | null): Promise<void> {
    const result = this.queue.then(async () => {
      const next = new Map(await this.load())
      const key = repoKey(repoRoot)
      const refs = new Map(next.get(key))
      if (ref === null) refs.delete(branch)
      else refs.set(branch, ref)
      if (refs.size) next.set(key, refs)
      else next.delete(key)
      await mkdir(dirname(this.file), { recursive: true })
      const tmp = `${this.file}.${process.pid}.tmp`
      await writeFile(tmp, serialise(next), 'utf8')
      await renameRetrying(tmp, this.file)
      this.cache = Promise.resolve(next)
    })
    this.queue = result.catch(() => undefined)
    return result
  }
}
