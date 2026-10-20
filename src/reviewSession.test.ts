import 'fake-indexeddb/auto'
import { describe, expect, it } from 'vitest'
import { buildReviewQueue, latestReviewResults, reconcileReviewSession, recordReviewAttempt, reviewScopeAnnotations } from './reviewSession'
import { initialReviewItem } from './review'
import { applyLocalMutations, getPending, getRecords, saveRecord } from './store'
import type { SyncKind, SyncRecord } from './types'

function record(profile: string, kind: SyncKind, id: string, payload: Record<string, unknown>): SyncRecord {
  return { key: `${profile}:${kind}:${id}`, profile, kind, id, deleted: false, version: 0, payload: { id, ...payload } }
}
async function fixture() {
  const profile = `ACCOUNT:${crypto.randomUUID()}`
  const note = record(profile, 'highlights', 'note', { book_id: 'book-a', text: 'SQL injection', locator_json: '{"page":2}', created_at: 100 })
  const other = record(profile, 'highlights', 'other', { book_id: 'book-b', text: 'XSS', created_at: 200 })
  const review = record(profile, 'review_items', 'review', initialReviewItem('review', 'note', 'book-a', 100))
  const secondReview = record(profile, 'review_items', 'second-review', initialReviewItem('second-review', 'other', 'book-b', 100))
  const topic = record(profile, 'knowledge_topics', 'topic', { name: 'Security', created_at: 1, updated_at: 1 })
  const topic2 = record(profile, 'knowledge_topics', 'topic2', { name: 'Research', created_at: 2, updated_at: 2 })
  const member = record(profile, 'topic_annotations', 'member', { topic_id: 'topic', annotation_id: 'note', added_at: 30 })
  const sameNoteMember = record(profile, 'topic_annotations', 'member2', { topic_id: 'topic2', annotation_id: 'note', added_at: 40 })
  const otherMember = record(profile, 'topic_annotations', 'member3', { topic_id: 'topic', annotation_id: 'other', added_at: 50 })
  const plan = record(profile, 'exam_plans', 'exam', { name: 'Security exam', exam_date: '2026-12-01', topic_ids: ['topic2'], book_ids: ['book-b'], created_at: 10, updated_at: 10 })
  const records = [note, other, review, secondReview, topic, topic2, member, sameNoteMember, otherMember, plan]
  for (const value of records) await saveRecord(value)
  return { profile, records, note, other, review, member, topic }
}
describe('Live topic and exam review sessions', () => {
  it('uses one original card in multiple topics and unions exam scope without duplicate notes', async () => {
    const { profile, records } = await fixture()
    expect(buildReviewQueue(records, profile, { topicId: 'topic' }, 100).map(item => item.id)).toEqual(['note', 'other'])
    expect(buildReviewQueue(records, profile, { topicId: 'topic2' }, 100).map(item => item.id)).toEqual(['note'])
    expect(reviewScopeAnnotations(records, profile, { examPlanId: 'exam' }).map(item => item.id)).toEqual(['note', 'other'])
    expect(records.filter(item => item.kind === 'review_items' && item.payload.annotation_id === 'note')).toHaveLength(1)
  })
  it('never enrolls a topic note into Flashcards automatically', async () => {
    const { profile, records, review } = await fixture()
    expect(buildReviewQueue(records.filter(item => item.key !== review.key), profile, { topicId: 'topic2' }, 100)).toEqual([])
  })
  it('removes the current card immediately but keeps its shared card and other topic membership', async () => {
    const { profile, records, note, other, member } = await fixture()
    const changed = records.map(item => item.key === member.key ? { ...item, deleted: true } : item)
    const session = reconcileReviewSession({ scope: { topicId: 'topic' }, queue: [note, other, note], index: 0 }, changed, profile)
    expect(session.queue.map(item => item.id)).toEqual(['other'])
    expect(session.index).toBe(0)
    expect(buildReviewQueue(changed, profile, { topicId: 'topic2' }, 100).map(item => item.id)).toEqual(['note'])
  })
  it('prunes cards removed before the current index without skipping the next card', async () => {
    const { profile, records, note, other, member } = await fixture()
    const changed = records.map(item => item.key === member.key ? { ...item, deleted: true } : item)
    const session = reconcileReviewSession({ scope: { topicId: 'topic' }, queue: [note, other], index: 1 }, changed, profile)
    expect(session.queue[session.index]?.id).toBe('other')
  })
  it('ends a deleted topic session and filters deleted annotations and disabled review cards', async () => {
    const { profile, records, note, other, topic, review } = await fixture()
    expect(reconcileReviewSession({ scope: { topicId: 'topic' }, queue: [note, other], index: 0 }, records.map(item => item.key === topic.key ? { ...item, deleted: true } : item), profile).queue).toEqual([])
    expect(buildReviewQueue(records.map(item => item.key === review.key ? { ...item, payload: { ...item.payload, is_enabled: 0 } } : item), profile, {}, 100).map(item => item.id)).toEqual(['other'])
  })
  it('records skip history while leaving every scheduling field and weakness unchanged', async () => {
    const { profile, note, review } = await fixture()
    expect(await recordReviewAttempt(profile, note, 'skip', { topicId: 'topic' }, false, 500)).toBe(true)
    const records = await getRecords(profile)
    expect(records.find(item => item.key === review.key)).toEqual(review)
    expect(records.filter(item => item.kind === 'review_attempts').map(item => item.payload)).toMatchObject([{ annotation_id: 'note', rating: 'skip', reviewed_at: 500, topic_id: 'topic' }])
    expect(latestReviewResults(records, profile).size).toBe(0)
    expect((await getPending(profile)).map(item => item.operation.kind)).toEqual(['review_attempts'])
    expect(buildReviewQueue(records, profile, { topicId: 'topic2' }, 500).map(item => item.id)).toContain('note')
  })
  it('records again and shared schedule together; skip preserves weakness and good resolves it', async () => {
    const { profile, note } = await fixture()
    await recordReviewAttempt(profile, note, 'again', { examPlanId: 'exam' }, false, 500)
    await recordReviewAttempt(profile, note, 'skip', { topicId: 'topic' }, false, 600)
    let records = await getRecords(profile)
    expect(latestReviewResults(records, profile).get('note')?.payload.rating).toBe('again')
    expect(buildReviewQueue(records, profile, { topicId: 'topic2' }, 700)).toEqual([])
    expect(buildReviewQueue(records, profile, { examPlanId: 'exam' }, 700).map(item => item.id)).toContain('note')
    await recordReviewAttempt(profile, note, 'good', { topicId: 'topic2' }, false, 800)
    records = await getRecords(profile)
    expect(latestReviewResults(records, profile).get('note')?.payload.rating).toBe('good')
    expect(records.find(item => item.kind === 'review_items' && item.payload.annotation_id === 'note')?.payload.review_count).toBe(2)
    expect(buildReviewQueue(records, profile, { examPlanId: 'exam' }, 900).map(item => item.id)).not.toContain('note')
    expect((await getPending(profile)).filter(item => item.operation.kind === 'review_items')).toHaveLength(1)
  })
  it('rejects a stale rating after membership removal without logging a result', async () => {
    const { profile, note, member, review } = await fixture()
    await applyLocalMutations(profile, () => [{ kind: member.kind, id: member.id, payload: member.payload, deleted: true }])
    expect(await recordReviewAttempt(profile, note, 'again', { topicId: 'topic' })).toBe(false)
    const records = await getRecords(profile)
    expect(records.find(item => item.key === review.key)).toEqual(review)
    expect(records.some(item => item.kind === 'review_attempts')).toBe(false)
  })
  it('prioritizes repeatedly missed exam cards ahead of other weak cards; skips add no weight', async () => {
    const { profile, note, other } = await fixture()
    await recordReviewAttempt(profile, note, 'again', {}, false, 500)
    await recordReviewAttempt(profile, other, 'again', {}, false, 600)
    await recordReviewAttempt(profile, other, 'again', {}, false, 700)
    await recordReviewAttempt(profile, note, 'skip', {}, false, 800)
    expect(buildReviewQueue(await getRecords(profile), profile, { examPlanId: 'exam' }, 900).map(item => item.id)).toEqual(['other', 'note'])
  })
  it('cannot rate a note from another account or from a missing exam plan', async () => {
    const { profile, note } = await fixture()
    expect(await recordReviewAttempt(`ACCOUNT:${crypto.randomUUID()}`, note, 'good')).toBe(false)
    expect(await recordReviewAttempt(profile, note, 'good', { examPlanId: 'missing' })).toBe(false)
    expect((await getPending(profile))).toHaveLength(0)
  })
  it('keeps a local-document review local while preserving history for that browser', async () => {
    const { profile, note } = await fixture()
    await recordReviewAttempt(profile, note, 'again', {}, true, 500)
    expect((await getRecords(profile)).some(item => item.kind === 'review_attempts')).toBe(true)
    expect(await getPending(profile)).toEqual([])
  })
})
