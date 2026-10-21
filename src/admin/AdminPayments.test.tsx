// @vitest-environment jsdom
import { afterEach, beforeEach, describe, expect, it, vi } from 'vitest'
import { act, cleanup, fireEvent, render, screen, waitFor, within } from '@testing-library/react'
import { ApiError } from '../api'
import { AdminPayments, type AdminPaymentsProps } from './AdminPayments'
import { paymentRange } from './paymentReportDates'
import type { AdminPaymentReport } from './api'
import { paymentReportCsv } from './paymentReportCsv'

const request = vi.hoisted(() => vi.fn())
vi.mock('./api', () => ({ adminRequest: request }))
const counts = { orders: 4, paidOrders: 3, paidCustomers: 2, paidAmount: 266800 }
const report: AdminPaymentReport = {
  from: '2026-10-17', to: '2026-10-18', timezone: 'Asia/Ho_Chi_Minh', generatedAt: Date.parse('2026-10-18T05:00:00Z'), currency: 'VND',
  filters: { status: 'ALL', plan: 'ALL', q: '' }, summary: counts,
  plans: [{ planDays: 30, orders: 3, paidOrders: 2, paidCustomers: 2, paidAmount: 58000 }, { planDays: 365, orders: 1, paidOrders: 1, paidCustomers: 1, paidAmount: 208800 }],
  daily: [{ date: '2026-10-17', ...counts }, { date: '2026-10-18', orders: 0, paidOrders: 0, paidCustomers: 0, paidAmount: 0 }],
  statuses: [{ status: 'PAID', count: 3 }, { status: 'PENDING', count: 1 }],
  items: [{ id: 'order-a', userId: 'user-a', email: 'reader@example.test', displayName: 'Test Reader', paymentCode: 'NC-PAID', amount: 208800, currency: 'VND', planDays: 365, status: 'PAID', createdAt: 1790000000000, paidAt: 1790000300000, recordedAt: 1790000300000, expiresAt: 1790003600000, entitlementExpiresAt: 1821536300000, transactionId: 'sepay-123' }],
  page: 0, totalRows: 4, hasMore: false, undatedPaidOrders: 0,
}
const callbacks = { onError: vi.fn(() => 'Payment request failed.'), onSignIn: vi.fn() }
const props: AdminPaymentsProps = { token: 'admin-session', lang: 'en', ...callbacks }
const setup = (patch: Partial<AdminPaymentsProps> = {}) => render(<AdminPayments {...props} {...patch} />)
function deferred<T>() { let resolve!: (value: T) => void; const promise = new Promise<T>(done => { resolve = done }); return { promise, resolve } }
const completeReport = (): AdminPaymentReport => ({ ...report, items: Array.from({ length: 4 }, (_, i) => ({ ...report.items[0], id: `order-${i}` })) })

beforeEach(() => { request.mockReset().mockResolvedValue(report); Object.values(callbacks).forEach(callback => callback.mockClear()) })
afterEach(() => { cleanup(); vi.restoreAllMocks(); vi.unstubAllGlobals(); vi.useRealTimers() })

