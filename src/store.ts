import { openDB, type DBSchema, type IDBPDatabase, type IDBPTransaction } from 'idb'
import type { Book, Category, LocalFile, PendingOperation, Session, SyncKind, SyncOperation, SyncRecord } from './types'

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
// Older clients advance past hidden Web-only records. Replay the folder-aware
// feed once with an independent cursor so no folder/move can be skipped.
const syncCursorKey = (profile: string) => `sync-cursor:library-v1:${profile}`

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
  const value = await withDatabase(database => database.get('metadata', syncCursorKey(profile)))
  const cursor = value && 'cursor' in value ? Number(value.cursor) : 0
  return Number.isSafeInteger(cursor) && cursor >= 0 ? cursor : 0
}
export async function saveSyncCursor(profile: string, cursor: number) {
  if (!Number.isSafeInteger(cursor) || cursor < 0) throw new Error('Invalid sync cursor')
  await withDatabase(database => database.put('metadata', { key: syncCursorKey(profile), cursor }))
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

type SyncTransaction = IDBPTransaction<NoCapDB, ['records', 'pending', 'metadata', 'files', 'offlineBooks'], 'readwrite'>

async function withSyncTransaction<T>(operation: (transaction: SyncTransaction) => Promise<T>): Promise<T> {
  return withDatabase(async database => {
    const transaction = database.transaction(['records', 'pending', 'metadata', 'files', 'offlineBooks'], 'readwrite')
    try {
      const result = await operation(transaction)
      await transaction.done
      return result
    } catch (error) {
      try { transaction.abort() } catch { /* already aborted */ }
      await transaction.done.catch(() => {})
      throw error
    }
  })
}

/** Server sync protects completion; the locator can still move back for rereading. */
function retainCompletedProgress(kind: SyncKind, payload: Record<string, unknown>, previous: Record<string, unknown> | undefined, deleted: boolean, previousDeleted: boolean) {
  const current = previous?.progression, next = payload.progression
  return kind === 'reading_progress' && !deleted && !previousDeleted &&
    typeof current === 'number' && current >= 0.98 && current <= 1 &&
    typeof next === 'number' && next >= 0 && next < 0.98
    ? { ...payload, progression: current } : payload
}

/** Commit the visible record and its outbox together, including across tabs. */
export async function saveLocalMutation(profile: string, kind: SyncKind, id: string, payload: Record<string, unknown>, deleted: boolean, localOnly: boolean) {
  await withSyncTransaction(transaction => writeLocalMutation(transaction, profile, { kind, id, payload, deleted, localOnly }))
}

export type LocalMutation = { kind: SyncKind; id: string; payload: Record<string, unknown>; deleted?: boolean; localOnly?: boolean }

/** Recheck relationships and commit the entire user action in one transaction.
 * Builders are synchronous: no network work may interrupt this transaction. */
export async function applyLocalMutations(profile: string, build: (records: SyncRecord[]) => LocalMutation[]) {
  await withSyncTransaction(async transaction => {
    const current = await transaction.objectStore('records').getAll(range(profile))
    const changes = build(current)
    for (const change of changes) await writeLocalMutation(transaction, profile, change)
  })
}

/** Reset only personal shelf membership. Public catalog data, shared downloads,
 * annotations, review cards and past reading sessions remain intact. Progress
 * must cross a server tombstone: writing zero cannot reset a completed book. */
export async function resetPublicLibraryBook(profile: string, bookId: string, canonicalProgressId: string): Promise<void> {
  if (!profile || !bookId.trim() || bookId.length > 512 || [...bookId].some(character => character.charCodeAt(0) < 32 || character.charCodeAt(0) === 127) ||
    !/^[0-9a-f]{8}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{12}$/i.test(canonicalProgressId)) throw new Error('Invalid public library book identity')
  await withSyncTransaction(async transaction => {
    const records = await transaction.objectStore('records').getAll(range(profile))
    const matching = records.filter(record => record.profile === profile && record.payload.book_id === bookId)
    // Older clients can leave a canonical tombstone with an empty payload.
    // Its observed deleted version is still authoritative for this identity.
    const progress = records.filter(record => record.profile === profile && record.kind === 'reading_progress' &&
      (record.payload.book_id === bookId || record.id === canonicalProgressId))
    const now = Math.max(Date.now(), ...progress.map(record => Number.isSafeInteger(record.payload.last_read_at) ? Number(record.payload.last_read_at) : 0))
    const resetPayload = { book_id: bookId, last_read_at: now, sync_version: 1 }
    const progressIds = new Set(progress.filter(record => !record.deleted).map(record => record.id))
    if (!progress.some(record => record.id === canonicalProgressId)) progressIds.add(canonicalProgressId)
    for (const id of progressIds) {
      const key = keyFor(profile, `reading_progress:${id}`)
      const previousPending = await transaction.objectStore('pending').get(key)
      await writeLocalMutation(transaction, profile, { kind: 'reading_progress', id, payload: resetPayload, deleted: true })
      if (profile === 'DEVICE_LOCAL') continue
      if (previousPending && !previousPending.attempted && previousPending.operation.recreate &&
        !previousPending.operation.deleted && previousPending.remoteDeleted) {
        // The preceding reset is already acknowledged. A reread that has not
        // been submitted can simply be cancelled; the cloud is still deleted.
        await transaction.objectStore('pending').delete(key)
        continue
      }
      const pending = await transaction.objectStore('pending').get(key)
      if (!pending) continue
      // Freezing is part of this same transaction; another tab cannot replace
      // the deletion with a reread before its version has been acknowledged.
      await transaction.objectStore('pending').put(previousPending?.attempted && !previousPending.operation.deleted
        ? { ...pending, resetAfterAcknowledgement: { payload: resetPayload } }
        : { ...pending, attempted: true })
    }
    for (const record of matching) {
      if (record.deleted || (record.kind !== 'favorites' && record.kind !== 'book_folder_locations')) continue
      await writeLocalMutation(transaction, profile, { kind: record.kind, id: record.id, payload: record.payload, deleted: true })
    }
  })
}

async function writeLocalMutation(transaction: SyncTransaction, profile: string, { kind, id, payload, deleted = false, localOnly = false }: LocalMutation) {
  const key = keyFor(profile, `${kind}:${id}`)
    const records = transaction.objectStore('records')
    const pendingStore = transaction.objectStore('pending')
    const current = await records.get(key)
    const pending = await pendingStore.get(key)
    const nextPayload = retainCompletedProgress(kind, payload, current?.payload, deleted, !!current?.deleted)
    await records.put({ key, profile, kind, id, version: current?.version || 0, deleted, payload: nextPayload })
    if (profile === 'DEVICE_LOCAL' || localOnly || pending?.attempted) return
    await pendingStore.put({
      key, profile, attempted: false, needsBlobUpload: pending?.needsBlobUpload,
      remoteDeleted: pending?.remoteDeleted ?? (!pending && current?.deleted && current.version > 0 ? true : undefined),
      operation: {
        opId: pending?.operation.opId || crypto.randomUUID(), kind, id,
        baseVersion: current?.version || 0, deleted, payload: nextPayload,
        recreate: current?.deleted && !deleted ? true : pending?.operation.recreate,
      },
    })
}

/** Freeze the latest outbox payload before any asynchronous upload/push. */
export async function claimPendingOperation(key: string): Promise<PendingOperation | undefined> {
  return withSyncTransaction(async transaction => {
    const store = transaction.objectStore('pending')
    const item = await store.get(key)
    if (!item || item.conflicted) return undefined
    const claimed = { ...item, attempted: true }
    await store.put(claimed)
    return claimed
  })
}

export async function updatePendingOperation(item: PendingOperation, patch: Pick<Partial<PendingOperation>, 'needsBlobUpload' | 'conflicted' | 'remoteDeleted'>) {
  return withSyncTransaction(async transaction => {
    const store = transaction.objectStore('pending')
    const current = await store.get(item.key)
    if (current?.operation.opId !== item.operation.opId) return false
    await store.put({ ...current, ...patch })
    return true
  })
}

type SyncVersion = { version: number; deleted: number | boolean; payload: Record<string, unknown> }

async function invalidateCatalogCache(transaction: SyncTransaction, change: SyncRecord, current?: SyncRecord) {
  if (change.kind !== 'catalog_books') return
  // Imported cloud bytes are a cache, never authority over a new catalog version.
  const bookId = String(change.payload.id || current?.payload.id || '')
  if (!bookId) return
  const key = keyFor(change.profile, bookId)
  const file = await transaction.objectStore('files').get(key)
  if (file?.book.source === 'cloud' && (change.deleted || file.book.fileUrl !== change.payload.file_url)) await transaction.objectStore('files').delete(key)
  if (change.deleted || (current && current.payload.file_url !== change.payload.file_url)) await transaction.objectStore('offlineBooks').delete(key)
}

/** A receipt must not erase an edit made while the request was in flight. */
export async function acknowledgeSyncOperation(item: PendingOperation, latest: SyncVersion) {
  await withSyncTransaction(async transaction => {
    const records = transaction.objectStore('records')
    const pendingStore = transaction.objectStore('pending')
    const pending = await pendingStore.get(item.key)
    if (pending?.operation.opId !== item.operation.opId) return
    const current = await records.get(item.key)
    if (current && current.version > latest.version) return
    if (pending.resetAfterAcknowledgement && !latest.deleted) {
      // Preserve a reread's visible position, but publish the reset first even
      // when the superseded request was an older active-progress operation.
      if (current) await records.put({ ...current, version: latest.version })
      await pendingStore.put({
        key: item.key, profile: item.profile, attempted: true,
        operation: { opId: crypto.randomUUID(), kind: item.operation.kind, id: item.operation.id,
          baseVersion: latest.version, deleted: true, payload: pending.resetAfterAcknowledgement.payload },
      })
      return
    }
    const resetAlreadyApplied = !!pending.resetAfterAcknowledgement && !!latest.deleted
    // Repeated resets need no second write to a server tombstone. Their
    // timestamps may differ, but the deleted state already records the reset.
    const sameProgressDeletion = item.operation.kind === 'reading_progress' && !!current?.deleted && !!latest.deleted
    const changedAgain = current && !sameProgressDeletion && ((resetAlreadyApplied && !current.deleted) || current.deleted !== item.operation.deleted || JSON.stringify(current.payload) !== JSON.stringify(item.operation.payload))
    if (changedAgain) {
      await records.put({ ...current, version: latest.version })
      await pendingStore.put({
        key: item.key, profile: item.profile, attempted: false,
        remoteDeleted: latest.deleted ? true : undefined,
        needsBlobUpload: current.kind === 'catalog_books' && current.payload.file_url !== item.operation.payload.file_url,
        operation: {
          opId: crypto.randomUUID(), kind: current.kind, id: current.id,
          baseVersion: latest.version, deleted: current.deleted, payload: current.payload,
          recreate: latest.deleted && !current.deleted ? true : undefined,
        },
      })
    } else {
      const next = { key: item.key, profile: item.profile, kind: item.operation.kind, id: item.operation.id, version: latest.version, deleted: !!latest.deleted, payload: latest.payload }
      await invalidateCatalogCache(transaction, next, current)
      await records.put(next)
      await pendingStore.delete(item.key)
    }
  })
}

/** Pull, pending checks and the cursor are one transaction; stale responses cannot regress it. */
export async function applyRemoteChanges(profile: string, changes: SyncRecord[], cursor: number): Promise<number> {
  if (!Number.isSafeInteger(cursor) || cursor < 0) throw new Error('Invalid sync cursor')
  return withSyncTransaction(async transaction => {
    const records = transaction.objectStore('records')
    const pending = transaction.objectStore('pending')
    let count = 0
    for (const change of changes) {
      if (await pending.get(change.key)) continue
      const current = await records.get(change.key)
      if (current && current.version >= change.version) continue
      await invalidateCatalogCache(transaction, change, current)
      await records.put(change)
      count++
    }
    const key = syncCursorKey(profile)
    const previous = await transaction.objectStore('metadata').get(key)
    await transaction.objectStore('metadata').put({ key, cursor: Math.max(cursor, previous && 'cursor' in previous ? previous.cursor : 0) })
    return count
  })
}

export async function prepareLocalConflict(item: PendingOperation, remote?: SyncVersion): Promise<PendingOperation> {
  return withSyncTransaction(async transaction => {
    const store = transaction.objectStore('pending')
    const current = await store.get(item.key)
    if (current?.operation.opId !== item.operation.opId) throw new Error('Mục đồng bộ đã thay đổi. Vui lòng thử lại.')
    const local = await transaction.objectStore('records').get(item.key)
    const resetRequired = item.operation.kind === 'reading_progress' && !remote?.deleted &&
      (!!current.resetAfterAcknowledgement || current.operation.deleted)
    const deleted = resetRequired || (local?.deleted ?? item.operation.deleted)
    const localPayload = resetRequired ? current.resetAfterAcknowledgement?.payload || current.operation.payload : local?.payload || item.operation.payload
    const payload = retainCompletedProgress(item.operation.kind, localPayload, remote?.payload, deleted, !!remote?.deleted)
    if (local && !resetRequired && payload !== localPayload) await transaction.objectStore('records').put({ ...local, payload })
    const operation: SyncOperation = {
      ...item.operation, opId: crypto.randomUUID(), baseVersion: remote?.version ?? item.operation.baseVersion,
      payload, deleted,
      recreate: remote?.deleted && !deleted ? true : undefined,
    }
    const next = { ...current, operation, attempted: true, conflicted: true, remoteDeleted: !!remote?.deleted, resetAfterAcknowledgement: undefined,
      needsBlobUpload: current.needsBlobUpload || operation.payload.file_url !== item.operation.payload.file_url }
    await store.put(next)
    return next
  })
}

export async function acceptRemoteConflict(item: PendingOperation, remote: SyncVersion, expected: SyncRecord | undefined) {
  await withSyncTransaction(async transaction => {
    const records = transaction.objectStore('records')
    const current = await records.get(item.key)
    const pending = await transaction.objectStore('pending').get(item.key)
    if (pending?.operation.opId !== item.operation.opId || JSON.stringify(current) !== JSON.stringify(expected) || (current && remote.version < current.version)) {
      throw new Error('Bản trên máy vừa thay đổi. Vui lòng xem lại xung đột.')
    }
    const next = { key: item.key, profile: item.profile, kind: item.operation.kind, id: item.operation.id, version: remote.version, deleted: !!remote.deleted, payload: remote.payload }
    await invalidateCatalogCache(transaction, next, current)
    await records.put(next)
    await transaction.objectStore('pending').delete(item.key)
  })
}

/** Apply a validated backup atomically, using target-account versions rather
 * than versions copied from a different account's snapshot. */
export type LibraryRestoreEntry = { record: SyncRecord; sync: boolean }
export async function applyLibraryRestore(
  profile: string,
  records: LibraryRestoreEntry[],
  files: LocalFile[],
  offlineBooks: OfflineBook[],
  prepare?: (entries: LibraryRestoreEntry[], current: SyncRecord[]) => LibraryRestoreEntry[],
) {
  await withDatabase(async database => {
    const transaction = database.transaction(['files', 'records', 'pending', 'offlineBooks'], 'readwrite')
    try {
      // Reconcile folder identities against the same locked snapshot that will
      // be restored; a deletion in another tab cannot race the remapping.
      const entries = prepare ? prepare(records, await transaction.objectStore('records').getAll(range(profile))) : records
      for (const file of files) await transaction.objectStore('files').put(file)
      for (const file of offlineBooks) await transaction.objectStore('offlineBooks').put(file)
      for (const { record, sync } of entries) {
        const current = await transaction.objectStore('records').get(record.key)
        const value = { ...record, version: current?.version || 0 }
        await transaction.objectStore('records').put(value)
        if (!sync || !profile.startsWith('ACCOUNT:')) continue
        const pending = await transaction.objectStore('pending').get(record.key)
        // An operation awaiting its blob has not been pushed. Replace it when
        // restoring new bytes, since its old hash no longer has a local file.
        // Preserve submitted operations until their receipts can be reconciled.
        if (pending?.attempted && !pending.needsBlobUpload) continue
        await transaction.objectStore('pending').put({
          key: record.key, profile, attempted: false,
          needsBlobUpload: record.kind === 'catalog_books' && !record.deleted && typeof record.payload.file_url === 'string' && record.payload.file_url.startsWith('nocap-private:'),
          operation: {
            opId: pending && !pending.attempted ? pending.operation.opId : crypto.randomUUID(),
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
const SESSION_FALLBACK_STORAGE_KEY = 'nocap-session-fallback'

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

function clearSessionFallback() {
  try { sessionStorage.removeItem(SESSION_FALLBACK_STORAGE_KEY) } catch { /* Browser storage may be disabled. */ }
}

export function readSession(): Session | null {
  let raw: string | null | undefined
  try { raw = localStorage.getItem(SESSION_STORAGE_KEY) } catch { /* Persistent storage may be disabled. */ }

  try {
    const fallback = JSON.parse(sessionStorage.getItem(SESSION_FALLBACK_STORAGE_KEY) || 'null')
    if (fallback && typeof fallback.raw === 'string') {
      // A failed shared write must override the old account in this tab. Stop
      // using it as soon as another tab changes the shared credentials.
      if (raw === undefined || fallback.sharedRaw === undefined || raw === fallback.sharedRaw) {
        const value = parseSession(fallback.raw)
        // An explicit tab-only login must never be promoted to localStorage.
        if (fallback.remember === false && value) return value
        saveSession(value)
        return value
      }
      clearSessionFallback()
    }
  } catch { /* Fall back to the shared or legacy session if tab storage is unavailable. */ }

  if (raw !== undefined && raw !== null) {
    clearLegacySession()
    const value = parseSession(raw)
    if (!value && raw !== 'null') saveSession(null)
    return value
  }

  let legacy: Session | null = null
  try { legacy = parseSession(sessionStorage.getItem(SESSION_STORAGE_KEY)) } catch { /* Browser storage may be disabled. */ }
  if (legacy) saveSession(legacy)
  else clearLegacySession()
  return legacy
}

export function saveSession(value: Session | null, remember?: boolean) {
  const raw = JSON.stringify(value)
  if (value && remember === undefined) {
    try {
      const fallback = JSON.parse(sessionStorage.getItem(SESSION_FALLBACK_STORAGE_KEY) || 'null')
      if (fallback?.remember === false && parseSession(fallback.raw)?.token === value.token) remember = false
    } catch { /* Keep the existing default for sessions without a tab-only choice. */ }
  }
  if (value && remember === false) {
    let sharedRaw: string | null | undefined
    try { sharedRaw = localStorage.getItem(SESSION_STORAGE_KEY) } catch { /* Storage may be disabled. */ }
    try {
      // Invalidate any old persistent login without writing this token to disk.
      localStorage.setItem(SESSION_STORAGE_KEY, 'null')
      sharedRaw = 'null'
    } catch { /* The tab fallback still overrides readable old credentials. */ }
    try {
      sessionStorage.setItem(SESSION_FALLBACK_STORAGE_KEY, JSON.stringify({ raw, sharedRaw, remember: false }))
    } catch { /* Do not turn a tab-only choice into a persistent login. */ }
    clearLegacySession()
    return
  }
  try {
    // Keep a null marker after logout so an older tab cannot restore its legacy session.
    localStorage.setItem(SESSION_STORAGE_KEY, raw)
    clearLegacySession()
    clearSessionFallback()
  } catch {
    let sharedRaw: string | null | undefined
    try { sharedRaw = localStorage.getItem(SESSION_STORAGE_KEY) } catch { /* Persistent storage may be disabled. */ }
    try {
      // Keep the null logout marker here too: clearing tab storage alone would
      // allow a readable, stale localStorage session to sign the user back in.
      sessionStorage.setItem(SESSION_FALLBACK_STORAGE_KEY, JSON.stringify({ raw, sharedRaw }))
      clearLegacySession()
    } catch { /* Login in the current page still works without browser storage. */ }
  }
}
