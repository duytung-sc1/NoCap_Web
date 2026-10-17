// @vitest-environment jsdom
import { afterEach, beforeEach, describe, expect, it, vi } from 'vitest'
import { act, cleanup, fireEvent, render, screen, waitFor, within } from '@testing-library/react'
import { ApiError } from '../api'
import { AdminTransactions, type AdminTransactionsProps } from './AdminTransactions'
import type { AdminTransaction, AdminUser, PageResult } from './api'

const request = vi.hoisted(() => vi.fn())
vi.mock('./api', () => ({ adminRequest: request }))
const user: AdminUser = { id: 'reader / two', email: 'reader@example.test', displayName: 'Reader', status: 'ACTIVE', isAdmin: 0, devices: 0, syncRecords: 0, syncConflicts: 0, createdAt: '2026-10-01T00:00:00Z' }
const order: AdminTransaction = {
  id: 'sepay-order-1', paymentCode: 'NOCAP1234', amount: 208800, currency: 'VND', planDays: 365, status: 'PAID',
  createdAt: 1792198800000, expiresAt: 1792200600000, paidAt: 1792199400000,
  transactionId: 'sepay-bank-987', entitlementExpiresAt: 1823735400000,
}
const callbacks = { onClose: vi.fn(), onError: vi.fn(() => 'Could not load orders.'), onSignIn: vi.fn() }
const props: AdminTransactionsProps = { token: 'admin-session', user, lang: 'en', ...callbacks }
function setup(patch: Partial<AdminTransactionsProps> = {}) { return render(<AdminTransactions {...props} {...patch} />) }
function deferred<T>() { let resolve!: (value: T) => void; let reject!: (reason: unknown) => void; const promise = new Promise<T>((done, fail) => { resolve = done; reject = fail }); return { promise, resolve, reject } }

beforeEach(() => {
  request.mockReset().mockResolvedValue({ items: [order], hasMore: false })
  Object.values(callbacks).forEach(callback => callback.mockClear())
})
afterEach(() => cleanup())

