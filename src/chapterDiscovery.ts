import { HttpsImportError, publicationUrl } from '../shared/httpsPublication'
import { MAX_BATCH_HTML_BYTES, MAX_CATALOG_CHAPTERS, MAX_CATALOG_PAGES, type ChapterCatalog, type ChapterLink, type ChapterSourceDiagnostics, type ChapterSourceWarningCode } from '../shared/chapterImport'
import { downloadHttpsChapterIndex, downloadHttpsHtml } from './httpsImport'
import { nextFlightObjects, restoreStreamedHtml } from './streamedHtml'

const tocSelectors = [
  '#list-chapter', '.list-chapter', '#chapter-list', '.chapter-list', '.chapter-listing', '.list-chapters',
  '#chapters', '.chapters', '#catalog', '.catalog', '#toc', '.toc', '#table-of-contents', '.table-of-contents',
  '[role="doc-toc"]', '[itemprop="hasPart"]',
].join(',')
const paginationSelectors = '.pagination, .pager, .paging, .page-nav, .page-navigation, [role="navigation"][aria-label]'
const chapterLabel = /^(?:chương|chuong|chapter|chap\.?|ch\.?|episode|ep\.?|phần|phan|part)\s*[:#.-]?\s*(\d{1,7})(?=\s|[:.\-–—]|$)/i
const ordinalLabel = /^(\d{1,7})\s*[.):\-–—]\s*\S/
const chapterPath = /(?:^|\/)(?:chuong|chapter|chap|episode)[-_/]?(\d+)(?:[-_/.]|$)/i
const pageParameters = new Set(['page', 'p', 'trang', 'pageindex', 'page_index'])

function label(value: string | null): string {
  // eslint-disable-next-line no-control-regex -- Catalog labels must not retain control characters.
  return (value || '').normalize('NFC').replace(/[\u0000-\u001f\u007f]/g, ' ').replace(/\s+/g, ' ').trim().slice(0, 500)
}

function safeLink(href: string, base: URL): URL | undefined {
  if (!href.trim() || href.trim().startsWith('#')) return
  try {
    const url = publicationUrl(new URL(href, base).toString())
    if (url.origin !== base.origin || /\.(?:pdf|epub|zip|rar|jpe?g|png|gif|webp|exe|mp[34])$/i.test(url.pathname)) return
    if (/(?:^|\/)(?:login|signin|sign-in|register|account|subscribe|checkout|cart)(?:\/|$)/i.test(url.pathname)) return
    return url
  } catch { return }
}

/** A pagination URL must retain the catalog identity; never follow chapter-next links. */
function catalogKey(url: URL): string {
  const normalized = new URL(url)
  for (const key of Array.from(normalized.searchParams.keys())) if (pageParameters.has(key.toLowerCase())) normalized.searchParams.delete(key)
  normalized.pathname = normalized.pathname.replace(/\/(?:page|trang)[-/]\d+\/?$/i, '').replace(/\/$/, '') || '/'
  normalized.searchParams.sort()
  return normalized.toString()
}

function isPagination(url: URL, base: URL): boolean {
  if (url.toString() === base.toString() || catalogKey(url) !== catalogKey(base)) return false
  return Array.from(url.searchParams.keys()).some(key => pageParameters.has(key.toLowerCase()) && /^\d+$/.test(url.searchParams.get(key) || ''))
    || /\/(?:page|trang)[-/]\d+\/?$/i.test(url.pathname)
    || Array.from(base.searchParams.keys()).some(key => pageParameters.has(key.toLowerCase()))
}

type ParsedCatalog = { title: string; chapters: ChapterLink[]; pages: string[]; incomplete: boolean; format: ChapterSourceDiagnostics['format']; expectedChapters?: number; incompleteReason?: ChapterSourceWarningCode }

function warning(catalog: ChapterCatalog, code: ChapterSourceWarningCode, error?: unknown) {
  catalog.truncated = true
  const diagnostics = catalog.diagnostics!
  diagnostics.completeness = 'partial'
  const errorCode = error instanceof HttpsImportError ? error.code : error ? 'SOURCE_UNAVAILABLE' : undefined
  if (!diagnostics.warnings.some(item => item.code === code && item.errorCode === errorCode)) diagnostics.warnings.push({ code, ...(errorCode ? { errorCode } : {}) })
}

