import 'fake-indexeddb/auto'
import { afterEach, expect, it, vi } from 'vitest'
import { acknowledgeSyncOperation, applyRemoteChanges, claimPendingOperation, getCachedCatalog, getFile, getOfflineBook, getPending, getPendingItem, getRecord, getRecords, keyFor, prepareLocalConflict, resetPublicLibraryBook, saveCachedCatalog, saveFile, saveLocalMutation, saveOfflineBook, saveRecord } from './store'
import type { SyncKind, SyncRecord } from './types'

afterEach(() => vi.restoreAllMocks())

function fixture() {
  const profile = `ACCOUNT:${crypto.randomUUID()}`, bookId = `catalog-${crypto.randomUUID()}`, id = crypto.randomUUID()
  return { profile, bookId, id, key: keyFor(profile, `reading_progress:${id}`) }
}
function record(profile: string, kind: SyncKind, id: string, bookId: string, payload: Record<string, unknown> = {}): SyncRecord {
  return { key: keyFor(profile, `${kind}:${id}`), profile, kind, id, version: 4, deleted: false, payload: { book_id: bookId, ...payload } }
}
const progressPayload = (bookId: string, progression: number, lastRead = Date.now()) => ({ book_id: bookId, progression, locator_json: `location-${progression}`, last_read_at: lastRead })

it('creates a durable reset marker for a cache-only public book and preserves shared bytes and catalog data', async () => {
  const { profile, bookId, id, key } = fixture()
  await saveOfflineBook('PUBLIC_OFFLINE', bookId, new Blob(['shared book']))
  await saveCachedCatalog([{ id: bookId, title: 'Public book', author: 'Author' }], [])

  await resetPublicLibraryBook(profile, bookId, id)

  expect(await getRecord(key)).toMatchObject({ deleted: true, payload: { book_id: bookId, last_read_at: expect.any(Number) } })
  expect(await getPending(profile)).toEqual([expect.objectContaining({ attempted: true, operation: expect.objectContaining({ kind: 'reading_progress', id, deleted: true, baseVersion: 0 }) })])
  expect(await (await getOfflineBook('PUBLIC_OFFLINE', bookId))?.data.text()).toBe('shared book')
  expect((await getCachedCatalog())?.books[0].id).toBe(bookId)
})

it('recognizes an empty canonical tombstone and clears a later favorite without resending progress deletion', async () => {
  const { profile, bookId, id, key } = fixture()
  const tombstone: SyncRecord = { key, profile, kind: 'reading_progress', id, version: 7, deleted: true, payload: {} }
  const favorite = record(profile, 'favorites', crypto.randomUUID(), bookId, { added_at: 100 })
  await saveRecord(tombstone)
  await saveRecord(favorite)
  await saveOfflineBook('PUBLIC_OFFLINE', bookId, new Blob(['shared bytes']))

  await resetPublicLibraryBook(profile, bookId, id)

  expect(await getRecord(key)).toEqual(tombstone)
  expect((await getRecord(favorite.key))?.deleted).toBe(true)
  expect(await getPending(profile)).toEqual([expect.objectContaining({ operation: expect.objectContaining({ kind: 'favorites', id: favorite.id, deleted: true }) })])
  expect(await (await getOfflineBook('PUBLIC_OFFLINE', bookId))?.data.text()).toBe('shared bytes')
})

