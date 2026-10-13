// @vitest-environment jsdom
import { afterEach, beforeEach, describe, expect, it, vi } from 'vitest'
import { act, cleanup, fireEvent, render, screen, waitFor } from '@testing-library/react'
import { ReaderPane } from './Reader'

const fixture = vi.hoisted(() => ({ getPage: vi.fn(), convert: vi.fn() }))
vi.mock('mammoth', () => ({ convertToHtml: fixture.convert }))
vi.mock('pdfjs-dist', () => ({
  GlobalWorkerOptions: {},
  getDocument: () => ({ promise: Promise.resolve({ numPages: 3, getPage: fixture.getPage, getOutline: async () => null }), destroy: async () => {} }),
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
beforeEach(() => {
  fixture.getPage.mockReset().mockImplementation(async (page: number) => {
    if (!Number.isInteger(page) || page < 1 || page > 3) throw new Error('Invalid PDF page')
    return { getViewport: ({ scale }: { scale: number }) => ({ width: 800 * scale, height: 1100 * scale, scale, userUnit: 1 }),
      render: () => ({ promise: Promise.resolve(), cancel() {} }), getTextContent: async () => ({ items: [{ str: `PDF page ${page}` }] }) }
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
})

describe('document reader restoration', () => {
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

  it.each([0, -2, 2.7])('restores malformed PDF page %s to a valid integer', async requested => {
    render(<ReaderPane {...base} book={{ id: 'qa-pdf', title: 'QA', author: 'QA', format: 'PDF' }} bytes={new ArrayBuffer(20)} initial={JSON.stringify({ type: 'PDF', pageNumber: requested })} />)
    await waitFor(() => expect(fixture.getPage).toHaveBeenCalled())
    expect(fixture.getPage.mock.calls.every(([page]) => Number.isInteger(page) && page >= 1 && page <= 3)).toBe(true)
  })
})
