import { openDB, type DBSchema, type IDBPDatabase, type IDBPTransaction } from 'idb'
import { MAX_BATCH_CHAPTERS, MAX_BATCH_HTML_BYTES, type ChapterLink } from '../shared/chapterImport'
import { HttpsImportError, publicationSource, publicationUrl, safePublicationName } from '../shared/httpsPublication'
import { downloadHttpsHtml, extractArticle } from './httpsImport'
import { epubFontLicenses, epubSansCss, epubTextLanguage, loadEpubFonts, markEpubLanguages, setEpubLanguage, type EpubLanguage } from './chapterEpubTypography'

export type ChapterBatchDraft = {
  id: string
  profile: string
  title: string
  sourceUrl: string
  chapters: Array<ChapterLink & { status: 'pending' | 'done' | 'error'; error?: string; bytes?: number }>
  updatedAt: number
}

type ChapterResult = { key: string; jobId: string; html: string; bytes: number }
interface ChapterImportDB extends DBSchema {
  jobs: { key: string; value: ChapterBatchDraft }
  chapters: { key: string; value: ChapterResult; indexes: { jobId: string } }
}

let connection: Promise<IDBPDatabase<ChapterImportDB>> | undefined
const activeProfiles = new Set<string>()
function database() {
  if (!connection) {
    const opening = openDB<ChapterImportDB>('nocap-chapter-import', 1, {
      upgrade(db) {
        db.createObjectStore('jobs', { keyPath: 'profile' })
        db.createObjectStore('chapters', { keyPath: 'key' }).createIndex('jobId', 'jobId')
      },
      blocking() { void opening.then(db => db.close()); if (connection === opening) connection = undefined },
      terminated() { if (connection === opening) connection = undefined },
    })
    connection = opening
    void opening.catch(() => { if (connection === opening) connection = undefined })
  }
  return connection
}

function storageError(error: unknown): never {
  if (error instanceof HttpsImportError) throw error
  throw new HttpsImportError('BATCH_STORAGE_FAILED')
}

async function mutateBatch<T>(build: (transaction: IDBPTransaction<ChapterImportDB, ['jobs', 'chapters'], 'readwrite'>) => Promise<T>): Promise<T> {
  try {
    const db = await database(), transaction = db.transaction(['jobs', 'chapters'], 'readwrite')
    try {
      const result = await build(transaction)
      await transaction.done
      return result
    } catch (error) {
      // A synchronous IndexedDB exception does not abort prior queued deletes.
      try { transaction.abort() } catch { /* the transaction already completed */ }
      await transaction.done.catch(() => {})
      throw error
    }
  } catch (error) { return storageError(error) }
}

export async function loadChapterBatch(profile: string): Promise<ChapterBatchDraft | null> {
  try { return (await (await database()).get('jobs', profile)) || null } catch (error) { return storageError(error) }
}

export async function createChapterBatch(input: { profile: string; title: string; sourceUrl: string; chapters: ChapterLink[]; expectedDraftId?: string | null }): Promise<ChapterBatchDraft> {
  if (!input.chapters.length || input.chapters.length > MAX_BATCH_CHAPTERS) throw new HttpsImportError('BATCH_TOO_MANY')
  if (!input.profile || !input.title.trim() || input.title.length > 300) throw new HttpsImportError('BATCH_INVALID')
  const source = publicationUrl(input.sourceUrl)
  const urls = new Set<string>()
  const chapters = input.chapters.map(chapter => {
    const url = publicationUrl(chapter.url)
    if (url.origin !== source.origin || urls.has(url.toString())) throw new HttpsImportError('BATCH_INVALID')
    urls.add(url.toString())
    return { url: url.toString(), title: chapter.title.trim().slice(0, 500) || url.pathname, number: chapter.number, status: 'pending' as const }
  })
  const draft: ChapterBatchDraft = { id: crypto.randomUUID(), profile: input.profile, title: input.title.trim(), sourceUrl: publicationSource(source.toString()), chapters, updatedAt: Date.now() }
  return mutateBatch(async transaction => {
    const previous = await transaction.objectStore('jobs').get(input.profile)
    if (input.expectedDraftId !== undefined && (previous?.id ?? null) !== input.expectedDraftId) throw new HttpsImportError('BATCH_STALE')
    if (previous) {
      const keys = await transaction.objectStore('chapters').index('jobId').getAllKeys(previous.id)
      await Promise.all(keys.map(key => transaction.objectStore('chapters').delete(key)))
    }
    await transaction.objectStore('jobs').put(draft)
    return draft
  })
}

