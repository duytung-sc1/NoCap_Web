import type { Book, LocalFile } from './types'

/** Private cache entries must describe the same immutable blob as the catalog. */
export function currentLocalFile(book: Book, file: LocalFile | undefined): LocalFile | undefined {
  return file && (book.source === 'local' || file.book.fileUrl === book.fileUrl) ? file : undefined
}

/**
 * Merge catalog, cloud and browser-backed books without rendering the same
 * logical document more than once. Later sources win so a browser-backed copy
 * can be opened immediately while retaining the stable cloud book id.
 */
export function mergeBooksById(...sources: Book[][]): Book[] {
  const books = new Map<string, Book>()
  for (const source of sources) {
    for (const book of source) {
      if (!book.id) continue
      books.set(book.id, book)
    }
  }
  return [...books.values()]
}