describe('administrator transaction history', () => {
  it('loads only the selected account orders and displays actual payment identifiers, amount and exact timestamps', async () => {
    setup()
    expect(await screen.findByText('NOCAP1234')).toBeTruthy()
    expect(request).toHaveBeenCalledWith('admin-session', 'users/transactions?id=reader%20%2F%20two&page=0&status=ALL', expect.any(AbortSignal))
    expect(screen.getByText('reader@example.test')).toBeTruthy()
    const table = screen.getByRole('table')
    expect(within(table).getByText('sepay-order-1')).toBeTruthy()
    expect(within(table).getByText('sepay-bank-987')).toBeTruthy()
    expect(within(table).getByText('₫208,800')).toBeTruthy()
    expect(within(table).getByText('1 year · 365 days')).toBeTruthy()
    expect(within(table).getByText('Paid')).toBeTruthy()
    const dates = table.querySelectorAll('time')
    expect(dates.length).toBe(4)
    expect(Array.from(dates, element => element.dateTime)).toContain(new Date(order.paidAt!).toISOString())
    expect(Array.from(dates, element => element.dateTime)).toContain(new Date(order.entitlementExpiresAt!).toISOString())
    fireEvent.click(screen.getByRole('button', { name: 'Close' }))
    expect(callbacks.onClose).toHaveBeenCalledOnce()
  })

  it('paginates server results and resets to the first page when filtering', async () => {
    request.mockResolvedValue({ items: [order], hasMore: true })
    setup()
    await screen.findByText(order.paymentCode)
    expect((screen.getByRole('button', { name: 'Previous' }) as HTMLButtonElement).disabled).toBe(true)
    fireEvent.click(screen.getByRole('button', { name: 'Next' }))
    await waitFor(() => expect(request.mock.lastCall?.[1]).toContain('page=1&status=ALL'))
    await screen.findByText(order.paymentCode)
    expect(screen.getByText('Page 2')).toBeTruthy()
    request.mockResolvedValue({ items: [], hasMore: false })
    fireEvent.change(screen.getByLabelText('Payment status'), { target: { value: 'EXPIRED' } })
    expect(screen.queryByText(order.paymentCode)).toBeNull()
    expect(await screen.findByText('No payment orders match the selected status.')).toBeTruthy()
    expect(request.mock.lastCall?.[1]).toBe('users/transactions?id=reader%20%2F%20two&page=0&status=EXPIRED')
    expect(screen.getByText('Page 1')).toBeTruthy()
    expect((screen.getByRole('button', { name: 'Next' }) as HTMLButtonElement).disabled).toBe(true)
  })

  it('does not manufacture a payment from an active administrator grant', async () => {
    request.mockResolvedValue({ items: [], hasMore: false })
    setup({ lang: 'vi', user: { ...user, adminGrantStatus: 'ACTIVE', adminGrantExpiresAt: Date.now() + 86400000 } })
    expect(await screen.findByText('Tài khoản này chưa có đơn thanh toán SePay.')).toBeTruthy()
    expect(screen.getByText(/Pro do quản trị viên cấp đang có hiệu lực đến/)).toBeTruthy()
    expect(screen.getByText(/không phải giao dịch đã thanh toán/)).toBeTruthy()
    expect(screen.queryByRole('table')).toBeNull()
    expect(screen.queryByText('0 ₫')).toBeNull()
  })

  it('does not present a processing order’s projected expiry as a completed Pro extension', async () => {
    const processing = { ...order, id: 'processing-order', paymentCode: 'PROCESSING-ORDER', status: 'PROCESSING' as const, paidAt: null }
    request.mockResolvedValueOnce({ items: [processing, order], hasMore: false })
    setup()
    const processingRow = (await screen.findByText(processing.paymentCode)).closest('tr')!
    expect(within(processingRow).getByText('Processing')).toBeTruthy()
    expect(within(processingRow).queryByText('Pro extended until')).toBeNull()
    expect(Array.from(processingRow.querySelectorAll('time'), element => element.dateTime)).not.toContain(new Date(order.entitlementExpiresAt!).toISOString())
    const paidRow = screen.getByText(order.paymentCode).closest('tr')!
    expect(within(paidRow).getByText('Pro extended until')).toBeTruthy()
    expect(Array.from(paidRow.querySelectorAll('time'), element => element.dateTime)).toContain(new Date(order.entitlementExpiresAt!).toISOString())
  })

  it('reports an expired session, permits retry, and offers sign in without retaining payment rows', async () => {
    setup()
    await screen.findByText(order.paymentCode)
    const error = new ApiError(401, 'Session expired', 'ADMIN_REAUTH_REQUIRED')
    request.mockRejectedValueOnce(error)
    fireEvent.click(screen.getByRole('button', { name: 'Refresh' }))
    expect(await screen.findByRole('alert')).toBeTruthy()
    expect(screen.queryByText(order.paymentCode)).toBeNull()
    expect(callbacks.onError).toHaveBeenCalledWith(error)
    fireEvent.click(screen.getByRole('button', { name: 'Sign in again' }))
    expect(callbacks.onSignIn).toHaveBeenCalledOnce()
    request.mockResolvedValueOnce({ items: [order], hasMore: false })
    fireEvent.click(screen.getByRole('button', { name: 'Retry' }))
    expect(await screen.findByText(order.paymentCode)).toBeTruthy()
    expect(screen.queryByRole('alert')).toBeNull()
  })

  it('immediately hides previous account payments and ignores a late response when changing account', async () => {
    const old = deferred<PageResult<AdminTransaction>>()
    request.mockReturnValueOnce(old.promise)
    const mounted = setup()
    const oldSignal = request.mock.calls[0][2] as AbortSignal
    const fresh = { ...order, id: 'new-order', paymentCode: 'NEW-ACCOUNT-ORDER', transactionId: 'new-account-transaction' }
    request.mockResolvedValueOnce({ items: [fresh], hasMore: false })
    mounted.rerender(<AdminTransactions {...props} user={{ ...user, id: 'other-user', displayName: 'Other user', email: 'other@example.test' }} />)
    expect(oldSignal.aborted).toBe(true)
    expect(await screen.findByText(fresh.paymentCode)).toBeTruthy()
    await act(async () => { old.resolve({ items: [order], hasMore: false }); await old.promise })
    expect(screen.queryByText(order.paymentCode)).toBeNull()
    expect(screen.queryByText(user.email)).toBeNull()
    expect(callbacks.onError).not.toHaveBeenCalled()
    expect(request.mock.lastCall?.[1]).toBe('users/transactions?id=other-user&page=0&status=ALL')
  })

  it('aborts obsolete filters and ignores errors after the content is closed', async () => {
    const first = deferred<PageResult<AdminTransaction>>()
    const second = deferred<PageResult<AdminTransaction>>()
    request.mockReturnValueOnce(first.promise).mockReturnValueOnce(second.promise)
    const mounted = setup()
    const firstSignal = request.mock.calls[0][2] as AbortSignal
    fireEvent.change(screen.getByLabelText('Payment status'), { target: { value: 'PENDING' } })
    expect(firstSignal.aborted).toBe(true)
    const secondSignal = request.mock.calls[1][2] as AbortSignal
    await act(async () => { first.resolve({ items: [order], hasMore: false }); await first.promise })
    expect(screen.queryByText(order.paymentCode)).toBeNull()
    mounted.unmount()
    expect(secondSignal.aborted).toBe(true)
    await act(async () => { second.reject(new ApiError(403, 'No access')); await second.promise.catch(() => {}) })
    expect(callbacks.onError).not.toHaveBeenCalled()
  })

  it('uses the latest error callback without refetching when the parent rerenders', async () => {
    const pending = deferred<PageResult<AdminTransaction>>()
    request.mockReturnValueOnce(pending.promise)
    const mounted = setup()
    const newError = vi.fn(() => 'Latest error message')
    mounted.rerender(<AdminTransactions {...props} onError={newError} />)
    expect(request).toHaveBeenCalledOnce()
    await act(async () => { pending.reject(new Error('Offline')); await pending.promise.catch(() => {}) })
    expect(await screen.findByText('Latest error message')).toBeTruthy()
    expect(newError).toHaveBeenCalledOnce()
    expect(callbacks.onError).not.toHaveBeenCalled()
  })
})
