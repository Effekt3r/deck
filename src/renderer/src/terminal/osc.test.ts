import { describe, expect, it } from 'vitest'
import { parseOsc7, parseSetUserVar } from './osc'

const b64 = (s: string) => btoa(String.fromCharCode(...new TextEncoder().encode(s)))

describe('parseOsc7', () => {
  it('decodes a file URL', () => {
    expect(parseOsc7('file://mac.local/Users/f/My%20Dir')).toBe('/Users/f/My Dir')
    expect(parseOsc7('file:///tmp')).toBe('/tmp')
  })
  it('turns /C:/x into C:/x', () => expect(parseOsc7('file://PC/C:/Users/f')).toBe('C:/Users/f'))
  it('rejects other payloads', () => {
    expect(parseOsc7('http://x/y')).toBeNull()
    expect(parseOsc7('file://host')).toBeNull()
  })
  it('keeps a path whose % was not encoded', () => expect(parseOsc7('file://PC/C:/100%')).toBe('C:/100%'))
})

describe('parseSetUserVar', () => {
  it('decodes base64 UTF-8 values', () => {
    expect(parseSetUserVar(`SetUserVar=GIT_REPO=${b64('/Volumes/Wyobi/AccessControl_Guard')}`))
      .toEqual({ name: 'GIT_REPO', value: '/Volumes/Wyobi/AccessControl_Guard' })
    expect(parseSetUserVar(`SetUserVar=GIT_BRANCH=${b64('feature/über')}`)).toEqual({ name: 'GIT_BRANCH', value: 'feature/über' })
  })
  it('accepts empty values and rejects other 1337 commands', () => {
    expect(parseSetUserVar('SetUserVar=GIT_BRANCH=')).toEqual({ name: 'GIT_BRANCH', value: '' })
    expect(parseSetUserVar('File=inline=1:AAAA')).toBeNull()
    expect(parseSetUserVar('SetUserVar=')).toBeNull()
  })
  it('rejects values that are not base64', () => expect(parseSetUserVar('SetUserVar=X=not base64!')).toBeNull())
})
