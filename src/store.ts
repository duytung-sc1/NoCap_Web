import { openDB, type DBSchema } from 'idb'
import type { LocalFile, PendingOperation, SyncRecord } from './types'

interface NoCapDB extends DBSchema {
  files: { key: string; value: LocalFile }
  records: { key: string; value: SyncRecord }
  pending: { key: string; value: PendingOperation }
}

let connection: ReturnType<typeof openDB<NoCapDB>> | null = null
function db() {
  if (!connection) connection = openDB<NoCapDB>('nocap-web-v1', 1, {
    upgrade(database) {
      database.createObjectStore('files', { keyPath: 'key' })
      database.createObjectStore('records', { keyPath: 'key' })
      database.createObjectStore('pending', { keyPath: 'key' })
    },
  })
  return connection
}

const range = (profile: string) => IDBKeyRange.bound(`${profile}:`, `${profile}:\uffff`)
export const keyFor = (profile: string, id: string) => `${profile}:${id}`

export async function getFiles(profile: string) { return (await db()).getAll('files', range(profile)) }
export async function getFile(profile: string, id: string) { return (await db()).get('files', keyFor(profile, id)) }
export async function saveFile(value: LocalFile) { await (await db()).put('files', value) }
export async function removeLocalDocument(profile: string, id: string) {
  const database = await db()
  const transaction = database.transaction(['files', 'records', 'pending'], 'readwrite')
  await transaction.objectStore('files').delete(keyFor(profile, id))
  for (const record of await transaction.objectStore('records').getAll(range(profile))) {
    if (record.payload.book_id === id || (record.kind === 'catalog_books' && record.payload.id === id)) await transaction.objectStore('records').delete(record.key)
  }
  for (const pending of await transaction.objectStore('pending').getAll(range(profile))) {
    if (pending.operation.payload.book_id === id) await transaction.objectStore('pending').delete(pending.key)
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
