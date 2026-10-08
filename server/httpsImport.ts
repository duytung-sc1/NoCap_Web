import { HttpsImportError, IMPORT_TIMEOUT_MS, MAX_PUBLICATION_BYTES, MAX_REDIRECTS, publicationUrl } from '../shared/httpsPublication.ts'

const noCache = { 'Cache-Control': 'private, no-store', 'CDN-Cache-Control': 'no-store', 'Cloudflare-CDN-Cache-Control': 'no-store', 'X-Content-Type-Options': 'nosniff', 'Referrer-Policy': 'no-referrer', 'Content-Security-Policy': "sandbox; default-src 'none'", 'X-Frame-Options': 'DENY', 'Cross-Origin-Resource-Policy': 'same-origin' }
type Fetcher = typeof fetch

// DNS must resolve exclusively to public addresses on every redirect hop.
export function isPublicAddress(address: string): boolean {
  if (address.includes(':')) {
    const value = address.toLowerCase()
    const groups = value.split(':')
    if (!/^[0-9a-f:]+$/.test(value) || groups.length > 9 || groups.some(group => group.length > 4) || (value.match(/::/g)?.length || 0) > 1) return false
    if (!value.includes('::') && groups.length !== 8) return false
    const [first, second] = groups.map(group => parseInt(group || '0', 16))
    return first >= 0x2000 && first <= 0x3fff && first !== 0x2002 && !(first === 0x2001 && [0, 0xdb8, 0x10, 0x20].includes(second))
  }
  if (!/^\d{1,3}(?:\.\d{1,3}){3}$/.test(address)) return false
  const parts = address.split('.').map(Number)
  if (parts.length !== 4 || parts.some(part => !Number.isInteger(part) || part < 0 || part > 255)) return false
  const [a, b, c] = parts
  return !(a === 0 || a === 10 || a === 127 || a >= 224 || a === 100 && b >= 64 && b <= 127 || a === 169 && b === 254 ||
    a === 172 && b >= 16 && b <= 31 || a === 192 && (b === 168 || b === 0 && (c === 0 || c === 2) || b === 88 && c === 99) ||
    a === 198 && (b === 18 || b === 19 || b === 51 && c === 100) || a === 203 && b === 0 && c === 113)
}

async function requirePublicDns(host: string, fetcher: Fetcher, signal: AbortSignal) {
  const answers = await Promise.all(['A', 'AAAA'].map(async type => {
    const response = await fetcher(`https://cloudflare-dns.com/dns-query?name=${encodeURIComponent(host)}&type=${type}`, { headers: { Accept: 'application/dns-json' }, signal, redirect: 'manual' })
    if (!response.ok) throw new HttpsImportError('SOURCE_UNAVAILABLE', 502)
    const dns = await response.json() as { Status: number; Answer?: Array<{ type: number; data: string }> }
    if (dns.Status !== 0) throw new HttpsImportError('SOURCE_UNAVAILABLE', 502)
    return (dns.Answer || []).filter(record => record.type === 1 || record.type === 28).map(record => record.data)
  }))
  const addresses = answers.flat()
  if (!addresses.length) throw new HttpsImportError('SOURCE_UNAVAILABLE', 502)
  if (addresses.some(address => !isPublicAddress(address))) throw new HttpsImportError('PUBLIC_URL_REQUIRED')
}

async function readInput(request: Request): Promise<string> {
  if (!request.headers.get('content-type')?.toLowerCase().startsWith('application/json')) throw new HttpsImportError('INVALID_URL')
  const reader = request.body?.getReader()
  if (!reader) throw new HttpsImportError('INVALID_URL')
  const chunks: Uint8Array<ArrayBuffer>[] = []
  let bytes = 0
  try {
    while (true) {
      const { done, value } = await reader.read()
      if (done) break
      bytes += value.byteLength
      if (bytes > 16_384) { await reader.cancel(); throw new HttpsImportError('INVALID_URL', 413) }
      chunks.push(new Uint8Array(value))
    }
    let data: { url?: unknown }
    try { data = JSON.parse(await new Blob(chunks).text()) } catch { throw new HttpsImportError('INVALID_URL') }
    if (!data || typeof data.url !== 'string') throw new HttpsImportError('INVALID_URL')
    return data.url
  } finally { reader.releaseLock() }
}