it('removes every progress identity, favorite and folder location but preserves annotations, reviews, history, files and other accounts', async () => {
  const { profile, bookId, id, key } = fixture(), legacyId = crypto.randomUUID()
  const otherProfile = `ACCOUNT:${crypto.randomUUID()}`
  await saveRecord(record(profile, 'reading_progress', id, bookId, progressPayload(bookId, 1)))
  await saveRecord(record(profile, 'reading_progress', legacyId, bookId, progressPayload(bookId, .4)))
  const favorite = record(profile, 'favorites', crypto.randomUUID(), bookId, { added_at: 1 })
  const folder = record(profile, 'book_folder_locations', crypto.randomUUID(), bookId, { folder_id: crypto.randomUUID(), updated_at: 2 })
  const kept = (['highlights', 'bookmarks', 'review_items', 'reading_sessions', 'per_book_preferences', 'book_tag_cross_ref', 'book_collection_cross_ref', 'catalog_books'] as const)
    .map(kind => record(profile, kind, crypto.randomUUID(), bookId, { note: 'keep me' }))
  for (const value of [favorite, folder, ...kept]) await saveRecord(value)
  const other = record(otherProfile, 'reading_progress', id, bookId, progressPayload(bookId, .7))
  await saveRecord(other)
  await saveFile({ key: keyFor(profile, bookId), profile, book: { id: bookId, title: 'Cached public file', author: '', source: 'gutenberg' }, data: new Blob(['retained file']), addedAt: 1 })
  await saveOfflineBook(profile, bookId, new Blob(['retained profile cache']))

  await resetPublicLibraryBook(profile, bookId, id)

  for (const target of [key, keyFor(profile, `reading_progress:${legacyId}`), favorite.key, folder.key]) expect((await getRecord(target))?.deleted).toBe(true)
  for (const value of kept) expect(await getRecord(value.key)).toEqual(value)
  expect(await getRecord(other.key)).toEqual(other)
  expect(await (await getFile(profile, bookId))?.data.text()).toBe('retained file')
  expect(await (await getOfflineBook(profile, bookId))?.data.text()).toBe('retained profile cache')
  expect(await getPending(profile)).toHaveLength(4)
})

it('lets a completed book reopen before its reset receipt, without coalescing away the required deletion', async () => {
  const { profile, bookId, id, key } = fixture()
  await saveRecord(record(profile, 'reading_progress', id, bookId, progressPayload(bookId, 1, 100)))
  await resetPublicLibraryBook(profile, bookId, id)
  const deletion = (await getPendingItem(key))!
  await saveLocalMutation(profile, 'reading_progress', id, progressPayload(bookId, .02), false, false)

  expect((await getRecord(key))?.payload.progression).toBe(.02)
  expect((await getPendingItem(key))?.operation).toEqual(deletion.operation)
  await acknowledgeSyncOperation(deletion, { version: 5, deleted: 1, payload: deletion.operation.payload })
  const recreate = (await getPendingItem(key))!
  expect(recreate).toMatchObject({ attempted: false, operation: { baseVersion: 5, deleted: false, recreate: true, payload: { progression: .02 } } })
  await acknowledgeSyncOperation(recreate, { version: 6, deleted: 0, payload: recreate.operation.payload })
  expect(await getPending(profile)).toEqual([])
  expect(await getRecord(key)).toMatchObject({ version: 6, deleted: false, payload: { progression: .02 } })
})

it('retains the reset barrier when an older active-progress operation is already in flight and the book is reopened', async () => {
  const { profile, bookId, id, key } = fixture()
  await saveRecord(record(profile, 'reading_progress', id, bookId, progressPayload(bookId, 1, 100)))
  await saveLocalMutation(profile, 'reading_progress', id, progressPayload(bookId, 1, 200), false, false)
  const active = (await claimPendingOperation(key))!
  await resetPublicLibraryBook(profile, bookId, id)
  await saveLocalMutation(profile, 'reading_progress', id, progressPayload(bookId, .03), false, false)
  expect((await getPendingItem(key))?.resetAfterAcknowledgement?.payload.book_id).toBe(bookId)

  await acknowledgeSyncOperation(active, { version: 5, deleted: 0, payload: active.operation.payload })
  const deletion = (await getPendingItem(key))!
  expect(deletion).toMatchObject({ attempted: true, operation: { baseVersion: 5, deleted: true } })
  expect(deletion.operation.opId).not.toBe(active.operation.opId)
  expect((await getRecord(key))?.payload.progression).toBe(.03)
  await saveLocalMutation(profile, 'reading_progress', id, progressPayload(bookId, .08), false, false)
  await acknowledgeSyncOperation(deletion, { version: 6, deleted: 1, payload: deletion.operation.payload })
  expect(await getPendingItem(key)).toMatchObject({ operation: { baseVersion: 6, deleted: false, recreate: true, payload: { progression: .08 } } })
})