describe('global payments dashboard', () => {
  it('uses server totals across all pages, distinct customers and actual paid dates without renewal metrics', async () => {
    setup()
    const heading = await screen.findByRole('heading', { name: 'Paying customers' })
    expect(within(heading.closest('article')!).getByText('2')).toBeTruthy()
    expect(within(screen.getByRole('heading', { name: 'Paid amount' }).closest('article')!).getByText(/266,800/)).toBeTruthy()
    expect(screen.getByText(/Admin-granted Pro is excluded/)).toBeTruthy()
    expect(screen.getByText(/actual payment date/)).toBeTruthy()
    expect(screen.getByText('reader@example.test')).toBeTruthy()
    expect(screen.getByText(/sepay-123/)).toBeTruthy()
    expect(screen.getByRole('img', { name: /Paid amount chart/ })).toBeTruthy()
    expect(screen.queryByText(/renewal|repeat purchase/i)).toBeNull()
    const url = new URL(`https://test/${request.mock.calls[0][1]}`)
    expect(url.searchParams.get('page')).toBe('0')
    expect(url.searchParams.get('to')).toBe(paymentRange(30).to)
  })

  it('applies all filters together, clears stale rows and aborts obsolete results', async () => {
    setup(); await screen.findByText('reader@example.test')
    const oldSignal = request.mock.calls[0][2] as AbortSignal
    const pending = deferred<AdminPaymentReport>(); request.mockReturnValueOnce(pending.promise)
    fireEvent.change(screen.getByLabelText('Status'), { target: { value: 'PAID' } })
    fireEvent.change(screen.getByLabelText('Pro plan'), { target: { value: '365' } })
    fireEvent.change(screen.getByLabelText('Account or transaction code'), { target: { value: ' reader+test@example.test ' } })
    expect(request).toHaveBeenCalledTimes(1)
    fireEvent.submit(screen.getByRole('form', { name: 'Payment filters' }))
    expect(oldSignal.aborted).toBe(true)
    expect(screen.queryByText('reader@example.test')).toBeNull()
    expect((screen.getByRole('button', { name: 'Export CSV' }) as HTMLButtonElement).disabled).toBe(true)
    const url = new URL(`https://test/${request.mock.lastCall![1]}`)
    expect(Object.fromEntries(url.searchParams)).toMatchObject({ status: 'PAID', plan: '365', q: 'reader+test@example.test', page: '0' })
    const pendingSignal = request.mock.lastCall![2] as AbortSignal
    fireEvent.click(screen.getByRole('button', { name: 'Today' }))
    await screen.findByText('reader@example.test'); expect(pendingSignal.aborted).toBe(true)
    await act(async () => { pending.resolve({ ...report, items: [{ ...report.items[0], email: 'stale@example.test' }] }); await pending.promise })
    expect(screen.queryByText('stale@example.test')).toBeNull()
  })

  it('paginates server rows and resets to page one on a new filter', async () => {
    request.mockResolvedValue({ ...report, hasMore: true, totalRows: 53 })
    setup(); await screen.findByText('reader@example.test')
    fireEvent.click(screen.getByRole('button', { name: 'Next' }))
    await screen.findByText('Page 2 / 2')
    expect(request.mock.lastCall![1]).toContain('page=1')
    expect(within(screen.getByRole('heading', { name: 'Paying customers' }).closest('article')!).getByText('2')).toBeTruthy()
    fireEvent.click(screen.getByRole('button', { name: '7 days' }))
    await screen.findByText('Page 1 / 2')
    expect(request.mock.lastCall![1]).toContain('page=0')
  })

  it('handles empty ranges, missing paid dates and historical plan durations honestly', async () => {
    const zero = { orders: 0, paidOrders: 0, paidCustomers: 0, paidAmount: 0 }
    request.mockResolvedValueOnce({ ...report, summary: zero, items: [], totalRows: 0, undatedPaidOrders: 2, plans: [{ planDays: 15, ...zero }] })
    setup(); expect(await screen.findByText('No payments match these filters.')).toBeTruthy()
    expect(screen.getByText(/2 PAID orders.*have no payment date.*all dates/)).toBeTruthy()
    expect(screen.getByText('15 days')).toBeTruthy()
    expect(screen.queryByText(/NaN|Infinity/)).toBeNull()
  })

  it('removes old account data immediately on token changes and cancels requests on unmount', async () => {
    const mounted = setup(); await screen.findByText('reader@example.test')
    const pending = deferred<AdminPaymentReport>(); request.mockReturnValueOnce(pending.promise)
    mounted.rerender(<AdminPayments {...props} token="other-admin" />)
    expect(screen.queryByText('reader@example.test')).toBeNull()
    expect(request.mock.lastCall![0]).toBe('other-admin')
    const signal = request.mock.lastCall![2] as AbortSignal
    mounted.unmount(); expect(signal.aborted).toBe(true)
  })

  it('reports expired or revoked access, clears results and offers reauthentication', async () => {
    setup(); await screen.findByText('reader@example.test')
    const error = new ApiError(401, 'Expired', 'ADMIN_REAUTH_REQUIRED'); request.mockRejectedValueOnce(error)
    fireEvent.click(screen.getByRole('button', { name: 'Refresh' }))
    await screen.findByRole('alert'); expect(screen.queryByText('reader@example.test')).toBeNull()
    expect(callbacks.onError).toHaveBeenCalledWith(error)
    fireEvent.click(screen.getByRole('button', { name: 'Sign in again' })); expect(callbacks.onSignIn).toHaveBeenCalledOnce()
    fireEvent.click(screen.getByRole('button', { name: 'Retry' })); await screen.findByText('reader@example.test')
  })

  it('fetches all filtered rows for CSV beyond the displayed page', async () => {
    setup(); await screen.findByText('reader@example.test')
    request.mockResolvedValueOnce(completeReport())
    const create = vi.fn((_blob: Blob) => 'blob:payments'); vi.stubGlobal('URL', Object.assign(URL, { createObjectURL: create, revokeObjectURL: vi.fn() }))
    let filename = '', connected = false
    vi.spyOn(HTMLAnchorElement.prototype, 'click').mockImplementation(function (this: HTMLAnchorElement) { filename = this.download; connected = this.isConnected })
    fireEvent.click(screen.getByRole('button', { name: 'Export CSV' }))
    await waitFor(() => expect(create).toHaveBeenCalledOnce())
    expect(request.mock.lastCall![1]).toMatch(/^transactions\/export\?/)
    expect(request.mock.lastCall![1]).not.toContain('page=')
    expect(filename).toBe('NoCap-Payments-2026-10-17-2026-10-18.csv'); expect(connected).toBe(true)
    expect(create.mock.calls[0][0]).toBeInstanceOf(Blob)
  })

  it('cancels an export when filters change and never downloads the obsolete report', async () => {
    setup(); await screen.findByText('reader@example.test')
    const pending = deferred<AdminPaymentReport>(); request.mockReturnValueOnce(pending.promise)
    const click = vi.spyOn(HTMLAnchorElement.prototype, 'click').mockImplementation(() => {})
    fireEvent.click(screen.getByRole('button', { name: 'Export CSV' }))
    const exportSignal = request.mock.lastCall![2] as AbortSignal
    fireEvent.click(screen.getByRole('button', { name: 'Today' }))
    await screen.findByText('reader@example.test'); expect(exportSignal.aborted).toBe(true)
    await act(async () => { pending.resolve(completeReport()); await pending.promise }); expect(click).not.toHaveBeenCalled()
  })

  it('shows explicit export limits and clears rows if export authorization is lost', async () => {
    setup(); await screen.findByText('reader@example.test')
    request.mockRejectedValueOnce(new ApiError(413, 'Narrow the filters', 'PAYMENT_EXPORT_LIMIT'))
    fireEvent.click(screen.getByRole('button', { name: 'Export CSV' }))
    expect(await screen.findByRole('alert')).toBeTruthy(); expect(screen.getByText('reader@example.test')).toBeTruthy()
    await waitFor(() => expect((screen.getByRole('button', { name: 'Export CSV' }) as HTMLButtonElement).disabled).toBe(false))
    request.mockRejectedValueOnce(new ApiError(403, 'Revoked', 'ADMIN_REQUIRED'))
    fireEvent.click(screen.getByRole('button', { name: 'Export CSV' }))
    await waitFor(() => expect(screen.queryByText('reader@example.test')).toBeNull())
  })

  it('uses Vietnam calendar days across midnight instead of the computer timezone', () => {
    expect(paymentRange(7, Date.parse('2026-10-20T17:00:00Z'))).toEqual({ from: '2026-10-15', to: '2026-10-21' })
    expect(paymentRange(1, Date.parse('2026-10-20T16:59:59Z'))).toEqual({ from: '2026-10-20', to: '2026-10-20' })
  })
})

