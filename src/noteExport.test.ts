import { expect, it } from 'vitest'
import { prepareScopedNoteExport, scopedExportNotes } from './noteExport'
import type { SyncRecord } from './types'

const profile = 'ACCOUNT:reader'
const entry = (id: string, kind: SyncRecord['kind'], payload: SyncRecord['payload'], owner = profile): SyncRecord => ({ id, kind, profile: owner, payload, key: `${owner}:${kind}:${id}`, version: 1, deleted: false })

it('exports only the requested topic and preserves UTF-8, quotes, multiline cells and source locations', async () => {
  const records = [
    entry('t', 'knowledge_topics', { id: 't', name: 'Ôn tập ngắt quãng' }),
    entry('purchase', 'topic_annotations', { topic_id: 't', annotation_id: 'one' }),
    entry('include', 'topic_annotations', { topic_id: 't', annotation_id: 'two' }),
    entry('one', 'highlights', { id: 'one', book_id: 'a', text: 'Ôn tập, "ngắt quãng"', note: 'Dòng một\nDòng hai', locator_json: '{"type":"PDF","pageIndex":2}' }),
    entry('two', 'highlights', { id: 'two', book_id: 'b', text: 'Ảnh hưởng', note: '=1+2', chapter_title: 'Chương 1' }),
    entry('extra', 'highlights', { id: 'extra', book_id: 'c', text: 'Ngoài phạm vi' }),
    entry('foreign', 'highlights', { id: 'one', book_id: 'a', text: 'Ghi chú tài khoản khác' }, 'ACCOUNT:other'),
  ]
  const scoped = scopedExportNotes(records, profile, { kind: 'topic', id: 't' })
  expect(scoped.map(item => item.id).sort()).toEqual(['one', 'two'])
  const books = [{ id: 'a', title: 'Sách A', author: 'QA' }, { id: 'b', title: 'Sách B', author: 'QA' }]
  const csv = await prepareScopedNoteExport(scoped, books, 'Ôn tập ngắt quãng', 'csv', 'vi').blob.text()
  expect(csv).toContain('"Ôn tập, ""ngắt quãng""","Dòng một\nDòng hai","Trang 3"')
  expect(csv).toContain('"\'=1+2","Chương 1"')
  expect(csv).not.toMatch(/Ngoài phạm vi|tài khoản khác/)
  const md = await prepareScopedNoteExport(scoped, books, 'Ôn tập ngắt quãng', 'md', 'vi').blob.text()
  expect(md).toContain('# Ôn tập ngắt quãng')
  expect(md).toContain('> Dòng một\n> Dòng hai')
})
