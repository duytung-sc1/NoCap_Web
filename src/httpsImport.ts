import type { Lang } from './i18n'
import { HttpsImportError, IMPORT_TIMEOUT_MS, MAX_HTML_BYTES, MAX_PUBLICATION_BYTES, publicationMediaTypes, publicationUrl, safePublicationName, suggestedPublicationName } from '../shared/httpsPublication'

export type ImportProgress = { received: number; total?: number }

const messages: Record<string, [string, string]> = {
  INVALID_URL: ['Liên kết không hợp lệ. Hãy nhập địa chỉ HTTPS đầy đủ.', 'Invalid link. Enter a complete HTTPS URL.'],
  HTTPS_REQUIRED: ['Chỉ hỗ trợ liên kết HTTPS.', 'Only HTTPS links are supported.'],
  PUBLIC_URL_REQUIRED: ['Hãy dùng link HTTPS công khai, không chứa tài khoản, mật khẩu hoặc địa chỉ mạng nội bộ.', 'Use a public HTTPS link without a username, password or internal network address.'],
  SOURCE_UNAVAILABLE: ['Không tải được từ nguồn này. Hãy dùng link tải trực tiếp, công khai, không yêu cầu đăng nhập.', 'Could not download from this source. Use a public direct link that does not require signing in.'],
  TOO_MANY_REDIRECTS: ['Liên kết chuyển hướng quá nhiều lần. Hãy dùng link tải trực tiếp.', 'Too many redirects. Use a direct download link.'],
  DOWNLOAD_TIMEOUT: ['Tải quá lâu. Kiểm tra mạng hoặc thử lại với tệp nhỏ hơn.', 'Download timed out. Check your connection or try a smaller file.'],
  FILE_TOO_LARGE: ['Tệp vượt giới hạn 250 MB.', 'The file exceeds the 250 MB limit.'],
  EMPTY_FILE: ['Tệp tải về không có nội dung.', 'The downloaded file is empty.'],
  UNSUPPORTED_FORMAT: ['Không nhận diện được tài liệu. Hỗ trợ EPUB, PDF, CBZ, DOCX, TXT, Markdown, HTML, JPG, PNG và WebP.', 'Unrecognized document. Supported: EPUB, PDF, CBZ, DOCX, TXT, Markdown, HTML, JPG, PNG and WebP.'],
  HTML_TOO_LARGE: ['Trang HTML vượt giới hạn 8 MB để trích xuất nội dung.', 'The HTML page exceeds the 8 MB article extraction limit.'],
  NO_ARTICLE: ['Không tìm thấy nội dung chính để đọc. Trang có thể chỉ chứa liên kết hoặc yêu cầu đăng nhập.', 'No readable article found. The page may contain only links or require signing in.'],
  SAVE_FAILED: ['Không lưu được tài liệu. Kiểm tra bộ nhớ trình duyệt rồi thử lại.', 'Could not save the document. Check browser storage and try again.'],
  ORIGIN_REJECTED: ['Không tải được từ trang này. Hãy mở lại NoCap rồi thử lại.', 'Download unavailable from this page. Reopen NoCap and try again.'],
}

export function httpsImportMessage(error: unknown, lang: Lang): string {
  const code = error instanceof HttpsImportError ? error.code : 'SOURCE_UNAVAILABLE'
  return (messages[code] || messages.SOURCE_UNAVAILABLE)[lang === 'vi' ? 0 : 1]
}

