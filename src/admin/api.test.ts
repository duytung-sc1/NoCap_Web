import { afterEach, expect, it, vi } from 'vitest'
import { adminRequest } from './api'
afterEach(() => vi.unstubAllGlobals())
it('uses the current user Bearer token, no dashboard cookie and no browser cache', async () => {
  const fetch = vi.fn().mockResolvedValue(Response.json({ success: true }))
  vi.stubGlobal('fetch', fetch)
  await adminRequest('test-token', 'categories/save', undefined, { id: 'fiction', name: 'Fiction', reason: 'Maintenance' })
  const [url, init] = fetch.mock.calls[0]
  expect(url).toMatch(/\/api\/v1\/admin\/categories\/save$/)
  expect(init.headers.get('Authorization')).toBe('Bearer test-token')
  expect(init.credentials).toBe('omit')
  expect(init.cache).toBe('no-store')
  expect(init.method).toBe('POST')
})
