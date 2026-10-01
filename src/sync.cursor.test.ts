import 'fake-indexeddb/auto'
import { expect, it, vi } from 'vitest'
import { getRecords, getSyncCursor } from './store'
import { syncNow } from './sync'
import { SYNC_KINDS, type Session } from './types'

const { getChanges } = vi.hoisted(() => ({ getChanges: vi.fn() }))

vi.mock('./api', () => ({
  ApiError: class ApiError extends Error {},
  getUser: vi.fn(async () => ({ user: {} })),
  pushOperation: vi.fn(),
  getChanges: getChanges.mockImplementation(async (_token: string, cursor: number) => ({
    changes: cursor === 0 ? [
      'categories', 'catalog_books', 'reading_progress', 'bookmarks', 'highlights', 'favorites',
      'tags', 'collections', 'book_tag_cross_ref', 'book_collection_cross_ref', 'review_items',
      'reading_sessions', 'per_book_preferences',
    ].map((kind, index) => ({ seq: index + 1, kind, id: `${kind}-record`, version: 1, deleted: 0, payload: { id: `${kind}-local` } })) : [],
    cursor: cursor === 0 ? 13 : cursor,
    hasMore: false,
  })),
}))

it('pulls every Android sync kind and resumes from the persisted cursor', async () => {
  const session: Session = {
    token: 'cursor-test-token',
    expiresAt: Date.now() / 1000 + 60,
    user: { id: `cursor-${crypto.randomUUID()}`, email: 'cursor@example.invalid', emailVerified: true },
  }
  const profile = `ACCOUNT:${session.user.id}`

  const first = await syncNow(session)
  expect(first.changes).toBe(SYNC_KINDS.length)
  expect(new Set((await getRecords(profile)).map(record => record.kind))).toEqual(new Set(SYNC_KINDS))
  expect(await getSyncCursor(profile)).toBe(SYNC_KINDS.length)

  await syncNow(session)
  expect(getChanges).toHaveBeenLastCalledWith(session.token, SYNC_KINDS.length)
})
