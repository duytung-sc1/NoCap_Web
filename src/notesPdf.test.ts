import { describe, expect, it } from 'vitest'
import { notesPdfDefinition } from './notesPdf'
import type { Book, SyncRecord } from './types'

const books: Book[] = [{ id: 'vi', title: 'Những ngày yên tĩnh', author: 'Nguyễn Nhật Ánh' }]
const entry = (id: string, kind: SyncRecord['kind'], payload: Record<string, unknown>, deleted = false): SyncRecord => ({
  key: `qa:${id}`, profile: 'qa', kind, id, version: 1, deleted, payload,
})

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
})