export async function discardChapterBatch(profile: string, id: string): Promise<void> {
  await mutateBatch(async transaction => {
    const current = await transaction.objectStore('jobs').get(profile)
    if (current?.id === id) {
      const keys = await transaction.objectStore('chapters').index('jobId').getAllKeys(id)
      await Promise.all(keys.map(key => transaction.objectStore('chapters').delete(key)))
      await transaction.objectStore('jobs').delete(profile)
    }
  })
}

async function saveChapter(draft: ChapterBatchDraft, index: number, value: { html: string; bytes: number } | { error: string }): Promise<ChapterBatchDraft> {
  return mutateBatch(async transaction => {
    const current = await transaction.objectStore('jobs').get(draft.profile)
    if (!current || current.id !== draft.id) throw new HttpsImportError('BATCH_STALE')
    // An already finished chapter wins even when two tabs finish the same request.
    if (current.chapters[index].status === 'done') return current
    if ('html' in value) {
      const bytes = current.chapters.reduce((sum, chapter) => sum + (chapter.bytes || 0), 0)
      if (bytes + value.bytes > MAX_BATCH_HTML_BYTES) throw new HttpsImportError('BATCH_TOO_LARGE')
      await transaction.objectStore('chapters').put({ key: `${draft.id}:${index}`, jobId: draft.id, ...value })
      current.chapters[index] = { ...current.chapters[index], status: 'done', bytes: value.bytes, error: undefined }
    } else current.chapters[index] = { ...current.chapters[index], status: 'error', error: value.error, bytes: undefined }
    current.updatedAt = Date.now()
    await transaction.objectStore('jobs').put(current)
    return current
  })
}

function delay(signal: AbortSignal): Promise<void> {
  if (signal.aborted) return Promise.resolve()
  return new Promise(resolve => {
    const complete = () => { clearTimeout(timer); signal.removeEventListener('abort', complete); resolve() }
    const timer = setTimeout(complete, 500)
    signal.addEventListener('abort', complete, { once: true })
  })
}

type RunOptions = { signal?: AbortSignal; onProgress?: (draft: ChapterBatchDraft) => void; retryFailed?: boolean }

