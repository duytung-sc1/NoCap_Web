// @vitest-environment jsdom
import { afterEach, beforeEach, describe, expect, it, vi } from 'vitest'
import { act, cleanup, fireEvent, render, screen, waitFor, within } from '@testing-library/react'
import type { LocalFile, Session, SyncRecord } from './types'
import { readSession, saveSession, SESSION_STORAGE_KEY } from './store'
import App from './App'
import { ApiError } from './api'

const fixtures = vi.hoisted(() => ({
  login: vi.fn(), googleLogin: vi.fn(), getFiles: vi.fn(), getCatalog: vi.fn(), removeLocalDocument: vi.fn(), mutate: vi.fn(), loadBytes: vi.fn(), downloadHttps: vi.fn(), adminIdentity: vi.fn(), adminRequest: vi.fn(), localRecords: vi.fn(), entitlement: vi.fn(), preparePdf: vi.fn(), saveDownload: vi.fn(), conflicts: vi.fn(), resolveConflict: vi.fn(), updateProfile: vi.fn(), deleteAccount: vi.fn(), readerThrows: false, adminThrows: false,
}))
vi.mock('./httpsImport', async importOriginal => ({
  ...await importOriginal<typeof import('./httpsImport')>(), downloadHttpsPublication: fixtures.downloadHttps,
}))
vi.mock('./admin/api', async importOriginal => ({
  ...await importOriginal<typeof import('./admin/api')>(), getAdminIdentity: fixtures.adminIdentity, adminRequest: fixtures.adminRequest,
}))
vi.mock('./api', async importOriginal => ({
  ...await importOriginal<typeof import('./api')>(),
  getCatalog: fixtures.getCatalog,
  login: fixtures.login, loginWithGoogle: fixtures.googleLogin,
  getUser: async (token: string) => ({ user: readSession()?.token === token ? readSession()!.user : session.user }),
  getEntitlement: fixtures.entitlement,
  updateProfile: fixtures.updateProfile, deleteAccount: fixtures.deleteAccount,
  getSePayPlans: async () => ({ plans: [] }),
  loadBookBytes: fixtures.loadBytes,
}))
vi.mock('./store', async importOriginal => ({
  ...await importOriginal<typeof import('./store')>(),
  getFiles: fixtures.getFiles, getFile: async () => undefined, removeLocalDocument: fixtures.removeLocalDocument,
  getOfflineBooks: async () => [], getOfflineBook: async () => undefined,
  getPending: async () => [], getCachedCatalog: async () => undefined,
  saveCachedCatalog: async () => {},
}))
vi.mock('./sync', async importOriginal => ({
  ...await importOriginal<typeof import('./sync')>(),
  localRecords: fixtures.localRecords, getConflicts: fixtures.conflicts, resolveConflict: fixtures.resolveConflict,
  syncNow: async () => ({ conflicts: 0, changes: 0 }),
  connectLiveSync: () => () => {}, mutate: fixtures.mutate,
}))
vi.mock('./OceanWaves', () => ({ OceanWaves: () => null }))
vi.mock('./admin/AdminWorkspace', async importOriginal => {
  const { default: Original } = await importOriginal<typeof import('./admin/AdminWorkspace')>()
  return { default: (props: Parameters<typeof Original>[0]) => {
    if (fixtures.adminThrows) throw new Error('QA admin bundle/render failure')
    return <Original {...props} />
  } }
})
vi.mock('./notesPdf', () => ({ prepareNotesPdf: fixtures.preparePdf }))
vi.mock('./bookDownload', async importOriginal => ({
  ...await importOriginal<typeof import('./bookDownload')>(), saveBookDownload: fixtures.saveDownload,
}))
vi.mock('./Reader', async () => {
  const { useEffect } = await import('react')
  return { ReaderPane: ({ onLocation }: { onLocation: (location: object) => void }) => {
    useEffect(() => { onLocation({ locatorJson: '{"type":"TEXT","progression":0.6}', progression: 0.6, chapterTitle: 'QA' }) }, [onLocation])
    if (fixtures.readerThrows) throw new Error('QA reader bundle/render failure')
    return <p>QA reader content</p>
  } }
})
const session: Session = { token: 'qa-only-token', expiresAt: Date.now() / 1000 + 86400,
  user: { id: 'qa-user', email: 'qa@example.test', displayName: 'QA Reader', emailVerified: true } }
