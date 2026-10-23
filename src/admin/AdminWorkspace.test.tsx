// @vitest-environment jsdom
import { afterEach, beforeEach, describe, expect, it, vi } from 'vitest'
import { act, cleanup, fireEvent, render, screen, waitFor, within } from '@testing-library/react'
import AdminWorkspace from './AdminWorkspace'
import { ANNOUNCEMENTS_UPDATED_EVENT, ApiError } from '../api'
import type { AdminIdentity, CatalogRow } from './api'

const request = vi.hoisted(() => vi.fn())
vi.mock('./api', () => ({ adminRequest: request }))
const admin: AdminIdentity = { id: 'admin', name: 'QA Admin', email: 'admin@example.test', photoUrl: null, adminExpiresAt: Date.now() + 3600000 }
const book: CatalogRow = { revision: 'server-revision-1', book: { id: 'qa-book', title: 'QA Book', author: 'Author', categoryId: 'fiction', language: 'en', description: '', fileUrl: 'https://example.test/book.epub', coverUrl: '', isFeatured: false, isNew: true } }
const callbacks = { onSignIn: vi.fn(), onCatalogChanged: vi.fn(), onProfileChanged: vi.fn(), onAccessLost: vi.fn() }
function setup() { return render(<AdminWorkspace token="qa-admin-token" admin={admin} lang="vi" {...callbacks} />) }
function deferred<T>() { let resolve!: (value: T) => void; const promise = new Promise<T>(done => { resolve = done }); return { promise, resolve } }
beforeEach(() => {
  Object.values(callbacks).forEach(callback => callback.mockReset())
  request.mockReset().mockImplementation(async (_token, path, _signal, data) => {
    if (data) return { success: true }
    if (path === 'overview') return { books: 1, categories: 1, users: 1, activeUsers: 1, proSnapshots: 0, syncRecords: 0, syncConflicts: 0 }
    if (path.startsWith('analytics?')) return { enabled: true, trackingStartedAt: null, timezone: 'Asia/Ho_Chi_Minh', days: 7, from: '2026-10-12', to: '2026-10-18', generatedAt: 1792299600000, summary: { visitors: 0, sessions: 0, pageViews: 0, activeMs: 0, newVisitors: 0, returningVisitors: 0 }, daily: [], topPages: [], events: [] }
    if (path.startsWith('transactions?')) return { from: '2026-10-12', to: '2026-10-18', timezone: 'Asia/Ho_Chi_Minh', generatedAt: 1792299600000, currency: 'VND', filters: { status: 'ALL', plan: 'ALL', q: '' }, summary: { orders: 0, paidOrders: 0, paidCustomers: 0, paidAmount: 0 }, plans: [], daily: [], statuses: [], items: [], page: 0, totalRows: 0, hasMore: false, undatedPaidOrders: 0 }
    if (path.startsWith('catalog')) return { items: [book], hasMore: false }
    if (path === 'categories') return { items: [{ id: 'fiction', name: 'Fiction', bookCount: 1 }] }
    if (path.startsWith('users/conflicts')) return { items: [{ kind: 'highlights', recordId: 'safe-id', baseVersion: 1, currentVersion: 2, reason: 'STALE_VERSION' }], hasMore: false }
    if (path.startsWith('users/transactions')) return { items: [{ id: 'paid-order', paymentCode: 'NC-PAID-ORDER', amount: 208800, currency: 'VND', planDays: 365, status: 'PAID', createdAt: 1790000000000, expiresAt: 1790003600000, paidAt: 1790000300000, transactionId: 'sepay-transaction-123', entitlementExpiresAt: 1821536300000 }], hasMore: false }
    if (path.startsWith('users')) return { items: [{ id: 'reader', email: 'reader@example.test', status: 'ACTIVE', devices: 1, syncRecords: 1, syncConflicts: 1 }, { id: 'admin', email: 'admin@example.test', status: 'ACTIVE', isAdmin: 1, devices: 0, syncRecords: 0, syncConflicts: 0 }], hasMore: false }
    if (path === 'announcements') return { items: [] }
    if (path.startsWith('audit')) return { items: [], hasMore: false }
    throw new Error('Unexpected endpoint ' + path)
  })
})
afterEach(() => cleanup())