/** The tab runs the queue; each successful chapter is committed before progress advances. */
export async function runChapterBatch(draft: ChapterBatchDraft, options: RunOptions = {}): Promise<ChapterBatchDraft> {
  if (activeProfiles.has(draft.profile)) throw new HttpsImportError('BATCH_STALE')
  const run = async () => {
    activeProfiles.add(draft.profile)
    const controller = new AbortController()
    const cancel = () => controller.abort(options.signal?.reason)
    if (options.signal?.aborted) cancel()
    else options.signal?.addEventListener('abort', cancel, { once: true })
    let current: ChapterBatchDraft | null = null, fatal: unknown
    try {
      current = await loadChapterBatch(draft.profile)
      if (!current || current.id !== draft.id) throw new HttpsImportError('BATCH_STALE')
      const work = current.chapters.flatMap((chapter, index) => chapter.status === (options.retryFailed ? 'error' : 'pending') ? [index] : [])
      let cursor = 0, failures = 0
      const worker = async () => {
        while (!controller.signal.aborted && failures < 3 && cursor < work.length) {
          const index = work[cursor++]
          try {
            const chapter = current!.chapters[index]
            const response = await downloadHttpsHtml(chapter.url, { signal: controller.signal })
            controller.signal.throwIfAborted()
            if (publicationUrl(response.url).origin !== publicationUrl(chapter.url).origin) throw new HttpsImportError('PUBLIC_URL_REQUIRED')
            const article = await extractArticle(new Blob([response.html], { type: 'text/html' }))
            controller.signal.throwIfAborted()
            current = await saveChapter(draft, index, { html: article.html, bytes: new Blob([article.html]).size })
            failures = 0
            options.onProgress?.(current)
          } catch (error) {
            if (controller.signal.aborted) break
            if (error instanceof HttpsImportError && ['BATCH_STALE', 'BATCH_STORAGE_FAILED', 'BATCH_TOO_LARGE'].includes(error.code)) { fatal = error; controller.abort(); break }
            const code = error instanceof HttpsImportError ? error.code : 'SOURCE_UNAVAILABLE'
            try {
              current = await saveChapter(draft, index, { error: code })
              options.onProgress?.(current)
            } catch (failure) { fatal = failure; controller.abort(); break }
            failures++
          }
          if (cursor < work.length) await delay(controller.signal)
        }
      }
      await Promise.all([worker(), worker()])
      if (fatal) throw fatal
      const latest = await loadChapterBatch(draft.profile)
      if (!latest || latest.id !== draft.id) throw new HttpsImportError('BATCH_STALE')
      return latest
    } finally {
      options.signal?.removeEventListener('abort', cancel)
      controller.abort()
      activeProfiles.delete(draft.profile)
    }
  }
  // Web Locks release automatically if the tab closes, allowing immediate resume.
  if (globalThis.navigator?.locks) return navigator.locks.request(`nocap-chapter-import:${draft.profile}`, { ifAvailable: true }, lock => {
    if (!lock) throw new HttpsImportError('BATCH_STALE')
    return run()
  })
  return run()
}

