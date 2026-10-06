import { md5 } from '@noble/hashes/legacy.js'
import { API_BASE, getChanges, getUser, pushOperation, ApiError } from './api'
import { getPending, getPendingItem, getRecord, getRecords, getSyncCursor, keyFor, removePending, savePending, saveRecord, saveSyncCursor } from './store'
import { SYNC_KINDS, type PendingOperation, type Session, type SyncKind, type SyncOperation, type SyncRecord } from './types'

const encoder = new TextEncoder()
const hex = (text: string) => Array.from(encoder.encode(text), byte => byte.toString(16).padStart(2, '0')).join('').toUpperCase()

// Android uses UUID.nameUUIDFromBytes("nocap-sync-v1:<kind>:<hex local key>").
// Keep this exact so web and Android update one record rather than duplicating it.
export function androidRecordId(kind: SyncKind, localId: string): string {
  return androidCompositeRecordId(kind, [localId])
}

/** Android hex-encodes every component before joining composite Room keys. */
export function androidCompositeRecordId(kind: SyncKind, localIds: string[]): string {
  const localKey = localIds.map(hex).join(':')
  const bytes = md5(encoder.encode(`nocap-sync-v1:${kind}:${localKey}`))
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
  const current = await getRecord(key)
  await saveRecord({ key, profile, kind, id, version: current?.version || 0, deleted, payload })
  if (profile === 'DEVICE_LOCAL' || localOnly) return
  const pending = await getPendingItem(pendingKey(profile, kind, id))
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
    const current = await getRecord(key)
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
  let cursor = await getSyncCursor(profile)
  let count = 0
  for (let page = 0; page < 100; page++) {
    const result = await getChanges(session.token, cursor)
    const pending = new Set((await getPending(profile)).map(item => item.key))
    for (const change of result.changes) {
      if (!(SYNC_KINDS as readonly string[]).includes(change.kind)) continue
      const kind = change.kind as SyncKind
      const key = recordKey(profile, kind, change.id)
      if (pending.has(key)) continue
      await saveRecord({ key, profile, kind, id: change.id, version: change.version, deleted: !!change.deleted, payload: change.payload })
      count++
    }
    cursor = result.cursor
    await saveSyncCursor(profile, cursor)
    if (!result.hasMore) return { conflicts, changes: count }
  }
  throw new Error('Có quá nhiều thay đổi để tải một lần. Vui lòng đồng bộ lại.')
}

export function readableError(error: unknown): string {
  if (error instanceof ApiError && error.status === 401) return 'Phiên đăng nhập đã hết hạn. Đăng nhập lại để đồng bộ.'
  return error instanceof Error ? error.message : 'Không hoàn tất được thao tác. Vui lòng thử lại.'
}

export function getDeviceId(): string {
  try {
    let id = localStorage.getItem('nocap_device_id')
    if (!id || !/^[0-9a-f]{8}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{12}$/i.test(id)) {
      id = crypto.randomUUID()
      localStorage.setItem('nocap_device_id', id)
    }
    return id
  } catch {
    return '00000000-0000-0000-0000-000000000001'
  }
}

const syncBroadcastChannel = typeof BroadcastChannel !== 'undefined' ? new BroadcastChannel('nocap_tab_sync') : null

export function broadcastSyncRequired(profile: string) {
  try {
    syncBroadcastChannel?.postMessage({ type: 'sync_required', profile, timestamp: Date.now() })
  } catch {
    // Ignore channel errors
  }
}

