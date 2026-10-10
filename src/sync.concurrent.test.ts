import 'fake-indexeddb/auto'
import { IDBObjectStore } from 'fake-indexeddb'
import { afterEach, beforeEach, expect, it, vi } from 'vitest'
import { getChanges, pushOperation } from './api'
import { getFile, getOfflineBook, getPending, getRecord, getSyncCursor, saveFile, saveOfflineBook, savePending, saveRecord } from './store'
import { mutate, profileFor, resolveConflict, syncNow } from './sync'
import type { Session, SyncOperation } from './types'

vi.mock('./api', () => ({
  ApiError: class ApiError extends Error {},
  getUser: vi.fn(async () => ({ user: {} })),
  getChanges: vi.fn(),
  pushOperation: vi.fn(),
  uploadBlob: vi.fn(),
}))

beforeEach(() => {
  vi.mocked(getChanges).mockReset().mockResolvedValue({ changes: [], cursor: 0, hasMore: false })
  vi.mocked(pushOperation).mockReset().mockImplementation(async (_token, op) => ({
    receipts: [{ opId: op.opId, status: 'APPLIED', current: { version: op.baseVersion + 1, deleted: Number(op.deleted), payload: op.payload } }],
  }))
})
afterEach(() => vi.restoreAllMocks())

function context() {
  const session: Session = { token: 'local-test', expiresAt: Date.now() / 1000 + 600, user: { id: crypto.randomUUID(), email: 'race@example.test', emailVerified: true } }
  const profile = profileFor(session)
  const id = crypto.randomUUID()
  return { session, profile, id, key: `${profile}:highlights:${id}` }
}

it('rolls back the local edit if its pending operation cannot be persisted', async () => {
  const { profile, id, key } = context()
  await mutate(profile, 'highlights', id, { note: 'saved before' })
  const before = await getPending(profile)
  const original = IDBObjectStore.prototype.put
  vi.spyOn(IDBObjectStore.prototype, 'put').mockImplementation(function (this: globalThis.IDBObjectStore, value, suppliedKey) {
    if (this.name === 'pending') throw new DOMException('Storage is full', 'QuotaExceededError')
    return original.call(this, value, suppliedKey)
  })
  await expect(mutate(profile, 'highlights', id, { note: 'unsaved edit' })).rejects.toThrow('Storage is full')
  expect((await getRecord(key))?.payload.note).toBe('saved before')
  expect(await getPending(profile)).toEqual(before)
})

it('keeps a note edited while a conflict resolution is waiting for its receipt', async () => {
  const { session, profile, id, key } = context()
  const operation: SyncOperation = { kind: 'highlights', id, opId: crypto.randomUUID(), baseVersion: 1, deleted: false, payload: { note: 'chosen local' } }
  await saveRecord({ key, profile, kind: 'highlights', id, version: 1, deleted: false, payload: operation.payload })
  await savePending({ key, profile, operation, attempted: true, conflicted: true })
  vi.mocked(getChanges).mockResolvedValue({ changes: [{ seq: 1, kind: 'highlights', id, version: 2, deleted: 0, payload: { note: 'cloud' } }], cursor: 1, hasMore: false })
  vi.mocked(pushOperation).mockImplementationOnce(async (_token, op) => {
    await mutate(profile, 'highlights', id, { note: 'typed while saving' })
    return { receipts: [{ opId: op.opId, status: 'APPLIED', current: { version: 3, deleted: 0, payload: op.payload } }] }
  })
  await resolveConflict(session, key, 'keep_local')
  expect((await getRecord(key))?.payload.note).toBe('typed while saving')
  expect((await getPending(profile))[0]).toMatchObject({ attempted: false, operation: { baseVersion: 3, payload: { note: 'typed while saving' } } })
  await syncNow(session)
  expect(await getPending(profile)).toEqual([])
  expect((await getRecord(key))?.payload.note).toBe('typed while saving')
})

it('does not let a concurrent cloud pull replace a new local note', async () => {
  const { session, profile, id, key } = context()
  await saveRecord({ key, profile, kind: 'highlights', id, version: 1, deleted: false, payload: { note: 'old' } })
  let release!: (value: Awaited<ReturnType<typeof getChanges>>) => void
  let pulling!: () => void
  const started = new Promise<void>(resolve => { pulling = resolve })
  vi.mocked(getChanges).mockImplementationOnce(() => { pulling(); return new Promise(resolve => { release = resolve }) })
  const syncing = syncNow(session)
  await started
  const editing = mutate(profile, 'highlights', id, { note: 'new local' })
  release({ changes: [{ seq: 1, kind: 'highlights', id, version: 2, deleted: 0, payload: { note: 'remote' } }], cursor: 1, hasMore: false })
  await Promise.all([editing, syncing])
  expect((await getRecord(key))?.payload.note).toBe('new local')
  expect((await getPending(profile))[0].operation.payload.note).toBe('new local')
})

