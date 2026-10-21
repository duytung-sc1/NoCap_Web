// @vitest-environment jsdom
import { afterEach, beforeEach, describe, expect, it, vi } from 'vitest'
import { discoverChapters } from './chapterDiscovery'
import { downloadHttpsChapterIndex, downloadHttpsHtml } from './httpsImport'
import { MAX_CATALOG_PAGES } from '../shared/chapterImport'

vi.mock('./httpsImport', async importOriginal => ({ ...await importOriginal<typeof import('./httpsImport')>(), downloadHttpsHtml: vi.fn(), downloadHttpsChapterIndex: vi.fn() }))
const downloader = vi.mocked(downloadHttpsHtml)
const indexDownloader = vi.mocked(downloadHttpsChapterIndex)
const base = 'https://novels.example.org/story'
const chapters = (...numbers: number[]) => `<ul class="chapter-list">${numbers.map(number => `<li><a href="/story/chapter-${number}">Chương ${number}: A chapter</a></li>`).join('')}</ul>`

beforeEach(() => { downloader.mockReset(); indexDownloader.mockReset() })
afterEach(() => { vi.useRealTimers() })

describe('chapter catalog discovery', () => {
  it('collects all 1,200 actual links in reading order so any middle range can be selected', async () => {
    const numbers = Array.from({ length: 1200 }, (_, index) => 1200 - index)
    downloader.mockResolvedValue({ html: `<title>A long novel</title><h1>A long novel</h1>${chapters(...numbers)}`, url: base })
    const catalog = await discoverChapters(base)
    expect(catalog.title).toBe('A long novel')
    expect(catalog.chapters).toHaveLength(1200)
    const middle = catalog.chapters.slice(500, 700)
    expect(middle).toHaveLength(200)
    expect(middle[0]).toMatchObject({ number: 501, url: `${base}/chapter-501` })
    expect(middle[199]).toMatchObject({ number: 700, url: `${base}/chapter-700` })
    expect(downloader).toHaveBeenCalledTimes(1)
    expect(catalog.truncated).toBe(false)
  })

  it('resolves relative links against the final redirected URL and removes hostile or unrelated links', async () => {
    const final = 'https://cdn.example.org/book/contents/'
    downloader.mockResolvedValue({ url: final, html: `<base href="https://evil.example.org/"><h1>A safe book</h1>
      <script>window.compromised = true</script><img src="https://evil.example.org/pixel">
      <ul class="chapter-list">
        <li><a href="../chapter-1">Chương 1: First</a></li>
        <li><a href="../chapter-1#same">Chương 1: Duplicate</a></li>
        <li><a href="javascript:alert(1)">Chương 2: Script</a></li>
        <li><a href="http://cdn.example.org/book/2">Chương 2: Downgrade</a></li>
        <li><a href="https://127.0.0.1/2">Chương 2: Private</a></li>
        <li><a href="https://user:secret@cdn.example.org/2">Chương 2: Credentials</a></li>
        <li><a href="https://other.example.org/chapter-2">Chương 2: External</a></li>
        <li><a href="/login">Đăng nhập</a></li>
        <li><a href="../chapter-2">Chương 2: Second</a></li>
      </ul><a href="/about">About</a>` })
    const catalog = await discoverChapters(base)
    expect(catalog.sourceUrl).toBe(final)
    expect(catalog.chapters.map(chapter => chapter.url)).toEqual(['https://cdn.example.org/book/chapter-1', 'https://cdn.example.org/book/chapter-2'])
    expect((window as unknown as { compromised?: boolean }).compromised).toBeUndefined()
    expect(downloader).toHaveBeenCalledTimes(1)
  })

  it('follows bounded TOC pagination without crawling chapter-next or unrelated navigation', async () => {
    vi.useFakeTimers()
    downloader.mockImplementation(async raw => ({ url: raw, html: raw === base
      ? `${chapters(1, 2)}<nav class="pagination"><a href="?page=2">2</a><a href="/other?page=3">3</a><a href="/story/chapter-3" rel="next">Next</a></nav>`
      : `${chapters(2, 3)}<nav class="pagination"><a href="${base}">1</a><a href="?page=2">2</a></nav>` }))
    const result = discoverChapters(base)
    await vi.runAllTimersAsync()
    const catalog = await result
    expect(catalog.chapters.map(chapter => chapter.number)).toEqual([1, 2, 3])
    expect(catalog.pages).toEqual([base, `${base}?page=2`])
    expect(downloader.mock.calls.map(([url]) => url)).toEqual([base, `${base}?page=2`])
    expect(catalog.truncated).toBe(false)
  })

  it('preserves TOC order when chapter numbering resets or some labels have no reliable number', async () => {
    downloader.mockResolvedValue({ url: base, html: `<div class="chapter-list">
      <a href="/volume-1/chapter-1">Chapter 1: Volume one</a>
      <a href="/volume-1/chapter-2">Chapter 2: Volume one</a>
      <a href="/volume-2/chapter-1">Chapter 1: Volume two</a>
      <a href="/volume-2/epilogue">Epilogue</a></div>` })
    const catalog = await discoverChapters(base)
    expect(catalog.chapters.map(chapter => chapter.title)).toEqual(['Chapter 1: Volume one', 'Chapter 2: Volume one', 'Chapter 1: Volume two', 'Epilogue'])
  })

  it('reports partial discovery when a later catalog page fails', async () => {
    vi.useFakeTimers()
    downloader.mockResolvedValueOnce({ url: base, html: `${chapters(1, 2)}<nav class="pagination"><a href="?page=2">Next</a></nav>` })
      .mockRejectedValueOnce(new Error('source unavailable'))
    const result = discoverChapters(base)
    await vi.runAllTimersAsync()
    expect((await result)).toMatchObject({ truncated: true, chapters: [{ number: 1 }, { number: 2 }] })
  })

  it('caps catalog traversal and reports truncation', async () => {
    vi.useFakeTimers()
    downloader.mockImplementation(async raw => {
      const page = Number(new URL(raw).searchParams.get('page') || 1)
      return { url: raw, html: `${chapters(page * 2 - 1, page * 2)}<nav class="pagination"><a href="?page=${page + 1}">Next</a></nav>` }
    })
    const result = discoverChapters(base)
    await vi.runAllTimersAsync()
    const catalog = await result
    expect(catalog.pages).toHaveLength(MAX_CATALOG_PAGES)
    expect(downloader).toHaveBeenCalledTimes(MAX_CATALOG_PAGES)
    expect(catalog.truncated).toBe(true)
  })

  it('stops pagination promptly when canceled and rejects instead of returning a partial catalog', async () => {
    const controller = new AbortController()
    downloader.mockResolvedValue({ url: base, html: `${chapters(1, 2)}<nav class="pagination"><a href="?page=2">Next</a></nav>` })
    const progress = vi.fn(() => controller.abort())
    await expect(discoverChapters(base, { signal: controller.signal, onProgress: progress })).rejects.toMatchObject({ name: 'AbortError' })
    expect(downloader).toHaveBeenCalledTimes(1)
    expect(progress).toHaveBeenCalledWith({ pages: 1, chapters: 2 })
  })

  it('reports an empty catalog instead of following arbitrary links from a login/landing page', async () => {
    downloader.mockResolvedValue({ url: base, html: '<h1>Sign in</h1><a href="/login">Sign in</a><a href="/about">About</a>' })
    await expect(discoverChapters(base)).rejects.toMatchObject({ code: 'CHAPTER_CATALOG_EMPTY' })
    expect(downloader).toHaveBeenCalledTimes(1)
  })

  it('flags JavaScript-only pagination as incomplete instead of reporting an initial/latest mixture as a full catalog', async () => {
    downloader.mockResolvedValue({ url: base, html: `${chapters(1, 2, 1199, 1200)}<button aria-label="Trang 2">2</button>` })
    const catalog = await discoverChapters(base)
    expect(catalog.chapters).toHaveLength(4)
    expect(catalog.truncated).toBe(true)
    expect(indexDownloader).not.toHaveBeenCalled()
  })
})

