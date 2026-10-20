import { annotationId } from './annotations'
import { applyLocalMutations, type LocalMutation } from './store'
import { broadcastSyncRequired } from './sync'
import type { SyncRecord } from './types'

export type ResearchRelation = 'same' | 'similar'
export type ReviewScope = { topicId?: string; examPlanId?: string }
export type ExamPlanInput = { id?: string; name: string; exam_date: string; topic_ids: string[]; book_ids: string[] }
export type RelatedAnnotation = { record: SyncRecord; relation: ResearchRelation; link: SyncRecord }
export type ExamStats = { total: number; cardCount: number; dueCount: number; weakCount: number; weakNotes: SyncRecord[]; unreviewedCount: number; reviewedCount: number; priorityNotes: SyncRecord[] }
export class ResearchError extends Error { code: string; constructor(code: string) { super(code); this.name = 'ResearchError'; this.code = code } }
const str = (value: unknown) => typeof value === 'string' ? value : ''
const stamp = (value: unknown) => typeof value === 'number' && Number.isFinite(value) ? value : 0
const live = (records: SyncRecord[], profile: string) => records.filter(record => record.profile === profile && !record.deleted)
const identity = (record: SyncRecord) => str(record.payload.id) || record.id
const find = (records: SyncRecord[], kind: SyncRecord['kind'], id: string) => records.find(record => !record.deleted && record.kind === kind && identity(record) === id)
const notes = (records: SyncRecord[]) => records.filter(record => !record.deleted && record.kind === 'highlights')

/** Memberships reference one canonical annotation; editing a note never changes its added order. */
export function topicNotes(records: SyncRecord[], topicId: string): SyncRecord[] {
  const topic = find(records, 'knowledge_topics', topicId)
  if (!topic) return []
  const owned = live(records, topic.profile), byId = new Map(notes(owned).map(note => [annotationId(note), note]))
  const seen = new Set<string>()
  return owned.filter(record => record.kind === 'topic_annotations' && record.payload.topic_id === topicId)
    .sort((a, b) => stamp(b.payload.added_at) - stamp(a.payload.added_at) || a.id.localeCompare(b.id))
    .flatMap(record => { const id = str(record.payload.annotation_id), note = byId.get(id); if (!note || seen.has(id)) return []; seen.add(id); return [note] })
}

export function relatedAnnotations(records: SyncRecord[], record: SyncRecord): RelatedAnnotation[] {
  const owned = live(records, record.profile), id = annotationId(record)
  if (!notes(owned).some(note => annotationId(note) === id)) return []
  const byId = new Map(notes(owned).map(note => [annotationId(note), note])), seen = new Set<string>()
  return owned.filter(item => item.kind === 'annotation_links' && (item.payload.left_annotation_id === id || item.payload.right_annotation_id === id))
    .sort((a, b) => stamp(b.payload.updated_at) - stamp(a.payload.updated_at))
    .flatMap(link => {
      const other = str(link.payload.left_annotation_id === id ? link.payload.right_annotation_id : link.payload.left_annotation_id)
      const note = byId.get(other), relation = link.payload.relation
      if (!note || other === id || seen.has(other) || (relation !== 'same' && relation !== 'similar')) return []
      seen.add(other); return [{ record: note, relation, link }]
    })
}

export function examNotes(records: SyncRecord[], planId: string): SyncRecord[] {
  const plan = find(records, 'exam_plans', planId)
  if (!plan) return []
  const owned = live(records, plan.profile), ids = new Set<string>(), books = new Set(Array.isArray(plan.payload.book_ids) ? plan.payload.book_ids.filter((value): value is string => typeof value === 'string') : [])
  for (const topicId of Array.isArray(plan.payload.topic_ids) ? plan.payload.topic_ids : []) {
    if (typeof topicId === 'string') for (const note of topicNotes(owned, topicId)) ids.add(annotationId(note))
  }
  return notes(owned).filter(note => ids.has(annotationId(note)) || books.has(str(note.payload.book_id)))
    .sort((a, b) => stamp(b.payload.created_at) - stamp(a.payload.created_at) || a.id.localeCompare(b.id))
}

