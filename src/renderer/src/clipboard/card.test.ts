import { describe, expect, it } from 'vitest'
import { cardTitle, fileBadge } from './card'

describe('cardTitle', () => {
  it('names what the card holds', () => {
    expect(cardTitle({ id: '1', kind: 'image', width: 1440, height: 900, thumbnail: '' })).toBe('Image · 1440×900')
    expect(cardTitle({ id: '2', kind: 'image', width: 0, height: 0, thumbnail: '' })).toBe('Image')
    expect(cardTitle({ id: '3', kind: 'files', names: ['a.pdf'], more: 0, folder: '/x' })).toBe('1 file')
    expect(cardTitle({ id: '4', kind: 'files', names: ['a', 'b', 'c'], more: 4, folder: '/x' })).toBe('7 files')
    expect(cardTitle({ id: '5', kind: 'text', lines: ['hi'], lineCount: 1 })).toBe('1 line')
    expect(cardTitle({ id: '6', kind: 'text', lines: ['a', 'b', 'c'], lineCount: 12 })).toBe('12 lines')
  })
})

describe('fileBadge', () => {
  it('is the extension in capitals, up to four letters', () => {
    expect(fileBadge('spec.pdf')).toBe('PDF')
    expect(fileBadge('shot one.jpeg')).toBe('JPEG')
    expect(fileBadge('notes.markdown')).toBe('')
    expect(fileBadge('Makefile')).toBe('')
    expect(fileBadge('.env')).toBe('')
  })
})
