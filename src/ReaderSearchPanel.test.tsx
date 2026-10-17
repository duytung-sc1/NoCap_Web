// @vitest-environment jsdom
import { afterEach, beforeEach, describe, expect, it, vi } from 'vitest'
import { act, cleanup, fireEvent, render, screen } from '@testing-library/react'
import { ReaderSearchPanel, type ReaderSearchPanelProps } from './ReaderSearchPanel'
import type { ReaderSearchHit, ReaderSearchProgress, ReaderSearchResult, ReaderSearchSource } from './readerSearch'

const first: ReaderSearchHit = { id: 'first', text: 'A quiet river', excerpt: 'A quiet river', matchStart: 2, matchEnd: 7, locatorJson: '{"page":1}', pageNumber: 1 }
const second: ReaderSearchHit = { id: 'second', text: 'Another quiet river', excerpt: 'Another quiet river', matchStart: 8, matchEnd: 13, locatorJson: '{"page":2}', pageNumber: 2 }
const result: ReaderSearchResult = { hits: [first, second], truncated: false, scanned: 2, total: 2, textAvailable: true }

function props(overrides: Partial<ReaderSearchPanelProps> = {}): ReaderSearchPanelProps {
  return { open: true, lang: 'en', bookTitle: 'A quiet book', source: vi.fn(async () => result), format: 'pdf', onNavigate: vi.fn(), onClearActive: vi.fn(), onClose: vi.fn(), ...overrides }
}

async function scan() {
  await act(async () => { vi.advanceTimersByTime(250) })
}

beforeEach(() => { vi.useFakeTimers() })
afterEach(() => { cleanup(); vi.useRealTimers() })

