import pdfMake from 'pdfmake/build/pdfmake'
import type { Content, TDocumentDefinitions } from 'pdfmake/interfaces'
import regularUrl from './assets/pdf-fonts/BeVietnamPro-Regular.ttf?url'
import boldUrl from './assets/pdf-fonts/BeVietnamPro-Bold.ttf?url'
import italicUrl from './assets/pdf-fonts/BeVietnamPro-Italic.ttf?url'
import boldItalicUrl from './assets/pdf-fonts/BeVietnamPro-BoldItalic.ttf?url'
import { formattedPdfText } from './notesPdfFormatting'
import type { Lang } from './i18n'
import type { Book, SyncRecord } from './types'
import type { BookDownload } from './bookDownload'

const text = (value: unknown) => typeof value === 'string' ? value.normalize('NFC') : ''
let fontsReady: Promise<void> | undefined

async function fontBase64(url: string) {
  const response = await fetch(url)
  if (!response.ok) throw new Error('PDF_FONT_LOAD_FAILED')
  const bytes = new Uint8Array(await response.arrayBuffer())
  let binary = ''
  for (let start = 0; start < bytes.length; start += 8192) binary += String.fromCharCode(...bytes.subarray(start, start + 8192))
  return btoa(binary)
}

function loadFonts() {
  if (!fontsReady) fontsReady = Promise.all([fontBase64(regularUrl), fontBase64(boldUrl), fontBase64(italicUrl), fontBase64(boldItalicUrl)]).then(([regular, bold, italic, boldItalic]) => {
    pdfMake.addVirtualFileSystem({ 'BeVietnamPro-Regular.ttf': regular, 'BeVietnamPro-Bold.ttf': bold, 'BeVietnamPro-Italic.ttf': italic, 'BeVietnamPro-BoldItalic.ttf': boldItalic })
    pdfMake.addFonts({ BeVietnamPro: { normal: 'BeVietnamPro-Regular.ttf', bold: 'BeVietnamPro-Bold.ttf', italics: 'BeVietnamPro-Italic.ttf', bolditalics: 'BeVietnamPro-BoldItalic.ttf' } })
  }).catch(error => { fontsReady = undefined; throw error })
  return fontsReady
}

/** Immutable snapshot of the current account's notes; all user content is plain text. */
export function notesPdfDefinition(annotations: SyncRecord[], books: Book[], lang: Lang, date = new Date()): TDocumentDefinitions {
  const vi = lang === 'vi'
  const title = vi ? 'Trích dẫn và ghi chú' : 'Highlights and notes'
  const entries = annotations.filter(item => !item.deleted && ['highlights', 'bookmarks'].includes(item.kind))
  const grouped = new Map<string, SyncRecord[]>()
  for (const item of entries) {
    const id = text(item.payload.book_id)
    if (!grouped.has(id)) grouped.set(id, [])
    grouped.get(id)!.push(item)
  }
  const content: Content[] = [
    { text: 'NOCAP', style: 'brand' },
    { text: title, style: 'title' },
    { text: `${vi ? 'Xuất ngày' : 'Exported on'} ${date.toLocaleDateString(vi ? 'vi-VN' : 'en-US')} · ${entries.length} ${vi ? 'mục đã lưu' : 'saved entries'}`, style: 'metadata', margin: [0, 0, 0, 22] },
  ]
  for (const [id, items] of grouped) {
    const book = books.find(item => item.id === id)
    content.push({ text: text(book?.title) || (vi ? 'Tài liệu không tên' : 'Untitled document'), style: 'book', headlineLevel: 1 })
    if (book?.author) content.push({ text: `${vi ? 'Tác giả' : 'Author'}: ${text(book.author)}`, style: 'metadata', margin: [0, 0, 0, 6] })
    for (const item of items) {
      const quote = text(item.payload.text) || text(item.payload.snippet)
      const note = text(item.payload.note)
      const chapter = text(item.payload.chapter_title)
      content.push({ text: item.kind === 'bookmarks' ? (vi ? 'DẤU TRANG' : 'BOOKMARK') : (vi ? 'TRÍCH DẪN' : 'HIGHLIGHT'), style: 'label', margin: [0, 12, 0, 5] })
      if (quote) content.push({ stack: formattedPdfText(quote), style: 'quote', margin: [12, 0, 0, 8] })
      if (note) content.push({ text: `${vi ? 'Ghi chú' : 'Note'}:`, bold: true, margin: [0, 0, 0, 4] }, { stack: formattedPdfText(note), margin: [0, 0, 0, 8] })
      if (chapter) content.push({ text: `${vi ? 'Vị trí' : 'Location'}: ${chapter}`, style: 'metadata', margin: [0, 0, 0, 8] })
      content.push({ canvas: [{ type: 'line', x1: 0, y1: 0, x2: 499.28, y2: 0, lineWidth: 0.5, lineColor: '#dce4e8' }], margin: [0, 2, 0, 4] })
    }
  }
  return {
    pageSize: 'A4', pageMargins: [48, 48, 48, 50], language: vi ? 'vi-VN' : 'en-US',
    info: { title: `NoCap - ${title}`, author: 'NoCap', creator: 'NoCap Web', creationDate: date, modDate: date },
    defaultStyle: { font: 'BeVietnamPro', fontSize: 10, lineHeight: 1.3, color: '#172b3a' },
    styles: {
      brand: { fontSize: 10, bold: true, color: '#0f766e', characterSpacing: 2, margin: [0, 0, 0, 12] },
      title: { fontSize: 24, bold: true, color: '#0b172d', margin: [0, 0, 0, 12] },
      book: { fontSize: 15, bold: true, color: '#0b172d', margin: [0, 18, 0, 6] },
      label: { fontSize: 8, bold: true, color: '#0f766e' },
      quote: { color: '#334b5c' },
      metadata: { fontSize: 8, color: '#64748b' },
    },
    content,
    pageBreakBefore: (node, queries) => node.headlineLevel === 1 && queries.getFollowingNodesOnPage().length === 0,
    footer: (page, pages) => ({ columns: [
      { text: 'NoCap · Reading Memory', alignment: 'left' },
      { text: `${vi ? 'Trang' : 'Page'} ${page} / ${pages}`, alignment: 'right' },
    ], margin: [48, 15, 48, 0], fontSize: 8, color: '#64748b' }),
  }
}

/** Browser-generated, searchable PDF. Neither notes nor the PDF leave the device. */
export async function prepareNotesPdf(annotations: SyncRecord[], books: Book[], lang: Lang, date = new Date()): Promise<BookDownload> {
  const definition = notesPdfDefinition(annotations, books, lang, date)
  await loadFonts()
  const blob = await pdfMake.createPdf(definition).getBlob()
  return { blob, filename: `NoCap_Reading_Notes_${date.toISOString().slice(0, 10)}.pdf` }
}
