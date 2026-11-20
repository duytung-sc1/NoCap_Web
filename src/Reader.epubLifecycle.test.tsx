// @vitest-environment jsdom
import { afterEach, beforeEach, expect, it, vi } from 'vitest'
import { act, cleanup, render, waitFor } from '@testing-library/react'
import { ReaderPane } from './Reader'

const fixture = vi.hoisted(() => ({ open: vi.fn() }))
vi.mock('epubjs', () => ({ default: fixture.open }))
vi.mock('pdfjs-dist', () => ({ GlobalWorkerOptions: {}, getDocument: vi.fn(), TextLayer: class {} }))

function deferred<T>() {
  let resolve!: (value: T) => void
  const promise = new Promise<T>(done => { resolve = done })
  return { promise, resolve }
}

function epub() {
  const listeners = new Map<string, (...args: unknown[]) => void>()
  const section = { index: 0, href: 'chapter.xhtml' }
  const book = {
    ready: Promise.resolve(),
    loaded: { metadata: Promise.resolve({ language: 'vi' }), navigation: Promise.resolve({ toc: [] }) },
    spine: { first: () => section, get: () => section, each() {} },
    locations: { generate: vi.fn(async (_size: number) => {}), percentageFromCfi: () => .7, cfiFromPercentage: () => 'cfi:next' },
    renderTo: vi.fn(), destroy: vi.fn(),
  }
  const view = {
    book, started: Promise.resolve(),
    on: (event: string, callback: (...args: unknown[]) => void) => { listeners.set(event, callback) },
    off: vi.fn(), themes: { fontSize: vi.fn(), default: vi.fn() },
    hooks: { render: { register: vi.fn() } },
    display: vi.fn(async (_target?: string) => {}), getContents: () => [],
    resize: vi.fn(), destroy: vi.fn(),
    manager: {
      container: { scrollTop: 0, scrollLeft: 0 }, scrollTop: 0, scrollLeft: 0,
      scrollTo() {}, scrollBy() {}, views: { all: () => [], find: () => undefined },
      resize: vi.fn(),
    },
  }
  book.renderTo.mockReturnValue(view)
  fixture.open.mockReturnValue(book)
  return { book, view, display: view.display, resize: view.manager.resize, emit: (event: string, ...args: unknown[]) => listeners.get(event)?.(...args) }
}

const props = {
  book: { id: 'lifecycle-epub', title: 'EPUB', author: 'QA', format: 'EPUB' },
  bytes: new ArrayBuffer(20), fontSize: 100, theme: 'paper' as const,
  onLocation: vi.fn(), onSelection: vi.fn(), onControls: vi.fn(),
}

beforeEach(() => {
  fixture.open.mockReset(); props.onLocation.mockClear(); props.onSelection.mockClear()
  vi.stubGlobal('ResizeObserver', class { observe() {} disconnect() {} })
})
afterEach(() => { cleanup(); vi.restoreAllMocks(); vi.unstubAllGlobals() })

it('retires initial EPUB restoration before pending location generation finishes', async () => {
  const { book, view, display } = epub(), pending = deferred<void>()
  book.locations.generate.mockReturnValue(pending.promise)
  const { unmount } = render(<ReaderPane {...props} initial={JSON.stringify({ type: 'STEALTH', href: 'chapter.xhtml', progression: .4 })} />)
  await waitFor(() => expect(book.locations.generate).toHaveBeenCalledOnce())
  unmount()
  await act(async () => { pending.resolve(); await pending.promise })
  expect(view.destroy).toHaveBeenCalledOnce()
  expect(book.destroy).toHaveBeenCalledOnce()
  expect(display).not.toHaveBeenCalled()
  expect(props.onLocation).not.toHaveBeenCalled()
})

it('ignores delayed EPUB location and selection events after closing the document', async () => {
  const { display, emit } = epub()
  const { unmount } = render(<ReaderPane {...props} />)
  await waitFor(() => expect(display).toHaveBeenCalledOnce())
  unmount(); props.onLocation.mockClear()
  act(() => {
    emit('relocated', { start: { cfi: 'cfi:old', href: 'chapter.xhtml' } })
    emit('selected', 'cfi:old', { window: { getSelection: () => ({ toString: () => 'Old selection' }) } })
  })
  expect(props.onLocation).not.toHaveBeenCalled()
  expect(props.onSelection).not.toHaveBeenCalled()
})