// XML 1.0 rejects controls and unpaired surrogates, even when HTML accepts them.
const xmlText = (value: string) => Array.from(value).filter(character => {
  const point = character.codePointAt(0)!
  return point === 9 || point === 10 || point === 13 || point >= 32 && point <= 0xd7ff || point >= 0xe000 && point <= 0xfffd || point >= 0x10000 && point <= 0x10ffff
}).join('')
const xml = (value: string) => xmlText(value).replace(/[&<>"']/g, character => ({ '&': '&amp;', '<': '&lt;', '>': '&gt;', '"': '&quot;', "'": '&apos;' })[character]!)
const xhtmlNamespace = 'http://www.w3.org/1999/xhtml'

/** Serialize a fresh XHTML document, preserving prose but no active or remote content. */
async function chapterXhtml(title: string, html: string, source: string): Promise<{ xhtml: string; languages: Set<EpubLanguage>; language: EpubLanguage }> {
  const { default: DOMPurify } = await import('dompurify')
  const clean = DOMPurify.sanitize(xmlText(html), { ALLOWED_TAGS: ['p', 'h1', 'h2', 'h3', 'h4', 'h5', 'h6', 'blockquote', 'pre', 'code', 'ul', 'ol', 'li', 'table', 'thead', 'tbody', 'tr', 'th', 'td', 'br', 'hr', 'strong', 'b', 'em', 'i', 'u'], ALLOWED_ATTR: [] })
  const content = new DOMParser().parseFromString(clean, 'text/html')
  const language = epubTextLanguage(`${title}\n${content.body.textContent || ''}`)
  const doc = document.implementation.createDocument(xhtmlNamespace, 'html')
  setEpubLanguage(doc.documentElement, language)
  const head = doc.createElementNS(xhtmlNamespace, 'head'), body = doc.createElementNS(xhtmlNamespace, 'body')
  const heading = doc.createElementNS(xhtmlNamespace, 'h1'), titleElement = doc.createElementNS(xhtmlNamespace, 'title')
  const stylesheet = doc.createElementNS(xhtmlNamespace, 'link')
  stylesheet.setAttribute('rel', 'stylesheet'); stylesheet.setAttribute('type', 'text/css'); stylesheet.setAttribute('href', 'styles.css')
  titleElement.textContent = xmlText(title); heading.textContent = xmlText(title)
  setEpubLanguage(titleElement, epubTextLanguage(title))
  head.append(titleElement, stylesheet); body.append(heading)
  for (const node of Array.from(content.body.childNodes)) body.append(doc.importNode(node, true))
  const attribution = doc.createElementNS(xhtmlNamespace, 'p'), link = doc.createElementNS(xhtmlNamespace, 'a')
  link.setAttribute('href', publicationSource(source)); link.textContent = publicationSource(source)
  attribution.append(link); body.append(attribution)
  const languages = markEpubLanguages(body, language)
  doc.documentElement.append(head, body)
  return { xhtml: `<?xml version="1.0" encoding="UTF-8"?>\n${new XMLSerializer().serializeToString(doc)}`, languages, language }
}

export async function buildChapterEpub(draft: ChapterBatchDraft, options: { signal?: AbortSignal } = {}): Promise<File> {
  options.signal?.throwIfAborted()
  let current: ChapterBatchDraft | undefined, results: ChapterResult[]
  try {
    const db = await database(), transaction = db.transaction(['jobs', 'chapters'], 'readonly')
    current = await transaction.objectStore('jobs').get(draft.profile)
    results = await transaction.objectStore('chapters').index('jobId').getAll(draft.id)
    await transaction.done
  } catch (error) { return storageError(error) }
  if (!current || current.id !== draft.id) throw new HttpsImportError('BATCH_STALE')
  const included = current.chapters.flatMap((chapter, index) => chapter.status === 'done' ? [{ ...chapter, index }] : [])
  if (!included.length) throw new HttpsImportError('BATCH_EMPTY')
  const stored = new Map(results.map(result => [result.key, result]))
  const { default: JSZip } = await import('jszip')
  const zip = new JSZip()
  zip.file('mimetype', 'application/epub+zip', { compression: 'STORE' })
  zip.file('META-INF/container.xml', '<?xml version="1.0" encoding="UTF-8"?><container version="1.0" xmlns="urn:oasis:names:tc:opendocument:xmlns:container"><rootfiles><rootfile full-path="EPUB/package.opf" media-type="application/oebps-package+xml"/></rootfiles></container>')
  const manifest: string[] = [], spine: string[] = [], navigation: string[] = [], ncx: string[] = []
  const languages = new Set<EpubLanguage>([epubTextLanguage(current.title)])
  zip.file('EPUB/styles.css', epubSansCss)
  manifest.push('<item id="styles" href="styles.css" media-type="text/css"/>')
  for (const font of await loadEpubFonts(options.signal)) {
    const path = `fonts/${font.name}.ttf`
    zip.file(`EPUB/${path}`, font.data)
    manifest.push(`<item id="font-${font.name}" href="${path}" media-type="font/ttf"/>`)
  }
  for (const license of epubFontLicenses) {
    const path = `licenses/${license.name}.xhtml`
    zip.file(`EPUB/${path}`, `<?xml version="1.0" encoding="UTF-8"?><html xmlns="${xhtmlNamespace}" lang="en" xml:lang="en"><head><title>${license.name} license</title><link rel="stylesheet" type="text/css" href="../styles.css"/></head><body><h1>${license.name} license</h1><pre>${xml(license.text)}</pre></body></html>`)
    manifest.push(`<item id="license-${license.name}" href="${path}" media-type="application/xhtml+xml"/>`)
  }
  for (const [position, chapter] of included.entries()) {
    options.signal?.throwIfAborted()
    const result = stored.get(`${draft.id}:${chapter.index}`)
    if (!result || result.bytes > MAX_BATCH_HTML_BYTES) throw new HttpsImportError('BATCH_INVALID')
    const id = `chapter-${chapter.index + 1}`, path = `${id}.xhtml`
    const rendered = await chapterXhtml(chapter.title, result.html, chapter.url)
    for (const language of rendered.languages) languages.add(language)
    languages.add(rendered.language)
    zip.file(`EPUB/${path}`, rendered.xhtml)
    manifest.push(`<item id="${id}" href="${path}" media-type="application/xhtml+xml"/>`)
    spine.push(`<itemref idref="${id}"/>`)
    const language = epubTextLanguage(chapter.title)
    navigation.push(`<li><a href="${path}" lang="${language}" xml:lang="${language}">${xml(chapter.title)}</a></li>`)
    ncx.push(`<navPoint id="${id}" playOrder="${position + 1}"><navLabel><text xml:lang="${language}">${xml(chapter.title)}</text></navLabel><content src="${path}"/></navPoint>`)
  }
  const title = xml(current.title), source = xml(publicationSource(current.sourceUrl)), identifier = `urn:uuid:${current.id}`
  const language = languages.has('vi') ? 'vi' : 'en', titleLanguage = epubTextLanguage(current.title)
  const modified = new Date().toISOString().replace(/\.\d{3}Z$/, 'Z')
  zip.file('EPUB/nav.xhtml', `<?xml version="1.0" encoding="UTF-8"?><html xmlns="${xhtmlNamespace}" xmlns:epub="http://www.idpf.org/2007/ops" lang="${language}" xml:lang="${language}"><head><title lang="${titleLanguage}" xml:lang="${titleLanguage}">${title}</title><link rel="stylesheet" type="text/css" href="styles.css"/></head><body><nav epub:type="toc" id="toc"><h1 lang="${titleLanguage}" xml:lang="${titleLanguage}">${title}</h1><ol>${navigation.join('')}</ol></nav></body></html>`)
  zip.file('EPUB/toc.ncx', `<?xml version="1.0" encoding="UTF-8"?><ncx xmlns="http://www.daisy.org/z3986/2005/ncx/" version="2005-1" xml:lang="${language}"><head><meta name="dtb:uid" content="${identifier}"/><meta name="dtb:depth" content="1"/><meta name="dtb:totalPageCount" content="0"/><meta name="dtb:maxPageNumber" content="0"/></head><docTitle><text xml:lang="${titleLanguage}">${title}</text></docTitle><navMap>${ncx.join('')}</navMap></ncx>`)
  zip.file('EPUB/package.opf', `<?xml version="1.0" encoding="UTF-8"?><package xmlns="http://www.idpf.org/2007/opf" version="3.0" unique-identifier="book-id" xml:lang="${language}"><metadata xmlns:dc="http://purl.org/dc/elements/1.1/"><dc:identifier id="book-id">${identifier}</dc:identifier><dc:title xml:lang="${titleLanguage}">${title}</dc:title>${[language, ...[...languages].filter(value => value !== language)].map(value => `<dc:language>${value}</dc:language>`).join('')}<dc:source xml:lang="en">${source}</dc:source><meta property="dcterms:modified">${modified}</meta></metadata><manifest><item id="nav" href="nav.xhtml" media-type="application/xhtml+xml" properties="nav"/><item id="ncx" href="toc.ncx" media-type="application/x-dtbncx+xml"/>${manifest.join('')}</manifest><spine toc="ncx">${spine.join('')}</spine></package>`)
  options.signal?.throwIfAborted()
  const data = await zip.generateAsync({ type: 'uint8array', compression: 'DEFLATE', compressionOptions: { level: 6 } }, () => options.signal?.throwIfAborted())
  options.signal?.throwIfAborted()
  return new File([new Uint8Array(data)], safePublicationName(current.title, 'epub'), { type: 'application/epub+zip' })
}
