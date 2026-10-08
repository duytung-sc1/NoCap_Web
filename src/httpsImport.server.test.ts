import { describe, expect, it, vi } from 'vitest'
import { handleHttpsImport, isPublicAddress } from '../server/httpsImport'
import { IMPORT_TIMEOUT_MS, MAX_PUBLICATION_BYTES } from '../shared/httpsPublication'

const origin = 'https://nocap.example.org'
const request = (url = 'https://books.example.org/book.pdf', extra: Record<string, string> = {}) => new Request(`${origin}/api/import`, {
  method: 'POST', headers: { 'Content-Type': 'application/json', Origin: origin, ...extra }, body: JSON.stringify({ url }),
})
const dns = (type: string, address?: string) => Response.json({ Status: 0, Answer: type === 'A' || address ? [{ type: type === 'A' ? 1 : 28, data: address || '93.184.215.14' }] : [] })
function mockNetwork(remote: (url: string, init: RequestInit) => Response | Promise<Response>, addresses: { A?: string; AAAA?: string } = {}) {
  return vi.fn(async (input: RequestInfo | URL, init: RequestInit = {}) => {
    const url = String(input)
    if (url.startsWith('https://cloudflare-dns.com/dns-query?')) {
      const type = new URL(url).searchParams.get('type')!
      return dns(type, addresses[type as 'A' | 'AAAA'])
    }
    return remote(url, init)
  })
}

