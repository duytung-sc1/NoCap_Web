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

async function snapshot(bookId: string, text: string) {
  const profile = `RESTORE_SOURCE:${crypto.randomUUID()}`
  await saveFile({ key: `${profile}:${bookId}`, profile, book: { id: bookId, title: text, author: 'Test', source: 'local', format: 'TXT' }, data: new Blob([text]), addedAt: Date.now() })
  return JSON.parse(JSON.stringify(await createLibraryBackup(profile)))
}

function account() {
  const session: Session = { token: 'test-token', expiresAt: Date.now() / 1000 + 300, user: { id: crypto.randomUUID(), email: 'restore@example.test', emailVerified: true } }
  return { session, profile: `ACCOUNT:${session.user.id}`, bookId: `web-${crypto.randomUUID()}` }
}

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

it('uploads the new restored bytes after a previous snapshot could not upload', async () => {
  const { session, profile, bookId } = account()
  await restoreLibraryBackup(profile, await snapshot(bookId, 'old snapshot'))
  const [original] = await getPending(profile)
  upload.mockRejectedValueOnce(new Error('offline'))
  await expect(syncNow(session)).rejects.toThrow('offline')
  await restoreLibraryBackup(profile, await snapshot(bookId, 'new snapshot'))
  upload.mockImplementationOnce(async (_token: string, hash: string, data: Blob) => {
    const actual = Array.from(new Uint8Array(await crypto.subtle.digest('SHA-256', await data.arrayBuffer())), byte => byte.toString(16).padStart(2, '0')).join('')
    if (hash !== actual) throw new Error('Blob checksum mismatch')
  })
  await syncNow(session)
  expect(push).toHaveBeenCalledOnce()
  expect(push.mock.calls[0][1].opId).not.toBe(original.operation.opId)
  expect(push.mock.calls[0][1].payload.title).toBe('new snapshot')
  expect(await getPending(profile)).toEqual([])
})

it('does not publish an obsolete snapshot when restore replaces it during the blob upload', async () => {
  const { session, profile, bookId } = account()
  await restoreLibraryBackup(profile, await snapshot(bookId, 'old snapshot'))
  const replacement = await snapshot(bookId, 'new snapshot')
  let release!: () => void
  let uploading!: () => void
  const started = new Promise<void>(resolve => { uploading = resolve })
  upload.mockImplementationOnce(() => { uploading(); return new Promise<void>(resolve => { release = resolve }) })
  const syncing = syncNow(session)
  await started
  await restoreLibraryBackup(profile, replacement)
  release()
  await syncing
  expect(push).not.toHaveBeenCalled()
  expect((await getPending(profile))[0].operation.payload.title).toBe('new snapshot')
  await syncNow(session)
  expect(push).toHaveBeenCalledOnce()
  expect(push.mock.calls[0][1].payload.title).toBe('new snapshot')
  expect(await getPending(profile)).toEqual([])
})

it('reconciles an already-pushed snapshot before uploading a replacement restored during its receipt', async () => {
  const { session, profile, bookId } = account()
  await restoreLibraryBackup(profile, await snapshot(bookId, 'old snapshot'))
  const replacement = await snapshot(bookId, 'new snapshot')
  const [original] = await getPending(profile)
  let release!: () => void
  let pushing!: () => void
  const started = new Promise<void>(resolve => { pushing = resolve })
  push.mockImplementationOnce((_token: string, op: SyncOperation) => {
    pushing()
    return new Promise(resolve => { release = () => resolve({ receipts: [{ opId: op.opId, status: 'APPLIED', current: { version: 1, deleted: 0, payload: op.payload } }] }) })
  })
  const syncing = syncNow(session)
  await started
  await restoreLibraryBackup(profile, replacement)
  expect((await getPending(profile))[0].operation.opId).toBe(original.operation.opId)
  release()
  await syncing
  expect((await getPending(profile))[0]).toMatchObject({ attempted: false, needsBlobUpload: true, operation: { baseVersion: 1, payload: { title: 'new snapshot' } } })
  await syncNow(session)
  expect(upload).toHaveBeenCalledTimes(2)
  expect(push).toHaveBeenCalledTimes(2)
  expect(push.mock.calls[1][1].payload.title).toBe('new snapshot')
  expect(await getPending(profile)).toEqual([])
})
