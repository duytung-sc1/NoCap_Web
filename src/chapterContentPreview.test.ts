// @vitest-environment jsdom
import { Blob as NodeBlob } from 'node:buffer'
import { afterEach, beforeEach, describe, expect, it, vi } from 'vitest'
import { CHAPTER_PREVIEW_CHARACTERS, CHAPTER_PREVIEW_TIMEOUT_MS, previewChapterContents } from './chapterContentPreview'
import { downloadHttpsHtml } from './httpsImport'
import { HttpsImportError } from '../shared/httpsPublication'

vi.mock('./httpsImport', async original => ({ ...await original<typeof import('./httpsImport')>(), downloadHttpsHtml: vi.fn() }))
const download = vi.mocked(downloadHttpsHtml)
const chapter = (number: number) => ({ title: `Chương ${number}`, url: `https://books.example.org/novel/chapter-${number}` })
const prose = 'Nội dung tiếng Việt rõ ràng: ghi chú, nghiên cứu và đọc sách. '.repeat(40)
const page = (url: string, body = `<p>${prose}</p>`) => ({ url, html: `<!doctype html><html><head><title>Tiêu đề nguồn</title></head><body><article>${body}</article></body></html>` })

beforeEach(() => {
  vi.stubGlobal('Blob', NodeBlob)
  download.mockReset().mockImplementation(async url => page(url))
})
afterEach(() => { vi.useRealTimers(); vi.unstubAllGlobals(); vi.restoreAllMocks() })

describe('on-demand chapter content samples', () => {
  it('reads only the first two selected chapters and returns bounded plain text with Vietnamese accents', async () => {
    const results = await previewChapterContents([chapter(201), chapter(202), chapter(203)])
    expect(download.mock.calls.map(([url]) => url)).toEqual([chapter(201).url, chapter(202).url])
    expect(results).toHaveLength(2)
    expect(results.every(item => item.status === 'ready')).toBe(true)
    expect(results[0].sourceTitle).toBe('Tiêu đề nguồn')
    expect(results[0].excerpt).toContain('Nội dung tiếng Việt rõ ràng')
    expect(results[0].excerpt!.endsWith('…')).toBe(true)
    expect(Array.from(results[0].excerpt!).length).toBeLessThanOrEqual(CHAPTER_PREVIEW_CHARACTERS + 1)
    expect(results[0].characters).toBeGreaterThan(CHAPTER_PREVIEW_CHARACTERS)
    expect(results[0].excerpt).not.toContain('<p>')
  })

  it('sanitizes delivered source markup and excludes navigation, hidden text and scripts', async () => {
    download.mockImplementation(async url => page(url, `<nav>Unrelated navigation</nav><p>${prose}</p><p hidden>Hidden content</p><img src="https://other.example.org/tracker"><script>window.executed = true</script>`))
    const [sample] = await previewChapterContents([chapter(1)])
    expect(sample.status).toBe('ready')
    for (const excluded of ['Unrelated navigation', 'Hidden content', '<script', 'tracker']) expect(sample.excerpt).not.toContain(excluded)
    expect((window as unknown as { executed?: boolean }).executed).toBeUndefined()
  })

  it('bounds an oversized source title before returning it to the interface', async () => {
    download.mockImplementation(async url => ({ ...page(url), html: page(url).html.replace('Tiêu đề nguồn', 'Tiêu đề dài '.repeat(2000)) }))
    const [sample] = await previewChapterContents([chapter(1)])
    expect(sample.status).toBe('ready')
    expect(Array.from(sample.sourceTitle!).length).toBeLessThanOrEqual(500)
    expect(sample.excerpt).toContain('Nội dung tiếng Việt')
  })

  it('keeps successful samples when another chapter has no readable article', async () => {
    download.mockResolvedValueOnce(page(chapter(1).url, '<p>Too short.</p>')).mockResolvedValueOnce(page(chapter(2).url))
    const results = await previewChapterContents([chapter(1), chapter(2)])
    expect(results[0]).toMatchObject({ status: 'error', errorCode: 'NO_ARTICLE' })
    expect(results[1]).toMatchObject({ status: 'ready', title: 'Chương 2' })
  })

  it('does not request a second chapter when the source blocks or rate-limits the sample', async () => {
    download.mockRejectedValue(new HttpsImportError('SOURCE_RATE_LIMITED'))
    const results = await previewChapterContents([chapter(1), chapter(2)])
    expect(download).toHaveBeenCalledTimes(1)
    expect(results.every(item => item.errorCode === 'SOURCE_RATE_LIMITED')).toBe(true)
  })

  it('rejects private destinations and does not accept cross-origin redirects or mixed sources', async () => {
    const [privateSource] = await previewChapterContents([{ title: 'Private', url: 'https://127.0.0.1/chapter' }])
    expect(privateSource.errorCode).toBe('PUBLIC_URL_REQUIRED')
    expect(download).not.toHaveBeenCalled()
    download.mockResolvedValueOnce(page('https://other.example.org/chapter-1'))
    const results = await previewChapterContents([chapter(1), { title: 'Wrong source', url: 'https://other.example.org/chapter-2' }])
    expect(results[0].errorCode).toBe('PUBLIC_URL_REQUIRED')
    expect(results[1].errorCode).toBe('BATCH_INVALID')
    expect(download).toHaveBeenCalledTimes(1)
  })

  it('honors cancellation before a request and after a stale request resolves', async () => {
    const before = new AbortController(); before.abort()
    await expect(previewChapterContents([chapter(1)], { signal: before.signal })).rejects.toMatchObject({ name: 'AbortError' })
    expect(download).not.toHaveBeenCalled()
    const during = new AbortController()
    download.mockImplementationOnce(async url => { during.abort(); return page(url) })
    await expect(previewChapterContents([chapter(1), chapter(2)], { signal: during.signal })).rejects.toMatchObject({ name: 'AbortError' })
    expect(download).toHaveBeenCalledTimes(1)
  })

  it('limits the entire preview wait and reports a timeout without requesting further content', async () => {
    vi.useFakeTimers()
    download.mockImplementation((_url, options) => new Promise((_resolve, reject) => options?.signal?.addEventListener('abort', () => reject(options.signal!.reason), { once: true })))
    const pending = previewChapterContents([chapter(1), chapter(2)])
    await vi.advanceTimersByTimeAsync(CHAPTER_PREVIEW_TIMEOUT_MS)
    expect((await pending).every(item => item.errorCode === 'DOWNLOAD_TIMEOUT')).toBe(true)
    expect(download).toHaveBeenCalledTimes(1)
  })

  it('does not make requests for an empty selection or duplicate the same selected chapter', async () => {
    expect(await previewChapterContents([])).toEqual([])
    expect(await previewChapterContents([chapter(1), chapter(1)])).toHaveLength(1)
    expect(download).toHaveBeenCalledTimes(1)
  })
})
