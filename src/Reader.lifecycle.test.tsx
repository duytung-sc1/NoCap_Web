// @vitest-environment jsdom
import { afterEach, beforeEach, describe, expect, it, vi } from 'vitest'
import { act, cleanup, fireEvent, render, screen, waitFor } from '@testing-library/react'
import { ReaderPane } from './Reader'
import type { ReaderSearchSource } from './readerSearch'

const fixture = vi.hoisted(() => ({ getPage: vi.fn(), convert: vi.fn(), loadPdf: vi.fn(), renderPage: vi.fn() }))
vi.mock('mammoth', () => ({ convertToHtml: fixture.convert }))
vi.mock('pdfjs-dist', () => ({
  GlobalWorkerOptions: {},
  getDocument: () => { fixture.loadPdf(); return { promise: Promise.resolve({ numPages: 3, getPage: fixture.getPage, getOutline: async () => null }), destroy: async () => {} } },
  TextLayer: class {
    options: { container: HTMLElement; textContentSource: { items: Array<{ str: string }> } }
    constructor(options: { container: HTMLElement; textContentSource: { items: Array<{ str: string }> } }) { this.options = options }
    async render() { this.options.container.textContent = this.options.textContentSource.items.map(item => item.str).join('') }
    cancel() {}
  },
}))
function deferred<T>() {
  let resolve!: (value: T) => void
  const promise = new Promise<T>(done => { resolve = done })
  return { promise, resolve }
}
const base = { fontSize: 100, theme: 'paper' as const, onLocation: vi.fn(), onSelection: vi.fn(), onControls: vi.fn() }
const scrollDescriptor = Object.getOwnPropertyDescriptor(Element.prototype, 'scrollIntoView')
const rangeRectsDescriptor = Object.getOwnPropertyDescriptor(Range.prototype, 'getClientRects')
beforeEach(() => {
  fixture.loadPdf.mockClear()
  fixture.renderPage.mockReset().mockImplementation(() => ({ promise: Promise.resolve(), cancel() {} }))
  fixture.getPage.mockReset().mockImplementation(async (page: number) => {
    if (!Number.isInteger(page) || page < 1 || page > 3) throw new Error('Invalid PDF page')
    return { getViewport: ({ scale }: { scale: number }) => ({ width: 800 * scale, height: 1100 * scale, scale, userUnit: 1 }),
      render: fixture.renderPage, getTextContent: async () => ({ items: [{ str: `PDF page ${page}` }] }) }
  })
  fixture.convert.mockReset()
  base.onLocation.mockClear()
  base.onSelection.mockClear()
  base.onControls.mockClear()
  vi.stubGlobal('ResizeObserver', class { observe() {} disconnect() {} })
  vi.stubGlobal('devicePixelRatio', 1)
  vi.spyOn(HTMLCanvasElement.prototype, 'getContext').mockReturnValue({} as CanvasRenderingContext2D)
})
afterEach(() => {
  cleanup(); vi.restoreAllMocks(); vi.unstubAllGlobals()
  if (scrollDescriptor) Object.defineProperty(Element.prototype, 'scrollIntoView', scrollDescriptor)
  else delete (Element.prototype as unknown as { scrollIntoView?: unknown }).scrollIntoView
  if (rangeRectsDescriptor) Object.defineProperty(Range.prototype, 'getClientRects', rangeRectsDescriptor)
  else delete (Range.prototype as unknown as { getClientRects?: unknown }).getClientRects
})

