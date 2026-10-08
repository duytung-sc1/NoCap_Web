import { expect, it } from 'vitest'
import { parseRoute, routePath, type Page } from './routing'

it('round-trips every page URL, including the requested /explore path', () => {
  for (const page of ['home', 'catalog', 'library', 'memory', 'stats', 'account'] as Page[]) {
    const route = { kind: 'page' as const, page }
    expect(parseRoute(routePath(route))).toEqual(route)
    expect(parseRoute(`${routePath(route)}/`)).toEqual(route)
  }
  expect(routePath({ kind: 'page', page: 'catalog' })).toBe('/explore')
})

it('keeps book details and reading URLs distinct and safely encodes book IDs', () => {
  for (const kind of ['book', 'read'] as const) {
    const route = { kind, bookId: 'sách riêng/#1?' }
    expect(parseRoute(routePath(route))).toEqual(route)
  }
  expect(parseRoute('/books/gutenberg-11')).toEqual({ kind: 'book', bookId: 'gutenberg-11' })
  expect(parseRoute('/read/gutenberg-11')).toEqual({ kind: 'read', bookId: 'gutenberg-11' })
})

it('does not silently send malformed, missing, or unknown routes to Home', () => {
  for (const path of ['/unknown', '/books', '/read/', '/read/%', '/books/id/extra', '/books/%20', `/books/${'a'.repeat(513)}`]) {
    expect(parseRoute(path)).toEqual({ kind: 'notFound' })
  }
})
