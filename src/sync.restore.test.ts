import 'fake-indexeddb/auto'
import { afterEach, expect, it, vi } from 'vitest'
import { createLibraryBackup, restoreLibraryBackup } from './backup'
import { saveFile, saveRecord, getPending } from './store'
import { syncNow } from './sync'
import type { Session, SyncOperation } from './types'

const { upload, push, order } = vi.hoisted(() => ({ upload: vi.fn(), push: vi.fn(), order: [] as string[] }))
vi.mock('./api', () => ({
  ApiError: class ApiError extends Error {},
  getUser: vi.fn(async () => ({ user: {} })),
  getChanges: vi.fn(async () => ({ changes: [], cursor: 0, hasMore: false })),
  uploadBlob: upload.mockImplementation(async () => { order.push('blob') }),
  pushOperation: push.mockImplementation(async (_token: string, op: SyncOperation) => {
    order.push(op.kind)
    return { receipts: [{ opId: op.opId, status: 'APPLIED', current: { version: 1, deleted: Number(op.deleted), payload: op.payload } }] }
  }),
}))
afterEach(() => { order.length = 0; upload.mockClear(); push.mockClear() })

it('uploads restored private bytes before publishing the book and its bookmark; retries failed uploads', async () => {
  const source = `RESTORE_SOURCE:${crypto.randomUUID()}`
  const session: Session = { token: 'test-token', expiresAt: Date.now()/1000+300, user: { id: crypto.randomUUID(), email: 'restore@example.test', emailVerified: true } }
  const target = `ACCOUNT:${session.user.id}`
  const bookId = `web-${crypto.randomUUID()}`
  await saveFile({ key: `${source}:${bookId}`, profile: source, book: { id: bookId, title: 'Private', author: 'Test', source: 'local', format: 'TXT' }, data: new Blob(['private bytes']), addedAt: Date.now() })
  const id = crypto.randomUUID()
  await saveRecord({ key: `${source}:bookmarks:${id}`, profile: source, kind: 'bookmarks', id, version: 7, deleted: false, payload: { book_id: bookId, note: 'bookmark' } })
  await restoreLibraryBackup(target, JSON.parse(JSON.stringify(await createLibraryBackup(source))))
  upload.mockRejectedValueOnce(new Error('offline'))
  await expect(syncNow(session)).rejects.toThrow('offline')
  expect(push).not.toHaveBeenCalled()
  expect(await getPending(target)).toHaveLength(2)
  await syncNow(session)
  expect(order).toEqual(['blob', 'catalog_books', 'bookmarks'])
  expect(await getPending(target)).toHaveLength(0)
  expect(await (upload.mock.calls[1][2] as Blob).text()).toBe('private bytes')
})
