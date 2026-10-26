import 'fake-indexeddb/auto'
import { afterEach, expect, it, vi } from 'vitest'
import { getPending, getRecord, keyFor, resetPublicLibraryBook, saveLocalMutation, savePending } from './store'
import { resolveConflict } from './sync'
import type { Session } from './types'

const { changes, push } = vi.hoisted(() => ({ changes: vi.fn(), push: vi.fn() }))
vi.mock('./api', () => ({
  ApiError: class ApiError extends Error {},
  getUser: vi.fn(async () => ({ user: {} })),
  getChanges: changes,
  pushOperation: push,
  uploadBlob: vi.fn(),
}))
afterEach(() => { changes.mockReset(); push.mockReset() })

it('finishes an already-deleted progress conflict without trying to delete the remote tombstone again', async () => {
  const session: Session = { token: 'reset-test', expiresAt: Date.now() / 1000 + 300, user: { id: crypto.randomUUID(), email: 'reset@example.test', emailVerified: true } }
  const profile = `ACCOUNT:${session.user.id}`, bookId = `public-${crypto.randomUUID()}`, id = crypto.randomUUID()
  const key = keyFor(profile, `reading_progress:${id}`)
  await resetPublicLibraryBook(profile, bookId, id)
  const [pending] = await getPending(profile)
  await savePending({ ...pending, conflicted: true, remoteDeleted: true })
  changes.mockResolvedValue({ changes: [{ seq: 8, kind: 'reading_progress', id, version: 8, deleted: 1, payload: { book_id: bookId, last_read_at: Date.now() } }], cursor: 8, hasMore: false })

  await resolveConflict(session, key, 'keep_local')

  expect(push).not.toHaveBeenCalled()
  expect(await getPending(profile)).toEqual([])
  expect(await getRecord(key)).toMatchObject({ version: 8, deleted: true })
})

it('recreates an intentionally reopened book when conflict resolution finds the reset already applied', async () => {
  const session: Session = { token: 'reread-test', expiresAt: Date.now() / 1000 + 300, user: { id: crypto.randomUUID(), email: 'reread@example.test', emailVerified: true } }
  const profile = `ACCOUNT:${session.user.id}`, bookId = `public-${crypto.randomUUID()}`, id = crypto.randomUUID()
  const key = keyFor(profile, `reading_progress:${id}`)
  await resetPublicLibraryBook(profile, bookId, id)
  await saveLocalMutation(profile, 'reading_progress', id, { book_id: bookId, progression: .04, locator_json: 'new start', last_read_at: Date.now() }, false, false)
  const [pending] = await getPending(profile)
  await savePending({ ...pending, conflicted: true, remoteDeleted: true })
  changes.mockResolvedValue({ changes: [{ seq: 8, kind: 'reading_progress', id, version: 8, deleted: 1, payload: { book_id: bookId, last_read_at: Date.now() } }], cursor: 8, hasMore: false })
  push.mockImplementation(async (_token, operation) => ({ receipts: [{ opId: operation.opId, status: 'APPLIED', current: { version: 9, deleted: 0, payload: operation.payload } }] }))

  await resolveConflict(session, key, 'keep_local')

  expect(push).toHaveBeenCalledWith(session.token, expect.objectContaining({ deleted: false, recreate: true, baseVersion: 8, payload: expect.objectContaining({ progression: .04 }) }))
  expect(await getPending(profile)).toEqual([])
  expect(await getRecord(key)).toMatchObject({ version: 9, deleted: false, payload: { progression: .04 } })
})
