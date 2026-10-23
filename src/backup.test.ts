import { beforeEach, describe, expect, it } from 'vitest'
import 'fake-indexeddb/auto'
import { createLibraryBackup, restoreLibraryBackup } from './backup'
import { folderPath, getLibraryFolderState } from './libraryFolders'
import { saveFile, saveRecord, getRecords, getFile, getPending, saveOfflineBook, getOfflineBook } from './store'
import { androidRecordId } from './sync'
import type { Book, SyncRecord } from './types'

async function folderBackupFixture() {
  const profile = `ACCOUNT:${crypto.randomUUID()}`, parentId = crypto.randomUUID(), childId = crypto.randomUUID(), grandchildId = crypto.randomUUID(), existingId = crypto.randomUUID()
  const bookId = `nested-book-${crypto.randomUUID()}`, rootBookId = `root-book-${crypto.randomUUID()}`
  const folders: SyncRecord[] = [[parentId, 'Parent', null], [childId, 'Child', parentId], [grandchildId, 'Grandchild', childId], [existingId, 'Existing', null]].map(([id, name, parent]) => ({
    key: `${profile}:library_folders:${id}`, profile, kind: 'library_folders', id: id!, version: 3, deleted: false,
    payload: { id, name, parent_id: parent, created_at: 1, updated_at: 2 },
  }))
  const locations: SyncRecord[] = [[bookId, childId], [rootBookId, null]].map(([book, folder]) => {
    const id = androidRecordId('book_folder_locations', book!)
    return { key: `${profile}:book_folder_locations:${id}`, profile, kind: 'book_folder_locations', id, version: 3, deleted: false,
      payload: { id, book_id: book, folder_id: folder, updated_at: 2 } }
  })
  const sourceData: SyncRecord[] = [
    { key: `${profile}:highlights:source-note`, profile, kind: 'highlights', id: 'source-note', version: 5, deleted: false,
      payload: { id: 'source-note', book_id: bookId, text: 'Original quotation', note: 'Original thought' } },
    { key: `${profile}:reading_progress:source-progress`, profile, kind: 'reading_progress', id: 'source-progress', version: 6, deleted: false,
      payload: { book_id: bookId, progression: 0.6, locator_json: 'original-resume-position' } },
  ]
  for (const record of [...folders, ...locations, ...sourceData]) await saveRecord(record)
  for (const id of [bookId, rootBookId]) await saveFile({ key: `${profile}:${id}`, profile, book: { id, title: id, author: 'Author', source: 'cloud' }, data: new Blob([`Bytes for ${id}`], { type: 'text/plain' }), addedAt: 1 })
  return { profile, parentId, childId, grandchildId, existingId, bookId, rootBookId, folders, locations, sourceData, backup: await createLibraryBackup(profile) }
}

