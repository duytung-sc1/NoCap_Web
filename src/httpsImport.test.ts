import { describe, expect, it, vi } from 'vitest'
import JSZip from 'jszip'
import { downloadHttpsPublication, httpsImportMessage, publicationFile } from './httpsImport'
import { IMPORT_TIMEOUT_MS, MAX_HTML_BYTES, MAX_PUBLICATION_BYTES, publicationSource, safePublicationName, suggestedPublicationName } from '../shared/httpsPublication'

describe('publication detection and naming', () => {
  it('prefers the real signature to misleading extensions or missing MIME types', async () => {
    const pdf = await publicationFile(new Blob(['%PDF-1.7 document']), new Headers(), 'https://books.example.org/download?id=1')
    expect(pdf.name).toBe('download.pdf')
    expect(pdf.type).toBe('application/pdf')
    const png = await publicationFile(new Blob([new Uint8Array([0x89, 0x50, 0x4e, 0x47, 13, 10])]), new Headers({ 'Content-Type': 'application/pdf' }), 'https://books.example.org/wrong.pdf')
    expect(png.name).toBe('wrong.png')
    expect(png.type).toBe('image/png')
  })
  it('uses UTF-8 Content-Disposition and strips unsafe filenames', () => {
    expect(suggestedPublicationName(new Headers({ 'Content-Disposition': "attachment; filename=book.pdf; filename*=UTF-8''S%C3%A1ch%20Vi%E1%BB%87t.pdf" }), 'https://books.example.org/download')).toBe('Sách Việt.pdf')
    expect(safePublicationName('../../CON.pdf', 'pdf')).toBe('NoCap-CON.pdf')
    expect(safePublicationName('Tài liệu\u202e<>.txt', 'txt')).toBe('Tài liệu___.txt')
    expect(publicationSource('https://books.example.org/book.pdf?signature=private#page=5')).toBe('https://books.example.org/book.pdf')
  })
  it('recognizes EPUB, DOCX and CBZ archives from actual structure', async () => {
    for (const [path, format] of [['META-INF/container.xml', 'epub'], ['word/document.xml', 'docx'], ['pages/001.png', 'cbz']]) {
      const data = await new JSZip().file(path, 'fixture').generateAsync({ type: 'uint8array' })
      expect((await publicationFile(new Blob([new Uint8Array(data)]), new Headers(), 'https://books.example.org/download')).name).toBe(`download.${format}`)
    }
    const unknown = await new JSZip().file('unrelated.bin', 'fixture').generateAsync({ type: 'uint8array' })
    await expect(publicationFile(new Blob([new Uint8Array(unknown)]), new Headers(), 'https://books.example.org/wrong.epub')).rejects.toMatchObject({ code: 'UNSUPPORTED_FORMAT' })
  })
  it('rejects empty, corrupt, binary or unsupported responses', async () => {
    for (const blob of [new Blob(), new Blob(['PK-not-a-zip']), new Blob([new Uint8Array([0, 1, 2, 3])])]) {
      await expect(publicationFile(blob, new Headers({ 'Content-Type': 'application/octet-stream' }), 'https://books.example.org/fake.txt')).rejects.toBeInstanceOf(Error)
    }
    await expect(publicationFile(new Blob(['unrecognized']), new Headers(), 'https://books.example.org/fake.exe')).rejects.toMatchObject({ code: 'UNSUPPORTED_FORMAT' })
    await expect(publicationFile(new Blob([new Uint8Array(MAX_HTML_BYTES + 1)]), new Headers({ 'Content-Type': 'text/html' }), 'https://books.example.org/page')).rejects.toMatchObject({ code: 'HTML_TOO_LARGE' })
  })
})

