import 'fake-indexeddb/auto'
import { afterEach, describe, expect, it, vi } from 'vitest'
import { annotationId } from './annotations'
import { getPending, getRecords, saveRecord } from './store'
import { addTopicAnnotation, addTopicAnnotations, createTopic, deleteExamPlan, deleteTopic, examNotes, examStats, relatedAnnotations, removeAnnotationLink, removeTopicAnnotation, renameTopic, saveExamPlan, setAnnotationLink, topicNotes } from './research'
import type { SyncRecord } from './types'

afterEach(() => vi.restoreAllMocks())
async function fixture() {
  const profile = `ACCOUNT:${crypto.randomUUID()}`
  const note = async (localId: string, book: string, created = 1) => {
    const id = crypto.randomUUID(), record: SyncRecord = { key: `${profile}:highlights:${id}`, id, profile, kind: 'highlights', deleted: false, version: 3, payload: { id: localId, book_id: book, text: `Quotation ${localId}`, note: `Thought ${localId}`, locator_json: '{"type":"TEXT"}', created_at: created } }
    await saveRecord(record); return record
  }
  return { profile, a: await note('local-a', 'book-a'), b: await note('local-b', 'book-b', 2), c: await note('local-c', 'book-c', 3) }
}
async function extra(profile: string, kind: SyncRecord['kind'], payload: Record<string, unknown>) {
  const id = crypto.randomUUID(), record: SyncRecord = { key: `${profile}:${kind}:${id}`, id, profile, kind, deleted: false, version: 0, payload: { id, ...payload } }
  await saveRecord(record); return record
}
const liveKind = async (profile: string, kind: SyncRecord['kind']) => (await getRecords(profile)).filter(record => record.kind === kind && !record.deleted)

