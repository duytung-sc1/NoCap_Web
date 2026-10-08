import 'fake-indexeddb/auto'
import { describe, expect, it } from 'vitest'
import { addAnnotationReview, deleteAnnotation, rateAnnotationReview, updateAnnotation } from './annotations'
import { getPending, getRecords, saveRecord } from './store'
import { androidRecordId } from './sync'
import type { SyncRecord } from './types'

async function fixture(profile = `ACCOUNT:${crypto.randomUUID()}`) {
  const id = crypto.randomUUID()
  const record: SyncRecord = { key: `${profile}:highlights:${id}`, profile, kind: 'highlights', id, version: 3, deleted: false, payload: { id: 'local-highlight', book_id: 'book', locator_json: '{"type":"EPUB","href":"chapter"}', text: 'Original quotation', note: 'Old note', color: 'YELLOW', created_at: 123, custom_metadata: 'preserved' } }
  await saveRecord(record)
  return record
}
describe('Reading Memory mutations', () => {
  it('edits the existing sync identity without changing its quotation, anchor or creation time', async () => {
    const record = await fixture()
    await updateAnnotation(record.profile, record, { note: ' New note ', color: 'BLUE' })
    const next = (await getRecords(record.profile))[0]
    expect(next.id).toBe(record.id)
    expect(next.payload).toMatchObject({ ...record.payload, note: 'New note', color: 'BLUE' })
    expect((await getPending(record.profile))[0].operation.baseVersion).toBe(3)
  })
  it('tombstones a highlight and its review while leaving another account intact', async () => {
    const record = await fixture()
    const other = await fixture()
    await addAnnotationReview(record.profile, record)
    await deleteAnnotation(record.profile, record)
    const records = await getRecords(record.profile)
    expect(records.filter(item => !item.deleted)).toHaveLength(0)
    expect((await getPending(record.profile)).map(item => item.operation.deleted)).toEqual([true, true])
    expect((await getRecords(other.profile))[0].deleted).toBe(false)
  })
  it('rejects edits from the wrong account', async () => {
    const record = await fixture()
    await expect(updateAnnotation('ACCOUNT:someone-else', record, { note: 'wrong', color: 'GREEN' })).rejects.toThrow()
    expect((await getRecords(record.profile))[0].payload.note).toBe('Old note')
  })
  it('adds one manual review card and preserves Android identity on repeated clicks', async () => {
    const record = await fixture()
    await addAnnotationReview(record.profile, record)
    await addAnnotationReview(record.profile, record)
    const cards = (await getRecords(record.profile)).filter(item => item.kind === 'review_items')
    expect(cards).toHaveLength(1)
    expect(cards[0].id).toBe(androidRecordId('review_items', String(cards[0].payload.id)))
    expect(cards[0].payload.annotation_id).toBe('local-highlight')
  })
  it('keeps a guest or local-only edit off the account sync queue', async () => {
    const record = await fixture()
    await updateAnnotation(record.profile, record, { note: 'local', color: 'PINK' }, true)
    expect(await getPending(record.profile)).toHaveLength(0)
  })
  it('coalesces rapid concurrent clicks into a single review card', async () => {
    const record = await fixture()
    await Promise.all(Array.from({ length: 5 }, () => addAnnotationReview(record.profile, record)))
    expect((await getRecords(record.profile)).filter(item => item.kind === 'review_items')).toHaveLength(1)
  })
  it('saves review scheduling on the existing card and cannot revive a deleted annotation', async () => {
    const record = await fixture()
    await addAnnotationReview(record.profile, record)
    const before = (await getRecords(record.profile)).find(item => item.kind === 'review_items')!
    await rateAnnotationReview(record.profile, record, 'good')
    const after = (await getRecords(record.profile)).find(item => item.kind === 'review_items')!
    expect(after.id).toBe(before.id)
    expect(Number(after.payload.next_review_at)).toBeGreaterThan(Date.now())
    await deleteAnnotation(record.profile, record)
    await expect(rateAnnotationReview(record.profile, record, 'again')).rejects.toThrow()
    expect((await getRecords(record.profile)).filter(item => !item.deleted)).toHaveLength(0)
  })
})
