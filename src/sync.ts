import { md5 } from '@noble/hashes/legacy.js'
import { getChanges, getUser, pushOperation, ApiError } from './api'
import { getPending, getRecords, keyFor, removePending, savePending, saveRecord } from './store'
import type { Session, SyncKind, SyncOperation, SyncRecord } from './types'

const encoder = new TextEncoder()
const hex = (text: string) => Array.from(encoder.encode(text), byte => byte.toString(16).padStart(2, '0')).join('').toUpperCase()

// Android uses UUID.nameUUIDFromBytes("nocap-sync-v1:<kind>:<hex local key>").
// Keep this exact so web and Android update one record rather than duplicating it.
export function androidRecordId(kind: SyncKind, localId: string): string {
  const bytes = md5(encoder.encode(`nocap-sync-v1:${kind}:${hex(localId)}`))
  bytes[6] = (bytes[6] & 0x0f) | 0x30
  bytes[8] = (bytes[8] & 0x3f) | 0x80
  const value = Array.from(bytes, b => b.toString(16).padStart(2, '0')).join('')
  return `${value.slice(0, 8)}-${value.slice(8, 12)}-${value.slice(12, 16)}-${value.slice(16, 20)}-${value.slice(20)}`
}

export const profileFor = (session: Session | null) => session ? `ACCOUNT:${session.user.id}` : 'DEVICE_LOCAL'
const recordKey = (profile: string, kind: SyncKind, id: string) => keyFor(profile, `${kind}:${id}`)
const pendingKey = (profile: string, kind: SyncKind, id: string) => keyFor(profile, `${kind}:${id}`)

export async function localRecords(profile: string): Promise<SyncRecord[]> { return getRecords(profile) }

export async function mutate(profile: string, kind: SyncKind, id: string, payload: Record<string, unknown>, deleted = false, localOnly = false) {
  const key = recordKey(profile, kind, id)
  const current = (await getRecords(profile)).find(record => record.key === key)
  await saveRecord({ key, profile, kind, id, version: current?.version || 0, deleted, payload })
  if (profile === 'DEVICE_LOCAL' || localOnly) return
  const pending = (await getPending(profile)).find(item => item.key === pendingKey(profile, kind, id))
  // An in-flight or conflicted operation must keep its original payload and
  // operation ID; the newer local edit stays in the record until it can be
  // reconciled without clobbering either version.
  if (pending?.attempted) return
  const operation: SyncOperation = {
    opId: pending?.operation.opId || crypto.randomUUID(), kind, id,
    baseVersion: current?.version || 0, deleted, payload,
  }
  await savePending({ key: pendingKey(profile, kind, id), profile, operation, attempted: false })
}

export async function syncNow(session: Session): Promise<{ conflicts: number; changes: number }> {
  const profile = profileFor(session)
  // Reject a revoked or expired session before mutating local sync state.
  await getUser(session.token)
  let conflicts = 0
  for (const item of await getPending(profile)) {
    if (item.conflicted) { conflicts++; continue }
    await savePending({ ...item, attempted: true })
    const result = await pushOperation(session.token, item.operation)
    const receipt = result.receipts[0]
    if (!receipt) throw new Error('Máy chủ chưa xác nhận thao tác đồng bộ.')
    const key = recordKey(profile, item.operation.kind, item.operation.id)
    const current = (await getRecords(profile)).find(record => record.key === key)
    const latest = receipt.current
    if (receipt.status === 'APPLIED' && latest) {
      const changedAgain = current && (current.deleted !== item.operation.deleted || JSON.stringify(current.payload) !== JSON.stringify(item.operation.payload))
      await removePending(item.key)
      if (changedAgain) {
        await saveRecord({ ...current, version: latest.version })
        await mutate(profile, current.kind, current.id, current.payload, current.deleted)
      } else await saveRecord({ key, profile, kind: item.operation.kind, id: item.operation.id, version: latest.version, deleted: !!latest.deleted, payload: latest.payload })
    } else {
      conflicts++
      // Keep the local copy and its pending marker. Pull must not overwrite it
      // with the server version before the user can review the conflict.
      await savePending({ ...item, attempted: true, conflicted: true })
    }
  }
  let cursor = 0
  let count = 0
  for (let page = 0; page < 100; page++) {
    const result = await getChanges(session.token, cursor)
    const pending = new Set((await getPending(profile)).map(item => item.key))
    for (const change of result.changes) {
      if (!['catalog_books', 'reading_progress', 'bookmarks', 'highlights', 'favorites'].includes(change.kind)) continue
      const kind = change.kind as SyncKind
      const key = recordKey(profile, kind, change.id)
      if (pending.has(key)) continue
      await saveRecord({ key, profile, kind, id: change.id, version: change.version, deleted: !!change.deleted, payload: change.payload })
      count++
    }
    cursor = result.cursor
    if (!result.hasMore) return { conflicts, changes: count }
  }
  throw new Error('Có quá nhiều thay đổi để tải một lần. Vui lòng đồng bộ lại.')
}

export function readableError(error: unknown): string {
  if (error instanceof ApiError && error.status === 401) return 'Phiên đăng nhập đã hết hạn. Đăng nhập lại để đồng bộ.'
  return error instanceof Error ? error.message : 'Không hoàn tất được thao tác. Vui lòng thử lại.'
}
