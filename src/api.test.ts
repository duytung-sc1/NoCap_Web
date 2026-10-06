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

  it('stops a stalled book download instead of loading forever', async () => {
    vi.useFakeTimers()
    const fetchMock = vi.fn().mockImplementation((_url: string, options: RequestInit) => new Promise((_resolve, reject) => {
      options.signal?.addEventListener('abort', () => reject(options.signal?.reason || new Error('aborted')), { once: true })
    }))
    vi.stubGlobal('fetch', fetchMock)
    const stalledBook: Book = {
      id: 'stalled-book',
      title: 'Stalled EPUB',
      author: '',
      fileUrl: `${API_BASE}/books/stalled.epub`,
      format: 'EPUB',
    }

    const result = expect(loadBookBytes(stalledBook)).rejects.toThrow('Máy chủ phản hồi quá lâu')
    await vi.advanceTimersByTimeAsync(60000)
    await result

    vi.useRealTimers()
    vi.unstubAllGlobals()
  })

  it('generates consistent uuid for catalog_books sync records matching Android', () => {
    const id = androidRecordId('catalog_books', 'web-custom-book-1')
    expect(id).toMatch(/^[0-9a-f]{8}-[0-9a-f]{4}-3[0-9a-f]{3}-[89ab][0-9a-f]{3}-[0-9a-f]{12}$/)
    expect(id).toBe(androidRecordId('catalog_books', 'web-custom-book-1'))
    expect(id).not.toBe(androidRecordId('catalog_books', 'web-custom-book-2'))
  })

  it('calls updateProfile, deleteAccount, and cloud backups endpoints with auth token', async () => {
    const { updateProfile, deleteAccount, getCloudBackups, deleteCloudBackup, loginWithGoogle } = await import('./api')
    const fetchMock = vi.fn().mockImplementation((url: string, options: RequestInit) => {
      if (url.endsWith('/api/v1/auth/google')) return Promise.resolve(new Response(JSON.stringify({ token: 'tok-g', expiresAt: 123, user: { id: 'u1', email: 'test@gmail.com', emailVerified: true } }), { status: 200 }))
      if (url.endsWith('/api/v1/me') && options.method === 'PATCH') return Promise.resolve(new Response(JSON.stringify({ id: 'u1', email: 'test@gmail.com', displayName: 'New Name', emailVerified: true }), { status: 200 }))
      if (url.endsWith('/api/v1/me') && options.method === 'DELETE') return Promise.resolve(new Response(JSON.stringify({ message: 'Deleted' }), { status: 200 }))
      if (url.endsWith('/api/v1/cloud/backups') && !options.method) return Promise.resolve(new Response(JSON.stringify({ backups: [{ id: 'snap-1', version: 1, chunks: [], size: 1024, updatedAt: '2026-10-06T00:00:00Z', deviceName: 'Web' }] }), { status: 200 }))
      if (url.includes('/api/v1/cloud/backups/snap-1') && options.method === 'DELETE') return Promise.resolve(new Response(JSON.stringify({ success: true }), { status: 200 }))
      return Promise.resolve(new Response(JSON.stringify({ error: { message: 'Not found' } }), { status: 404 }))
    })
    vi.stubGlobal('fetch', fetchMock)

    const googleSession = await loginWithGoogle('test-google-id-token')
    expect(googleSession.token).toBe('tok-g')

    const updatedUser = await updateProfile('secret-token', { displayName: 'New Name' })
    expect(updatedUser.displayName).toBe('New Name')

    const delRes = await deleteAccount('secret-token')
    expect(delRes.message).toBe('Deleted')

    const backupsRes = await getCloudBackups('secret-token')
    expect(backupsRes.backups.length).toBe(1)
    expect(backupsRes.backups[0].id).toBe('snap-1')

    const delSnapRes = await deleteCloudBackup('secret-token', 'snap-1')
    expect(delSnapRes.success).toBe(true)

    vi.unstubAllGlobals()
  })
})
