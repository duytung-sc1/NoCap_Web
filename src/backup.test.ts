import { beforeEach, describe, expect, it } from 'vitest'
import 'fake-indexeddb/auto'
import { createLibraryBackup, restoreLibraryBackup } from './backup'
import { saveFile, saveRecord, getRecords, getFile, getPending, saveOfflineBook, getOfflineBook } from './store'
import type { Book, SyncRecord } from './types'

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
})