function deferred<T>() {
  let resolve!: (value: T) => void
  const promise = new Promise<T>(done => { resolve = done })
  return { promise, resolve }
}
function file(id: string): LocalFile {
  return { key: `DEVICE_LOCAL:${id}`, profile: 'DEVICE_LOCAL', addedAt: 1,
    book: { id, title: id, author: 'QA', source: 'local', format: 'TXT' }, data: new Blob(['QA']) }
}
async function openLogin() {
  fireEvent.click(screen.getAllByRole('button', { name: 'Đăng nhập' })[0])
  const dialog = screen.getByRole('dialog', { name: 'Chào mừng quay lại.' })
  fireEvent.change(within(dialog).getByLabelText('Email'), { target: { value: session.user.email } })
  fireEvent.change(within(dialog).getByLabelText('Mật khẩu'), { target: { value: 'qa-password' } })
  fireEvent.submit(dialog.querySelector('form')!)
  return dialog
}
beforeEach(() => {
  localStorage.clear(); sessionStorage.clear(); window.history.replaceState(null, '', '/')
  vi.spyOn(window, 'scrollTo').mockImplementation(() => {})
  fixtures.getFiles.mockReset().mockResolvedValue([])
  fixtures.getCatalog.mockReset().mockResolvedValue({ books: [], categories: [] })
  fixtures.removeLocalDocument.mockReset().mockResolvedValue(undefined)
  fixtures.mutate.mockReset().mockResolvedValue(undefined)
  fixtures.login.mockReset(); fixtures.googleLogin.mockReset()
  fixtures.loadBytes.mockReset().mockResolvedValue(new TextEncoder().encode('QA document').buffer)
  fixtures.downloadHttps.mockReset()
  fixtures.adminIdentity.mockReset().mockRejectedValue(new ApiError(403, 'Not an admin', 'ADMIN_REQUIRED'))
  fixtures.adminRequest.mockReset().mockResolvedValue({ books: 4, categories: 2, users: 3, activeUsers: 3, syncRecords: 2, syncConflicts: 0, proSnapshots: 1, playConfigured: false })
  fixtures.readerThrows = false
  fixtures.adminThrows = false
  fixtures.updateProfile.mockReset().mockResolvedValue(session.user)
  fixtures.deleteAccount.mockReset().mockResolvedValue(undefined)
  fixtures.localRecords.mockReset().mockResolvedValue([])
  fixtures.entitlement.mockReset().mockResolvedValue({ userId: session.user.id, plan: 'FREE' })
  fixtures.preparePdf.mockReset().mockResolvedValue({ filename: 'notes.pdf', blob: new Blob(['%PDF-1.3'], { type: 'application/pdf' }) })
  fixtures.saveDownload.mockReset()
  fixtures.conflicts.mockReset().mockResolvedValue([])
  fixtures.resolveConflict.mockReset().mockResolvedValue(undefined)
})
afterEach(() => { cleanup(); vi.restoreAllMocks(); delete (window as unknown as { google?: unknown }).google })