/** Sanitize before parsing; remote images/frames never become network requests. */
async function extractArticle(file: Blob): Promise<{ html: string; title: string }> {
  if (file.size > MAX_HTML_BYTES) throw new HttpsImportError('HTML_TOO_LARGE')
  const { default: DOMPurify } = await import('dompurify')
  const clean = DOMPurify.sanitize(await file.text(), {
    ALLOWED_TAGS: ['title', 'main', 'article', 'section', 'div', 'p', 'h1', 'h2', 'h3', 'h4', 'h5', 'h6', 'blockquote', 'pre', 'code', 'ul', 'ol', 'li', 'table', 'thead', 'tbody', 'tr', 'th', 'td', 'br', 'hr', 'strong', 'b', 'em', 'i', 'u', 'a', 'nav', 'aside', 'header', 'footer'],
    ALLOWED_ATTR: ['id', 'class', 'itemprop', 'role', 'hidden', 'aria-hidden'],
    WHOLE_DOCUMENT: true,
  })
  const document = new DOMParser().parseFromString(clean, 'text/html')
  const title = document.title.trim()
  const noise = /(^|[-_\s])(ads?|advert(?:isement|ising)?|banner|promo|related|recommend(?:ed|ations)?|comments?|social|share|breadcrumb|pagination|chapter-nav|menu|sidebar|cookie|popup|modal)([-_\s]|$)/i
  document.querySelectorAll('nav, aside, header, footer, [hidden], [aria-hidden="true"]').forEach(node => node.remove())
  document.body.querySelectorAll('*').forEach(node => { if (noise.test(`${node.id} ${node.className}`)) node.remove() })
  const score = (element: Element) => {
    const text = element.textContent?.trim().length || 0
    const links = Array.from(element.querySelectorAll('a')).reduce((sum, link) => sum + (link.textContent?.length || 0), 0)
    return text >= 160 && links <= text * .45 ? (text - links) / (1 + element.querySelectorAll('div, section, article').length * .04) : 0
  }
  const best = (nodes: Element[]) => nodes.filter(node => score(node) > 0).sort((a, b) => score(b) - score(a))[0]
  const root = best(Array.from(document.querySelectorAll('.chapter-content, #chapter-content, #chapterContent, .chapter-text, #chapterText, [itemprop="articleBody"], .entry-content, .post-content, article')))
    || best(Array.from(document.querySelectorAll('main, [role="main"], #content, .content')))
    // Include the cleaned body so a multi-chapter HTML book is not reduced to one div.
    || best([document.body, ...Array.from(document.querySelectorAll('section, div'))])
  if (!root) throw new HttpsImportError('NO_ARTICLE')
  root.querySelectorAll('p, li, div, section').forEach(node => {
    const size = node.textContent?.trim().length || 0
    const links = Array.from(node.querySelectorAll('a')).reduce((sum, link) => sum + (link.textContent?.length || 0), 0)
    if (size && links >= size * .8) node.remove()
  })
  root.querySelectorAll('a').forEach(link => link.replaceWith(...link.childNodes))
  // Preserve div/br-based prose as paragraphs instead of joining adjacent lines.
  const blocks = new Set(['P', 'H1', 'H2', 'H3', 'H4', 'H5', 'H6', 'BLOCKQUOTE', 'PRE', 'UL', 'OL', 'TABLE', 'HR'])
  const normalize = (container: Element) => {
    let paragraph: HTMLParagraphElement | null = null
    for (const child of Array.from(container.childNodes)) {
      if (child instanceof Element && ['DIV', 'SECTION', 'ARTICLE', 'MAIN'].includes(child.tagName)) {
        paragraph = null; normalize(child); child.replaceWith(...child.childNodes)
      } else if (child instanceof Element && blocks.has(child.tagName)) paragraph = null
      else if (child instanceof Element && child.tagName === 'BR') { paragraph = null; child.remove() }
      else if (child.nodeType !== Node.TEXT_NODE || child.textContent?.trim()) {
        if (!paragraph) { paragraph = document.createElement('p'); child.parentNode!.insertBefore(paragraph, child) }
        paragraph.appendChild(child)
      }
    }
  }
  normalize(root)
  if ((root.textContent?.trim().length || 0) < 160) throw new HttpsImportError('NO_ARTICLE')
  const content = DOMPurify.sanitize(root.innerHTML, { ALLOWED_TAGS: ['p', 'h1', 'h2', 'h3', 'h4', 'h5', 'h6', 'blockquote', 'pre', 'code', 'ul', 'ol', 'li', 'table', 'thead', 'tbody', 'tr', 'th', 'td', 'br', 'hr', 'strong', 'b', 'em', 'i', 'u'], ALLOWED_ATTR: [] })
  const output = document.implementation.createHTMLDocument(title)
  output.head.insertAdjacentHTML('afterbegin', '<meta charset="utf-8">')
  output.body.innerHTML = content
  return { html: '<!doctype html>' + output.documentElement.outerHTML, title }
}

