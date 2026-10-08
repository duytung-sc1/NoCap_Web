import { loadBookBytes } from './api'
import { detectReaderFormat } from './readerFormat'
import { getFile, getOfflineBook } from './store'
import type { Book } from './types'

const extensions = {
  epub: ['epub'], pdf: ['pdf'], docx: ['docx'], cbz: ['cbz'],
  text: ['txt', 'md', 'markdown'], html: ['html', 'htm', 'xhtml'],
  image: ['png', 'jpg', 'jpeg', 'webp'],
}
const mediaTypes: Record<string, string> = {
  epub: 'application/epub+zip', pdf: 'application/pdf', cbz: 'application/vnd.comicbook+zip',
  docx: 'application/vnd.openxmlformats-officedocument.wordprocessingml.document',
  txt: 'text/plain', md: 'text/markdown', markdown: 'text/markdown',
  html: 'text/html', htm: 'text/html', xhtml: 'application/xhtml+xml',
  png: 'image/png', jpg: 'image/jpeg', jpeg: 'image/jpeg', webp: 'image/webp',
}

function suffix(name: string) { return name.match(/\.([a-z]+)$/i)?.[1]?.toLowerCase() || '' }
function urlFilename(book: Book) {
  try { return decodeURIComponent(new URL(book.fileUrl || '').pathname.split('/').pop() || '') }
  catch { return '' }
}

function downloadName(book: Book, head: ArrayBuffer, originalFilename?: string) {
  const family = detectReaderFormat(book, head)
  const candidates = [suffix(originalFilename || ''), String(book.format || '').trim().toLowerCase(), suffix(urlFilename(book)), suffix(book.title)]
  let extension = candidates.find(candidate => extensions[family].includes(candidate)) || extensions[family][0]
  if (family === 'image') {
    const bytes = new Uint8Array(head)
    // Match the image's real encoding, including imports with incorrect metadata.
    if (bytes[0] === 0x89 && bytes[1] === 0x50 && bytes[2] === 0x4e && bytes[3] === 0x47) extension = 'png'
    else if (bytes[0] === 0xff && bytes[1] === 0xd8 && bytes[2] === 0xff) extension = extension === 'jpeg' ? 'jpeg' : 'jpg'
    else if (String.fromCharCode(...bytes.slice(0, 4)) === 'RIFF' && String.fromCharCode(...bytes.slice(8, 12)) === 'WEBP') extension = 'webp'
  }
  let stem = (originalFilename?.split(/[\\/]/).pop() || book.title || 'NoCap-document')
    .replace(/\.(epub|pdf|docx|cbz|txt|md|markdown|html|htm|xhtml|png|jpg|jpeg|webp)$/i, '')
    // eslint-disable-next-line no-control-regex -- Unsafe filename characters must be removed.
    .normalize('NFC').replace(/[<>:"/\\|?*\u0000-\u001f\u007f\u202a-\u202e\u2066-\u2069]/g, '_')
    .trim().replace(/^[. ]+|[. ]+$/g, '').slice(0, 160).replace(/[. ]+$/g, '') || 'NoCap-document'
  if (/^(con|prn|aux|nul|com[0-9]|lpt[0-9])(?:\.|$)/i.test(stem)) stem = `NoCap-${stem}`
  return { filename: `${stem}.${extension}`, type: mediaTypes[extension] }
}

export type BookDownload = { filename: string; blob: Blob }

/** Read existing bytes or fetch the source; downloading never modifies the library/cache. */
export async function prepareBookDownload(book: Book, profile: string, token?: string, originalFilename?: string): Promise<BookDownload> {
  const storageProfile = book.source === 'cloud' || book.fileUrl?.startsWith('nocap-private:') ? profile : 'PUBLIC_OFFLINE'
  const [localResult, cachedResult] = await Promise.allSettled([getFile(profile, book.id), getOfflineBook(storageProfile, book.id)])
  const local = localResult.status === 'fulfilled' ? localResult.value : undefined
  const cached = cachedResult.status === 'fulfilled' ? cachedResult.value : undefined
  const data = local?.data || cached?.data || new Blob([await loadBookBytes(book, token)])
  if (!data.size) throw new Error('Tệp sách không có nội dung.')
  const sourceName = typeof (data as File).name === 'string' ? (data as File).name : originalFilename
  const { filename, type } = downloadName(book, await data.slice(0, 12).arrayBuffer(), sourceName)
  return { filename, blob: new Blob([data], { type }) }
}

export function saveBookDownload({ filename, blob }: BookDownload) {
  const url = URL.createObjectURL(blob)
  const link = document.createElement('a')
  try {
    link.href = url
    link.download = filename
    document.body.appendChild(link)
    link.click()
  } finally {
    link.remove()
    // Allow the browser to consume the Blob before releasing its URL.
    setTimeout(() => URL.revokeObjectURL(url), 60000)
  }
}