describe('administrator workspace', () => {
  it('updates an announcement at its scheduled start and after its inclusive end without reloading', async () => {
    vi.useFakeTimers()
    const now = Date.parse('2026-10-23T12:00:00.000Z')
    vi.setSystemTime(now)
    const original = request.getMockImplementation()!
    request.mockImplementation(async (token, path, signal, data) => path === 'announcements' ? { items: [{
      id: 'timed', title: 'Timed notice', message: 'Notice', type: 'info', active: true,
      startsAt: new Date(now + 1000).toISOString(), endsAt: new Date(now + 2000).toISOString(),
    }] } : original(token, path, signal, data))
    try {
      await act(async () => { setup() })
      await act(async () => { fireEvent.click(screen.getByRole('button', { name: 'Thông báo' })) })
      expect(screen.getByText('Đã lên lịch')).toBeTruthy()
      await act(async () => { await vi.advanceTimersByTimeAsync(1000) })
      expect(screen.getByText('Đang hiển thị')).toBeTruthy()
      await act(async () => { await vi.advanceTimersByTimeAsync(1000) })
      expect(screen.getByText('Đang hiển thị')).toBeTruthy()
      await act(async () => { await vi.advanceTimersByTimeAsync(1) })
      expect(screen.getByText('Đã hết hạn')).toBeTruthy()
    } finally { cleanup(); vi.useRealTimers() }
  })
  it('distinguishes live, scheduled, expired and disabled announcements using inclusive schedule bounds', async () => {
    const now = Date.parse('2026-10-23T12:00:00.000Z')
    const clock = vi.spyOn(Date, 'now').mockReturnValue(now)
    const original = request.getMockImplementation()!
    const base = { message: 'Notice', type: 'info', active: true, startsAt: null, endsAt: null }
    request.mockImplementation(async (token, path, signal, data) => path === 'announcements' ? { items: [
      { ...base, id: 'future', title: 'Future notice', startsAt: new Date(now + 60000).toISOString() },
      { ...base, id: 'past', title: 'Past notice', endsAt: new Date(now - 1).toISOString() },
      { ...base, id: 'disabled', title: 'Disabled notice', active: false },
      { ...base, id: 'start', title: 'Starts now', startsAt: new Date(now).toISOString() },
      { ...base, id: 'end', title: 'Ends now', endsAt: new Date(now).toISOString() },
    ] } : original(token, path, signal, data))
    try {
      setup(); fireEvent.click(screen.getByRole('button', { name: 'Thông báo' }))
      const future = (await screen.findByText('Future notice')).closest('tr')!
      expect(within(future).getByText('Đã lên lịch')).toBeTruthy()
      expect(within(screen.getByText('Past notice').closest('tr')!).getByText('Đã hết hạn')).toBeTruthy()
      expect(within(screen.getByText('Disabled notice').closest('tr')!).getByText('Đã tắt')).toBeTruthy()
      for (const title of ['Starts now', 'Ends now']) expect(within(screen.getByText(title).closest('tr')!).getByText('Đang hiển thị')).toBeTruthy()
    } finally { clock.mockRestore() }
  })
  it('refreshes public announcements after a successful save and delete, but not a rejected change', async () => {
    const updated = vi.fn()
    window.addEventListener(ANNOUNCEMENTS_UPDATED_EVENT, updated)
    const original = request.getMockImplementation()!
    request.mockImplementation(async (token, path, signal, data) => path === 'announcements' ? { items: [{ id: 'notice', title: 'Site notice', message: 'Message', type: 'info', active: true, startsAt: null, endsAt: null }] } : original(token, path, signal, data))
    try {
      setup(); fireEvent.click(screen.getByRole('button', { name: 'Thông báo' }))
      fireEvent.click(await screen.findByRole('button', { name: 'Sửa' }))
      let dialog = screen.getByRole('dialog')
      fireEvent.change(within(dialog).getByLabelText('Lý do thay đổi'), { target: { value: 'Correct notice' } })
      request.mockRejectedValueOnce(new ApiError(409, 'Save failed', 'STALE_DATA'))
      fireEvent.submit(dialog.querySelector('form')!)
      await within(dialog).findByRole('alert')
      expect(updated).not.toHaveBeenCalled()
      fireEvent.submit(dialog.querySelector('form')!)
      await waitFor(() => expect(updated).toHaveBeenCalledOnce())
      fireEvent.click(await screen.findByRole('button', { name: 'Xóa' }))
      dialog = screen.getByRole('dialog')
      fireEvent.change(within(dialog).getByLabelText('Lý do thay đổi'), { target: { value: 'Remove notice' } })
      fireEvent.submit(dialog.querySelector('form')!)
      await waitFor(() => expect(updated).toHaveBeenCalledTimes(2))
      expect(request).toHaveBeenCalledWith('qa-admin-token', 'announcements/delete', expect.any(AbortSignal), { id: 'notice', reason: 'Remove notice' })
    } finally { window.removeEventListener(ANNOUNCEMENTS_UPDATED_EVENT, updated) }
  })
  it('opens global payments separately from the per-user history and handles revoked access', async () => {
    setup(); await screen.findByText('Tài khoản được bật')
    fireEvent.click(screen.getByRole('button', { name: 'Giao dịch & Pro' }))
    await screen.findByText('Không có giao dịch phù hợp bộ lọc.')
    expect(screen.getAllByRole('button', { name: 'Tải lại' })).toHaveLength(1)
    expect(screen.getByRole('button', { name: 'Giao dịch & Pro' }).getAttribute('aria-current')).toBe('page')
    request.mockRejectedValueOnce(new ApiError(403, 'Revoked', 'ADMIN_REQUIRED'))
    fireEvent.click(screen.getByRole('button', { name: 'Tải lại' }))
    await waitFor(() => expect(callbacks.onAccessLost).toHaveBeenCalledOnce())
    expect(screen.queryByRole('heading', { name: 'Khách trả tiền' })).toBeNull()
  })
  it('distinguishes enabled accounts from measured Web traffic and opens the analytics section once', async () => {
    setup()
    expect(await screen.findByText('Tài khoản được bật')).toBeTruthy()
    expect(screen.queryByText('Tài khoản hoạt động')).toBeNull()
    fireEvent.click(screen.getByRole('button', { name: 'Thống kê Web' }))
    expect(await screen.findByText(/Chưa ghi nhận truy cập trong khoảng thời gian đã chọn/)).toBeTruthy()
    expect(request.mock.calls.filter(call => call[1] === 'analytics?days=7')).toHaveLength(1)
    expect(screen.getAllByRole('button', { name: 'Tải lại' })).toHaveLength(1)
    expect(screen.queryByText('Tài khoản được bật')).toBeNull()
    expect(screen.getByRole('button', { name: 'Thống kê Web' }).getAttribute('aria-current')).toBe('page')
  })

  it('reports administrator access revocation from analytics and discards the report', async () => {
    setup()
    await screen.findByText('Tài khoản được bật')
    request.mockRejectedValueOnce(new ApiError(403, 'Revoked', 'ADMIN_REQUIRED'))
    fireEvent.click(screen.getByRole('button', { name: 'Thống kê Web' }))
    await waitFor(() => expect(callbacks.onAccessLost).toHaveBeenCalledOnce())
    expect(screen.queryByText('Khách truy cập ước tính')).toBeNull()
  })

  it('sends catalog revisions and audit reason without changing book identity', async () => {
    setup(); fireEvent.click(screen.getByRole('button', { name: 'Sách' }))
    fireEvent.click(await screen.findByRole('button', { name: 'Sửa' }))
    const dialog = screen.getByRole('dialog', { name: 'Thông tin sách' })
    await waitFor(() => expect(within(dialog).getByRole('option', { name: 'Fiction' })).toBeTruthy())
    expect((within(dialog).getByLabelText('Mã sách') as HTMLInputElement).readOnly).toBe(true)
    fireEvent.change(within(dialog).getByLabelText('Tên sách'), { target: { value: 'Updated Book' } })
    fireEvent.change(within(dialog).getByLabelText('Lý do thay đổi'), { target: { value: 'Correct title' } })
    fireEvent.submit(dialog.querySelector('form')!)
    await waitFor(() => expect(callbacks.onCatalogChanged).toHaveBeenCalledOnce())
    expect(request).toHaveBeenCalledWith('qa-admin-token', 'catalog/save', expect.any(AbortSignal), { id: 'qa-book', revision: 'server-revision-1', reason: 'Correct title', book: { title: 'Updated Book', author: 'Author', categoryId: 'fiction', language: 'en', description: '', fileUrl: 'https://example.test/book.epub', coverUrl: '', isFeatured: false, isNew: true } })
  })

  it('requires confirmation and grants a selected trial duration to the selected user', async () => {
    setup(); fireEvent.click(screen.getByRole('button', { name: 'Người dùng & Pro' }))
    await screen.findAllByRole('button', { name: 'Cấp Pro thử nghiệm' })
    const row = screen.getAllByText('reader@example.test')[0].closest('tr')!
    fireEvent.click(within(row).getByRole('button', { name: 'Cấp Pro thử nghiệm' }))
    const dialog = screen.getByRole('dialog', { name: 'Cấp Pro thử nghiệm' })
    expect(request.mock.calls.some(call => call[1] === 'users/pro/grant')).toBe(false)
    fireEvent.change(within(dialog).getByLabelText('Thời hạn Pro (ngày)'), { target: { value: '30' } })
    fireEvent.change(within(dialog).getByLabelText('Lý do thay đổi'), { target: { value: 'Trial requested' } })
    fireEvent.submit(dialog.querySelector('form')!)
    await screen.findByText('Đã lưu thay đổi.')
    await screen.findAllByRole('button', { name: 'Cấp Pro thử nghiệm' })
    expect(request).toHaveBeenCalledWith('qa-admin-token', 'users/pro/grant', expect.any(AbortSignal), { id: 'reader', days: 30, reason: 'Trial requested' })
    const adminRow = screen.getAllByText('admin@example.test').find(node => node.closest('tr'))!.closest('tr')!
    expect((within(adminRow).getByRole('button', { name: 'Khóa' }) as HTMLButtonElement).disabled).toBe(true)
    expect((within(adminRow).getByRole('button', { name: 'Thu hồi phiên' }) as HTMLButtonElement).disabled).toBe(true)
  })

  it('keeps a stale catalog form open and offers reauthentication without submitting twice', async () => {
    request.mockImplementationOnce(async () => ({}))
    setup(); fireEvent.click(screen.getByRole('button', { name: 'Thể loại' }))
    fireEvent.click(await screen.findByRole('button', { name: 'Sửa' }))
    const dialog = screen.getByRole('dialog')
    fireEvent.change(within(dialog).getByLabelText('Lý do thay đổi'), { target: { value: 'Rename' } })
    request.mockRejectedValueOnce(new ApiError(401, 'Fresh login required', 'RECENT_LOGIN_REQUIRED'))
    fireEvent.submit(dialog.querySelector('form')!)
    expect(await within(dialog).findByText('Đăng nhập lại để xác nhận thao tác quản trị.')).toBeTruthy()
    fireEvent.click(within(dialog).getByRole('button', { name: 'Đăng nhập lại' }))
    expect(callbacks.onSignIn).toHaveBeenCalledOnce()
    expect(screen.queryByRole('dialog')).toBeNull()
  })

  it('cancels a pending mutation on account departure and ignores its late response', async () => {
    const pending = deferred<object>()
    const mounted = setup(); fireEvent.click(screen.getByRole('button', { name: 'Thể loại' }))
    fireEvent.click(await screen.findByRole('button', { name: 'Sửa' }))
    const dialog = screen.getByRole('dialog')
    fireEvent.change(within(dialog).getByLabelText('Lý do thay đổi'), { target: { value: 'Rename' } })
    request.mockReturnValueOnce(pending.promise)
    fireEvent.submit(dialog.querySelector('form')!)
    const write = request.mock.calls.find(call => call[1] === 'categories/save')!
    mounted.unmount()
    expect(write[2].aborted).toBe(true)
    await act(async () => { pending.resolve({ success: true }); await pending.promise })
    expect(callbacks.onCatalogChanged).not.toHaveBeenCalled()
  })

  it('accumulates R2 batches once and resets totals on a new scan', async () => {
    const original = request.getMockImplementation()!
    request.mockImplementation(async (token, path, signal, data) => path.startsWith('storage') ? { groups: { public: { objects: 1, bytes: 1048576 }, private: { objects: 2, bytes: 2097152 }, other: { objects: 0, bytes: 0 } }, cursor: path.includes('?') ? null : 'next-cursor', complete: path.includes('?'), measuredAt: new Date().toISOString() } : original(token, path, signal, data))
    setup(); fireEvent.click(screen.getByRole('button', { name: 'Dung lượng R2' }))
    fireEvent.click(await screen.findByRole('button', { name: 'Bắt đầu quét' }))
    await screen.findByText(/Kết quả tạm tính/)
    fireEvent.click(screen.getByRole('button', { name: 'Quét lượt tiếp' }))
    await screen.findByText(/Quét hoàn tất/)
    expect(screen.getByText('4 MB')).toBeTruthy()
    expect(request).toHaveBeenCalledWith('qa-admin-token', 'storage?cursor=next-cursor', expect.any(AbortSignal))
    fireEvent.click(screen.getByRole('button', { name: 'Quét lại từ đầu' }))
    await screen.findByText(/Kết quả tạm tính/)
    expect(screen.queryByText('4 MB')).toBeNull()
    expect(screen.getByText('2 MB')).toBeTruthy()
  })

  it('loads conflict metadata for the selected user and clears a revoked admin view', async () => {
    setup(); fireEvent.click(screen.getByRole('button', { name: 'Người dùng & Pro' }))
    fireEvent.click((await screen.findAllByRole('button', { name: 'Xem xung đột' }))[0])
    expect(await screen.findByText('safe-id')).toBeTruthy()
    expect(request).toHaveBeenCalledWith('qa-admin-token', 'users/conflicts?id=reader&page=0', expect.any(AbortSignal))
    fireEvent.click(screen.getByRole('button', { name: 'Đóng' }))
    request.mockRejectedValueOnce(new ApiError(403, 'Revoked', 'ADMIN_REQUIRED'))
    fireEvent.click(screen.getByRole('button', { name: 'Lịch sử thao tác' }))
    await waitFor(() => expect(callbacks.onAccessLost).toHaveBeenCalledOnce())
    expect(screen.queryByText('reader@example.test')).toBeNull()
  })

  it('opens read-only transaction history for the selected account and restores focus on Escape', async () => {
    setup(); fireEvent.click(screen.getByRole('button', { name: 'Người dùng & Pro' }))
    await screen.findAllByRole('button', { name: 'Lịch sử giao dịch' })
    const row = screen.getAllByText('reader@example.test')[0].closest('tr')!
    const trigger = within(row).getByRole('button', { name: 'Lịch sử giao dịch' })
    trigger.focus(); fireEvent.click(trigger)
    const dialog = screen.getByRole('dialog', { name: 'Lịch sử giao dịch' })
    expect(await within(dialog).findByText('NC-PAID-ORDER')).toBeTruthy()
    expect(within(dialog).getByText('sepay-transaction-123')).toBeTruthy()
    expect(request).toHaveBeenCalledWith('qa-admin-token', 'users/transactions?id=reader&page=0&status=ALL', expect.any(AbortSignal))
    expect(dialog.querySelector('form')).toBeNull()
    expect(request.mock.calls.filter(call => call[3])).toHaveLength(0)
    fireEvent.keyDown(document, { key: 'Escape' })
    expect(screen.queryByRole('dialog')).toBeNull()
    expect(document.activeElement).toBe(trigger)
  })

  it('closes transaction history immediately when administrator access is revoked', async () => {
    setup(); fireEvent.click(screen.getByRole('button', { name: 'Người dùng & Pro' }))
    const triggers = await screen.findAllByRole('button', { name: 'Lịch sử giao dịch' })
    request.mockRejectedValueOnce(new ApiError(403, 'Revoked', 'ADMIN_REQUIRED'))
    fireEvent.click(triggers[0])
    await waitFor(() => expect(callbacks.onAccessLost).toHaveBeenCalledOnce())
    expect(screen.queryByRole('dialog')).toBeNull()
    expect(screen.queryByText('NC-PAID-ORDER')).toBeNull()
  })

  it('focuses an enabled transaction control while loading and traps keyboard focus inside the dialog', async () => {
    const pending = deferred<object>()
    const mounted = setup(); fireEvent.click(screen.getByRole('button', { name: 'Người dùng & Pro' }))
    const triggers = await screen.findAllByRole('button', { name: 'Lịch sử giao dịch' })
    request.mockReturnValueOnce(pending.promise)
    triggers[0].focus(); fireEvent.click(triggers[0])
    const dialog = screen.getByRole('dialog', { name: 'Lịch sử giao dịch' })
    const filter = within(dialog).getByRole('combobox', { name: 'Trạng thái thanh toán' })
    const close = within(dialog).getByRole('button', { name: 'Đóng' })
    expect(document.activeElement).toBe(filter)
    expect((within(dialog).getByRole('button', { name: 'Tải lại' }) as HTMLButtonElement).disabled).toBe(true)
    fireEvent.keyDown(filter, { key: 'Tab', shiftKey: true })
    expect(document.activeElement).toBe(close)
    fireEvent.keyDown(close, { key: 'Tab' })
    expect(document.activeElement).toBe(filter)
    triggers[0].focus()
    fireEvent.keyDown(document, { key: 'Tab' })
    expect(document.activeElement).toBe(filter)
    mounted.unmount()
  })
})
