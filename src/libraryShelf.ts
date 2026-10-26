import type { Book, SyncRecord } from './types'

/** Imported documents use their own deletion flow; public books stay in Explore. */
export function isPublicLibraryBook(book: Book): boolean {
  return book.source !== 'local' && book.source !== 'cloud' && !book.fileUrl?.startsWith('nocap-private:')
}

/** A deleted progress record records an explicit reset, including cache-only books. */
export function resetLibraryBookIds(records: SyncRecord[], canonicalBookIds: ReadonlyMap<string, string> = new Map()): Set<string> {
  const bookIdFor = (record: SyncRecord) => typeof record.payload.book_id === 'string' ? record.payload.book_id : canonicalBookIds.get(record.id)
  const active = new Set(records.filter(record => record.kind === 'reading_progress' && !record.deleted)
    .map(bookIdFor))
  return new Set(records.filter(record => record.kind === 'reading_progress' && record.deleted &&
    !!bookIdFor(record) && !active.has(bookIdFor(record)))
    .map(record => bookIdFor(record)!))
}
