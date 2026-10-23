import 'fake-indexeddb/auto'
import { afterEach, describe, expect, it, vi } from 'vitest'
import { createLibraryFolder, deleteLibraryFolder, getLibraryFolderState, moveLibraryBooks, moveLibraryFolder, renameLibraryFolder } from './libraryFolders'
import { getFile, getPending, getRecords, saveFile, saveRecord } from './store'
import { androidRecordId } from './sync'
import type { SyncRecord } from './types'

afterEach(() => vi.restoreAllMocks())
const newProfile = () => `ACCOUNT:${crypto.randomUUID()}`
const stateFor = async (profile: string) => getLibraryFolderState(await getRecords(profile), profile)
const liveLocations = async (profile: string) => (await getRecords(profile)).filter(record => record.kind === 'book_folder_locations' && !record.deleted)
async function sourceRecord(profile: string, kind: SyncRecord['kind'], payload: Record<string, unknown>) {
  const id = crypto.randomUUID(), record: SyncRecord = { key: `${profile}:${kind}:${id}`, profile, kind, id, version: 4, deleted: false, payload }
  await saveRecord(record); return record
}

describe('transactional library folder organization', () => {
  it('creates, renames, and moves a folder between parents and the root with stable identity', async () => {
    const profile = newProfile(), first = await createLibraryFolder(profile, ' First '), second = await createLibraryFolder(profile, 'Second')
    const child = await createLibraryFolder(profile, 'Child', first)
    expect((await stateFor(profile)).folderById.get(first)?.name).toBe('First')
    expect((await stateFor(profile)).folderById.get(child)?.parentId).toBe(first)
    const before = (await stateFor(profile)).folderById.get(child)!
    await renameLibraryFolder(profile, child, ' Renamed ')
    await moveLibraryFolder(profile, child, second)
    expect((await stateFor(profile)).folderById.get(child)).toMatchObject({ id: child, name: 'Renamed', parentId: second, createdAt: before.createdAt })
    await moveLibraryFolder(profile, child, null)
    expect((await stateFor(profile)).folderById.get(child)?.parentId).toBeNull()
    expect((await getPending(profile)).every(item => item.operation.kind === 'library_folders')).toBe(true)
  })

  it('rejects self/descendant moves and validates simultaneous opposing moves against the latest graph', async () => {
    const profile = newProfile(), a = await createLibraryFolder(profile, 'A'), b = await createLibraryFolder(profile, 'B', a)
    const before = await getRecords(profile)
    await expect(moveLibraryFolder(profile, a, a)).rejects.toMatchObject({ code: 'CYCLE' })
    await expect(moveLibraryFolder(profile, a, b)).rejects.toMatchObject({ code: 'CYCLE' })
    expect(await getRecords(profile)).toEqual(before)
    await moveLibraryFolder(profile, b, null)
    const results = await Promise.allSettled([moveLibraryFolder(profile, a, b), moveLibraryFolder(profile, b, a)])
    expect(results.filter(result => result.status === 'fulfilled')).toHaveLength(1)
    expect(results.filter(result => result.status === 'rejected')).toHaveLength(1)
    const folders = (await stateFor(profile)).folders
    expect(folders.filter(folder => folder.parentId === null)).toHaveLength(1)
  })

  it('keeps folder edit timestamps valid when another device clock was ahead', async () => {
    const profile = newProfile(), parent = await createLibraryFolder(profile, 'Parent'), child = await createLibraryFolder(profile, 'Child', parent)
    const destination = await createLibraryFolder(profile, 'Destination'), future = Date.now() + 86400000
    for (const record of await getRecords(profile)) {
      if (record.id === parent) await saveRecord({ ...record, version: 4, payload: { ...record.payload, created_at: future, updated_at: future + 100 } })
      if (record.id === child) await saveRecord({ ...record, version: 5, payload: { ...record.payload, created_at: future + 200, updated_at: future + 300 } })
    }
    vi.spyOn(Date, 'now').mockReturnValue(future - 1000)
    await renameLibraryFolder(profile, parent, 'Renamed')
    expect((await stateFor(profile)).folderById.get(parent)).toMatchObject({ name: 'Renamed', createdAt: future, updatedAt: future + 100 })
    await moveLibraryFolder(profile, parent, destination)
    expect((await stateFor(profile)).folderById.get(parent)).toMatchObject({ parentId: destination, createdAt: future, updatedAt: future + 100 })
    await deleteLibraryFolder(profile, parent)
    const records = await getRecords(profile), deleted = records.find(record => record.id === parent)!
    expect(deleted).toMatchObject({ deleted: true, payload: { created_at: future, updated_at: future + 100 } })
    expect((await stateFor(profile)).folderById.get(child)).toMatchObject({ parentId: destination, createdAt: future + 200, updatedAt: future + 300 })
    const operations = (await getPending(profile)).filter(item => [parent, child].some(id => id === item.operation.id))
    expect(operations).toHaveLength(2)
    expect(operations.every(item => Number(item.operation.payload.updated_at) >= Number(item.operation.payload.created_at))).toBe(true)
  })

  it('moves documents through one deterministic location record and retains the CAS base version', async () => {
    const profile = newProfile(), a = await createLibraryFolder(profile, 'A'), b = await createLibraryFolder(profile, 'B')
    await moveLibraryBooks(profile, ['book', 'book'], a)
    const id = androidRecordId('book_folder_locations', 'book'), first = (await liveLocations(profile))[0]
    expect(first).toMatchObject({ id, payload: { id, book_id: 'book', folder_id: a } })
    await saveRecord({ ...first, version: 7 })
    await moveLibraryBooks(profile, ['book'], b)
    expect(await liveLocations(profile)).toHaveLength(1)
    expect((await stateFor(profile)).bookFolders.get('book')).toBe(b)
    expect((await getPending(profile)).find(item => item.operation.id === id)?.operation.baseVersion).toBe(7)
    await moveLibraryBooks(profile, ['book'], null)
    expect((await liveLocations(profile))[0].payload.folder_id).toBeNull()
  })

  it('reuses a tombstoned document location with an explicit CAS recreation', async () => {
    const profile = newProfile(), folder = await createLibraryFolder(profile, 'Folder')
    const bookId = 'restored-document', id = androidRecordId('book_folder_locations', bookId)
    await saveRecord({ key: `${profile}:book_folder_locations:${id}`, profile, kind: 'book_folder_locations', id, version: 9, deleted: true,
      payload: { id, book_id: bookId, folder_id: null, updated_at: 1 } })
    await moveLibraryBooks(profile, [bookId], folder)
    expect((await stateFor(profile)).bookFolders.get(bookId)).toBe(folder)
    expect((await getPending(profile)).find(item => item.operation.id === id)?.operation).toMatchObject({ id, baseVersion: 9, recreate: true, deleted: false })
    expect(await liveLocations(profile)).toHaveLength(1)
  })

  it('deletes only one folder and promotes its direct children and books while preserving source data', async () => {
    const profile = newProfile(), parent = await createLibraryFolder(profile, 'Parent'), deleted = await createLibraryFolder(profile, 'Delete', parent)
    const child = await createLibraryFolder(profile, 'Child', deleted), grandchild = await createLibraryFolder(profile, 'Grandchild', child)
    const bookId = `web-${crypto.randomUUID()}`
    const originals = await Promise.all([
      sourceRecord(profile, 'catalog_books', { id: bookId, title: 'Original', file_url: 'nocap-private:original' }),
      sourceRecord(profile, 'highlights', { id: 'note', book_id: bookId, text: 'Source quotation', note: 'Keep this thought' }),
      sourceRecord(profile, 'reading_progress', { book_id: bookId, progression: 0.5, locator_json: 'resume' }),
      sourceRecord(profile, 'collections', { id: 'collection', name: 'Independent collection' }),
      sourceRecord(profile, 'book_collection_cross_ref', { book_id: bookId, collection_id: 'collection' }),
    ])
    await saveFile({ key: `${profile}:${bookId}`, profile, book: { id: bookId, title: 'Original', author: '', source: 'local' }, data: new Blob(['original file']), addedAt: 1 })
    await moveLibraryBooks(profile, [bookId], deleted)
    await moveLibraryBooks(profile, ['descendant-book'], grandchild)
    await deleteLibraryFolder(profile, deleted)
    const records = await getRecords(profile), state = getLibraryFolderState(records)
    expect(state.folderById.has(deleted)).toBe(false)
    expect(state.folderById.get(child)?.parentId).toBe(parent)
    expect(state.folderById.get(grandchild)?.parentId).toBe(child)
    expect(state.bookFolders.get(bookId)).toBe(parent)
    expect(state.bookFolders.get('descendant-book')).toBe(grandchild)
    expect(records.find(record => record.kind === 'library_folders' && record.id === deleted)?.deleted).toBe(true)
    for (const original of originals) expect(records.find(record => record.key === original.key)).toEqual(original)
    expect(await (await getFile(profile, bookId))?.data.text()).toBe('original file')
    await deleteLibraryFolder(profile, parent)
    expect((await stateFor(profile)).folderById.get(child)?.parentId).toBeNull()
    expect((await stateFor(profile)).bookFolders.get(bookId)).toBeNull()
  })

  it('rejects a deleted destination and rolls back an invalid bulk action in full', async () => {
    const profile = newProfile(), destination = await createLibraryFolder(profile, 'Destination'), folder = await createLibraryFolder(profile, 'Still here')
    await deleteLibraryFolder(profile, destination)
    const before = await getRecords(profile), pendingBefore = await getPending(profile)
    await expect(moveLibraryBooks(profile, ['a', 'b'], destination)).rejects.toMatchObject({ code: 'FOLDER_MISSING' })
    await expect(moveLibraryFolder(profile, folder, destination)).rejects.toMatchObject({ code: 'FOLDER_MISSING' })
    await expect(createLibraryFolder(profile, 'Child', destination)).rejects.toMatchObject({ code: 'FOLDER_MISSING' })
    await expect(moveLibraryBooks(profile, ['valid', 'bad\u0000id'], folder)).rejects.toMatchObject({ code: 'INVALID_BOOK_ID' })
    expect(await getRecords(profile)).toEqual(before)
    expect(await getPending(profile)).toEqual(pendingBefore)
  })

  it('isolates account destinations and leaves DEVICE_LOCAL changes out of the outbox', async () => {
    const first = newProfile(), second = newProfile(), folder = await createLibraryFolder(first, 'Private')
    await moveLibraryBooks(first, ['shared-book-id'], folder)
    await expect(moveLibraryBooks(second, ['shared-book-id'], folder)).rejects.toMatchObject({ code: 'FOLDER_MISSING' })
    await expect(renameLibraryFolder(second, folder, 'Other account')).rejects.toMatchObject({ code: 'FOLDER_MISSING' })
    await expect(deleteLibraryFolder(second, folder)).rejects.toMatchObject({ code: 'FOLDER_MISSING' })
    expect(await getRecords(second)).toEqual([])
    expect((await stateFor(first)).bookFolders.get('shared-book-id')).toBe(folder)
    const local = await createLibraryFolder('DEVICE_LOCAL', `Local ${crypto.randomUUID()}`)
    await moveLibraryBooks('DEVICE_LOCAL', [`local-book-${local}`], local)
    expect((await getPending('DEVICE_LOCAL')).some(item => item.operation.id === local || item.operation.payload.folder_id === local)).toBe(false)
  })

  it('bounds names, folder IDs and bulk inputs before creating any records', async () => {
    const profile = newProfile()
    await expect(createLibraryFolder(profile, '   ')).rejects.toMatchObject({ code: 'INVALID_NAME' })
    await expect(createLibraryFolder(profile, 'x'.repeat(81))).rejects.toMatchObject({ code: 'INVALID_NAME' })
    await expect(createLibraryFolder(profile, 'line\nbreak')).rejects.toMatchObject({ code: 'INVALID_NAME' })
    await expect(createLibraryFolder(profile, 'Valid', 'bad-id')).rejects.toMatchObject({ code: 'INVALID_ID' })
    await expect(moveLibraryBooks(profile, ['x'.repeat(513)], null)).rejects.toMatchObject({ code: 'INVALID_BOOK_ID' })
    await expect(moveLibraryBooks(profile, Array.from({ length: 1001 }, (_, index) => `book-${index}`), null)).rejects.toMatchObject({ code: 'TOO_MANY' })
    expect(await getRecords(profile)).toEqual([])
  })
})
