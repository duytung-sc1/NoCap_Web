export const MAX_PUBLICATION_BYTES = 250 * 1024 * 1024
export const MAX_HTML_BYTES = 8 * 1024 * 1024
export const IMPORT_TIMEOUT_MS = 180_000
export const MAX_REDIRECTS = 5

export class HttpsImportError extends Error {
  readonly code: string
  readonly status: number
  constructor(code: string, status = 400) { super(code); this.code = code; this.status = status }
}

/** Public HTTPS only. Never accept credentials, IP literals or internal hosts. */
export function publicationUrl(raw: string): URL {
  if (typeof raw !== 'string' || !raw.trim() || raw.length > 8192) throw new HttpsImportError('INVALID_URL')
  let url: URL
  try { url = new URL(raw.trim()) } catch { throw new HttpsImportError('INVALID_URL') }
  if (url.protocol !== 'https:') throw new HttpsImportError('HTTPS_REQUIRED')
  const host = url.hostname.toLowerCase().replace(/\.$/, '')
  if (url.username || url.password || url.port || !host.includes('.') || host.includes(':') || /^[\d.]+$/.test(host) ||
    /(^|\.)(localhost|local|internal|lan|home|test|invalid|onion)$/.test(host)) throw new HttpsImportError('PUBLIC_URL_REQUIRED')
  url.hostname = host
  url.hash = ''
  return url
}

/** Attribution only: signed query parameters are not persisted or synced. */
export function publicationSource(raw: string): string {
  const url = publicationUrl(raw)
  url.search = ''
  return url.toString()
}

export const publicationMediaTypes: Record<string, string> = {
  epub: 'application/epub+zip', pdf: 'application/pdf', cbz: 'application/vnd.comicbook+zip',
  docx: 'application/vnd.openxmlformats-officedocument.wordprocessingml.document',
  txt: 'text/plain', md: 'text/markdown', markdown: 'text/markdown',
  html: 'text/html', htm: 'text/html', xhtml: 'application/xhtml+xml',
  jpg: 'image/jpeg', jpeg: 'image/jpeg', png: 'image/png', webp: 'image/webp',
}

export function safePublicationName(name: string, extension: string): string {
  const stem = name.split(/[\\/]/).pop()?.replace(/\.[a-z\d]{1,12}$/i, '')
    // eslint-disable-next-line no-control-regex -- Strip unsafe filesystem/control characters.
    .normalize('NFC').replace(/[<>:"/\\|?*\u0000-\u001f\u007f\u202a-\u202e\u2066-\u2069]/g, '_')
    .trim().replace(/^[. ]+|[. ]+$/g, '').slice(0, 160).replace(/[. ]+$/g, '') || 'NoCap-document'
  return `${/^(con|prn|aux|nul|com\d|lpt\d)(?:\.|$)/i.test(stem) ? `NoCap-${stem}` : stem}.${extension}`
}

export function suggestedPublicationName(headers: Headers, finalUrl: string): string {
  const disposition = headers.get('content-disposition') || ''
  const encoded = disposition.match(/filename\*\s*=\s*UTF-8'[^']*'([^;]+)/i)?.[1]?.trim().replace(/^"|"$/g, '')
  if (encoded) { try { return decodeURIComponent(encoded) } catch { /* use the plain filename */ } }
  const plain = disposition.match(/(?:^|;)\s*filename\s*=\s*(?:"([^"]*)"|([^;]*))/i)
  const name = plain?.[1] || plain?.[2]?.trim()
  if (name) return name
  try { return decodeURIComponent(new URL(finalUrl).pathname.split('/').pop() || '') } catch { return '' }
}
