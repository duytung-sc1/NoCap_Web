import { getRecords, getFiles, saveRecord } from './store'
import type { SyncRecord, Book } from './types'

export type LibraryBackupData = {
  version: 1
  app: 'NoCap-Web'
  exportedAt: string
  profile: string
  records: SyncRecord[]
  books: Book[]
}

export async function createLibraryBackup(profile: string): Promise<LibraryBackupData> {
  const [records, localFiles] = await Promise.all([
    getRecords(profile),
    getFiles(profile),
  ])
  return {
    version: 1,
    app: 'NoCap-Web',
    exportedAt: new Date().toISOString(),
    profile,
    records,
    books: localFiles.map(f => f.book),
  }
}

export function downloadBackupFile(data: LibraryBackupData) {
  const jsonStr = JSON.stringify(data, null, 2)
  const blob = new Blob([jsonStr], { type: 'application/json' })
  const url = URL.createObjectURL(blob)
  const dateStr = new Date().toISOString().slice(0, 10)
  const link = document.createElement('a')
  link.href = url
  link.download = `nocap-library-backup-${dateStr}.json`
  document.body.appendChild(link)
  link.click()
  document.body.removeChild(link)
  setTimeout(() => URL.revokeObjectURL(url), 1000)
}

export async function restoreLibraryBackup(
  profile: string,
  backupData: unknown
): Promise<{ restoredRecords: number; restoredBooks: number }> {
  if (
    !backupData ||
    typeof backupData !== 'object' ||
    (backupData as { app?: string }).app !== 'NoCap-Web' ||
    !Array.isArray((backupData as { records?: unknown[] }).records)
  ) {
    throw new Error('Tệp sao lưu không đúng định dạng NoCap Web.')
  }

  const valid = backupData as LibraryBackupData
  let restoredRecords = 0
  for (const record of valid.records) {
    if (record && record.kind && record.id) {
      await saveRecord({
        ...record,
        profile,
        key: `${profile}:${record.kind}:${record.id}`,
      })
      restoredRecords++
    }
  }

  let restoredBooks = 0
  if (Array.isArray(valid.books)) {
    for (const b of valid.books) {
      if (b && b.id) {
        await saveRecord({
          key: `${profile}:catalog_books:${b.id}`,
          profile,
          kind: 'catalog_books',
          id: b.id,
          version: 1,
          deleted: false,
          payload: {
            id: b.id,
            title: b.title,
            author: b.author,
            description: b.description || '',
            file_url: b.fileUrl || '',
            format: b.format || 'EPUB',
            source: b.source || 'local',
          },
        })
        restoredBooks++
      }
    }
  }

  return { restoredRecords, restoredBooks }
}
