import { describe, expect, it, vi } from 'vitest'
import { API_BASE, loadBookBytes } from './api'
import { androidRecordId } from './sync'
import type { Book } from './types'

describe('loadBookBytes routing', () => {
  it('routes gutenberg and external books to worker catalog file endpoint', async () => {
    const fetchMock = vi.fn().mockResolvedValue({
      ok: true,
      headers: new Headers({ 'Content-Length': '10' }),
      arrayBuffer: () => Promise.resolve(new ArrayBuffer(10)),
    })
    vi.stubGlobal('fetch', fetchMock)

    const gutenbergBook: Book = {
      id: 'gutenberg-1342',
      title: 'Pride and Prejudice',
      author: 'Jane Austen',
      fileUrl: 'https://www.gutenberg.org/ebooks/1342.epub.images',
    }

    await loadBookBytes(gutenbergBook)

    expect(fetchMock).toHaveBeenCalledTimes(1)
    const calledUrl = fetchMock.mock.calls[0][0]
    expect(calledUrl).toBe(`${API_BASE}/api/v1/catalog/books/gutenberg-1342/file`)

    vi.unstubAllGlobals()
  })

  it('routes private document to sync blobs endpoint with auth token', async () => {
    const hash = 'a'.repeat(64)
    const fetchMock = vi.fn().mockResolvedValue({
      ok: true,
      headers: new Headers({ 'Content-Length': '10' }),
      arrayBuffer: () => Promise.resolve(new ArrayBuffer(10)),
    })
    vi.stubGlobal('fetch', fetchMock)

    const privateBook: Book = {
      id: 'web-123',
      title: 'Private Document',
      author: 'Me',
      fileUrl: `nocap-private:${hash}`,
    }

    await loadBookBytes(privateBook, 'secret-token')

    expect(fetchMock).toHaveBeenCalledTimes(1)
    const [calledUrl, options] = fetchMock.mock.calls[0]
    expect(calledUrl).toBe(`${API_BASE}/api/v1/sync/blobs/${hash}`)
    expect(options.headers.Authorization).toBe('Bearer secret-token')

    vi.unstubAllGlobals()
  })

  it('generates consistent uuid for catalog_books sync records matching Android', () => {
    const id = androidRecordId('catalog_books', 'web-custom-book-1')
    expect(id).toMatch(/^[0-9a-f]{8}-[0-9a-f]{4}-3[0-9a-f]{3}-[89ab][0-9a-f]{3}-[0-9a-f]{12}$/)
    expect(id).toBe(androidRecordId('catalog_books', 'web-custom-book-1'))
    expect(id).not.toBe(androidRecordId('catalog_books', 'web-custom-book-2'))
  })
})
