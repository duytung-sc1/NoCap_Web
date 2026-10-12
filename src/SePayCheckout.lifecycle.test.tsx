// @vitest-environment jsdom
import { afterEach, beforeEach, describe, expect, it, vi } from 'vitest'
import { act, cleanup, fireEvent, render, screen, waitFor, within } from '@testing-library/react'
import { SePayCheckout } from './SePayCheckout'
import type { Entitlement, SePayOrder } from './api'
import type { Session } from './types'

const api = vi.hoisted(() => ({ create: vi.fn(), check: vi.fn(), entitlement: vi.fn() }))
vi.mock('./api', async importOriginal => ({
  ...await importOriginal<typeof import('./api')>(),
  createSePayOrder: api.create, getSePayOrder: api.check, getEntitlement: api.entitlement,
  getSePayPlans: async () => ({ plans: [{ id: 'MONTHLY', amount: 29000, regularAmount: 29000, planDays: 30, currency: 'VND', discountPercent: 0 }] }),
}))
const session: Session = { token: 'qa-token', expiresAt: Date.now() / 1000 + 86400,
  user: { id: 'qa-account', email: 'qa@example.test', emailVerified: true } }
const entitlement: Entitlement = { userId: session.user.id, plan: 'PRO', status: 'ACTIVE', expiresAt: Date.now() + 86400000, updatedAt: Date.now() }
function order(id: string, status: SePayOrder['status'] = 'PENDING'): SePayOrder {
  return { id, status, amount: 29000, currency: 'VND', paymentContent: `QA-${id}`, expiresAt: Date.now() + 60000,
    bank: { code: 'QA', name: 'QA bank', accountNumber: 'fixture', accountHolder: 'QA', vietQrBankId: 'QA' }, qrUrl: `https://qr.example.test/${id}` }
}
function deferred<T>() {
  let resolve!: (value: T) => void
  const promise = new Promise<T>(done => { resolve = done })
  return { promise, resolve }
}
async function openOrder() {
  const upgrade = screen.getByRole('button', { name: 'Nâng cấp qua SePay' })
  await waitFor(() => expect(upgrade.hasAttribute('disabled')).toBe(false))
  fireEvent.click(upgrade)
  return screen.findByRole('dialog', { name: 'Thanh toán NoCap Pro' })
}
beforeEach(() => {
  api.create.mockReset().mockResolvedValue(order('first'))
  api.check.mockReset()
  api.entitlement.mockReset().mockResolvedValue(entitlement)
})
afterEach(() => { cleanup(); vi.restoreAllMocks(); vi.useRealTimers() })

