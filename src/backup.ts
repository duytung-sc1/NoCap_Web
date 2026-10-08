import { applyLibraryRestore, getCachedCatalog, getFiles, getOfflineBooks, getRecords, keyFor, type OfflineBook } from './store'
import { androidRecordId } from './sync'
import { SYNC_KINDS, type SyncRecord, type Book, type LocalFile } from './types'

type BackupFile = { book: Book; dataBase64: string; mimeType: string; addedAt: number }
export type LibraryBackupData = {
  version: 1 | 2
  app: 'NoCap-Web'
  exportedAt: string
  profile: string
  records: SyncRecord[]
  books: Book[]
  files?: BackupFile[]
  offlineBooks?: BackupFile[]
}

const MAX_FILE_BYTES = 250 * 1024 * 1024
const invalid = () => new Error('Tệp sao lưu không đúng định dạng NoCap Web.')
const object = (value: unknown): value is Record<string, unknown> => !!value && typeof value === 'object' && !Array.isArray(value)
const isBook = (value: unknown): value is Book => object(value) && typeof value.id === 'string' && !!value.id && value.id.length <= 200 && typeof value.title === 'string' && typeof value.author === 'string'
  && ['description', 'coverUrl', 'categoryId', 'fileUrl', 'language', 'format', 'source'].every(key => value[key] === undefined || typeof value[key] === 'string')

async function encodeFile(book: Book, data: Blob, addedAt: number): Promise<BackupFile> {
  const bytes = new Uint8Array(await data.arrayBuffer())
  const chunks: string[] = []
  for (let offset = 0; offset < bytes.length; offset += 32768) chunks.push(String.fromCharCode(...bytes.subarray(offset, offset + 32768)))
  return { book, dataBase64: btoa(chunks.join('')), mimeType: data.type, addedAt }
}

function decodeFile(value: unknown): { book: Book; data: Blob; addedAt: number } {
  if (!object(value) || !isBook(value.book) || typeof value.dataBase64 !== 'string' || typeof value.mimeType !== 'string' || typeof value.addedAt !== 'number' || !Number.isFinite(value.addedAt)) throw invalid()
  const base64 = value.dataBase64
  if (!base64 || base64.length % 4 || base64.length > Math.ceil(MAX_FILE_BYTES / 3) * 4 || !/^[A-Za-z0-9+/]*={0,2}$/.test(base64)) throw invalid()
  const binary = atob(base64)
  if (!binary.length || binary.length > MAX_FILE_BYTES) throw invalid()
  const bytes = Uint8Array.from(binary, c => c.charCodeAt(0))
  return { book: { ...value.book }, data: new Blob([bytes], { type: value.mimeType }), addedAt: value.addedAt }
}

export async function createLibraryBackup(profile: string): Promise<LibraryBackupData> {
  const [records, localFiles, offline, publicOffline, catalog] = await Promise.all([
    getRecords(profile), getFiles(profile), getOfflineBooks(profile), getOfflineBooks('PUBLIC_OFFLINE'), getCachedCatalog(),
  ])
  const cached = [...offline, ...publicOffline].filter(file => !localFiles.some(local => local.book.id === file.bookId))
  const cachedFiles = await Promise.all(cached.map(f => {
    const record = records.find(record => record.kind === 'catalog_books' && record.payload.id === f.bookId)
    const p = record?.payload
    const book: Book = catalog?.books.find(book => book.id === f.bookId) || {
      id: f.bookId, title: typeof p?.title === 'string' ? p.title : f.bookId,
      author: typeof p?.author === 'string' ? p.author : '',
      fileUrl: typeof p?.file_url === 'string' ? p.file_url : undefined,
      format: typeof p?.format === 'string' ? p.format : undefined,
      source: f.profile === 'PUBLIC_OFFLINE' ? 'public' : 'cloud',
    }
    return encodeFile(book, f.data, f.savedAt)
  }))
  const files = [...await Promise.all(localFiles.map(f => encodeFile(f.book, f.data, f.addedAt))), ...cachedFiles.filter(f => f.book.fileUrl?.startsWith('nocap-private:') || f.book.source === 'cloud')]
  const offlineBooks = cachedFiles.filter(f => !files.includes(f))
  return { version: 2, app: 'NoCap-Web', exportedAt: new Date().toISOString(), profile, records, books: files.map(f => f.book), files, offlineBooks }
}

export function downloadBackupFile(data: LibraryBackupData) {
  const blob = new Blob([JSON.stringify(data)], { type: 'application/json' })
  const url = URL.createObjectURL(blob)
  const link = document.createElement('a')
  link.href = url
  link.download = `nocap-library-backup-${new Date().toISOString().slice(0, 10)}.json`
  document.body.appendChild(link)
  link.click()
  document.body.removeChild(link)
  setTimeout(() => URL.revokeObjectURL(url), 1000)
}

