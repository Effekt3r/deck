import { describe, expect, it } from 'vitest'
import { externalUrl } from './external'

describe('externalUrl', () => {
  it('opens web links as they are', () => {
    expect(externalUrl('https://github.com/acme/app/pull/7?tab=files#x')).toBe('https://github.com/acme/app/pull/7?tab=files#x')
    expect(externalUrl('HTTP://example.com')).toBe('HTTP://example.com')
  })

  it('opens mail links without their ?headers (attachments, prefilled text)', () => {
    expect(externalUrl('mailto:me@example.com?attach=/etc/passwd&subject=hi')).toBe('mailto:me@example.com')
    expect(externalUrl('MAILTO:a@b.c,d@e.f')).toBe('MAILTO:a@b.c,d@e.f')
    expect(externalUrl('mailto:?to=x@y.z&attach=~/.ssh/id_ed25519')).toBe('mailto:')
  })

  it('opens nothing else', () => {
    for (const url of ['file:///etc/passwd', 'javascript:alert(1)', 'vscode://file/x', 'ftp://x', ' https://x', '', 42, null, {}]) {
      expect(externalUrl(url)).toBeNull()
    }
  })
})
