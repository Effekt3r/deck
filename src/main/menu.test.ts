import type { MenuItemConstructorOptions } from 'electron'
import { describe, expect, it } from 'vitest'
import type { MenuCommand } from '@shared/types'
import { menuTemplate } from './menu'

function items(template: MenuItemConstructorOptions[]): MenuItemConstructorOptions[] {
  return template.flatMap((i) => [i, ...(Array.isArray(i.submenu) ? items(i.submenu) : [])])
}

function shortcuts(platform: NodeJS.Platform) {
  const sent: MenuCommand[] = []
  const all = items(menuTemplate(platform, (cmd) => sent.push(cmd), { packaged: true }))
  const byKey = new Map(all.filter((i) => i.accelerator).map((i) => [String(i.accelerator), i]))
  return { all, byKey, sent }
}

describe('menuTemplate', () => {
  it('macOS: Cmd shortcuts, tabs 1–9 hidden but bound', () => {
    const { byKey, sent } = shortcuts('darwin')
    for (const k of ['Cmd+T', 'Cmd+W', 'Cmd+Shift+O', 'Cmd+F', 'Cmd+Shift+]', 'Cmd+Shift+[', 'Cmd+Shift+G', 'Cmd+Shift+A', 'Cmd+Shift+D']) expect(byKey.has(k), k).toBe(true)
    const tab3 = byKey.get('Cmd+3')
    expect(tab3?.visible).toBe(false)
    tab3?.click?.({} as never, undefined, {} as never)
    expect(sent).toEqual([{ type: 'select-tab', index: 3 }])
  })

  it('Windows: no shortcut takes a plain Ctrl key or Ctrl+Alt (AltGr) from the shell', () => {
    const { byKey } = shortcuts('win32')
    const keys = [...byKey.keys()]
    expect(keys.filter((k) => /^Ctrl\+[A-Z0-9]$/i.test(k))).toEqual([])
    expect(keys.filter((k) => /Alt/.test(k))).toEqual([])
    for (const k of ['Ctrl+Shift+T', 'Ctrl+Shift+W', 'Ctrl+Shift+O', 'Ctrl+Shift+F', 'Ctrl+Shift+G', 'Ctrl+Shift+A', 'Ctrl+Shift+D', 'Ctrl+Tab', 'Ctrl+Shift+Tab']) {
      expect(byKey.has(k), k).toBe(true)
    }
    for (let i = 1; i <= 9; i++) expect(byKey.get(`Ctrl+Shift+${i}`)?.visible, `tab ${i}`).toBe(true)
  })

  it('Windows has no copy/paste roles (Ctrl+C must stay SIGINT)', () => {
    const roles = shortcuts('win32').all.map((i) => i.role).filter(Boolean)
    expect(roles).not.toContain('copy')
    expect(roles).not.toContain('paste')
  })

  it('reload and devtools only in development', () => {
    const roles = (packaged: boolean) => items(menuTemplate('darwin', () => {}, { packaged })).map((i) => i.role)
    expect(roles(true)).not.toContain('toggleDevTools')
    expect(roles(false)).toContain('toggleDevTools')
  })
})
