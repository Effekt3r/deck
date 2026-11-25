# Tabs: Claude's status, and reordering: implementation plan

> **For agentic workers:** REQUIRED SUB-SKILL: Use superpowers:subagent-driven-development (recommended) or superpowers:executing-plans to implement this plan task-by-task. Steps use checkbox (`- [ ]`) syntax for tracking.

**Goal:** Terminal tabs show what their Claude is doing (working, needs you, finished and unseen) from Claude Code's presence files, can be dragged into a new order, and the Dock/taskbar signals tabs that need the user.

**Architecture:** Main watches `<claude home>/sessions/<pid>.json`, matches each running Claude to a tab's pty through the process tree (`ps`, macOS/Linux; by folder on Windows, in the renderer) and pushes the list over `claude:presence-changed`. The renderer turns that into a per-tab mark with pure functions (`tabs/attention.ts`), draws it in the tab bar, and reports the needs-you count to main (`app:attention`) for the Dock badge. Reordering is a reducer action (`move`) driven by pointer drags in `TabBar.tsx` (pure geometry in `tabs/drag.ts`) and two Window menu items.

**Tech Stack:** Electron 45, React 19, TypeScript, vitest (node environment: React components are checked in the app, everything else in pure, tested modules).

**Spec:** `docs/superpowers/specs/2026-11-24-tab-status-design.md`.

---

## Before you start