describe('library write failures and concurrent actions', () => {
  async function reader() {
    fixtures.getFiles.mockResolvedValue([file('QA document')])
    window.history.replaceState(null, '', '/read/QA%20document')
    render(<App />)
    await screen.findByText('QA reader content')
    return screen.getByRole('button', { name: 'Đánh dấu vị trí' })
  }

  it('creates only one bookmark while its storage write is pending', async () => {
    const button = await reader()
    const pending = deferred<void>()
    fixtures.mutate.mockImplementation((_profile, kind) => kind === 'bookmarks' ? pending.promise : Promise.resolve())
    fireEvent.click(button); fireEvent.click(button)
    try {
      expect(fixtures.mutate.mock.calls.filter(([, kind]) => kind === 'bookmarks')).toHaveLength(1)
      expect(button.hasAttribute('disabled')).toBe(true)
    } finally {
      await act(async () => { pending.resolve(); await pending.promise })
    }
    expect(button.hasAttribute('disabled')).toBe(false)
  })

  it('reports a failed bookmark write and permits retry', async () => {
    const button = await reader()
    fixtures.mutate.mockImplementation((_profile, kind) => kind === 'bookmarks' ? Promise.reject(new Error('Bookmark storage unavailable')) : Promise.resolve())
    fireEvent.click(button)
    const error = await screen.findByText('Bookmark storage unavailable')
    expect(error.closest('.reader-notice')).toBeTruthy()
    expect(error.closest('.reader-shell')).toBeNull()
    fireEvent.click(screen.getByRole('button', { name: 'Đóng thông báo' }))
    expect(screen.queryByText('Bookmark storage unavailable')).toBeNull()
    fixtures.mutate.mockResolvedValue(undefined)
    fireEvent.click(button)
    expect(await screen.findByText('Đã thêm dấu trang.')).toBeTruthy()
  })

  it('does not show a bookmark completion in a replacement account', async () => {
    saveSession(session)
    const button = await reader()
    const pending = deferred<void>()
    fixtures.mutate.mockImplementation((_profile, kind) => kind === 'bookmarks' ? pending.promise : Promise.resolve())
    fireEvent.click(button)
    saveSession(null)
    fireEvent(window, new StorageEvent('storage', { key: SESSION_STORAGE_KEY, storageArea: localStorage }))
    await act(async () => { pending.resolve(); await pending.promise })
    expect(screen.queryByText('Đã thêm dấu trang.')).toBeNull()
  })

  it('shows note storage errors above the reader while preserving the open draft', async () => {
    await reader()
    fireEvent.click(screen.getByRole('button', { name: 'Thêm ghi chú' }))
    const dialog = screen.getByRole('dialog', { name: 'Lưu điều đáng nhớ' })
    fireEvent.change(within(dialog).getByRole('textbox'), { target: { value: 'Keep my draft' } })
    fixtures.mutate.mockImplementation((_profile, kind) => kind === 'highlights' ? Promise.reject(new Error('Note storage unavailable')) : Promise.resolve())
    fireEvent.click(within(dialog).getByRole('button', { name: 'Lưu ghi chú' }))
    const error = await screen.findByText('Note storage unavailable')
    expect(error.closest('.reader-notice')).toBeTruthy()
    expect(error.closest('.reader-shell')).toBeNull()
    expect((within(dialog).getByRole('textbox') as HTMLTextAreaElement).value).toBe('Keep my draft')
  })

  it('reports a failed library save and prevents repeated pending favorite writes', async () => {
    fixtures.getCatalog.mockResolvedValue({ books: [{ id: 'qa-public', title: 'QA public', author: 'QA', source: 'public', format: 'TXT' }], categories: [] })
    window.history.replaceState(null, '', '/explore')
    render(<App />)
    const button = await screen.findByRole('button', { name: 'Lưu vào tủ sách: QA public' })
    fixtures.mutate.mockRejectedValueOnce(new Error('Favorite storage unavailable'))
    fireEvent.click(button)
    expect(await screen.findByText('Favorite storage unavailable')).toBeTruthy()
    const pending = deferred<void>()
    fixtures.mutate.mockReturnValue(pending.promise)
    fireEvent.click(button); fireEvent.click(button)
    try { expect(fixtures.mutate.mock.calls.filter(([, kind]) => kind === 'favorites')).toHaveLength(2) }
    finally { await act(async () => { pending.resolve(); await pending.promise }) }
  })

  it('reports a failed local deletion and allows a successful retry', async () => {
    fixtures.getFiles.mockResolvedValue([file('QA document')])
    vi.spyOn(window, 'confirm').mockReturnValue(true)
    window.history.replaceState(null, '', '/library')
    render(<App />)
    const button = await screen.findByRole('button', { name: 'Xóa tệp trên trình duyệt' })
    fixtures.removeLocalDocument.mockRejectedValueOnce(new Error('Deletion storage unavailable'))
    fireEvent.click(button)
    expect(await screen.findByText('Deletion storage unavailable')).toBeTruthy()
    fireEvent.click(button)
    expect(await screen.findByText('Đã xóa tài liệu.')).toBeTruthy()
    expect(fixtures.removeLocalDocument).toHaveBeenCalledTimes(2)
  })

  it('does not repeat a pending deletion or show its completion after an account switch', async () => {
    saveSession(session)
    fixtures.getFiles.mockResolvedValue([file('QA document')])
    vi.spyOn(window, 'confirm').mockReturnValue(true)
    const pending = deferred<void>()
    fixtures.removeLocalDocument.mockReturnValue(pending.promise)
    window.history.replaceState(null, '', '/library')
    render(<App />)
    const button = await screen.findByRole('button', { name: 'Xóa tệp trên trình duyệt' })
    fireEvent.click(button); fireEvent.click(button)
    expect(fixtures.removeLocalDocument).toHaveBeenCalledExactlyOnceWith('ACCOUNT:qa-user', 'QA document')
    expect(window.confirm).toHaveBeenCalledOnce()
    saveSession(null)
    fireEvent(window, new StorageEvent('storage', { key: SESSION_STORAGE_KEY, storageArea: localStorage }))
    await act(async () => { pending.resolve(); await pending.promise })
    expect(screen.queryByText('Đã xóa tài liệu.')).toBeNull()
  })

  it('keeps a failed favorite write in its original account', async () => {
    saveSession(session)
    fixtures.getCatalog.mockResolvedValue({ books: [{ id: 'qa-public', title: 'QA public', author: 'QA', source: 'public', format: 'TXT' }], categories: [] })
    let reject!: (error: Error) => void
    const pending = new Promise<void>((_resolve, fail) => { reject = fail })
    fixtures.mutate.mockImplementation((_profile, kind) => kind === 'favorites' ? pending : Promise.resolve())
    window.history.replaceState(null, '', '/explore')
    render(<App />)
    fireEvent.click(await screen.findByRole('button', { name: 'Lưu vào tủ sách: QA public' }))
    saveSession(null)
    fireEvent(window, new StorageEvent('storage', { key: SESSION_STORAGE_KEY, storageArea: localStorage }))
    await act(async () => { reject(new Error('Old account favorite failed')); await pending.catch(() => {}) })
    expect(screen.queryByText('Old account favorite failed')).toBeNull()
  })

  it('never queues a browser-only document favorite for cloud sync from the home page', async () => {
    fixtures.getFiles.mockResolvedValue([file('QA document')])
    fixtures.localRecords.mockResolvedValue([{ key: 'DEVICE_LOCAL:reading_progress:qa', profile: 'DEVICE_LOCAL', kind: 'reading_progress', id: 'qa', version: 1, deleted: false, payload: { book_id: 'QA document', progression: 0.2, updated_at: Date.now() } }])
    render(<App />)
    fireEvent.click(await screen.findByRole('button', { name: 'Lưu vào tủ sách: QA document' }))
    await waitFor(() => expect(fixtures.mutate.mock.calls.find(([, kind]) => kind === 'favorites')?.[5]).toBe(true))
  })
})

