// @vitest-environment jsdom
import { afterEach, beforeEach, describe, expect, it, vi } from 'vitest'
import { cleanup, fireEvent, render, screen, waitFor, within } from '@testing-library/react'
import { StealthReader } from './StealthReader'
import { readStealthCheckpoint, saveStealthCheckpoint } from './checkpoint'

vi.mock('./textExtractor', async importOriginal => ({
  ...await importOriginal<typeof import('./textExtractor')>(),
  extractBookRows: async () => Array.from({ length: 95 }, (_, index) => ({ index: index + 1, id: `REC-${index}`, category: 'QA', text: `Paragraph ${index}`, status: 'Ready', variance: '0%', timestamp: '00:00:00', sourceHref: 'chapter.xhtml' })),
}))
const book = { id: 'qa', title: 'QA', author: 'QA', format: 'TXT' }
const bytes = new ArrayBuffer(20)
const progress = vi.fn()
const close = vi.fn()
const props = { profile: 'ACCOUNT:qa', book, bytes, lang: 'vi' as const, onClose: close, onProgressChange: progress }
beforeEach(() => {
  localStorage.clear(); progress.mockClear(); close.mockClear()
  vi.stubGlobal('ResizeObserver', class { observe() {} disconnect() {} })
  Object.defineProperty(Element.prototype, 'scrollIntoView', { configurable: true, value: vi.fn() })
})
afterEach(() => { cleanup(); vi.restoreAllMocks(); vi.unstubAllGlobals() })

describe('Excel reading pages and restoration', () => {
  it('shows labelled paging buttons, opens each new page at the top and prevents out-of-range navigation', async () => {
    const { container } = render(<StealthReader {...props} />)
    const navigation = await screen.findByRole('navigation', { name: 'Điều hướng trang đọc' })
    await screen.findByRole('cell', { name: 'Paragraph 0' })
    const grid = container.querySelector<HTMLDivElement>('.excel-grid-container')!
    expect(within(navigation).getByRole('button', { name: 'Trang trước' }).hasAttribute('disabled')).toBe(true)
    grid.scrollTop = 600
    fireEvent.click(within(navigation).getByRole('button', { name: 'Trang sau' }))
    expect(screen.getByText('Trang 2 / 3')).toBeTruthy()
    expect(grid.scrollTop).toBe(0)
    expect(screen.queryByRole('cell', { name: 'Paragraph 0' })).toBeNull()
    expect(screen.getByRole('cell', { name: 'Paragraph 40' })).toBeTruthy()
    fireEvent.keyDown(window, { key: 'PageDown' })
    expect(screen.getByText('Trang 3 / 3')).toBeTruthy()
    expect(within(navigation).getByRole('button', { name: 'Trang sau' }).hasAttribute('disabled')).toBe(true)
    fireEvent.click(screen.getByRole('cell', { name: 'Paragraph 94' }))
    fireEvent.keyDown(window, { key: 'PageDown' })
    expect(readStealthCheckpoint(props.profile, book.id)?.rowIndex).toBe(94)
    grid.scrollTop = 400
    fireEvent.keyDown(window, { key: 'ArrowLeft' })
    expect(screen.getByText('Trang 2 / 3')).toBeTruthy()
    expect(grid.scrollTop).toBe(0)
    expect(readStealthCheckpoint(props.profile, book.id)?.rowIndex).toBe(40)
  })

  it('restores the exact chapter row on re-entry and marks the preceding reading position', async () => {
    saveStealthCheckpoint(props.profile, book.id, { progression: 73 / 94, sourceHref: 'chapter.xhtml', rowIndex: 73, rowCount: 95, rowId: 'REC-73', rowOffset: 10 })
    const { container, unmount } = render(<StealthReader {...props} />)
    await screen.findByText('Trang 2 / 3')
    expect(container.querySelector('.excel-tr.last-read')?.textContent).toContain('Paragraph 73')
    expect(progress.mock.calls.at(-1)?.[0]).toMatchObject({ rowIndex: 73, rowOffset: 10 })
    fireEvent.keyDown(window, { key: 'PageDown' })
    fireEvent(window, new Event('pagehide'))
    expect(readStealthCheckpoint(props.profile, book.id)?.rowIndex).toBe(80)
    unmount()
    render(<StealthReader {...props} />)
    await screen.findByText('Trang 3 / 3')
    expect(screen.getByLabelText('Vị trí lần đọc trước')).toBeTruthy()
    fireEvent.keyDown(window, { key: 'F2' })
    expect(close).toHaveBeenLastCalledWith(expect.objectContaining({ rowIndex: 80, rowCount: 95 }))
  })

  it('saves the visible row on wheel scrolling and never substitutes emergency data', async () => {
    const { container } = render(<StealthReader {...props} />)
    await screen.findByRole('cell', { name: 'Paragraph 0' })
    const grid = container.querySelector<HTMLDivElement>('.excel-grid-container')!
    const rect = (top: number, bottom: number) => ({ top, bottom, height: bottom - top, width: 100, left: 0, right: 100, x: 0, y: top, toJSON: () => ({}) })
    vi.spyOn(grid, 'getBoundingClientRect').mockReturnValue(rect(0, 500))
    container.querySelectorAll('.excel-tr').forEach((element, index) => { vi.spyOn(element, 'getBoundingClientRect').mockReturnValue(rect((index - 9) * 20 - 6, (index - 9) * 20 + 14)) })
    grid.scrollTop = 180
    fireEvent.scroll(grid)
    await waitFor(() => expect(readStealthCheckpoint(props.profile, book.id)).toMatchObject({ rowIndex: 9, rowOffset: 6 }))
    fireEvent.keyDown(window, { key: 'F12' })
    fireEvent.keyDown(window, { key: 'PageDown' })
    fireEvent(window, new Event('pagehide'))
    expect(readStealthCheckpoint(props.profile, book.id)?.rowIndex).toBe(9)
    fireEvent.keyDown(window, { key: 'F12' })
    fireEvent.keyDown(window, { key: 'F2' })
    expect(close).toHaveBeenLastCalledWith(expect.objectContaining({ rowIndex: 9, rowOffset: 6 }))
  })
})
