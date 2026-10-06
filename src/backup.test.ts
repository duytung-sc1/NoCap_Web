import { beforeEach, describe, expect, it } from 'vitest'
import 'fake-indexeddb/auto'
import { createLibraryBackup, restoreLibraryBackup } from './backup'
import { saveFile, saveRecord, getRecords } from './store'
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
    expect(backup.version).toBe(1)
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
})