export async function publicationFile(blob: Blob, headers: Headers, finalUrl: string): Promise<File> {
  if (!blob.size) throw new HttpsImportError('EMPTY_FILE')
  if (blob.size > MAX_PUBLICATION_BYTES) throw new HttpsImportError('FILE_TOO_LARGE')
  const name = suggestedPublicationName(headers, finalUrl)
  const extension = name.match(/\.([a-z]+)$/i)?.[1]?.toLowerCase() || ''
  const mediaType = (headers.get('content-type') || '').split(';')[0].trim().toLowerCase()
  const head = new Uint8Array(await blob.slice(0, 1024).arrayBuffer())
  const text = new TextDecoder().decode(head)
  let detected = ''
  if (text.startsWith('%PDF-')) detected = 'pdf'
  else if (head[0] === 0x89 && head[1] === 0x50 && head[2] === 0x4e && head[3] === 0x47) detected = 'png'
  else if (head[0] === 0xff && head[1] === 0xd8 && head[2] === 0xff) detected = 'jpg'
  else if (text.slice(0, 4) === 'RIFF' && text.slice(8, 12) === 'WEBP') detected = 'webp'
  else if (['text/html', 'application/xhtml+xml'].includes(mediaType) || /<(?:!doctype\s+html|html|head|body)\b/i.test(text)) detected = 'html'
  else if (head[0] === 0x50 && head[1] === 0x4b) {
    try {
      const { default: JSZip } = await import('jszip')
      const zip = await JSZip.loadAsync(await blob.arrayBuffer())
      if (zip.file('META-INF/container.xml')) detected = 'epub'
      else if (zip.file('word/document.xml')) detected = 'docx'
      else if (Object.values(zip.files).some(entry => !entry.dir && !entry.name.startsWith('__MACOSX/') && /\.(?:png|jpe?g|webp|gif|bmp)$/i.test(entry.name))) detected = 'cbz'
    } catch { throw new HttpsImportError('UNSUPPORTED_FORMAT') }
  } else if (['txt', 'md', 'markdown'].includes(extension) || ['text/plain', 'text/markdown'].includes(mediaType)) {
    if (head.includes(0) || head.some(byte => byte < 9 || byte > 13 && byte < 32)) throw new HttpsImportError('UNSUPPORTED_FORMAT')
    detected = ['md', 'markdown'].includes(extension) || mediaType === 'text/markdown' ? 'md' : 'txt'
  }
  if (!detected) throw new HttpsImportError('UNSUPPORTED_FORMAT')
  if (detected === 'html') {
    const article = await extractArticle(blob)
    return new File([article.html], safePublicationName(article.title || name, 'html'), { type: 'text/html' })
  }
  return new File([blob], safePublicationName(name, detected), { type: publicationMediaTypes[detected] })
}

export async function downloadHttpsPublication(raw: string, options: { signal?: AbortSignal; onProgress?: (progress: ImportProgress) => void } = {}): Promise<File> {
  const url = publicationUrl(raw)
  const controller = new AbortController()
  const cancel = () => controller.abort(options.signal?.reason)
  if (options.signal?.aborted) cancel()
  else options.signal?.addEventListener('abort', cancel, { once: true })
  const timer = setTimeout(() => controller.abort(new HttpsImportError('DOWNLOAD_TIMEOUT', 504)), IMPORT_TIMEOUT_MS)
  let reader: ReadableStreamDefaultReader<Uint8Array> | undefined
  try {
    const response = await fetch('/api/import', { method: 'POST', headers: { 'Content-Type': 'application/json' }, body: JSON.stringify({ url: url.toString() }), signal: controller.signal, credentials: 'omit', cache: 'no-store', redirect: 'error', referrerPolicy: 'no-referrer' })
    if (!response.ok) {
      const data = await response.json().catch(() => null) as { error?: { code?: string } } | null
      throw new HttpsImportError(data?.error?.code || 'SOURCE_UNAVAILABLE', response.status)
    }
    const total = Number(response.headers.get('content-length') || 0)
    if (total > MAX_PUBLICATION_BYTES) { await response.body?.cancel(); throw new HttpsImportError('FILE_TOO_LARGE') }
    if (!response.body) throw new HttpsImportError('EMPTY_FILE')
    reader = response.body.getReader()
    const chunks: BlobPart[] = []
    let received = 0
    let lastReport = 0
    options.onProgress?.({ received, total: total > 0 ? total : undefined })
    while (true) {
      controller.signal.throwIfAborted()
      const { done, value } = await reader.read()
      if (done) break
      received += value.byteLength
      if (received > MAX_PUBLICATION_BYTES) { await reader.cancel(); throw new HttpsImportError('FILE_TOO_LARGE') }
      chunks.push(value as BlobPart)
      if (performance.now() - lastReport >= 100 || received === total) {
        options.onProgress?.({ received, total: total > 0 ? total : undefined })
        lastReport = performance.now()
      }
    }
    options.onProgress?.({ received, total: total > 0 ? total : undefined })
    if (total > 0 && received !== total) throw new HttpsImportError('SOURCE_UNAVAILABLE')
    const source = response.headers.get('X-NoCap-Source')
    let finalUrl = url.toString()
    if (source) { try { finalUrl = publicationUrl(decodeURIComponent(source)).toString() } catch { /* use the initial URL */ } }
    const file = await publicationFile(new Blob(chunks), response.headers, finalUrl)
    controller.signal.throwIfAborted()
    return file
  } catch (error) {
    if (controller.signal.aborted) throw controller.signal.reason
    if (error instanceof HttpsImportError) throw error
    throw new HttpsImportError('SOURCE_UNAVAILABLE', 502)
  } finally {
    clearTimeout(timer)
    options.signal?.removeEventListener('abort', cancel)
    await reader?.cancel().catch(() => {})
    reader?.releaseLock()
  }
}
