import { openDB, type DBSchema } from 'idb'
import type { Book, Category, LocalFile, PendingOperation, SyncRecord } from './types'

export type OfflineBook = { key: string; profile: string; bookId: string; data: Blob; savedAt: number }
type CachedCatalog = { key: 'public-catalog'; books: Book[]; categories: Category[]; savedAt: number }

interface NoCapDB extends DBSchema {
  files: { key: string; value: LocalFile }
  records: { key: string; value: SyncRecord }
  pending: { key: string; value: PendingOperation }
  offlineBooks: { key: string; value: OfflineBook }
  metadata: { key: string; value: CachedCatalog }
}

let connection: ReturnType<typeof openDB<NoCapDB>> | null = null
function db() {
  if (!connection) connection = openDB<NoCapDB>('nocap-web-v1', 2, {
    upgrade(database, oldVersion) {
      if (oldVersion < 1) {
        database.createObjectStore('files', { keyPath: 'key' })
        database.createObjectStore('records', { keyPath: 'key' })
        database.createObjectStore('pending', { keyPath: 'key' })
      }
      if (oldVersion < 2) {
        database.createObjectStore('offlineBooks', { keyPath: 'key' })
        database.createObjectStore('metadata', { keyPath: 'key' })
      }
    },
  })
  return connection
}

const range = (profile: string) => IDBKeyRange.bound(`${profile}:`, `${profile}:\uffff`)
export const keyFor = (profile: string, id: string) => `${profile}:${id}`

export async function getFiles(profile: string) { return (await db()).getAll('files', range(profile)) }
export async function getFile(profile: string, id: string) { return (await db()).get('files', keyFor(profile, id)) }
export async function saveFile(value: LocalFile) { await (await db()).put('files', value) }
export async function getOfflineBooks(profile: string) { return (await db()).getAll('offlineBooks', range(profile)) }
export async function getOfflineBook(profile: string, bookId: string) { return (await db()).get('offlineBooks', keyFor(profile, bookId)) }
export async function saveOfflineBook(profile: string, bookId: string, data: Blob) {
  await (await db()).put('offlineBooks', { key: keyFor(profile, bookId), profile, bookId, data, savedAt: Date.now() })
}
export async function removeOfflineBook(profile: string, bookId: string) { await (await db()).delete('offlineBooks', keyFor(profile, bookId)) }
export async function getCachedCatalog() { return (await db()).get('metadata', 'public-catalog') }
export async function saveCachedCatalog(books: Book[], categories: Category[]) {
  await (await db()).put('metadata', { key: 'public-catalog', books, categories, savedAt: Date.now() })
}
export async function removeLocalDocument(profile: string, id: string) {
  const database = await db()
  const transaction = database.transaction(['files', 'records', 'pending'], 'readwrite')
  await transaction.objectStore('files').delete(keyFor(profile, id))
  for (const record of await transaction.objectStore('records').getAll(range(profile))) {
    if (record.payload.book_id === id || (record.kind === 'catalog_books' && record.payload.id === id)) await transaction.objectStore('records').delete(record.key)
  }
  for (const pending of await transaction.objectStore('pending').getAll(range(profile))) {
    if (pending.operation.payload.book_id === id || (pending.operation.kind === 'catalog_books' && pending.operation.payload.id === id)) await transaction.objectStore('pending').delete(pending.key)
  }
  await transaction.done
}
export async function getRecords(profile: string) { return (await db()).getAll('records', range(profile)) }
export async function saveRecord(value: SyncRecord) { await (await db()).put('records', value) }
export async function getPending(profile: string) { return (await db()).getAll('pending', range(profile)) }
export async function savePending(value: PendingOperation) { await (await db()).put('pending', value) }
export async function removePending(key: string) { await (await db()).delete('pending', key) }

export function readSession(): import('./types').Session | null {
  try {
    const value = JSON.parse(sessionStorage.getItem('nocap-session') || 'null')
    return value?.token && value.expiresAt > Date.now() / 1000 ? value : null
  } catch { return null }
}
export function saveSession(value: import('./types').Session | null) {
  if (value) sessionStorage.setItem('nocap-session', JSON.stringify(value))
  else sessionStorage.removeItem('nocap-session')
}
