import { describe, expect, it, vi } from 'vitest'
import { API_BASE, loadBookBytes, createSePayOrder, getSePayOrder, getSePayPlans } from './api'
import { androidRecordId } from './sync'
import type { Book } from './types'

describe('SePay checkout API', () => {
  it('fetches server quotes and sends only the selected yearly plan, never a client price', async () => {
    const yearly = { id: 'YEARLY', amount: 352800, planDays: 365, discountPercent: 40, regularAmount: 588000, currency: 'VND' }
    const fetchMock = vi.fn().mockResolvedValueOnce(Response.json({ plans: [yearly] }))
      .mockResolvedValueOnce(Response.json({ id: 'annual-order', amount: yearly.amount, planDays: 365 }))
    vi.stubGlobal('fetch', fetchMock)
    try {
      expect((await getSePayPlans('test-token')).plans[0]).toEqual(yearly)
      expect(fetchMock.mock.calls[0][0]).toBe(`${API_BASE}/api/v1/billing/sepay/plans`)
      expect((await createSePayOrder('test-token', 'YEARLY')).amount).toBe(352800)
      expect(JSON.parse(fetchMock.mock.calls[1][1].body)).toEqual({ plan: 'YEARLY' })
      for (const [, options] of fetchMock.mock.calls) {
        expect(options.cache).toBe('no-store')
        expect(new Headers(options.headers).get('Authorization')).toBe('Bearer test-token')
      }
    } finally { vi.unstubAllGlobals() }
  })
  it('lets the backend set payment amount and bank details, with authenticated uncached requests', async () => {
    const order = { id: 'order-1', status: 'PENDING', amount: 49000, bank: { code: 'TEST' } }
    const fetchMock = vi.fn().mockResolvedValue(new Response(JSON.stringify(order)))
    vi.stubGlobal('fetch', fetchMock)
    try {
      expect(await createSePayOrder('test-token')).toEqual(order)
      const [url, options] = fetchMock.mock.calls[0]
      expect(url).toBe(`${API_BASE}/api/v1/billing/sepay/order`)
      expect(options.method).toBe('POST')
      expect(options.body).toBe('{}')
      expect(new Headers(options.headers).get('Authorization')).toBe('Bearer test-token')
      expect(options.cache).toBe('no-store')
    } finally { vi.unstubAllGlobals() }
  })

  it('reads only the requested order and preserves server errors', async () => {
    const fetchMock = vi.fn().mockResolvedValueOnce(new Response(JSON.stringify({ id: 'order/1', status: 'PAID' })))
      .mockResolvedValueOnce(new Response(JSON.stringify({ error: { message: 'SePay chưa được cấu hình' } }), { status: 503 }))
    vi.stubGlobal('fetch', fetchMock)
    try {
      expect((await getSePayOrder('test-token', 'order/1')).status).toBe('PAID')
      expect(fetchMock.mock.calls[0][0]).toBe(`${API_BASE}/api/v1/billing/sepay/orders/order%2F1`)
      expect(new Headers(fetchMock.mock.calls[0][1].headers).get('Authorization')).toBe('Bearer test-token')
      expect(fetchMock.mock.calls[0][1].cache).toBe('no-store')
      await expect(createSePayOrder('test-token')).rejects.toThrow('SePay chưa được cấu hình')
    } finally { vi.unstubAllGlobals() }
  })
})

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
    expect(options.cache).toBe('no-store')

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

    for (const [, options] of fetchMock.mock.calls) expect(options.cache).toBe('no-store')

    vi.unstubAllGlobals()
  })

  it('bypasses HTTP cache for login and account reads even when a caller requests caching', async () => {
    const { api, login, getUser } = await import('./api')
    const fetchMock = vi.fn().mockImplementation(() => Promise.resolve(Response.json({ token: 'session-token', user: { id: 'u1' } })))
    vi.stubGlobal('fetch', fetchMock)
    try {
      await login('user@example.test', 'test-password')
      await getUser('session-token')
      await api('/api/v1/me', { cache: 'force-cache' }, 'session-token')
      for (const [, options] of fetchMock.mock.calls) expect(options.cache).toBe('no-store')
      expect(fetchMock.mock.calls[0][1].headers.has('Authorization')).toBe(false)
      expect(fetchMock.mock.calls[1][1].headers.get('Authorization')).toBe('Bearer session-token')
      expect(fetchMock.mock.calls.every(([url]) => !String(url).includes('session-token'))).toBe(true)
    } finally { vi.unstubAllGlobals() }
  })
})