async function parseCatalog(html: string, base: URL): Promise<ParsedCatalog> {
  const { default: DOMPurify } = await import('dompurify')
  // Links are inspected as inert data only. No scripts, images, frames, styles or base URLs survive.
  const clean = DOMPurify.sanitize(html, {
    WHOLE_DOCUMENT: true,
    ALLOWED_TAGS: ['title', 'h1', 'h2', 'h3', 'main', 'article', 'section', 'div', 'nav', 'ul', 'ol', 'li', 'p', 'span', 'a', 'button', 'template'],
    ALLOWED_ATTR: ['href', 'rel', 'title', 'id', 'class', 'role', 'itemprop', 'aria-label', 'hidden', 'aria-hidden', 'disabled'],
  })
  const document = new DOMParser().parseFromString(clean, 'text/html')
  const restored = restoreStreamedHtml(document, html)
  document.querySelectorAll('[hidden], [aria-hidden="true"]').forEach(node => node.remove())
  const title = label(document.querySelector('h1')?.textContent || document.title) || 'NoCap'
  const chapters: ChapterLink[] = []
  const pages: string[] = []
  for (const anchor of document.querySelectorAll('a[href]')) {
    const url = safeLink(anchor.getAttribute('href')!, base)
    if (!url || url.toString() === base.toString()) continue
    const walker = document.createTreeWalker(anchor, NodeFilter.SHOW_TEXT)
    const words: string[] = []
    while (walker.nextNode()) words.push(walker.currentNode.textContent || '')
    const text = label(words.join(' ') || anchor.getAttribute('title'))
    const insidePagination = anchor.closest(paginationSelectors) || anchor.matches('[rel~="next"], [rel~="prev"]')
    if (insidePagination && isPagination(url, base)) { pages.push(url.toString()); continue }
    if (insidePagination || isPagination(url, base)) continue
    if (text.length < 2) continue
    const inToc = Boolean(anchor.closest(tocSelectors))
    const match = text.match(chapterLabel) || (inToc ? text.match(ordinalLabel) : null)
    if (!match && !inToc && !chapterPath.test(url.pathname)) continue
    if (/^(?:mục lục|muc luc|table of contents|contents|trang chủ|home|next|previous|tiếp|trước|sau|đăng nhập|login|read more)$/i.test(text)) continue
    const pathNumber = url.pathname.match(chapterPath)?.[1]
    const number = match ? Number(match[1]) : pathNumber ? Number(pathNumber) : undefined
    chapters.push({ url: url.toString(), title: text, ...(number !== undefined ? { number } : {}) })
  }
  const supported = truyendichCatalog(html, base, chapters)
  if (supported) return supported
  const incomplete = Array.from(document.querySelectorAll('button:not([disabled])')).some(button => /^(?:(?:trang|page)\s*(?:[2-9]\d*|\d{2,}|sau|next)|\d+\s*[-–]\s*\d+)$/i.test(label(button.getAttribute('aria-label') || button.textContent)))
  return { title, chapters, pages, incomplete, format: restored ? 'streamed-html' : 'html', ...(incomplete ? { incompleteReason: 'dynamic-pagination' } : {}) }
}

/** Public catalog routes used by TruyenDich's own page controls; chapters must exist in delivered HTML. */
function truyendichCatalog(html: string, base: URL, rendered: ChapterLink[]): ParsedCatalog | undefined {
  if (base.hostname !== 'truyendich.space') return
  const route = base.pathname.match(/^\/doc-truyen(\/(?:ai|cv))?\/([a-z0-9]+(?:-[a-z0-9]+)*)(?:\/trang-([1-9]\d*))?\/?$/i)
  if (!route) return
  const prefix = route[1] || '', slug = route[2], current = Number(route[3] || 1)
  const props = nextFlightObjects(html).filter(item => item.slug === slug && item.editionPrefix === prefix && item.initialData)
  if (!props.length) return
  if (props.length !== 1) throw new HttpsImportError('CHAPTER_INDEX_INVALID')
  const data = props[0].initialData as Record<string, unknown>
  if (!data || !Number.isSafeInteger(data.total) || Number(data.total) < 1 || Number(data.total) > 1_000_000
    || data.page !== current || data.size !== 50 || !Array.isArray(data.items) || !data.items.length || data.items.length > 50
    || current > Math.ceil(Number(data.total) / 50)) throw new HttpsImportError('CHAPTER_INDEX_INVALID')
  const root = `/doc-truyen${prefix}/${slug}`
  const links = new Map(rendered.map(chapter => [new URL(chapter.url).pathname, chapter]))
  const chapters: ChapterLink[] = []
  const seen = new Set<number>()
  for (const entry of data.items) {
    const item = entry as Record<string, unknown> | null
    if (!item || !Number.isSafeInteger(item.chapter_number) || Number(item.chapter_number) < 1 || Number(item.chapter_number) > 9_999_999
      || typeof item.title !== 'string' || !label(item.title) || seen.has(Number(item.chapter_number))) throw new HttpsImportError('CHAPTER_INDEX_INVALID')
    const number = Number(item.chapter_number)
    const actual = links.get(`${root}/chuong-${number}`)
    if (!actual) throw new HttpsImportError('CHAPTER_INDEX_INVALID')
    seen.add(number)
    chapters.push({ url: actual.url, title: `Chương ${number}: ${label(item.title)}`, number })
  }
  const totalPages = Math.ceil(Number(data.total) / 50)
  const pages = Array.from({ length: Math.min(totalPages, MAX_CATALOG_PAGES) }, (_, index) => new URL(root + (index ? `/trang-${index + 1}` : ''), base).toString())
  return { title: label(typeof props[0].novelTitle === 'string' ? props[0].novelTitle : null) || slug, chapters, pages, incomplete: totalPages > MAX_CATALOG_PAGES, format: 'streamed-html', expectedChapters: Number(data.total), ...(totalPages > MAX_CATALOG_PAGES ? { incompleteReason: 'page-limit' } : {}) }
}

