import { mkdir, readFile, rename, writeFile } from 'node:fs/promises'
import { dirname, join, resolve } from 'node:path'
import type { ProjectsConfig } from '@shared/types'

export const DEFAULT_COMMAND = 'claude --effort max --model claude-opus-5-5 --remote-control'

export function defaultConfig(): ProjectsConfig {
  return { command: DEFAULT_COMMAND, pinned: [], scan: ['~/Development'], depth: 2 }
}

/** `~`, `~/x` and `~\x` point into `home`; anything else is returned as it is. */
export function expandHome(p: string, home: string): string {
  if (p === '~') return home
  return /^~[\\/]/.test(p) ? join(home, p.slice(2)) : p
}

/** A pinned or scan folder as an absolute, normalised path (a relative one counts from home). */
export function resolvePath(p: string, home: string): string {
  return resolve(home, expandHome(p, home))
}

/** Paths compare the way the file system does: case-insensitively on Windows. */
export function pathKey(p: string): string {
  return process.platform === 'win32' ? p.toLowerCase() : p
}

const samePath = (a: string, b: string, home: string) => pathKey(resolvePath(a, home)) === pathKey(resolvePath(b, home))

export function isPinned(config: ProjectsConfig, path: string, home: string): boolean {
  return config.pinned.some((p) => samePath(p, path, home))
}

/** Unpins `path` however it is written in the config (`~/…`, other case on Windows), else pins it last. */
export function togglePinned(config: ProjectsConfig, path: string, home: string): ProjectsConfig {
  const kept = config.pinned.filter((p) => !samePath(p, path, home))
  return { ...config, pinned: kept.length < config.pinned.length ? kept : [...kept, path] }
}

const strings = (list: unknown[]) => list.filter((x): x is string => typeof x === 'string' && x.trim() !== '')

/** Field by field: valid values are kept, anything else gets the default. */
export function normalizeConfig(raw: unknown): ProjectsConfig {
  const config = defaultConfig()
  if (typeof raw !== 'object' || raw === null) return config
  const { command, pinned, scan, depth } = raw as Record<string, unknown>
  if (typeof command === 'string' && command.trim()) config.command = command
  if (Array.isArray(pinned)) config.pinned = strings(pinned)
  if (Array.isArray(scan)) config.scan = strings(scan)
  if (typeof depth === 'number' && Number.isFinite(depth)) config.depth = Math.min(6, Math.max(1, Math.trunc(depth)))
  return config
}

/** Parsed JSON, or undefined when the text isn't JSON. Windows editors may prepend a byte-order mark. */
function parseJson(text: string): unknown {
  try {
    return JSON.parse(text.replace(/^﻿/, ''))
  } catch {
    return undefined
  }
}

export async function loadConfig(file: string, opts: { importFrom?: string } = {}): Promise<ProjectsConfig> {
  let text: string
  try {
    text = await readFile(file, 'utf8')
  } catch (err) {
    if ((err as NodeJS.ErrnoException).code !== 'ENOENT') return defaultConfig()
    // First run: carry over the WezTerm prototype's settings when they exist.
    const imported = opts.importFrom ? parseJson(await readFile(opts.importFrom, 'utf8').catch(() => '')) : undefined
    return saveConfig(file, normalizeConfig(imported))
  }
  // A file that isn't valid JSON gets defaults but isn't overwritten, so a typo doesn't cost hand edits.
  return normalizeConfig(parseJson(text))
}

export async function saveConfig(file: string, config: ProjectsConfig): Promise<ProjectsConfig> {
  const clean = normalizeConfig(config)
  await mkdir(dirname(file), { recursive: true })
  // Written beside the file, then renamed over it: a crash mid-write can't leave half a file.
  const tmp = `${file}.${process.pid}.tmp`
  await writeFile(tmp, `${JSON.stringify(clean, null, 2)}\n`, 'utf8')
  await rename(tmp, file)
  return clean
}
