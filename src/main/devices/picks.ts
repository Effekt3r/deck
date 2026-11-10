import { mkdir, readFile } from 'node:fs/promises'
import { dirname, resolve } from 'node:path'
import { writeFileAtomic } from '../fs/atomic'
import { pathKey } from '../projects/config'

const keyOf = (root: string) => pathKey(resolve(root))

/** A project keeps this many of the devices picked in it. */
const KEEP = 8

/** A project's devices, latest first: one id (as Deck 0.4 wrote it) or a list; anything else is skipped. */
function idsOf(value: unknown): string[] {
  const ids = (Array.isArray(value) ? value : [value]).filter((id): id is string => typeof id === 'string' && id !== '')
  return [...new Set(ids)].slice(0, KEEP)
}

function parse(text: string): Map<string, string[]> {
  const picks = new Map<string, string[]>()
  let raw: unknown
  try {
    raw = JSON.parse(text.replace(/^﻿/, ''))
  } catch {
    return picks
  }
  if (typeof raw !== 'object' || raw === null || Array.isArray(raw)) return picks
  for (const [root, value] of Object.entries(raw)) {
    const ids = idsOf(value)
    if (ids.length > 0) picks.set(keyOf(root), ids)
  }
  return picks
}

/** The devices picked in each project, latest first: `{ [project root]: [device id, …] }` in
 *  devices.json (userData). */
export class PicksStore {
  private cache: Promise<Map<string, string[]>> | null = null
  private queue: Promise<unknown> = Promise.resolve()

  constructor(private readonly file: string) {}

  private load(): Promise<Map<string, string[]>> {
    this.cache ??= readFile(this.file, 'utf8').then(parse, (err: NodeJS.ErrnoException) => {
      if (err.code === 'ENOENT') return new Map<string, string[]>()
      this.cache = null // try again next time; never save over a file that couldn't be read
      throw err
    })
    return this.cache
  }

  async get(root: string): Promise<string[]> {
    return (await this.load()).get(keyOf(root)) ?? []
  }

  /** Puts `id` first among the project's devices. One write at a time, each beside the file and
   *  renamed over it. */
  set(root: string, id: string): Promise<void> {
    const result = this.queue.then(async () => {
      const next = new Map(await this.load())
      const key = keyOf(root)
      next.set(key, idsOf([id, ...(next.get(key) ?? [])]))
      await mkdir(dirname(this.file), { recursive: true })
      await writeFileAtomic(this.file, `${JSON.stringify(Object.fromEntries(next), null, 2)}\n`)
      this.cache = Promise.resolve(next)
    })
    this.queue = result.catch(() => undefined)
    return result
  }
}
