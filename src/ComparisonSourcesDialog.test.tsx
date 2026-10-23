// @vitest-environment jsdom
import { afterEach, describe, expect, it, vi } from 'vitest'
import { cleanup, fireEvent, render, screen } from '@testing-library/react'
import { ComparisonSourcesDialog } from './ComparisonSourcesDialog'
import type { Book } from './types'

const books: Book[] = [
  { id: 'vi-book', title: 'Truyện Kiều', author: 'Nguyễn Du', source: 'catalog', format: 'EPUB' },
  { id: 'en-book', title: 'The Crack of Doom', author: 'Robert Cromie', source: 'catalog', format: 'EPUB' },
]

afterEach(() => { cleanup(); document.documentElement.lang = 'vi' })

describe('comparison source dialog language', () => {
  it('declares Vietnamese locally even inside an English page and keeps both source labels accessible', () => {
    document.documentElement.lang = 'en'
    const onCompare = vi.fn()
    render(<ComparisonSourcesDialog books={books} lang="vi" onClose={vi.fn()} onCompare={onCompare} />)

    const dialog = screen.getByRole('dialog', { name: 'Đọc đối chiếu hai nguồn' })
    expect(dialog.closest('[lang]')?.getAttribute('lang')).toBe('vi')
    expect(dialog.matches(':lang(vi)')).toBe(true)
    expect((screen.getByRole('combobox', { name: 'Nguồn bên trái' }) as HTMLSelectElement).value).toBe('vi-book')
    fireEvent.change(screen.getByRole('combobox', { name: 'Nguồn bên phải' }), { target: { value: 'vi-book' } })
    fireEvent.click(screen.getByRole('button', { name: 'Mở hai nguồn' }))
    expect(onCompare).toHaveBeenCalledWith(books[0], books[0])
  })

  it('updates the English language scope without resetting the selected documents', () => {
    const props = { books, onClose: vi.fn(), onCompare: vi.fn() }
    const { rerender } = render(<ComparisonSourcesDialog {...props} lang="vi" />)
    fireEvent.change(screen.getByRole('combobox', { name: 'Nguồn bên trái' }), { target: { value: 'en-book' } })
    rerender(<ComparisonSourcesDialog {...props} lang="en" />)

    const dialog = screen.getByRole('dialog', { name: 'Compare two sources' })
    expect(dialog.closest('[lang]')?.getAttribute('lang')).toBe('en')
    expect(dialog.matches(':lang(en)')).toBe(true)
    expect((screen.getByRole('combobox', { name: 'Left source' }) as HTMLSelectElement).value).toBe('en-book')
    expect(screen.getByRole('combobox', { name: 'Right source' })).toBeTruthy()
    fireEvent.click(screen.getByRole('button', { name: 'Open both sources' }))
    expect(props.onCompare).toHaveBeenCalledWith(books[1], books[1])
  })
})
