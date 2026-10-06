import type { Book } from './types'

export type ReaderFormat = 'epub' | 'pdf' | 'text' | 'html' | 'docx' | 'image' | 'cbz'

const normalizedFormat = (book: Book) => String(book.format || '').trim().toLowerCase()

export function detectReaderFormat(book: Book, bytes: ArrayBuffer): ReaderFormat {
  if (bytes.byteLength >= 12) {
    const head = new Uint8Array(bytes, 0, 12)
    if (head[0] === 0x25 && head[1] === 0x50 && head[2] === 0x44 && head[3] === 0x46) return 'pdf'
    if (head[0] === 0x89 && head[1] === 0x50 && head[2] === 0x4e && head[3] === 0x47) return 'image'
    if (head[0] === 0xff && head[1] === 0xd8 && head[2] === 0xff) return 'image'
    if (String.fromCharCode(...head.slice(0, 4)) === 'RIFF' && String.fromCharCode(...head.slice(8, 12)) === 'WEBP') return 'image'
  }

  const format = normalizedFormat(book)
  if (['cbz', 'application/vnd.comicbook+zip', 'application/x-cbz', 'comic'].includes(format)) return 'cbz'
  if (['pdf', 'application/pdf'].includes(format)) return 'pdf'
  if (['docx', 'application/vnd.openxmlformats-officedocument.wordprocessingml.document'].includes(format)) return 'docx'
  if (['html', 'htm', 'xhtml', 'text/html', 'application/xhtml+xml'].includes(format)) return 'html'
  if (['txt', 'md', 'markdown', 'text', 'text/plain', 'text/markdown'].includes(format)) return 'text'
  if (['png', 'jpg', 'jpeg', 'webp', 'image', 'image/png', 'image/jpeg', 'image/webp'].includes(format)) return 'image'
  if (['epub', 'application/epub+zip'].includes(format)) return 'epub'

  const path = `${book.fileUrl || ''} ${book.title || ''}`.toLowerCase()
  if (/\.cbz(?:[?#\s]|$)/.test(path)) return 'cbz'
  if (/\.pdf(?:[?#\s]|$)/.test(path)) return 'pdf'
  if (/\.docx(?:[?#\s]|$)/.test(path)) return 'docx'
  if (/\.(?:html?|xhtml)(?:[?#\s]|$)/.test(path)) return 'html'
  if (/\.(?:txt|md|markdown)(?:[?#\s]|$)/.test(path)) return 'text'
  if (/\.(?:png|jpe?g|webp)(?:[?#\s]|$)/.test(path)) return 'image'
  return 'epub'
}