it('ignores a delayed cloud version older than the acknowledged local version', async () => {
  const { session, profile, id, key } = context()
  await saveRecord({ key, profile, kind: 'highlights', id, version: 4, deleted: false, payload: { note: 'acknowledged' } })
  vi.mocked(getChanges).mockResolvedValueOnce({ changes: [{ seq: 1, kind: 'highlights', id, version: 2, deleted: 0, payload: { note: 'stale' } }], cursor: 1, hasMore: false })
  await syncNow(session)
  expect(await getRecord(key)).toMatchObject({ version: 4, payload: { note: 'acknowledged' } })
})

it('explicitly recreates a favorite that the user previously removed and synced', async () => {
  const { profile, id } = context()
  await saveRecord({ key: `${profile}:favorites:${id}`, profile, kind: 'favorites', id, version: 2, deleted: true, payload: { book_id: 'book' } })
  await mutate(profile, 'favorites', id, { book_id: 'book' })
  expect((await getPending(profile))[0].operation).toMatchObject({ baseVersion: 2, deleted: false, recreate: true })
})

it('keeps an edit made in another tab while the user is fetching the remote conflict choice', async () => {
  const { session, profile, id, key } = context()
  await mutate(profile, 'highlights', id, { note: 'before choosing cloud' })
  const [item] = await getPending(profile)
  await savePending({ ...item, attempted: true, conflicted: true })
  vi.mocked(getChanges).mockImplementationOnce(async () => {
    await mutate(profile, 'highlights', id, { note: 'edited in other tab' })
    return { changes: [{ seq: 1, kind: 'highlights', id, version: 2, deleted: 0, payload: { note: 'remote' } }], cursor: 1, hasMore: false }
  })
  await expect(resolveConflict(session, key, 'take_remote')).rejects.toThrow('vừa thay đổi')
  expect((await getRecord(key))?.payload.note).toBe('edited in other tab')
  expect(await getPending(profile)).toHaveLength(1)
})

it('never regresses the cursor when a second tab receives an older pull', async () => {
  const { session, profile } = context()
  vi.mocked(getChanges).mockResolvedValueOnce({ changes: [], cursor: 20, hasMore: false })
  await syncNow(session)
  vi.mocked(getChanges).mockResolvedValueOnce({ changes: [], cursor: 10, hasMore: false })
  await syncNow(session)
  expect(await getSyncCursor(profile)).toBe(20)
})

it('does not delete a newer queued edit when a duplicate receipt arrives from another tab', async () => {
  const { session, profile, id, key } = context()
  await mutate(profile, 'highlights', id, { note: 'original' })
  let finishFirst!: () => void
  let finishSecond!: () => void
  const requests: SyncOperation[] = []
  vi.mocked(pushOperation).mockImplementation((_token, op) => {
    requests.push(op)
    return new Promise(resolve => {
      const finish = () => resolve({ receipts: [{ opId: op.opId, status: 'APPLIED', current: { version: 1, deleted: 0, payload: op.payload } }] })
      if (requests.length === 1) finishFirst = finish
      else finishSecond = finish
    })
  })
  const first = syncNow(session)
  await vi.waitFor(() => expect(requests).toHaveLength(1))
  const second = syncNow(session)
  await vi.waitFor(() => expect(requests).toHaveLength(2))
  expect(requests[0].opId).toBe(requests[1].opId)
  await mutate(profile, 'highlights', id, { note: 'latest' })
  finishFirst()
  await first
  const queued = await getPending(profile)
  finishSecond()
  await second
  expect((await getRecord(key))?.payload.note).toBe('latest')
  expect(await getPending(profile)).toEqual(queued)
  expect(queued[0].operation.opId).not.toBe(requests[0].opId)
})

it.each([true, false])('invalidates browser bytes when a remote catalog entry is deleted or replaced: %s', async deleted => {
  const { session, profile, id } = context()
  const key = `${profile}:catalog_books:${id}`
  const oldUrl = `nocap-private:${'a'.repeat(64)}`
  const book = { id, title: 'Old document', author: '', source: 'cloud', format: 'TXT', fileUrl: oldUrl }
  await saveRecord({ key, profile, kind: 'catalog_books', id, version: 1, deleted: false, payload: { id, title: book.title, file_url: oldUrl } })
  await saveFile({ key: `${profile}:${id}`, profile, book, data: new Blob(['old bytes']), addedAt: 1 })
  await saveOfflineBook(profile, id, new Blob(['old bytes']))
  vi.mocked(getChanges).mockResolvedValueOnce({ changes: [{ seq: 1, kind: 'catalog_books', id, version: 2, deleted: Number(deleted), payload: deleted ? {} : { id, title: 'New document', file_url: `nocap-private:${'b'.repeat(64)}` } }], cursor: 1, hasMore: false })
  await syncNow(session)
  expect(await getFile(profile, id)).toBeUndefined()
  expect(await getOfflineBook(profile, id)).toBeUndefined()
})
