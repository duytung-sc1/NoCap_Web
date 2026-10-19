import { describe, expect, it } from 'vitest'
import { notesPdfDefinition } from './notesPdf'
import type { Book, SyncRecord } from './types'
import type { Drawing } from './drawing'

const sampleDrawing = (): Drawing => ({ version: 1, width: 1000, height: 700, strokes: [
  { color: '#243c3b', width: 3, points: [[20, 30], [40, 50]] },
  { color: '#167e70', width: 5, points: [[80, 90]] },
] })

const books: Book[] = [{ id: 'vi', title: 'Những ngày yên tĩnh', author: 'Nguyễn Nhật Ánh' }]
const entry = (id: string, kind: SyncRecord['kind'], payload: Record<string, unknown>, deleted = false): SyncRecord => ({
  key: `qa:${id}`, profile: 'qa', kind, id, version: 1, deleted, payload,
})

function drawings(content: unknown): Record<string, unknown>[] {
  if (Array.isArray(content)) return content.flatMap(drawings)
  if (!content || typeof content !== 'object') return []
  const item = content as Record<string, unknown>
  return [...(typeof item.svg === 'string' ? [item] : []), ...drawings(item.stack)]
}

describe('PDF reading-memory document', () => {
  it('groups current highlights, notes and bookmark snippets by book without changing the source', () => {
    const records = [
      entry('highlight', 'highlights', { book_id: 'vi', text: 'Tiếng Việt: ế ề ễ ể ệ, ắ ằ ẵ ẳ ặ.', note: 'Suy ngẫm riêng\nDòng thứ hai.' }),
      entry('bookmark', 'bookmarks', { book_id: 'vi', snippet: 'Đoạn văn đánh dấu.', chapter_title: 'Chương 2' }),
      entry('unknown', 'highlights', { book_id: 'missing', text: 'Vẫn giữ ghi chú khi sách không còn trong tủ.' }),
      entry('deleted', 'highlights', { book_id: 'vi', text: 'Mục đã xóa' }, true),
      entry('progress', 'reading_progress', { book_id: 'vi', text: 'Không xuất tiến độ' }),
    ]
    const before = JSON.stringify(records)
    const definition = notesPdfDefinition(records, books, 'vi', new Date('2026-10-13T01:00:00Z'))
    const serialized = JSON.stringify(definition.content)
    expect(serialized.match(/Những ngày yên tĩnh/g)).toHaveLength(1)
    for (const required of ['Nguyễn Nhật Ánh', '3 mục đã lưu', 'Tiếng Việt', 'Suy ngẫm riêng', 'Đoạn văn đánh dấu.', 'Chương 2', 'Tài liệu không tên', 'DẤU TRANG']) expect(serialized).toContain(required)
    expect(serialized).not.toContain('Mục đã xóa')
    expect(serialized).not.toContain('Không xuất tiến độ')
    expect(JSON.stringify(records)).toBe(before)
    expect(definition.defaultStyle?.font).toBe('BeVietnamPro')
    expect(definition.pageSize).toBe('A4')
  })

  it('preserves long notes, line breaks and literal markup and normalizes Vietnamese combining marks', () => {
    const long = 'Nội dung dài cần tự xuống dòng và chia trang. '.repeat(600)
    const definition = notesPdfDefinition([entry('literal', 'highlights', { book_id: 'vi', text: 'Tiếng Việt'.normalize('NFD'), note: '<script>alert("x")</script>\n' + long })], books, 'en')
    const serialized = JSON.stringify(definition.content)
    expect(serialized).toContain('Tiếng Việt')
    expect(serialized).toContain(long)
    expect(serialized).toContain('<script>')
    expect(serialized).toContain('Highlights and notes')
    expect(serialized).not.toContain('Trích dẫn và ghi chú')
    expect(definition.language).toBe('en-US')
    expect(typeof definition.footer).toBe('function')
  })

  it('exports validated editable-ink drawings as vectors alongside their quotation, note and source in either language', () => {
    const records = [entry('drawing', 'highlights', { book_id: 'vi', text: 'A quotation remains searchable.',
      note: 'An explanation.', chapter_title: 'Chapter 4', drawing: sampleDrawing() })]
    const before = JSON.stringify(records)
    for (const lang of ['vi', 'en'] as const) {
      const content = notesPdfDefinition(records, books, lang).content as unknown as Record<string, unknown>[]
      const serialized = JSON.stringify(content)
      expect(serialized).toContain(lang === 'vi' ? 'Bản vẽ:' : 'Drawing:')
      for (const required of ['A quotation remains searchable.', 'An explanation.', 'Chapter 4', 'Những ngày yên tĩnh']) expect(serialized).toContain(required)
      const vector = drawings(content)[0]
      expect(vector.fit).toEqual([499.28, 349.5])
      expect(String(vector.svg)).toContain('<svg')
      expect(String(vector.svg)).toContain('#243c3b')
      expect(String(vector.svg)).toContain('#167e70')
      expect(String(vector.svg)).toMatch(/<circle\b/)
      expect(String(vector.svg)).toMatch(/<rect\b/)
    }
    expect(JSON.stringify(records)).toBe(before)
  })

  it('includes drawing-only notes while excluding deleted drawings and non-annotation data', () => {
    const hidden = { ...sampleDrawing(), strokes: [{ color: '#2563eb', width: 3, points: [[1, 2] as [number, number]] }] }
    const records = [
      entry('drawing-only', 'highlights', { book_id: 'vi', note: '', drawing: sampleDrawing() }),
      entry('deleted-drawing', 'highlights', { book_id: 'vi', drawing: hidden }, true),
      entry('progress-drawing', 'reading_progress', { book_id: 'vi', drawing: hidden }),
    ]
    const content = notesPdfDefinition(records, books, 'en').content as unknown as Record<string, unknown>[]
    expect(drawings(content)).toHaveLength(1)
    expect(JSON.stringify(content)).toContain('1 saved entries')
    expect(JSON.stringify(content)).not.toContain('#2563eb')
  })

  it('ignores unsupported or malformed drawings, never treating payload SVG as trusted output', () => {
    const records = [
      entry('unsupported', 'highlights', { book_id: 'vi', note: 'Keep a future-version note.', drawing: { ...sampleDrawing(), version: 2 } }),
      entry('raw-svg', 'highlights', { book_id: 'vi', note: 'Keep an invalid-drawing note.', drawing: '<svg><script>unsafe()</script></svg>' }),
      entry('bad-color', 'highlights', { book_id: 'vi', drawing: { ...sampleDrawing(), strokes: [{ color: 'url(https://unsafe.test)', width: 1, points: [[1, 2]] }] } }),
      entry('empty', 'highlights', { book_id: 'vi', drawing: { ...sampleDrawing(), strokes: [] } }),
    ]
    const content = notesPdfDefinition(records, books, 'en').content as unknown as Record<string, unknown>[]
    expect(drawings(content)).toHaveLength(0)
    const serialized = JSON.stringify(content)
    expect(serialized).toContain('Keep a future-version note.')
    expect(serialized).toContain('Keep an invalid-drawing note.')
    expect(serialized).not.toContain('unsafe')
  })
})
