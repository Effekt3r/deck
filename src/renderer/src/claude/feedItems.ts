import type { ClaudeFeedItem } from '@shared/types'

/** React keys for a feed, carried from one snapshot to the next. */
export interface FeedKeys {
  items: readonly ClaudeFeedItem[]
  keys: number[]
  /** The next unused key. */
  next: number
}

export const NO_KEYS: FeedKeys = { items: [], keys: [], next: 0 }

type Tool = Extract<ClaudeFeedItem, { kind: 'tool' }>
type Notice = Extract<ClaudeFeedItem, { kind: 'notice' }>

/** The same entry of the log: a tool by its id (its state changes in place), anything else by content. */
function sameEntry(a: ClaudeFeedItem, b: ClaudeFeedItem): boolean {
  if (a.kind !== b.kind) return false
  if (a.kind === 'tool') return a.id === (b as Tool).id
  if (a.kind === 'notice') return a.text === (b as Notice).text && a.tone === (b as Notice).tone
  return a.text === (b as { text: string }).text
}

/** Renders the same: every field equal (snapshots bring new objects with the same strings). */
export function sameItem(a: ClaudeFeedItem, b: ClaudeFeedItem): boolean {
  if (a === b) return true
  if (!sameEntry(a, b)) return false
  if (a.kind !== 'tool') return true
  const t = b as Tool
  return a.name === t.name && a.summary === t.summary && a.state === t.state && a.error === t.error
}

/** Keys for `items` that keep the previous snapshot's keys for the items still there. A
 *  snapshot is a window onto an append-only log: the oldest items drop off the front,
 *  new ones arrive at the end and a tool's state changes in place. So the new feed lines
 *  up with the old one shifted by the number dropped; the smallest shift that fits wins. */
export function feedKeys(prev: FeedKeys, items: readonly ClaudeFeedItem[]): FeedKeys {
  if (items === prev.items) return prev
  const old = prev.items
  let next = prev.next
  for (let shift = 0; shift < old.length; shift++) {
    const overlap = Math.min(old.length - shift, items.length)
    let fits = true
    for (let j = 0; j < overlap && fits; j++) fits = sameEntry(items[j], old[shift + j])
    if (!fits) continue
    const keys = prev.keys.slice(shift, shift + overlap)
    for (let j = overlap; j < items.length; j++) keys.push(next++)
    return { items, keys, next }
  }
  // Nothing lines up (a rewritten log): every item is new.
  return { items, keys: items.map(() => next++), next }
}

export type ToolKind = 'terminal' | 'edit' | 'read' | 'search' | 'web' | 'agent' | 'question' | 'mcp' | 'other'

const KINDS: Record<string, ToolKind> = {
  Bash: 'terminal',
  BashOutput: 'terminal',
  KillShell: 'terminal',
  Edit: 'edit',
  Write: 'edit',
  MultiEdit: 'edit',
  NotebookEdit: 'edit',
  Read: 'read',
  Grep: 'search',
  Glob: 'search',
  WebSearch: 'search',
  WebFetch: 'web',
  Agent: 'agent',
  Task: 'agent', // the Agent tool's name before 2.1
  AskUserQuestion: 'question',
  ExitPlanMode: 'question',
}

/** The icon a tool call gets. MCP tools come as server:tool (or raw mcp__server__tool). */
export function toolKind(name: string): ToolKind {
  if (name.startsWith('mcp__') || name.includes(':')) return 'mcp'
  return Object.hasOwn(KINDS, name) ? KINDS[name] : 'other'
}

/** mcp__server__tool → server:tool, like the prototype. */
export function toolLabel(name: string): string {
  return name.startsWith('mcp__') ? name.slice(5).replace('__', ':') : name
}
