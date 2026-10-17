// @vitest-environment jsdom
import { describe, expect, it, vi } from 'vitest'
import { EpubCFI } from 'epubjs'
import type EpubBook from 'epubjs/types/book'
import type Section from 'epubjs/types/section'
import type { PDFDocumentProxy } from 'pdfjs-dist'
import { createArticleSearchSource, createEpubSearchSource, createPdfSearchSource } from './readerSearchSources'
import { rangeFromOffsets } from './readerPositions'

const signal = () => new AbortController().signal
function article(html: string) {
  const element = document.createElement('article')
  element.innerHTML = html
  return element
}
function epubFixture(chapters: string[]) {
  const documents = chapters.map(html => new DOMParser().parseFromString(`<html xmlns="http://www.w3.org/1999/xhtml"><head><title>Publication</title></head><body>${html}</body></html>`, 'application/xhtml+xml'))
  const sections = documents.map((document, index) => ({
    index, href: `chapter-${index}.xhtml`, url: `/OEBPS/chapter-${index}.xhtml`, document,
    load: vi.fn(), unload: vi.fn(),
    cfiFromRange: (range: Range) => new EpubCFI(range, `/6/${(index + 1) * 2}[chapter-${index}]`).toString(),
  }))
  const load = vi.fn(async (url: string) => documents[sections.findIndex(section => section.url === url)].cloneNode(true) as Document)
  const book = { spine: { each: (visit: (section: Section) => void) => sections.forEach(section => visit(section as unknown as Section)) }, load } as unknown as EpubBook
  return { book, sections, documents, load }
}

