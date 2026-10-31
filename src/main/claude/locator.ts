import type { Dirent } from 'node:fs'
import { readdir, realpath, stat } from 'node:fs/promises'
import { homedir } from 'node:os'
import { join, resolve } from 'node:path'

/** A session log on disk. */
export interface SessionFile {
  id: string
  /** Absolute path of the .jsonl log. */
  path: string
  /** Last written, ms since epoch. */
  modified: number
}

// <repo>/.claude/worktrees/<name>, encoded. Matching this exact suffix, not a bare `<encoded>-`
// prefix, keeps sibling folders (`…-X-Old` next to `…-X`) out.
const WORKTREES = '--claude-worktrees-'

/** Claude Code's home: $CLAUDE_CONFIG_DIR, else ~/.claude. */
export function claudeHome(env: NodeJS.ProcessEnv = process.env): string {
  return env.CLAUDE_CONFIG_DIR || join(homedir(), '.claude')
}

/** The project folder name Claude Code uses for a cwd: every character but A–Z, a–z, 0–9 becomes '-'
 *  (per UTF-16 unit, as Claude's own JavaScript does). */
export function encodeFolder(path: string): string {
  return path.replace(/[^A-Za-z0-9]/g, '-')
}

/**
 * The project folders that hold `folder`'s logs (its own and its Claude worktrees'), those logs, newest
 * first, and the folder's real path (symlinks resolved, on-disk case: Claude's process.cwd(), which the
 * paths in its log start with). Never throws: an unreadable or missing Claude home has no sessions.
 */
export async function scanFolder(folder: string, env: NodeJS.ProcessEnv = process.env): Promise<{ dirs: string[]; sessions: SessionFile[]; real: string }> {
  const projects = join(claudeHome(env), 'projects')
  const given = resolve(folder)
  const real = await realpath(given).catch(() => given)
  // Lower-cased encodings of both: Claude encodes process.cwd(), i.e. the on-disk case
  // (/Volumes/wyobi/X logs to -Volumes-Wyobi-X).
  const keys = [...new Set([given, real].map((p) => encodeFolder(p).toLowerCase()))]
  let entries: Dirent[]
  try {
    entries = await readdir(projects, { withFileTypes: true })
  } catch {
    return { dirs: [], sessions: [], real }
  }
  const dirs = entries
    .filter((d) => d.isDirectory() && keys.some((k) => {
      const low = d.name.toLowerCase()
      return low === k || low.startsWith(k + WORKTREES)
    }))
    .map((d) => join(projects, d.name))
  const lists = await Promise.all(dirs.map(async (dir) => {
    const names = await readdir(dir).catch(() => [] as string[])
    const logs = await Promise.all(names.filter((n) => n.endsWith('.jsonl')).map(async (name) => {
      const path = join(dir, name)
      try {
        const st = await stat(path)
        return st.isFile() ? [{ id: name.slice(0, -'.jsonl'.length), path, modified: st.mtimeMs }] : []
      } catch {
        return [] // deleted between readdir and stat
      }
    }))
    return logs.flat()
  }))
  // Newest first; ties by path, descending, as the prototype's sort of (mtime, path) tuples.
  const sessions = lists.flat().sort((a, b) => b.modified - a.modified || (a.path < b.path ? 1 : a.path > b.path ? -1 : 0))
  return { dirs, sessions, real }
}

/** Logs for `folder` and its Claude worktrees (<encoded>--claude-worktrees-*), newest first. Folder names
 *  are compared case-insensitively (Claude encodes process.cwd(), i.e. on-disk case). */
export async function findSessions(folder: string, env: NodeJS.ProcessEnv = process.env): Promise<SessionFile[]> {
  return (await scanFolder(folder, env)).sessions
}

/** The project folders that can hold `folder`'s logs (to watch for new sessions). */
export async function projectDirs(folder: string, env: NodeJS.ProcessEnv = process.env): Promise<string[]> {
  return (await scanFolder(folder, env)).dirs
}
