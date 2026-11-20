import { isPublicLibraryBook } from './libraryShelf'
import type { Book, Category, SyncRecord } from './types'

export type RecommendedGenre = {
  categoryId: string
  sourceBooks: Book[]
  unreadBooks: Book[]
}

export type ReadingRecommendations = {
  genres: RecommendedGenre[]
  books: Book[]
  hasReadingHistory: boolean
}

export type ReadingRecommendationInput = {
  books: readonly Book[]
  catalog: readonly Book[]
  categories: readonly Category[]
  records: readonly SyncRecord[]
  profile: string
  resetBookIds?: ReadonlySet<string>
  genreLimit?: number
  bookLimit?: number
}

const numberInRange = (value: unknown, minimum: number, maximum: number): value is number =>
  typeof value === 'number' && Number.isFinite(value) && value >= minimum && value <= maximum
const timestamp = (value: unknown) => numberInRange(value, 0, Number.MAX_SAFE_INTEGER) ? value : 0
const limit = (value: number | undefined, fallback: number, maximum: number) =>
  typeof value === 'number' && Number.isFinite(value) ? Math.max(0, Math.min(maximum, Math.floor(value))) : fallback

/** Local, explainable category matching, not proof that someone read a book.
 * Opening a cover, favorites and elapsed/idle time alone are not reading signals.
 * Each distinct book contributes once, so repeated sessions cannot dominate. */
export function buildReadingRecommendations({ books, catalog, categories, records, profile, resetBookIds = new Set(), genreLimit, bookLimit }: ReadingRecommendationInput): ReadingRecommendations {
  const maximumGenres = limit(genreLimit, 3, 3)
  const maximumBooks = limit(bookLimit, 4, 12)
  const knownCategories = new Set(categories.filter(category => category.id && category.name.trim() && category.id !== 'imported' && category.id !== 'all').map(category => category.id))
  const booksById = new Map<string, Book>()
  for (const book of books) if (book.id && !booksById.has(book.id)) booksById.set(book.id, book)
  // A public catalog entry is the authoritative metadata when duplicated in
  // the browser's imported/offline collection.
  for (const book of catalog) if (book.id) booksById.set(book.id, book)
  const currentRecords = records.filter(record => profile && record.profile === profile)
  const resetAt = new Map<string, number>()
  for (const record of currentRecords) {
    if (record.kind !== 'reading_progress' || !record.deleted || typeof record.payload.book_id !== 'string') continue
    const bookId = record.payload.book_id
    resetAt.set(bookId, Math.max(resetAt.get(bookId) || 0, timestamp(record.payload.last_read_at)))
  }
  const opened = new Set<string>()
  const evidence = new Map<string, { book: Book; score: number }>()
  const addEvidence = (bookId: string, score: number) => {
    const book = booksById.get(bookId)
    if (!book || resetBookIds.has(bookId)) return
    const previous = evidence.get(bookId)
    if (!previous || score > previous.score) evidence.set(bookId, { book, score })
  }
  for (const record of currentRecords) {
    if (record.deleted || typeof record.payload.book_id !== 'string') continue
    const bookId = record.payload.book_id
    if (resetBookIds.has(bookId)) continue
    const reset = resetAt.get(bookId)
    if (record.kind === 'reading_progress') {
      const progress = record.payload.progression
      // A tombstone can coexist with a legacy progress ID. Older progress must
      // not reintroduce a book the user explicitly reset to unread.
      if (reset !== undefined && timestamp(record.payload.last_read_at) <= reset) continue
      if (!numberInRange(progress, 0, 1)) continue
      opened.add(bookId)
      if (progress >= .05) addEvidence(bookId, progress >= .98 ? 3 : 1 + progress)
    } else if (record.kind === 'reading_sessions') {
      const { duration_ms: duration, start_progress: start, end_progress: end } = record.payload
      if (!numberInRange(duration, 5000, Number.MAX_SAFE_INTEGER) || !numberInRange(start, 0, 1) || !numberInRange(end, 0, 1)) continue
      // Duration is wall time in legacy sessions. Require meaningful movement
      // as well, and ignore sessions from before a reset even after a reread.
      if (reset !== undefined && timestamp(record.payload.started_at) <= reset) continue
      if (end - start + Number.EPSILON >= .01) addEvidence(bookId, 1 + Math.min(1, end - start))
    }
  }
  const seenCandidates = new Set<string>()
  const candidates = catalog.filter(book => {
    if (!book.id || seenCandidates.has(book.id) || !book.fileUrl?.trim() || !isPublicLibraryBook(book)) return false
    seenCandidates.add(book.id)
    return !opened.has(book.id) && !evidence.has(book.id)
  })
  const candidatesByCategory = new Map<string, Book[]>()
  for (const book of candidates) {
    if (!book.categoryId || !knownCategories.has(book.categoryId)) continue
    const group = candidatesByCategory.get(book.categoryId) || []
    group.push(book)
    candidatesByCategory.set(book.categoryId, group)
  }
  const scores = new Map<string, { score: number; sourceBooks: Book[] }>()
  for (const { book, score } of evidence.values()) {
    if (!book.categoryId || !knownCategories.has(book.categoryId) || !candidatesByCategory.has(book.categoryId)) continue
    const group = scores.get(book.categoryId) || { score: 0, sourceBooks: [] }
    group.score += score
    group.sourceBooks.push(book)
    scores.set(book.categoryId, group)
  }
  const genres = [...scores.entries()].sort(([leftId, left], [rightId, right]) =>
    right.score - left.score || right.sourceBooks.length - left.sourceBooks.length || leftId.localeCompare(rightId, 'en'))
    .slice(0, maximumGenres).map(([categoryId, group]): RecommendedGenre => ({
      categoryId,
      sourceBooks: group.sourceBooks.sort((left, right) => left.id.localeCompare(right.id, 'en')),
      unreadBooks: candidatesByCategory.get(categoryId)!,
    }))
  // Round-robin keeps a second matching genre visible instead of filling the
  // whole shelf from the first category. Neutral fallback preserves catalog order.
  const recommended: Book[] = []
  for (let index = 0; recommended.length < maximumBooks && genres.some(genre => genre.unreadBooks.length > index); index++) {
    for (const genre of genres) {
      const book = genre.unreadBooks[index]
      if (book && recommended.length < maximumBooks) recommended.push(book)
    }
  }
  return { genres, books: genres.length ? recommended : candidates.slice(0, maximumBooks), hasReadingHistory: evidence.size > 0 }
}
