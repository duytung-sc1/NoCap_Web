export type ReviewItemPayload = {
  id: string
  annotation_id: string
  book_id: string
  is_enabled: number
  next_review_at: number
  last_reviewed_at: number | null
  review_count: number
  interval_days: number
  ease_factor: number
  created_at: number
  updated_at: number
}

const DAY = 24 * 60 * 60 * 1000

export function initialReviewItem(id: string, annotationId: string, bookId: string, now = Date.now()): ReviewItemPayload {
  return {
    id,
    annotation_id: annotationId,
    book_id: bookId,
    is_enabled: 1,
    next_review_at: now,
    last_reviewed_at: null,
    review_count: 0,
    interval_days: 1,
    ease_factor: 2.5,
    created_at: now,
    updated_at: now,
  }
}

export function nextReview(item: ReviewItemPayload, rating: 'again' | 'good', now = Date.now()): ReviewItemPayload {
  const count = Math.max(0, Number(item.review_count) || 0)
  const oldInterval = Math.max(1, Number(item.interval_days) || 1)
  const oldEase = Math.max(1.3, Number(item.ease_factor) || 2.5)
  const ease = rating === 'again' ? Math.max(1.3, oldEase - 0.2) : oldEase
  const interval = rating === 'again'
    ? 1
    : count === 0 ? 1
      : count === 1 ? 3
        : count === 2 ? 7
          : Math.max(14, Math.floor(oldInterval * ease))
  return {
    ...item,
    next_review_at: now + Math.min(36500, interval) * DAY,
    last_reviewed_at: now,
    review_count: count + 1,
    interval_days: Math.min(36500, interval),
    ease_factor: ease,
    updated_at: now,
  }
}

export function reviewIsDue(item: Pick<ReviewItemPayload, 'is_enabled' | 'next_review_at'>, now = Date.now()) {
  return Number(item.is_enabled) !== 0 && Number(item.next_review_at) <= now
}
