import { describe, expect, it } from 'vitest'
import { initialReviewItem, nextReview, reviewIsDue } from './review'

describe('Android-compatible spaced repetition', () => {
  it('creates a new card due immediately', () => {
    const item = initialReviewItem('review-1', 'highlight-1', 'book-1', 1_000)
    expect(item.next_review_at).toBe(1_000)
    expect(reviewIsDue(item, 1_000)).toBe(true)
  })

  it('uses the same early Good intervals as Android', () => {
    const day = 86_400_000
    const first = nextReview(initialReviewItem('r', 'h', 'b', 0), 'good', 1_000)
    const second = nextReview(first, 'good', 2_000)
    const third = nextReview(second, 'good', 3_000)
    expect(first.next_review_at).toBe(1_000 + day)
    expect(second.next_review_at).toBe(2_000 + 3 * day)
    expect(third.next_review_at).toBe(3_000 + 7 * day)
  })

  it('resets forgotten cards to one day and lowers ease safely', () => {
    const item = { ...initialReviewItem('r', 'h', 'b', 0), review_count: 5, interval_days: 30, ease_factor: 1.35 }
    const next = nextReview(item, 'again', 5_000)
    expect(next.interval_days).toBe(1)
    expect(next.ease_factor).toBe(1.3)
  })
})
