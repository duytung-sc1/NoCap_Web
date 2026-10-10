import 'fake-indexeddb/auto'
import { beforeEach, expect, it, vi } from 'vitest'
import { loadBookBytes } from './api'
import { prepareBookDownload } from './bookDownload'
import { getFile, getOfflineBook, saveFile, saveOfflineBook } from './store'
import type { Book } from './types'

vi.mock('./api', () => ({ loadBookBytes: vi.fn() }))
const loadBytes = vi.mocked(loadBookBytes)
const bytes = (text: string) => new TextEncoder().encode(text).buffer
const book = (fields: Partial<Book> = {}): Book => ({ id: crypto.randomUUID(), title: 'Sách của tôi', author: '', format: 'EPUB', fileUrl: 'https://example.org/book.epub', ...fields })

beforeEach(() => loadBytes.mockReset())

it('downloads an imported PDF unchanged, using its original filename', async () => {
  const document = book({ source: 'local', format: 'PDF', fileUrl: undefined })
  const data = new File(['%PDF-1.7\noriginal PDF bytes'], 'Bài đọc.pdf', { type: 'application/pdf' })
  await saveFile({ key: `DEVICE_LOCAL:${document.id}`, profile: 'DEVICE_LOCAL', book: document, data, addedAt: 1 })

  // Node's structuredClone used by fake-indexeddb drops File.name; supply the sync fallback.
  const result = await prepareBookDownload(document, 'DEVICE_LOCAL', undefined, data.name)

  expect(result.filename).toBe('Bài đọc.pdf')
  expect(result.blob.type).toBe('application/pdf')
  expect(await result.blob.arrayBuffer()).toEqual(await data.arrayBuffer())
  expect(await getFile('DEVICE_LOCAL', document.id)).toBeDefined()
  expect(loadBytes).not.toHaveBeenCalled()
})

it('fetches EPUB bytes without converting them or creating an offline cache', async () => {
  const document = book()
  const source = bytes('PK\u0003\u0004 EPUB source bytes')
  loadBytes.mockResolvedValue(source)

  const result = await prepareBookDownload(document, 'DEVICE_LOCAL')

  expect(result.filename).toBe('Sách của tôi.epub')
  expect(result.blob.type).toBe('application/epub+zip')
  expect(await result.blob.arrayBuffer()).toEqual(source)
  expect(await getOfflineBook('PUBLIC_OFFLINE', document.id)).toBeUndefined()
  expect(await getFile('DEVICE_LOCAL', document.id)).toBeUndefined()
})

it('repeated downloads preserve a previously saved browser copy', async () => {
  const document = book({ format: 'TXT' })
  const data = new Blob(['Original cached text'])
  await saveOfflineBook('PUBLIC_OFFLINE', document.id, data)

  const first = await prepareBookDownload(document, 'DEVICE_LOCAL')
  const second = await prepareBookDownload(document, 'DEVICE_LOCAL')

  expect(await first.blob.text()).toBe(await second.blob.text())
  expect(await (await getOfflineBook('PUBLIC_OFFLINE', document.id))?.data.text()).toBe('Original cached text')
  expect(loadBytes).not.toHaveBeenCalled()
})

it('passes the current token for a private CBZ and uses the synced original filename', async () => {
  const document = book({ source: 'cloud', format: 'CBZ', fileUrl: 'nocap-private:blob-hash' })
  loadBytes.mockResolvedValue(bytes('PK\u0003\u0004 comic source bytes'))

  const result = await prepareBookDownload(document, 'ACCOUNT:A', 'current-token', 'Truyện tranh.cbz')

  expect(loadBytes).toHaveBeenCalledWith(document, 'current-token')
  expect(result.filename).toBe('Truyện tranh.cbz')
  expect(result.blob.type).toBe('application/vnd.comicbook+zip')
  expect(await getOfflineBook('ACCOUNT:A', document.id)).toBeUndefined()
})

it('never downloads another account’s private browser copy', async () => {
  const document = book({ source: 'cloud', fileUrl: 'nocap-private:private-hash' })
  await saveOfflineBook('ACCOUNT:A', document.id, new Blob(['private account A document']))
  loadBytes.mockRejectedValueOnce(new Error('Authentication required'))

  await expect(prepareBookDownload(document, 'ACCOUNT:B')).rejects.toThrow('Authentication required')
  expect(await (await getOfflineBook('ACCOUNT:A', document.id))?.data.text()).toBe('private account A document')
})

it('fetches the current private file when the browser holds an older content hash', async () => {
  const document = book({ source: 'cloud', format: 'TXT', fileUrl: `nocap-private:${'b'.repeat(64)}` })
  await saveFile({ key: `ACCOUNT:A:${document.id}`, profile: 'ACCOUNT:A', book: { ...document, fileUrl: `nocap-private:${'a'.repeat(64)}` }, data: new Blob(['old content']), addedAt: 1 })
  loadBytes.mockResolvedValueOnce(bytes('new content'))
  const download = await prepareBookDownload(document, 'ACCOUNT:A', 'current-token')
  expect(await download.blob.text()).toBe('new content')
  expect(loadBytes).toHaveBeenCalledWith(document, 'current-token')
})

it('retains supported file extensions instead of forcing every file to PDF', async () => {
  for (const [format, name, type] of [
    ['MD', 'Ghi chú.md', 'text/markdown'],
    ['HTM', 'Trang đọc.htm', 'text/html'],
    ['DOCX', 'Tài liệu.docx', 'application/vnd.openxmlformats-officedocument.wordprocessingml.document'],
  ]) {
    const document = book({ format })
    loadBytes.mockResolvedValue(bytes('original document content'))
    const result = await prepareBookDownload(document, 'DEVICE_LOCAL', undefined, name)
    expect(result.filename).toBe(name)
    expect(result.blob.type).toBe(type)
  }
})

it('uses the actual PDF encoding and sanitizes an unsafe filename', async () => {
  const document = book({ title: 'CON.pdf', format: 'EPUB' })
  loadBytes.mockResolvedValue(bytes('%PDF-1.7\nactual PDF'))
  expect((await prepareBookDownload(document, 'DEVICE_LOCAL')).filename).toBe('NoCap-CON.pdf')
  const result = await prepareBookDownload({ ...document, title: 'Sách: <hay>?\u202e' }, 'DEVICE_LOCAL')
  expect(result.filename).toBe('Sách_ _hay___.pdf')
})

it('matches an image’s real encoding even when its metadata says PNG', async () => {
  const document = book({ format: 'PNG', title: 'Ảnh.png' })
  loadBytes.mockResolvedValue(new Uint8Array([0xff, 0xd8, 0xff, 0xe0, 0, 1, 2, 3, 4, 5, 6, 7]).buffer)
  const result = await prepareBookDownload(document, 'DEVICE_LOCAL')
  expect(result.filename).toBe('Ảnh.jpg')
  expect(result.blob.type).toBe('image/jpeg')
})

it('reports failed and empty downloads instead of exporting a broken file', async () => {
  const document = book()
  loadBytes.mockRejectedValueOnce(new Error('Network unavailable'))
  await expect(prepareBookDownload(document, 'DEVICE_LOCAL')).rejects.toThrow('Network unavailable')
  loadBytes.mockResolvedValueOnce(new ArrayBuffer(0))
  await expect(prepareBookDownload(document, 'DEVICE_LOCAL')).rejects.toThrow('Tệp sách không có nội dung')
})