describe('public HTTPS download endpoint', () => {
  it('rejects malformed/insecure/internal destinations before making requests', async () => {
    for (const url of ['not-a-url', 'http://books.example.org/a.pdf', 'https://localhost/a.pdf', 'https://127.1/a.pdf', 'https://0x7f000001/a.pdf', 'https://[::1]/a.pdf', 'https://files.local/a.pdf', 'https://user:password@books.example.org/a.pdf', 'https://books.example.org:8443/a.pdf']) {
      const fetcher = vi.fn()
      const response = await handleHttpsImport(request(url), fetcher)
      expect(response.status).toBe(400)
      expect(fetcher).not.toHaveBeenCalled()
      expect(response.headers.get('Cache-Control')).toContain('no-store')
    }
  })
  it('requires a same-origin POST and bounded JSON body', async () => {
    const fetcher = vi.fn()
    expect((await handleHttpsImport(new Request(`${origin}/api/import`), fetcher)).status).toBe(405)
    expect((await handleHttpsImport(request(undefined, { Origin: 'https://other.example.org' }), fetcher)).status).toBe(403)
    const large = new Request(`${origin}/api/import`, { method: 'POST', headers: { Origin: origin, 'Content-Type': 'application/json' }, body: 'a'.repeat(16_385) })
    expect((await handleHttpsImport(large, fetcher)).status).toBe(413)
    expect(fetcher).not.toHaveBeenCalled()
  })
  it('checks both DNS families and rejects private/reserved destinations', async () => {
    for (const addresses of [{ A: '10.0.0.1' }, { A: '169.254.169.254' }, { A: '192.168.0.1' }, { AAAA: 'fd00::1' }, { AAAA: '::ffff:127.0.0.1' }]) {
      const remote = vi.fn(() => new Response('private'))
      const response = await handleHttpsImport(request(), mockNetwork(remote, addresses))
      expect(response.status).toBe(400)
      expect((await response.json()).error.code).toBe('PUBLIC_URL_REQUIRED')
      expect(remote).not.toHaveBeenCalled()
    }
    for (const address of ['0.0.0.0', '100.64.0.1', '127.0.0.1', '172.16.4.3', '198.19.0.1', '192.0.2.1', '198.51.100.1', '203.0.113.1', '224.0.0.1', '::1', 'fe80::1', '2001:0db8::1', '2002:7f00:1::', '2abc:xyz']) expect(isPublicAddress(address)).toBe(false)
    for (const address of ['1.1.1.1', '8.8.8.8', '93.184.215.14', '2606:4700:4700::1111', '2001:4860:4860::8888']) expect(isPublicAddress(address)).toBe(true)
  })
  it('uses Worker-compatible manual redirects and never follows a DNS resolver redirect', async () => {
    const warning = vi.spyOn(console, 'warn').mockImplementation(() => {})
    try {
      const fetcher = vi.fn(async (_input: RequestInfo | URL, init?: RequestInit) => {
        expect(init?.redirect).toBe('manual')
        return new Response(null, { status: 302, headers: { Location: 'https://other.example.org/dns-query' } })
      })
      const response = await handleHttpsImport(request(), fetcher)
      expect(response.status).toBe(502)
      expect((await response.json()).error.code).toBe('SOURCE_UNAVAILABLE')
      expect(fetcher.mock.calls.every(([url]) => String(url).startsWith('https://cloudflare-dns.com/dns-query?'))).toBe(true)
    } finally { warning.mockRestore() }
  })
  it('follows validated HTTPS redirects without forwarding any user credentials', async () => {
    const remote = vi.fn((url: string) => url.endsWith('/book.pdf') ? new Response(null, { status: 302, headers: { Location: 'https://cdn.example.org/download?id=42' } }) : new Response('%PDF-1.7 test', { headers: { 'Content-Type': 'application/pdf', 'Content-Disposition': 'attachment; filename="document.pdf"' } }))
    const fetcher = mockNetwork(remote)
    const response = await handleHttpsImport(request(undefined, { Authorization: 'Bearer private', Cookie: 'secret=private', Referer: 'https://private.example.org' }), fetcher)
    expect(await response.text()).toBe('%PDF-1.7 test')
    expect(response.headers.get('content-disposition')).toContain('document.pdf')
    expect(response.headers.get('content-disposition')).toMatch(/^attachment/)
    expect(response.headers.get('Content-Security-Policy')).toContain('sandbox')
    expect(decodeURIComponent(response.headers.get('X-NoCap-Source')!)).toBe('https://cdn.example.org/download?id=42')
    for (const [, init] of fetcher.mock.calls) {
      const headers = new Headers(init?.headers)
      expect(headers.has('Authorization')).toBe(false)
      expect(headers.has('Cookie')).toBe(false)
      expect(headers.has('Referer')).toBe(false)
    }
    expect(fetcher.mock.calls.every(([, init]) => init?.redirect === 'manual')).toBe(true)
  })
  it('rejects downgrade, private redirects and redirect loops', async () => {
    for (const target of ['http://books.example.org/a.pdf', 'https://127.0.0.1/a.pdf']) {
      const remote = vi.fn(() => new Response(null, { status: 302, headers: { Location: target } }))
      expect((await handleHttpsImport(request(), mockNetwork(remote))).status).toBe(400)
      expect(remote).toHaveBeenCalledTimes(1)
    }
    const remote = vi.fn(() => new Response(null, { status: 302, headers: { Location: '/book.pdf' } }))
    expect((await (await handleHttpsImport(request(), mockNetwork(remote))).json()).error.code).toBe('TOO_MANY_REDIRECTS')
    expect(remote).toHaveBeenCalledTimes(6)
  })
  it('rejects a declared oversize file and cancels its upstream body', async () => {
    let canceled = false
    const response = await handleHttpsImport(request(), mockNetwork(() => new Response(new ReadableStream({ cancel() { canceled = true } }), { headers: { 'Content-Length': String(MAX_PUBLICATION_BYTES + 1) } })))
    expect(response.status).toBe(413)
    expect(canceled).toBe(true)
  })
  it('bounds unknown-length streams without buffering the whole publication', async () => {
    const chunk = new Uint8Array(1024 * 1024)
    let canceled = false
    const response = await handleHttpsImport(request(), mockNetwork(() => new Response(new ReadableStream({ pull(output) { output.enqueue(chunk) }, cancel() { canceled = true } }))))
    const reader = response.body!.getReader()
    let bytes = 0
    await expect((async () => { while (true) { const { done, value } = await reader.read(); if (done) break; bytes += value.length } })()).rejects.toMatchObject({ code: 'FILE_TOO_LARGE' })
    expect(bytes).toBeLessThanOrEqual(MAX_PUBLICATION_BYTES)
    expect(canceled).toBe(true)
  })
  it('cancels upstream work when the user stops the response', async () => {
    let canceled = false
    let signal: AbortSignal | undefined
    const response = await handleHttpsImport(request(), mockNetwork((_url, init) => {
      signal = init.signal as AbortSignal
      return new Response(new ReadableStream({ pull(output) { output.enqueue(new Uint8Array([1])) }, cancel() { canceled = true } }))
    }))
    await response.body!.cancel()
    expect(canceled).toBe(true)
    expect(signal?.aborted).toBe(true)
  })
  it('returns a recoverable timeout for a stalled upstream request', async () => {
    vi.useFakeTimers()
    try {
      const fetcher = mockNetwork((_url, init) => new Promise((_resolve, reject) => init.signal?.addEventListener('abort', () => reject(init.signal?.reason), { once: true })))
      const result = handleHttpsImport(request(), fetcher)
      await vi.advanceTimersByTimeAsync(IMPORT_TIMEOUT_MS)
      const response = await result
      expect(response.status).toBe(504)
      expect((await response.json()).error.code).toBe('DOWNLOAD_TIMEOUT')
    } finally { vi.useRealTimers() }
  })
})
