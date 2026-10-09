import { openDB, type DBSchema, type IDBPDatabase } from 'idb'
import type { Book, Category, LocalFile, PendingOperation, Session, SyncRecord } from './types'

export type OfflineBook = { key: string; profile: string; bookId: string; data: Blob; savedAt: number }
type CachedCatalog = { key: 'public-catalog'; books: Book[]; categories: Category[]; savedAt: number }
type SyncCursor = { key: string; cursor: number }

interface NoCapDB extends DBSchema {
  files: { key: string; value: LocalFile }
  records: { key: string; value: SyncRecord }
  pending: { key: string; value: PendingOperation }
  offlineBooks: { key: string; value: OfflineBook }
  metadata: { key: string; value: CachedCatalog | SyncCursor }
}

let connection: Promise<IDBPDatabase<NoCapDB>> | null = null

function openConnection(): Promise<IDBPDatabase<NoCapDB>> {
  if (connection) return connection
  let opening: Promise<IDBPDatabase<NoCapDB>>
  opening = openDB<NoCapDB>('nocap-web-v1', 2, {
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
    blocking() {
      // Another tab or a newer app version needs to upgrade the database.
      // Release this handle so the next operation opens a fresh connection.
      void opening.then(database => database.close()).catch(() => {})
      if (connection === opening) connection = null
    },
    terminated() {
      // Safari/iOS may terminate IndexedDB connections when an in-app browser
      // is backgrounded. Never keep the resolved, closed handle cached.
      if (connection === opening) connection = null
    },
  })
  connection = opening
  void opening.catch(() => {
    if (connection === opening) connection = null
  })
  return opening
}

function isClosedConnectionError(error: unknown): boolean {
  if (!(error instanceof Error || (typeof DOMException !== 'undefined' && error instanceof DOMException))) return false
  const name = 'name' in error ? String(error.name) : ''
  const message = 'message' in error ? String(error.message) : String(error)
  return name === 'InvalidStateError' || /(?:database )?connection is clos(?:ed|ing)|database is clos(?:ed|ing)/i.test(message)
}

async function withDatabase<T>(operation: (database: IDBPDatabase<NoCapDB>) => Promise<T>): Promise<T> {
  const firstOpening = openConnection()
  const firstDatabase = await firstOpening
  try {
    return await operation(firstDatabase)
  } catch (error) {
    if (!isClosedConnectionError(error)) throw error
    if (connection === firstOpening) connection = null
    try { firstDatabase.close() } catch { /* already closed by the browser */ }
    return operation(await openConnection())
  }
}

const range = (profile: string) => IDBKeyRange.bound(`${profile}:`, `${profile}:\uffff`)
export const keyFor = (profile: string, id: string) => `${profile}:${id}`

export async function getFiles(profile: string) { return withDatabase(database => database.getAll('files', range(profile))) }
export async function getFile(profile: string, id: string) { return withDatabase(database => database.get('files', keyFor(profile, id))) }
export async function saveFile(value: LocalFile) { await withDatabase(database => database.put('files', value)) }
export async function removeFile(profile: string, id: string) { await withDatabase(database => database.delete('files', keyFor(profile, id))) }
export async function getOfflineBooks(profile: string) { return withDatabase(database => database.getAll('offlineBooks', range(profile))) }
export async function getOfflineBook(profile: string, bookId: string) { return withDatabase(database => database.get('offlineBooks', keyFor(profile, bookId))) }
export async function saveOfflineBook(profile: string, bookId: string, data: Blob) {
  await withDatabase(database => database.put('offlineBooks', { key: keyFor(profile, bookId), profile, bookId, data, savedAt: Date.now() }))
}
export async function removeOfflineBook(profile: string, bookId: string) { await withDatabase(database => database.delete('offlineBooks', keyFor(profile, bookId))) }
export async function getCachedCatalog(): Promise<CachedCatalog | undefined> {
  const value = await withDatabase(database => database.get('metadata', 'public-catalog'))
  return value && 'books' in value ? value : undefined
}
export async function saveCachedCatalog(books: Book[], categories: Category[]) {
  await withDatabase(database => database.put('metadata', { key: 'public-catalog', books, categories, savedAt: Date.now() }))
}
export async function getSyncCursor(profile: string): Promise<number> {
  const value = await withDatabase(database => database.get('metadata', `sync-cursor:${profile}`))
  const cursor = value && 'cursor' in value ? Number(value.cursor) : 0
  return Number.isSafeInteger(cursor) && cursor >= 0 ? cursor : 0
}
export async function saveSyncCursor(profile: string, cursor: number) {
  if (!Number.isSafeInteger(cursor) || cursor < 0) throw new Error('Invalid sync cursor')
  await withDatabase(database => database.put('metadata', { key: `sync-cursor:${profile}`, cursor }))
}
export async function removeLocalDocument(profile: string, id: string) {
  await withDatabase(async database => {
    const transaction = database.transaction(['files', 'records', 'pending'], 'readwrite')
    await transaction.objectStore('files').delete(keyFor(profile, id))
    for (const record of await transaction.objectStore('records').getAll(range(profile))) {
      if (record.payload.book_id === id || (record.kind === 'catalog_books' && record.payload.id === id)) await transaction.objectStore('records').delete(record.key)
    }
    for (const pending of await transaction.objectStore('pending').getAll(range(profile))) {
      if (pending.operation.payload.book_id === id || (pending.operation.kind === 'catalog_books' && pending.operation.payload.id === id)) await transaction.objectStore('pending').delete(pending.key)
    }
    await transaction.done
  })
}
export async function getRecords(profile: string) { return withDatabase(database => database.getAll('records', range(profile))) }
export async function getRecord(key: string) { return withDatabase(database => database.get('records', key)) }
export async function saveRecord(value: SyncRecord) { await withDatabase(database => database.put('records', value)) }
export async function getPending(profile: string) { return withDatabase(database => database.getAll('pending', range(profile))) }
export async function getPendingItem(key: string) { return withDatabase(database => database.get('pending', key)) }
export async function savePending(value: PendingOperation) { await withDatabase(database => database.put('pending', value)) }
export async function removePending(key: string) { await withDatabase(database => database.delete('pending', key)) }