describe('book search panel', () => {
  it('does not scan blank input, debounces typing and marks literal excerpts safely', async () => {
    const literal = { ...first, excerpt: '<script>quiet</script>', matchStart: 8, matchEnd: 13 }
    const handlers = props({ source: vi.fn(async () => ({ ...result, hits: [literal] })) })
    render(<ReaderSearchPanel {...handlers} />)
    const field = screen.getByLabelText('Search book text')
    expect(document.activeElement).toBe(field)
    await scan()
    expect(handlers.source).not.toHaveBeenCalled()
    fireEvent.change(field, { target: { value: 'qu' } })
    await act(async () => { vi.advanceTimersByTime(200) })
    fireEvent.change(field, { target: { value: 'quiet' } })
    await act(async () => { vi.advanceTimersByTime(249) })
    expect(handlers.source).not.toHaveBeenCalled()
    await act(async () => { vi.advanceTimersByTime(1) })
    expect(handlers.source).toHaveBeenCalledTimes(1)
    expect(document.querySelector('script')).toBeNull()
    expect(document.querySelector('mark')?.textContent).toBe('quiet')
    fireEvent.click(screen.getByRole('button', { name: /Page 1/ }))
    expect(handlers.onNavigate).toHaveBeenCalledWith(literal)
    expect(screen.getByRole('complementary', { name: 'Search in book' })).toBeTruthy()
  })

  it('ignores stale late results and progress from a source that disregards cancellation', async () => {
    const pending: Array<{ resolve: (value: ReaderSearchResult) => void; progress?: (value: ReaderSearchProgress) => void; signal: AbortSignal }> = []
    const source: ReaderSearchSource = (_query, signal, progress) => new Promise(resolve => { pending.push({ resolve, signal, progress }) })
    render(<ReaderSearchPanel {...props({ source })} />)
    fireEvent.change(screen.getByLabelText('Search book text'), { target: { value: 'old' } })
    await scan()
    fireEvent.change(screen.getByLabelText('Search book text'), { target: { value: 'new' } })
    expect(pending[0].signal.aborted).toBe(true)
    await scan()
    await act(async () => { pending[1].progress?.({ scanned: 1, total: 8 }) })
    expect(screen.getByText('1 / 8 pages')).toBeTruthy()
    await act(async () => { pending[0].progress?.({ scanned: 77, total: 99 }); pending[0].resolve(result) })
    expect(screen.queryByText('77 / 99 pages')).toBeNull()
    expect(screen.queryByText('A quiet river')).toBeNull()
    await act(async () => { pending[1].resolve({ ...result, hits: [second] }) })
    expect(screen.getByRole('button', { name: /Page 2/ })).toBeTruthy()
    expect(screen.queryByRole('button', { name: /Page 1/ })).toBeNull()
  })

  it('lets an in-flight trimmed query finish when only surrounding whitespace changes', async () => {
    let finish: (value: ReaderSearchResult) => void = () => {}
    let signal: AbortSignal | undefined
    const source: ReaderSearchSource = (_query, nextSignal) => { signal = nextSignal; return new Promise(resolve => { finish = resolve }) }
    const handlers = props({ source })
    render(<ReaderSearchPanel {...handlers} />)
    const field = screen.getByLabelText('Search book text')
    fireEvent.change(field, { target: { value: 'quiet' } })
    await scan()
    fireEvent.change(field, { target: { value: ' quiet ' } })
    expect(signal?.aborted).toBe(false)
    await act(async () => finish(result))
    expect(screen.getByRole('button', { name: /Page 1/ })).toBeTruthy()
    expect((field as HTMLInputElement).value).toBe(' quiet ')
    expect(handlers.onClearActive).toHaveBeenCalledTimes(1)
  })

  it('aborts on close, ignores a late result and resumes an unfinished query on reopening', async () => {
    const pending: Array<{ resolve: (value: ReaderSearchResult) => void; signal: AbortSignal }> = []
    const source: ReaderSearchSource = (_query, signal) => new Promise(resolve => pending.push({ resolve, signal }))
    const handlers = props({ source })
    const { rerender } = render(<ReaderSearchPanel {...handlers} />)
    fireEvent.change(screen.getByLabelText('Search book text'), { target: { value: 'quiet' } })
    await scan()
    rerender(<ReaderSearchPanel {...handlers} open={false} />)
    expect(pending[0].signal.aborted).toBe(true)
    await act(async () => pending[0].resolve(result))
    expect(document.querySelector('mark')).toBeNull()
    rerender(<ReaderSearchPanel {...handlers} open />)
    expect((screen.getByLabelText('Search book text') as HTMLInputElement).value).toBe('quiet')
    await scan()
    expect(pending).toHaveLength(2)
    await act(async () => pending[1].resolve(result))
    expect(screen.getByRole('button', { name: /Page 1/ })).toBeTruthy()
  })

  it('retains a completed search on reopening and does not steal focus on source-independent rerenders', async () => {
    const handlers = props()
    const { rerender } = render(<ReaderSearchPanel {...handlers} />)
    fireEvent.change(screen.getByLabelText('Search book text'), { target: { value: 'quiet' } })
    await scan()
    const resultButton = screen.getByRole('button', { name: /Page 1/ })
    resultButton.focus()
    rerender(<ReaderSearchPanel {...handlers} activeId="first" onClearActive={vi.fn()} />)
    expect(document.activeElement).toBe(resultButton)
    expect(resultButton.getAttribute('aria-current')).toBe('location')
    rerender(<ReaderSearchPanel {...handlers} open={false} />)
    rerender(<ReaderSearchPanel {...handlers} open />)
    await scan()
    expect(handlers.source).toHaveBeenCalledTimes(1)
    expect(screen.getByRole('button', { name: /Page 1/ })).toBeTruthy()
  })

  it('cancels old document searches when the source changes', async () => {
    let finish: (value: ReaderSearchResult) => void = () => {}
    let oldSignal: AbortSignal | undefined
    const source: ReaderSearchSource = (_query, signal) => { oldSignal = signal; return new Promise(resolve => { finish = resolve }) }
    const handlers = props({ source })
    const { rerender } = render(<ReaderSearchPanel {...handlers} />)
    fireEvent.change(screen.getByLabelText('Search book text'), { target: { value: 'quiet' } })
    await scan()
    rerender(<ReaderSearchPanel {...handlers} source={async () => ({ ...result, hits: [] })} />)
    expect(oldSignal?.aborted).toBe(true)
    await scan()
    await act(async () => finish(result))
    expect(screen.getByText('No matching passages.')).toBeTruthy()
    expect(document.querySelector('mark')).toBeNull()
  })

  it('navigates forwards and backwards with keyboard wrapping and clears the active hit', async () => {
    const handlers = props()
    const { rerender } = render(<ReaderSearchPanel {...handlers} />)
    const field = screen.getByLabelText('Search book text')
    fireEvent.change(field, { target: { value: 'quiet' } })
    await scan()
    fireEvent.keyDown(field, { key: 'Enter' })
    expect(handlers.onNavigate).toHaveBeenLastCalledWith(first)
    rerender(<ReaderSearchPanel {...handlers} activeId="first" />)
    fireEvent.keyDown(field, { key: 'Enter', shiftKey: true })
    expect(handlers.onNavigate).toHaveBeenLastCalledWith(second)
    rerender(<ReaderSearchPanel {...handlers} activeId="second" />)
    fireEvent.keyDown(field, { key: 'Enter' })
    expect(handlers.onNavigate).toHaveBeenLastCalledWith(first)
    fireEvent.click(screen.getByRole('button', { name: 'Clear search' }))
    expect((field as HTMLInputElement).value).toBe('')
    expect(handlers.onClearActive).toHaveBeenCalledTimes(2)
    expect(document.querySelector('mark')).toBeNull()
  })

  it('provides Vietnamese labels, a retryable error, and the result limit message', async () => {
    const source = vi.fn<ReaderSearchSource>().mockRejectedValueOnce(new Error('network')).mockResolvedValue({ ...result, truncated: true })
    const handlers = props({ lang: 'vi', source })
    render(<ReaderSearchPanel {...handlers} />)
    expect(screen.getByRole('complementary', { name: 'Tìm trong sách' })).toBeTruthy()
    fireEvent.change(screen.getByLabelText('Từ khóa trong sách'), { target: { value: 'quiet' } })
    await scan()
    expect(screen.getByRole('alert')).toBeTruthy()
    fireEvent.click(screen.getByRole('button', { name: 'Thử lại' }))
    await scan()
    expect(screen.getByText(/Hiển thị 200 kết quả đầu tiên/)).toBeTruthy()
    fireEvent.click(screen.getByRole('button', { name: 'Đóng bảng tìm kiếm' }))
    expect(handlers.onClose).toHaveBeenCalledTimes(1)
  })

  it('explains scanned PDF text limitations and unsupported image formats', async () => {
    const handlers = props({ source: vi.fn(async () => ({ ...result, hits: [], textAvailable: false })) })
    const { rerender } = render(<ReaderSearchPanel {...handlers} />)
    fireEvent.change(screen.getByLabelText('Search book text'), { target: { value: 'quiet' } })
    await scan()
    expect(screen.getByText(/This PDF has no searchable text layer/)).toBeTruthy()
    rerender(<ReaderSearchPanel {...handlers} format="cbz" />)
    expect(screen.getByText(/Images and CBZ comics have no searchable text layer/)).toBeTruthy()
    expect((screen.getByLabelText('Search book text') as HTMLInputElement).disabled).toBe(true)
    rerender(<ReaderSearchPanel {...handlers} lang="vi" format="image" />)
    expect(screen.getByText(/Tệp ảnh và truyện CBZ/)).toBeTruthy()
    expect(handlers.source).toHaveBeenCalledTimes(1)
  })
})
