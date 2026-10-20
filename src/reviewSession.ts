import { nextReview, reviewIsDue, type ReviewItemPayload } from './review'
import { applyLocalMutations } from './store'
import type { SyncRecord } from './types'

export type ReviewScope = { topicId?: string; examPlanId?: string }
export type ReviewRating = 'again' | 'good' | 'skip'
export type ReviewSessionState = { scope: ReviewScope; queue: SyncRecord[]; index: number }
const noteId = (record: SyncRecord) => String(record.payload.id || record.id)
const strings = (value: unknown): string[] => Array.isArray(value) ? value.filter((item): item is string => typeof item === 'string') : []

/** A scope is a live view of the original notes, never a copied deck. */
export function reviewScopeAnnotations(records: SyncRecord[], profile: string, scope: ReviewScope = {}): SyncRecord[] {
  const live = records.filter(record => record.profile === profile && !record.deleted)
  const notes = live.filter(record => record.kind === 'highlights')
  const topicIds = new Set(live.filter(record => record.kind === 'knowledge_topics').map(noteId))
  const members = live.filter(record => record.kind === 'topic_annotations' && topicIds.has(String(record.payload.topic_id)))
  if (scope.topicId) {
    if (!topicIds.has(scope.topicId)) return []
    const ids = new Set(members.filter(record => record.payload.topic_id === scope.topicId).map(record => String(record.payload.annotation_id)))
    return notes.filter(record => ids.has(noteId(record)))
  }
  if (scope.examPlanId) {
    const plan = live.find(record => record.kind === 'exam_plans' && noteId(record) === scope.examPlanId)
    if (!plan) return []
    const selectedTopics = new Set(strings(plan.payload.topic_ids))
    const selectedBooks = new Set(strings(plan.payload.book_ids))
    const ids = new Set(members.filter(record => selectedTopics.has(String(record.payload.topic_id))).map(record => String(record.payload.annotation_id)))
    return notes.filter(record => selectedBooks.has(String(record.payload.book_id)) || ids.has(noteId(record)))
  }
  return notes
}

export function reviewableAnnotations(records: SyncRecord[], profile: string, scope: ReviewScope = {}) {
  const enabled = new Set(records.filter(record => record.profile === profile && !record.deleted && record.kind === 'review_items' && Number(record.payload.is_enabled) !== 0).map(record => String(record.payload.annotation_id)))
  return reviewScopeAnnotations(records, profile, scope).filter(note => enabled.has(noteId(note)))
}

export function latestReviewResults(records: SyncRecord[], profile: string) {
  const results = new Map<string, SyncRecord>()
  for (const record of records) {
    if (record.profile !== profile || record.deleted || record.kind !== 'review_attempts' || !['again', 'good'].includes(String(record.payload.rating))) continue
    const id = String(record.payload.annotation_id)
    const previous = results.get(id)
    if (!previous || Number(record.payload.reviewed_at) > Number(previous.payload.reviewed_at) || (record.payload.reviewed_at === previous.payload.reviewed_at && record.id > previous.id)) results.set(id, record)
  }
  return results
}

export function buildReviewQueue(records: SyncRecord[], profile: string, scope: ReviewScope = {}, now = Date.now()) {
  const due = new Set(records.filter(record => record.profile === profile && !record.deleted && record.kind === 'review_items' && reviewIsDue(record.payload as unknown as ReviewItemPayload, now)).map(record => String(record.payload.annotation_id)))
  const results = latestReviewResults(records, profile)
  const againCounts = new Map<string, number>()
  for (const record of records) if (record.profile === profile && !record.deleted && record.kind === 'review_attempts' && record.payload.rating === 'again') {
    const id = String(record.payload.annotation_id)
    againCounts.set(id, (againCounts.get(id) || 0) + 1)
  }
  const weak = (note: SyncRecord) => results.get(noteId(note))?.payload.rating === 'again'
  return reviewableAnnotations(records, profile, scope)
    .filter(note => due.has(noteId(note)) || (!!scope.examPlanId && weak(note)))
    .sort((left, right) => Number(weak(right)) - Number(weak(left)) || (weak(left) && weak(right) ? (againCounts.get(noteId(right)) || 0) - (againCounts.get(noteId(left)) || 0) : 0) || Number(left.payload.created_at) - Number(right.payload.created_at) || left.id.localeCompare(right.id))
}

/** Removing a member affects the running session without rating it or
 * changing any card's shared schedule. Refresh note content at the same time. */
export function reconcileReviewSession(session: ReviewSessionState, records: SyncRecord[], profile: string): ReviewSessionState {
  const allowed = new Map(reviewableAnnotations(records, profile, session.scope).map(record => [record.key, record]))
  return {
    scope: session.scope,
    queue: session.queue.flatMap(record => allowed.has(record.key) ? [allowed.get(record.key)!] : []),
    index: session.queue.slice(0, session.index).filter(record => allowed.has(record.key)).length,
  }
}

/** Scope checks, history and scheduling share a transaction. A simultaneous
 * removal wins cleanly: no phantom result can be recorded for the next card. */
export async function recordReviewAttempt(profile: string, record: SyncRecord, rating: ReviewRating, scope: ReviewScope = {}, localOnly = false, now = Date.now()): Promise<boolean> {
  let committed = false
  const attemptId = crypto.randomUUID()
  await applyLocalMutations(profile, records => {
    committed = false
    const current = reviewableAnnotations(records, profile, scope).find(note => note.key === record.key)
    if (!current) return []
    const review = records.find(item => item.profile === profile && item.kind === 'review_items' && !item.deleted && Number(item.payload.is_enabled) !== 0 && item.payload.annotation_id === noteId(current))
    if (!review) return []
    committed = true
    const payload = { id: attemptId, annotation_id: noteId(current), book_id: String(current.payload.book_id), review_item_id: String(review.payload.id || review.id), rating, reviewed_at: now, ...(scope.topicId ? { topic_id: scope.topicId } : {}), ...(scope.examPlanId ? { exam_plan_id: scope.examPlanId } : {}) }
    return [
      ...(rating === 'skip' ? [] : [{ kind: 'review_items' as const, id: review.id, payload: nextReview(review.payload as unknown as ReviewItemPayload, rating, now), localOnly }]),
      { kind: 'review_attempts' as const, id: attemptId, payload, localOnly },
    ]
  })
  return committed
}