/** Skip is a session navigation event, never evidence of weakness or successful recall. */
export function examStats(records: SyncRecord[], planId: string, now = Date.now()): ExamStats {
  const plan = find(records, 'exam_plans', planId), scoped = examNotes(records, planId)
  if (!plan) return { total: 0, cardCount: 0, dueCount: 0, weakCount: 0, weakNotes: [], unreviewedCount: 0, reviewedCount: 0, priorityNotes: [] }
  const owned = live(records, plan.profile), ids = new Set(scoped.map(annotationId))
  const cards = owned.filter(record => record.kind === 'review_items' && Number(record.payload.is_enabled) !== 0 && ids.has(str(record.payload.annotation_id)))
  const eligible = new Set(cards.map(record => str(record.payload.annotation_id)))
  const attempts = owned.filter(record => record.kind === 'review_attempts' && ids.has(str(record.payload.annotation_id)) && ['again', 'good'].includes(str(record.payload.rating)))
    .sort((a, b) => stamp(b.payload.reviewed_at) - stamp(a.payload.reviewed_at) || b.id.localeCompare(a.id))
  const latest = new Map<string, SyncRecord>(), again = new Map<string, number>(), reviewed = new Set<string>()
  for (const attempt of attempts) {
    const id = str(attempt.payload.annotation_id)
    if (!latest.has(id)) latest.set(id, attempt)
    if (attempt.payload.rating === 'again') again.set(id, (again.get(id) || 0) + 1)
    if (eligible.has(id) && stamp(attempt.payload.reviewed_at) >= stamp(plan.payload.created_at)) reviewed.add(id)
  }
  const weakNotes = scoped.filter(note => eligible.has(annotationId(note)) && latest.get(annotationId(note))?.payload.rating === 'again')
    .sort((a, b) => (again.get(annotationId(b)) || 0) - (again.get(annotationId(a)) || 0) || stamp(latest.get(annotationId(b))?.payload.reviewed_at) - stamp(latest.get(annotationId(a))?.payload.reviewed_at))
  const weakIds = new Set(weakNotes.map(annotationId)), due = new Set(cards.filter(card => stamp(card.payload.next_review_at) <= now).map(card => str(card.payload.annotation_id)))
  return { total: scoped.length, cardCount: eligible.size, dueCount: due.size, weakCount: weakNotes.length, weakNotes, reviewedCount: reviewed.size, unreviewedCount: eligible.size - reviewed.size,
    priorityNotes: [...weakNotes, ...scoped.filter(note => eligible.has(annotationId(note)) && !weakIds.has(annotationId(note)))] }
}

const containsControl = (value: string) => [...value].some(character => character.charCodeAt(0) < 32 || character.charCodeAt(0) === 127)
function cleanName(name: string) { const value = name.trim().normalize('NFC'); if (!value || value.length > 120 || containsControl(value)) throw new ResearchError('INVALID_NAME'); return value }
function required(records: SyncRecord[], kind: SyncRecord['kind'], id: string) { const record = find(records, kind, id); if (!record) throw new ResearchError('ITEM_MISSING'); return record }
function requiredNote(records: SyncRecord[], id: string) { const record = notes(records).find(note => annotationId(note) === id); if (!record) throw new ResearchError('NOTE_MISSING'); return record }
const samePair = (record: SyncRecord, left: string, right: string) => (record.payload.left_annotation_id === left && record.payload.right_annotation_id === right) || (record.payload.left_annotation_id === right && record.payload.right_annotation_id === left)
function mutation(record: SyncRecord, deleted = false, payload = record.payload): LocalMutation { return { kind: record.kind, id: record.id, payload, deleted } }
async function write(profile: string, build: (records: SyncRecord[]) => LocalMutation[], signal?: AbortSignal) {
  let changed = false
  await applyLocalMutations(profile, records => { signal?.throwIfAborted(); const result = build(live(records, profile)); changed = !!result.length; return result })
  if (changed) broadcastSyncRequired(profile)
}

export async function createTopic(profile: string, name: string, signal?: AbortSignal): Promise<string> {
  const nameValue = cleanName(name), id = crypto.randomUUID(), now = Date.now()
  await write(profile, records => {
    if (records.some(record => record.kind === 'knowledge_topics' && str(record.payload.name).trim().normalize('NFC').toLocaleLowerCase() === nameValue.toLocaleLowerCase())) throw new ResearchError('TOPIC_EXISTS')
    return [{ kind: 'knowledge_topics', id, payload: { id, name: nameValue, created_at: now, updated_at: now } }]
  }, signal)
  return id
}

export async function renameTopic(profile: string, id: string, name: string, signal?: AbortSignal) {
  const value = cleanName(name)
  await write(profile, records => {
    const topic = required(records, 'knowledge_topics', id)
    if (records.some(record => record.kind === 'knowledge_topics' && identity(record) !== id && str(record.payload.name).trim().normalize('NFC').toLocaleLowerCase() === value.toLocaleLowerCase())) throw new ResearchError('TOPIC_EXISTS')
    return [mutation(topic, false, { ...topic.payload, name: value, updated_at: Date.now() })]
  }, signal)
}

