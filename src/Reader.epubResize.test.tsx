// @vitest-environment jsdom
import { afterEach, expect, it, vi } from 'vitest'
import { act, cleanup, render, waitFor } from '@testing-library/react'
import { ReaderPane } from './Reader'

const fixture = vi.hoisted(() => ({ open: vi.fn() }))
vi.mock('epubjs', () => ({ default: fixture.open }))
vi.mock('pdfjs-dist', () => ({ GlobalWorkerOptions: {}, getDocument: vi.fn(), TextLayer: class {} }))

afterEach(() => { cleanup(); vi.restoreAllMocks(); vi.unstubAllGlobals() })

it('keeps a responsive EPUB rendition when notes change its viewport and disconnects on unmount', async () => {
  let width = 800
  let notify!: ResizeObserverCallback
  let frame: FrameRequestCallback | undefined
  const observe = vi.fn(), disconnect = vi.fn()
  vi.stubGlobal('ResizeObserver', class {
    constructor(callback: ResizeObserverCallback) { notify = callback }
    observe = observe
    disconnect = disconnect
  })
  vi.stubGlobal('requestAnimationFrame', (callback: FrameRequestCallback) => { frame = callback; return 1 })
  vi.stubGlobal('cancelAnimationFrame', () => { frame = undefined })
  const view = {
    started: Promise.resolve(),
    on: vi.fn(), off: vi.fn(),
    themes: { fontSize: vi.fn(), default: vi.fn() },
    hooks: { render: { register: vi.fn() } },
    display: vi.fn(async () => {}),
    getContents: () => [],
    resize: vi.fn(), destroy: vi.fn(),
    manager: {
      container: { scrollTop: 0, scrollLeft: 0 }, scrollTop: 0, scrollLeft: 0,
      scrollTo() {}, scrollBy() {},
      views: { all: () => [], find: () => undefined },
    },
  }
  const book = {
    ready: Promise.resolve(),
    loaded: { metadata: Promise.resolve({ language: 'vi' }), navigation: Promise.resolve({ toc: [] }) },
    spine: { first: () => undefined, each() {} },
    renderTo: vi.fn(() => view), destroy: vi.fn(),
  }
  Object.assign(view, { book })
  fixture.open.mockReturnValue(book)

  const { container, unmount } = render(<ReaderPane
    book={{ id: 'resize-epub', title: 'EPUB', author: 'QA', format: 'EPUB' }}
    bytes={new ArrayBuffer(20)} fontSize={100} theme="paper"
    onLocation={vi.fn()} onSelection={vi.fn()} onControls={vi.fn()}
  />)
  const host = container.querySelector<HTMLElement>('.epub-host')!
  vi.spyOn(host, 'getBoundingClientRect').mockImplementation(() => ({ width, height: 600 }) as DOMRect)
  Object.defineProperty(host, 'clientWidth', { get: () => width - 15 })
  Object.defineProperty(host, 'clientHeight', { get: () => 600 })
  await waitFor(() => expect(observe).toHaveBeenCalledWith(host, { box: 'border-box' }))
  expect(book.renderTo).toHaveBeenCalledWith(host, expect.objectContaining({
    width: '100%', height: '100%', flow: 'scrolled-doc', manager: 'continuous', overflow: 'scroll',
  }))

  act(() => {
    width = 420
    notify([], {} as ResizeObserver)
    frame!(0)
  })
  expect(view.resize).toHaveBeenCalledTimes(1)
  expect(view.resize).toHaveBeenCalledWith()
  expect(fixture.open).toHaveBeenCalledTimes(1)
  expect(book.renderTo).toHaveBeenCalledTimes(1)
  expect(view.display).toHaveBeenCalledTimes(1)

  unmount()
  expect(disconnect).toHaveBeenCalledTimes(1)
  expect(view.destroy).toHaveBeenCalledTimes(1)
  expect(book.destroy).toHaveBeenCalledTimes(1)
})