type DiscoveryOptions = { signal?: AbortSignal; onProgress?: (value: { pages: number; chapters: number }) => void }

/** Read JSON string literals in Next's delivered HTML; never execute the script or flight data. */
function sstruyenIdentity(html: string, base: URL): { id: number; slug: string } | undefined {
  if (base.hostname !== 'sstruyen.pics') return
  const slug = base.pathname.match(/^\/truyen\/([a-z0-9]+(?:-[a-z0-9]+)*)\/?$/i)?.[1]
  if (!slug) return
  let flight = ''
  for (const script of html.matchAll(/<script\b[^>]*>([\s\S]*?)<\/script\s*>/gi)) {
    const argument = script[1].match(/^\s*self\.__next_f\.push\(([\s\S]*)\)\s*;?\s*$/)?.[1]
    if (!argument) continue
    try {
      const tuple: unknown = JSON.parse(argument)
      if (Array.isArray(tuple) && tuple[0] === 1 && typeof tuple[1] === 'string') flight += tuple[1]
    } catch { /* Unknown or executable expressions are not interpreted. */ }
  }
  const ids = new Set<number>()
  let nodes = 0
  const visit = (value: unknown) => {
    if (++nodes > 30_000 || !value || typeof value !== 'object') return
    const object = value as Record<string, unknown>
    if (object.slug === slug && typeof object.name === 'string' && Number.isSafeInteger(object.id) && Number(object.id) > 0 && Number(object.id) < 10_000_000_000) ids.add(Number(object.id))
    for (const child of Object.values(object)) visit(child)
  }
  for (const record of flight.split('\n')) {
    const json = record.match(/^[\da-z]+:([[{].*)$/i)?.[1]
    if (json) { try { visit(JSON.parse(json)) } catch { /* Ignore module references and partial records. */ } }
  }
  return ids.size === 1 ? { id: [...ids][0], slug } : undefined
}

async function discoverSstruyen(html: string, base: URL, parsed: ParsedCatalog, options: DiscoveryOptions): Promise<ChapterCatalog | undefined> {
  const identity = sstruyenIdentity(html, base)
  if (!identity) return
  const catalog: ChapterCatalog = { title: parsed.title, sourceUrl: base.toString(), chapters: [], pages: [base.toString()], truncated: false,
    diagnostics: { format: 'public-index', completeness: 'unverified', warnings: [] } }
  const rendered = new Set(parsed.chapters.map(chapter => chapter.url))
  const seen = new Set<string>()
  let totalBytes = new TextEncoder().encode(html).byteLength
  let expectedTotal: number | undefined
  let expectedPages = 1, processedPages = 0
  for (let page = 1; page <= expectedPages && catalog.pages.length < MAX_CATALOG_PAGES; page++) {
    await waitPolitely(options.signal)
    const endpoint = `https://api.sstruyen.pics/novels/${identity.id}/chapters?page=${page}&keyword=&limit=50&sort=asc`
    let raw: unknown
    try { raw = await downloadHttpsChapterIndex(endpoint, { signal: options.signal }) } catch (error) {
      options.signal?.throwIfAborted()
      if (page === 1) {
        if (!parsed.chapters.length) throw error
        catalog.chapters = [...new Map(parsed.chapters.map(chapter => [chapter.url, chapter])).values()]
      }
      warning(catalog, 'page-failed', error)
      break
    }
    options.signal?.throwIfAborted()
    totalBytes += new TextEncoder().encode(JSON.stringify(raw)).byteLength
    if (totalBytes > MAX_BATCH_HTML_BYTES) { warning(catalog, 'size-limit'); break }
    try {
      const data = raw as { chapters?: unknown; total?: unknown; page?: unknown; totalPages?: unknown; hasNext?: unknown }
      if (!data || !Array.isArray(data.chapters) || data.chapters.length > 50 || !Number.isSafeInteger(data.total) || Number(data.total) < 1
        || data.page !== page || data.totalPages !== Math.ceil(Number(data.total) / 50) || data.hasNext !== (page < Number(data.totalPages))) throw new HttpsImportError('CHAPTER_INDEX_INVALID')
      if (expectedTotal !== undefined && data.total !== expectedTotal) { warning(catalog, 'catalog-changed'); break }
      expectedTotal = Number(data.total); expectedPages = Number(data.totalPages)
      catalog.diagnostics!.expectedChapters = expectedTotal
      const links: ChapterLink[] = []
      for (const entry of data.chapters) {
        const chapter = entry as { id?: unknown; slug?: unknown; name?: unknown }
        if (!chapter || !Number.isSafeInteger(chapter.id) || Number(chapter.id) < 1 || typeof chapter.slug !== 'string'
          || !/^[a-z0-9]+(?:-[a-z0-9]+)*$/i.test(chapter.slug) || chapter.slug.length > 200 || typeof chapter.name !== 'string' || !label(chapter.name)) throw new HttpsImportError('CHAPTER_INDEX_INVALID')
        // This route comes from the source's own public UI, using real returned IDs/slugs.
        const url = new URL(`/doc-truyen/${identity.slug}-${chapter.slug}-${chapter.id}`, base).toString()
        const title = label(chapter.name)
        const number = title.match(chapterLabel)?.[1]
        links.push({ url, title, ...(number ? { number: Number(number) } : {}) })
      }
      if (page === 1 && links.filter(chapter => rendered.has(chapter.url)).length < Math.min(2, links.length)) throw new HttpsImportError('CHAPTER_INDEX_INVALID')
      for (const chapter of links) {
        if (seen.has(chapter.url)) { warning(catalog, 'catalog-changed'); continue }
        if (catalog.chapters.length >= MAX_CATALOG_CHAPTERS) { warning(catalog, 'chapter-limit'); break }
        seen.add(chapter.url); catalog.chapters.push(chapter)
      }
    } catch (error) {
      if (page === 1) throw error
      warning(catalog, 'catalog-changed', error)
      break
    }
    catalog.pages.push(endpoint)
    processedPages++
    options.onProgress?.({ pages: catalog.pages.length, chapters: catalog.chapters.length })
    if (catalog.chapters.length >= MAX_CATALOG_CHAPTERS) break
  }
  if (processedPages < expectedPages && catalog.pages.length >= MAX_CATALOG_PAGES) warning(catalog, 'page-limit')
  if (expectedTotal !== undefined && catalog.chapters.length !== expectedTotal && !catalog.truncated) warning(catalog, 'catalog-changed')
  if (!catalog.chapters.length) throw new HttpsImportError('CHAPTER_CATALOG_EMPTY')
  if (!catalog.truncated && expectedTotal === catalog.chapters.length) catalog.diagnostics!.completeness = 'verified'
  return catalog
}

function waitPolitely(signal?: AbortSignal): Promise<void> {
  signal?.throwIfAborted()
  return new Promise((resolve, reject) => {
    const abort = () => { clearTimeout(timer); reject(signal?.reason) }
    const timer = setTimeout(() => { signal?.removeEventListener('abort', abort); resolve() }, 150)
    signal?.addEventListener('abort', abort, { once: true })
  })
}

/** Discover real links from static public TOCs; no URL guessing or chapter-content crawling. */
export async function discoverChapters(raw: string, options: DiscoveryOptions = {}): Promise<ChapterCatalog> {
  const initial = publicationUrl(raw)
  const queue = [initial.toString()]
  const queued = new Set(queue)
  const visited = new Set<string>()
  const chapters = new Map<string, ChapterLink>()
  const catalog: ChapterCatalog = { title: 'NoCap', sourceUrl: initial.toString(), chapters: [], pages: [], truncated: false,
    diagnostics: { format: 'html', completeness: 'unverified', warnings: [] } }
  let catalogBase = initial
  let totalBytes = 0
  let attempts = 0
  while (queue.length && attempts < MAX_CATALOG_PAGES) {
    options.signal?.throwIfAborted()
    const target = queue.shift()!
    if (visited.has(target)) continue
    if (attempts) await waitPolitely(options.signal)
    attempts++
    let response: Awaited<ReturnType<typeof downloadHttpsHtml>>
    try { response = await downloadHttpsHtml(target, { signal: options.signal }) } catch (error) {
      options.signal?.throwIfAborted()
      if (!catalog.pages.length) throw error
      warning(catalog, 'page-failed', error)
      break
    }
    const final = publicationUrl(response.url)
    if (!catalog.pages.length) { catalogBase = final; catalog.sourceUrl = final.toString() }
    else if (final.origin !== catalogBase.origin || catalogKey(final) !== catalogKey(catalogBase)) { warning(catalog, 'catalog-changed'); continue }
    if (visited.has(final.toString())) continue
    visited.add(target); visited.add(final.toString())
    totalBytes += new TextEncoder().encode(response.html).byteLength
    if (totalBytes > MAX_BATCH_HTML_BYTES) { warning(catalog, 'size-limit'); break }
    let parsed: ParsedCatalog
    try { parsed = await parseCatalog(response.html, final) } catch (error) {
      if (!catalog.pages.length) throw error
      warning(catalog, 'catalog-changed', error)
      break
    }
    options.signal?.throwIfAborted()
    if (!catalog.pages.length) {
      const specialized = await discoverSstruyen(response.html, final, parsed, options)
      if (specialized) return specialized
    }
    if (parsed.incomplete) warning(catalog, parsed.incompleteReason || 'dynamic-pagination')
    if (parsed.format !== 'html') catalog.diagnostics!.format = parsed.format
    if (parsed.expectedChapters !== undefined) {
      if (catalog.diagnostics!.expectedChapters !== undefined && catalog.diagnostics!.expectedChapters !== parsed.expectedChapters) { warning(catalog, 'catalog-changed'); break }
      catalog.diagnostics!.expectedChapters = parsed.expectedChapters
    }
    if (catalog.pages.length && !parsed.chapters.length) { warning(catalog, 'catalog-changed'); break }
    if (!catalog.pages.length) catalog.title = parsed.title
    catalog.pages.push(final.toString())
    for (const chapter of parsed.chapters) {
      if (chapters.has(chapter.url)) continue
      if (chapters.size >= MAX_CATALOG_CHAPTERS) { warning(catalog, 'chapter-limit'); break }
      chapters.set(chapter.url, chapter)
    }
    // Pagination is only followed on a page that actually contains a chapter listing.
    if (parsed.chapters.length >= 2 || parsed.expectedChapters !== undefined && parsed.chapters.length > 0) for (const page of parsed.pages) {
      if (!queued.has(page) && !visited.has(page)) { queued.add(page); queue.push(page) }
    }
    options.onProgress?.({ pages: catalog.pages.length, chapters: chapters.size })
    if (chapters.size >= MAX_CATALOG_CHAPTERS && catalog.truncated) break
  }
  options.signal?.throwIfAborted()
  if (queue.length && attempts >= MAX_CATALOG_PAGES) warning(catalog, 'page-limit')
  if (!chapters.size) throw new HttpsImportError(catalog.diagnostics!.warnings.some(item => item.code === 'dynamic-pagination') ? 'CHAPTER_DYNAMIC_UNSUPPORTED' : 'CHAPTER_CATALOG_EMPTY')
  catalog.chapters = [...chapters.values()]
  const numbers = catalog.chapters.map(chapter => chapter.number)
  if (numbers.every((number): number is number => number !== undefined) && new Set(numbers).size === numbers.length) {
    catalog.chapters.sort((a, b) => a.number! - b.number!)
  }
  const expected = catalog.diagnostics!.expectedChapters
  if (expected !== undefined && expected !== catalog.chapters.length && !catalog.truncated) warning(catalog, 'catalog-changed')
  if (!catalog.truncated && expected === catalog.chapters.length) catalog.diagnostics!.completeness = 'verified'
  return catalog
}
