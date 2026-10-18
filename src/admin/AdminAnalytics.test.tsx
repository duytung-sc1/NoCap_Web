// @vitest-environment jsdom
import { afterEach, beforeEach, describe, expect, it, vi } from 'vitest'
import { act, cleanup, fireEvent, render, screen, within } from '@testing-library/react'
import { ApiError } from '../api'
import { AdminAnalytics, type AdminAnalyticsProps } from './AdminAnalytics'
import { analyticsCsv } from './analyticsCsv'
import type { AdminAnalytics as AnalyticsReport } from './api'

const request = vi.hoisted(() => vi.fn())
vi.mock('./api', () => ({ adminRequest: request }))
const report: AnalyticsReport = {
  enabled: true, trackingStartedAt: Date.parse('2026-10-17T03:00:00Z'), timezone: 'Asia/Ho_Chi_Minh', days: 7,
  from: '2026-10-12', to: '2026-10-18', generatedAt: Date.parse('2026-10-18T05:00:00Z'),
  summary: { visitors: 17, sessions: 24, pageViews: 61, activeMs: 2880000, newVisitors: 12, returningVisitors: 5 },
  daily: [
    { date: '2026-10-17', visitors: 11, sessions: 15, pageViews: 30, activeMs: 1200000, newVisitors: 8, returningVisitors: 3 },
    { date: '2026-10-18', visitors: 13, sessions: 18, pageViews: 31, activeMs: 1680000, newVisitors: 8, returningVisitors: 5 },
  ],
  topPages: [{ page: 'reader', pageViews: 31, visitors: 15, activeMs: 2400000 }, { page: 'home', pageViews: 30, visitors: 14, activeMs: 480000 }],
  events: [{ type: 'page_view', count: 61 }, { type: 'heartbeat', count: 130 }, { type: 'note_save', count: 8 }, { type: 'checkout_start', count: 2 }],
}
const callbacks = { onError: vi.fn(() => 'Could not load analytics.'), onSignIn: vi.fn() }
const props: AdminAnalyticsProps = { token: 'admin-session', lang: 'en', ...callbacks }
const setup = (patch: Partial<AdminAnalyticsProps> = {}) => render(<AdminAnalytics {...props} {...patch} />)
function deferred<T>() { let resolve!: (value: T) => void; let reject!: (reason: unknown) => void; const promise = new Promise<T>((done, fail) => { resolve = done; reject = fail }); return { promise, resolve, reject } }

beforeEach(() => {
  request.mockReset().mockResolvedValue(report)
  Object.values(callbacks).forEach(callback => callback.mockClear())
})
afterEach(() => { cleanup(); vi.useRealTimers(); vi.restoreAllMocks(); vi.unstubAllGlobals() })