describe('document reader restoration', () => {
  it('publishes search only after DOCX decoding and keeps its engine stable while notes or comfort settings change', async () => {
    const pending = deferred<{ value: string }>(); fixture.convert.mockReturnValue(pending.promise)
    const ready = vi.fn<(source: ReaderSearchSource | null) => void>()
    const bytes = new ArrayBuffer(20)
    const book = { id: 'search-docx', title: 'QA', author: 'QA', format: 'DOCX' }
    const { rerender, unmount } = render(<ReaderPane {...base} book={book} bytes={bytes} onSearchReady={ready} />)
    expect(ready).toHaveBeenLastCalledWith(null)
    await act(async () => { pending.resolve({ value: '<p>First <strong>Tiếng Việt</strong>.</p><p>More Tiếng Việt.</p>' }); await pending.promise })
    await waitFor(() => expect(typeof ready.mock.calls.at(-1)?.[0]).toBe('function'))
    const source = ready.mock.calls.at(-1)![0]!
    const result = await source('tieng viet', new AbortController().signal)
    expect(result.hits).toHaveLength(2)
    const readyCalls = ready.mock.calls.length
    rerender(<ReaderPane {...base} book={book} bytes={bytes} onSearchReady={ready} fontSize={125} annotations={[{ id: 'new-note', text: 'Tiếng Việt', locatorJson: result.hits[1].locatorJson, color: 'BLUE' }]} />)
    expect(ready).toHaveBeenCalledTimes(readyCalls)
    expect(fixture.convert).toHaveBeenCalledTimes(1)
    expect((await source('tieng viet', new AbortController().signal)).hits).toHaveLength(2)
    unmount()
    expect(ready).toHaveBeenLastCalledWith(null)
    await expect(source('tieng viet', new AbortController().signal)).rejects.toMatchObject({ name: 'AbortError' })
  })

  it('searches PDF pages outside the viewport without page renders, position events, or PDF reloads', async () => {
    const ready = vi.fn<(source: ReaderSearchSource | null) => void>()
    render(<ReaderPane {...base} book={{ id: 'search-pdf', title: 'QA', author: 'QA', format: 'PDF' }} bytes={new ArrayBuffer(20)} onSearchReady={ready} />)
    await screen.findByText('PDF page 1')
    const renders = fixture.renderPage.mock.calls.length
    const locations = base.onLocation.mock.calls.length
    const source = ready.mock.calls.at(-1)![0]!
    const result = await source('page 3', new AbortController().signal)
    expect(result.hits).toHaveLength(1)
    expect(JSON.parse(result.hits[0].locatorJson)).toMatchObject({ type: 'PDF', pageNumber: 3, selectedText: 'page 3', startOffset: 4, endOffset: 10 })
    expect(screen.getByText('PDF page 1')).toBeTruthy()
    expect(screen.getByText('Trang 1 / 3')).toBeTruthy()
    expect(fixture.renderPage).toHaveBeenCalledTimes(renders)
    expect(base.onLocation).toHaveBeenCalledTimes(locations)
    expect(fixture.loadPdf).toHaveBeenCalledTimes(1)
  })

  it('invalidates the previous book source when reader bytes are replaced before an async search finishes', async () => {
    const ready = vi.fn<(source: ReaderSearchSource | null) => void>()
    const book = { id: 'search-text', title: 'QA', author: 'QA', format: 'TXT' }
    const first = new TextEncoder().encode('First source target.').buffer as ArrayBuffer
    const second = new TextEncoder().encode('Second source target.').buffer as ArrayBuffer
    const { rerender } = render(<ReaderPane {...base} book={book} bytes={first} onSearchReady={ready} />)
    await screen.findByText('First source target.')
    const oldSource = ready.mock.calls.at(-1)![0]!
    const pending = oldSource('target', new AbortController().signal)
    const assertion = expect(pending).rejects.toMatchObject({ name: 'AbortError' })
    rerender(<ReaderPane {...base} book={book} bytes={second} onSearchReady={ready} />)
    await screen.findByText('Second source target.')
    await assertion
    const currentSource = ready.mock.calls.at(-1)![0]!
    expect(currentSource).not.toBe(oldSource)
    expect((await currentSource('second', new AbortController().signal)).hits).toHaveLength(1)
  })

  it('recovers from a failed DOCX conversion when replacement bytes have the same length', async () => {
    fixture.convert.mockRejectedValueOnce(new Error('Corrupt DOCX')).mockResolvedValueOnce({ value: '<p>Recovered DOCX</p>' })
    const book = { id: 'qa-docx', title: 'QA', author: 'QA', format: 'DOCX' }
    const { rerender } = render(<ReaderPane {...base} book={book} bytes={new ArrayBuffer(20)} />)
    await screen.findByText('Không đọc được nội dung tài liệu này.')
    rerender(<ReaderPane {...base} book={book} bytes={new ArrayBuffer(20)} />)
    expect(await screen.findByText('Recovered DOCX')).toBeTruthy()
    expect(screen.queryByText('Không đọc được nội dung tài liệu này.')).toBeNull()
  })

  it('does not save a selection from the preceding PDF page while the next page is loading', async () => {
    const pending = deferred<Awaited<ReturnType<typeof fixture.getPage>>>()
    const original = fixture.getPage.getMockImplementation()!
    const nextPage = await original(2)
    fixture.getPage.mockImplementation((page: number) => page === 2 ? pending.promise : original(page))
    const { container } = render(<ReaderPane {...base} book={{ id: 'qa-pdf', title: 'QA', author: 'QA', format: 'PDF' }} bytes={new ArrayBuffer(20)} />)
    const text = await screen.findByText('PDF page 1')
    const range = document.createRange()
    range.selectNodeContents(text)
    Object.assign(range, { getClientRects: () => [] })
    vi.spyOn(window, 'getSelection').mockReturnValue({ rangeCount: 1, toString: () => 'PDF page 1', getRangeAt: () => range } as unknown as Selection)
    act(() => { base.onControls.mock.calls.at(-1)![0].next() })
    expect(screen.getByText('Trang 2 / 3')).toBeTruthy()
    fireEvent.mouseUp(container.querySelector('.pdf-text-layer')!)
    expect(base.onSelection).not.toHaveBeenCalled()
    act(() => { pending.resolve(nextPage) })
    const loaded = await screen.findByText('PDF page 2')
    range.selectNodeContents(loaded)
    vi.mocked(window.getSelection).mockReturnValue({ rangeCount: 1, toString: () => 'PDF page 2', getRangeAt: () => range } as unknown as Selection)
    fireEvent.mouseUp(container.querySelector('.pdf-text-layer')!)
    expect(JSON.parse(base.onSelection.mock.calls.at(-1)![1]).pageNumber).toBe(2)
  })

  it('restores an entire highlight selected across two text paragraphs', async () => {
    const bytes = new TextEncoder().encode('<p>First paragraph ends here.</p><p>Second paragraph starts here.</p>').buffer as ArrayBuffer
    const book = { id: 'qa-html', title: 'QA', author: 'QA', format: 'HTML' }
    const { container, rerender } = render(<ReaderPane {...base} book={book} bytes={bytes} />)
    const first = await screen.findByText('First paragraph ends here.')
    const second = screen.getByText('Second paragraph starts here.')
    const range = document.createRange()
    range.setStart(first.firstChild!, 6); range.setEnd(second.firstChild!, 16)
    const selection = window.getSelection()!
    selection.removeAllRanges(); selection.addRange(range)
    fireEvent.mouseUp(container.querySelector('.text-host')!)
    const [text, locatorJson] = base.onSelection.mock.calls.at(-1)!
    rerender(<ReaderPane {...base} book={book} bytes={bytes} annotations={[{ id: 'cross-paragraph', text, locatorJson, color: 'YELLOW' }]} />)
    await waitFor(() => expect(Array.from(container.querySelectorAll('mark[data-nocap-highlight]')).map(mark => mark.textContent).join('')).toBe(text))
    expect(container.querySelectorAll('article > p')).toHaveLength(2)
  })

  it('keeps source emphasis when a highlight is redrawn and later removed', async () => {
    const bytes = new TextEncoder().encode('<p>Before <strong>important words</strong> after.</p>').buffer as ArrayBuffer
    const book = { id: 'qa-html', title: 'QA', author: 'QA', format: 'HTML' }
    const annotations = [{ id: 'emphasis', text: 'important words', locatorJson: JSON.stringify({ type: 'TEXT', blockIndex: 0, characterOffset: 7 }), color: 'YELLOW' }]
    const { container, rerender } = render(<ReaderPane {...base} book={book} bytes={bytes} annotations={annotations} />)
    await waitFor(() => expect(container.querySelector('mark')?.textContent).toBe('important words'))
    rerender(<ReaderPane {...base} book={book} bytes={bytes} annotations={[{ ...annotations[0], color: 'BLUE' }]} />)
    rerender(<ReaderPane {...base} book={book} bytes={bytes} annotations={[]} />)
    expect(container.querySelector('strong')?.textContent).toBe('important words')
    expect(container.querySelector('article')?.textContent).toBe('Before important words after.')
    expect(container.querySelector('mark')).toBeNull()
  })

  it('retains cross-paragraph highlights when browser selection adds layout line breaks', async () => {
    const bytes = new TextEncoder().encode('<p>First paragraph.</p>\n<p>Second paragraph.</p>').buffer as ArrayBuffer
    const book = { id: 'qa-html', title: 'QA', author: 'QA', format: 'HTML' }
    const { container, rerender } = render(<ReaderPane {...base} book={book} bytes={bytes} />)
    const first = await screen.findByText('First paragraph.')
    const second = screen.getByText('Second paragraph.')
    const range = document.createRange()
    range.setStart(first.firstChild!, 0); range.setEnd(second.firstChild!, 17)
    const visibleQuotation = 'First paragraph.\n\nSecond paragraph.'
    vi.spyOn(window, 'getSelection').mockReturnValue({ rangeCount: 1, toString: () => visibleQuotation, getRangeAt: () => range } as unknown as Selection)
    fireEvent.mouseUp(container.querySelector('.text-host')!)
    const [text, locatorJson] = base.onSelection.mock.calls.at(-1)!
    expect(text).toBe(visibleQuotation)
    rerender(<ReaderPane {...base} book={book} bytes={bytes} annotations={[{ id: 'layout-breaks', text, locatorJson, color: 'YELLOW' }]} />)
    expect(Array.from(container.querySelectorAll('mark')).map(mark => mark.textContent).join('')).toBe('First paragraph.\nSecond paragraph.')
  })

  it.each([
    { language: 'vi-VN', ui: 'en' as const, expected: 'Be Vietnam Pro' },
    { language: 'en-US', ui: 'vi' as const, expected: 'Atkinson Hyperlegible' },
    { language: undefined, ui: 'en' as const, expected: 'Be Vietnam Pro' },
  ])('uses document language $language for sans reading with $ui controls', async ({ language, ui, expected }) => {
    const text = 'Tiếng Việt: Nguyễn, trường, quyền riêng tư, ĐỖ. English text.'
    const bytes = new TextEncoder().encode(text).buffer as ArrayBuffer
    const book = { id: 'qa-text', title: 'QA', author: 'QA', format: 'TXT', language }
    const { rerender } = render(<ReaderPane {...base} book={book} bytes={bytes} lang={ui} fontFamily="sans" />)
    const paragraph = await screen.findByText(text)
    expect(paragraph.closest('article')?.style.fontFamily).toMatch(new RegExp(`^"${expected}"`))

    // Changing only the controls must keep the document's typeface and content.
    rerender(<ReaderPane {...base} book={book} bytes={bytes} lang={ui === 'vi' ? 'en' : 'vi'} fontFamily="sans" />)
    expect(screen.getByText(text).closest('article')?.style.fontFamily).toMatch(new RegExp(`^"${expected}"`))
  })

  it('never renders or publishes an out-of-range page restored from an older PDF', async () => {
    render(<ReaderPane {...base} book={{ id: 'qa-pdf', title: 'QA', author: 'QA', format: 'PDF' }} bytes={new ArrayBuffer(20)} initial={JSON.stringify({ type: 'PDF', pageNumber: 99 })} />)
    await screen.findByText('Trang 3 / 3')
    await waitFor(() => expect(fixture.getPage).toHaveBeenCalled())
    expect(fixture.getPage.mock.calls.every(([page]) => Number.isInteger(page) && page >= 1 && page <= 3)).toBe(true)
    expect(base.onLocation.mock.calls.every(([location]) => location.progression >= 0 && location.progression <= 1)).toBe(true)
    expect(screen.queryByText('Không hiển thị được trang PDF này.')).toBeNull()
  })

  it('retains a chapter navigation request while DOCX content is still converting', async () => {
    const pending = deferred<{ value: string }>(); fixture.convert.mockReturnValue(pending.promise)
    const scroll = vi.fn()
    Object.defineProperty(Element.prototype, 'scrollIntoView', { configurable: true, value: scroll })
    vi.stubGlobal('CSS', { escape: (value: string) => value })
    render(<ReaderPane {...base} book={{ id: 'qa-docx', title: 'QA', author: 'QA', format: 'DOCX' }} bytes={new ArrayBuffer(20)} navigateTarget="#second" />)
    await act(async () => { pending.resolve({ value: '<h1 id="first">First</h1><p>Opening</p><h2 id="second">Second</h2><p>Target</p>' }); await pending.promise })
    await screen.findByText('Second')
    await waitFor(() => expect(scroll).toHaveBeenCalled())
  })

  it('waits for text conversion and replays a note source request without decoding again', async () => {
    const pending = deferred<{ value: string }>(); fixture.convert.mockReturnValue(pending.promise)
    const reached: string[] = []
    Object.defineProperty(Range.prototype, 'getClientRects', { configurable: true, value: function (this: Range) {
      reached.push(this.toString())
      return [{ top: 300, left: 0, width: 100, height: 20 }]
    } })
    const book = { id: 'note-docx', title: 'QA', author: 'QA', format: 'DOCX' }
    const bytes = new ArrayBuffer(20)
    const locatorJson = JSON.stringify({ type: 'TEXT', blockIndex: 1, characterOffset: 7, selectedText: 'target phrase', textStartOffset: 13, textEndOffset: 26, scrollOffsetPx: 999 })
    const { container, rerender } = render(<ReaderPane {...base} book={book} bytes={bytes} navigateLocator={{ locatorJson, requestId: 1 }} />)
    expect(reached).toHaveLength(0)
    await act(async () => { pending.resolve({ value: '<p>First.</p><p>Before target phrase after.</p>' }); await pending.promise })
    await screen.findByText('Before target phrase after.')
    const host = container.querySelector<HTMLElement>('.text-host')!
    Object.defineProperties(host, { clientHeight: { configurable: true, value: 400 }, scrollHeight: { configurable: true, value: 2000 } })
    await waitFor(() => expect(reached).toContain('target phrase'))
    expect(host.scrollTop).toBe(228)

    host.scrollTop = 0
    rerender(<ReaderPane {...base} book={book} bytes={bytes} navigateLocator={{ locatorJson, requestId: 2 }} />)
    await waitFor(() => expect(host.scrollTop).toBe(228))
    expect(fixture.convert).toHaveBeenCalledTimes(1)

    // Editing the note decorates the same document; it must not repeat the jump.
    host.scrollTop = 450
    rerender(<ReaderPane {...base} book={book} bytes={bytes} navigateLocator={{ locatorJson, requestId: 2 }} annotations={[{ id: 'note', text: 'target phrase', locatorJson, color: 'GREEN' }]} />)
    await waitFor(() => expect(container.querySelector('mark')?.textContent).toBe('target phrase'))
    expect(host.scrollTop).toBe(450)
    expect(fixture.convert).toHaveBeenCalledTimes(1)
  })

  it('restores a text position note using its stored scroll when no quotation exists', async () => {
    const bytes = new TextEncoder().encode('A plain text document.').buffer as ArrayBuffer
    const locatorJson = JSON.stringify({ type: 'TEXT', blockIndex: 0, characterOffset: 0, scrollOffsetPx: 460 })
    const { container } = render(<ReaderPane {...base} book={{ id: 'position-text', title: 'QA', author: 'QA', format: 'TXT' }} bytes={bytes} navigateLocator={{ locatorJson, requestId: 1 }} />)
    await screen.findByText('A plain text document.')
    await waitFor(() => expect(container.querySelector('.text-host')!.scrollTop).toBe(460))
  })

  it('waits for the requested PDF page and reveals the quotation again without reloading the PDF', async () => {
    const pending = deferred<Awaited<ReturnType<typeof fixture.getPage>>>()
    const original = fixture.getPage.getMockImplementation()!
    const nextPage = await original(2)
    fixture.getPage.mockImplementation((page: number) => page === 2 ? pending.promise : original(page))
    const reached: string[] = []
    Object.defineProperty(Range.prototype, 'getClientRects', { configurable: true, value: function (this: Range) {
      reached.push(this.toString())
      return [{ top: 300, left: 0, width: 100, height: 20 }]
    } })
    const book = { id: 'note-pdf', title: 'QA', author: 'QA', format: 'PDF' }
    const bytes = new ArrayBuffer(20)
    const { container, rerender } = render(<ReaderPane {...base} book={book} bytes={bytes} />)
    await screen.findByText('PDF page 1')
    const host = container.querySelector<HTMLElement>('.pdf-host')!
    Object.defineProperty(host, 'clientHeight', { configurable: true, value: 400 })
    const locatorJson = JSON.stringify({ type: 'PDF', pageIndex: 1, selectedText: 'page 2', startOffset: 4, endOffset: 10 })
    rerender(<ReaderPane {...base} book={book} bytes={bytes} navigateLocator={{ locatorJson, requestId: 1 }} />)
    await screen.findByText('Trang 2 / 3')
    expect(reached).toHaveLength(0)
    act(() => { pending.resolve(nextPage) })
    await screen.findByText('PDF page 2')
    await waitFor(() => expect(reached).toEqual(['page 2']))
    expect(host.scrollTop).toBe(228)
    const pageRenders = fixture.getPage.mock.calls.length

    host.scrollTop = 0
    rerender(<ReaderPane {...base} book={book} bytes={bytes} navigateLocator={{ locatorJson, requestId: 2 }} />)
    await waitFor(() => expect(reached).toEqual(['page 2', 'page 2']))
    expect(host.scrollTop).toBe(228)
    expect(fixture.getPage).toHaveBeenCalledTimes(pageRenders)
    expect(fixture.loadPdf).toHaveBeenCalledTimes(1)
  })

  it('keeps the visible PDF position when the notes panel changes its width without replaying a source jump', async () => {
    let width = 800
    const observers: Array<() => void> = []
    vi.stubGlobal('ResizeObserver', class {
      constructor(callback: () => void) { observers.push(callback) }
      observe() {}
      disconnect() {}
    })
    vi.spyOn(Element.prototype, 'clientWidth', 'get').mockImplementation(() => width)
    Object.defineProperty(Range.prototype, 'getClientRects', { configurable: true, value: () => [{ top: 300, left: 0, width: 100, height: 20 }] })
    const locatorJson = JSON.stringify({ type: 'PDF', pageNumber: 1, selectedText: 'page 1', startOffset: 4, endOffset: 10 })
    const { container } = render(<ReaderPane {...base} book={{ id: 'resize-pdf', title: 'QA', author: 'QA', format: 'PDF' }} bytes={new ArrayBuffer(20)} navigateLocator={{ locatorJson, requestId: 1 }} />)
    await screen.findByText('PDF page 1')
    const host = container.querySelector<HTMLElement>('.pdf-host')!
    await waitFor(() => expect(host.scrollTop).toBe(300))
    host.scrollTop = 660
    const previousRenders = fixture.getPage.mock.calls.length
    act(() => { width = 400; observers.at(-1)!() })
    await waitFor(() => expect(fixture.getPage.mock.calls.length).toBeGreaterThan(previousRenders))
    await waitFor(() => expect(host.scrollTop).toBe(330))
    expect(fixture.loadPdf).toHaveBeenCalledTimes(1)
  })

  it.each([0, -2, 2.7])('restores malformed PDF page %s to a valid integer', async requested => {
    render(<ReaderPane {...base} book={{ id: 'qa-pdf', title: 'QA', author: 'QA', format: 'PDF' }} bytes={new ArrayBuffer(20)} initial={JSON.stringify({ type: 'PDF', pageNumber: requested })} />)
    await waitFor(() => expect(fixture.getPage).toHaveBeenCalled())
    expect(fixture.getPage.mock.calls.every(([page]) => Number.isInteger(page) && page >= 1 && page <= 3)).toBe(true)
  })
})
