export type ChapterLink = { url: string; title: string; number?: number }

export type ChapterCatalog = {
  title: string
  sourceUrl: string
  chapters: ChapterLink[]
  pages: string[]
  truncated: boolean
}

export const MAX_BATCH_CHAPTERS = 500
export const MAX_CATALOG_CHAPTERS = 10_000
export const MAX_CATALOG_PAGES = 40
export const MAX_BATCH_HTML_BYTES = 50 * 1024 * 1024
import { HttpsImportError, publicationUrl } from './httpsPublication.ts'

export const MAX_CHAPTER_INDEX_BYTES = 1024 * 1024

/** Only the public, read-only chapter-list endpoint used by SSTruyen's own catalog UI. */
export function chapterIndexUrl(raw: string): URL {
  const url = publicationUrl(raw)
  if (url.hostname !== 'api.sstruyen.pics' || !/^\/novels\/[1-9]\d{0,9}\/chapters$/.test(url.pathname)) throw new HttpsImportError('PUBLIC_URL_REQUIRED')
  const allowed = new Set(['page', 'keyword', 'limit', 'sort'])
  for (const [key] of url.searchParams) if (!allowed.has(key) || url.searchParams.getAll(key).length !== 1) throw new HttpsImportError('INVALID_URL')
  const page = Number(url.searchParams.get('page'))
  if (!Number.isInteger(page) || page < 1 || page > MAX_CATALOG_PAGES || url.searchParams.get('limit') !== '50'
    || url.searchParams.get('sort') !== 'asc' || url.searchParams.get('keyword') !== '') throw new HttpsImportError('INVALID_URL')
  return url
}