/** Apply a validated backup atomically, using target-account versions rather
 * than versions copied from a different account's snapshot. */
export async function applyLibraryRestore(
  profile: string,
  records: Array<{ record: SyncRecord; sync: boolean }>,
  files: LocalFile[],
  offlineBooks: OfflineBook[],
) {
  await withDatabase(async database => {
    const transaction = database.transaction(['files', 'records', 'pending', 'offlineBooks'], 'readwrite')
    try {
      for (const file of files) await transaction.objectStore('files').put(file)
      for (const file of offlineBooks) await transaction.objectStore('offlineBooks').put(file)
      for (const { record, sync } of records) {
        const current = await transaction.objectStore('records').get(record.key)
        const value = { ...record, version: current?.version || 0 }
        await transaction.objectStore('records').put(value)
        if (!sync || !profile.startsWith('ACCOUNT:')) continue
        const pending = await transaction.objectStore('pending').get(record.key)
        // Preserve an already-submitted operation's identity. syncNow will
        // reconcile this newer local payload after the original receipt.
        if (pending?.attempted) continue
        await transaction.objectStore('pending').put({
          key: record.key, profile, attempted: false,
          needsBlobUpload: record.kind === 'catalog_books' && !record.deleted && typeof record.payload.file_url === 'string' && record.payload.file_url.startsWith('nocap-private:'),
          operation: {
            opId: pending?.operation.opId || crypto.randomUUID(),
            kind: record.kind, id: record.id, baseVersion: current?.version || 0,
            deleted: record.deleted, payload: record.payload,
            recreate: current?.deleted && !record.deleted ? true : undefined,
          },
        })
      }
      await transaction.done
    } catch (error) {
      try { transaction.abort() } catch { /* the transaction already aborted */ }
      await transaction.done.catch(() => {})
      throw error
    }
  })
}

export const SESSION_STORAGE_KEY = 'nocap-session'

function parseSession(raw: string | null): Session | null {
  try {
    const value = JSON.parse(raw || 'null')
    return typeof value?.token === 'string' && value.token.length > 0 &&
      typeof value.expiresAt === 'number' && Number.isFinite(value.expiresAt) && value.expiresAt > Date.now() / 1000 &&
      typeof value.user?.id === 'string' && value.user.id.length > 0 &&
      typeof value.user.email === 'string' && typeof value.user.emailVerified === 'boolean'
      ? value : null
  } catch { return null }
}

function clearLegacySession() {
  try { sessionStorage.removeItem(SESSION_STORAGE_KEY) } catch { /* Browser storage may be disabled. */ }
}

export function readSession(): Session | null {
  try {
    const raw = localStorage.getItem(SESSION_STORAGE_KEY)
    if (raw !== null) {
      clearLegacySession()
      const value = parseSession(raw)
      if (!value && raw !== 'null') saveSession(null)
      return value
    }
  } catch { /* Fall back to the current tab when persistent storage is unavailable. */ }

  let legacy: Session | null = null
  try { legacy = parseSession(sessionStorage.getItem(SESSION_STORAGE_KEY)) } catch { /* Browser storage may be disabled. */ }
  if (legacy) saveSession(legacy)
  else clearLegacySession()
  return legacy
}

export function saveSession(value: Session | null) {
  try {
    // Keep a null marker after logout so an older tab cannot restore its legacy session.
    localStorage.setItem(SESSION_STORAGE_KEY, JSON.stringify(value))
    clearLegacySession()
  } catch {
    try {
      if (value) sessionStorage.setItem(SESSION_STORAGE_KEY, JSON.stringify(value))
      else clearLegacySession()
    } catch { /* Login in the current page still works without browser storage. */ }
  }
}
