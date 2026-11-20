import { describe, expect, it } from 'vitest'
import { buildReadingRecommendations, type ReadingRecommendationInput } from './readingRecommendations'
import type { Book, SyncRecord } from './types'

const profile = 'ACCOUNT:reader-one'
const categories = [{ id: 'fiction', name: 'Tiểu thuyết' }, { id: 'history', name: 'Lịch sử' }, { id: 'science', name: 'Science' }]
const book = (id: string, categoryId = 'fiction', extra: Partial<Book> = {}): Book => ({ id, categoryId, title: `Book ${id}`, author: 'Author', fileUrl: `https://example.test/${id}.epub`, source: 'catalog', ...extra })
const record = (kind: SyncRecord['kind'], bookId: string, payload: Record<string, unknown> = {}, extra: Partial<SyncRecord> = {}): SyncRecord => ({
  key: `${profile}:${kind}:${bookId}`, id: `${kind}:${bookId}`, profile, version: 0, deleted: false, kind,
  payload: { book_id: bookId, ...payload }, ...extra,
})
const progress = (id: string, progression: unknown, at = 100) => record('reading_progress', id, { progression, last_read_at: at })
const session = (id: string, start: unknown, end: unknown, duration: unknown, startedAt = 100) => record('reading_sessions', id, { start_progress: start, end_progress: end, duration_ms: duration, started_at: startedAt, ended_at: startedAt + (typeof duration === 'number' ? duration : 0) })
const run = (input: Partial<ReadingRecommendationInput> = {}) => buildReadingRecommendations({
  books: [book('read-f'), book('read-h', 'history'), book('read-s', 'science')],
  catalog: [book('next-f'), book('next-h', 'history'), book('next-s', 'science')],
  categories, records: [], profile, ...input,
})