/** A bounded same-origin file download, never an authenticated/open redirect proxy. */
export async function handleHttpsImport(request: Request, fetcher: Fetcher = (input, init) => fetch(input, init)): Promise<Response> {
  if (request.method !== 'POST') return Response.json({ error: { code: 'METHOD_NOT_ALLOWED' } }, { status: 405, headers: { ...noCache, Allow: 'POST' } })
  const origin = request.headers.get('Origin')
  if (!origin || origin !== new URL(request.url).origin || request.headers.get('Sec-Fetch-Site') === 'cross-site') return Response.json({ error: { code: 'ORIGIN_REJECTED' } }, { status: 403, headers: noCache })
  const controller = new AbortController()
  const cancel = () => controller.abort(request.signal.reason)
  if (request.signal.aborted) cancel()
  else request.signal.addEventListener('abort', cancel, { once: true })
  const timer = setTimeout(() => controller.abort(new HttpsImportError('DOWNLOAD_TIMEOUT', 504)), IMPORT_TIMEOUT_MS)
  const cleanup = () => { clearTimeout(timer); request.signal.removeEventListener('abort', cancel) }
  let upstream: Response | undefined
  let stage = 'input'
  try {
    let url = publicationUrl(await readInput(request))
    const appHost = new URL(request.url).hostname
    for (let redirects = 0; ; redirects++) {
      if (url.pathname.replace(/\/+$/, '') === '/api/import' && (url.hostname === appHost || url.hostname === 'ntlab.id.vn' || url.hostname.endsWith('.nocap-web.pages.dev'))) throw new HttpsImportError('PUBLIC_URL_REQUIRED')
      stage = 'dns'
      await requirePublicDns(url.hostname, fetcher, controller.signal)
      // User cookies, auth headers and Referer are deliberately never forwarded.
      stage = 'download'
      upstream = await fetcher(url.toString(), { method: 'GET', headers: { 'User-Agent': 'NoCap-Reader/1.0', 'Accept-Encoding': 'identity' }, redirect: 'manual', signal: controller.signal, cache: 'no-store' })
      if (![301, 302, 303, 307, 308].includes(upstream.status)) break
      const location = upstream.headers.get('location')
      await upstream.body?.cancel()
      if (!location) throw new HttpsImportError('SOURCE_UNAVAILABLE', 502)
      if (redirects >= MAX_REDIRECTS) throw new HttpsImportError('TOO_MANY_REDIRECTS', 502)
      try { url = publicationUrl(new URL(location, url).toString()) } catch (error) { if (error instanceof HttpsImportError) throw error; throw new HttpsImportError('INVALID_URL') }
    }
    if (!upstream.ok || upstream.status === 206 || !upstream.body) throw new HttpsImportError('SOURCE_UNAVAILABLE', 502)
    const length = Number(upstream.headers.get('content-length') || 0)
    if (length > MAX_PUBLICATION_BYTES) throw new HttpsImportError('FILE_TOO_LARGE', 413)
    const headers = new Headers(noCache)
    headers.set('Content-Type', upstream.headers.get('content-type') || 'application/octet-stream')
    headers.set('X-NoCap-Source', encodeURIComponent(url.toString()))
    const disposition = upstream.headers.get('content-disposition')
    headers.set('Content-Disposition', disposition && disposition.length <= 4096 ? disposition.replace(/^[^;]+/, 'attachment') : 'attachment')
    if (length > 0 && !upstream.headers.has('content-encoding')) headers.set('Content-Length', String(length))
    const reader = upstream.body.getReader()
    let count = 0
    const stream = new ReadableStream<Uint8Array>({
      async pull(output) {
        try {
          const { done, value } = await reader.read()
          if (done) { cleanup(); output.close(); return }
          count += value.byteLength
          if (count > MAX_PUBLICATION_BYTES) throw new HttpsImportError('FILE_TOO_LARGE', 413)
          output.enqueue(value)
        } catch (error) { cleanup(); controller.abort(error); await reader.cancel(error).catch(() => {}); output.error(error) }
      },
      async cancel(reason) { cleanup(); controller.abort(reason); await reader.cancel(reason).catch(() => {}) },
    })
    return new Response(stream, { headers })
  } catch (error) {
    cleanup()
    controller.abort()
    await upstream?.body?.cancel().catch(() => {})
    const reason = error instanceof HttpsImportError ? error : controller.signal.reason instanceof HttpsImportError ? controller.signal.reason : new HttpsImportError('SOURCE_UNAVAILABLE', 502)
    // Diagnose runtime/source failures without logging URLs, query tokens or document content.
    if (reason.status >= 500) console.warn('NoCap HTTPS import failed', { stage, code: reason.code, upstreamStatus: upstream?.status, errorType: error instanceof Error ? error.name : typeof error })
    return Response.json({ error: { code: reason.code } }, { status: reason.status, headers: noCache })
  }
}
