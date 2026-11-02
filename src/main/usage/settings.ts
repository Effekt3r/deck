import { lstat, mkdir, readFile, readlink, realpath, rm, stat } from 'node:fs/promises'
import { dirname, join } from 'node:path'
import type { UsageLink } from '@shared/types'
import { claudeHome } from '../claude/locator'
import { writeFileAtomic } from '../fs/atomic'

type Settings = Record<string, unknown>

/** In Deck's usage folder: the status line Connect replaced, for Disconnect to put back. */
const CONNECTION_FILE = 'connection.json'
/** In Deck's usage folder: Claude Code's settings as they were before the last Connect. */
const BACKUP_FILE = 'settings.backup.json'

export interface LinkOptions {
  /** Claude Code's user settings file. */
  file: string
  /** Deck's status line command (statusLineCommand). */
  command: string
  /** Deck's usage folder. */
  dir: string
}

/** Claude Code's user settings: $CLAUDE_CONFIG_DIR/settings.json, else ~/.claude/settings.json. */
export function claudeSettingsFile(env: NodeJS.ProcessEnv = process.env): string {
  return join(claudeHome(env), 'settings.json')
}

/** Claude Code's settings as read: the object, and the file's text (null when there's no file),
 *  which writeSettings checks is still there before it writes. */
export interface SettingsRead {
  settings: Settings
  text: string | null
}

/** The settings as an object, with the file's text. A missing or empty file is {}; anything else
 *  that isn't a JSON object is an error, and Deck never writes a file it couldn't parse. Nor a link
 *  to a file that doesn't exist (dotfiles not set up yet): writing would put a file in its place. */
export async function readSettings(file: string): Promise<SettingsRead | { error: string }> {
  let text: string
  try {
    text = await readFile(file, 'utf8')
  } catch (err) {
    const code = (err as NodeJS.ErrnoException).code
    if (code !== 'ENOENT') return { error: `Couldn't read ${file}: ${(err as Error).message}` }
    const info = await lstat(file).catch(() => null)
    const target = info?.isSymbolicLink() ? await readlink(file).catch(() => null) : null
    if (target !== null) return { error: `${file} links to a file that doesn't exist (${target}), so Deck leaves it alone.` }
    return { settings: {}, text: null }
  }
  // A byte order mark (Windows PowerShell 5.1 writes one with its UTF-8) isn't JSON.
  const json = text.startsWith('\uFEFF') ? text.slice(1) : text
  if (json.trim() === '') return { settings: {}, text }
  let parsed: unknown
  try {
    parsed = JSON.parse(json)
  } catch {
    return { error: `${file} isn't valid JSON, so Deck leaves it alone.` }
  }
  if (!isObject(parsed)) return { error: `${file} doesn't hold a JSON object, so Deck leaves it alone.` }
  return { settings: parsed, text }
}

/** Where Deck stands with the settings' status line. */
export function linkOf(settings: Settings, command: string): UsageLink {
  const line = settings.statusLine
  if (line === undefined || line === null) return { state: 'off' }
  if (isObject(line) && line.command === command) return { state: 'connected' }
  return { state: 'other', command: isObject(line) && typeof line.command === 'string' ? line.command : JSON.stringify(line) }
}

/** The link as the settings file has it now; an unreadable file is the error state. */
export async function currentLink(file: string, command: string): Promise<UsageLink> {
  const read = await readSettings(file)
  return 'error' in read ? { state: 'error', message: read.error } : linkOf(read.settings, command)
}

/** Makes Deck's command Claude Code's status line, remembering the one it replaces. Throws, with a
 *  message for the card, when the settings can't be read, or another status line is set and
 *  `replace` is false. */
export async function connect(opts: LinkOptions & { replace: boolean }): Promise<UsageLink> {
  const { settings, text } = await settingsOrThrow(opts.file)
  const link = linkOf(settings, opts.command)
  if (link.state === 'connected') return link
  if (link.state === 'other' && !opts.replace) throw new Error('Claude Code already has a status line.')
  await mkdir(opts.dir, { recursive: true })
  const record = { command: opts.command, previous: settings.statusLine ?? null }
  await writeFileAtomic(join(opts.dir, CONNECTION_FILE), `${JSON.stringify(record, null, 2)}\n`)
  // The text the change is made from, not a copy taken now, which could hold someone else's newer
  // change. Private, as the settings can hold keys (env). No file yet: nothing to back up.
  if (text !== null) await writeFileAtomic(join(opts.dir, BACKUP_FILE), text, 0o600)
  await writeSettings(opts.file, { ...settings, statusLine: { type: 'command', command: opts.command } }, text)
  return { state: 'connected' }
}

/** Puts back the status line Connect replaced (or none) while Deck's is still the one set, and
 *  leaves the settings alone otherwise. Forgets the connection either way. */
export async function disconnect(opts: LinkOptions): Promise<UsageLink> {
  const { settings, text } = await settingsOrThrow(opts.file)
  let link = linkOf(settings, opts.command)
  if (link.state === 'connected') {
    const previous = await previousStatusLine(opts.dir, opts.command)
    const { statusLine: _deck, ...rest } = settings
    const next = previous === null ? rest : { ...settings, statusLine: previous }
    await writeSettings(opts.file, next, text)
    link = linkOf(next, opts.command)
  }
  await rm(join(opts.dir, CONNECTION_FILE), { force: true })
  return link
}

async function settingsOrThrow(file: string): Promise<SettingsRead> {
  const read = await readSettings(file)
  if ('error' in read) throw new Error(read.error)
  return read
}

/** The status line Connect replaced; null when there was none, or the record is missing, unreadable
 *  or another command's (another Deck's). */
async function previousStatusLine(dir: string, command: string): Promise<unknown> {
  try {
    const record = JSON.parse(await readFile(join(dir, CONNECTION_FILE), 'utf8')) as unknown
    if (!isObject(record) || record.command !== command) return null
    const previous = record.previous ?? null
    return isObject(previous) && previous.command === command ? null : previous
  } catch {
    return null
  }
}

/** Writes `settings`, made from the file's text `original` (null: there was no file), beside the
 *  file and renames it over it, so Claude Code never reads half of it.
 *  - The file is read again first: if it no longer holds `original`, someone changed it meanwhile
 *    (Claude Code's /config, an editor), and writing would lose their change.
 *  - A read-only file is refused: someone made it so.
 *  - A symlink (dotfiles kept in a repo) is followed, so it stays a link; the file's mode and
 *    indentation are kept. */
export async function writeSettings(file: string, settings: Settings, original: string | null): Promise<void> {
  const target = await realpath(file).catch(() => file)
  const now = await readFile(target, 'utf8').catch((err: NodeJS.ErrnoException) => {
    if (err.code === 'ENOENT') return null
    throw err
  })
  if (now !== original) throw new Error("Claude Code's settings changed while Deck was writing them; try again.")
  const mode = await stat(target).then((s) => s.mode & 0o777, () => undefined)
  if (mode !== undefined && (mode & 0o200) === 0) throw new Error(`${file} is read-only, so Deck leaves it alone.`)
  // The whitespace before the first key of the first indented line.
  const indent = /^([ \t]+)"/m.exec(original ?? '')?.[1] ?? '  '
  await mkdir(dirname(target), { recursive: true })
  await writeFileAtomic(target, `${JSON.stringify(settings, null, indent)}\n`, mode)
}

const isObject = (v: unknown): v is Record<string, unknown> => typeof v === 'object' && v !== null && !Array.isArray(v)
