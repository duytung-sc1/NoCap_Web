import { getStoredLang, type Lang } from './i18n'
import { localizeErrorMessage, translate } from './uiText'
import { md5 } from '@noble/hashes/legacy.js'
import { API_BASE, getChanges, getUser, pushOperation, uploadBlob, ApiError } from './api'
import { acceptRemoteConflict, acknowledgeSyncOperation, applyRemoteChanges, claimPendingOperation, getFile, getPending, getPendingItem, getRecord, getRecords, getSyncCursor, keyFor, prepareLocalConflict, saveLocalMutation, updatePendingOperation } from './store'
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

export async function localRecords(profile: string): Promise<SyncRecord[]> { return getRecords(profile) }

async function uploadRestoredFile(profile: string, token: string, operation: SyncOperation, needsUpload?: boolean) {
  const fileUrl = operation.payload.file_url
  if (!needsUpload || operation.kind !== 'catalog_books' || operation.deleted || typeof fileUrl !== 'string' || !/^nocap-private:[a-f0-9]{64}$/.test(fileUrl)) return
  const file = await getFile(profile, String(operation.payload.id || ''))
  if (!file) throw new Error('Thiếu tệp gốc để đồng bộ tài liệu đã khôi phục. Hãy nhập lại tệp.')
  await uploadBlob(token, fileUrl.slice('nocap-private:'.length), file.data)
}

export async function mutate(profile: string, kind: SyncKind, id: string, payload: Record<string, unknown>, deleted = false, localOnly = false) {
  await saveLocalMutation(profile, kind, id, payload, deleted, localOnly)
}

export async function syncNow(session: Session): Promise<{ conflicts: number; changes: number }> {
  const profile = profileFor(session)
  // Reject a revoked or expired session before mutating local sync state.
  await getUser(session.token)
  let conflicts = 0
  const operations = await getPending(profile)
  const priority = (item: PendingOperation) => item.operation.kind === 'categories' ? 0 : item.operation.kind === 'catalog_books' ? 1 : 2
  operations.sort((a, b) => priority(a) - priority(b))
  for (const snapshot of operations) {
    if (snapshot.conflicted) { conflicts++; continue }
    const item = await claimPendingOperation(snapshot.key)
    if (!item) continue
    // A restored private document must exist in this account's blob storage
    // before another device receives its catalog record. Failed uploads leave
    // the operation pending, so an offline restore can retry when back online.
    await uploadRestoredFile(profile, session.token, item.operation, item.needsBlobUpload)
    item.needsBlobUpload = false
    await updatePendingOperation(item, { needsBlobUpload: false })
    const result = await pushOperation(session.token, item.operation)
    const receipt = result.receipts[0]
    if (!receipt) throw new Error('Máy chủ chưa xác nhận thao tác đồng bộ.')
    const latest = receipt.current
    if (receipt.status === 'APPLIED' && latest) {
      await acknowledgeSyncOperation(item, latest)
    } else {
      conflicts++
      // Keep the local copy and its pending marker. Pull must not overwrite it
      // with the server version before the user can review the conflict.
      await updatePendingOperation(item, { conflicted: true })
    }
  }
  let cursor = await getSyncCursor(profile)
  let count = 0
  for (let page = 0; page < 100; page++) {
    const result = await getChanges(session.token, cursor)
    const changes = result.changes.filter(change => (SYNC_KINDS as readonly string[]).includes(change.kind)).map(change => {
      const kind = change.kind as SyncKind
      const key = recordKey(profile, kind, change.id)
      return { key, profile, kind, id: change.id, version: change.version, deleted: !!change.deleted, payload: change.payload }
    })
    count += await applyRemoteChanges(profile, changes, result.cursor)
    cursor = result.cursor
    if (!result.hasMore) return { conflicts, changes: count }
  }
  throw new Error('Có quá nhiều thay đổi để tải một lần. Vui lòng đồng bộ lại.')
}

export function readableError(error: unknown, lang: Lang = getStoredLang()): string {
  if (error instanceof ApiError && error.status === 401 && !error.message.includes('mật khẩu') && !error.message.toLowerCase().includes('password')) return translate('Phiên đăng nhập đã hết hạn. Đăng nhập lại để đồng bộ.', lang)
  return localizeErrorMessage(error instanceof Error ? error.message : 'Không hoàn tất được thao tác. Vui lòng thử lại.', lang)
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
  const connectionId = crypto.randomUUID()
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
    if (!active || session.expiresAt <= Date.now() / 1000) return
    try {
      const wsUrl = `${API_BASE.replace(/^http/, 'ws')}/api/v1/sync/live?token=${encodeURIComponent(session.token)}&device=${encodeURIComponent(deviceId)}&connection=${connectionId}`
      const socket = new WebSocket(wsUrl)
      ws = socket
      socket.onopen = () => {
        if (!active || ws !== socket) return
        backoffMs = 2000
        if (pingTimer) clearInterval(pingTimer)
        pingTimer = setInterval(() => {
          if (socket.readyState === WebSocket.OPEN) {
            try { socket.send('ping') } catch {}
          }
        }, 25000)
      }
      socket.onmessage = (event) => {
        if (!active || ws !== socket) return
        try {
          const msg = JSON.parse(event.data) as { type?: string }
          if (msg.type === 'sync_required' || msg.type === 'ready') {
            onSyncRequired()
          }
        } catch {}
      }
      socket.onclose = (event) => {
        if (ws !== socket) return
        if (pingTimer) clearInterval(pingTimer)
        if (active && event.code !== 1008 && !(event.code === 1000 && event.reason === 'Replaced by a newer connection')) {
          reconnectTimer = setTimeout(connect, backoffMs)
          backoffMs = Math.min(30000, backoffMs * 1.5)
        }
      }
      socket.onerror = () => {
        try { socket.close() } catch {}
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
  const expectedLocal = await getRecord(key)
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
    await acceptRemoteConflict(item, remote, expectedLocal)
  } else {
    const refreshed = await prepareLocalConflict(item, remote)
    await uploadRestoredFile(profile, session.token, refreshed.operation, refreshed.needsBlobUpload)
    await updatePendingOperation(refreshed, { needsBlobUpload: false })
    const pushRes = await pushOperation(session.token, refreshed.operation)
    const receipt = pushRes.receipts[0]
    if (receipt && receipt.status === 'APPLIED' && receipt.current) {
      await acknowledgeSyncOperation(refreshed, receipt.current)
    } else {
      throw new Error('Chưa thể giải quyết xung đột với máy chủ. Vui lòng thử lại.')
    }
  }
}