export async function restoreLibraryBackup(profile: string, backupData: unknown): Promise<{ restoredRecords: number; restoredBooks: number; missingFiles: number }> {
  if (!object(backupData) || backupData.app !== 'NoCap-Web' || (backupData.version !== 1 && backupData.version !== 2) || !Array.isArray(backupData.records) || !Array.isArray(backupData.books)) throw invalid()
  if (backupData.version === 2 && (!Array.isArray(backupData.files) || !Array.isArray(backupData.offlineBooks))) throw invalid()
  const records: SyncRecord[] = backupData.records.map(value => {
    if (!object(value) || !(SYNC_KINDS as readonly unknown[]).includes(value.kind) || typeof value.id !== 'string' || !value.id || value.id.length > 200 || !object(value.payload) || typeof value.deleted !== 'boolean') throw invalid()
    return { key: keyFor(profile, `${value.kind}:${value.id}`), profile, kind: value.kind as SyncRecord['kind'], id: value.id, version: 0, deleted: value.deleted, payload: { ...value.payload } }
  })
  const books: Book[] = backupData.books.map(value => { if (!isBook(value)) throw invalid(); return { ...value } })
  // Decode and validate the complete archive before opening a write transaction.
  const decodedFiles = (backupData.version === 2 ? backupData.files as unknown[] : []).map(decodeFile)
  const decodedOffline = (backupData.version === 2 ? backupData.offlineBooks as unknown[] : []).map(decodeFile)
  if (new Set(decodedFiles.map(f => f.book.id)).size !== decodedFiles.length) throw invalid()
  if (decodedFiles.some(f => !books.some(book => book.id === f.book.id))) throw invalid()
  const account = profile.startsWith('ACCOUNT:')
  const files: LocalFile[] = await Promise.all(decodedFiles.map(async f => {
    const hash = Array.from(new Uint8Array(await crypto.subtle.digest('SHA-256', await f.data.arrayBuffer())), byte => byte.toString(16).padStart(2, '0')).join('')
    const book = { ...f.book, source: account ? 'cloud' : 'local', fileUrl: `nocap-private:${hash}`, fileSizeBytes: f.data.size }
    return { key: keyFor(profile, book.id), profile, book, data: f.data, addedAt: f.addedAt }
  }))
  const existingFiles = await getFiles(profile)
  const available = new Map([...existingFiles, ...files].map(f => [f.book.id, f]))
  const missing = new Set(books.filter(book => (!book.fileUrl || book.source === 'local' || book.source === 'cloud' || book.fileUrl?.startsWith('nocap-private:')) && !available.has(book.id)).map(book => book.id))
  const planned = new Map(records.map(record => [record.key, record]))
  for (const book of books) {
    const local = available.get(book.id)
    const matching = records.find(record => record.kind === 'catalog_books' && record.payload.id === book.id)
    if (!local && matching) continue
    const restoredBook = local?.book || book
    const id = androidRecordId('catalog_books', book.id)
    const key = keyFor(profile, `catalog_books:${id}`)
    const payload = {
      ...matching?.payload, id: book.id, title: restoredBook.title, author: restoredBook.author,
      description: restoredBook.description || '', cover_url: restoredBook.coverUrl || '',
      category_id: restoredBook.categoryId || 'imported', file_url: restoredBook.fileUrl || '',
      file_size_bytes: local?.data.size || restoredBook.fileSizeBytes || 0,
      format: restoredBook.format || 'EPUB', source_type: local ? 'LOCAL_FILE' : matching?.payload.source_type,
      content_hash: restoredBook.fileUrl?.startsWith('nocap-private:') ? restoredBook.fileUrl.slice('nocap-private:'.length) : null,
      content_version: 1, added_at: local?.addedAt || Date.now(), updated_at: Date.now(),
      reading_status: matching?.payload.reading_status || 'UNREAD',
    }
    if (matching) planned.delete(matching.key)
    planned.set(key, { key, profile, kind: 'catalog_books', id, version: 0, deleted: false, payload })
  }
  const offlineBooks: OfflineBook[] = decodedOffline.map(f => {
    const target = f.book.fileUrl?.startsWith('nocap-private:') || f.book.source === 'cloud' ? profile : 'PUBLIC_OFFLINE'
    return { key: keyFor(target, f.book.id), profile: target, bookId: f.book.id, data: f.data, savedAt: f.addedAt }
  })
  await applyLibraryRestore(profile, [...planned.values()].map(record => ({
    record, sync: account && !missing.has(String(record.payload.book_id || record.payload.id || '')),
  })), files, offlineBooks)
  return { restoredRecords: records.length, restoredBooks: files.length, missingFiles: missing.size }
}