describe('complete payment CSV', () => {
  it('exports auditable totals, filters and timestamps with escaped cells and neutralized spreadsheet formulas', () => {
    const complete = completeReport()
    complete.items[0] = { ...complete.items[0], displayName: ' =HYPERLINK("bad")', email: '\t=1+1', transactionId: 'id,"quoted"' }
    const csv = paymentReportCsv({ ...complete, internalWebhook: 'do-not-export' } as AdminPaymentReport)
    expect(csv.startsWith('\uFEFF')).toBe(true)
    expect(csv).toContain('"total","4","3","2","266800"')
    expect(csv).toContain('"\' =HYPERLINK(""bad"")"')
    expect(csv).toContain('"\'\t=1+1"')
    expect(csv).toContain('"id,""quoted"""')
    expect(csv).toContain('2026-10-18T05:00:00.000Z')
    expect(csv).toContain('"order-3"'); expect(csv).not.toContain('do-not-export')
    expect(csv).not.toMatch(/renewal|repeat_purchase/)
  })
  it('refuses partial reports instead of presenting a page as the complete export', () => {
    expect(() => paymentReportCsv(report)).toThrow('Incomplete payment export')
    expect(() => paymentReportCsv({ ...completeReport(), hasMore: true })).toThrow('Incomplete payment export')
  })
})