export function connectLiveSync(session: Session, deviceId: string, onSyncRequired: () => void): () => void {
  let active = true
  let ws: WebSocket | null = null
  let pingTimer: ReturnType<typeof setInterval> | null = null
  let reconnectTimer: ReturnType<typeof setTimeout> | null = null
  let backoffMs = 2000

  const onChannelMessage = (event: MessageEvent) => {
    if (!active) return
    const data = event.data as { type?: string; profile?: string }
    if (data?.type === 'sync_required' && (!data.profile || data.profile === profileFor(session))) {
      onSyncRequired()
    }
  }
  syncBroadcastChannel?.addEventListener('message', onChannelMessage)

  const connect = () => {
    if (!active) return
    try {
      const wsUrl = `${API_BASE.replace(/^http/, 'ws')}/api/v1/sync/live?token=${encodeURIComponent(session.token)}&device=${encodeURIComponent(deviceId)}`
      ws = new WebSocket(wsUrl)
      ws.onopen = () => {
        backoffMs = 2000
        if (pingTimer) clearInterval(pingTimer)
        pingTimer = setInterval(() => {
          if (ws?.readyState === WebSocket.OPEN) {
            try { ws.send('ping') } catch {}
          }
        }, 25000)
      }
      ws.onmessage = (event) => {
        try {
          const msg = JSON.parse(event.data) as { type?: string }
          if (msg.type === 'sync_required') {
            onSyncRequired()
          }
        } catch {}
      }
      ws.onclose = () => {
        if (pingTimer) clearInterval(pingTimer)
        if (active) {
          reconnectTimer = setTimeout(connect, backoffMs)
          backoffMs = Math.min(30000, backoffMs * 1.5)
        }
      }
      ws.onerror = () => {
        try { ws?.close() } catch {}
      }
    } catch {
      if (active) {
        reconnectTimer = setTimeout(connect, backoffMs)
        backoffMs = Math.min(30000, backoffMs * 1.5)
      }
    }
  }

  connect()

  return () => {
    active = false
    syncBroadcastChannel?.removeEventListener('message', onChannelMessage)
    if (pingTimer) clearInterval(pingTimer)
    if (reconnectTimer) clearTimeout(reconnectTimer)
    if (ws) {
      ws.onclose = null
      ws.onerror = null
      try { ws.close() } catch {}
    }
  }
}

export async function getConflicts(profile: string): Promise<PendingOperation[]> {
  const allPending = await getPending(profile)
  return allPending.filter(item => !!item.conflicted)
}

export async function resolveConflict(
  session: Session,
  key: string,
  strategy: 'keep_local' | 'take_remote'
): Promise<void> {
  const profile = profileFor(session)
  const item = await getPendingItem(key)
  if (!item) return
  if (item.profile !== profile) throw new Error('Mục đồng bộ không thuộc tài khoản hiện tại.')
  await getUser(session.token)

  let remote: Awaited<ReturnType<typeof getChanges>>['changes'][number] | undefined
  let cursor = 0
  for (let page = 0; ; page++) {
    if (page >= 100) throw new Error('Có quá nhiều thay đổi để đối soát. Vui lòng thử lại.')
    const result = await getChanges(session.token, cursor)
    for (const change of result.changes) {
      if (change.kind === item.operation.kind && change.id === item.operation.id) remote = change
    }
    if (!result.hasMore) break
    if (result.cursor <= cursor) throw new Error('Máy chủ chưa trả đủ dữ liệu đối soát.')
    cursor = result.cursor
  }

  if (strategy === 'take_remote') {
    if (!remote) throw new Error('Chưa tìm thấy bản cloud. Bản trên máy vẫn được giữ.')
    await saveRecord({
        key: recordKey(profile, remote.kind as SyncKind, remote.id),
        profile,
        kind: remote.kind as SyncKind,
        id: remote.id,
        version: remote.version,
        deleted: !!remote.deleted,
        payload: remote.payload,
    })
    await removePending(key)
  } else {
    const baseVersion = remote ? remote.version : item.operation.baseVersion
    const local = await getRecord(key)
    const refreshedOp: SyncOperation = {
      ...item.operation,
      opId: crypto.randomUUID(),
      baseVersion,
      payload: local?.payload || item.operation.payload,
      deleted: local?.deleted ?? item.operation.deleted,
    }
    // Persist the new ID before pushing so a lost response can be retried safely.
    await savePending({ ...item, operation: refreshedOp, attempted: true, conflicted: true })
    const pushRes = await pushOperation(session.token, refreshedOp)
    const receipt = pushRes.receipts[0]
    if (receipt && receipt.status === 'APPLIED' && receipt.current) {
      await saveRecord({
        key: recordKey(profile, item.operation.kind, item.operation.id),
        profile,
        kind: item.operation.kind,
        id: item.operation.id,
        version: receipt.current.version,
        deleted: !!receipt.current.deleted,
        payload: receipt.current.payload,
      })
      await removePending(key)
    } else {
      throw new Error('Chưa thể giải quyết xung đột với máy chủ. Vui lòng thử lại.')
    }
  }
}
