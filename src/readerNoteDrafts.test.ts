// @vitest-environment jsdom
import { beforeEach, describe, expect, it, vi } from 'vitest'
import { clearReaderNoteDraft, emptyReaderNoteDraft, readReaderNoteDraft, writeReaderNoteDraft } from './readerNoteDrafts'
import { DRAWING_COLORS, emptyDrawing } from './drawing'

beforeEach(() => { localStorage.clear(); vi.restoreAllMocks() })

describe('reading note drafts', () => {
  it('restores the drawing, text, selected passage and original anchor without mixing accounts or books', () => {
    const drawing = emptyDrawing()
    drawing.strokes.push({ color: DRAWING_COLORS[0], width: 3, points: [[10, 20], [100, 200]] })
    const draft = { ...emptyReaderNoteDraft(), drawing, note: 'A formula', selection: { text: 'Energy', locator: '{"page":2}' }, anchor: { locatorJson: '{"page":2}', progression: .2, chapterTitle: 'Chapter 2' } }
    expect(writeReaderNoteDraft('ACCOUNT:a', 'book', draft)).toBe(true)
    expect(readReaderNoteDraft('ACCOUNT:a', 'book')).toEqual(draft)
    expect(readReaderNoteDraft('ACCOUNT:b', 'book')).toBeNull()
    expect(readReaderNoteDraft('ACCOUNT:a', 'other')).toBeNull()
    expect(readReaderNoteDraft('DEVICE_LOCAL', 'book')).toBeNull()
  })

  it('clears a committed snapshot but preserves a newer draft and supports account IDs containing separators', () => {
    const draft = { ...emptyReaderNoteDraft(), note: 'First' }
    writeReaderNoteDraft('ACCOUNT:a:b', 'c', draft)
    expect(readReaderNoteDraft('ACCOUNT:a', 'b:c')).toBeNull()
    writeReaderNoteDraft('ACCOUNT:a:b', 'c', { ...draft, note: 'Newer' })
    clearReaderNoteDraft('ACCOUNT:a:b', 'c', draft)
    expect(readReaderNoteDraft('ACCOUNT:a:b', 'c')?.note).toBe('Newer')
    clearReaderNoteDraft('ACCOUNT:a:b', 'c', { ...draft, note: 'Newer' })
    expect(readReaderNoteDraft('ACCOUNT:a:b', 'c')).toBeNull()
  })

  it('treats unavailable storage as a recoverable failure instead of losing the live draft', () => {
    vi.spyOn(Storage.prototype, 'setItem').mockImplementation(() => { throw new DOMException('Quota', 'QuotaExceededError') })
    expect(writeReaderNoteDraft('a', 'book', { ...emptyReaderNoteDraft(), note: 'Still in memory' })).toBe(false)
  })

  it('ignores corrupt or unsupported drafts, and discards an explicitly emptied draft', () => {
    const key = 'nocap-reader-note-draft-v1:["a","book"]'
    for (const raw of ['broken', JSON.stringify({ version: 2 }), JSON.stringify({ version: 1, ...emptyReaderNoteDraft(), drawing: { version: 99 } })]) {
      localStorage.setItem(key, raw)
      expect(readReaderNoteDraft('a', 'book')).toBeNull()
    }
    writeReaderNoteDraft('a', 'book', { ...emptyReaderNoteDraft(), note: 'Thought' })
    expect(writeReaderNoteDraft('a', 'book', emptyReaderNoteDraft())).toBe(true)
    expect(readReaderNoteDraft('a', 'book')).toBeNull()
  })
})
