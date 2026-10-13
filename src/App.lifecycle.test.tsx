// @vitest-environment jsdom
import { afterEach, beforeEach, describe, expect, it, vi } from 'vitest'
import { act, cleanup, fireEvent, render, screen, waitFor, within } from '@testing-library/react'
import type { LocalFile, Session, SyncRecord } from './types'
import { readSession, saveSession, SESSION_STORAGE_KEY } from './store'
import App from './App'
import { ApiError } from './api'

const fixtures = vi.hoisted(() => ({
  login: vi.fn(), googleLogin: vi.fn(), getFiles: vi.fn(), mutate: vi.fn(), loadBytes: vi.fn(), downloadHttps: vi.fn(), adminIdentity: vi.fn(), adminRequest: vi.fn(), localRecords: vi.fn(), entitlement: vi.fn(), preparePdf: vi.fn(), saveDownload: vi.fn(), readerThrows: false,
}))
vi.mock('./httpsImport', async importOriginal => ({
  ...await importOriginal<typeof import('./httpsImport')>(), downloadHttpsPublication: fixtures.downloadHttps,
}))
vi.mock('./admin/api', async importOriginal => ({
  ...await importOriginal<typeof import('./admin/api')>(), getAdminIdentity: fixtures.adminIdentity, adminRequest: fixtures.adminRequest,
}))
vi.mock('./api', async importOriginal => ({
  ...await importOriginal<typeof import('./api')>(),
  getCatalog: async () => ({ books: [], categories: [] }),
  login: fixtures.login, loginWithGoogle: fixtures.googleLogin,
  getUser: async () => ({ user: session.user }),
  getEntitlement: fixtures.entitlement,
  getSePayPlans: async () => ({ plans: [] }),
  loadBookBytes: fixtures.loadBytes,
}))
vi.mock('./store', async importOriginal => ({
  ...await importOriginal<typeof import('./store')>(),
  getFiles: fixtures.getFiles, getFile: async () => undefined,
  getOfflineBooks: async () => [], getOfflineBook: async () => undefined,
  getPending: async () => [], getCachedCatalog: async () => undefined,
  saveCachedCatalog: async () => {},
}))
vi.mock('./sync', async importOriginal => ({
  ...await importOriginal<typeof import('./sync')>(),
  localRecords: fixtures.localRecords, getConflicts: async () => [],
  syncNow: async () => ({ conflicts: 0, changes: 0 }),
  connectLiveSync: () => () => {}, mutate: fixtures.mutate,
}))
vi.mock('./OceanWaves', () => ({ OceanWaves: () => null }))
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
  fixtures.mutate.mockReset().mockResolvedValue(undefined)
  fixtures.login.mockReset(); fixtures.googleLogin.mockReset()
  fixtures.loadBytes.mockReset().mockResolvedValue(new TextEncoder().encode('QA document').buffer)
  fixtures.downloadHttps.mockReset()
  fixtures.adminIdentity.mockReset().mockRejectedValue(new ApiError(403, 'Not an admin', 'ADMIN_REQUIRED'))
  fixtures.adminRequest.mockReset().mockResolvedValue({ books: 4, categories: 2, users: 3, activeUsers: 3, syncRecords: 2, syncConflicts: 0, proSnapshots: 1, playConfigured: false })
  fixtures.readerThrows = false
  fixtures.localRecords.mockReset().mockResolvedValue([])
  fixtures.entitlement.mockReset().mockResolvedValue({ userId: session.user.id, plan: 'FREE' })
  fixtures.preparePdf.mockReset().mockResolvedValue({ filename: 'notes.pdf', blob: new Blob(['%PDF-1.3'], { type: 'application/pdf' }) })
  fixtures.saveDownload.mockReset()
})
afterEach(() => { cleanup(); vi.restoreAllMocks(); delete (window as unknown as { google?: unknown }).google })

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
