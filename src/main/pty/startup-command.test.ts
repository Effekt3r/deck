import { afterEach, beforeEach, describe, expect, it, vi } from 'vitest'
import { PROMPT_MARK, StartupCommand } from './startup-command'

describe('StartupCommand', () => {
  beforeEach(() => vi.useFakeTimers())
  afterEach(() => vi.useRealTimers())

  it('types the command at the first prompt, once', () => {
    const w: string[] = []
    const s = new StartupCommand('claude', (d) => w.push(d))
    s.onData('Last login: …')
    expect(w).toEqual([])
    s.onData(`x${PROMPT_MARK}L1VzZXJz\x07`)
    expect(w).toEqual([]) // the hook ran; zsh's line editor isn't reading yet
    s.onData('% \x1b[?2004h')
    s.onData(`${PROMPT_MARK}Lw==\x07% \x1b[?2004h`)
    expect(w).toEqual(['claude\r'])
  })
  it('types it shortly after the mark when no line editor shows up', () => {
    const w: string[] = []
    const s = new StartupCommand('claude', (d) => w.push(d), { settleMs: 500 })
    s.onData(`${PROMPT_MARK}Lw==\x07PS C:\\> `)
    vi.advanceTimersByTime(499); expect(w).toEqual([])
    vi.advanceTimersByTime(1); expect(w).toEqual(['claude\r'])
  })
  it('finds the mark and the editor start split across chunks', () => {
    const w: string[] = []
    const s = new StartupCommand('claude', (d) => w.push(d))
    s.onData(PROMPT_MARK.slice(0, 9)); s.onData(`${PROMPT_MARK.slice(9)}Lw==\x07% \x1b[?20`)
    expect(w).toEqual([])
    s.onData('04h')
    expect(w).toEqual(['claude\r'])
  })
  it('falls back to a timeout when no prompt mark arrives', () => {
    const w: string[] = []
    new StartupCommand('claude', (d) => w.push(d), { timeoutMs: 4000 })
    vi.advanceTimersByTime(3999); expect(w).toEqual([])
    vi.advanceTimersByTime(1); expect(w).toEqual(['claude\r'])
  })
  it('without a fallback it waits for the prompt however long startup takes', () => {
    const w: string[] = []
    const s = new StartupCommand('claude', (d) => w.push(d), { timeoutMs: null })
    s.onData('[oh-my-zsh] Would you like to update? [Y/n] ')
    vi.advanceTimersByTime(60_000)
    expect(w).toEqual([]) // never typed into a startup question
    s.onData(`${PROMPT_MARK}Lw==\x07% \x1b[?2004h`)
    expect(w).toEqual(['claude\r'])
  })
  it('does nothing after dispose', () => {
    const w: string[] = []
    const s = new StartupCommand('claude', (d) => w.push(d))
    s.dispose(); s.onData(PROMPT_MARK); vi.advanceTimersByTime(10000)
    expect(w).toEqual([])
  })
})