describe('Reading Memory PDF export', () => {
  async function memory(pro: boolean) {
    saveSession(session)
    window.history.replaceState(null, '', '/memory')
    fixtures.getFiles.mockResolvedValue([file('QA document')])
    const annotation: SyncRecord = { key: 'ACCOUNT:qa-user:highlights:note', profile: 'ACCOUNT:qa-user', kind: 'highlights', id: 'note', version: 1, deleted: false,
      payload: { book_id: 'QA document', text: 'Trích dẫn tiếng Việt', note: 'Ghi chú riêng', created_at: Date.now() } }
    fixtures.localRecords.mockResolvedValue([annotation])
    if (pro) fixtures.entitlement.mockResolvedValue({ userId: session.user.id, plan: 'PRO', status: 'ACTIVE', updatedAt: Date.now(), expiresAt: Date.now() + 86400000 })
    render(<App />)
    return screen.findByRole('button', { name: 'Xuất PDF · Pro' })
  }

  it('replaces Markdown with PDF and prompts Free accounts without generating a document', async () => {
    fireEvent.click(await memory(false))
    expect(await screen.findByText(/Xuất trích dẫn, ghi chú và dấu trang thành tệp PDF cần gói Pro/)).toBeTruthy()
    expect(screen.queryByRole('button', { name: /\.md|Markdown/ })).toBeNull()
    expect(fixtures.preparePdf).not.toHaveBeenCalled()
    expect(fixtures.saveDownload).not.toHaveBeenCalled()
  })

  it('downloads one actual PDF result for Pro and prevents repeated concurrent exports', async () => {
    const pending = deferred<{ filename: string; blob: Blob }>()
    fixtures.preparePdf.mockReturnValue(pending.promise)
    const button = await memory(true)
    fireEvent.click(button); fireEvent.click(button)
    await waitFor(() => expect(fixtures.preparePdf).toHaveBeenCalledTimes(1))
    expect(screen.getByRole('button', { name: 'Đang tạo PDF…' }).hasAttribute('disabled')).toBe(true)
    const download = { filename: 'notes.pdf', blob: new Blob(['%PDF-1.3'], { type: 'application/pdf' }) }
    await act(async () => { pending.resolve(download); await pending.promise })
    await waitFor(() => expect(fixtures.saveDownload).toHaveBeenCalledExactlyOnceWith(download))
    expect(await screen.findByText('Đã xuất trích dẫn và ghi chú ra tệp PDF.')).toBeTruthy()
  })

  it('discards a generated private PDF when the user signs out in another tab', async () => {
    const pending = deferred<{ filename: string; blob: Blob }>()
    fixtures.preparePdf.mockReturnValue(pending.promise)
    fireEvent.click(await memory(true))
    await waitFor(() => expect(fixtures.preparePdf).toHaveBeenCalledTimes(1))
    saveSession(null)
    fireEvent(window, new StorageEvent('storage', { key: SESSION_STORAGE_KEY, storageArea: localStorage }))
    await act(async () => { pending.resolve({ filename: 'private.pdf', blob: new Blob(['%PDF-1.3']) }); await pending.promise })
    expect(fixtures.saveDownload).not.toHaveBeenCalled()
    expect(screen.queryByText('Đã xuất trích dẫn và ghi chú ra tệp PDF.')).toBeNull()
  })

  it('releases the export button after a generation error and allows retry', async () => {
    fixtures.preparePdf.mockRejectedValueOnce(new Error('Font unavailable'))
    fireEvent.click(await memory(true))
    expect(await screen.findByText('Không xuất được PDF. Vui lòng thử lại.')).toBeTruthy()
    fireEvent.click(screen.getByRole('button', { name: 'Xuất PDF · Pro' }))
    await waitFor(() => expect(fixtures.saveDownload).toHaveBeenCalledTimes(1))
  })
})