describe('in-book search sources', () => {
  it('matches rendered inline and block text while preserving repeated occurrence offsets', async () => {
    const root = article('<p data-nocap-block="0">First <strong>Tiếng</strong> Việt.</p><p data-nocap-block="1">Second Tiếng Việt.</p>')
    const search = createArticleSearchSource(root, () => true)
    const result = await search('tieng viet', signal())
    expect(result.hits).toHaveLength(2)
    const locators = result.hits.map(hit => JSON.parse(hit.locatorJson))
    expect(locators.map(locator => locator.blockIndex)).toEqual([0, 1])
    expect(locators.map(locator => root.textContent!.slice(locator.textStartOffset, locator.textEndOffset))).toEqual(['Tiếng Việt', 'Tiếng Việt'])
    expect(locators[1].textStartOffset).toBeGreaterThan(locators[0].textEndOffset)
    expect(rangeFromOffsets(root, locators[1].textStartOffset, locators[1].textEndOffset)?.toString()).toBe('Tiếng Việt')
    const acrossBlocks = await search('Việt. Second', signal())
    expect(acrossBlocks.hits).toHaveLength(1)
    expect(acrossBlocks.hits[0].text).toBe('Việt.Second')
    expect(acrossBlocks.hits[0].excerpt).toContain('Việt.\nSecond')
    expect(root.querySelector('strong')?.textContent).toBe('Tiếng')
  })

  it('ignores executable/style/hidden text and remains valid after highlight decoration changes', async () => {
    const root = article('<p data-nocap-block="0">Visible <em>target</em> text.</p><style>invisible target</style><script>target()</script><p hidden>secret target</p>')
    const search = createArticleSearchSource(root, () => true)
    expect((await search('target', signal())).hits).toHaveLength(1)
    root.querySelector('em')!.innerHTML = '<mark data-nocap-highlight="note">target</mark>'
    expect((await search('visible target', signal())).hits).toHaveLength(1)
    expect((await search('secret', signal())).hits).toHaveLength(0)
  })

  it('reports an actual overflow and caps repeated text at 200 hits', async () => {
    const result = await createArticleSearchSource(article(`<p>${'word '.repeat(203)}</p>`), () => true)('word', signal())
    expect(result.hits).toHaveLength(200)
    expect(result.truncated).toBe(true)
    const exact = await createArticleSearchSource(article(`<p>${'word '.repeat(200)}</p>`), () => true)('word', signal())
    expect(exact.truncated).toBe(false)
  })

  it('searches the entire EPUB spine and round-trips an exact CFI across inline elements', async () => {
    const { book, sections, documents, load } = epubFixture(['<h1>First chapter</h1><p>Unrelated opening.</p>', '<h1>Second chapter</h1><p>Before <strong>tea</strong> party after.</p><p>tea party again.</p>'])
    const original = documents.map(document => new XMLSerializer().serializeToString(document))
    const progress = vi.fn()
    const result = await createEpubSearchSource(book, () => true)('tea party', signal(), progress)
    expect(result.scanned).toBe(2)
    expect(result.total).toBe(2)
    expect(result.hits).toHaveLength(2)
    const locators = result.hits.map(hit => JSON.parse(hit.locatorJson))
    expect(locators.map(locator => locator.href)).toEqual(['chapter-1.xhtml', 'chapter-1.xhtml'])
    for (const locator of locators) {
      expect(new EpubCFI(locator.locations.cfi).toRange(documents[1]).toString()).toBe('tea party')
    }
    expect(locators[0].locations.cfi).not.toBe(locators[1].locations.cfi)
    expect(result.hits[0].label).toBe('Second chapter')
    expect(load).toHaveBeenCalledTimes(2)
    expect(sections.every(section => !section.load.mock.calls.length && !section.unload.mock.calls.length)).toBe(true)
    expect(documents.map(document => new XMLSerializer().serializeToString(document))).toEqual(original)
    expect(progress).toHaveBeenLastCalledWith({ scanned: 2, total: 2 })
  })

  it('matches block boundaries in EPUB without inserting nodes into the chapter', async () => {
    const { book, documents } = epubFixture(['<p>before tea</p><p>party after.</p>'])
    const result = await createEpubSearchSource(book, () => true)('tea party', signal())
    const locator = JSON.parse(result.hits[0].locatorJson)
    expect(new EpubCFI(locator.locations.cfi).toRange(documents[0]).toString()).toBe('teaparty')
    expect(result.hits[0].excerpt).toContain('tea\nparty')
  })

  it('searches every PDF page without rendering and maps EOL matches back to raw TextLayer offsets', async () => {
    const render = vi.fn()
    const content = [
      [{ str: 'Cover only' }],
      [{ str: 'Before tea', hasEOL: true }, { str: 'party; tea', hasEOL: true }, { str: 'party.' }],
      [{ str: 'Last tea party' }],
    ]
    const getPage = vi.fn(async (page: number) => ({ render, getTextContent: async () => ({ items: content[page - 1] }) }))
    const pdf = { numPages: 3, getPage } as unknown as PDFDocumentProxy
    const progress = vi.fn()
    const result = await createPdfSearchSource(pdf, () => true)('tea party', signal(), progress)
    expect(result.hits.map(hit => hit.pageNumber)).toEqual([2, 2, 3])
    expect(result.scanned).toBe(3)
    expect(render).not.toHaveBeenCalled()
    const locators = result.hits.slice(0, 2).map(hit => JSON.parse(hit.locatorJson))
    expect(locators.map(locator => [locator.startOffset, locator.endOffset, locator.selectedText])).toEqual([[7, 15, 'teaparty'], [17, 25, 'teaparty']])
    expect(result.hits[0].excerpt).toContain('tea\nparty')
    expect(progress).toHaveBeenLastCalledWith({ scanned: 3, total: 3 })
  })

  it('reports image-only PDFs as lacking searchable text', async () => {
    const pdf = { numPages: 2, getPage: async () => ({ getTextContent: async () => ({ items: [] }) }) } as unknown as PDFDocumentProxy
    const result = await createPdfSearchSource(pdf, () => true)('book', signal())
    expect(result).toEqual({ hits: [], truncated: false, scanned: 2, total: 2, textAvailable: false })
  })

  it('aborts before loading any resources, including stale document sources', async () => {
    const { book, load } = epubFixture(['<p>word</p>'])
    const abort = new AbortController(); abort.abort()
    await expect(createEpubSearchSource(book, () => true)('word', abort.signal)).rejects.toMatchObject({ name: 'AbortError' })
    await expect(createEpubSearchSource(book, () => false)('word', signal())).rejects.toMatchObject({ name: 'AbortError' })
    expect(load).not.toHaveBeenCalled()
  })

  it('discards stale PDF extraction results before reporting progress or scanning another page', async () => {
    let finish!: (value: { items: Array<{ str: string }> }) => void
    const pending = new Promise<{ items: Array<{ str: string }> }>(resolve => { finish = resolve })
    const getPage = vi.fn(async () => ({ getTextContent: () => pending }))
    const progress = vi.fn()
    const controller = new AbortController()
    const search = createPdfSearchSource({ numPages: 3, getPage } as unknown as PDFDocumentProxy, () => true)
    const result = search('target', controller.signal, progress)
    // Attach rejection handling before completing the detached extraction.
    const assertion = expect(result).rejects.toMatchObject({ name: 'AbortError' })
    await vi.waitFor(() => expect(getPage).toHaveBeenCalledTimes(1))
    controller.abort()
    finish({ items: [{ str: 'target' }] })
    await assertion
    expect(progress).toHaveBeenCalledTimes(1)
    expect(getPage).toHaveBeenCalledTimes(1)
  })
})
