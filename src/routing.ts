export type Page = 'home' | 'catalog' | 'library' | 'memory' | 'stats' | 'account'
export type AppRoute = { kind: 'page'; page: Page } | { kind: 'book' | 'read'; bookId: string } | { kind: 'notFound' }

const paths: Record<Page, string> = { home: '/', catalog: '/explore', library: '/library', memory: '/memory', stats: '/stats', account: '/account' }

export function routePath(route: Exclude<AppRoute, { kind: 'notFound' }>): string {
  return route.kind === 'page' ? paths[route.page] : `/${route.kind === 'read' ? 'read' : 'books'}/${encodeURIComponent(route.bookId)}`
}

export function parseRoute(pathname: string): AppRoute {
  const path = pathname.replace(/\/+$/, '') || '/'
  const page = (Object.keys(paths) as Page[]).find(page => paths[page] === path)
  if (page) return { kind: 'page', page }
  const match = path.match(/^\/(books|read)\/([^/]+)$/)
  if (match) {
    try {
      const bookId = decodeURIComponent(match[2])
      if (bookId.trim() && bookId.length <= 512) return { kind: match[1] === 'read' ? 'read' : 'book', bookId }
    } catch { /* malformed URL */ }
  }
  return { kind: 'notFound' }
}