describe('account and reader lifecycle', () => {
  it('does not show an old display-name error after the account is replaced', async () => {
    saveSession(session)
    window.history.replaceState(null, '', '/account')
    render(<App />)
    fireEvent.click((await screen.findAllByRole('button', { name: 'Đổi tên hiển thị' }))[0])
    const dialog = screen.getByRole('dialog')
    fireEvent.change(within(dialog).getByRole('textbox'), { target: { value: 'Old account name' } })
    let reject!: (error: Error) => void
    const pending = new Promise<void>((_resolve, fail) => { reject = fail })
    fixtures.updateProfile.mockReturnValue(pending)
    fireEvent.submit(dialog.querySelector('form')!)
    await waitFor(() => expect(fixtures.updateProfile).toHaveBeenCalled())
    saveSession({ ...session, token: 'replacement-token', user: { ...session.user, id: 'other-user' } })
    fireEvent(window, new StorageEvent('storage', { key: SESSION_STORAGE_KEY, storageArea: localStorage }))
    await act(async () => { reject(new Error('Old account update failed')); await pending.catch(() => {}) })
    expect(screen.queryByText('Old account update failed')).toBeNull()
    expect(screen.queryByRole('dialog')).toBeNull()
  })

  it('prevents repeated organization submissions and preserves text typed while saving', async () => {
    window.history.replaceState(null, '', '/library')
    render(<App />)
    fireEvent.click(await screen.findByRole('button', { name: 'Quản lý Thẻ & Bộ sưu tập' }))
    const dialog = screen.getByRole('dialog')
    fireEvent.change(within(dialog).getByRole('textbox'), { target: { value: 'First tag' } })
    const pending = deferred<void>()
    fixtures.mutate.mockReturnValue(pending.promise)
    fireEvent.submit(dialog.querySelector('form')!); fireEvent.submit(dialog.querySelector('form')!)
    expect(fixtures.mutate).toHaveBeenCalledOnce()
    expect(within(dialog).getByRole('button', { name: 'Đang xử lý…' }).hasAttribute('disabled')).toBe(true)
    fireEvent.change(within(dialog).getByRole('textbox'), { target: { value: 'Next tag draft' } })
    await act(async () => { pending.resolve(); await pending.promise })
    expect((within(dialog).getByRole('textbox') as HTMLInputElement).value).toBe('Next tag draft')
    expect(within(dialog).getByRole('button', { name: 'Thêm' }).hasAttribute('disabled')).toBe(false)
  })

  it('reports failed inline renames, keeps the draft, and allows retry', async () => {
    const tag: SyncRecord = { key: 'DEVICE_LOCAL:tags:qa-tag', profile: 'DEVICE_LOCAL', kind: 'tags', id: 'qa-tag', payload: { id: 'qa-tag', name: 'QA tag' }, version: 1, deleted: false }
    fixtures.localRecords.mockResolvedValue([tag])
    window.history.replaceState(null, '', '/library')
    render(<App />)
    fireEvent.click(await screen.findByRole('button', { name: 'Quản lý Thẻ & Bộ sưu tập' }))
    fireEvent.click(within(screen.getByRole('dialog')).getByRole('button', { name: 'Sửa QA tag' }))
    const save = within(screen.getByRole('dialog')).getByRole('button', { name: 'Lưu tên' })
    const input = save.closest('form')!.querySelector('input')!
    fireEvent.change(input, { target: { value: 'Renamed tag' } })
    fixtures.mutate.mockRejectedValueOnce(new Error('Tag storage unavailable'))
    fireEvent.submit(save.closest('form')!)
    expect(await screen.findByText('Tag storage unavailable')).toBeTruthy()
    expect(input.value).toBe('Renamed tag')
    expect(save.hasAttribute('disabled')).toBe(false)
    fireEvent.submit(save.closest('form')!)
    await waitFor(() => expect(screen.queryByRole('button', { name: 'Lưu tên' })).toBeNull())
    expect(fixtures.mutate).toHaveBeenCalledTimes(2)
  })

  it('keeps navigation available after an administrator component fails', async () => {
    vi.spyOn(console, 'error').mockImplementation(() => {})
    saveSession(session)
    window.history.replaceState(null, '', '/admin')
    fixtures.adminIdentity.mockResolvedValue({ id: session.user.id, email: session.user.email, photoUrl: null, adminExpiresAt: Date.now() + 3600000 })
    fixtures.adminThrows = true
    render(<App />)
    expect(await screen.findByRole('heading', { name: 'Khu vực quản trị gặp lỗi' })).toBeTruthy()
    fireEvent.click(within(screen.getByRole('alert')).getByRole('button', { name: 'Về trang chủ' }))
    expect(window.location.pathname).toBe('/')
    expect(readSession()?.token).toBe(session.token)
  })

  it.each(['tags', 'collections'] as const)('does not clear a new account %s draft when an old save completes', async kind => {
    saveSession(session)
    window.history.replaceState(null, '', '/library')
    render(<App />)
    fireEvent.click(await screen.findByRole('button', { name: 'Quản lý Thẻ & Bộ sưu tập' }))
    if (kind === 'collections') fireEvent.click(within(screen.getByRole('dialog')).getByRole('button', { name: 'Bộ sưu tập' }))
    fireEvent.change(within(screen.getByRole('dialog')).getByRole('textbox'), { target: { value: 'Old account item' } })
    const pending = deferred<void>()
    fixtures.mutate.mockReturnValue(pending.promise)
    fireEvent.submit(screen.getByRole('dialog').querySelector('form')!)
    await waitFor(() => expect(fixtures.mutate).toHaveBeenCalled())
    const replacement: Session = { ...session, token: 'replacement-token', user: { ...session.user, id: 'other-user' } }
    saveSession(replacement)
    fireEvent(window, new StorageEvent('storage', { key: SESSION_STORAGE_KEY, storageArea: localStorage }))
    fireEvent.click(screen.getAllByRole('button', { name: 'Tủ sách' })[0])
    fireEvent.click(screen.getByRole('button', { name: 'Quản lý Thẻ & Bộ sưu tập' }))
    if (kind === 'collections') fireEvent.click(within(screen.getByRole('dialog')).getByRole('button', { name: 'Bộ sưu tập' }))
    fireEvent.change(within(screen.getByRole('dialog')).getByRole('textbox'), { target: { value: 'New account draft' } })
    await act(async () => { pending.resolve(); await pending.promise })
    expect((within(screen.getByRole('dialog')).getByRole('textbox') as HTMLInputElement).value).toBe('New account draft')
    expect(fixtures.mutate.mock.calls[0][0]).toBe('ACCOUNT:qa-user')
  })

  it('does not force another account to sign in after an old deletion request fails with 401', async () => {
    saveSession(session)
    window.history.replaceState(null, '', '/account')
    render(<App />)
    fireEvent.click(await screen.findByRole('button', { name: 'Xóa tài khoản vĩnh viễn' }))
    let reject!: (error: Error) => void
    const pending = new Promise<void>((_resolve, fail) => { reject = fail })
    fixtures.deleteAccount.mockReturnValue(pending)
    fireEvent.click(within(screen.getByRole('dialog')).getByRole('button', { name: 'Xóa tài khoản vĩnh viễn' }))
    await waitFor(() => expect(fixtures.deleteAccount).toHaveBeenCalled())
    saveSession({ ...session, token: 'replacement-token', user: { ...session.user, id: 'other-user' } })
    fireEvent(window, new StorageEvent('storage', { key: SESSION_STORAGE_KEY, storageArea: localStorage }))
    await act(async () => { reject(new ApiError(401, 'Expired session')); await pending.catch(() => {}) })
    expect(screen.queryByRole('dialog', { name: 'Chào mừng quay lại.' })).toBeNull()
    expect(screen.queryByText('Vui lòng đăng nhập lại trước khi xóa tài khoản để xác minh bảo mật.')).toBeNull()
    expect(readSession()?.token).toBe('replacement-token')
  })

  it('clears the old conflict warning after the last item is resolved', async () => {
    saveSession(session)
    let remaining = [{ key: 'ACCOUNT:qa-user:highlights:note', profile: 'ACCOUNT:qa-user', operation: { kind: 'highlights', id: 'note', payload: { text: 'Conflict quotation' } }, conflicted: true }]
    fixtures.conflicts.mockImplementation(async () => remaining)
    fixtures.resolveConflict.mockImplementation(async () => { remaining = [] })
    render(<App />)
    fireEvent.click(await screen.findByRole('button', { name: 'Xem & Giải quyết' }))
    fireEvent.click(screen.getByRole('button', { name: 'Giữ bản trên máy' }))
    await waitFor(() => expect(screen.queryByRole('dialog', { name: 'Xung đột đồng bộ' })).toBeNull())
    expect(screen.queryByText('1 xung đột đồng bộ cần giải quyết.')).toBeNull()
    expect(screen.getByText('Đã giải quyết xung đột đồng bộ.')).toBeTruthy()
  })

  it('discards conflict results belonging to an account that was replaced in another tab', async () => {
    saveSession(session)
    const pending = deferred<void>()
    const oldConflict = { key: 'ACCOUNT:qa-user:highlights:private-note', profile: 'ACCOUNT:qa-user', operation: { kind: 'highlights', id: 'private-note', payload: { text: 'Private quotation from the old account' } }, conflicted: true }
    fixtures.conflicts.mockImplementation(async (profile: string) => profile === 'ACCOUNT:qa-user' ? [oldConflict] : [])
    fixtures.resolveConflict.mockReturnValue(pending.promise)
    window.history.replaceState(null, '', '/library')
    render(<App />)
    fireEvent.click(await screen.findByRole('button', { name: 'Xem & Giải quyết' }))
    fireEvent.click(screen.getByRole('button', { name: 'Giữ bản trên máy' }))
    await waitFor(() => expect(fixtures.resolveConflict).toHaveBeenCalled())
    const replacement: Session = { ...session, token: 'replacement-qa-token', user: { ...session.user, id: 'other-user', email: 'other@example.test' } }
    saveSession(replacement)
    fireEvent(window, new StorageEvent('storage', { key: SESSION_STORAGE_KEY, storageArea: localStorage }))
    fireEvent.click(screen.getAllByRole('button', { name: 'Tủ sách' })[0])
    fixtures.conflicts.mockClear()
    await act(async () => { pending.resolve(); await pending.promise })
    expect(fixtures.conflicts.mock.calls.some(call => call[0] === 'ACCOUNT:qa-user')).toBe(false)
    expect(screen.queryByRole('button', { name: 'Xem & Giải quyết' })).toBeNull()
    expect(screen.queryByText('Private quotation from the old account')).toBeNull()
    expect(readSession()?.user.id).toBe('other-user')
  })

  it('closes the organization editor and clears its draft when an account signs out', async () => {
    saveSession(session)
    window.history.replaceState(null, '', '/library')
    render(<App />)
    fireEvent.click(await screen.findByRole('button', { name: 'Quản lý Thẻ & Bộ sưu tập' }))
    const dialog = screen.getByRole('dialog')
    fireEvent.change(within(dialog).getByRole('textbox'), { target: { value: 'Private tag draft' } })
    saveSession(null)
    fireEvent(window, new StorageEvent('storage', { key: SESSION_STORAGE_KEY, storageArea: localStorage }))
    expect(screen.queryByRole('dialog')).toBeNull()
    fireEvent.click(screen.getAllByRole('button', { name: 'Tủ sách' })[0])
    fireEvent.click(screen.getByRole('button', { name: 'Quản lý Thẻ & Bộ sưu tập' }))
    expect((within(screen.getByRole('dialog')).getByRole('textbox') as HTMLInputElement).value).toBe('')
  })

  it('does not show an old note-save completion after another tab signs out', async () => {
    saveSession(session)
    fixtures.getFiles.mockResolvedValue([file('QA document')])
    window.history.replaceState(null, '', '/read/QA%20document')
    render(<App />)
    await screen.findByText('QA reader content')
    fireEvent.click(screen.getByRole('button', { name: 'Thêm ghi chú' }))
    const dialog = screen.getByRole('dialog', { name: 'Lưu điều đáng nhớ' })
    fireEvent.change(within(dialog).getByRole('textbox'), { target: { value: 'Private note belonging to the old account' } })
    const pending = deferred<void>()
    fixtures.mutate.mockImplementation((_profile, kind) => kind === 'highlights' ? pending.promise : Promise.resolve())
    fireEvent.click(within(dialog).getByRole('button', { name: 'Lưu ghi chú' }))
    await waitFor(() => expect(fixtures.mutate.mock.calls.some(call => call[1] === 'highlights')).toBe(true))
    saveSession(null)
    fireEvent(window, new StorageEvent('storage', { key: SESSION_STORAGE_KEY, storageArea: localStorage }))
    await act(async () => { pending.resolve(); await pending.promise })
    expect(screen.queryByText('Đã lưu ghi chú.')).toBeNull()
    expect(readSession()).toBeNull()
    expect(fixtures.mutate.mock.calls.find(call => call[1] === 'highlights')?.[0]).toBe('ACCOUNT:qa-user')
  })

  it('keeps the /admin deep link after sign-in and opens the server-approved workspace', async () => {
    window.history.replaceState(null, '', '/admin')
    fixtures.login.mockResolvedValue(session)
    fixtures.adminIdentity.mockResolvedValue({ id: session.user.id, email: session.user.email, name: 'QA Admin', photoUrl: null, adminExpiresAt: Date.now() + 3600000 })
    render(<App />)
    await openLogin()
    expect(await screen.findByRole('heading', { name: 'Quản trị thư viện' })).toBeTruthy()
    expect(window.location.pathname).toBe('/admin')
    expect(fixtures.adminRequest).toHaveBeenCalledWith(session.token, 'overview', expect.any(AbortSignal))
  })

  it('denies ordinary accounts a directly entered /admin route', async () => {
    saveSession(session); window.history.replaceState(null, '', '/admin')
    render(<App />)
    expect(await screen.findByText('Tài khoản này không có quyền quản trị.')).toBeTruthy()
    expect(screen.queryByRole('heading', { name: 'Quản trị thư viện' })).toBeNull()
    expect(screen.queryByRole('button', { name: 'Mở khu vực quản trị' })).toBeNull()
    expect(fixtures.adminRequest).not.toHaveBeenCalled()
  })

  it('discards late administrator verification after another tab signs out', async () => {
    const pending = deferred<import('./admin/api').AdminIdentity>()
    fixtures.adminIdentity.mockReturnValue(pending.promise)
    saveSession(session)
    render(<App />)
    await waitFor(() => expect(fixtures.adminIdentity).toHaveBeenCalled())
    saveSession(null)
    fireEvent(window, new StorageEvent('storage', { key: SESSION_STORAGE_KEY, storageArea: localStorage }))
    await act(async () => { pending.resolve({ id: session.user.id, email: session.user.email, photoUrl: null, adminExpiresAt: Date.now() + 3600000 }); await pending.promise })
    expect(screen.queryByRole('button', { name: 'Quản trị' })).toBeNull()
    expect(fixtures.adminIdentity.mock.calls[0][1].aborted).toBe(true)
  })

  it('closes and cancels a private HTTPS import when another tab signs out', async () => {
    saveSession(session)
    const pending = deferred<File>(); fixtures.downloadHttps.mockReturnValue(pending.promise)
    render(<App />)
    fireEvent.click(screen.getAllByRole('button', { name: 'Thêm tài liệu' })[0])
    const dialog = screen.getByRole('dialog', { name: 'Thêm tài liệu' })
    fireEvent.click(within(dialog).getByRole('button', { name: /Từ liên kết HTTPS/ }))
    fireEvent.change(within(dialog).getByLabelText('Liên kết HTTPS'), { target: { value: 'https://books.example.test/private.pdf?signature=qa' } })
    fireEvent.submit(dialog.querySelector('form')!)
    await waitFor(() => expect(fixtures.downloadHttps).toHaveBeenCalled())
    saveSession(null)
    fireEvent(window, new StorageEvent('storage', { key: SESSION_STORAGE_KEY, storageArea: localStorage }))
    expect(screen.queryByRole('dialog', { name: 'Thêm tài liệu' })).toBeNull()
    expect(fixtures.downloadHttps.mock.calls[0][1].signal.aborted).toBe(true)
    await act(async () => { pending.resolve(new File(['%PDF-QA'], 'QA.pdf')); await pending.promise })
    expect(window.location.pathname).toBe('/')
  })

  it('does not sign in after the login dialog was closed while the request was pending', async () => {
    const pending = deferred<Session>(); fixtures.login.mockReturnValue(pending.promise)
    render(<App />)
    const dialog = await openLogin()
    fireEvent.click(within(dialog).getByRole('button', { name: 'Đóng' }))
    await act(async () => { pending.resolve(session); await pending.promise })
    expect(readSession()).toBeNull()
  })

  it('does not accept an old login response after switching to password recovery', async () => {
    const pending = deferred<Session>(); fixtures.login.mockReturnValue(pending.promise)
    render(<App />)
    const dialog = await openLogin()
    fireEvent.click(within(dialog).getByRole('button', { name: 'Quên mật khẩu?' }))
    await act(async () => { pending.resolve(session); await pending.promise })
    expect(readSession()).toBeNull()
    expect(screen.getByRole('dialog')).toBeTruthy()
  })

  it('ignores a Google credential callback owned by a closed dialog', async () => {
    let callback!: (value: { credential: string }) => Promise<void>
    ;(window as unknown as { google: unknown }).google = { accounts: { id: {
      initialize: (options: { callback: typeof callback }) => { callback = options.callback }, renderButton: () => {},
    } } }
    fixtures.googleLogin.mockResolvedValue(session)
    render(<App />)
    fireEvent.click(screen.getAllByRole('button', { name: 'Đăng nhập' })[0])
    fireEvent.click(within(screen.getByRole('dialog')).getByRole('button', { name: 'Đóng' }))
    await act(async () => { await callback({ credential: 'qa-credential' }) })
    expect(fixtures.googleLogin).not.toHaveBeenCalled()
    expect(readSession()).toBeNull()
  })

  it('keeps a newer library snapshot when an earlier browser-storage read completes late', async () => {
    const old = deferred<LocalFile[]>()
    fixtures.getFiles.mockReturnValueOnce(old.promise).mockResolvedValue([file('Fresh document')])
    window.history.replaceState(null, '', '/library')
    render(<App />)
    fireEvent.click(screen.getByRole('button', { name: 'Switch Language' }))
    await waitFor(() => expect(screen.getByRole('button', { name: 'Fresh document' })).toBeTruthy())
    await act(async () => { old.resolve([file('Old document')]); await old.promise })
    expect(screen.getByRole('button', { name: 'Fresh document' })).toBeTruthy()
    expect(screen.queryByRole('button', { name: 'Old document' })).toBeNull()
  })

  it('reports a failed progress save while still allowing the reader to close', async () => {
    fixtures.getFiles.mockResolvedValue([file('QA document')])
    window.history.replaceState(null, '', '/read/QA%20document')
    render(<App />)
    await screen.findByText('QA reader content')
    fixtures.mutate.mockRejectedValue(new DOMException('Browser storage quota exhausted', 'QuotaExceededError'))
    fireEvent.click(screen.getByRole('button', { name: 'Trở về Trang chủ' }))
    await waitFor(() => expect(screen.getByText(/Không lưu được tiến độ|Could not save reading progress/)).toBeTruthy())
    expect(window.location.pathname).toBe('/')
    expect(screen.queryByText('QA reader content')).toBeNull()
  })

  it('saves elapsed reading time when the browser fires pagehide without a visibility change', async () => {
    fixtures.getFiles.mockResolvedValue([file('QA document')])
    window.history.replaceState(null, '', '/read/QA%20document')
    render(<App />)
    await screen.findByText('QA reader content')
    vi.spyOn(Date, 'now').mockReturnValue(Date.now() + 6000)
    fireEvent(window, new Event('pagehide'))
    await waitFor(() => expect(fixtures.mutate).toHaveBeenCalledWith('DEVICE_LOCAL', 'reading_sessions', expect.any(String), expect.objectContaining({ book_id: 'QA document', duration_ms: expect.any(Number) }), false, true))
    fireEvent(window, new Event('pagehide'))
    expect(fixtures.mutate.mock.calls.filter(call => call[1] === 'reading_sessions')).toHaveLength(1)
  })

  it('returns to the library background when book loading is canceled and ignores late bytes', async () => {
    const pending = deferred<ArrayBuffer>()
    fixtures.getFiles.mockResolvedValue([file('QA document')])
    fixtures.loadBytes.mockReturnValue(pending.promise)
    window.history.replaceState(null, '', '/read/QA%20document')
    render(<App />)
    await screen.findByText('Đang mở sách…')
    await waitFor(() => expect(fixtures.loadBytes).toHaveBeenCalled())
    fireEvent.click(screen.getByRole('button', { name: 'Đóng' }))
    expect(window.location.pathname).toBe('/explore')
    expect(fixtures.loadBytes.mock.calls[0][2].signal.aborted).toBe(true)
    await act(async () => { pending.resolve(new ArrayBuffer(20)); await pending.promise })
    expect(screen.queryByText('QA reader content')).toBeNull()
    expect(screen.queryByText('Đang mở sách…')).toBeNull()
  })

  it('only submits one login while email and Google actions are both pending', async () => {
    const pending = deferred<Session>(); fixtures.login.mockReturnValue(pending.promise)
    let callback!: (value: { credential: string }) => Promise<void>
    ;(window as unknown as { google: unknown }).google = { accounts: { id: {
      initialize: (options: { callback: typeof callback }) => { callback = options.callback }, renderButton: () => {},
    } } }
    render(<App />)
    const dialog = await openLogin()
    fireEvent.submit(dialog.querySelector('form')!)
    await act(async () => { await callback({ credential: 'qa-google' }) })
    expect(fixtures.login).toHaveBeenCalledTimes(1)
    expect(fixtures.googleLogin).not.toHaveBeenCalled()
    await act(async () => { pending.resolve(session); await pending.promise })
    expect(readSession()?.user.id).toBe(session.user.id)
  })

  it('keeps navigation usable when a reader render fails', async () => {
    fixtures.getFiles.mockResolvedValue([file('QA document')])
    fixtures.readerThrows = true
    const errors = vi.spyOn(console, 'error').mockImplementation(() => {})
    window.history.replaceState(null, '', '/read/QA%20document')
    render(<App />)
    const alert = await screen.findByRole('alert')
    expect(alert.textContent).toContain('Trình đọc gặp lỗi')
    fireEvent.click(within(alert).getByRole('button', { name: 'Về tủ sách' }))
    await waitFor(() => expect(window.location.pathname).toBe('/library'))
    expect(screen.getByRole('button', { name: 'QA document' })).toBeTruthy()
    expect(errors).toHaveBeenCalled()
  })

  it('flushes progress to its original owner and closes the reader when another tab signs out', async () => {
    saveSession(session)
    fixtures.getFiles.mockResolvedValue([file('QA document')])
    window.history.replaceState(null, '', '/read/QA%20document')
    render(<App />)
    await screen.findByText('QA reader content')
    const pending = deferred<void>()
    fixtures.mutate.mockReturnValue(pending.promise)
    saveSession(null)
    fireEvent(window, new StorageEvent('storage', { key: SESSION_STORAGE_KEY, storageArea: localStorage }))
    expect(screen.queryByText('QA reader content')).toBeNull()
    expect(window.location.pathname).toBe('/')
    expect(fixtures.mutate).toHaveBeenCalledWith('ACCOUNT:qa-user', 'reading_progress', expect.any(String), expect.objectContaining({ book_id: 'QA document', progression: 0.6 }), false, true)
    await act(async () => { pending.resolve(); await pending.promise })
    expect(readSession()).toBeNull()
    expect(fixtures.mutate.mock.calls.filter(call => call[0] === 'DEVICE_LOCAL')).toHaveLength(0)
  })
})