- Work in the worktree `~/.config/superpowers/worktrees/deck/m5-tabs` (branch `m5-tabs`, from `origin/main`, no upstream: never `git push` without `-u origin m5-tabs`).
- Node 22: run `export PATH="$HOME/.nvm/versions/node/v22.19.0/bin:$PATH"` in every new shell.
- Tests: `npx vitest run <path>`; everything: `npm test && npm run typecheck`.
- Commits: `git -c user.email=franco@effektstudios.com commit -m "…"`. Never add `Co-Authored-By` or any other attribution lines.
- Read `CLAUDE.md` first: it explains the tab title rules, xterm's flow control, and the Windows key rules (menu shortcuts off macOS must be returned as `'menu'` by `terminal/keys.ts`, and `menu.test.ts` checks that no menu shortcut is ever sent to a device's screen).
- Never send a prompt to Claude in a check (it spends Franco's plan); only local commands like `/config`.

## File structure

| File | Responsibility |
|---|---|
| `src/renderer/src/tabs/tabs.ts` | the tab model: adds the `move` action |
| `src/renderer/src/tabs/drag.ts` (new) | pure geometry for a drag: where a tab lands, how the others slide, edge scrolling |
| `src/renderer/src/tabs/TabBar.tsx` | pointer dragging; each tab's mark and tooltip |
| `src/renderer/src/tabs/title.ts` | `tabTitle(…, { glyph: false })` drops Claude's status glyph |
| `src/renderer/src/tabs/attention.ts` (new) | pure: which Claude a tab shows, the unseen-turn rules, the mark and its words |
| `src/renderer/src/tabs/useTabStatus.ts` (new) | hook: the presence list, each tab's status, the needs-you count to main |
| `src/renderer/src/hooks.ts` | adds `useWindowFocused` |
| `src/renderer/src/App.tsx` | wires `move`, the menu's move-tab, the statuses, the window title |
| `src/renderer/src/terminal/keys.ts` | Ctrl+Shift+PageUp/PageDown go to the menu off macOS |
| `src/renderer/src/styles.css`, `claude/panel.css` | the marks, the top edge, drag styles; `--green` moves to `:root` |
| `src/main/claude/presence.ts` (new) | pure parsing and matching, the `ps` table, `PresenceWatch` (watch + poll) |
| `src/main/claude/presence-ipc.ts` (new) | `claude:presence` / `claude:presence-changed` |
| `src/main/attention.ts` (new) | `app:attention`: the Dock badge and bounce, the taskbar flash |
| `src/main/pty/manager.ts` | `shells()`: shell pid → pty id |
| `src/main/menu.ts` | Window → Move Tab Left / Move Tab Right |
| `src/main/index.ts` | wiring |
| `src/shared/types.ts`, `channels.ts`, `src/preload/index.ts` | `ClaudeActivity`, `ClaudePresence`, the API, the channels, `move-tab` |
| `CLAUDE.md`, `README.md`, `docs/TESTING.md` | docs |

---

### Task 1: The `move` action

**Files:**
- Modify: `src/renderer/src/tabs/tabs.ts`
- Test: `src/renderer/src/tabs/tabs.test.ts`

- [ ] **Step 1: Write the failing tests**

Append inside the `describe('tabsReducer', …)` block of `src/renderer/src/tabs/tabs.test.ts`:

```ts
  it('moves a terminal tab to a new place; Projects stays first and the front tab stays in front', () => {
    const s = open(open(open(initialTabs, 'a'), 'b'), 'c') // c in front
    const ids = (x: TabsState) => x.tabs.map((t) => t.id)
    expect(ids(tabsReducer(s, { type: 'move', id: 'a', index: 3 }))).toEqual([PROJECTS_ID, 'b', 'c', 'a'])
    expect(ids(tabsReducer(s, { type: 'move', id: 'c', index: 1 }))).toEqual([PROJECTS_ID, 'c', 'a', 'b'])
    expect(tabsReducer(s, { type: 'move', id: 'c', index: 1 }).active).toBe('c')
    expect(ids(tabsReducer(s, { type: 'move', id: 'b', index: 0 }))).toEqual([PROJECTS_ID, 'b', 'a', 'c']) // never before Projects
    expect(ids(tabsReducer(s, { type: 'move', id: 'a', index: 99 }))).toEqual([PROJECTS_ID, 'b', 'c', 'a'])
  })
  it("doesn't move the Projects tab, unknown tabs, or a tab to its own place", () => {
    const s = open(open(initialTabs, 'a'), 'b')
    expect(tabsReducer(s, { type: 'move', id: PROJECTS_ID, index: 2 })).toBe(s)
    expect(tabsReducer(s, { type: 'move', id: 'nope', index: 1 })).toBe(s)
    expect(tabsReducer(s, { type: 'move', id: 'a', index: 1 })).toBe(s)
    expect(tabsReducer(s, { type: 'move', id: 'a', index: Number.NaN })).toBe(s)
  })
```

- [ ] **Step 2: Run them to see them fail**

Run: `npx vitest run src/renderer/src/tabs/tabs.test.ts`
Expected: FAIL (TypeScript-wise the action doesn't exist; at runtime the reducer returns `undefined` for an unknown action type, so `ids(...)` throws).

- [ ] **Step 3: Implement**

In `src/renderer/src/tabs/tabs.ts`, add to `TabsAction` (after `select`):

```ts
  | { type: 'move'; id: string; index: number } // a terminal tab to place `index` (1 or more: Projects stays first)
```

and add this case to `tabsReducer` (after `case 'select':`):

```ts
    case 'move': {
      const from = state.tabs.findIndex((t) => t.id === action.id)
      const tab = state.tabs[from]
      if (!tab || !isTerminal(tab)) return state
      const to = Math.min(Math.max(Math.trunc(action.index), 1), state.tabs.length - 1)
      if (!Number.isFinite(to) || to === from) return state
      const tabs = state.tabs.slice()
      tabs.splice(from, 1)
      tabs.splice(to, 0, tab)
      return { ...state, tabs }
    }
```

- [ ] **Step 4: Run the tests**

Run: `npx vitest run src/renderer/src/tabs/tabs.test.ts`
Expected: PASS.

- [ ] **Step 5: Commit**

```bash
git add src/renderer/src/tabs/tabs.ts src/renderer/src/tabs/tabs.test.ts
git -c user.email=franco@effektstudios.com commit -m "Tabs: a move action that keeps Projects first"
```

---

### Task 2: Where a dragged tab lands

**Files:**
- Create: `src/renderer/src/tabs/drag.ts`
- Test: `src/renderer/src/tabs/drag.test.ts`

- [ ] **Step 1: Write the failing tests**

Create `src/renderer/src/tabs/drag.test.ts`:

```ts
import { describe, expect, it } from 'vitest'
import { dropIndex, edgeScroll, slideFor, type Slot } from './drag'

// Projects (40 px), then a, b and c (100 px each): their middles are at 90, 190 and 290.
const slots: Slot[] = [{ left: 0, width: 40 }, { left: 40, width: 100 }, { left: 140, width: 100 }, { left: 240, width: 100 }]

describe('dropIndex', () => {
  it("stays put until the dragged tab's middle crosses a neighbour's", () => {
    expect(dropIndex(slots, 1, 90)).toBe(1)
    expect(dropIndex(slots, 1, 189)).toBe(1)
    expect(dropIndex(slots, 1, 191)).toBe(2)
    expect(dropIndex(slots, 1, 291)).toBe(3)
    expect(dropIndex(slots, 1, 9999)).toBe(3)
  })
  it('moves left past middles, never before the Projects tab', () => {
    expect(dropIndex(slots, 3, 191)).toBe(3)
    expect(dropIndex(slots, 3, 189)).toBe(2)
    expect(dropIndex(slots, 3, 89)).toBe(1)
    expect(dropIndex(slots, 3, -500)).toBe(1)
  })
  it('handles tabs of different widths', () => {
    // Projects, a wide tab (middle 190) and a narrow one (middle 380).
    const mixed: Slot[] = [{ left: 0, width: 40 }, { left: 40, width: 300 }, { left: 340, width: 80 }]
    expect(dropIndex(mixed, 2, 200)).toBe(2)
    expect(dropIndex(mixed, 2, 180)).toBe(1)
    expect(dropIndex(mixed, 1, 381)).toBe(2)
  })
})

describe('slideFor', () => {
  it('slides the tabs between the old and the new place aside by the dragged width', () => {
    expect([1, 2, 3].map((i) => slideFor(i, 1, 3, 100))).toEqual([0, -100, -100]) // a dragged to 3
    expect([1, 2, 3].map((i) => slideFor(i, 3, 1, 100))).toEqual([100, 100, 0]) // c dragged to 1
    expect([1, 2, 3].map((i) => slideFor(i, 2, 2, 100))).toEqual([0, 0, 0])
  })
})

describe('edgeScroll', () => {
  it('scrolls only near the ends, faster closer to them', () => {
    expect(edgeScroll(500, 0, 1000)).toBe(0)
    expect(edgeScroll(32, 0, 1000)).toBe(0)
    expect(edgeScroll(16, 0, 1000)).toBe(-4)
    expect(edgeScroll(0, 0, 1000)).toBe(-8)
    expect(edgeScroll(-50, 0, 1000)).toBe(-8)
    expect(edgeScroll(984, 0, 1000)).toBe(4)
    expect(edgeScroll(1200, 0, 1000)).toBe(8)
  })
})
```

- [ ] **Step 2: Run them to see them fail**

Run: `npx vitest run src/renderer/src/tabs/drag.test.ts`
Expected: FAIL ("Failed to resolve import './drag'").

- [ ] **Step 3: Implement**

Create `src/renderer/src/tabs/drag.ts`:

```ts
/** A tab's place in the strip, in the strip's own coordinates (offsetLeft, offsetWidth): unaffected
 *  by the strip's scrolling and by the transforms that slide tabs during a drag. */
export interface Slot {
  left: number
  width: number
}

const middle = (s: Slot) => s.left + s.width / 2

/**
 * The place a dragged tab would take if dropped now. `slots` are every tab in the strip, the
 * Projects tab first; `from` is the dragged tab's place and `center` its middle now. It passes a
 * tab once its middle crosses that tab's, and never lands before `first` (Projects stays first).
 */
export function dropIndex(slots: readonly Slot[], from: number, center: number, first = 1): number {
  let to = from
  while (to + 1 < slots.length && center > middle(slots[to + 1])) to++
  if (to !== from) return to
  while (to - 1 >= first && center < middle(slots[to - 1])) to--
  return to
}

/** How far tab `i` slides aside while tab `from` is dragged to `to`: the dragged tab's width. */
export function slideFor(i: number, from: number, to: number, width: number): number {
  if (from < to && i > from && i <= to) return -width
  if (to < from && i >= to && i < from) return width
  return 0
}

/** Within 32 px of the strip's ends a drag scrolls it: up to 8 px a frame, faster closer in. */
export function edgeScroll(x: number, left: number, right: number): number {
  const ZONE = 32
  const MAX = 8
  if (x < left + ZONE) return -Math.ceil(MAX * Math.min(1, (left + ZONE - x) / ZONE))
  if (x > right - ZONE) return Math.ceil(MAX * Math.min(1, (x - (right - ZONE)) / ZONE))
  return 0
}
```

- [ ] **Step 4: Run the tests**

Run: `npx vitest run src/renderer/src/tabs/drag.test.ts`
Expected: PASS.

- [ ] **Step 5: Commit**

```bash
git add src/renderer/src/tabs/drag.ts src/renderer/src/tabs/drag.test.ts
git -c user.email=franco@effektstudios.com commit -m "Tabs: where a dragged tab lands, and how the others slide"
```

---

### Task 3: Dragging tabs in the tab bar

**Files:**
- Modify: `src/renderer/src/tabs/TabBar.tsx` (whole file below)
- Modify: `src/renderer/src/App.tsx` (the `move` callback and the TabBar prop)
- Modify: `src/renderer/src/styles.css` (tab bar section)

No unit test: the component is pointer handling around `drag.ts` (tested in Task 2); Task 15 checks it in the app.

- [ ] **Step 1: Replace `src/renderer/src/tabs/TabBar.tsx`**

```tsx
import { type MouseEvent, type PointerEvent as ReactPointerEvent, useEffect, useRef, useState } from 'react'
import type { Platform } from '@shared/types'
import { CloseIcon, PlusIcon } from '../icons'
import { dropIndex, edgeScroll, slideFor, type Slot } from './drag'
import type { Tab } from './tabs'
import { tabTitle } from './title'

interface Props {
  tabs: Tab[]
  active: string
  platform: Platform
  onActivate(id: string): void
  onClose(id: string): void
  /** A terminal tab dropped at place `index` (1 or more: Projects stays first). */
  onMove(id: string, index: number): void
  /** A shell tab in the active tab's folder. */
  onNew(): void
}

/** A press on a terminal tab. It becomes a drag once it moves more than DRAG_START sideways. */
interface Press {
  id: string
  pointerId: number
  /** The pressed tab: it captures the pointer once the drag starts. */
  el: HTMLElement
  startX: number
  /** The strip's scroll at the press, so a drag that scrolls the strip carries the tab along. */
  startScroll: number
  /** The pointer's latest x. */
  x: number
  /** Set when the drag starts: every tab's place in the strip. */
  slots: Slot[] | null
  /** The dragged tab's index in `slots`. */
  from: number
}

/** What the strip shows while a tab is dragged. */
interface Drag {
  id: string
  from: number
  /** Where it lands if dropped now. */
  to: number
  /** How far it has moved, in the strip's coordinates. */
  dx: number
  width: number
}

/** Pixels a press moves sideways before it's a drag; less is a click. */
const DRAG_START = 4

// Clicking chrome must not take focus from the terminal; this also stops
// middle-click autoscroll.
const keepFocus = (e: MouseEvent) => e.preventDefault()

/** The window's title bar: macOS traffic lights on the left, Windows caption
 *  buttons on the right; the empty area drags the window. Terminal tabs can be
 *  dragged into another order (the Projects tab stays first). */
export function TabBar({ tabs, active, platform, onActivate, onClose, onMove, onNew }: Props) {
  const stripRef = useRef<HTMLDivElement>(null)
  const pressRef = useRef<Press | null>(null)
  const dragRef = useRef<Drag | null>(null)
  const [drag, setDrag] = useState<Drag | null>(null)
  // The window listeners below are added once; they call the latest callbacks through this.
  const latest = useRef({ onActivate, onMove })
  useEffect(() => {
    latest.current = { onActivate, onMove }
  })

  useEffect(() => {
    stripRef.current?.querySelector('.tab.active')?.scrollIntoView({ block: 'nearest', inline: 'nearest' })
  }, [active, tabs.length])

  useEffect(() => {
    let frame = 0
    const show = (next: Drag | null) => {
      dragRef.current = next
      setDrag(next)
    }
    /** The dragged tab follows the pointer and the strip's scroll: where would it land? */
    const follow = (p: Press) => {
      const strip = stripRef.current
      if (!strip || !p.slots) return
      const slot = p.slots[p.from]
      const dx = p.x - p.startX + (strip.scrollLeft - p.startScroll)
      show({ id: p.id, from: p.from, to: dropIndex(p.slots, p.from, slot.left + slot.width / 2 + dx), dx, width: slot.width })
    }
    /** Near the strip's ends, scrolls it every frame while the pointer stays there. */
    const scroll = () => {
      frame = 0
      const p = pressRef.current
      const strip = stripRef.current
      if (!p?.slots || !strip) return
      const rect = strip.getBoundingClientRect()
      const step = edgeScroll(p.x, rect.left, rect.right)
      if (step === 0) return
      const before = strip.scrollLeft
      strip.scrollLeft += step
      if (strip.scrollLeft === before) return // already at that end
      follow(p)
      frame = requestAnimationFrame(scroll)
    }
    /** Ends a press: a drag drops where it would land (`drop`), or goes back. */
    const end = (drop: boolean) => {
      const p = pressRef.current
      pressRef.current = null
      cancelAnimationFrame(frame)
      frame = 0
      if (!p?.slots) return
      document.body.classList.remove('dragging-tab')
      if (p.el.hasPointerCapture(p.pointerId)) p.el.releasePointerCapture(p.pointerId)
      const d = dragRef.current
      show(null)
      if (drop && d && d.to !== d.from) latest.current.onMove(d.id, d.to)
    }
    const onPointerMove = (e: PointerEvent) => {
      const p = pressRef.current
      if (!p || e.pointerId !== p.pointerId) return
      // The button was let go where this window didn't hear it (outside it, before any capture).
      if ((e.buttons & 1) === 0) return end(p.slots !== null)
      p.x = e.clientX
      if (!p.slots) {
        if (Math.abs(p.x - p.startX) <= DRAG_START) return
        const els = [...(stripRef.current?.querySelectorAll<HTMLElement>(':scope > .tab') ?? [])]
        const from = els.indexOf(p.el)
        if (from < 1) {
          pressRef.current = null
          return
        }
        p.slots = els.map((el) => ({ left: el.offsetLeft, width: el.offsetWidth }))
        p.from = from
        p.el.setPointerCapture(p.pointerId)
        document.body.classList.add('dragging-tab')
        latest.current.onActivate(p.id) // as in browsers, the dragged tab comes to the front
      }
      follow(p)
      if (!frame) frame = requestAnimationFrame(scroll)
    }
    const onPointerUp = (e: PointerEvent) => {
      if (pressRef.current?.pointerId === e.pointerId) end(true)
    }
    const onPointerCancel = (e: PointerEvent) => {
      if (pressRef.current?.pointerId === e.pointerId) end(false)
    }
    // Captured before xterm sees it: an Esc reaching a Claude tab would interrupt Claude.
    const onKeyDown = (e: KeyboardEvent) => {
      if (e.key !== 'Escape' || !pressRef.current?.slots) return
      e.preventDefault()
      e.stopPropagation()
      end(false)
    }
    const onBlur = () => end(false)
    window.addEventListener('pointermove', onPointerMove)
    window.addEventListener('pointerup', onPointerUp)
    window.addEventListener('pointercancel', onPointerCancel)
    window.addEventListener('keydown', onKeyDown, true)
    window.addEventListener('blur', onBlur)
    return () => {
      window.removeEventListener('pointermove', onPointerMove)
      window.removeEventListener('pointerup', onPointerUp)
      window.removeEventListener('pointercancel', onPointerCancel)
      window.removeEventListener('keydown', onKeyDown, true)
      window.removeEventListener('blur', onBlur)
      cancelAnimationFrame(frame)
      document.body.classList.remove('dragging-tab')
    }
  }, [])

  const press = (e: ReactPointerEvent<HTMLDivElement>, id: string) => {
    if (e.button !== 0 || pressRef.current?.slots || (e.target as HTMLElement).closest('.tab-close')) return
    pressRef.current = {
      id,
      pointerId: e.pointerId,
      el: e.currentTarget,
      startX: e.clientX,
      startScroll: stripRef.current?.scrollLeft ?? 0,
      x: e.clientX,
      slots: null,
      from: -1,
    }
  }

  return (
    <header className="tabbar" data-platform={platform}>
      <div className={drag ? 'tab-strip reordering' : 'tab-strip'} role="tablist" ref={stripRef}>
        {tabs.map((tab, i) => {
          const isActive = tab.id === active
          if (tab.kind === 'projects') {
            return (
              <div key={tab.id} role="tab" aria-selected={isActive} title="Projects"
                className={isActive ? 'tab tab-projects active' : 'tab tab-projects'}
                onMouseDown={keepFocus} onClick={() => onActivate(tab.id)}>
                <span className="tab-home" aria-hidden="true">⌂</span>
                <span className="tab-label">Projects</span>
              </div>
            )
          }
          const title = tabTitle(tab, platform)
          const dragged = drag?.id === tab.id
          const slide = drag === null ? 0 : dragged ? drag.dx : slideFor(i, drag.from, drag.to, drag.width)
          const classes = ['tab', isActive && 'active', tab.exited !== undefined && 'exited', dragged && 'dragging'].filter(Boolean).join(' ')
          return (
            <div key={tab.id} role="tab" aria-selected={isActive} className={classes} title={title}
              style={slide ? { transform: `translateX(${slide}px)` } : undefined}
              onMouseDown={keepFocus}
              onPointerDown={(e) => press(e, tab.id)}
              onClick={() => onActivate(tab.id)}
              onAuxClick={(e) => e.button === 1 && onClose(tab.id)}>
              <span className="tab-label">{title}</span>
              <button className="tab-close" aria-label="Close tab" tabIndex={-1}
                onClick={(e) => {
                  e.stopPropagation()
                  onClose(tab.id)
                }}>
                <CloseIcon size={10} />
              </button>
            </div>
          )
        })}
      </div>
      <button className="tab-new" title="New tab" aria-label="New tab" tabIndex={-1} onMouseDown={keepFocus} onClick={onNew}>
        <PlusIcon size={13} />
      </button>
    </header>
  )
}
```

- [ ] **Step 2: Wire it in `src/renderer/src/App.tsx`**

After the line `const activate = useCallback((id: string) => dispatch({ type: 'activate', id }), [])` add:

```tsx
  const move = useCallback((id: string, index: number) => dispatch({ type: 'move', id, index }), [])
```

and change the `<TabBar …>` element to:

```tsx
      <TabBar tabs={state.tabs} active={state.active} platform={platform}
        onActivate={activate} onClose={close} onMove={move} onNew={newTab} />
```

- [ ] **Step 3: Styles in `src/renderer/src/styles.css`**

In the `.tab-strip { … }` rule add `position: relative;` as its first declaration, with this comment above the rule:

```css
/* Positioned: the tabs' offsetLeft, which a drag measures, counts from here. */
```

After the `.tab-new:hover` rule (end of the tab bar section) add:

```css
/* A dragged tab follows the pointer above the others, which slide aside to show where it lands. */
.tab-strip.reordering .tab { transition: transform 120ms ease; }
.tab-strip.reordering .tab.dragging {
  z-index: 1;
  transition: none;
  background: var(--tab-active);
  box-shadow: 0 0 0 1px var(--line-strong), 0 4px 14px rgb(0 0 0 / 0.4);
}
body.dragging-tab, body.dragging-tab * { cursor: grabbing !important; }
@media (prefers-reduced-motion: reduce) {
  .tab-strip.reordering .tab:not(.dragging) { transition: none; }
}
```

- [ ] **Step 4: Typecheck and tests**

Run: `npm run typecheck && npx vitest run src/renderer/src/tabs`
Expected: no type errors; tab tests PASS.

- [ ] **Step 5: Commit**

```bash
git add src/renderer/src/tabs/TabBar.tsx src/renderer/src/App.tsx src/renderer/src/styles.css
git -c user.email=franco@effektstudios.com commit -m "Tabs: drag a terminal tab into another place"
```

---

### Task 4: Window → Move Tab Left / Move Tab Right

**Files:**
- Modify: `src/shared/types.ts` (`MenuCommand`)
- Modify: `src/main/menu.ts`
- Modify: `src/renderer/src/terminal/keys.ts`
- Modify: `src/renderer/src/App.tsx` (the menu handler)
- Test: `src/main/menu.test.ts`, `src/renderer/src/terminal/keys.test.ts`

- [ ] **Step 1: Write the failing tests**

In `src/main/menu.test.ts`, inside `describe('menuTemplate', …)`, add:

```ts
  it('Move Tab Left/Right: Ctrl+Shift+PageUp/PageDown off macOS, no shortcut on macOS', () => {
    const win = shortcuts('win32')
    win.byKey.get('Ctrl+Shift+PageUp')?.click?.({} as never, undefined, {} as never)
    win.byKey.get('Ctrl+Shift+PageDown')?.click?.({} as never, undefined, {} as never)
    expect(win.sent).toEqual([{ type: 'move-tab', delta: -1 }, { type: 'move-tab', delta: 1 }])
    // macOS: Cmd+Shift+←/→ select text on a device's screen; the items are in the menu without one.
    const moves = shortcuts('darwin').all.filter((i) => i.label === 'Move Tab Left' || i.label === 'Move Tab Right')
    expect(moves).toHaveLength(2)
    expect(moves.every((i) => i.accelerator === undefined)).toBe(true)
  })
```

In `src/renderer/src/terminal/keys.test.ts`, inside `describe('keyAction', …)`, add:

```ts
  it('Windows: Ctrl+Shift+PageUp/PageDown move the tab (the menu), not the shell', () => {
    expect(keyAction(k('PageUp', { ctrlKey: true, shiftKey: true, code: 'PageUp' }), 'win32', false)).toBe('menu')
    expect(keyAction(k('PageDown', { ctrlKey: true, shiftKey: true, code: 'PageDown' }), 'win32', false)).toBe('menu')
    expect(keyAction(k('PageUp', { shiftKey: true }), 'win32', false)).toBeNull() // xterm scrolls
    expect(keyAction(k('PageUp', { ctrlKey: true }), 'win32', false)).toBeNull()
    expect(keyAction(k('PageUp', { metaKey: true, shiftKey: true }), 'darwin', false)).toBeNull()
  })
```

- [ ] **Step 2: Run them to see them fail**

Run: `npx vitest run src/main/menu.test.ts src/renderer/src/terminal/keys.test.ts`
Expected: FAIL (no such menu items; `keyAction` returns null for Ctrl+Shift+PageUp).

- [ ] **Step 3: Implement**

In `src/shared/types.ts`, add to `MenuCommand`:

```ts
  | { type: 'move-tab'; delta: -1 | 1 } // the front tab, one place left or right
```

In `src/main/menu.ts`, let `item` take no accelerator:

```ts
  const item = (label: string, accelerator: string | undefined, cmd: MenuCommand, extra: MenuItemConstructorOptions = {}) =>
    ({ label, ...(accelerator ? { accelerator } : {}), click: () => send(cmd), ...extra }) satisfies MenuItemConstructorOptions
```

and in `windowMenu`, after the Previous Tab item:

```ts
      // No macOS shortcut: Cmd+Shift+←/→ select text on a device's screen. System Settings →
      // Keyboard → Keyboard Shortcuts → App Shortcuts can give these one by name.
      item('Move Tab Left', mac ? undefined : 'Ctrl+Shift+PageUp', { type: 'move-tab', delta: -1 }),
      item('Move Tab Right', mac ? undefined : 'Ctrl+Shift+PageDown', { type: 'move-tab', delta: 1 }),
```

In `src/renderer/src/terminal/keys.ts`, inside the `if (shift) {` block, before its final `return null`, add:

```ts
    // Move Tab Left/Right (xterm would send them to the shell).
    if (e.key === 'PageUp' || e.key === 'PageDown') return 'menu'
```

In `src/renderer/src/App.tsx`, in the `onMenu` switch, add before `case 'projects':`:

```tsx
        case 'move-tab': {
          const i = stateRef.current.tabs.findIndex((t) => t.id === active)
          // The reducer keeps Projects first and ignores a move off either end.
          if (i >= 1) dispatch({ type: 'move', id: active, index: i + cmd.delta })
          return
        }
```

- [ ] **Step 4: Run the tests and the typecheck**

Run: `npx vitest run src/main/menu.test.ts src/renderer/src/terminal/keys.test.ts && npm run typecheck`
Expected: PASS, including the existing "no shortcut goes to a device's screen" test (Ctrl+Shift+PageUp isn't one of `deviceKey`'s Ctrl editing keys, so it returns null).

- [ ] **Step 5: Commit**

```bash
git add src/shared/types.ts src/main/menu.ts src/main/menu.test.ts src/renderer/src/terminal/keys.ts src/renderer/src/terminal/keys.test.ts src/renderer/src/App.tsx
git -c user.email=franco@effektstudios.com commit -m "Tabs: Window → Move Tab Left/Right (Ctrl+Shift+PageUp/PageDown on Windows)"
```

---

### Task 5: Reading a presence file

**Files:**
- Modify: `src/shared/types.ts` (new types)
- Create: `src/main/claude/presence.ts`
- Test: `src/main/claude/presence.test.ts`

- [ ] **Step 1: Add the shared types**

In `src/shared/types.ts`, after the `ClaudeResume` interface, add:

```ts
/** What a running Claude Code is doing, from its presence file: working (a turn, or work it handed
 *  off to an agent), waiting (something on its screen needs the user), idle (the turn ended). */
export type ClaudeActivity = 'working' | 'waiting' | 'idle'

/** A running Claude Code, from its presence file (`<claude home>/sessions/<pid>.json`). */
export interface ClaudePresence {
  pid: number
  sessionId: string
  /** The folder it was started in. */
  cwd: string
  state: ClaudeActivity
  /** While waiting: what it waits on, in Claude Code's words ('dialog open', 'input needed', …). */
  waitingFor?: string
  /** The pty of the Deck tab whose shell started it (macOS, Linux). Unset when it isn't a Deck
   *  tab's, and on Windows, where tabs match by folder. */
  ptyId?: string
}
```

- [ ] **Step 2: Write the failing tests**

Create `src/main/claude/presence.test.ts`:

```ts
import { describe, expect, it } from 'vitest'
import { activityOf, parsePresence, PRESENCE_FILE } from './presence'

const file = (p: Record<string, unknown>) => JSON.stringify({ pid: 500, sessionId: 's1', cwd: '/w/a', status: 'busy', ...p })

describe('activityOf', () => {
  it("maps Claude Code's statuses; shell (a background shell running) is idle", () => {
    expect(activityOf('busy')).toBe('working')
    expect(activityOf('waiting')).toBe('waiting')
    expect(activityOf('idle')).toBe('idle')
    expect(activityOf('shell')).toBe('idle')
    expect(activityOf('thinking')).toBeNull()
    expect(activityOf(undefined)).toBeNull()
  })
})

describe('parsePresence', () => {
  it('reads the fields Deck uses', () => {
    expect(parsePresence(file({ procStart: 'Tue Nov 24 06:01:36 2026', kind: 'interactive', version: '2.1.283' })))
      .toEqual({ pid: 500, sessionId: 's1', cwd: '/w/a', state: 'working', procStart: 'Tue Nov 24 06:01:36 2026' })
  })
  it('keeps what a waiting Claude waits on, cut short, and only while it waits', () => {
    expect(parsePresence(file({ status: 'waiting', waitingFor: 'dialog open' }))).toMatchObject({ state: 'waiting', waitingFor: 'dialog open' })
    expect(parsePresence(file({ status: 'waiting', waitingFor: 'x'.repeat(500) }))?.waitingFor).toHaveLength(200)
    expect(parsePresence(file({ status: 'idle', waitingFor: 'dialog open' }))).not.toHaveProperty('waitingFor')
  })
  it("compares start times with runs of spaces collapsed (ps pads a day below 10)", () =>
    expect(parsePresence(file({ procStart: ' Tue Nov  4 06:01:36 2026 ' }))?.procStart).toBe('Tue Nov 4 06:01:36 2026'))
  it("skips anything that isn't a presence file", () => {
    expect(parsePresence('{"pid": 500, "sessionId": "s1", "cwd": "/w/a", "status": "bu')).toBeNull() // caught mid-write
    expect(parsePresence('[]')).toBeNull()
    expect(parsePresence(file({ pid: -1 }))).toBeNull()
    expect(parsePresence(file({ pid: 1.5 }))).toBeNull()
    expect(parsePresence(file({ pid: '500' }))).toBeNull()
    expect(parsePresence(file({ cwd: 3 }))).toBeNull()
    expect(parsePresence(file({ sessionId: '' }))).toBeNull()
    expect(parsePresence(file({ status: 'asleep' }))).toBeNull()
  })
  it('names: <pid>.json only, never the .key files beside them', () => {
    expect(PRESENCE_FILE.test('13508.json')).toBe(true)
    expect(PRESENCE_FILE.test('13508.81f72b69dde09fae.key')).toBe(false)
    expect(PRESENCE_FILE.test('0.json')).toBe(false)
    expect(PRESENCE_FILE.test('../1.json')).toBe(false)
    expect(PRESENCE_FILE.test('1.json.tmp')).toBe(false)
  })
})
```

- [ ] **Step 3: Run them to see them fail**

Run: `npx vitest run src/main/claude/presence.test.ts`
Expected: FAIL ("Failed to resolve import './presence'").

- [ ] **Step 4: Implement**

Create `src/main/claude/presence.ts`:

```ts
import type { ClaudeActivity, ClaudePresence } from '@shared/types'

/** One running Claude Code, as its presence file (`<claude home>/sessions/<pid>.json`) says. */
export interface PresenceEntry {
  pid: number
  sessionId: string
  cwd: string
  state: ClaudeActivity
  waitingFor?: string
  /** Its process's start time as `ps -o lstart` prints it in UTC, runs of spaces collapsed: Claude
   *  Code writes it so a pid that was reused can be told apart. */
  procStart?: string
}

/** Presence files are named after their pid. The `<pid>.<hash>.key` files beside them hold the keys
 *  for Claude's peer messaging: never read. */
export const PRESENCE_FILE = /^[1-9][0-9]{0,9}\.json$/
/** A presence file is a few hundred bytes; anything far larger isn't one. */
export const MAX_PRESENCE_BYTES = 64 * 1024
const MAX_TEXT = 4096
/** What a waiting Claude waits on is shown in a tooltip. */
const MAX_WAITING_FOR = 200

/** Claude Code's `status` in Deck's words. `shell` is idle with a background shell still running (a
 *  dev server), which would otherwise look busy for hours. Unknown: null (the file is skipped). */
export function activityOf(status: unknown): ClaudeActivity | null {
  switch (status) {
    case 'busy':
      return 'working'
    case 'waiting':
      return 'waiting'
    case 'idle':
    case 'shell':
      return 'idle'
    default:
      return null
  }
}

const text = (x: unknown): string | undefined => (typeof x === 'string' && x !== '' && x.length <= MAX_TEXT ? x : undefined)

/** A presence file's text, checked; null for anything else (a file caught mid-write included). */
export function parsePresence(json: string): PresenceEntry | null {
  let data: unknown
  try {
    data = JSON.parse(json)
  } catch {
    return null
  }
  if (typeof data !== 'object' || data === null || Array.isArray(data)) return null
  const d = data as Record<string, unknown>
  const { pid } = d
  const sessionId = text(d.sessionId)
  const cwd = text(d.cwd)
  const state = activityOf(d.status)
  if (typeof pid !== 'number' || !Number.isSafeInteger(pid) || pid <= 0 || !sessionId || !cwd || !state) return null
  const entry: PresenceEntry = { pid, sessionId, cwd, state }
  const waitingFor = text(d.waitingFor)
  if (state === 'waiting' && waitingFor) entry.waitingFor = waitingFor.slice(0, MAX_WAITING_FOR)
  const procStart = text(d.procStart)?.trim().replace(/\s+/g, ' ')
  if (procStart) entry.procStart = procStart
  return entry
}

/** What the renderer gets: no start time. */
export function publicPresence(e: PresenceEntry): ClaudePresence {
  const p: ClaudePresence = { pid: e.pid, sessionId: e.sessionId, cwd: e.cwd, state: e.state }
  if (e.waitingFor) p.waitingFor = e.waitingFor
  return p
}
```

- [ ] **Step 5: Run the tests**

Run: `npx vitest run src/main/claude/presence.test.ts && npm run typecheck`
Expected: PASS.

- [ ] **Step 6: Commit**

```bash
git add src/shared/types.ts src/main/claude/presence.ts src/main/claude/presence.test.ts
git -c user.email=franco@effektstudios.com commit -m "Presence: read Claude Code's presence files"
```

---

### Task 6: Which tab a Claude runs in

**Files:**
- Modify: `src/main/claude/presence.ts`
- Test: `src/main/claude/presence.test.ts`

- [ ] **Step 1: Write the failing tests**

In `src/main/claude/presence.test.ts`, extend the import to

```ts
import { activityOf, matchProcesses, parsePresence, parseProcessTable, PRESENCE_FILE, type PresenceEntry, type ProcessRow } from './presence'
```

and append:

```ts
describe('parseProcessTable', () => {
  it("reads `ps -A -o pid=,ppid=,lstart=`, collapsing lstart's spaces", () => {
    const out = '    1     0 Mon Nov 23 04:00:00 2026\n13508 13154 Mon Nov  3 04:16:43 2026\nnot a row\n'
    expect(parseProcessTable(out)).toEqual(new Map([
      [1, { ppid: 0, started: 'Mon Nov 23 04:00:00 2026' }],
      [13508, { ppid: 13154, started: 'Mon Nov 3 04:16:43 2026' }],
    ]))
  })
})

describe('matchProcesses', () => {
  const started = 'Tue Nov 24 06:01:36 2026'
  const entry = (pid: number, p: Partial<PresenceEntry> = {}): PresenceEntry => ({ pid, sessionId: `s${pid}`, cwd: '/w/a', state: 'working', procStart: started, ...p })
  // launchd (1) ← Deck (100) ← zsh (200, tab A's shell) ← claude (300) ← sh (301) ← claude -p (302)
  //                         ← zsh (210, tab B's shell) ← wrapper (310) ← claude (311)
  // Terminal.app's zsh (400) ← claude (401)
  const table = new Map<number, ProcessRow>([
    [100, { ppid: 1, started }], [200, { ppid: 100, started }], [300, { ppid: 200, started }],
    [301, { ppid: 300, started }], [302, { ppid: 301, started }], [210, { ppid: 100, started }],
    [310, { ppid: 210, started }], [311, { ppid: 310, started }], [400, { ppid: 1, started }], [401, { ppid: 400, started }],
  ])
  const shells = new Map([[200, 'pty-a'], [210, 'pty-b']])

  it("gives each Claude its tab's pty: a child, or further down (a wrapper script)", () => {
    expect(matchProcesses([entry(300), entry(311)], shells, table)).toEqual([
      { pid: 300, sessionId: 's300', cwd: '/w/a', state: 'working', ptyId: 'pty-a' },
      { pid: 311, sessionId: 's311', cwd: '/w/a', state: 'working', ptyId: 'pty-b' },
    ])
  })
  it("lists a Claude outside Deck's tabs without a pty", () =>
    expect(matchProcesses([entry(401)], shells, table)).toEqual([{ pid: 401, sessionId: 's401', cwd: '/w/a', state: 'working' }]))
  it('gives a pty only the Claude nearest its shell (claude -p run by Claude counts as nothing)', () => {
    const list = matchProcesses([entry(302), entry(300)], shells, table)
    expect(list.find((p) => p.pid === 300)?.ptyId).toBe('pty-a')
    expect(list.find((p) => p.pid === 302)).not.toHaveProperty('ptyId')
  })
  it("drops a Claude whose process is gone, or whose pid now belongs to another process", () => {
    expect(matchProcesses([entry(999)], shells, table)).toEqual([])
    expect(matchProcesses([entry(300, { procStart: 'Mon Nov 23 01:00:00 2026' })], shells, table)).toEqual([])
    // No start time in the file (an older Claude Code): believed.
    expect(matchProcesses([entry(300, { procStart: undefined })], shells, table)[0]?.ptyId).toBe('pty-a')
  })
  it("stops at pid 1 and doesn't loop on a cycle", () => {
    const loop = new Map<number, ProcessRow>([[5, { ppid: 6, started }], [6, { ppid: 5, started }]])
    expect(matchProcesses([entry(5)], shells, loop)).toEqual([{ pid: 5, sessionId: 's5', cwd: '/w/a', state: 'working' }])
  })
})
```

- [ ] **Step 2: Run them to see them fail**

Run: `npx vitest run src/main/claude/presence.test.ts`
Expected: FAIL (`matchProcesses` and `parseProcessTable` aren't exported).

- [ ] **Step 3: Implement**

Append to `src/main/claude/presence.ts`:

```ts
/** A process as `ps -A -o pid=,ppid=,lstart=` lists it. */
export interface ProcessRow {
  ppid: number
  /** When it started, as `ps` printed it (UTC when run with TZ=UTC), runs of spaces collapsed. */
  started: string
}

/** `ps -A -o pid=,ppid=,lstart=`'s output: pid → its row. Lines it can't read are skipped. */
export function parseProcessTable(out: string): Map<number, ProcessRow> {
  const table = new Map<number, ProcessRow>()
  for (const line of out.split('\n')) {
    const m = /^\s*(\d+)\s+(\d+)\s+(\S.*?)\s*$/.exec(line)
    if (m) table.set(Number(m[1]), { ppid: Number(m[2]), started: m[3].replace(/\s+/g, ' ') })
  }
  return table
}

/** How far up from Claude's process to look for a tab's shell (a wrapper script or two between). */
const MAX_DEPTH = 8

/**
 * Which tab's pty each Claude belongs to, by process (macOS, Linux): a tab's shell (`shells`: its
 * pid → the pty's id) is an ancestor of Claude's process. Entries whose process isn't in `table`
 * (gone), or started at another time than their file says (a pid reused after a Claude was
 * killed), are dropped. A pty keeps only the Claude nearest its shell: a `claude -p` that Claude's
 * own Bash tool runs descends from the same shell.
 */
export function matchProcesses(entries: readonly PresenceEntry[], shells: ReadonlyMap<number, string>, table: ReadonlyMap<number, ProcessRow>): ClaudePresence[] {
  const out: ClaudePresence[] = []
  const nearest = new Map<string, { depth: number; presence: ClaudePresence }>()
  for (const entry of entries) {
    const row = table.get(entry.pid)
    if (!row || (entry.procStart !== undefined && entry.procStart !== row.started)) continue
    const presence = publicPresence(entry)
    let pid = row.ppid
    for (let depth = 1; depth <= MAX_DEPTH && pid > 1; depth++) {
      const ptyId = shells.get(pid)
      if (ptyId !== undefined) {
        const best = nearest.get(ptyId)
        if (!best || depth < best.depth) {
          if (best) delete best.presence.ptyId
          presence.ptyId = ptyId
          nearest.set(ptyId, { depth, presence })
        }
        break
      }
      pid = table.get(pid)?.ppid ?? 0
    }
    out.push(presence)
  }
  return out
}
```

- [ ] **Step 4: Run the tests**

Run: `npx vitest run src/main/claude/presence.test.ts`
Expected: PASS.

- [ ] **Step 5: Commit**

```bash
git add src/main/claude/presence.ts src/main/claude/presence.test.ts
git -c user.email=franco@effektstudios.com commit -m "Presence: match each Claude to its tab's shell through the process tree"
```

---

### Task 7: Each tab's shell pid

**Files:**
- Modify: `src/main/pty/manager.ts`
- Test: `src/main/pty/manager.test.ts`

- [ ] **Step 1: Write the failing test**

In `src/main/pty/manager.test.ts`, inside `describe('PtyManager', …)`, add:

```ts
  it("lists each live session's shell by pid", () => {
    const { m, pty, id } = fakeManager()
    expect([...m.shells()]).toEqual([[pty.pid, id]])
    m.kill(id)
    expect(m.shells().size).toBe(0)
  })
```

- [ ] **Step 2: Run it to see it fail**

Run: `npx vitest run src/main/pty/manager.test.ts`
Expected: FAIL ("m.shells is not a function").

- [ ] **Step 3: Implement**

In `src/main/pty/manager.ts`, add after `killAll()`:

```ts
  /** Each live session's shell pid → the session's id: a Claude started in a tab descends from it. */
  shells(): Map<number, string> {
    const out = new Map<number, string>()
    for (const [id, s] of this.sessions) out.set(s.pty.pid, id)
    return out
  }
```

- [ ] **Step 4: Run the tests**

Run: `npx vitest run src/main/pty/manager.test.ts`
Expected: PASS.

- [ ] **Step 5: Commit**

```bash
git add src/main/pty/manager.ts src/main/pty/manager.test.ts
git -c user.email=franco@effektstudios.com commit -m "Pty: each session's shell pid, for finding the Claude a tab runs"
```

---

### Task 8: Watching the presence files

**Files:**
- Modify: `src/main/claude/presence.ts`
- Test: `src/main/claude/presence.test.ts`

- [ ] **Step 1: Write the failing tests**

In `src/main/claude/presence.test.ts`, change the first lines to:

```ts
import { spawnSync } from 'node:child_process'
import { mkdtemp, rm, writeFile } from 'node:fs/promises'
import { tmpdir } from 'node:os'
import { join } from 'node:path'
import { afterEach, describe, expect, it } from 'vitest'
import type { ClaudePresence } from '@shared/types'
import { activityOf, alive, matchProcesses, parsePresence, parseProcessTable, PRESENCE_FILE, type PresenceEntry, PresenceWatch, type ProcessRow, psTable } from './presence'
```

and append:

```ts
const dirs: string[] = []
afterEach(async () => {
  for (const d of dirs.splice(0)) await rm(d, { recursive: true, force: true })
})

describe('PresenceWatch', () => {
  const started = 'Tue Nov 24 06:01:36 2026'
  const table = new Map<number, ProcessRow>([[400, { ppid: 1, started }], [500, { ppid: 400, started }], [600, { ppid: 1, started }]])
  const write = (dir: string, pid: number, p: Record<string, unknown> = {}) =>
    writeFile(join(dir, `${pid}.json`), JSON.stringify({ pid, sessionId: `s${pid}`, cwd: '/w/a', status: 'busy', procStart: started, ...p }))

  async function setup(opts: { ps?: boolean } = {}) {
    const dir = await mkdtemp(join(tmpdir(), 'deck-presence-'))
    dirs.push(dir)
    const published: ClaudePresence[][] = []
    const living = new Set([500, 600])
    let psRuns = 0
    const watch = new PresenceWatch({
      dir,
      shells: () => new Map([[400, 'pty-a']]),
      processes: opts.ps === false ? null : async () => {
        psRuns++
        return table
      },
      alive: (pid) => living.has(pid),
      publish: (list) => published.push(list),
      watch: () => null,
      pollMs: 60_000,
    })
    return { dir, published, living, watch, psRuns: () => psRuns }
  }

  it("publishes a Claude with its tab's pty, then its changes, then its going", async () => {
    const { dir, published, watch, psRuns } = await setup()
    await write(dir, 500)
    await watch.refresh()
    expect(published.at(-1)).toEqual([{ pid: 500, sessionId: 's500', cwd: '/w/a', state: 'working', ptyId: 'pty-a' }])
    expect(watch.current()).toEqual(published.at(-1))
    await write(dir, 500, { status: 'waiting', waitingFor: 'dialog open' })
    await watch.refresh()
    expect(published.at(-1)?.[0]).toMatchObject({ state: 'waiting', waitingFor: 'dialog open', ptyId: 'pty-a' })
    expect(psRuns()).toBe(1) // the same Claude: ps isn't run again
    await rm(join(dir, '500.json'))
    await watch.refresh()
    expect(published.at(-1)).toEqual([])
    watch.stop()
  })

  it('publishes only changes', async () => {
    const { dir, published, watch } = await setup()
    await write(dir, 500)
    await watch.refresh()
    await watch.refresh()
    expect(published).toHaveLength(1)
    watch.stop()
  })

  it("leaves out other files, broken ones, and Claudes whose process is gone", async () => {
    const { dir, published, living, watch } = await setup()
    await write(dir, 500)
    await writeFile(join(dir, '500.f2ef5ab0ef195a82.key'), 'secret')
    await writeFile(join(dir, '600.json'), '{"pid": 600, "sessi')
    await writeFile(join(dir, 'notes.json'), '{}')
    await write(dir, 700) // a file naming a pid with no process: gone
    await writeFile(join(dir, '800.json'), JSON.stringify({ pid: 801, sessionId: 's', cwd: '/w/a', status: 'busy' })) // its name isn't its pid
    await watch.refresh()
    expect(published.at(-1)?.map((p) => p.pid)).toEqual([500])
    living.delete(500)
    await watch.refresh()
    expect(published.at(-1)).toEqual([])
    watch.stop()
  })

  it('reads a file caught mid-write again on the next look', async () => {
    const { dir, published, watch } = await setup()
    await writeFile(join(dir, '600.json'), '{"pid": 600, "sessi')
    await watch.refresh()
    expect(published).toHaveLength(0)
    await write(dir, 600)
    await watch.refresh()
    expect(published.at(-1)?.map((p) => p.pid)).toEqual([600])
    watch.stop()
  })

  it('Windows (no ps): lists the running Claudes without ptys', async () => {
    const { dir, published, watch } = await setup({ ps: false })
    await write(dir, 500)
    await watch.refresh()
    expect(published.at(-1)).toEqual([{ pid: 500, sessionId: 's500', cwd: '/w/a', state: 'working' }])
    watch.stop()
  })

  it('a missing sessions folder is no Claudes', async () => {
    const published: ClaudePresence[][] = []
    const watch = new PresenceWatch({ dir: join(tmpdir(), 'deck-no-such-folder-6c1f'), shells: () => new Map(), processes: null, alive: () => true, publish: (l) => published.push(l), watch: () => null, pollMs: 60_000 })
    await watch.refresh()
    expect(watch.current()).toEqual([])
    expect(published).toHaveLength(0)
    watch.stop()
  })
})

describe('alive', () => {
  it('knows a live process and one that has exited', () => {
    expect(alive(process.pid)).toBe(true)
    const child = spawnSync(process.execPath, ['-e', ''])
    expect(alive(child.pid as number)).toBe(false)
  })
})

describe.skipIf(process.platform === 'win32')('psTable', () => {
  it('lists this process under its parent, with a UTC start time', async () => {
    const t = await psTable()
    expect(t.get(process.pid)?.ppid).toBe(process.ppid)
    expect(t.get(process.pid)?.started).toMatch(/^[A-Z][a-z]{2} [A-Z][a-z]{2} \d{1,2} \d\d:\d\d:\d\d \d{4}$/)
  })
})
```

- [ ] **Step 2: Run them to see them fail**

Run: `npx vitest run src/main/claude/presence.test.ts`
Expected: FAIL (`PresenceWatch`, `alive`, `psTable` aren't exported).

- [ ] **Step 3: Implement**

At the top of `src/main/claude/presence.ts`, add the imports:

```ts
import { execFile } from 'node:child_process'
import { readdir, readFile, stat } from 'node:fs/promises'
import { join } from 'node:path'
import { watchDirs } from './watch'
```

and append:

```ts
/** A presence file as last read: re-read only when its size or time changes. */
interface Seen {
  size: number
  mtimeMs: number
  entry: PresenceEntry
}

/** The presence files in `dir` (`<claude home>/sessions`), re-reading only those whose size or
 *  time changed since `cache`. A missing folder has none. */
async function readPresence(dir: string, cache: Map<string, Seen>): Promise<PresenceEntry[]> {
  const names = (await readdir(dir).catch(() => [] as string[])).filter((n) => PRESENCE_FILE.test(n)).sort()
  const present = new Set(names)
  for (const name of cache.keys()) if (!present.has(name)) cache.delete(name)
  const entries: PresenceEntry[] = []
  for (const name of names) {
    const path = join(dir, name)
    const st = await stat(path).catch(() => null) // removed meanwhile: null
    if (!st || !st.isFile() || st.size > MAX_PRESENCE_BYTES) {
      cache.delete(name)
      continue
    }
    let seen = cache.get(name)
    if (!seen || seen.size !== st.size || seen.mtimeMs !== st.mtimeMs) {
      const entry = parsePresence(await readFile(path, 'utf8').catch(() => ''))
      // A file caught mid-write reads as broken: not kept, so the next look reads it again.
      if (!entry) {
        cache.delete(name)
        continue
      }
      seen = { size: st.size, mtimeMs: st.mtimeMs, entry }
      cache.set(name, seen)
    }
    // A file is named after its pid: one that says otherwise isn't believed.
    if (`${seen.entry.pid}.json` === name) entries.push(seen.entry)
  }
  return entries
}

/** Whether a process exists, without signalling it (EPERM: it exists, but isn't ours to signal). */
export function alive(pid: number): boolean {
  try {
    process.kill(pid, 0)
    return true
  } catch (err) {
    return (err as NodeJS.ErrnoException).code === 'EPERM'
  }
}

/** The process table (macOS, Linux), with start times in UTC as Claude Code writes them. */
export function psTable(): Promise<Map<number, ProcessRow>> {
  const ps = process.platform === 'darwin' ? '/bin/ps' : 'ps'
  return new Promise((resolve, reject) => {
    execFile(ps, ['-A', '-o', 'pid=,ppid=,lstart='], { env: { ...process.env, TZ: 'UTC', LC_ALL: 'C' }, timeout: 5000, maxBuffer: 8 * 1024 * 1024 },
      (err, stdout) => (err ? reject(err) : resolve(parseProcessTable(stdout))))
  })
}

export interface PresenceWatchDeps {
  /** `<claude home>/sessions`. */
  dir: string
  /** Each tab's shell pid → its pty id (PtyManager.shells), read at every look. */
  shells(): ReadonlyMap<number, string>
  /** The process table (`psTable`), or null where there's none (Windows: tabs then match by folder). */
  processes: (() => Promise<Map<number, ProcessRow>>) | null
  alive(pid: number): boolean
  /** The list changed. */
  publish(list: ClaudePresence[]): void
  /** Tests pass their own. */
  watch?: (dirs: string[], onChange: () => void) => (() => void) | null
  pollMs?: number
}

/**
 * Follows the running Claude Codes: watches their presence folder and looks every 2 s too (a
 * watch can miss events, or fail). The process table is read again only when a Claude appears that
 * it hasn't looked up; a Claude whose process has gone drops out at the next look.
 */
export class PresenceWatch {
  private readonly cache = new Map<string, Seen>()
  private table = new Map<number, ProcessRow>()
  /** Each looked-up Claude's pid → its start time then. */
  private known = new Map<number, string | undefined>()
  private list: ClaudePresence[] = []
  private last = '[]'
  private timer: ReturnType<typeof setInterval> | null = null
  private unwatch: (() => void) | null = null
  private running: Promise<void> | null = null
  private again = false
  private stopped = false

  constructor(private readonly deps: PresenceWatchDeps) {}

  /** Starts watching (once; nothing after stop()). */
  start(): void {
    if (this.timer || this.stopped) return
    this.unwatch = (this.deps.watch ?? watchDirs)([this.deps.dir], () => void this.refresh())
    this.timer = setInterval(() => void this.refresh(), this.deps.pollMs ?? 2000)
    void this.refresh()
  }

  stop(): void {
    this.stopped = true
    if (this.timer) clearInterval(this.timer)
    this.timer = null
    this.unwatch?.()
    this.unwatch = null
  }

  current(): ClaudePresence[] {
    return this.list
  }

  /** Looks again. A call while a look runs makes it look once more after; never rejects. */
  refresh(): Promise<void> {
    if (this.running) {
      this.again = true
      return this.running
    }
    this.running = (async () => {
      do {
        this.again = false
        await this.look().catch((err: unknown) => console.warn("presence: reading Claude Code's sessions failed", err))
      } while (this.again && !this.stopped)
    })().finally(() => {
      this.running = null
    })
    return this.running
  }

  private async look(): Promise<void> {
    const entries = (await readPresence(this.deps.dir, this.cache)).filter((e) => this.deps.alive(e.pid))
    let list: ClaudePresence[]
    if (this.deps.processes) {
      if (entries.some((e) => !this.known.has(e.pid) || this.known.get(e.pid) !== e.procStart)) {
        this.table = await this.deps.processes()
        this.known = new Map(entries.map((e) => [e.pid, e.procStart]))
      }
      list = matchProcesses(entries, this.deps.shells(), this.table)
    } else {
      list = entries.map(publicPresence)
    }
    if (this.stopped) return
    const key = JSON.stringify(list)
    if (key === this.last) return
    this.last = key
    this.list = list
    this.deps.publish(list)
  }
}
```

- [ ] **Step 4: Run the tests**

Run: `npx vitest run src/main/claude/presence.test.ts && npm run typecheck`
Expected: PASS.

- [ ] **Step 5: Commit**

```bash
git add src/main/claude/presence.ts src/main/claude/presence.test.ts
git -c user.email=franco@effektstudios.com commit -m "Presence: follow the presence folder, with ps run only for a new Claude"
```

---

### Task 9: The presence IPC

**Files:**
- Modify: `src/shared/channels.ts`, `src/shared/types.ts` (`DeckApi.claude`), `src/preload/index.ts`, `src/main/index.ts`
- Create: `src/main/claude/presence-ipc.ts`
- Test: `src/main/claude/presence-ipc.test.ts`

- [ ] **Step 1: Write the failing test**

Create `src/main/claude/presence-ipc.test.ts`:

```ts
import { mkdir, mkdtemp, rm, writeFile } from 'node:fs/promises'
import { tmpdir } from 'node:os'
import { join } from 'node:path'
import { afterEach, describe, expect, it, vi } from 'vitest'
import { IPC } from '@shared/channels'
import { registerPresenceIpc } from './presence-ipc'

const ipc = vi.hoisted(() => ({ handlers: new Map<string, (...args: unknown[]) => unknown>() }))
vi.mock('electron', () => ({
  ipcMain: { handle: (channel: string, fn: (...args: unknown[]) => unknown) => ipc.handlers.set(channel, fn) },
}))

const homes: string[] = []
afterEach(async () => {
  for (const h of homes.splice(0)) await rm(h, { recursive: true, force: true })
})

describe('registerPresenceIpc', () => {
  it('answers with the running Claudes and pushes changes to the window', async () => {
    const home = await mkdtemp(join(tmpdir(), 'deck-presence-ipc-'))
    homes.push(home)
    await mkdir(join(home, 'sessions'))
    // This test's own process stands in for Claude: it's alive. 'win32' means no ps, on every platform.
    await writeFile(join(home, 'sessions', `${process.pid}.json`), JSON.stringify({ pid: process.pid, sessionId: 's1', cwd: '/w/a', status: 'busy' }))
    const presence = registerPresenceIpc({ shells: () => new Map(), env: { CLAUDE_CONFIG_DIR: home }, platform: 'win32' })
    const sent: unknown[][] = []
    presence.attach({ isDestroyed: () => false, webContents: { isDestroyed: () => false, send: (...a: unknown[]) => sent.push(a) } } as never)
    const list = await ipc.handlers.get(IPC.claudePresence)?.({})
    expect(list).toEqual([{ pid: process.pid, sessionId: 's1', cwd: '/w/a', state: 'working' }])
    expect(sent).toEqual([[IPC.claudePresenceChanged, list]])
    presence.dispose()
  })
})
```

- [ ] **Step 2: Run it to see it fail**

Run: `npx vitest run src/main/claude/presence-ipc.test.ts`
Expected: FAIL ("Failed to resolve import './presence-ipc'").

- [ ] **Step 3: Implement**

In `src/shared/channels.ts`, after `claudeOpenImage`:

```ts
  claudePresence: 'claude:presence',
  claudePresenceChanged: 'claude:presence-changed',
```

In `src/shared/types.ts`, at the end of `DeckApi.claude` (after `openImage`):

```ts
    /** Every Claude Code running on this machine and what it's doing (their presence files), with
     *  the pty of the Deck tab each runs in where that's known. */
    presence(): Promise<ClaudePresence[]>
    /** The list changed. */
    onPresence(cb: (list: ClaudePresence[]) => void): () => void
```

In `src/preload/index.ts`, add `ClaudePresence` to the type import from `@shared/types`, and at the end of `claude: { … }`:

```ts
    presence: () => ipcRenderer.invoke(IPC.claudePresence),
    onPresence: (cb) => on<[ClaudePresence[]]>(IPC.claudePresenceChanged, cb),
```

Create `src/main/claude/presence-ipc.ts`:

```ts
import { join } from 'node:path'
import { type BrowserWindow, ipcMain } from 'electron'
import { IPC } from '@shared/channels'
import type { ClaudePresence } from '@shared/types'
import { claudeHome } from './locator'
import { alive, PresenceWatch, psTable } from './presence'

export interface PresenceIpcOptions {
  /** Each tab's shell pid → its pty id (PtyManager.shells). */
  shells(): ReadonlyMap<number, string>
  /** Where Claude's home is ($CLAUDE_CONFIG_DIR); tests pass their own. */
  env?: NodeJS.ProcessEnv
  platform: NodeJS.Platform
}

export interface PresenceIpc {
  /** Changes are pushed to this window. */
  attach(win: BrowserWindow): void
  /** At quit: stop watching. */
  dispose(): void
}

/** `claude:presence`: which Claude Code runs where and what it's doing, for the tabs. Watching
 *  starts with the first ask. Read-only, like the rest of Deck's Claude code. */
export function registerPresenceIpc(opts: PresenceIpcOptions): PresenceIpc {
  let win: BrowserWindow | null = null
  const watch = new PresenceWatch({
    dir: join(claudeHome(opts.env ?? process.env), 'sessions'),
    shells: opts.shells,
    processes: opts.platform === 'win32' ? null : psTable,
    alive,
    publish: (list) => {
      if (win && !win.isDestroyed() && !win.webContents.isDestroyed()) win.webContents.send(IPC.claudePresenceChanged, list)
    },
  })
  ipcMain.handle(IPC.claudePresence, async (): Promise<ClaudePresence[]> => {
    watch.start()
    await watch.refresh()
    return watch.current()
  })
  return {
    attach(w) {
      win = w
    },
    dispose() {
      watch.stop()
    },
  }
}
```

In `src/main/index.ts`, import it:

```ts
import { registerPresenceIpc } from './claude/presence-ipc'
```

after `registerClaudeIpc(…)` add:

```ts
  // The tabs' Claude status: Claude Code's presence files, matched to the tabs' shells.
  const presence = registerPresenceIpc({ shells: () => ptys.shells(), platform: process.platform })
```

after `devices.attach(win)` add `presence.attach(win)`, and in the `will-quit` handler add `presence.dispose()`.

- [ ] **Step 4: Run the tests and the typecheck**

Run: `npx vitest run src/main/claude && npm run typecheck`
Expected: PASS.

- [ ] **Step 5: Commit**

```bash
git add src/shared/channels.ts src/shared/types.ts src/preload/index.ts src/main/claude/presence-ipc.ts src/main/claude/presence-ipc.test.ts src/main/index.ts
git -c user.email=franco@effektstudios.com commit -m "Presence: claude:presence and its pushes"
```

---

### Task 10: A tab's attention, as pure rules

**Files:**
- Create: `src/renderer/src/tabs/attention.ts`
- Test: `src/renderer/src/tabs/attention.test.ts`

- [ ] **Step 1: Write the failing tests**

Create `src/renderer/src/tabs/attention.test.ts`:

```ts
import { describe, expect, it } from 'vitest'
import type { ClaudeActivity, ClaudePresence } from '@shared/types'
import { markOf, markText, nextAttention, presenceFor, sameAttention, type TabAttention } from './attention'
import type { TerminalTab } from './tabs'

const tab = (p: Partial<TerminalTab> = {}): TerminalTab =>
  ({ id: 't1', kind: 'terminal', cwd: '/w/a', title: '✳ Fix the login', vars: {}, process: 'claude', ptyId: 'p1', ...p })
const presence = (p: Partial<ClaudePresence> = {}): ClaudePresence => ({ pid: 100, sessionId: 's', cwd: '/w/a', state: 'working', ...p })

describe('presenceFor', () => {
  it("macOS and Linux: by the tab's pty", () => {
    const t = tab()
    expect(presenceFor(t, [t], [presence({ pid: 1, ptyId: 'p0' }), presence({ pid: 2, ptyId: 'p1' })], 'darwin')?.pid).toBe(2)
    expect(presenceFor(t, [t], [presence({ ptyId: 'p0' })], 'darwin')).toBeUndefined()
    expect(presenceFor(t, [t], [presence()], 'linux')).toBeUndefined() // no pty: not this tab's
  })
  it('only while the tab runs Claude (a file a killed Claude left behind holds nothing)', () => {
    const t = tab({ process: 'zsh', title: '' })
    expect(presenceFor(t, [t], [presence({ ptyId: 'p1' })], 'darwin')).toBeUndefined()
  })
  it('Windows: by folder, ignoring case and slashes, when the tab and the Claude are the only ones there', () => {
    const t = tab({ cwd: 'C:\\Work\\App\\', process: 'pwsh.exe' })
    expect(presenceFor(t, [t], [presence({ cwd: 'c:/work/app' })], 'win32')?.pid).toBe(100)
    expect(presenceFor(t, [t], [presence({ cwd: 'c:/work/app' }), presence({ pid: 101, cwd: 'C:\\Work\\App' })], 'win32')).toBeUndefined()
    const other = tab({ id: 't2', cwd: 'C:\\Work\\App', process: 'pwsh.exe', title: '◐ Something else' })
    expect(presenceFor(t, [t, other], [presence({ cwd: 'c:/work/app' })], 'win32')).toBeUndefined()
    expect(presenceFor(t, [t], [presence({ cwd: 'C:\\Work' })], 'win32')).toBeUndefined()
  })
})

describe('nextAttention', () => {
  const states = (x: Record<string, ClaudeActivity | null>) => new Map(Object.entries(x))
  const step = (prev: Map<string, TabAttention>, now: Record<string, ClaudeActivity | null>, seen: string | null = null) => nextAttention(prev, states(now), seen)

  it('a turn that ends unseen stays unseen until the tab is seen', () => {
    let a = step(new Map(), { t1: 'working' })
    a = step(a, { t1: 'idle' })
    expect(a.get('t1')).toEqual({ state: 'idle', unseen: true })
    a = step(a, { t1: 'idle' })
    expect(a.get('t1')?.unseen).toBe(true)
    a = step(a, { t1: 'idle' }, 't1')
    expect(a.get('t1')?.unseen).toBe(false)
  })
  it('a turn that ends while seen, or the first look at an idle Claude, is not news', () => {
    expect(step(step(new Map(), { t1: 'working' }), { t1: 'idle' }, 't1').get('t1')?.unseen).toBe(false)
    expect(step(new Map(), { t1: 'idle' }).get('t1')?.unseen).toBe(false)
  })
  it('a wait that ends unseen counts too; a new turn or Claude going away clears it', () => {
    let a = step(step(new Map(), { t1: 'waiting' }), { t1: 'idle' })
    expect(a.get('t1')?.unseen).toBe(true)
    expect(step(a, { t1: 'working' }).get('t1')).toEqual({ state: 'working', unseen: false })
    expect(step(a, { t1: null }).get('t1')).toEqual({ state: null, unseen: false })
  })
  it('drops tabs that are gone', () => {
    const a = step(step(new Map(), { t1: 'working', t2: 'working' }), { t1: 'working' })
    expect([...a.keys()]).toEqual(['t1'])
  })
})

describe('sameAttention', () => {
  it('compares by content', () => {
    const a = new Map([['t1', { state: 'idle' as const, unseen: true }]])
    expect(sameAttention(a, new Map([['t1', { state: 'idle', unseen: true }]]))).toBe(true)
    expect(sameAttention(a, new Map([['t1', { state: 'idle', unseen: false }]]))).toBe(false)
    expect(sameAttention(a, new Map())).toBe(false)
  })
})

describe('markOf and markText', () => {
  it("shows waiting and working as they are, and an unseen idle as finished", () => {
    expect(markOf('waiting', false)).toBe('waiting')
    expect(markOf('working', true)).toBe('working')
    expect(markOf('idle', true)).toBe('done')
    expect(markOf('idle', false)).toBeNull()
    expect(markOf(null, true)).toBeNull()
  })
  it('words for the tooltip and the accessible name', () => {
    expect(markText('working')).toBe('Claude is working')
    expect(markText('waiting', 'dialog open')).toBe('Claude needs you (dialog open)')
    expect(markText('waiting')).toBe('Claude needs you')
    expect(markText('done')).toBe('Claude finished')
  })
})
```

- [ ] **Step 2: Run them to see them fail**

Run: `npx vitest run src/renderer/src/tabs/attention.test.ts`
Expected: FAIL ("Failed to resolve import './attention'").

- [ ] **Step 3: Implement**

Create `src/renderer/src/tabs/attention.ts`:

```ts
import type { ClaudeActivity, ClaudePresence, Platform } from '@shared/types'
import type { TerminalTab } from './tabs'
import { runsClaude } from './title'

/** A tab's mark: Claude working, needing the user, or finished with that not yet seen. */
export type Attention = 'working' | 'waiting' | 'done'

/** Per tab: its Claude's state as last seen (null: none), and whether a turn that ended is unseen. */
export interface TabAttention {
  state: ClaudeActivity | null
  unseen: boolean
}

/** A folder for comparing (Windows): case and slash direction ignored, no trailing slash. */
const folderKey = (path: string) => path.replace(/\\/g, '/').replace(/\/+$/, '').toLowerCase()

/**
 * The running Claude whose status a tab shows. By pty (macOS, Linux: main matched it by process);
 * on Windows by folder, when the tab is the only one there running Claude and this the only Claude
 * there. Only while the tab runs Claude, so a presence file a killed Claude left behind (its pid
 * reused since) can't keep a status on a tab whose shell is back at its prompt.
 */
export function presenceFor(tab: TerminalTab, tabs: readonly TerminalTab[], list: readonly ClaudePresence[], platform: Platform): ClaudePresence | undefined {
  if (!runsClaude(tab.process, tab.title)) return undefined
  if (platform !== 'win32') return tab.ptyId === undefined ? undefined : list.find((p) => p.ptyId === tab.ptyId)
  const key = folderKey(tab.cwd)
  if (key === '') return undefined
  const here = list.filter((p) => folderKey(p.cwd) === key)
  if (here.length !== 1) return undefined
  const sharing = tabs.filter((t) => folderKey(t.cwd) === key && runsClaude(t.process, t.title))
  return sharing.length === 1 ? here[0] : undefined
}

/**
 * The tabs' attention after a change. `now` is each terminal tab's Claude state (null: none) and
 * `seen` the tab being looked at (the front tab while Deck's window has focus), if any. A turn that
 * ends (working or waiting, then idle) in a tab that isn't seen stays unseen until the tab is; a new
 * turn, or Claude going away, clears it. Tabs not in `now` are dropped.
 */
export function nextAttention(prev: ReadonlyMap<string, TabAttention>, now: ReadonlyMap<string, ClaudeActivity | null>, seen: string | null): Map<string, TabAttention> {
  const next = new Map<string, TabAttention>()
  for (const [id, state] of now) {
    const before = prev.get(id)
    let unseen = false
    if (state === 'idle') unseen = before?.unseen === true || before?.state === 'working' || before?.state === 'waiting'
    if (id === seen) unseen = false
    next.set(id, { state, unseen })
  }
  return next
}

export function sameAttention(a: ReadonlyMap<string, TabAttention>, b: ReadonlyMap<string, TabAttention>): boolean {
  if (a.size !== b.size) return false
  for (const [id, x] of a) {
    const y = b.get(id)
    if (!y || y.state !== x.state || y.unseen !== x.unseen) return false
  }
  return true
}

/** The mark for a Claude in `state`: needs-you and working as they are, finished while unseen. */
export function markOf(state: ClaudeActivity | null, unseen: boolean): Attention | null {
  if (state === 'waiting') return 'waiting'
  if (state === 'working') return 'working'
  return state === 'idle' && unseen ? 'done' : null
}

/** A mark's words: the tab's tooltip line and the mark's accessible name. */
export function markText(mark: Attention, waitingFor?: string): string {
  switch (mark) {
    case 'working':
      return 'Claude is working'
    case 'waiting':
      return waitingFor ? `Claude needs you (${waitingFor})` : 'Claude needs you'
    case 'done':
      return 'Claude finished'
  }
}
```

- [ ] **Step 4: Run the tests**

Run: `npx vitest run src/renderer/src/tabs/attention.test.ts`
Expected: PASS.

- [ ] **Step 5: Commit**

```bash
git add src/renderer/src/tabs/attention.ts src/renderer/src/tabs/attention.test.ts
git -c user.email=franco@effektstudios.com commit -m "Tabs: which Claude a tab shows, and when a finished turn is still unseen"
```

---

### Task 11: The name without Claude's glyph

**Files:**
- Modify: `src/renderer/src/tabs/title.ts`
- Test: `src/renderer/src/tabs/title.test.ts`

- [ ] **Step 1: Write the failing test**

In `src/renderer/src/tabs/title.test.ts`, change the import to `import { runsClaude, tabTitle, withoutGlyph } from './title'` and append:

```ts
describe('withoutGlyph', () => {
  it("drops Claude's status glyph and its space, nothing else", () => {
    expect(withoutGlyph('◐ Fix the login')).toBe('Fix the login')
    expect(withoutGlyph('⠂ Thinking')).toBe('Thinking')
    expect(withoutGlyph('vim notes.md')).toBe('vim notes.md')
    expect(withoutGlyph('✳Claude')).toBe('✳Claude')
  })
})

describe('tabTitle without the glyph', () => {
  const deck = { GIT_REPO: '/Users/f/deck', GIT_BRANCH: 'main' }
  it("drops Claude's glyph when Deck draws its own mark", () => {
    expect(tabTitle(tab({ vars: deck, process: 'claude', title: '◐ Fix the login' }), 'darwin', { glyph: false })).toBe('deck · Fix the login')
    expect(tabTitle(tab({ process: 'claude', title: '✳ Claude Code' }), 'darwin', { glyph: false })).toBe('Claude Code')
    expect(tabTitle(tab({ vars: deck, process: 'claude', title: '◐ Fix the login' }), 'darwin')).toBe('deck · ◐ Fix the login')
  })
  it('leaves other titles alone', () => {
    expect(tabTitle(tab({ title: 'vim notes.md' }), 'darwin', { glyph: false })).toBe('vim notes.md')
    expect(tabTitle(tab({ vars: deck }), 'darwin', { glyph: false })).toBe('deck ⎇ main')
  })
})
```

- [ ] **Step 2: Run it to see it fail**

Run: `npx vitest run src/renderer/src/tabs/title.test.ts`
Expected: FAIL (`withoutGlyph` isn't exported).

- [ ] **Step 3: Implement**

In `src/renderer/src/tabs/title.ts`, replace everything from the comment `// Claude Code's title starts with '✳ '…` down to the end of `tabTitle` (keep the two imports above it and `baseName` below it) with:

```ts
// Claude Code's title starts with '✳ ' when idle and a spinner frame while working.
const STATUS_GLYPHS = '✳✶✻✽✢·◐◑◒◓'

/** A title that starts with one of Claude's status glyphs and a space. */
function isStatusTitle(title: string): boolean {
  if (title[1] !== ' ') return false
  const cp = title.charCodeAt(0)
  return STATUS_GLYPHS.includes(title[0]) || (cp >= 0x2801 && cp <= 0x28ff) // braille spinners
}

/** Claude is detected by process name where main can see it (macOS), else by
 *  its status title: native installs run as their version number, npm ones
 *  as node, and on Windows the process stays the shell. */
export function runsClaude(processName: string, title: string): boolean {
  return processName.toLowerCase().includes('claude') || isStatusTitle(title)
}

/** Claude's title without its status glyph ('◐ Fix the login' → 'Fix the login'); others as they are. */
export function withoutGlyph(title: string): string {
  return isStatusTitle(title) ? title.slice(2) : title
}

/** Like format-tab-title in wezterm.lua: repo · Claude's title while Claude
 *  runs, else repo ⎇ branch; outside a repo the terminal title or the folder.
 *  `glyph: false` drops Claude's status glyph, for tabs where Deck draws the status itself. */
export function tabTitle(tab: TerminalTab, platform: Platform, opts: { glyph?: boolean } = {}): string {
  const claude = tab.title !== '' && runsClaude(tab.process, tab.title)
  const title = claude && opts.glyph === false ? withoutGlyph(tab.title) : tab.title
  const repo = tab.vars.GIT_REPO
  if (repo) {
    const name = baseName(repo, platform)
    if (claude) return `${name} · ${title}`
    const branch = tab.vars.GIT_BRANCH
    return branch ? `${name} ⎇ ${branch}` : name
  }
  return title || baseName(tab.cwd, platform) || 'Terminal'
}
```

(`baseName` below it stays as it is.)

- [ ] **Step 4: Run the tests**

Run: `npx vitest run src/renderer/src/tabs/title.test.ts`
Expected: PASS (old and new tests).

- [ ] **Step 5: Commit**

```bash
git add src/renderer/src/tabs/title.ts src/renderer/src/tabs/title.test.ts
git -c user.email=franco@effektstudios.com commit -m "Tabs: a name without Claude's status glyph"
```

---

### Task 12: The Dock badge and the taskbar flash

**Files:**
- Create: `src/main/attention.ts`
- Test: `src/main/attention.test.ts`
- Modify: `src/shared/channels.ts`, `src/shared/types.ts` (`DeckApi.app`), `src/preload/index.ts`, `src/main/index.ts`

- [ ] **Step 1: Write the failing test**

Create `src/main/attention.test.ts`:

```ts
import { describe, expect, it } from 'vitest'
import { attentionSignal } from './attention'

describe('attentionSignal', () => {
  it('badges the count, and draws the eye only when it rises while Deck is in the background', () => {
    expect(attentionSignal(0, 1, false)).toEqual({ badge: '1', alert: true })
    expect(attentionSignal(0, 1, true)).toEqual({ badge: '1', alert: false })
    expect(attentionSignal(1, 2, false)).toEqual({ badge: '2', alert: true })
    expect(attentionSignal(2, 1, false)).toEqual({ badge: '1', alert: false })
    expect(attentionSignal(1, 1, false)).toEqual({ badge: '1', alert: false })
    expect(attentionSignal(1, 0, false)).toEqual({ badge: '', alert: false })
  })
})
```

- [ ] **Step 2: Run it to see it fail**

Run: `npx vitest run src/main/attention.test.ts`
Expected: FAIL ("Failed to resolve import './attention'").

- [ ] **Step 3: Implement**

In `src/shared/channels.ts`, after `appReady`: `appAttention: 'app:attention',`

In `src/shared/types.ts`, at the end of `DeckApi.app`:

```ts
    /** How many tabs need the user: the Dock's badge (macOS), and a bounce (macOS) or a taskbar
     *  flash (Windows) when it rises while Deck is in the background. */
    attention(waiting: number): void
```

In `src/preload/index.ts`, at the end of `app: { … }`:

```ts
    attention: (waiting) => ipcRenderer.send(IPC.appAttention, waiting),
```

Create `src/main/attention.ts`:

```ts
import { app, type BrowserWindow, ipcMain } from 'electron'
import { IPC } from '@shared/channels'

/** What the Dock or the taskbar shows when the number of tabs needing the user changes. */
export interface AttentionSignal {
  /** The Dock's badge (macOS): the count, '' for none. */
  badge: string
  /** Draw the eye (a Dock bounce, a taskbar flash): the count rose while Deck was in the background. */
  alert: boolean
}

export function attentionSignal(before: number, now: number, focused: boolean): AttentionSignal {
  return { badge: now > 0 ? String(now) : '', alert: now > before && !focused }
}

/** `app:attention`: the renderer's count of tabs that need the user. */
export function registerAttention(platform: NodeJS.Platform): { attach(win: BrowserWindow): void } {
  let win: BrowserWindow | null = null
  let count = 0
  // An `on` listener that throws shows an error dialog, so the count is checked first.
  ipcMain.on(IPC.appAttention, (_e, waiting: unknown) => {
    if (typeof waiting !== 'number' || !Number.isSafeInteger(waiting) || waiting < 0 || waiting > 999) return
    const live = win !== null && !win.isDestroyed()
    const signal = attentionSignal(count, waiting, live && win!.isFocused())
    count = waiting
    if (platform === 'darwin') {
      app.dock?.setBadge(signal.badge)
      if (signal.alert) app.dock?.bounce('informational')
    } else if (platform === 'win32' && signal.alert && live) {
      win!.flashFrame(true)
    }
  })
  return {
    attach(w) {
      win = w
      // Windows flashes until told to stop.
      if (platform === 'win32') w.on('focus', () => w.flashFrame(false))
    },
  }
}
```

In `src/main/index.ts`, import `import { registerAttention } from './attention'`; after the `registerPresenceIpc(…)` line add `const attention = registerAttention(process.platform)`, and after `presence.attach(win)` add `attention.attach(win)`.

- [ ] **Step 4: Run the tests and the typecheck**

Run: `npx vitest run src/main/attention.test.ts && npm run typecheck`
Expected: PASS.

- [ ] **Step 5: Commit**

```bash
git add src/main/attention.ts src/main/attention.test.ts src/shared/channels.ts src/shared/types.ts src/preload/index.ts src/main/index.ts
git -c user.email=franco@effektstudios.com commit -m "Tabs: the Dock's badge and bounce, the taskbar's flash, for tabs that need you"
```

---

### Task 13: Marks in the tab bar

**Files:**
- Modify: `src/renderer/src/hooks.ts` (`useWindowFocused`)
- Create: `src/renderer/src/tabs/useTabStatus.ts`
- Modify: `src/renderer/src/tabs/TabBar.tsx`, `src/renderer/src/App.tsx`, `src/renderer/src/styles.css`, `src/renderer/src/claude/panel.css`

No unit test: the hook and the component wire the tested rules of Task 10 and 11; Task 15 checks them in the app.

- [ ] **Step 1: `useWindowFocused` in `src/renderer/src/hooks.ts`**

Append:

```ts
/** Deck's window has the keyboard focus: the user is looking at its front tab. */
export function useWindowFocused(): boolean {
  const [focused, setFocused] = useState(() => document.hasFocus())
  useEffect(() => {
    const on = () => setFocused(true)
    const off = () => setFocused(false)
    window.addEventListener('focus', on)
    window.addEventListener('blur', off)
    return () => {
      window.removeEventListener('focus', on)
      window.removeEventListener('blur', off)
    }
  }, [])
  return focused
}
```

- [ ] **Step 2: Create `src/renderer/src/tabs/useTabStatus.ts`**

```ts
import { useEffect, useMemo, useState } from 'react'
import type { ClaudePresence, Platform } from '@shared/types'
import { type Attention, markOf, markText, nextAttention, presenceFor, sameAttention, type TabAttention } from './attention'
import { isTerminal, type Tab } from './tabs'

/** A tab whose Claude Deck knows (its presence file): the mark it shows, if any. */
export interface TabStatus {
  /** null: Claude is idle, and the tab has been seen since its last turn ended. */
  mark: Attention | null
  /** The mark's words: the tab's tooltip line and the mark's accessible name ('' without a mark). */
  text: string
}

/** Every running Claude Code (main's presence list), kept current. */
function usePresence(): readonly ClaudePresence[] {
  const [list, setList] = useState<readonly ClaudePresence[]>([])
  useEffect(() => {
    let live = true
    let pushed = false
    const off = window.deck.claude.onPresence((next) => {
      pushed = true
      setList(next)
    })
    // A push that came first is at least as new as this answer.
    window.deck.claude.presence().then(
      (first) => {
        if (live && !pushed) setList(first)
      },
      () => {},
    )
    return () => {
      live = false
      off()
    }
  }, [])
  return list
}

/**
 * Each terminal tab's status, by id, for the tabs whose Claude Deck knows. `seen` is the tab being
 * looked at (the front tab while Deck's window has focus), if any. Also tells main how many tabs
 * need the user, for the Dock's badge.
 */
export function useTabStatus(tabs: readonly Tab[], seen: string | null, platform: Platform): ReadonlyMap<string, TabStatus> {
  const list = usePresence()
  const presences = useMemo(() => {
    const terminals = tabs.filter(isTerminal)
    return new Map(terminals.map((t) => [t.id, presenceFor(t, terminals, list, platform)]))
  }, [tabs, list, platform])

  // Whether a finished turn is unseen depends on what came before: kept here, moved on by changes.
  const [attention, setAttention] = useState<ReadonlyMap<string, TabAttention>>(() => new Map())
  useEffect(() => {
    const now = new Map([...presences].map(([id, p]) => [id, p?.state ?? null]))
    setAttention((prev) => {
      const next = nextAttention(prev, now, seen)
      return sameAttention(prev, next) ? prev : next
    })
  }, [presences, seen])

  const statuses = useMemo(() => {
    const out = new Map<string, TabStatus>()
    for (const [id, p] of presences) {
      if (!p) continue
      // Working and needs-you are shown as they are now; finished waits for the effect above.
      const mark = markOf(p.state, attention.get(id)?.unseen === true)
      out.set(id, { mark, text: mark ? markText(mark, p.waitingFor) : '' })
    }
    return out
  }, [presences, attention])

  const waiting = useMemo(() => [...statuses.values()].filter((s) => s.mark === 'waiting').length, [statuses])
  useEffect(() => {
    window.deck.app.attention(waiting)
  }, [waiting])
  return statuses
}
```

- [ ] **Step 3: The marks in `src/renderer/src/tabs/TabBar.tsx`**

Add the import `import type { TabStatus } from './useTabStatus'`, the prop (after `platform: Platform`):

```ts
  /** Claude's status, for the tabs whose Claude Deck knows. */
  statuses: ReadonlyMap<string, TabStatus>
```

and destructure `statuses` in `TabBar({ tabs, active, platform, statuses, onActivate, onClose, onMove, onNew }: Props)`.

In the terminal-tab branch of the map, replace

```tsx
          const title = tabTitle(tab, platform)
```

with

```tsx
          const status = statuses.get(tab.id)
          // Deck draws the status itself where it knows it: Claude's own glyph stands still in
          // background tabs (Claude animates it only with focus).
          const title = tabTitle(tab, platform, { glyph: status === undefined })
          const tip = status?.mark ? `${title}\n${status.text}` : title
```

change the `classes` line to

```tsx
          const classes = ['tab', isActive && 'active', tab.exited !== undefined && 'exited', dragged && 'dragging', status?.mark && `mark-${status.mark}`].filter(Boolean).join(' ')
```

change the tab's `title={title}` to `title={tip}`, and put the mark before the label:

```tsx
              {status?.mark && <span className={`tab-mark ${status.mark}`} role="img" aria-label={status.text} />}
              <span className="tab-label">{title}</span>
```

- [ ] **Step 4: Wire it in `src/renderer/src/App.tsx`**

Change the hooks import to `import { usePageVisible, useStoredFlag, useWindowFocused } from './hooks'` and add `import { useTabStatus } from './tabs/useTabStatus'`. After `const pageVisible = usePageVisible()` add:

```tsx
  /** Claude's status per tab; a tab is seen while it's in front and Deck has focus. */
  const focused = useWindowFocused()
  const statuses = useTabStatus(state.tabs, focused ? state.active : null, platform)
```

change the window title line to

```tsx
  const windowTitle = activeTab && isTerminal(activeTab) ? tabTitle(activeTab, platform, { glyph: !statuses.has(activeTab.id) }) : 'Deck'
```

and pass `statuses={statuses}` to `<TabBar …>`.

- [ ] **Step 5: Styles**

In `src/renderer/src/styles.css`, add `--green: #9ece6a;` to `:root` after `--amber`, and update the file's first comment to
`/* Deck: dark navy chrome, teal for what's active, amber for highlights and for what needs you, green for what's done. */`.

After the drag styles from Task 3 add:

```css
/* A tab's Claude: working (a turning ring), needs you (a pulsing dot, amber top edge), finished and
   not yet seen (a check, green top edge). The shapes differ as well as the colours. */
.tab-mark { flex: none; position: relative; width: 10px; height: 10px; }
.tab-mark.working {
  border: 1.5px solid var(--violet);
  border-right-color: transparent;
  border-radius: 50%;
  animation: tab-turn 0.9s linear infinite;
}
.tab-mark.waiting { width: 8px; height: 8px; margin: 1px; border-radius: 50%; background: var(--amber); animation: tab-pulse 1.6s ease-in-out infinite; }
.tab-mark.done::before {
  content: '✓';
  position: absolute;
  inset: -2px 0 0;
  color: var(--green);
  font-size: 12px;
  font-weight: 700;
  line-height: 1;
  text-align: center;
}
.tab.mark-waiting { border-top-color: var(--amber); }
.tab.mark-done { border-top-color: var(--green); }
@keyframes tab-turn { to { transform: rotate(360deg); } }
@keyframes tab-pulse { 50% { box-shadow: 0 0 0 3px rgb(255 159 67 / 0.25); } }
@media (prefers-reduced-motion: reduce) {
  .tab-mark.working, .tab-mark.waiting { animation: none; }
}
```

In `src/renderer/src/claude/panel.css`, delete the line `  --green: #9ece6a;` from `.claude-panel` (it now comes from `:root`).

- [ ] **Step 6: Typecheck, tests, build**

Run: `npm run typecheck && npm test && npm run build`
Expected: no errors; all tests PASS; the build succeeds.

- [ ] **Step 7: Commit**

```bash
git add src/renderer/src/hooks.ts src/renderer/src/tabs/useTabStatus.ts src/renderer/src/tabs/TabBar.tsx src/renderer/src/App.tsx src/renderer/src/styles.css src/renderer/src/claude/panel.css
git -c user.email=franco@effektstudios.com commit -m "Tabs: each tab's Claude status: working, needs you, finished"
```

---

### Task 14: Docs

**Files:**
- Modify: `CLAUDE.md`, `README.md`, `docs/TESTING.md`

- [ ] **Step 1: CLAUDE.md**

1. In "## Current state", after the paragraph that starts "The device panel, step 1", add:

```markdown
Tabs (spec `docs/superpowers/specs/2026-11-24-tab-status-design.md`, plan
`docs/superpowers/plans/2026-11-25-tab-status.md`, built 2026-11-25): each tab shows its Claude's
status (working, needs you, finished and unseen) from Claude Code's presence files, and terminal
tabs can be dragged into another order. Windows to test.
```

2. In the paths table, change the `src/main/claude/` row's text to end with `, \`presence.ts\` (presence files, matched to tabs through \`ps\`) and \`presence-ipc.ts\`, \`claude:*\` subscriptions`, and the `src/renderer/src/` row's `tabs/` part to `tabs/ (model, titles, tab bar, drag geometry, Claude's status per tab)`.

3. In "Things that aren't obvious from the code", after the Claude panel bullet list, add:

```markdown
- Tabs (`src/renderer/src/tabs/`, `src/main/claude/presence.ts`, `src/main/attention.ts`):
  - **Claude's status:** each running Claude Code keeps `<claude home>/sessions/<pid>.json` (its own
    "session presence PID file"): `status` busy, waiting, idle or shell (idle with a background
    shell), `waitingFor` while waiting (a dialog's words, `input needed`, `dialog open`, …), and
    `procStart`, its process's start as `ps -o lstart` in UTC. Deck shows busy as working and shell as
    idle, reads only `<digits>.json` (never the `<pid>.<hash>.key` peer-messaging keys beside them),
    and gets no status at all if a version drops the files. Undocumented, checked against 2.1.283.
  - **Which tab:** main runs `ps -A -o pid=,ppid=,lstart=` with `TZ=UTC LC_ALL=C` (20 ms) only when a
    presence file with a pid it hasn't looked up appears, and walks up from Claude's pid to a tab's
    shell (`PtyManager.shells()`, at most 8 steps). A file whose process is gone or started at another
    time (a reused pid) doesn't count, and a pty keeps the Claude nearest its shell (`claude -p` run by
    Claude's Bash tool also descends from it). Windows has no `ps`: a tab matches by folder, when it's
    the only Claude tab and the only file there. A tab shows a status only while it runs Claude
    (`runsClaude`), so a file a killed Claude left can't stick.
  - **Why Deck draws it:** Claude Code animates its title's ◐/◑ only while its terminal has focus, and
    xterm's focus reporting tells background tabs they have none, so their glyph froze (found
    2026-11-24). Wherever Deck knows a tab's Claude, its name drops Claude's glyph.
  - **Marks:** working (violet ring), needs you (amber dot and top edge), finished and unseen (green ✓
    and top edge). Unseen lasts until the tab is the front tab while Deck's window has focus
    (`nextAttention`). The Dock's badge counts the tabs that need you; it bounces once (macOS) or the
    taskbar flashes (Windows) when that count rises while Deck is in the background.
  - **Dragging:** pointer events in `TabBar.tsx`, geometry in `drag.ts` (where it lands, how the others
    slide, edge scrolling). Esc is taken in the capture phase, before xterm: in a Claude tab it would
    interrupt Claude. Window → Move Tab Left/Right: Ctrl+Shift+PageUp/PageDown off macOS, no shortcut
    on macOS (Cmd+Shift+←/→ select text on a device's screen).
```

- [ ] **Step 2: README.md**

In the "Terminal tabs" bullet, replace `` `repo · <Claude's status title>` while Claude runs.`` with:

```markdown
`repo · <Claude's session title>` while Claude runs. A tab where Claude runs shows its status: a
  violet ring while it works, an amber dot and edge when it needs you, a green ✓ and edge when it
  finished while you looked elsewhere; the Dock's badge counts the tabs that need you. Drag tabs to
  reorder them (Window → Move Tab Left/Right; Ctrl+Shift+PageUp/PageDown on Windows).
```

- [ ] **Step 3: docs/TESTING.md**

After step `18ab.` (before `**Restart**`), add:

```markdown
18ac. Tabs: run `claude` in two tabs. In one, type `/config` and switch to the other: the first tab
     gets an amber dot and an amber top edge; with Deck in the background, its taskbar button flashes.
     (No mark ever: Claude Code may not write `%USERPROFILE%\.claude\sessions` on Windows. Report it.)
18ad. Go back, press Esc, and give Claude a small task; switch to the other tab before it finishes.
     When it finishes, the first tab gets a green ✓ and a green top edge; clicking it clears them.
18ae. Drag a terminal tab across the others and drop it; press Esc mid-drag to put one back. The
     Projects tab stays first.
18af. Ctrl+Shift+PageUp and Ctrl+Shift+PageDown move the front tab left and right.
```

- [ ] **Step 4: Commit**

```bash
git add CLAUDE.md README.md docs/TESTING.md
git -c user.email=franco@effektstudios.com commit -m "Docs: Claude's status on tabs, and dragging tabs"
```

---

### Task 15: Check it in the app

No code; a check in a dev build, with no prompt to Claude (no tokens). Record what you saw in the spec as "## Checked in the app (2026-11-25)", and commit that.

- [ ] **Step 1: Start a dev build with its own data folder**

```bash
S=/private/tmp/claude-501/-Users-francolandman-Development-deck/e487352c-02e4-4671-ad6d-28154e5a0969/scratchpad
mkdir -p "$S/ud-tabs" ~/Development/.deck-probe-title
npx electron-vite dev --remoteDebuggingPort 9344 --inspect 9339 -- --user-data-dir="$S/ud-tabs"
```

(Run it in the background. Port 9333 is held by adb on this Mac. `~/Development/.deck-probe-title` is a folder Claude Code already trusts, through its parent, and already knows from an earlier probe, so no new entry lands in `~/.claude.json`.)

- [ ] **Step 2: Drive it through the DevTools protocol**

Use `$S/cdp.mjs` (from the earlier probe; it exports `evaluate`, `type`, `enter`, `sleep`, `log`, `send`) with a script that:
1. Collects pty ids: `window.__ptys = []; window.deck.pty.onData((id) => { if (!window.__ptys.includes(id)) window.__ptys.push(id) })`.
2. Opens two tabs (`document.querySelector('.tab-new').click()`), and in each types `cd ~/Development/.deck-probe-title && claude` + Enter. Waits 15 s.
3. In tab A (in front): types `/config` + Enter. Expect, within 3 s, A's `.tab-mark.waiting` and `.tab.mark-waiting`, and through the main inspector (port 9339, `process.mainModule.require('electron').app.dock.getBadge()`) a badge of `"1"`.
4. Clicks tab B. A keeps the amber mark.
5. Finds A's pty id (the one that echoed the `/config` typing) and sends Esc to it: `window.deck.pty.write(idA, '\x1b')`. Expect A's mark to become `.tab-mark.done` with `.tab.mark-done`, and the badge `""`.
6. Clicks A: no mark on A.
7. Checks the names: A's `.tab-label` doesn't start with a status glyph while its status is known.
8. Drags: `Input.dispatchMouseEvent` `mousePressed` on tab A's centre, `mouseMoved` in 10 px steps past tab B's middle, `mouseReleased`. Expect the labels' order to show A after B. Repeat with Esc (`Input.dispatchKeyEvent` keyDown Escape) before releasing: the order doesn't change.
9. Window → Move Tab Left: through the main inspector, find the item by label in `Menu.getApplicationMenu()` and `click()` it; the front tab moves left.

- [ ] **Step 3: Clean up**

Quit the dev build (main inspector: `process.mainModule.require('electron').app.quit()`). Then remove `~/Development/.deck-probe-title`, the dev build's `$S/ud-tabs`, and only the session logs this check created under `~/.claude/projects/-Users-francolandman-Development--deck-probe-title/`.

- [ ] **Step 4: Record and commit**

Add "## Checked in the app (2026-11-25)" to the spec with what each step showed (and anything that didn't work, with what was done about it), then:

```bash
git add docs/superpowers/specs/2026-11-24-tab-status-design.md
git -c user.email=franco@effektstudios.com commit -m "Spec: the tabs' status and dragging, checked in the app"
```