it('does not let a cancelled EPUB progression request overwrite the next location', async () => {
  const { book, display, emit } = epub(), pending = deferred<void>()
  book.locations.generate.mockReturnValueOnce(pending.promise)
  const request = { requestId: 1, href: 'old.xhtml', progression: .1 }
  const { rerender } = render(<ReaderPane {...props} />)
  await waitFor(() => expect(display).toHaveBeenCalledOnce())
  rerender(<ReaderPane {...props} navigateProgression={request} />)
  await waitFor(() => expect(book.locations.generate).toHaveBeenCalledOnce())
  rerender(<ReaderPane {...props} navigateProgression={request} navigateTarget="current.xhtml" />)
  await waitFor(() => expect(display).toHaveBeenLastCalledWith('current.xhtml'))
  await act(async () => { pending.resolve(); await pending.promise })
  props.onLocation.mockClear()
  act(() => emit('relocated', { start: { cfi: 'cfi:current', href: 'chapter.xhtml' } }))
  expect(display).toHaveBeenLastCalledWith('current.xhtml')
  expect(props.onLocation).toHaveBeenLastCalledWith(expect.objectContaining({ progression: .7 }))
})

it('finishes in-flight EPUB rendering before the next destination and does not publish its superseded progression', async () => {
  const { display, emit } = epub(), pending = deferred<void>()
  const request = { requestId: 1, href: 'old.xhtml', progression: .1 }
  const { rerender } = render(<ReaderPane {...props} />)
  await waitFor(() => expect(display).toHaveBeenCalledOnce())
  display.mockImplementation(target => target === 'old.xhtml' ? pending.promise : Promise.resolve())
  rerender(<ReaderPane {...props} navigateProgression={request} />)
  await waitFor(() => expect(display).toHaveBeenLastCalledWith('old.xhtml'))
  rerender(<ReaderPane {...props} navigateProgression={request} navigateTarget="current.xhtml" />)
  expect(display).toHaveBeenLastCalledWith('old.xhtml')
  props.onLocation.mockClear()
  act(() => emit('relocated', { start: { cfi: 'cfi:old', href: 'chapter.xhtml' } }))
  expect(props.onLocation).not.toHaveBeenCalled()
  await act(async () => { pending.resolve(); await pending.promise })
  await waitFor(() => expect(display).toHaveBeenLastCalledWith('current.xhtml'))
  expect(props.onLocation).not.toHaveBeenCalled()
})

it('retires a completed navigation destination so a later resize preserves the manually scrolled CFI', async () => {
  const { view, display, resize, emit } = epub()
  const { rerender } = render(<ReaderPane {...props} />)
  await waitFor(() => expect(display).toHaveBeenCalledOnce())
  rerender(<ReaderPane {...props} navigateTarget="chapter.xhtml#search-result" />)
  await waitFor(() => expect(display).toHaveBeenLastCalledWith('chapter.xhtml#search-result'))
  await act(async () => { await Promise.resolve() })
  act(() => emit('relocated', { start: { cfi: 'cfi:search-result', href: 'chapter.xhtml' } }))
  act(() => emit('relocated', { start: { cfi: 'cfi:manual-scroll', href: 'chapter.xhtml' } }))
  await act(async () => { await view.manager.resize(390, 600, 'cfi:manual-scroll') })
  expect(resize).toHaveBeenLastCalledWith(390, 600, 'cfi:manual-scroll')
})

it('generates one EPUB location table for overlapping progression requests and applies only the latest', async () => {
  const { book, display } = epub(), pending = deferred<void>()
  book.locations.generate.mockReturnValue(pending.promise)
  const { rerender } = render(<ReaderPane {...props} />)
  await waitFor(() => expect(display).toHaveBeenCalledOnce())
  rerender(<ReaderPane {...props} navigateProgression={{ requestId: 1, href: 'old.xhtml', progression: .1 }} />)
  await waitFor(() => expect(book.locations.generate).toHaveBeenCalledOnce())
  rerender(<ReaderPane {...props} navigateProgression={{ requestId: 2, href: 'latest.xhtml', progression: .8 }} />)
  expect(book.locations.generate).toHaveBeenCalledOnce()
  await act(async () => { pending.resolve(); await pending.promise })
  expect(display.mock.calls).toEqual([[undefined], ['latest.xhtml']])
  expect(props.onLocation).toHaveBeenCalledExactlyOnceWith(expect.objectContaining({ progression: .8 }))
})
