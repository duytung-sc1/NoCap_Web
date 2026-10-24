import { useEffect } from 'react'
import type { AppRoute } from './routing'
import { setAnalyticsPage, type AnalyticsPage } from './webAnalytics'

export function useWebAnalytics(route: AppRoute) {
  const page: AnalyticsPage | null = route.kind === 'page' ? route.page === 'admin' ? null : route.page === 'catalog' ? 'explore' : route.page === 'libraryMap' ? 'library' : route.page
    : route.kind === 'read' ? 'reader' : route.kind === 'book' ? 'book' : 'other'
  // This key only deduplicates React effects locally. It never enters telemetry.
  const viewKey = route.kind === 'read' || route.kind === 'book' ? `${route.kind}:${route.bookId}` : route.kind === 'page' ? route.page : page ?? 'admin'
  // Only normalized page categories reach the collector, never document IDs or URL parameters.
  useEffect(() => { setAnalyticsPage(page, viewKey) }, [page, viewKey])
}