describe('payment dialog lifecycle', () => {
  it('does not reopen a closed checkout when a manual status request completes late', async () => {
    const pending = deferred<SePayOrder>(); api.check.mockReturnValue(pending.promise)
    render(<SePayCheckout session={session} entitlement={null} lang="vi" onSignIn={vi.fn()} onPaid={vi.fn()} />)
    const dialog = await openOrder()
    fireEvent.click(within(dialog).getByRole('button', { name: 'Kiểm tra thanh toán' }))
    fireEvent.click(within(dialog).getByRole('button', { name: 'Đóng thanh toán' }))
    await act(async () => { pending.resolve(order('first')); await pending.promise })
    expect(screen.queryByRole('dialog')).toBeNull()
  })

  it('does not replace a new QR order or grant access from a superseded status request', async () => {
    const pending = deferred<SePayOrder>(); api.check.mockReturnValue(pending.promise)
    const onPaid = vi.fn()
    render(<SePayCheckout session={session} entitlement={null} lang="vi" onSignIn={vi.fn()} onPaid={onPaid} />)
    const first = await openOrder()
    fireEvent.click(within(first).getByRole('button', { name: 'Kiểm tra thanh toán' }))
    fireEvent.click(within(first).getByRole('button', { name: 'Đóng thanh toán' }))
    api.create.mockResolvedValue(order('second'))
    const second = await openOrder()
    expect(within(second).getByRole('img').getAttribute('src')).toContain('/second')
    await act(async () => { pending.resolve(order('first', 'PAID')); await pending.promise })
    expect(screen.getByRole('img').getAttribute('src')).toContain('/second')
    expect(onPaid).not.toHaveBeenCalled()
  })

  it('refreshes entitlement and notifies the parent once after manual payment confirmation', async () => {
    api.check.mockResolvedValue(order('first', 'PAID'))
    const pending = deferred<Entitlement>(); api.entitlement.mockReturnValue(pending.promise)
    const onPaid = vi.fn()
    render(<SePayCheckout session={session} entitlement={null} lang="vi" onSignIn={vi.fn()} onPaid={onPaid} />)
    const dialog = await openOrder()
    fireEvent.click(within(dialog).getByRole('button', { name: 'Kiểm tra thanh toán' }))
    await screen.findByText('Đã thanh toán')
    await waitFor(() => expect(api.entitlement).toHaveBeenCalledTimes(1))
    await act(async () => { pending.resolve(entitlement); await pending.promise })
    await waitFor(() => expect(onPaid).toHaveBeenCalledTimes(1))
    expect(api.entitlement).toHaveBeenCalledTimes(1)
    expect(onPaid).toHaveBeenCalledWith(entitlement)
  })

  it('discards a late entitlement response after the confirmed payment dialog is closed', async () => {
    api.check.mockResolvedValue(order('first', 'PAID'))
    const pending = deferred<Entitlement>(); api.entitlement.mockReturnValue(pending.promise)
    const onPaid = vi.fn()
    render(<SePayCheckout session={session} entitlement={null} lang="vi" onSignIn={vi.fn()} onPaid={onPaid} />)
    const dialog = await openOrder()
    fireEvent.click(within(dialog).getByRole('button', { name: 'Kiểm tra thanh toán' }))
    await waitFor(() => expect(api.entitlement).toHaveBeenCalledTimes(1))
    fireEvent.click(within(dialog).getByRole('button', { name: 'Đóng thanh toán' }))
    await act(async () => { pending.resolve(entitlement); await pending.promise })
    expect(screen.queryByRole('dialog')).toBeNull()
    expect(onPaid).not.toHaveBeenCalled()
  })

  it('allows retrying entitlement after the payment succeeds but the profile request fails', async () => {
    api.check.mockResolvedValue(order('first', 'PAID'))
    api.entitlement.mockRejectedValueOnce(new Error('QA connection failure')).mockResolvedValue(entitlement)
    const onPaid = vi.fn()
    render(<SePayCheckout session={session} entitlement={null} lang="vi" onSignIn={vi.fn()} onPaid={onPaid} />)
    const dialog = await openOrder()
    fireEvent.click(within(dialog).getByRole('button', { name: 'Kiểm tra thanh toán' }))
    await within(dialog).findByRole('alert')
    fireEvent.click(within(dialog).getByRole('button', { name: 'Kiểm tra thanh toán' }))
    await waitFor(() => expect(onPaid).toHaveBeenCalledTimes(1))
    expect(api.entitlement).toHaveBeenCalledTimes(2)
  })

  it('keeps the confirmed status when an earlier manual check returns pending after a poll', async () => {
    const pending = deferred<SePayOrder>()
    api.check.mockReturnValueOnce(pending.promise).mockResolvedValueOnce(order('first', 'PAID'))
    vi.spyOn(document, 'visibilityState', 'get').mockReturnValue('visible')
    const onPaid = vi.fn()
    render(<SePayCheckout session={session} entitlement={null} lang="vi" onSignIn={vi.fn()} onPaid={onPaid} />)
    const upgrade = screen.getByRole('button', { name: 'Nâng cấp qua SePay' })
    await waitFor(() => expect(upgrade.hasAttribute('disabled')).toBe(false))
    vi.useFakeTimers()
    await act(async () => { fireEvent.click(upgrade) })
    const dialog = screen.getByRole('dialog')
    fireEvent.click(within(dialog).getByRole('button', { name: 'Kiểm tra thanh toán' }))
    await act(async () => { await vi.advanceTimersByTimeAsync(5000) })
    expect(within(dialog).getByText('Đã thanh toán')).toBeTruthy()
    await act(async () => { pending.resolve(order('first')); await pending.promise })
    expect(within(dialog).getByText('Đã thanh toán')).toBeTruthy()
    expect(onPaid).toHaveBeenCalledTimes(1)
  })
})
