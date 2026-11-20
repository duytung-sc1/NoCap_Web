// @vitest-environment jsdom
import { afterEach, expect, it, vi } from 'vitest'
import { cleanup, fireEvent, render, screen } from '@testing-library/react'
import { ReadingRecommendations } from './ReadingGenreRecommendations'
import type { RecommendedGenre } from './readingRecommendations'
import type { Book, Category } from './types'

afterEach(cleanup)

const source: Book = { id: 'source', title: 'A Study in Scarlet', author: 'Arthur Conan Doyle', language: 'en' }
const unread: Book = { id: 'unread', title: 'The Sign of the Four', author: 'Arthur Conan Doyle', language: 'en' }
const categories: Category[] = [{ id: 'mystery', name: 'Trinh thám' }, { id: 'history', name: 'Lịch sử' }]
const genres: RecommendedGenre[] = [{ categoryId: 'mystery', sourceBooks: [source], unreadBooks: [unread] }]

it('explains a real source book and opens the selected genre with a normal button', () => {
  const onExplore = vi.fn()
  render(<ReadingRecommendations lang="vi" genres={genres} categories={categories} onExplore={onExplore} />)
  const section = screen.getByRole('region', { name: 'Gợi ý thể loại' })
  expect(section.getAttribute('lang')).toBe('vi')
  expect(screen.getByText('Dựa trên sách bạn đã đọc')).toBeTruthy()
  const button = screen.getByRole('button', { name: 'Khám phá thể loại Trinh thám' })
  expect(button.getAttribute('type')).toBe('button')
  expect(button.hasAttribute('aria-pressed')).toBe(false)
  expect(document.getElementById(button.getAttribute('aria-describedby')!)?.textContent).toBe('Vì bạn đã đọc “A Study in Scarlet”')
  expect(screen.getByText(source.title).getAttribute('lang')).toBe('en')
  fireEvent.click(button)
  expect(onExplore).toHaveBeenCalledExactlyOnceWith('mystery')
})

it('translates genre names while retaining Vietnamese source language and combining marks in English UI', () => {
  const title = 'Truyện Kiều'.normalize('NFD')
  const viGenres = [{ ...genres[0], sourceBooks: [{ ...source, title, language: 'en' }, { ...source, id: 'second-source', title: 'Another mystery' }] }]
  render(<ReadingRecommendations lang="en" genres={viGenres} categories={categories} activeCategory="mystery" onExplore={vi.fn()} />)
  expect(screen.getByRole('region', { name: 'Suggested genres' }).getAttribute('lang')).toBe('en')
  expect(screen.getByRole('button', { name: 'Explore Mystery books' }).getAttribute('aria-pressed')).toBe('true')
  expect(screen.getByText('Mystery').getAttribute('lang')).toBe('en')
  expect(screen.getByText(title, { exact: true }).getAttribute('lang')).toBe('vi')
  expect(screen.getByText(/and 1 other book in this genre/)).toBeTruthy()
})

it('marks only the current category as pressed and updates when filters change', () => {
  const props = { lang: 'vi' as const, genres, categories, onExplore: vi.fn() }
  const { rerender } = render(<ReadingRecommendations {...props} activeCategory="history" />)
  expect(screen.getByRole('button').getAttribute('aria-pressed')).toBe('false')
  rerender(<ReadingRecommendations {...props} activeCategory="mystery" />)
  expect(screen.getByRole('button').getAttribute('aria-pressed')).toBe('true')
})

it('does not claim recommendations without real categorized evidence or an unread destination', () => {
  const cases: RecommendedGenre[][] = [[], [{ ...genres[0], categoryId: 'unknown' }], [{ ...genres[0], sourceBooks: [] }], [{ ...genres[0], sourceBooks: [{ ...source, title: '   ' }] }], [{ ...genres[0], unreadBooks: [] }]]
  const { container, rerender } = render(<ReadingRecommendations lang="vi" genres={cases[0]} categories={categories} onExplore={vi.fn()} />)
  for (const empty of cases) {
    rerender(<ReadingRecommendations lang="vi" genres={empty} categories={categories} onExplore={vi.fn()} />)
    expect(container.childElementCount).toBe(0)
  }
})

it('limits distinct genres to three and counts distinct source books without exposing score claims', () => {
  const manyCategories = [...categories, { id: 'romance', name: 'Lãng mạn' }, { id: 'sci-fi', name: 'Khoa học viễn tưởng' }]
  const manyGenres = manyCategories.map(category => ({ categoryId: category.id, sourceBooks: [source, source], unreadBooks: [unread] }))
  manyGenres.splice(1, 0, manyGenres[0])
  render(<ReadingRecommendations lang="vi" genres={manyGenres} categories={manyCategories} onExplore={vi.fn()} />)
  expect(screen.getAllByRole('button')).toHaveLength(3)
  expect(screen.queryByRole('button', { name: /Khoa học viễn tưởng/ })).toBeNull()
  expect(screen.queryByText(/cuốn cùng thể loại/)).toBeNull()
  expect(screen.queryByText(/%|AI/)).toBeNull()
})
