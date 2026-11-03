import { mkdir, readFile } from 'node:fs/promises'
import { dirname, resolve } from 'node:path'
import { writeFileAtomic } from '../fs/atomic'
import { pathKey } from '../projects/config'

const keyOf = (root: string) => pathKey(resolve(root))

function parse(text: string): Map<string, string> {
  const picks = new Map<string, string>()
  let raw: unknown
  try {
    raw = JSON.parse(text.replace(/^﻿/, ''))
  } catch {
    return picks
  }
  if (typeof raw !== 'object' || raw === null || Array.isArray(raw)) return picks
  for (const [root, id] of Object.entries(raw)) if (typeof id === 'string' && id) picks.set(keyOf(root), id)
  return picks
}

/** Each project's device, `{ [project root]: device id }` in devices.json (userData). */
export class PicksStore {
  private cache: Promise<Map<string, string>> | null = null
  private queue: Promise<unknown> = Promise.resolve()

  constructor(private readonly file: string) {}

  private load(): Promise<Map<string, string>> {
    this.cache ??= readFile(this.file, 'utf8').then(parse, (err: NodeJS.ErrnoException) => {
      if (err.code === 'ENOENT') return new Map<string, string>()
      this.cache = null // try again next time; never save over a file that couldn't be read
      throw err
    })
    return this.cache
  }

  async get(root: string): Promise<string | null> {
    return (await this.load()).get(keyOf(root)) ?? null
  }

  /** One write at a time, each beside the file and renamed over it. */
  set(root: string, id: string): Promise<void> {
    const result = this.queue.then(async () => {
      const next = new Map(await this.load())
      next.set(keyOf(root), id)
      await mkdir(dirname(this.file), { recursive: true })
      await writeFileAtomic(this.file, `${JSON.stringify(Object.fromEntries(next), null, 2)}\n`)
      this.cache = Promise.resolve(next)
    })
    this.queue = result.catch(() => undefined)
    return result
  }
}
