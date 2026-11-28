// @vitest-environment jsdom
import { afterEach, expect, it, vi } from 'vitest'
import { cleanup, renderHook, waitFor } from '@testing-library/react'
import { useAccountAnalytics } from './useAccountAnalytics'
import { setAnalyticsOptOut } from './webAnalytics'

afterEach(() => { cleanup(); vi.unstubAllEnvs(); vi.unstubAllGlobals(); vi.restoreAllMocks(); localStorage.clear() })
it('collects only action types for the current signed-in account and stops on opt-out or account changes', async () => {
  vi.stubEnv('VITE_WEB_ANALYTICS_ENABLED', 'true')
  vi.spyOn(document, 'hasFocus').mockReturnValue(true)
  const fetcher = vi.fn().mockResolvedValue(new Response('{}'))
  vi.stubGlobal('fetch', fetcher)
  const hook = renderHook(({ token }) => useAccountAnalytics(token, true), { initialProps: { token: 'reader-session' as string | undefined } })
  window.dispatchEvent(new CustomEvent('nocap-usage-action', { detail: 'note_save' }))
  await waitFor(() => expect(fetcher).toHaveBeenCalledTimes(2))
  const payload = JSON.parse(fetcher.mock.calls[1][1].body)
  expect(Object.keys(payload).sort()).toEqual(['id', 'type'])
  expect(payload.type).toBe('note_save')
  expect(fetcher.mock.calls[1][1].headers.Authorization).toBe('Bearer reader-session')
  setAnalyticsOptOut(true)
  window.dispatchEvent(new CustomEvent('nocap-usage-action', { detail: 'book_open' }))
  expect(fetcher).toHaveBeenCalledTimes(2)
  hook.rerender({ token: undefined })
  window.dispatchEvent(new CustomEvent('nocap-usage-action', { detail: 'note_save' }))
  expect(fetcher).toHaveBeenCalledTimes(2)
})