describe('manual research organization', () => {
  it('creates a named empty topic and never creates notes or flashcards automatically', async () => {
    const { profile } = await fixture(), topic = await createTopic(profile, '  Economics  ')
    expect((await liveKind(profile, 'knowledge_topics'))[0].payload).toMatchObject({ id: topic, name: 'Economics' })
    expect(topicNotes(await getRecords(profile), topic)).toEqual([])
    expect(await liveKind(profile, 'highlights')).toHaveLength(3)
    expect(await liveKind(profile, 'review_items')).toHaveLength(0)
    expect((await getPending(profile))[0].operation.id).toBe(topic)
    await expect(createTopic(profile, 'ECONOMICS')).rejects.toMatchObject({ code: 'TOPIC_EXISTS' })
    await renameTopic(profile, topic, 'Macroeconomics')
    expect((await liveKind(profile, 'knowledge_topics'))[0].payload.name).toBe('Macroeconomics')
  })

  it('orders by time added to the topic rather than source creation or edit time', async () => {
    const { profile, a, b } = await fixture(), topic = await createTopic(profile, 'Topic')
    const clock = vi.spyOn(Date, 'now').mockReturnValue(100)
    await addTopicAnnotation(profile, topic, annotationId(b))
    clock.mockReturnValue(200)
    await addTopicAnnotation(profile, topic, annotationId(a))
    await saveRecord({ ...b, payload: { ...b.payload, updated_at: 9999, note: 'An edited source note' } })
    const result = topicNotes(await getRecords(profile), topic)
    expect(result.map(annotationId)).toEqual(['local-a', 'local-b'])
    expect(result[1].payload.note).toBe('An edited source note')
    expect(await liveKind(profile, 'review_items')).toHaveLength(0)
  })

  it('atomically deduplicates repeated/concurrent membership additions and uses fresh IDs after removal', async () => {
    const { profile, a } = await fixture(), topic = await createTopic(profile, 'Topic')
    await Promise.all(Array.from({ length: 5 }, () => addTopicAnnotation(profile, topic, annotationId(a))))
    const first = (await liveKind(profile, 'topic_annotations'))[0]
    expect(await liveKind(profile, 'topic_annotations')).toHaveLength(1)
    await removeTopicAnnotation(profile, topic, annotationId(a))
    expect(await liveKind(profile, 'highlights')).toHaveLength(3)
    await addTopicAnnotation(profile, topic, annotationId(a))
    const second = (await liveKind(profile, 'topic_annotations'))[0]
    expect(second.id).not.toBe(first.id)
    expect((await getRecords(profile)).find(record => record.key === first.key)?.deleted).toBe(true)
    expect(topicNotes(await getRecords(profile), topic).map(annotationId)).toEqual(['local-a'])
  })

  it('deleting a topic removes only its memberships and exam references, preserving source notes and other topics', async () => {
    const { profile, a } = await fixture(), first = await createTopic(profile, 'First'), second = await createTopic(profile, 'Second')
    await addTopicAnnotation(profile, first, annotationId(a)); await addTopicAnnotation(profile, second, annotationId(a))
    const plan = await saveExamPlan(profile, { name: 'Exam', exam_date: '2026-12-01', topic_ids: [first], book_ids: [] })
    await deleteTopic(profile, first)
    const records = await getRecords(profile)
    expect(topicNotes(records, first)).toEqual([])
    expect(topicNotes(records, second).map(annotationId)).toEqual(['local-a'])
    expect(records.find(record => record.kind === 'exam_plans' && record.id === plan)?.payload.topic_ids).toEqual([])
    expect(records.find(record => record.key === a.key)?.deleted).toBe(false)
    await expect(addTopicAnnotation(profile, first, annotationId(a))).rejects.toMatchObject({ code: 'ITEM_MISSING' })
  })

  it('validates every source before a bulk addition and isolates account ownership', async () => {
    const { profile, a } = await fixture(), topic = await createTopic(profile, 'Topic'), other = await fixture()
    await expect(addTopicAnnotations(profile, topic, [annotationId(a), 'missing'])).rejects.toMatchObject({ code: 'NOTE_MISSING' })
    expect(await liveKind(profile, 'topic_annotations')).toHaveLength(0)
    await expect(addTopicAnnotation(other.profile, topic, annotationId(other.a))).rejects.toMatchObject({ code: 'ITEM_MISSING' })
    expect(await liveKind(other.profile, 'topic_annotations')).toHaveLength(0)
  })

  it('stores one symmetric manual link, updates the relation, and never revives its tombstoned identity', async () => {
    const { profile, a, b } = await fixture()
    await Promise.all([setAnnotationLink(profile, annotationId(a), annotationId(b), 'similar'), setAnnotationLink(profile, annotationId(b), annotationId(a), 'same')])
    let records = await getRecords(profile)
    const first = (await liveKind(profile, 'annotation_links'))[0]
    expect(await liveKind(profile, 'annotation_links')).toHaveLength(1)
    expect(relatedAnnotations(records, a)[0]).toMatchObject({ record: b, relation: 'same' })
    expect(relatedAnnotations(records, b)[0].record.key).toBe(a.key)
    await removeAnnotationLink(profile, first.id)
    await setAnnotationLink(profile, annotationId(a), annotationId(b), 'similar')
    records = await getRecords(profile)
    expect(records.find(record => record.id === first.id)?.deleted).toBe(true)
    expect((await liveKind(profile, 'annotation_links'))[0].id).not.toBe(first.id)
    await expect(setAnnotationLink(profile, annotationId(a), annotationId(a), 'same')).rejects.toMatchObject({ code: 'INVALID_LINK' })
    await saveRecord({ ...b, deleted: true })
    expect(relatedAnnotations(await getRecords(profile), a)).toHaveLength(0)
  })

  it('selects exactly the manually chosen exam topics and books, deduplicating overlapping notes', async () => {
    const { profile, a, b, c } = await fixture(), topic = await createTopic(profile, 'Topic')
    await addTopicAnnotations(profile, topic, [annotationId(a), annotationId(b)])
    const plan = await saveExamPlan(profile, { name: 'Biology midterm', exam_date: '2026-12-01', topic_ids: [topic, topic], book_ids: ['book-b'] })
    expect(examNotes(await getRecords(profile), plan).map(annotationId)).toEqual(['local-b', 'local-a'])
    expect(examNotes(await getRecords(profile), plan).some(note => note.key === c.key)).toBe(false)
    expect(await liveKind(profile, 'review_items')).toHaveLength(0)
    await saveExamPlan(profile, { id: plan, name: 'Other scope', exam_date: '2026-12-03', topic_ids: [], book_ids: ['book-c'] })
    expect(examNotes(await getRecords(profile), plan).map(annotationId)).toEqual(['local-c'])
    await deleteExamPlan(profile, plan)
    expect(await liveKind(profile, 'knowledge_topics')).toHaveLength(1)
    expect(await liveKind(profile, 'highlights')).toHaveLength(3)
  })

  it('removes every duplicate symmetric link and membership received from offline devices', async () => {
    const { profile, a, b } = await fixture(), topic = await createTopic(profile, 'Topic')
    await addTopicAnnotation(profile, topic, annotationId(a))
    await extra(profile, 'topic_annotations', { topic_id: topic, annotation_id: annotationId(a), added_at: 900 })
    expect(topicNotes(await getRecords(profile), topic)).toHaveLength(1)
    await removeTopicAnnotation(profile, topic, annotationId(a))
    expect(await liveKind(profile, 'topic_annotations')).toHaveLength(0)
    await setAnnotationLink(profile, annotationId(a), annotationId(b), 'similar')
    await extra(profile, 'annotation_links', { left_annotation_id: annotationId(b), right_annotation_id: annotationId(a), relation: 'same', created_at: 800, updated_at: 900 })
    const visible = relatedAnnotations(await getRecords(profile), a)
    expect(visible).toHaveLength(1)
    await removeAnnotationLink(profile, visible[0].link.id)
    expect(await liveKind(profile, 'annotation_links')).toHaveLength(0)
    expect(relatedAnnotations(await getRecords(profile), a)).toHaveLength(0)
    expect(await liveKind(profile, 'highlights')).toHaveLength(3)
  })

  it('uses latest meaningful recall, not skips, for weakness and unique eligible-card progress', async () => {
    const { profile, a, b } = await fixture()
    vi.spyOn(Date, 'now').mockReturnValue(1000)
    const plan = await saveExamPlan(profile, { name: 'Exam', exam_date: '2026-12-01', topic_ids: [], book_ids: ['book-a', 'book-b', 'book-c'] })
    await extra(profile, 'review_items', { annotation_id: annotationId(a), is_enabled: 1, next_review_at: 2000 })
    await extra(profile, 'review_items', { annotation_id: annotationId(b), is_enabled: 1, next_review_at: 9000 })
    await extra(profile, 'review_attempts', { annotation_id: annotationId(a), book_id: 'book-a', rating: 'again', reviewed_at: 1100 })
    await extra(profile, 'review_attempts', { annotation_id: annotationId(a), book_id: 'book-a', rating: 'skip', reviewed_at: 1200 })
    let stats = examStats(await getRecords(profile), plan, 3000)
    expect(stats).toMatchObject({ total: 3, cardCount: 2, dueCount: 1, weakCount: 1, reviewedCount: 1, unreviewedCount: 1 })
    expect(stats.weakNotes.map(annotationId)).toEqual(['local-a'])
    await extra(profile, 'review_attempts', { annotation_id: annotationId(a), book_id: 'book-a', rating: 'good', reviewed_at: 1300 })
    await extra(profile, 'review_attempts', { annotation_id: annotationId(b), book_id: 'book-b', rating: 'skip', reviewed_at: 1400 })
    stats = examStats(await getRecords(profile), plan, 3000)
    expect(stats.weakCount).toBe(0)
    expect(stats.reviewedCount).toBe(1)
    const bCard = (await liveKind(profile, 'review_items')).find(record => record.payload.annotation_id === annotationId(b))!
    await saveRecord({ ...bCard, payload: { ...bCard.payload, is_enabled: 0 } })
    expect(examStats(await getRecords(profile), plan, 3000)).toMatchObject({ cardCount: 1, reviewedCount: 1, unreviewedCount: 0 })
  })

  it('excludes deleted sources and other profiles even when canonical annotation IDs match', async () => {
    const { profile, a } = await fixture(), other = await fixture(), topic = await createTopic(profile, 'Topic')
    await addTopicAnnotation(profile, topic, annotationId(a))
    const mixed = [...await getRecords(profile), ...await getRecords(other.profile)]
    expect(topicNotes(mixed, topic)[0].profile).toBe(profile)
    await saveRecord({ ...a, deleted: true })
    expect(topicNotes(await getRecords(profile), topic)).toEqual([])
  })

  it('rejects invalid names, calendar dates and empty scopes, and checks cancellation before any atomic write', async () => {
    const { profile } = await fixture()
    await expect(createTopic(profile, ' ')).rejects.toMatchObject({ code: 'INVALID_NAME' })
    await expect(createTopic(profile, 'Name\u007f')).rejects.toMatchObject({ code: 'INVALID_NAME' })
    await expect(saveExamPlan(profile, { name: 'Exam', exam_date: '2026-02-30', topic_ids: [], book_ids: ['book-a'] })).rejects.toMatchObject({ code: 'INVALID_DATE' })
    await expect(saveExamPlan(profile, { name: 'Exam', exam_date: '2026-02-28', topic_ids: [], book_ids: [] })).rejects.toMatchObject({ code: 'EMPTY_SCOPE' })
    await expect(saveExamPlan(profile, { name: 'Exam', exam_date: '2026-02-28', topic_ids: [], book_ids: ['b'.repeat(201)] })).rejects.toMatchObject({ code: 'TOO_MANY' })
    const controller = new AbortController(); controller.abort()
    await expect(createTopic(profile, 'Should not exist', controller.signal)).rejects.toMatchObject({ name: 'AbortError' })
    expect(await liveKind(profile, 'knowledge_topics')).toHaveLength(0)
    expect(await getPending(profile)).toHaveLength(0)
  })
})