describe('Web analytics administrator dashboard', () => {
  it('uses deduplicated server totals, honest browser labels and active time rather than summing the daily series', async () => {
    setup()
    expect(await screen.findByText('Estimated visitors')).toBeTruthy()
    expect(request).toHaveBeenCalledWith('admin-session', 'analytics?days=7', expect.any(AbortSignal))
    const visitorCard = screen.getByText('Estimated visitors').closest('article')!
    expect(within(visitorCard).getByText('17')).toBeTruthy()
    expect(within(visitorCard).queryByText('24')).toBeNull()
    const averageCard = screen.getByText('Average active time / session').closest('article')!
    expect(within(averageCard).getByText('2 min')).toBeTruthy()
    expect(screen.getByText('12 / 5')).toBeTruthy()
    expect(screen.getByText(/not unique people or accounts/)).toBeTruthy()
    expect(screen.getByText(/Traffic before collection began is unavailable/)).toBeTruthy()
    expect(screen.getByText(/Time zone.*Asia\/Ho_Chi_Minh/)).toBeTruthy()
    expect(screen.getByRole('img', { name: /Page views by day/ })).toBeTruthy()
    const pageTable = screen.getByRole('heading', { name: 'Most viewed pages' }).closest('section')!
    expect(within(pageTable).getByText('Reader')).toBeTruthy()
    expect(within(pageTable).getByText('Home')).toBeTruthy()
    const features = screen.getByRole('heading', { name: 'Feature activity' }).closest('section')!
    expect(within(features).getByText('Notes saved')).toBeTruthy()
    expect(within(features).getByText('Checkouts started')).toBeTruthy()
    expect(within(features).queryByText('130')).toBeNull()
    expect(within(features).queryByText('61')).toBeNull()
    expect(screen.getByText(/Starting checkout does not mean a payment was made/)).toBeTruthy()
  })

  it('clears old reports during a range change and ignores late responses from obsolete requests', async () => {
    const pending = deferred<AnalyticsReport>()
    request.mockReturnValueOnce(pending.promise)
    setup()
    const oldSignal = request.mock.calls[0][2] as AbortSignal
    fireEvent.change(screen.getByLabelText('Date range'), { target: { value: '30' } })
    expect(oldSignal.aborted).toBe(true)
    await screen.findByText('Estimated visitors')
    expect(request.mock.lastCall?.[1]).toBe('analytics?days=30')
    await act(async () => { pending.resolve({ ...report, summary: { ...report.summary, visitors: 99999 } }); await pending.promise })
    expect(screen.queryByText('99,999')).toBeNull()
    const next = deferred<AnalyticsReport>()
    request.mockReturnValueOnce(next.promise)
    fireEvent.change(screen.getByLabelText('Date range'), { target: { value: '1' } })
    expect(screen.queryByText('Estimated visitors')).toBeNull()
    expect(screen.getByRole('status').textContent).toContain('Loading Web analytics')
    expect((screen.getByRole('button', { name: 'Export CSV' }) as HTMLButtonElement).disabled).toBe(true)
    await act(async () => { next.resolve({ ...report, days: 1 }); await next.promise })
    expect(await screen.findByText('Estimated visitors')).toBeTruthy()
    expect(request.mock.lastCall?.[1]).toBe('analytics?days=1')
  })

  it('resets filters and removes the previous session report immediately when the token changes', async () => {
    const mounted = setup()
    await screen.findByText('Estimated visitors')
    fireEvent.change(screen.getByLabelText('Date range'), { target: { value: '90' } })
    await screen.findByText('Estimated visitors')
    const pending = deferred<AnalyticsReport>()
    request.mockReturnValueOnce(pending.promise)
    mounted.rerender(<AdminAnalytics {...props} token="new-admin-session" />)
    expect(screen.queryByText('Estimated visitors')).toBeNull()
    expect((screen.getByLabelText('Date range') as HTMLSelectElement).value).toBe('7')
    expect(request.mock.lastCall?.[0]).toBe('new-admin-session')
    expect(request.mock.lastCall?.[1]).toBe('analytics?days=7')
    mounted.unmount()
    expect((request.mock.lastCall![2] as AbortSignal).aborted).toBe(true)
  })

  it('removes report data on an expired session, offers sign in and retries without stale rows', async () => {
    setup()
    await screen.findByText('Estimated visitors')
    const failure = new ApiError(401, 'Expired', 'ADMIN_REAUTH_REQUIRED')
    request.mockRejectedValueOnce(failure)
    fireEvent.click(screen.getByRole('button', { name: 'Refresh' }))
    expect(await screen.findByRole('alert')).toBeTruthy()
    expect(screen.queryByText('Estimated visitors')).toBeNull()
    expect(callbacks.onError).toHaveBeenCalledWith(failure)
    fireEvent.click(screen.getByRole('button', { name: 'Sign in again' }))
    expect(callbacks.onSignIn).toHaveBeenCalledOnce()
    fireEvent.click(screen.getByRole('button', { name: 'Retry' }))
    expect(await screen.findByText('Estimated visitors')).toBeTruthy()
    expect(screen.queryByRole('alert')).toBeNull()
  })

  it('does not present disabled collection as measured zero traffic', async () => {
    request.mockResolvedValueOnce({ ...report, enabled: false })
    setup({ lang: 'vi' })
    expect(await screen.findByText('Chưa bật thu thập thống kê')).toBeTruthy()
    expect(screen.queryByText('Khách truy cập ước tính')).toBeNull()
    expect(screen.queryByRole('img')).toBeNull()
    expect((screen.getByRole('button', { name: 'Xuất CSV' }) as HTMLButtonElement).disabled).toBe(true)
  })

  it('explains a real empty range and avoids dividing by zero for average time', async () => {
    const zero = { visitors: 0, sessions: 0, pageViews: 0, activeMs: 0, newVisitors: 0, returningVisitors: 0 }
    request.mockResolvedValueOnce({ ...report, trackingStartedAt: null, summary: zero, daily: [{ date: '2026-10-18', ...zero }], topPages: [], events: [] })
    setup()
    expect(await screen.findByText(/No traffic has been collected in the selected range/)).toBeTruthy()
    expect(screen.getByText(/No visits have been collected yet/)).toBeTruthy()
    const average = screen.getByText('Average active time / session').closest('article')!
    expect(within(average).getByText('0 sec')).toBeTruthy()
    expect(screen.queryByText(/NaN|Infinity/)).toBeNull()
    expect(screen.getByText('No feature actions recorded yet.')).toBeTruthy()
    expect(screen.getByText('No page views yet.')).toBeTruthy()
  })

  it('aborts on unmount and uses the latest error callback without causing duplicate requests', async () => {
    const pending = deferred<AnalyticsReport>()
    request.mockReturnValueOnce(pending.promise)
    const mounted = setup()
    const nextError = vi.fn(() => 'Latest callback')
    mounted.rerender(<AdminAnalytics {...props} onError={nextError} />)
    expect(request).toHaveBeenCalledOnce()
    await act(async () => { pending.reject(new Error('Offline')); await pending.promise.catch(() => {}) })
    expect(await screen.findByText('Latest callback')).toBeTruthy()
    expect(nextError).toHaveBeenCalledOnce()
    expect(callbacks.onError).not.toHaveBeenCalled()
    const obsolete = deferred<AnalyticsReport>()
    request.mockReturnValueOnce(obsolete.promise)
    fireEvent.click(screen.getByRole('button', { name: 'Retry' }))
    const signal = request.mock.lastCall?.[2] as AbortSignal
    mounted.unmount()
    expect(signal.aborted).toBe(true)
    await act(async () => { obsolete.reject(new ApiError(403, 'Revoked', 'ADMIN_REQUIRED')); await obsolete.promise.catch(() => {}) })
    expect(nextError).toHaveBeenCalledOnce()
  })

  it('exports a dated UTF-8 aggregate CSV and revokes its temporary download URL', async () => {
    setup()
    await screen.findByText('Estimated visitors')
    vi.useFakeTimers({ toFake: ['setTimeout'] })
    const createObjectURL = vi.fn(() => 'blob:aggregate-csv'), revokeObjectURL = vi.fn()
    vi.stubGlobal('URL', class extends URL { static createObjectURL = createObjectURL; static revokeObjectURL = revokeObjectURL })
    let fileName = '', connected = false
    vi.spyOn(HTMLAnchorElement.prototype, 'click').mockImplementation(function (this: HTMLAnchorElement) { fileName = this.download; connected = this.isConnected })
    fireEvent.click(screen.getByRole('button', { name: 'Export CSV' }))
    expect(createObjectURL).toHaveBeenCalledOnce()
    expect((createObjectURL.mock.calls[0] as unknown[])[0]).toBeInstanceOf(Blob)
    expect(fileName).toBe('NoCap-Web-Analytics-2026-10-12-2026-10-18.csv')
    expect(connected).toBe(true)
    act(() => vi.runAllTimers())
    expect(revokeObjectURL).toHaveBeenCalledWith('blob:aggregate-csv')
    vi.useRealTimers()
  })
})

describe('analytics aggregate CSV', () => {
  it('neutralizes formulas and quotes while excluding unknown fields, user content and heartbeat events', () => {
    const data = { ...report, browserIds: ['private-browser-id'], email: 'private@example.test', topPages: [{ page: ' =HYPERLINK("unsafe")', pageViews: 1, visitors: 1, activeMs: 2000 }] }
    const csv = analyticsCsv(data)
    expect(csv.startsWith('\uFEFF')).toBe(true)
    expect(csv).toContain('"\' =HYPERLINK(""unsafe"")"')
    expect(csv).toContain('"average_active_seconds_per_session","","","","","120","seconds/session"')
    expect(csv).toContain('"feature","","note_save"')
    expect(csv).not.toContain('heartbeat')
    expect(csv).not.toContain('private-browser-id')
    expect(csv).not.toContain('private@example.test')
    expect(csv.split('\r\n')[0].split(',')).toHaveLength(9)
  })
})
