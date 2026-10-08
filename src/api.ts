import type { Book, Category, Session, SyncOperation, User } from './types'

export const API_BASE = (import.meta.env.VITE_API_BASE_URL || 'https://nocap-ebook-api.buiminhhien001.workers.dev').replace(/\/$/, '')

export class ApiError extends Error {
  status: number
  constructor(status: number, message: string) { super(message); this.status = status }
}

class RequestTimeoutError extends Error {}

async function fetchWithTimeout(input: RequestInfo | URL, init: RequestInit, timeoutMs: number): Promise<Response> {
  const controller = new AbortController()
  const upstream = init.signal
  const forwardAbort = () => controller.abort(upstream?.reason)
  if (upstream?.aborted) forwardAbort()
  else upstream?.addEventListener('abort', forwardAbort, { once: true })
  const timer = globalThis.setTimeout(() => controller.abort(new RequestTimeoutError()), timeoutMs)
  try {
    return await fetch(input, { ...init, signal: controller.signal })
  } catch (error) {
    if (!upstream?.aborted && controller.signal.aborted) throw new RequestTimeoutError('Máy chủ phản hồi quá lâu. Vui lòng thử lại.')
    throw error
  } finally {
    globalThis.clearTimeout(timer)
    upstream?.removeEventListener('abort', forwardAbort)
  }
}

async function parseError(response: Response): Promise<never> {
  const result = await response.json().catch(() => null) as { error?: { message?: string } } | null
  throw new ApiError(response.status, result?.error?.message || `Máy chủ trả về lỗi ${response.status}`)
}

export async function api<T>(path: string, options: RequestInit = {}, token?: string): Promise<T> {
  const headers = new Headers(options.headers)
  if (token) headers.set('Authorization', `Bearer ${token}`)
  if (options.body && !(options.body instanceof Blob)) headers.set('Content-Type', 'application/json')
  let response: Response
  try { response = await fetchWithTimeout(`${API_BASE}${path}`, { ...options, headers, cache: 'no-store' }, 20000) }
  catch (error) {
    if (error instanceof RequestTimeoutError) throw error
    throw new Error('Không kết nối được máy chủ. Kiểm tra mạng rồi thử lại.')
  }
  if (!response.ok) return parseError(response)
  return response.json() as Promise<T>
}

export async function getCatalog() {
  return api<{ books: Book[]; categories: Category[] }>('/api/v1/catalog')
}

export async function login(email: string, password: string): Promise<Session> {
  return api('/api/v1/auth/login', { method: 'POST', body: JSON.stringify({ email, password }) })
}

export async function register(email: string, password: string): Promise<Session & { emailSent: boolean }> {
  return api('/api/v1/auth/register', { method: 'POST', body: JSON.stringify({ email, password }) })
}

export async function forgotPassword(email: string) {
  return api<{ message: string }>('/api/v1/auth/forgot-password', { method: 'POST', body: JSON.stringify({ email }) })
}

export async function loginWithGoogle(idToken: string): Promise<Session> {
  return api('/api/v1/auth/google', { method: 'POST', body: JSON.stringify({ idToken }) })
}

export async function updateProfile(token: string, patch: { displayName?: string; photoUrl?: string }): Promise<User> {
  return api('/api/v1/me', { method: 'PATCH', body: JSON.stringify(patch) }, token)
}

export async function deleteAccount(token: string): Promise<{ message: string }> {
  return api('/api/v1/me', { method: 'DELETE' }, token)
}

export type CloudBackupItem = {
  id: string
  version: number
  chunks: string[]
  size: number
  updatedAt: string
  deviceName: string
}

export async function getCloudBackups(token: string): Promise<{ backups: CloudBackupItem[] }> {
  return api('/api/v1/cloud/backups', {}, token)
}

export async function deleteCloudBackup(token: string, id: string): Promise<{ success: boolean }> {
  return api(`/api/v1/cloud/backups/${encodeURIComponent(id)}`, { method: 'DELETE' }, token)
}

export async function deleteAllCloudBackups(token: string): Promise<{ message: string }> {
  return api('/api/v1/cloud/backup', { method: 'DELETE' }, token)
}

export async function getUser(token: string) {
  return api<{ user: User }>('/api/v1/auth/user', {}, token)
}

export async function logout(token: string) {
  return api('/api/v1/auth/logout', { method: 'POST', body: '{}' }, token)
}

export type Entitlement = {
  userId?: string
  updatedAt?: number
  plan: 'FREE' | 'PRO'
  status?: string
  expiresAt?: number | null
  purchaseSource?: string | null
}

export async function getEntitlement(token: string) {
  return api<Entitlement>('/api/v1/entitlement', {}, token)
}

