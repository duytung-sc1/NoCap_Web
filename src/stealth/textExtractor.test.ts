import { describe, expect, it } from 'vitest'
import {
  buildStealthRows,
  detectBookFormat,
  extractFromEpub,
  extractFromText,
  isBinaryData,
  PANIC_CORPORATE_ROWS,
  sanitizeSentence,
  splitIntoSentences,
} from './textExtractor'
import type { Book } from '../types'

describe('textExtractor', () => {
  it('splits long paragraph into comfortable reading sentences', () => {
    const text = 'Buổi sáng tại công ty bắt đầu như mọi ngày khác. Nam vội vã nhấp một ngụm cà phê nóng hổi trước khi mở máy tính. Anh nhìn ra ngoài khung cửa sổ tầng 18 ngắm mây trôi. Một ngày bận rộn sắp bắt đầu.'
    const result = splitIntoSentences(text)
    expect(result.length).toBeGreaterThanOrEqual(1)
    expect(result.join(' ')).toContain('Nam vội vã')
  })

  it('builds stealth rows with fake corporate IDs and categories', () => {
    const sentences = ['Câu số một.', 'Câu số hai.', 'Câu số ba.']
    const rows = buildStealthRows(sentences, 'Chiến Binh Cầu Vồng')
    expect(rows).toHaveLength(3)
    expect(rows[0].text).toBe('Câu số một.')
    expect(rows[0].id).toMatch(/^REC-/)
    expect(rows[0].category).toBeDefined()
    expect(rows[0].status).toBeDefined()
  })

  it('provides panic corporate rows for boss emergency', () => {
    expect(PANIC_CORPORATE_ROWS.length).toBeGreaterThan(5)
    expect(PANIC_CORPORATE_ROWS[0].text).toContain('Q4')
  })

  it('extracts paragraphs from text buffer', () => {
    const encoder = new TextEncoder()
    const bytes = encoder.encode('Đoạn văn thứ nhất.\n\nĐoạn văn thứ hai.').buffer
    const chunks = extractFromText(bytes, false)
    expect(chunks.length).toBe(2)
    expect(chunks[0]).toContain('Đoạn văn thứ nhất.')
  })

  it('detects binary ZIP / EPUB buffer and prevents raw text decoding', () => {
    // PK\x03\x04 zip signature
    const zipBytes = new Uint8Array([0x50, 0x4b, 0x03, 0x04, 0x00, 0x00, 0x08, 0x00]).buffer
    expect(isBinaryData(zipBytes)).toBe(true)

    // extractFromText must return empty for binary bytes to prevent mojibake
    const textChunks = extractFromText(zipBytes, false)
    expect(textChunks).toHaveLength(0)
  })

  it('sanitizes text and rejects raw binary PK signatures', () => {
    expect(sanitizeSentence('PK\x03\x04mimetypeapplication/epub+zip')).toBe('')
    expect(sanitizeSentence('Một câu văn hoàn toàn bình thường.')).toBe('Một câu văn hoàn toàn bình thường.')
  })

  it('extracts real text from EPUB zip using JSZip', async () => {
    const JSZipModule = await import('jszip')
    const JSZip = (JSZipModule.default || JSZipModule) as unknown as typeof import('jszip')
    const zip = new JSZip()
    zip.file('mimetype', 'application/epub+zip')
    zip.file('META-INF/container.xml', `<?xml version="1.0"?>
<container version="1.0" xmlns="urn:oasis:names:tc:opendocument:xmlns:container">
  <rootfiles>
    <rootfile full-path="OEBPS/content.opf" media-type="application/oebps-package+xml"/>
  </rootfiles>
</container>`)
    zip.file('OEBPS/content.opf', `<?xml version="1.0"?>
<package version="2.0">
  <manifest>
    <item id="c1" href="chap1.xhtml" media-type="application/xhtml+xml"/>
    <item id="c2" href="chap2.xhtml" media-type="application/xhtml+xml"/>
  </manifest>
  <spine>
    <itemref idref="c1"/>
    <itemref idref="c2"/>
  </spine>
</package>`)
    zip.file('OEBPS/chap1.xhtml', '<html><body><h1>Chương 1: Mở Đầu</h1><p>Văn bản truyện trích xuất sạch sẽ.</p></body></html>')
    zip.file('OEBPS/chap2.xhtml', '<html><body><p>Đoạn văn chương hai không bị lỗi binary.</p></body></html>')

    const buffer = await zip.generateAsync({ type: 'arraybuffer' })
    const extracted = await extractFromEpub(buffer)

    expect(extracted.length).toBeGreaterThanOrEqual(2)
    expect(extracted[0]).toContain('Chương 1: Mở Đầu')
    expect(extracted[1]).toContain('Văn bản truyện trích xuất sạch sẽ.')
  })

  describe('detectBookFormat', () => {
    it('detects PDF from %PDF magic bytes regardless of book title or missing format', () => {
      const pdfBytes = new Uint8Array([0x25, 0x50, 0x44, 0x46, 0x2d, 0x31, 0x2e, 0x35]).buffer
      const book: Book = {
        id: 'b1',
        title: 'Random Book Without Format',
        author: 'Author',
        coverUrl: '',
      }
      expect(detectBookFormat(book, pdfBytes)).toBe('pdf')
    })

    it('identifies EPUB correctly even when book title contains "pdf"', () => {
      const epubZipBytes = new Uint8Array([0x50, 0x4b, 0x03, 0x04, 0x00, 0x00, 0x08, 0x00]).buffer
      const trickyBook: Book = {
        id: 'b2',
        title: 'Học Lập Trình PDF và Đồ Hoạ Vector',
        author: 'Dev',
        format: 'EPUB',
        fileUrl: 'https://example.com/books/sample.epub',
        coverUrl: '',
      }
      // Must return 'epub' and NOT 'pdf'
      expect(detectBookFormat(trickyBook, epubZipBytes)).toBe('epub')
    })

    it('identifies DOCX from format metadata or extension', () => {
      const dummyBytes = new Uint8Array([0x50, 0x4b, 0x03, 0x04]).buffer
      const docxBook: Book = {
        id: 'b3',
        title: 'Báo Cáo Nghiên Cứu.docx',
        author: 'Team',
        format: 'DOCX',
        coverUrl: '',
      }
      expect(detectBookFormat(docxBook, dummyBytes)).toBe('docx')
    })

    it('identifies plain text format for utf-8 text files', () => {
      const textBytes = new TextEncoder().encode('Đây là một tập tin văn bản thuần túy.').buffer
      const txtBook: Book = {
        id: 'b4',
        title: 'Ghi chú.txt',
        author: 'Tôi',
        format: 'TXT',
        coverUrl: '',
      }
      expect(detectBookFormat(txtBook, textBytes)).toBe('text')
    })
  })
})