describe('SSTruyen public chapter index adapter', () => {
  const source = 'https://sstruyen.pics/truyen/example-novel'
  const entry = (number: number) => ({ id: number * 37 + 777, name: `Chương ${number}: Synthetic chapter`, slug: `chuong-${number}` })
  const href = (chapter: ReturnType<typeof entry>) => `https://sstruyen.pics/doc-truyen/example-novel-${chapter.slug}-${chapter.id}`
  const numbers = Array.from({ length: 53 }, (_, index) => index + 1).filter(number => number !== 25)
  const pageOne = numbers.slice(0, 50).map(entry)
  const pageTwo = numbers.slice(50).map(entry)
  function html(bookId = 77) {
    const record = '3b:' + JSON.stringify(['$', 'div', null, { children: [{ data: { id: bookId, name: 'Example Novel', slug: 'example-novel' } }] }]) + '\n'
    return `<title>Example Novel</title><h1>Example Novel</h1><script>self.__next_f.push(${JSON.stringify([1, record])})</script>
      <section><h2>Latest chapters</h2><a href="${href(entry(53))}">Chương 53: Latest</a></section>
      <ul>${pageOne.map(chapter => `<li itemprop="hasPart"><a href="${href(chapter)}">${chapter.name}</a></li>`).join('')}</ul><button aria-label="Trang 2">2</button>`
  }

  it('reads inert flight metadata and the real public API, preserving omitted chapter numbers without guessing URLs', async () => {
    vi.useFakeTimers()
    downloader.mockResolvedValue({ url: source, html: html() })
    indexDownloader.mockResolvedValueOnce({ chapters: pageOne, total: 52, page: 1, totalPages: 2, hasNext: true })
      .mockResolvedValueOnce({ chapters: pageTwo, total: 52, page: 2, totalPages: 2, hasNext: false })
    const result = discoverChapters(source)
    await vi.runAllTimersAsync()
    const catalog = await result
    expect(catalog.chapters).toHaveLength(52)
    expect(catalog.chapters.map(chapter => chapter.number)).toEqual(numbers)
    expect(catalog.chapters.at(-1)).toMatchObject({ number: 53, url: href(entry(53)) })
    expect(catalog.chapters.find(chapter => chapter.number === 25)).toBeUndefined()
    expect(catalog.truncated).toBe(false)
    expect(indexDownloader.mock.calls.map(([url]) => url)).toEqual([
      'https://api.sstruyen.pics/novels/77/chapters?page=1&keyword=&limit=50&sort=asc',
      'https://api.sstruyen.pics/novels/77/chapters?page=2&keyword=&limit=50&sort=asc',
    ])
    expect(downloader).toHaveBeenCalledTimes(1)
  })

  it('refuses chapter metadata whose route does not match actual rendered source links', async () => {
    vi.useFakeTimers()
    downloader.mockResolvedValue({ url: source, html: html() })
    indexDownloader.mockResolvedValue({ chapters: [{ id: 1, slug: 'wrong', name: 'Chapter 1: Wrong' }], total: 1, page: 1, totalPages: 1, hasNext: false })
    const result = expect(discoverChapters(source)).rejects.toMatchObject({ code: 'CHAPTER_INDEX_INVALID' })
    await vi.runAllTimersAsync()
    await result
  })

  it('keeps a partial index when a later API page fails', async () => {
    vi.useFakeTimers()
    downloader.mockResolvedValue({ url: source, html: html() })
    indexDownloader.mockResolvedValueOnce({ chapters: pageOne, total: 52, page: 1, totalPages: 2, hasNext: true }).mockRejectedValueOnce(new Error('unavailable'))
    const result = discoverChapters(source)
    await vi.runAllTimersAsync()
    expect(await result).toMatchObject({ truncated: true, chapters: expect.arrayContaining([{ url: href(pageOne[0]), title: pageOne[0].name, number: 1 }]) })
  })

  it('never evaluates non-JSON flight expressions or enables the adapter for an unrelated host', async () => {
    const malicious = '<script>self.__next_f.push((window.compromised = true, [1,"anything"]))</script>'
    downloader.mockResolvedValue({ url: source, html: `<h1>Example</h1>${chapters(1, 2)}${malicious}<button aria-label="Trang 2">2</button>` })
    expect((await discoverChapters(source)).truncated).toBe(true)
    expect((window as unknown as { compromised?: boolean }).compromised).toBeUndefined()
    expect(indexDownloader).not.toHaveBeenCalled()
    downloader.mockResolvedValue({ url: base, html: html() })
    await expect(discoverChapters(base)).rejects.toMatchObject({ code: 'CHAPTER_CATALOG_EMPTY' })
    expect(indexDownloader).not.toHaveBeenCalled()
  })
})
