import type { ChapterLink } from '../shared/chapterImport'
import { HttpsImportError, publicationUrl } from '../shared/httpsPublication'
import { downloadHttpsHtml, extractArticle } from './httpsImport'

export type ChapterContentPreview = {
  url: string
  title: string
  sourceTitle?: string
  status: 'ready' | 'error'
  excerpt?: string
  characters?: number
  errorCode?: string
}

export const CHAPTER_PREVIEW_CHARACTERS = 1000
export const CHAPTER_PREVIEW_TIMEOUT_MS = 30_000

/** Read two selected chapters on request. This never creates a batch or writes browser storage. */
export async function previewChapterContents(chapters: ChapterLink[], options: { signal?: AbortSignal } = {}): Promise<ChapterContentPreview[]> {
  options.signal?.throwIfAborted()
  const controller = new AbortController()
  const cancel = () => controller.abort(options.signal?.reason)
  options.signal?.addEventListener('abort', cancel, { once: true })
  const timeout = setTimeout(() => controller.abort(new HttpsImportError('DOWNLOAD_TIMEOUT', 504)), CHAPTER_PREVIEW_TIMEOUT_MS)
  const previews: ChapterContentPreview[] = []
  const seen = new Set<string>()
  let sourceOrigin: string | undefined, stopCode: string | undefined
  try {
    for (const chapter of chapters.slice(0, 2)) {
      options.signal?.throwIfAborted()
      if (seen.has(chapter.url)) continue
      seen.add(chapter.url)
      const item = { url: chapter.url, title: chapter.title }
      try {
        if (stopCode) throw new HttpsImportError(stopCode)
        controller.signal.throwIfAborted()
        const target = publicationUrl(chapter.url)
        sourceOrigin ??= target.origin
        if (target.origin !== sourceOrigin) throw new HttpsImportError('BATCH_INVALID')
        const response = await downloadHttpsHtml(target.toString(), { signal: controller.signal })
        controller.signal.throwIfAborted()
        if (publicationUrl(response.url).origin !== target.origin) throw new HttpsImportError('PUBLIC_URL_REQUIRED')
        const article = await extractArticle(new Blob([response.html], { type: 'text/html' }))
        controller.signal.throwIfAborted()
        const document = new DOMParser().parseFromString(article.html, 'text/html')
        const text = Array.from(document.body.children).map(element => (element.textContent || '').normalize('NFC').replace(/\s+/g, ' ').trim()).filter(Boolean).join('\n\n')
        if (!text) throw new HttpsImportError('NO_ARTICLE')
        const snippet = Array.from(text.slice(0, CHAPTER_PREVIEW_CHARACTERS * 2)).slice(0, CHAPTER_PREVIEW_CHARACTERS).join('')
        const sourceTitle = Array.from(article.title.slice(0, 2000).normalize('NFC').replace(/\s+/g, ' ').trim()).slice(0, 500).join('')
        previews.push({ ...item, status: 'ready', sourceTitle: sourceTitle || undefined, excerpt: snippet + (snippet.length < text.length ? '…' : ''), characters: text.length })
      } catch (error) {
        options.signal?.throwIfAborted()
        const reason = controller.signal.aborted ? controller.signal.reason : error
        const errorCode = reason instanceof HttpsImportError ? reason.code : 'SOURCE_UNAVAILABLE'
        previews.push({ ...item, status: 'error', errorCode })
        if (['SOURCE_AUTH_REQUIRED', 'SOURCE_BLOCKED', 'SOURCE_RATE_LIMITED'].includes(errorCode)) stopCode = errorCode
      }
    }
    options.signal?.throwIfAborted()
    return previews
  } finally {
    clearTimeout(timeout)
    options.signal?.removeEventListener('abort', cancel)
    controller.abort()
  }
}