export async function deleteTopic(profile: string, id: string, signal?: AbortSignal) {
  await write(profile, records => {
    const topic = required(records, 'knowledge_topics', id)
    const memberships = records.filter(record => record.kind === 'topic_annotations' && record.payload.topic_id === id)
    const plans = records.filter(record => record.kind === 'exam_plans' && Array.isArray(record.payload.topic_ids) && record.payload.topic_ids.includes(id))
    return [...memberships.map(record => mutation(record, true)), ...plans.map(plan => mutation(plan, false, { ...plan.payload, topic_ids: (plan.payload.topic_ids as string[]).filter(topic => topic !== id), updated_at: Date.now() })), mutation(topic, true)]
  }, signal)
}

export async function addTopicAnnotations(profile: string, topicId: string, annotationIds: string[], signal?: AbortSignal) {
  const requested = [...new Set(annotationIds)]
  if (requested.length > 100) throw new ResearchError('TOO_MANY')
  await write(profile, records => {
    required(records, 'knowledge_topics', topicId)
    for (const id of requested) requiredNote(records, id)
    const existing = new Set(records.filter(record => record.kind === 'topic_annotations' && record.payload.topic_id === topicId).map(record => record.payload.annotation_id)), now = Date.now()
    return requested.filter(id => !existing.has(id)).map(annotationId => { const id = crypto.randomUUID(); return { kind: 'topic_annotations', id, payload: { id, topic_id: topicId, annotation_id: annotationId, added_at: now } } })
  }, signal)
}
export const addTopicAnnotation = (profile: string, topicId: string, annotationId: string, signal?: AbortSignal) => addTopicAnnotations(profile, topicId, [annotationId], signal)

export async function removeTopicAnnotation(profile: string, topicId: string, id: string, signal?: AbortSignal) {
  await write(profile, records => { required(records, 'knowledge_topics', topicId); return records.filter(record => record.kind === 'topic_annotations' && record.payload.topic_id === topicId && record.payload.annotation_id === id).map(record => mutation(record, true)) }, signal)
}

export async function setAnnotationLink(profile: string, left: string, right: string, relation: ResearchRelation, signal?: AbortSignal) {
  if (left === right || !['same', 'similar'].includes(relation)) throw new ResearchError('INVALID_LINK')
  await write(profile, records => {
    requiredNote(records, left); requiredNote(records, right)
    const [a, b] = [left, right].sort(), now = Date.now()
    const existing = records.filter(record => record.kind === 'annotation_links' && samePair(record, left, right))
    if (existing.length) return [mutation(existing[0], false, { ...existing[0].payload, left_annotation_id: a, right_annotation_id: b, relation, updated_at: now }), ...existing.slice(1).map(record => mutation(record, true))]
    const id = crypto.randomUUID()
    return [{ kind: 'annotation_links', id, payload: { id, left_annotation_id: a, right_annotation_id: b, relation, created_at: now, updated_at: now } }]
  }, signal)
}
export async function removeAnnotationLink(profile: string, id: string, signal?: AbortSignal) {
  await write(profile, records => {
    const selected = required(records, 'annotation_links', id)
    return records.filter(record => record.kind === 'annotation_links' && samePair(record, str(selected.payload.left_annotation_id), str(selected.payload.right_annotation_id))).map(record => mutation(record, true))
  }, signal)
}

export async function saveExamPlan(profile: string, input: ExamPlanInput, signal?: AbortSignal): Promise<string> {
  const name = cleanName(input.name), date = input.exam_date
  if (!/^\d{4}-\d{2}-\d{2}$/.test(date) || !Number.isFinite(Date.parse(`${date}T00:00:00Z`)) || new Date(`${date}T00:00:00Z`).toISOString().slice(0, 10) !== date) throw new ResearchError('INVALID_DATE')
  const topics = [...new Set(input.topic_ids)], books = [...new Set(input.book_ids)]
  if (!topics.length && !books.length) throw new ResearchError('EMPTY_SCOPE')
  if (topics.length > 100 || books.length > 100 || books.some(book => !book || book.length > 200 || containsControl(book))) throw new ResearchError('TOO_MANY')
  const id = input.id || crypto.randomUUID()
  await write(profile, records => {
    for (const topic of topics) required(records, 'knowledge_topics', topic)
    const previous = input.id ? required(records, 'exam_plans', input.id) : null, now = Date.now()
    return [{ kind: 'exam_plans', id, payload: { id, name, exam_date: date, topic_ids: topics, book_ids: books, created_at: previous?.payload.created_at ?? now, updated_at: now } }]
  }, signal)
  return id
}
export async function deleteExamPlan(profile: string, id: string, signal?: AbortSignal) { await write(profile, records => [mutation(required(records, 'exam_plans', id), true)], signal) }
