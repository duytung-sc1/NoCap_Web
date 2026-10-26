import { describe, expect, it } from 'vitest'
import { isPublicLibraryBook, resetLibraryBookIds } from './libraryShelf'
import type { SyncRecord } from './types'

const progress = (book: string, deleted: boolean, id = book): SyncRecord => ({
  key: `ACCOUNT:a:reading_progress:${id}`, profile: 'ACCOUNT:a', kind: 'reading_progress', id,
  deleted, version: 1, payload: { book_id: book, progression: 1 },
})

describe('public library membership after resetting a book', () => {
  it('separates public catalogue books from private and browser documents', () => {
    const base = { id: 'book', title: 'Book', author: '' }
    expect(isPublicLibraryBook(base)).toBe(true)
    expect(isPublicLibraryBook({ ...base, source: 'public' })).toBe(true)
    expect(isPublicLibraryBook({ ...base, source: 'local' })).toBe(false)
    expect(isPublicLibraryBook({ ...base, source: 'cloud' })).toBe(false)
    expect(isPublicLibraryBook({ ...base, fileUrl: 'nocap-private:hash' })).toBe(false)
  })

  it('uses progress tombstones to suppress cache-only membership until reading resumes', () => {
    expect([...resetLibraryBookIds([progress('reset', true), progress('reading', false)])]).toEqual(['reset'])
    expect(resetLibraryBookIds([progress('reset', true), progress('reset', false, 'new')]).has('reset')).toBe(false)
    expect(resetLibraryBookIds([{ ...progress('other', true), kind: 'favorites' }]).size).toBe(0)
  })

  it('recognizes empty legacy tombstones by their canonical progress identity', () => {
    const empty = { ...progress('book', true, 'canonical'), payload: {} }
    const identities = new Map([['canonical', 'book']])
    expect(resetLibraryBookIds([empty], identities).has('book')).toBe(true)
    expect(resetLibraryBookIds([empty, progress('book', false, 'new')], identities).has('book')).toBe(false)
  })
})
