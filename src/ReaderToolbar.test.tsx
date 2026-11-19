// @vitest-environment jsdom
import { createRef } from 'react'
import { afterEach, beforeEach, describe, expect, it, vi } from 'vitest'
import { cleanup, fireEvent, render, screen } from '@testing-library/react'
import { ReaderToolbar } from './ReaderToolbar'

beforeEach(() => {
  vi.stubGlobal('matchMedia', () => ({ matches: true, addEventListener: vi.fn(), removeEventListener: vi.fn() }))
})
afterEach(() => { cleanup(); vi.unstubAllGlobals() })

describe('compact reader tools', () => {
  it('preserves primary control refs and closes More before reader Escape runs', () => {
    const notes = createRef<HTMLButtonElement>()
    const readerEscape = vi.fn()
    window.addEventListener('keydown', readerEscape)
    try {
      render(<ReaderToolbar lang="vi" home={<button>Trang chủ</button>} back={<button>Quay lại</button>}
        title={<div className="reader-title">Tài liệu</div>} actions={[
          { id: 'notes', label: 'Ghi chú', primary: true, control: <button ref={notes} aria-label="Bảng ghi chú">N</button> },
          { id: 'settings', label: 'Tùy chỉnh', control: <button aria-label="Tùy chỉnh">S</button> },
        ]} />)
      expect(notes.current).toBe(screen.getByRole('button', { name: 'Bảng ghi chú' }))
      const more = screen.getByRole('button', { name: 'Thêm công cụ đọc' })
      fireEvent.click(more)
      expect(screen.getByRole('dialog', { name: 'Công cụ đọc' })).toBeTruthy()
      fireEvent.keyDown(document, { key: 'Escape', bubbles: true })
      expect(screen.queryByRole('dialog')).toBeNull()
      expect(document.activeElement).toBe(more)
      expect(readerEscape).not.toHaveBeenCalled()
    } finally { window.removeEventListener('keydown', readerEscape) }
  })

  it('executes a secondary action once and dismisses its popover', () => {
    const onBookmark = vi.fn()
    render(<ReaderToolbar lang="en" home={<button>Home</button>} back={<button>Back</button>}
      title={<div className="reader-title">Book</div>} actions={[
        { id: 'bookmark', label: 'Bookmark', control: <button aria-label="Bookmark position" onClick={onBookmark}>B</button> },
      ]} />)
    expect(screen.queryByRole('button', { name: 'Bookmark position' })).toBeNull()
    fireEvent.click(screen.getByRole('button', { name: 'More reading tools' }))
    fireEvent.click(screen.getByRole('button', { name: 'Bookmark position' }))
    expect(onBookmark).toHaveBeenCalledTimes(1)
    expect(screen.queryByRole('dialog')).toBeNull()
  })
})
