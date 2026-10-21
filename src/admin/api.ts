import { api } from '../api'
import type { Category } from '../types'

export type AdminIdentity = { id: string; email: string; name?: string; photoUrl: string | null; adminExpiresAt: number }
export type AdminBook = {
  id: string; title: string; author: string; description: string; categoryId: string; fileUrl: string
  coverUrl: string; language: string; isFeatured: boolean; isNew: boolean
}
export type CatalogRow = { book: AdminBook; revision: string }
export type AdminCategory = Category & { bookCount: number }
export type AdminUser = {
  id: string; email: string; displayName?: string; status: 'ACTIVE' | 'DISABLED'; isAdmin: number
  plan?: string; planStatus?: string; expiresAt?: number; purchaseSource?: string
  adminGrantStatus?: string; adminGrantExpiresAt?: number; devices: number; syncRecords: number; syncConflicts: number
  createdAt: string; lastLoginAt?: string; lastDeviceSeen?: string
}
export type Announcement = {
  id: string; title: string; message: string; type: 'info' | 'warning' | 'maintenance'
  startsAt: string | null; endsAt: string | null; active: boolean; updatedAt?: string
}
export type AuditEntry = { id: string; actor_id: string; action: string; target_id: string; reason: string; created_at: string }
export type Conflict = {
  opId: string; kind: string; recordId: string; baseVersion: number; currentVersion: number | null; reason: string
}
export type Overview = {
  books: number; categories: number; users: number; activeUsers: number
  syncRecords: number; syncConflicts: number; proSnapshots: number; playConfigured: boolean
}
export type StorageGroup = { objects: number; bytes: number }
export type StorageScan = { groups: Record<'public' | 'private' | 'other', StorageGroup>; cursor: string | null; complete: boolean; measuredAt: string }
export type PageResult<T> = { items: T[]; hasMore: boolean }
export type AdminTransactionStatus = 'PENDING' | 'PROCESSING' | 'PAID' | 'EXPIRED' | 'CANCELLED'
export type AdminTransaction = {
  id: string; paymentCode: string; amount: number; currency: 'VND'; planDays: number
  status: AdminTransactionStatus; createdAt: number; expiresAt: number
  paidAt: number | null; transactionId: string | null; entitlementExpiresAt: number | null
}
export type AdminPaymentCounts = { orders: number; paidOrders: number; paidCustomers: number; paidAmount: number }
export type AdminPaymentFilters = { from: string; to: string; status: 'ALL' | AdminTransactionStatus; plan: 'ALL' | '30' | '365' | 'OTHER'; q: string }
export type AdminPaymentRow = AdminTransaction & { userId: string; email: string; displayName: string | null; recordedAt: number }
export type AdminPaymentReport = {
  from: string; to: string; timezone: 'Asia/Ho_Chi_Minh'; generatedAt: number; currency: 'VND'
  filters: Pick<AdminPaymentFilters, 'status' | 'plan' | 'q'>
  summary: AdminPaymentCounts
  plans: (AdminPaymentCounts & { planDays: number })[]
  daily: (AdminPaymentCounts & { date: string })[]
  statuses: { status: AdminTransactionStatus; count: number }[]
  items: AdminPaymentRow[]; page: number; totalRows: number; hasMore: boolean; undatedPaidOrders: number
}
export type AdminAnalyticsDays = 1 | 7 | 30 | 90
export type AdminAnalyticsCounts = {
  visitors: number; sessions: number; pageViews: number; activeMs: number
  newVisitors: number; returningVisitors: number
}
export type AdminAcquisitionCounts = { visitors: number; sessions: number; pageViews: number; activeMs: number }
export type AdminAcquisition = {
  startedAt: number | null; coveredSessions: number; unknownSessions: number
  sources: (AdminAcquisitionCounts & { source: string; medium: string })[]
  campaigns: (AdminAcquisitionCounts & { utmSource: string; utmMedium: string; utmCampaign: string })[]
  devices: (AdminAcquisitionCounts & { device: 'desktop' | 'mobile' | 'tablet' | 'unknown' })[]
  sourcesTruncated: boolean; campaignsTruncated: boolean
}
export type AdminAnalytics = {
  enabled: boolean; trackingStartedAt: number | null; timezone: 'Asia/Ho_Chi_Minh'
  days: AdminAnalyticsDays; from: string; to: string; generatedAt: number
  summary: AdminAnalyticsCounts
  daily: (AdminAnalyticsCounts & { date: string })[]
  topPages: { page: string; pageViews: number; visitors: number; activeMs: number }[]
  events: { type: string; count: number }[]
  acquisition?: AdminAcquisition
}

// Use the logged-in reader's session, never dashboard cookies or a client-side role.
export function adminRequest<T>(token: string, path: string, signal?: AbortSignal, data?: object): Promise<T> {
  return api<T>(`/api/v1/admin/${path}`, {
    signal, credentials: 'omit', ...(data ? { method: 'POST', body: JSON.stringify(data) } : {}),
  }, token)
}

export const getAdminIdentity = (token: string, signal?: AbortSignal) => adminRequest<AdminIdentity>(token, 'me', signal)
