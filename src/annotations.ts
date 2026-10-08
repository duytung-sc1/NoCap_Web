import { getRecord } from './store'
import { androidRecordId, localRecords, mutate } from './sync'
import { initialReviewItem, nextReview, type ReviewItemPayload } from './review'
import type { SyncRecord } from './types'

export const highlightColors = ['YELLOW', 'GREEN', 'BLUE', 'PINK', 'PURPLE'] as const
export type HighlightColor = typeof highlightColors[number]
export const annotationId = (record: SyncRecord) => typeof record.payload.id === 'string' ? record.payload.id : record.id

async function currentAnnotation(profile: string, record: SyncRecord) {
  const current = await getRecord(record.key)
  if (!current || current.profile !== profile || current.deleted || !['highlights', 'bookmarks'].includes(current.kind)) throw new Error('Không tìm thấy ghi chú trong tài khoản này.')
  return current
}

export async function updateAnnotation(profile: string, record: SyncRecord, changes: { note: string; color: HighlightColor }, localOnly = false) {
  const current = await currentAnnotation(profile, record)
  if (current.kind !== 'highlights' || !highlightColors.includes(changes.color)) throw new Error('Ghi chú không hợp lệ.')
  await mutate(profile, current.kind, current.id, { ...current.payload, note: changes.note.trim().slice(0, 10000), color: changes.color, updated_at: Date.now() }, false, localOnly)
}

export async function deleteAnnotation(profile: string, record: SyncRecord, localOnly = false) {
  const current = await currentAnnotation(profile, record)
  // Retire linked review cards first; no orphan cards remain after deletion.
  const linked = (await localRecords(profile)).filter(item => item.kind === 'review_items' && !item.deleted && item.payload.annotation_id === annotationId(current))
  for (const item of linked) await mutate(profile, item.kind, item.id, { ...item.payload, is_enabled: 0, updated_at: Date.now() }, true, localOnly)
  await mutate(profile, current.kind, current.id, current.payload, true, localOnly)
}

/** Manually adding a card is basic Reading Memory and remains free. */
const pendingReviews = new Map<string, Promise<void>>()

export function addAnnotationReview(profile: string, record: SyncRecord, localOnly = false): Promise<void> {
  const key = JSON.stringify([profile, record.key])
  const pending = pendingReviews.get(key)
  if (pending) return pending
  const operation = createAnnotationReview(profile, record, localOnly)
  pendingReviews.set(key, operation)
  const clean = () => { pendingReviews.delete(key) }
  void operation.then(clean, clean)
  return operation
}

async function createAnnotationReview(profile: string, record: SyncRecord, localOnly: boolean) {
  const current = await currentAnnotation(profile, record)
  if (current.kind !== 'highlights') throw new Error('Ghi chú không hợp lệ.')
  const id = annotationId(current)
  const existing = (await localRecords(profile)).find(item => item.kind === 'review_items' && !item.deleted && item.payload.annotation_id === id)
  if (existing) return
  const reviewId = crypto.randomUUID()
  await mutate(profile, 'review_items', androidRecordId('review_items', reviewId), initialReviewItem(reviewId, id, String(current.payload.book_id)), false, localOnly)
}

export async function rateAnnotationReview(profile: string, record: SyncRecord, rating: 'again' | 'good', localOnly = false) {
  const current = await currentAnnotation(profile, record)
  const existing = (await localRecords(profile)).find(item => item.kind === 'review_items' && !item.deleted && item.payload.annotation_id === annotationId(current))
  if (!existing) throw new Error('Không tìm thấy thẻ ôn tập của ghi chú này.')
  await mutate(profile, 'review_items', existing.id, nextReview(existing.payload as unknown as ReviewItemPayload, rating), false, localOnly)
}
