// @vitest-environment jsdom
import { afterEach, beforeEach, describe, expect, it, vi } from 'vitest'
import { act, cleanup, fireEvent, render, screen, waitFor, within } from '@testing-library/react'
import AdminWorkspace from './AdminWorkspace'
import { ApiError } from '../api'
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
    if (path.startsWith('catalog')) return { items: [book], hasMore: false }
    if (path === 'categories') return { items: [{ id: 'fiction', name: 'Fiction', bookCount: 1 }] }
    if (path.startsWith('users/conflicts')) return { items: [{ kind: 'highlights', recordId: 'safe-id', baseVersion: 1, currentVersion: 2, reason: 'STALE_VERSION' }], hasMore: false }
    if (path.startsWith('users')) return { items: [{ id: 'reader', email: 'reader@example.test', status: 'ACTIVE', devices: 1, syncRecords: 1, syncConflicts: 1 }, { id: 'admin', email: 'admin@example.test', status: 'ACTIVE', isAdmin: 1, devices: 0, syncRecords: 0, syncConflicts: 0 }], hasMore: false }
    if (path === 'announcements') return { items: [] }
    if (path.startsWith('audit')) return { items: [], hasMore: false }
    throw new Error('Unexpected endpoint ' + path)
  })
})
afterEach(() => cleanup())

describe('administrator workspace', () => {
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
})