it('uses an already-observed remote tombstone as the reset barrier rather than sending an invalid second deletion', async () => {
  const { profile, bookId, id, key } = fixture()
  await saveLocalMutation(profile, 'reading_progress', id, progressPayload(bookId, 1), false, false)
  const active = (await claimPendingOperation(key))!
  await resetPublicLibraryBook(profile, bookId, id)
  await saveLocalMutation(profile, 'reading_progress', id, progressPayload(bookId, .1), false, false)

  await acknowledgeSyncOperation(active, { version: 9, deleted: 1, payload: { book_id: bookId } })

  expect(await getPendingItem(key)).toMatchObject({ operation: { deleted: false, recreate: true, baseVersion: 9, payload: { progression: .1 } } })
})

it('keeps a pending reset before a reread when resolving an active-progress conflict', async () => {
  const { profile, bookId, id, key } = fixture()
  await saveLocalMutation(profile, 'reading_progress', id, progressPayload(bookId, 1), false, false)
  const active = (await claimPendingOperation(key))!
  await resetPublicLibraryBook(profile, bookId, id)
  await saveLocalMutation(profile, 'reading_progress', id, progressPayload(bookId, .05), false, false)

  const retry = await prepareLocalConflict(active, { version: 11, deleted: 0, payload: progressPayload(bookId, 1) })

  expect(retry.operation).toMatchObject({ deleted: true, baseVersion: 11, payload: { book_id: bookId } })
  expect(retry.resetAfterAcknowledgement).toBeUndefined()
  expect((await getRecord(key))?.payload.progression).toBe(.05)
  await acknowledgeSyncOperation(retry, { version: 12, deleted: 1, payload: retry.operation.payload })
  expect(await getPendingItem(key)).toMatchObject({ operation: { recreate: true, deleted: false, baseVersion: 12, payload: { progression: .05 } } })
})

it('keeps repeated resets idempotent, including a second reset during an unacknowledged reread', async () => {
  const { profile, bookId, id, key } = fixture()
  await resetPublicLibraryBook(profile, bookId, id)
  const deletion = (await getPendingItem(key))!
  await resetPublicLibraryBook(profile, bookId, id)
  expect((await getPendingItem(key))?.operation).toEqual(deletion.operation)
  await saveLocalMutation(profile, 'reading_progress', id, progressPayload(bookId, .2), false, false)
  await resetPublicLibraryBook(profile, bookId, id)
  await acknowledgeSyncOperation(deletion, { version: 1, deleted: 1, payload: deletion.operation.payload })
  expect(await getPending(profile)).toEqual([])
  expect((await getRecord(key))?.deleted).toBe(true)
})

it('cancels an unsubmitted reread after the reset is acknowledged instead of deleting a remote tombstone again', async () => {
  const { profile, bookId, id, key } = fixture()
  await resetPublicLibraryBook(profile, bookId, id)
  const deletion = (await getPendingItem(key))!
  await saveLocalMutation(profile, 'reading_progress', id, progressPayload(bookId, .1), false, false)
  await acknowledgeSyncOperation(deletion, { version: 5, deleted: 1, payload: deletion.operation.payload })
  expect(await getPendingItem(key)).toMatchObject({ attempted: false, remoteDeleted: true, operation: { recreate: true, baseVersion: 5 } })
  // Ordinary progress updates must retain knowledge of the observed tombstone.
  await saveLocalMutation(profile, 'reading_progress', id, progressPayload(bookId, .15), false, false)

  await resetPublicLibraryBook(profile, bookId, id)

  expect(await getPendingItem(key)).toBeUndefined()
  expect(await getRecord(key)).toMatchObject({ version: 5, deleted: true })
})