export type SePayOrder = {
  id: string
  status: 'PENDING' | 'PROCESSING' | 'PAID' | 'EXPIRED'
  amount: number
  currency: 'VND'
  planDays?: number
  paymentContent: string
  expiresAt: number
  paidAt?: number | null
  entitlementExpiresAt?: number | null
  bank: { code: string; name: string; accountNumber: string; accountHolder: string; vietQrBankId: string }
  qrUrl: string
}

export type SePayPlanId = 'MONTHLY' | 'YEARLY'
export type SePayPlan = {
  id: SePayPlanId; amount: number; planDays: number; currency: 'VND'
  discountPercent: number; regularAmount: number
}

export async function getSePayPlans(token: string): Promise<{ plans: SePayPlan[] }> {
  return api('/api/v1/billing/sepay/plans', {}, token)
}

export async function createSePayOrder(token: string, plan?: SePayPlanId): Promise<SePayOrder> {
  return api('/api/v1/billing/sepay/order', { method: 'POST', body: JSON.stringify(plan ? { plan } : {}) }, token)
}

export async function getSePayOrder(token: string, id: string): Promise<SePayOrder> {
  return api(`/api/v1/billing/sepay/orders/${encodeURIComponent(id)}`, {}, token)
}

export async function getChanges(token: string, cursor: number) {
  return api<{ changes: Array<{ seq: number; kind: string; id: string; version: number; deleted: number; payload: Record<string, unknown> }>; cursor: number; hasMore: boolean }>(`/api/v1/sync/changes?cursor=${cursor}&limit=100`, {}, token)
}

export async function pushOperation(token: string, operation: SyncOperation) {
  return api<{ receipts: Array<{ opId: string; status: string; current: { version: number; deleted: number; payload: Record<string, unknown> } | null }> }>('/api/v1/sync/push', { method: 'POST', body: JSON.stringify({ operations: [operation] }) }, token)
}

export async function uploadBlob(token: string, hash: string, blob: Blob): Promise<{ hash: string }> {
  let response: Response
  try {
    response = await fetchWithTimeout(`${API_BASE}/api/v1/sync/blobs/${hash}`, {
      method: 'PUT',
      headers: {
        'Authorization': `Bearer ${token}`,
        'Content-Type': 'application/octet-stream',
        'Content-Length': String(blob.size),
      },
      body: blob,
      cache: 'no-store',
    }, 120000)
  } catch (error) {
    if (error instanceof RequestTimeoutError) throw error
    throw new Error('Không kết nối được máy chủ khi tải tệp lên. Kiểm tra mạng rồi thử lại.')
  }
  if (!response.ok) return parseError(response)
  return response.json() as Promise<{ hash: string }>
}

export async function loadBookBytes(book: Book, token?: string): Promise<ArrayBuffer> {
  let url: string
  if (book.fileUrl?.startsWith('nocap-private:')) {
    if (!token) throw new Error('Đăng nhập để tải tài liệu riêng.')
    url = `${API_BASE}/api/v1/sync/blobs/${book.fileUrl.slice('nocap-private:'.length)}`
  } else if (book.source === 'local') {
    throw new Error('Tài liệu này được lưu trên trình duyệt.')
  } else if (book.fileUrl) {
    const source = new URL(book.fileUrl)
    // Sách từ Gutenberg hoặc nguồn ngoài không có CORS được tải qua endpoint của Worker.
    if (source.hostname.endsWith('gutenberg.org') || (!source.hostname.includes('workers.dev') && !book.fileUrl.startsWith(API_BASE))) {
      url = `${API_BASE}/api/v1/catalog/books/${encodeURIComponent(book.id)}/file`
    } else {
      url = book.fileUrl
    }
  } else throw new Error('Sách chưa có tệp để đọc.')
  const headers = token && book.fileUrl?.startsWith('nocap-private:') ? { Authorization: `Bearer ${token}` } : undefined
  let response: Response
  try { response = await fetchWithTimeout(url, { headers, cache: 'no-store' }, 60000) }
  catch (error) {
    if (error instanceof RequestTimeoutError) throw error
    throw new Error('Không tải được tệp sách. Kiểm tra mạng rồi thử lại.')
  }
  if (!response.ok) return parseError(response)
  const length = Number(response.headers.get('Content-Length') || 0)
  if (length > 250 * 1024 * 1024) throw new Error('Tệp quá lớn để mở trong trình duyệt.')
  const bytes = await response.arrayBuffer()
  if (bytes.byteLength > 250 * 1024 * 1024) throw new Error('Tệp quá lớn để mở trong trình duyệt.')
  return bytes
}