describe('HTTPS client download', () => {
  it('downloads with progress, correct filename, no auth/cookies or HTTP cache', async () => {
    const data = '%PDF-1.7 document'
    const fetcher = vi.fn().mockResolvedValue(new Response(data, { headers: { 'Content-Length': String(data.length), 'Content-Disposition': 'attachment; filename="My book.pdf"', 'Content-Type': 'application/pdf' } }))
    const progress = vi.fn()
    vi.stubGlobal('fetch', fetcher)
    try {
      const file = await downloadHttpsPublication('https://books.example.org/download?signature=private', { onProgress: progress })
      expect(file.name).toBe('My book.pdf')
      expect(await file.text()).toBe(data)
      expect(progress).toHaveBeenLastCalledWith({ received: data.length, total: data.length })
      const [url, init] = fetcher.mock.calls[0]
      expect(url).toBe('/api/import')
      expect(init.credentials).toBe('omit')
      expect(init.cache).toBe('no-store')
      expect(new Headers(init.headers).has('Authorization')).toBe(false)
      expect(JSON.parse(init.body).url).toBe('https://books.example.org/download?signature=private')
    } finally { vi.unstubAllGlobals() }
  })
  it('rejects invalid/insecure links before contacting the server', async () => {
    const fetcher = vi.fn()
    vi.stubGlobal('fetch', fetcher)
    try {
      await expect(downloadHttpsPublication('http://books.example.org/a.pdf')).rejects.toMatchObject({ code: 'HTTPS_REQUIRED' })
      await expect(downloadHttpsPublication('broken-url')).rejects.toMatchObject({ code: 'INVALID_URL' })
      expect(fetcher).not.toHaveBeenCalled()
    } finally { vi.unstubAllGlobals() }
  })
  it('handles server errors and incomplete files without creating a publication', async () => {
    const fetcher = vi.fn().mockResolvedValueOnce(Response.json({ error: { code: 'SOURCE_UNAVAILABLE' } }, { status: 502 }))
      .mockResolvedValueOnce(new Response('%PDF-short', { headers: { 'Content-Length': '100' } }))
      .mockResolvedValueOnce(new Response('', { headers: { 'Content-Length': String(MAX_PUBLICATION_BYTES + 1) } }))
    vi.stubGlobal('fetch', fetcher)
    try {
      for (const code of ['SOURCE_UNAVAILABLE', 'SOURCE_UNAVAILABLE', 'FILE_TOO_LARGE']) await expect(downloadHttpsPublication('https://books.example.org/book.pdf')).rejects.toMatchObject({ code })
    } finally { vi.unstubAllGlobals() }
  })
  it('aborts an active download and allows a later attempt', async () => {
    const fetcher = vi.fn().mockImplementationOnce((_url, init: RequestInit) => new Promise((_resolve, reject) => init.signal?.addEventListener('abort', () => reject(init.signal?.reason), { once: true })))
      .mockResolvedValueOnce(new Response('%PDF-retry'))
    vi.stubGlobal('fetch', fetcher)
    try {
      const controller = new AbortController()
      const result = expect(downloadHttpsPublication('https://books.example.org/book.pdf', { signal: controller.signal })).rejects.toMatchObject({ name: 'AbortError' })
      controller.abort()
      await result
      expect((await downloadHttpsPublication('https://books.example.org/book.pdf')).name).toBe('book.pdf')
    } finally { vi.unstubAllGlobals() }
  })
  it('times out a stalled source and provides bilingual errors', async () => {
    vi.useFakeTimers()
    vi.stubGlobal('fetch', vi.fn((_url, init: RequestInit) => new Promise((_resolve, reject) => init.signal?.addEventListener('abort', () => reject(init.signal?.reason), { once: true }))))
    try {
      let error: unknown
      const result = downloadHttpsPublication('https://books.example.org/book.pdf').catch(failure => { error = failure })
      await vi.advanceTimersByTimeAsync(IMPORT_TIMEOUT_MS)
      await result
      expect(error).toMatchObject({ code: 'DOWNLOAD_TIMEOUT' })
      expect(httpsImportMessage(error, 'vi')).toContain('Tải quá lâu')
      expect(httpsImportMessage(error, 'en')).toContain('timed out')
    } finally { vi.unstubAllGlobals(); vi.useRealTimers() }
  })
})
