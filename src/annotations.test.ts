import 'fake-indexeddb/auto'
import { describe, expect, it } from 'vitest'
import { addAnnotationReview, deleteAnnotation, rateAnnotationReview, updateAnnotation } from './annotations'
import { getPending, getRecords, saveRecord } from './store'
import { androidRecordId } from './sync'
import type { SyncRecord } from './types'
import type { Drawing } from './drawing'

const sampleDrawing = (): Drawing => ({ version: 1, width: 1000, height: 700, strokes: [{ color: '#243c3b', width: 3, points: [[20, 30], [40, 50]] }] })

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
  it('saves validated drawing vectors with the existing quote and sync outbox, without retaining the editor object', async () => {
    const record = await fixture()
    const drawing = sampleDrawing()
    await updateAnnotation(record.profile, record, { note: ' Illustrated note ', color: 'GREEN', drawing })
    const next = (await getRecords(record.profile))[0]
    const pending = (await getPending(record.profile))[0]
    expect(next.payload).toMatchObject({ ...record.payload, note: 'Illustrated note', color: 'GREEN', drawing })
    expect(pending.operation.payload).toEqual(next.payload)
    expect(pending.operation.baseVersion).toBe(3)
    expect(pending.operation.id).toBe(record.id)
    drawing.strokes[0].points[0][0] = 999
    drawing.strokes.push({ color: '#ffffff', width: 4, points: [[1, 2]] })
    expect((await getRecords(record.profile))[0].payload.drawing).toEqual(sampleDrawing())
    expect((await getPending(record.profile))[0].operation.payload.drawing).toEqual(sampleDrawing())
  })
  it('preserves existing drawing when omitted and removes it only on explicit null', async () => {
    const record = await fixture()
    await saveRecord({ ...record, payload: { ...record.payload, drawing: sampleDrawing() } })
    await updateAnnotation(record.profile, record, { note: 'Text edit', color: 'BLUE' })
    expect((await getRecords(record.profile))[0].payload.drawing).toEqual(sampleDrawing())
    await updateAnnotation(record.profile, record, { note: 'Text only again', color: 'BLUE', drawing: null })
    expect((await getRecords(record.profile))[0].payload).not.toHaveProperty('drawing')
    expect((await getPending(record.profile))[0].operation.payload).not.toHaveProperty('drawing')
  })
  it('keeps unsupported legacy drawings during text edits and allows removing them safely', async () => {
    const record = await fixture()
    const legacy = { version: 99, legacyData: 'Do not lose unknown data on text-only edits' }
    await saveRecord({ ...record, payload: { ...record.payload, drawing: legacy } })
    await updateAnnotation(record.profile, record, { note: 'Text edit', color: 'BLUE' })
    expect((await getRecords(record.profile))[0].payload.drawing).toEqual(legacy)
    await updateAnnotation(record.profile, record, { note: 'Text edit', color: 'BLUE', drawing: null })
    expect((await getRecords(record.profile))[0].payload).not.toHaveProperty('drawing')
  })
  it('rejects malformed drawings before changing the local record or pending operation', async () => {
    const record = await fixture()
    const invalid = [
      '<svg><script>unsafe()</script></svg>',
      { ...sampleDrawing(), version: 2 },
      { ...sampleDrawing(), width: 2000 },
      { ...sampleDrawing(), strokes: [{ color: 'url(https://unsafe.test)', width: 3, points: [[1, 2]] }] },
      { ...sampleDrawing(), strokes: [{ color: '#243c3b', width: 3, points: [[Number.NaN, 2]] }] },
    ]
    for (const drawing of invalid) {
      await expect(updateAnnotation(record.profile, record, { note: 'Must not save', color: 'BLUE', drawing: drawing as Drawing })).rejects.toThrow('Bản vẽ không hợp lệ')
    }
    expect((await getRecords(record.profile))[0]).toEqual(record)
    expect(await getPending(record.profile)).toHaveLength(0)
  })
  it('checks the complete payload size including existing quote and metadata before any local or cloud mutation', async () => {
    const record = await fixture()
    const largeRecord = { ...record, payload: { ...record.payload, text: 'a'.repeat(28000) } }
    await saveRecord(largeRecord)
    const drawing: Drawing = { ...sampleDrawing(), strokes: [{ color: '#243c3b', width: 3,
      points: Array.from({ length: 650 }, (_, i) => [i, 200] as [number, number]) }] }
    expect(JSON.stringify(drawing).length).toBeLessThan(20000)
    for (const localOnly of [false, true]) {
      await expect(updateAnnotation(record.profile, record, { note: '', color: 'BLUE', drawing }, localOnly)).rejects.toThrow('quá lớn để đồng bộ')
    }
    expect((await getRecords(record.profile))[0]).toEqual(largeRecord)
    expect(await getPending(record.profile)).toHaveLength(0)
    await saveRecord({ ...record, payload: { ...record.payload, custom_metadata: 'legacy'.repeat(6000) } })
    await expect(updateAnnotation(record.profile, record, { note: 'Small text edit', color: 'BLUE' })).rejects.toThrow('quá lớn để đồng bộ')
    expect(await getPending(record.profile)).toHaveLength(0)
  })
  it('retains the existing 10000-character note limit and account ownership rules for drawings', async () => {
    const record = await fixture()
    await expect(updateAnnotation('ACCOUNT:someone-else', record, { note: '', color: 'BLUE', drawing: sampleDrawing() })).rejects.toThrow()
    expect(await getPending('ACCOUNT:someone-else')).toHaveLength(0)
    await updateAnnotation(record.profile, record, { note: 'n'.repeat(12000), color: 'BLUE', drawing: sampleDrawing() }, true)
    expect(String((await getRecords(record.profile))[0].payload.note)).toHaveLength(10000)
    expect(await getPending(record.profile)).toHaveLength(0)
  })
  it('allows exactly 32768 payload characters and leaves the last valid outbox untouched when the next edit is too large', async () => {
    const record = await fixture()
    const payload = { ...record.payload, text: '', note: 'ok', color: 'BLUE', updated_at: Date.now() }
    payload.text = 'x'.repeat(32768 - JSON.stringify(payload).length)
    await saveRecord({ ...record, payload })
    await updateAnnotation(record.profile, record, { note: 'ok', color: 'BLUE' })
    const beforeRecord = (await getRecords(record.profile))[0]
    const beforePending = await getPending(record.profile)
    expect(JSON.stringify(beforeRecord.payload)).toHaveLength(32768)
    await expect(updateAnnotation(record.profile, record, { note: 'ok!', color: 'BLUE' })).rejects.toThrow('quá lớn để đồng bộ')
    expect((await getRecords(record.profile))[0]).toEqual(beforeRecord)
    expect(await getPending(record.profile)).toEqual(beforePending)
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
