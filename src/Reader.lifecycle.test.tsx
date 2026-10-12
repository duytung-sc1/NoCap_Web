// @vitest-environment jsdom
import { afterEach, beforeEach, describe, expect, it, vi } from 'vitest'
import { act, cleanup, render, screen, waitFor } from '@testing-library/react'
import { ReaderPane } from './Reader'

const fixture = vi.hoisted(() => ({ getPage: vi.fn(), convert: vi.fn() }))
vi.mock('mammoth', () => ({ convertToHtml: fixture.convert }))
vi.mock('pdfjs-dist', () => ({
  GlobalWorkerOptions: {},
  getDocument: () => ({ promise: Promise.resolve({ numPages: 3, getPage: fixture.getPage, getOutline: async () => null }), destroy: async () => {} }),
  TextLayer: class { async render() {} cancel() {} },
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
      render: () => ({ promise: Promise.resolve(), cancel() {} }), getTextContent: async () => ({ items: [] }) }
  })
  fixture.convert.mockReset()
  base.onLocation.mockClear()
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
