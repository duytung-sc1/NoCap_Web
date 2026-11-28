import type { Lang } from './i18n'
import { topicNotes } from './research'
import type { Book, SyncRecord } from './types'

export type NoteExportScope = { kind: 'book' | 'topic'; id: string }
const str = (value: unknown) => typeof value === 'string' ? value : ''

export function scopedExportNotes(records: SyncRecord[], profile: string, scope: NoteExportScope) {
  const owned = records.filter(record => record.profile === profile && !record.deleted)
  const selected = scope.kind === 'topic'
    ? topicNotes(owned, scope.id)
    : owned.filter(record => record.payload.book_id === scope.id)
  return selected.filter(record => record.kind === 'highlights' || record.kind === 'bookmarks')
}

function location(record: SyncRecord, lang: Lang) {
  const chapter = str(record.payload.chapter_title).trim()
  if (chapter) return chapter
  try {
    const locator = JSON.parse(str(record.payload.locator_json))
    const page = locator?.type === 'PDF' ? locator.pageNumber ?? (Number.isInteger(locator.pageIndex) ? locator.pageIndex + 1 : undefined) : undefined
    if (Number.isInteger(page) && page > 0) return `${lang === 'vi' ? 'Trang' : 'Page'} ${page}`
  } catch { /* Old notes can lack a valid locator. */ }
  return ''
}

const csvCell = (value: string) => `"${(/^[\s\uFEFF\u200B]*[=+\-@＝＋－＠]|^[\t\r\n]/u.test(value) ? `'${value}` : value).replace(/"/g, '""')}"`
const markdownText = (value: string) => value.replace(/[\\`*_{}[\]<>#+.!|-]/g, '\\$&')
const quoteBlock = (value: string) => markdownText(value).split(/\r?\n/).map(line => `> ${line}`).join('\n')

export function prepareScopedNoteExport(records: SyncRecord[], books: Book[], scopeName: string, format: 'md' | 'csv', lang: Lang) {
  const vi = lang === 'vi'
  const bookNames = new Map(books.map(book => [book.id, book.title]))
  const headings = vi ? ['Sách', 'Đoạn trích', 'Ghi chú', 'Vị trí'] : ['Book', 'Excerpt', 'Note', 'Location']
  const rows = records.map(record => [bookNames.get(str(record.payload.book_id)) || (vi ? 'Tài liệu không còn trong thư viện' : 'Document unavailable'), str(record.payload.text) || str(record.payload.snippet), str(record.payload.note), location(record, lang)])
  const content = format === 'csv' ? '\uFEFF' + [headings, ...rows].map(row => row.map(csvCell).join(',')).join('\r\n') + '\r\n' :
    `# ${markdownText(scopeName.replace(/\s+/g, ' '))}\n\n` + rows.map(([title, excerpt, note, source]) => [
      `## ${markdownText(title.replace(/\s+/g, ' '))}`, excerpt && quoteBlock(excerpt),
      note && `**${headings[2]}**\n\n${quoteBlock(note)}`, source && `**${headings[3]}** ${markdownText(source.replace(/\s+/g, ' '))}`,
    ].filter(Boolean).join('\n\n')).join('\n\n') + '\n'
  return { blob: new Blob([content], { type: format === 'csv' ? 'text/csv;charset=utf-8' : 'text/markdown;charset=utf-8' }), filename: `NoCap_Notes_${new Date().toISOString().slice(0, 10)}.${format}` }
}
