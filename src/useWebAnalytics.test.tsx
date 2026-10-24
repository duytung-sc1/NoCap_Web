// @vitest-environment jsdom
import { cleanup, renderHook } from '@testing-library/react'
import { afterEach, expect, it, vi } from 'vitest'
import { useWebAnalytics } from './useWebAnalytics'
import type { AppRoute } from './routing'

const analytics = vi.hoisted(() => ({ setPage: vi.fn() }))
vi.mock('./webAnalytics', () => ({ setAnalyticsPage: analytics.setPage }))
afterEach(() => { cleanup(); vi.clearAllMocks() })

it('counts map visits under the supported library category while distinguishing local view transitions', () => {
  const { rerender } = renderHook(({ route }: { route: AppRoute }) => useWebAnalytics(route), { initialProps: { route: { kind: 'page', page: 'library' } as AppRoute } })
  expect(analytics.setPage).toHaveBeenLastCalledWith('library', 'library')
  rerender({ route: { kind: 'page', page: 'libraryMap' } })
  expect(analytics.setPage).toHaveBeenLastCalledWith('library', 'libraryMap')
  rerender({ route: { kind: 'page', page: 'library' } })
  expect(analytics.setPage).toHaveBeenLastCalledWith('library', 'library')
  expect(analytics.setPage).toHaveBeenCalledTimes(3)
})

it('continues excluding administration and normalizing explore visits', () => {
  const { rerender } = renderHook(({ route }: { route: AppRoute }) => useWebAnalytics(route), { initialProps: { route: { kind: 'page', page: 'admin' } as AppRoute } })
  expect(analytics.setPage).toHaveBeenLastCalledWith(null, 'admin')
  rerender({ route: { kind: 'page', page: 'catalog' } })
  expect(analytics.setPage).toHaveBeenLastCalledWith('explore', 'catalog')
})