describe('local reading recommendations', () => {
  it('uses neutral catalog order without claiming personalization when history is absent', () => {
    const result = run()
    expect(result.genres).toEqual([])
    expect(result.hasReadingHistory).toBe(false)
    expect(result.books.map(value => value.id)).toEqual(['next-f', 'next-h', 'next-s'])
  })

  it('does not turn an opened cover, a favorite or an idle session into a genre preference', () => {
    const result = run({ records: [progress('read-f', 0), progress('read-h', .01), record('favorites', 'read-s'), session('read-s', .2, .2, 3_600_000)] })
    expect(result.genres).toEqual([])
    expect(result.hasReadingHistory).toBe(false)
  })

  it('uses five-percent reading progress and exposes the real source book for an honest explanation', () => {
    const source = book('read-f', 'fiction', { title: 'Một cuốn sách đã đọc', language: 'vi' })
    const result = run({ books: [source], records: [progress('read-f', .05)] })
    expect(result.genres).toEqual([{ categoryId: 'fiction', sourceBooks: [source], unreadBooks: [book('next-f')] }])
    expect(result.books.map(value => value.id)).toEqual(['next-f'])
    expect(result.hasReadingHistory).toBe(true)
  })

  it('requires both at least five seconds and one-percent movement for session-only history', () => {
    expect(run({ records: [session('read-f', .2, .21, 5000)] }).genres.map(value => value.categoryId)).toEqual(['fiction'])
    for (const row of [session('read-f', .2, .21, 4999), session('read-f', .2, .209, 60000), session('read-f', .2, .1, 60000)]) {
      expect(run({ records: [row] }).genres).toEqual([])
    }
  })

  it('gives completed books more weight, but repeated sessions for one book contribute only once', () => {
    const history = progress('read-h', 1)
    const fiction = Array.from({ length: 20 }, (_, index) => ({ ...session('read-f', 0, .2, 60000), id: `repeat-${index}`, key: `repeat-${index}` }))
    const result = run({ records: [...fiction, history] })
    expect(result.genres.map(value => value.categoryId)).toEqual(['history', 'fiction'])
    expect(result.genres[1].sourceBooks).toHaveLength(1)
  })

  it('combines distinct books in the same genre and uses a stable category ID tie-break', () => {
    const records = [progress('read-h', .1), progress('read-f', .1)]
    expect(run({ records }).genres.map(value => value.categoryId)).toEqual(['fiction', 'history'])
    expect(run({ records: [...records].reverse(), books: [book('read-h', 'history'), book('read-f')] }).genres.map(value => value.categoryId)).toEqual(['fiction', 'history'])
    const result = run({ books: [book('read-f'), book('read-h', 'history'), book('read-h2', 'history')], records: [...records, progress('read-h2', .1)] })
    expect(result.genres[0].categoryId).toBe('history')
    expect(result.genres[0].sourceBooks.map(value => value.id)).toEqual(['read-h', 'read-h2'])
  })

  it('isolates profiles and ignores tombstones, invalid measurements and unknown books', () => {
    const records = [
      { ...progress('read-f', .8), profile: 'ACCOUNT:another' },
      { ...progress('read-h', .7), deleted: true },
      progress('missing-book', .8),
      progress('read-s', NaN), progress('read-s', Infinity), progress('read-s', -1), progress('read-s', 1.1), progress('read-s', '0.5'),
      session('read-s', 0, 1, Infinity), session('read-s', 0, '1', 60000), session('read-s', 0, 1.1, 60000),
    ]
    expect(run({ records }).genres).toEqual([])
    expect(run({ records }).hasReadingHistory).toBe(false)
    expect(run({ profile: '', records: [{ ...progress('read-f', 1), profile: '' }] }).hasReadingHistory).toBe(false)
  })

  it('does not infer categories from imported titles, descriptions, authors or unknown category IDs', () => {
    const sources = [book('import', 'imported', { source: 'local', title: 'History Science Fiction', description: 'history science fiction' }), book('unknown', 'unmapped')]
    const result = run({ books: sources, categories: [...categories, { id: 'imported', name: 'Tài liệu riêng' }], records: [progress('import', 1), progress('unknown', .7)] })
    expect(result.genres).toEqual([])
    expect(result.hasReadingHistory).toBe(true)
  })

  it('requires unread available public catalog books before suggesting a genre', () => {
    const catalog = [book('next-f', 'fiction', { source: 'local' }), book('cloud-f', 'fiction', { source: 'cloud' }), book('private-f', 'fiction', { fileUrl: 'nocap-private:hash' }), book('missing-f', 'fiction', { fileUrl: '' }), book('read-h', 'history')]
    const result = run({ catalog, records: [progress('read-f', .3), progress('read-h', .4)] })
    expect(result.genres).toEqual([])
    expect(result.books).toEqual([])
  })

  it('excludes both already-opened books and session-only read books from unread candidates', () => {
    const catalog = [book('read-f'), book('opened-f'), book('session-f'), book('new-f')]
    const result = run({ catalog, records: [progress('read-f', .4), progress('opened-f', 0), session('session-f', .1, .2, 60000)] })
    expect(result.genres[0].unreadBooks.map(value => value.id)).toEqual(['new-f'])
    expect(result.books.map(value => value.id)).toEqual(['new-f'])
  })

  it('respects explicit shelf resets even when old sessions remain and allows the book to be suggested unread again', () => {
    const catalog = [book('read-f'), book('next-f')]
    const result = run({ catalog, records: [progress('read-f', 1), session('read-f', .2, .9, 60000)], resetBookIds: new Set(['read-f']) })
    expect(result.genres).toEqual([])
    expect(result.hasReadingHistory).toBe(false)
    expect(result.books.map(value => value.id)).toEqual(['read-f', 'next-f'])
  })

  it('does not resurrect pre-reset sessions or legacy progress after a fresh zero-progress reread', () => {
    const reset = { ...progress('read-f', 1, 200), deleted: true }
    const records = [reset, progress('read-f', .8, 100), session('read-f', 0, .5, 60000, 50), progress('read-f', 0, 300)]
    expect(run({ records }).genres).toEqual([])
    expect(run({ records: [...records, session('read-f', 0, .1, 60000, 400)] }).genres.map(value => value.categoryId)).toEqual(['fiction'])
    expect(run({ records: [...records, progress('read-f', .1, 400)] }).genres.map(value => value.categoryId)).toEqual(['fiction'])
  })

  it('uses public catalog metadata over a stale browser duplicate without mutating inputs', () => {
    const catalog = [book('read-f'), book('next-f')]
    const source = book('read-f', 'history', { source: 'local' })
    const input = { books: [source], catalog, records: [progress('read-f', .4)] }
    const before = JSON.stringify(input)
    expect(run(input).genres[0].categoryId).toBe('fiction')
    expect(JSON.stringify(input)).toBe(before)
  })

  it('limits genres to three and interleaves books across matching genres', () => {
    const extraCategories = [...categories, { id: 'travel', name: 'Du lịch' }]
    const sourceBooks = extraCategories.map(category => book(`read-${category.id}`, category.id))
    const catalog = extraCategories.flatMap(category => [book(`new-${category.id}-1`, category.id), book(`new-${category.id}-2`, category.id)])
    const result = run({ categories: extraCategories, books: sourceBooks, catalog, records: sourceBooks.map(source => progress(source.id, .1)), genreLimit: 99 })
    expect(result.genres.map(value => value.categoryId)).toEqual(['fiction', 'history', 'science'])
    expect(result.books.map(value => value.id)).toEqual(['new-fiction-1', 'new-history-1', 'new-science-1', 'new-fiction-2'])
  })

  it('deduplicates catalog IDs and returns useful neutral results for sparse or empty catalogs', () => {
    expect(run({ catalog: [book('next-f'), book('next-f'), book('last')] }).books.map(value => value.id)).toEqual(['next-f', 'last'])
    expect(run({ catalog: [], records: [progress('read-f', .2)] }).books).toEqual([])
    expect(run({ bookLimit: 1 }).books).toHaveLength(1)
    expect(run({ bookLimit: 0 }).books).toEqual([])
    expect(run({ genreLimit: 0, records: [progress('read-f', .2)] }).genres).toEqual([])
  })
})