it('does not mistake a recreate based only on an unsynced local deletion for an observed remote tombstone', async () => {
  const { profile, bookId, id, key } = fixture()
  await saveRecord(record(profile, 'reading_progress', id, bookId, progressPayload(bookId, 1)))
  // A preexisting generic mutation can have coalesced a local delete and read.
  await saveLocalMutation(profile, 'reading_progress', id, { book_id: bookId }, true, false)
  await saveLocalMutation(profile, 'reading_progress', id, progressPayload(bookId, .1), false, false)
  expect(await getPendingItem(key)).toMatchObject({ attempted: false, operation: { recreate: true }, remoteDeleted: undefined })

  await resetPublicLibraryBook(profile, bookId, id)

  expect(await getPendingItem(key)).toMatchObject({ attempted: true, operation: { deleted: true } })
})

it('serializes another reset when the post-reset reread has already been submitted', async () => {
  const { profile, bookId, id, key } = fixture()
  await resetPublicLibraryBook(profile, bookId, id)
  const deletion = (await getPendingItem(key))!
  await saveLocalMutation(profile, 'reading_progress', id, progressPayload(bookId, .1), false, false)
  await acknowledgeSyncOperation(deletion, { version: 5, deleted: 1, payload: deletion.operation.payload })
  const reread = (await claimPendingOperation(key))!
  await resetPublicLibraryBook(profile, bookId, id)

  expect((await getPendingItem(key))?.resetAfterAcknowledgement).toBeDefined()
  await acknowledgeSyncOperation(reread, { version: 6, deleted: 0, payload: reread.operation.payload })
  expect(await getPendingItem(key)).toMatchObject({ attempted: true, operation: { deleted: true, baseVersion: 6 } })
  expect((await getRecord(key))?.deleted).toBe(true)
})

it('does not allow pulled progress to resurrect a reset while its deletion is pending', async () => {
  const { profile, bookId, id, key } = fixture()
  await saveRecord(record(profile, 'reading_progress', id, bookId, progressPayload(bookId, .6)))
  await resetPublicLibraryBook(profile, bookId, id)
  await applyRemoteChanges(profile, [{ ...record(profile, 'reading_progress', id, bookId, progressPayload(bookId, .7)), version: 8 }], 8)
  expect((await getRecord(key))?.deleted).toBe(true)
})

it('resets a guest book locally without creating an account sync operation', async () => {
  const bookId = `guest-${crypto.randomUUID()}`, id = crypto.randomUUID()
  await saveRecord(record('DEVICE_LOCAL', 'reading_progress', id, bookId, progressPayload(bookId, 1)))
  await resetPublicLibraryBook('DEVICE_LOCAL', bookId, id)
  expect((await getRecord(keyFor('DEVICE_LOCAL', `reading_progress:${id}`)))?.deleted).toBe(true)
  expect((await getPending('DEVICE_LOCAL')).some(item => item.operation.payload.book_id === bookId)).toBe(false)
})

it('rolls back shelf mutations together when a later write fails', async () => {
  const { profile, bookId, id, key } = fixture()
  const original = record(profile, 'reading_progress', id, bookId, progressPayload(bookId, 1))
  const favorite = record(profile, 'favorites', crypto.randomUUID(), bookId)
  await saveRecord(original)
  await saveRecord(favorite)
  const realUuid = crypto.randomUUID.bind(crypto)
  vi.spyOn(crypto, 'randomUUID').mockImplementationOnce(realUuid).mockImplementationOnce(() => { throw new Error('simulated storage action failure') })

  await expect(resetPublicLibraryBook(profile, bookId, id)).rejects.toThrow('simulated storage action failure')

  expect(await getRecord(key)).toEqual(original)
  expect(await getRecord(favorite.key)).toEqual(favorite)
  expect(await getPending(profile)).toEqual([])
  expect((await getRecords(profile)).length).toBe(2)
})