describe('createLibraryBackup & restoreLibraryBackup', () => {
  const profile = 'TEST_BACKUP_PROFILE'

  beforeEach(async () => {
    // populate some data
    const rec: SyncRecord = {
      key: `${profile}:bookmarks:b1`,
      profile,
      kind: 'bookmarks',
      id: 'b1',
      version: 1,
      deleted: false,
      payload: { book_id: 'bk-1', note: 'test' },
    }
    await saveRecord(rec)

    const bk: Book = { id: 'bk-1', title: 'Test Book', author: 'Author' }
    await saveFile({
      key: `${profile}:bk-1`,
      profile,
      book: bk,
      data: new Blob(['content']),
      addedAt: Date.now(),
    })
  })

  it('exports valid backup structure', async () => {
    const backup = await createLibraryBackup(profile)
    expect(backup.app).toBe('NoCap-Web')
    expect(backup.version).toBe(2)
    expect(backup.records.length).toBeGreaterThan(0)
    expect(backup.books.length).toBeGreaterThan(0)
  })

  it('restores backup into target profile', async () => {
    const backup = await createLibraryBackup(profile)
    const targetProfile = 'RESTORED_TARGET'

    const res = await restoreLibraryBackup(targetProfile, backup)
    expect(res.restoredRecords).toBeGreaterThan(0)

    const restored = await getRecords(targetProfile)
    expect(restored.some(r => r.id === 'b1')).toBe(true)
  })

  it('rejects invalid backup format', async () => {
    await expect(restoreLibraryBackup('P', { app: 'OtherApp' })).rejects.toThrow('Tệp sao lưu không đúng định dạng')
  })

  it('preserves document bytes, MIME type and metadata across a serialized restore', async () => {
    const target = `RESTORED_BYTES:${crypto.randomUUID()}`
    const backup = JSON.parse(JSON.stringify(await createLibraryBackup(profile)))
    await restoreLibraryBackup(target, backup)
    const file = await getFile(target, 'bk-1')
    expect(await file?.data.text()).toBe('content')
    expect(file?.book.title).toBe('Test Book')
  })

  it('queues restored records using the target version, not the source version', async () => {
    const target = `ACCOUNT:${crypto.randomUUID()}`
    await saveRecord({ key: `${target}:bookmarks:b1`, profile: target, kind: 'bookmarks', id: 'b1', version: 8, deleted: false, payload: { note: 'target edit' } })
    const backup = await createLibraryBackup(profile)
    await restoreLibraryBackup(target, JSON.parse(JSON.stringify(backup)))
    const pending = (await getPending(target)).find(item => item.operation.id === 'b1')
    expect(pending?.operation.baseVersion).toBe(8)
    expect(pending?.operation.payload.note).toBe('test')
    expect((await getPending(target)).some(item => item.operation.kind === 'catalog_books')).toBe(true)
    expect((await getFile(target, 'bk-1'))?.book.source).toBe('cloud')
  })

  it('rejects a malformed later file without writing an earlier record or file', async () => {
    const target = `RESTORE_INVALID:${crypto.randomUUID()}`
    const backup = await createLibraryBackup(profile)
    backup.files!.push({ ...backup.files![0], book: { id: 'bad-file', title: 'Bad', author: '' }, dataBase64: 'invalid!' })
    await expect(restoreLibraryBackup(target, backup)).rejects.toThrow('không đúng định dạng')
    expect(await getRecords(target)).toHaveLength(0)
    expect(await getFile(target, 'bk-1')).toBeUndefined()
  })

  it('recreates only a tombstone already observed in the target account', async () => {
    const target = `ACCOUNT:${crypto.randomUUID()}`
    await saveRecord({ key: `${target}:bookmarks:b1`, profile: target, kind: 'bookmarks', id: 'b1', version: 4, deleted: true, payload: {} })
    await restoreLibraryBackup(target, await createLibraryBackup(profile))
    const pending = await getPending(target)
    expect(pending.find(item => item.operation.id === 'b1')?.operation).toMatchObject({ baseVersion: 4, deleted: false, recreate: true })
    expect(pending.find(item => item.operation.kind === 'catalog_books')?.operation.recreate).toBeUndefined()
  })

  it('accepts legacy metadata backups and reports missing original documents', async () => {
    const target = `LEGACY_RESTORE:${crypto.randomUUID()}`
    const backup = { version: 1, app: 'NoCap-Web', records: [], books: [{ id: 'legacy', title: 'Legacy', author: '', source: 'local' }] }
    const result = await restoreLibraryBackup(target, backup)
    expect(result.missingFiles).toBe(1)
    expect(result.restoredBooks).toBe(0)
  })

  it('restores cached public document bytes for offline reading', async () => {
    await saveOfflineBook('PUBLIC_OFFLINE', 'public-audit-book', new Blob(['offline book']))
    const backup = await createLibraryBackup(profile)
    await restoreLibraryBackup(`OFFLINE_RESTORE:${crypto.randomUUID()}`, JSON.parse(JSON.stringify(backup)))
    expect(await (await getOfflineBook('PUBLIC_OFFLINE', 'public-audit-book'))?.data.text()).toBe('offline book')
  })

  it('exports and restores nested library folders and explicit root locations without changing document identities', async () => {
    const fixture = await folderBackupFixture(), target = `ACCOUNT:${crypto.randomUUID()}`
    const serialized = JSON.parse(JSON.stringify(fixture.backup))
    expect(serialized.records.filter((record: SyncRecord) => record.kind === 'library_folders')).toHaveLength(4)
    await restoreLibraryBackup(target, serialized)
    const records = await getRecords(target), state = getLibraryFolderState(records, target)
    expect(folderPath(state, fixture.grandchildId).map(folder => folder.id)).toEqual([fixture.parentId, fixture.childId, fixture.grandchildId])
    expect(state.bookFolders.get(fixture.bookId)).toBe(fixture.childId)
    expect(state.bookFolders.get(fixture.rootBookId)).toBeNull()
    for (const location of fixture.locations) expect(records.find(record => record.kind === location.kind && record.id === location.id)?.payload).toEqual(location.payload)
    for (const original of fixture.sourceData) expect(records.find(record => record.kind === original.kind && record.id === original.id)?.payload).toEqual(original.payload)
    expect(await (await getFile(target, fixture.bookId))?.data.text()).toBe(`Bytes for ${fixture.bookId}`)
    expect((await getFile(target, fixture.bookId))?.book.id).toBe(fixture.bookId)
  })

  it('restores observed deleted folders under fresh IDs, rewrites hierarchy references and retains original tombstones', async () => {
    const fixture = await folderBackupFixture(), archived = JSON.stringify(fixture.backup)
    const tombstones = fixture.folders.filter(record => record.id === fixture.parentId || record.id === fixture.childId).map(record => ({ ...record, version: 9, deleted: true, payload: { ...record.payload, updated_at: 99 } }))
    for (const tombstone of tombstones) await saveRecord(tombstone)
    await saveRecord({ ...fixture.locations[0], version: 7, deleted: true })
    await restoreLibraryBackup(fixture.profile, JSON.parse(archived))
    const records = await getRecords(fixture.profile), state = getLibraryFolderState(records, fixture.profile)
    const restoredParent = state.folders.find(folder => folder.name === 'Parent')!, restoredChild = state.folders.find(folder => folder.name === 'Child')!
    expect(restoredParent.id).not.toBe(fixture.parentId)
    expect(restoredChild.id).not.toBe(fixture.childId)
    expect(restoredChild.parentId).toBe(restoredParent.id)
    expect(state.folderById.get(fixture.grandchildId)?.parentId).toBe(restoredChild.id)
    expect(state.folderById.get(fixture.existingId)?.name).toBe('Existing')
    expect(state.bookFolders.get(fixture.bookId)).toBe(restoredChild.id)
    expect(state.bookFolders.get(fixture.rootBookId)).toBeNull()
    for (const tombstone of tombstones) expect(records.find(record => record.key === tombstone.key)).toEqual(tombstone)
    for (const original of fixture.sourceData) expect(records.find(record => record.key === original.key)).toEqual(original)
    expect(await (await getFile(fixture.profile, fixture.bookId))?.data.text()).toBe(`Bytes for ${fixture.bookId}`)
    const pending = await getPending(fixture.profile), folderOperations = pending.filter(item => item.operation.kind === 'library_folders')
    expect(folderOperations.map(item => item.operation.id).sort()).toEqual([restoredParent.id, restoredChild.id, fixture.grandchildId, fixture.existingId].sort())
    expect(folderOperations.every(item => item.operation.recreate === undefined)).toBe(true)
    expect(pending.find(item => item.operation.id === fixture.locations[0].id)?.operation).toMatchObject({ baseVersion: 7, recreate: true,
      payload: { id: fixture.locations[0].id, book_id: fixture.bookId, folder_id: restoredChild.id } })
    expect(JSON.stringify(fixture.backup)).toBe(archived)
  })

  it('does not remap or write folder records when a later archive file is malformed', async () => {
    const fixture = await folderBackupFixture(), target = `ACCOUNT:${crypto.randomUUID()}`
    const existing = { ...fixture.folders[0], key: `${target}:library_folders:${fixture.parentId}`, profile: target, version: 8, deleted: true }
    await saveRecord(existing)
    const recordsBefore = await getRecords(target)
    fixture.backup.files!.push({ ...fixture.backup.files![0], book: { id: 'bad-later-file', title: 'Bad', author: '' }, dataBase64: 'invalid!' })
    await expect(restoreLibraryBackup(target, fixture.backup)).rejects.toThrow('không đúng định dạng')
    expect(await getRecords(target)).toEqual(recordsBefore)
    expect(await getPending(target)).toEqual([])
    expect(await getFile(target, fixture.bookId)).toBeUndefined()
  })
})
