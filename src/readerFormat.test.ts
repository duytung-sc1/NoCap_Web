import { describe, expect, it } from 'vitest'
import { detectReaderFormat } from './readerFormat'
import type { Book } from './types'

const bytes = (...values: number[]) => new Uint8Array(values).buffer
const book = (format: string, title = 'Document'): Book => ({ id: 'b', title, author: '', format })

describe('detectReaderFormat', () => {
  it('does not treat an EPUB title containing PDF as a PDF file', () => {
    expect(detectReaderFormat(book('EPUB', 'A practical PDF handbook'), bytes(0x50, 0x4b, 3, 4))).toBe('epub')
  })

  it('trusts a PDF magic header when metadata is wrong', () => {
    expect(detectReaderFormat(book('EPUB'), bytes(0x25, 0x50, 0x44, 0x46, 0, 0, 0, 0, 0, 0, 0, 0))).toBe('pdf')
  })

  it('detects common image headers', () => {
    expect(detectReaderFormat(book(''), bytes(0x89, 0x50, 0x4e, 0x47, 0, 0, 0, 0, 0, 0, 0, 0))).toBe('image')
  })

  it('detects CBZ files from format or extension', () => {
    expect(detectReaderFormat(book('CBZ'), bytes(0x50, 0x4b, 3, 4))).toBe('cbz')
    expect(detectReaderFormat(book('', 'one-piece-vol1.cbz'), bytes(0x50, 0x4b, 3, 4))).toBe('cbz')
  })
})
