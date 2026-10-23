// @vitest-environment jsdom
import { afterEach, beforeEach, describe, expect, it, vi } from 'vitest'
import { act, cleanup, fireEvent, render, screen, waitFor, within } from '@testing-library/react'
import type { LocalFile, ReaderAnnotation, Session, SyncRecord } from './types'
import type { ReaderSearchResult, ReaderSearchSource } from './readerSearch'
import type { ReaderSpeechSource } from './readerSpeech'
import { MockSynthesis, MockUtterance } from './readerSpeech.testUtils'
import { readSession, saveSession, SESSION_STORAGE_KEY } from './store'
import App from './App'
import { ApiError } from './api'
import { saveStealthCheckpoint } from './stealth/checkpoint'
import { DRAWING_COLORS, emptyDrawing } from './drawing'
import { emptyReaderNoteDraft, readReaderNoteDraft, writeReaderNoteDraft } from './readerNoteDrafts'

const fixtures = vi.hoisted(() => ({
  login: vi.fn(), googleLogin: vi.fn(), getFiles: vi.fn(), getFile: vi.fn(), getOfflineBook: vi.fn(), getCatalog: vi.fn(), removeLocalDocument: vi.fn(), mutate: vi.fn(), loadBytes: vi.fn(), downloadHttps: vi.fn(), adminIdentity: vi.fn(), adminRequest: vi.fn(), localRecords: vi.fn(), entitlement: vi.fn(), preparePdf: vi.fn(), saveDownload: vi.fn(), conflicts: vi.fn(), resolveConflict: vi.fn(), updateProfile: vi.fn(), deleteAccount: vi.fn(), searchBook: vi.fn(), readerThrows: false, adminThrows: false,
}))
const announcementFixtures = vi.hoisted(() => ({ get: vi.fn() }))
vi.mock('./httpsImport', async importOriginal => ({
  ...await importOriginal<typeof import('./httpsImport')>(), downloadHttpsPublication: fixtures.downloadHttps,
}))
vi.mock('./admin/api', async importOriginal => ({
  ...await importOriginal<typeof import('./admin/api')>(), getAdminIdentity: fixtures.adminIdentity, adminRequest: fixtures.adminRequest,
}))
vi.mock('./api', async importOriginal => ({
  ...await importOriginal<typeof import('./api')>(),
  getCatalog: fixtures.getCatalog,
  getAnnouncements: announcementFixtures.get,
  login: fixtures.login, loginWithGoogle: fixtures.googleLogin,
  getUser: async (token: string) => ({ user: readSession()?.token === token ? readSession()!.user : session.user }),
  getEntitlement: fixtures.entitlement,
  updateProfile: fixtures.updateProfile, deleteAccount: fixtures.deleteAccount,
  getSePayPlans: async () => ({ plans: [] }),
  loadBookBytes: fixtures.loadBytes,
}))
vi.mock('./store', async importOriginal => ({
  ...await importOriginal<typeof import('./store')>(),
  getFiles: fixtures.getFiles, getFile: fixtures.getFile, removeLocalDocument: fixtures.removeLocalDocument,
  getOfflineBooks: async () => [], getOfflineBook: fixtures.getOfflineBook,
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
  return { ReaderPane: ({ onLocation, onSelection, navigateLocator, annotations, onSearchReady, onSearchRequest, onSpeechReady }: {
    onLocation: (location: object) => void
    onSelection: (text: string, locator: string) => void
    navigateLocator?: { locatorJson: string; requestId: number } | null
    annotations?: ReaderAnnotation[]
    onSearchReady?: (source: ReaderSearchSource | null) => void
    onSearchRequest?: () => void
    onSpeechReady?: (source: ReaderSpeechSource | null) => void
  }) => {
    useEffect(() => { onLocation({ locatorJson: '{"type":"TEXT","progression":0.6}', progression: 0.6, chapterTitle: 'QA' }) }, [onLocation])
    useEffect(() => { onSearchReady?.(fixtures.searchBook); return () => onSearchReady?.(null) }, [onSearchReady])
    useEffect(() => { onSpeechReady?.(async () => ({ text: 'QA spoken book text', label: 'QA', truncated: false })); return () => onSpeechReady?.(null) }, [onSpeechReady])
    if (fixtures.readerThrows) throw new Error('QA reader bundle/render failure')
    return <><p>QA reader content</p><button onClick={() => onLocation({ locatorJson: '{"type":"TEXT","progression":0.1}', progression: 0.1, chapterTitle: 'Old normal view' })}>QA background reader location</button><button onClick={() => onSelection('A selected passage worth remembering', '{"type":"TEXT","progression":0.35,"text":"A selected passage worth remembering"}')}>QA select passage</button><button onClick={onSearchRequest}>QA embedded reader search request</button><output data-testid="qa-reader-navigation">{JSON.stringify(navigateLocator || null)}</output><output data-testid="qa-reader-annotations">{JSON.stringify(annotations || [])}</output></>
  } }
})
vi.mock('./stealth/StealthReader', () => ({ StealthReader: ({ onProgressChange, onClose }: {
  onProgressChange: (position: object) => void; onClose: (position: object) => void
}) => {
  const position = { progression: 0.73, rowIndex: 73, rowCount: 101, rowId: 'REC-73', sourceHref: 'chapter.xhtml', rowOffset: 8 }
  return <><button onClick={() => onProgressChange(position)}>QA stealth advance</button><button onClick={() => onClose(position)}>QA stealth close</button></>
} }))
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
  fixtures.getFile.mockReset().mockResolvedValue(undefined)
  fixtures.getOfflineBook.mockReset().mockResolvedValue(undefined)
  fixtures.getCatalog.mockReset().mockResolvedValue({ books: [], categories: [] })
  announcementFixtures.get.mockReset().mockResolvedValue({ announcements: [] })
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
  fixtures.searchBook.mockReset().mockResolvedValue({ hits: [], truncated: false, scanned: 1, total: 1, textAvailable: true })
})
afterEach(() => { cleanup(); vi.restoreAllMocks(); delete (window as unknown as { google?: unknown }).google })

describe('system announcements integration', () => {
  it.each([false, true])('shows active admin announcements on the public web (signed in: %s)', async signedIn => {
    if (signedIn) saveSession(session)
    announcementFixtures.get.mockResolvedValue({ announcements: [{ id: 'ABC123', title: 'Lời Chào', message: 'Chúc mọi người một ngày tốt lành!', type: 'info', active: true, startsAt: null, endsAt: null, updatedAt: '2026-10-23T11:20:00Z' }] })
    render(<App />)
    expect(await screen.findByRole('heading', { name: 'Lời Chào' })).toBeTruthy()
    expect(screen.getByRole('region', { name: 'Thông báo từ NoCap' })).toBeTruthy()
    expect(announcementFixtures.get).toHaveBeenCalledWith(expect.any(AbortSignal))
  })
})

describe('library write failures and concurrent actions', () => {
  async function reader() {
    fixtures.getFiles.mockResolvedValue([file('QA document')])
    window.history.replaceState(null, '', '/read/QA%20document')
    render(<App />)
    await screen.findByText('QA reader content')
    return screen.getByRole('button', { name: 'Đánh dấu vị trí' })
  }

  it('opens read aloud alongside notes and stops speech on Escape and reader exit', async () => {
    const speech = new MockSynthesis()
    vi.stubGlobal('speechSynthesis', speech.api()); vi.stubGlobal('SpeechSynthesisUtterance', MockUtterance)
    try {
      const readerView = within((await reader()).closest('.reader-shell') as HTMLElement)
      fireEvent.click(readerView.getByRole('button', { name: 'Đọc thành tiếng' }))
      fireEvent.click(readerView.getByRole('button', { name: 'Nghe phần hiện tại' }))
      await waitFor(() => expect(speech.spoken).toHaveLength(1))
      expect(speech.spoken[0].text).toBe('QA spoken book text')
      fireEvent.click(readerView.getByRole('button', { name: 'Bảng ghi chú' }))
      expect(readerView.getByRole('button', { name: 'Tạm dừng' })).toBeTruthy()
      const before = speech.cancel.mock.calls.length
      fireEvent.keyDown(window, { key: 'Escape' })
      expect(readerView.queryByRole('button', { name: 'Nghe phần hiện tại' })).toBeNull()
      expect(speech.cancel.mock.calls.length).toBeGreaterThan(before)
      expect(screen.getByText('QA reader content')).toBeTruthy()
      fireEvent.click(readerView.getByRole('button', { name: 'Đọc thành tiếng' }))
      fireEvent.click(readerView.getByRole('button', { name: 'Nghe phần hiện tại' }))
      await waitFor(() => expect(speech.spoken).toHaveLength(2))
      const beforeExit = speech.cancel.mock.calls.length
      fireEvent.click(readerView.getByRole('button', { name: 'Trở về Trang chủ' }))
      expect(speech.cancel.mock.calls.length).toBeGreaterThan(beforeExit)
      expect(screen.queryByText('QA reader content')).toBeNull()
    } finally { cleanup(); vi.unstubAllGlobals() }
  })

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
    fireEvent.click(screen.getByRole('button', { name: 'Bảng ghi chú' }))
    const panel = screen.getByRole('complementary', { name: 'Ghi chú khi đọc' })
    fireEvent.change(within(panel).getByRole('textbox'), { target: { value: 'Keep my draft' } })
    fixtures.mutate.mockImplementation((_profile, kind) => kind === 'highlights' ? Promise.reject(new Error('Note storage unavailable')) : Promise.resolve())
    fireEvent.click(within(panel).getByRole('button', { name: 'Lưu ghi chú' }))
    const error = await screen.findByText('Note storage unavailable')
    expect(error.closest('.reader-notice')).toBeTruthy()
    expect(error.closest('.reader-shell')).toBeNull()
    expect((within(panel).getByRole('textbox') as HTMLTextAreaElement).value).toBe('Keep my draft')
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

describe('comparison document cache recovery', () => {
  const books = [
    { id: 'comparison-a', title: 'Comparison A', author: 'QA', source: 'public', fileUrl: 'https://books.example.test/a.txt', format: 'TXT' },
    { id: 'comparison-b', title: 'Comparison B', author: 'QA', source: 'public', fileUrl: 'https://books.example.test/b.txt', format: 'TXT' },
  ]

  async function compare(sources = books) {
    fixtures.getCatalog.mockResolvedValue({ books: sources, categories: [] })
    window.history.replaceState(null, '', '/memory')
    render(<App />)
    await waitFor(() => expect(fixtures.getCatalog).toHaveBeenCalled())
    fireEvent.click(await screen.findByRole('button', { name: 'Đọc đối chiếu hai nguồn' }))
    const dialog = screen.getByRole('dialog', { name: 'Đọc đối chiếu hai nguồn' })
    await waitFor(() => expect(within(dialog).getByRole('button', { name: 'Mở hai nguồn' }).hasAttribute('disabled')).toBe(false))
    fireEvent.click(within(dialog).getByRole('button', { name: 'Mở hai nguồn' }))
  }

  it('opens public sources from the network when optional browser cache reads fail', async () => {
    fixtures.getFile.mockRejectedValue(new Error('Browser database closed'))
    fixtures.getOfflineBook.mockRejectedValue(new Error('Browser cache closed'))
    await compare()
    await waitFor(() => expect(screen.getAllByText('QA reader content')).toHaveLength(2))
    expect(fixtures.loadBytes).toHaveBeenCalledTimes(2)
  })

  it('fetches the current private source instead of opening an obsolete offline copy', async () => {
    saveSession(session)
    const current = { ...books[0], source: 'cloud', fileUrl: 'nocap-private:new-content-hash' }
    const stale = { key: 'ACCOUNT:qa-user:comparison-a', profile: 'ACCOUNT:qa-user', book: { ...current, fileUrl: 'nocap-private:old-content-hash' }, data: new Blob(['Obsolete document']), addedAt: 1 }
    fixtures.getFile.mockImplementation(async (_owner, id) => id === current.id ? stale : undefined)
    fixtures.getOfflineBook.mockImplementation(async (_owner, id) => id === current.id ? stale : undefined)
    await compare([current, books[1]])
    await waitFor(() => expect(screen.getAllByText('QA reader content')).toHaveLength(2))
    expect(fixtures.loadBytes).toHaveBeenCalledWith(expect.objectContaining({ id: current.id, fileUrl: current.fileUrl }), session.token, expect.objectContaining({ signal: expect.any(AbortSignal) }))
  })
})

describe('side-by-side reading notes', () => {
  it('restores an unfinished drawing after reopening the web and saves drawing-only notes at their original source', async () => {
    fixtures.getFiles.mockResolvedValue([file('QA document')])
    const saved: SyncRecord[] = []
    fixtures.localRecords.mockImplementation(async () => [...saved])
    fixtures.mutate.mockImplementation(async (profile, kind, id, payload) => {
      if (kind === 'highlights') saved.push({ key: `${profile}:highlights:${id}`, profile, kind, id, payload, version: 0, deleted: false })
    })
    const drawing = emptyDrawing()
    drawing.strokes.push({ color: DRAWING_COLORS[1], width: 3, points: [[10, 20], [100, 200]] })
    const anchor = { locatorJson: '{"type":"TEXT","progression":0.25}', progression: .25, chapterTitle: 'Original thought' }
    writeReaderNoteDraft('DEVICE_LOCAL', 'QA document', { ...emptyReaderNoteDraft(), drawing, anchor })
    window.history.replaceState(null, '', '/read/QA%20document')
    const first = render(<App />)
    await screen.findByText('QA reader content')
    expect(screen.getByRole('complementary', { name: 'Ghi chú khi đọc' })).toBeTruthy()
    first.unmount()
    render(<App />)
    await screen.findByText('QA reader content')
    const panel = screen.getByRole('complementary', { name: 'Ghi chú khi đọc' })
    fireEvent.click(screen.getByRole('button', { name: 'QA background reader location' }))
    fireEvent.click(within(panel).getByRole('button', { name: 'Lưu ghi chú' }))
    await waitFor(() => expect(fixtures.mutate.mock.calls.find(([, kind]) => kind === 'highlights')).toBeTruthy())
    const call = fixtures.mutate.mock.calls.find(([, kind]) => kind === 'highlights')!
    expect(call[0]).toBe('DEVICE_LOCAL')
    expect(call[3]).toMatchObject({ drawing, note: '', locator_json: anchor.locatorJson })
    expect(call[5]).toBe(true)
    await screen.findByText('Đã lưu ghi chú.')
    expect(readReaderNoteDraft('DEVICE_LOCAL', 'QA document')).toBeNull()
    expect(panel.querySelector('.drawing-preview')).toBeTruthy()
    fireEvent.click(screen.getByRole('button', { name: 'Quay lại tủ sách' }))
    fireEvent.click(screen.getAllByRole('button', { name: 'Ghi nhớ' })[0])
    await waitFor(() => expect(document.querySelector('.memory-item .drawing-preview')).toBeTruthy())
  })

  it('rejects a combined drawing and text payload above the server limit while retaining its draft for repair', async () => {
    fixtures.getFiles.mockResolvedValue([file('QA document')])
    const drawing = emptyDrawing()
    drawing.strokes.push({ color: DRAWING_COLORS[0], width: 3, points: Array.from({ length: 700 }, (_, n) => [n, n % 700] as [number, number]) })
    const draft = { ...emptyReaderNoteDraft(), drawing, note: 'N'.repeat(10000), selection: { text: 'Q'.repeat(20000), locator: '{"page":2}' } }
    writeReaderNoteDraft('DEVICE_LOCAL', 'QA document', draft)
    window.history.replaceState(null, '', '/read/QA%20document')
    render(<App />)
    await screen.findByText('QA reader content')
    const panel = screen.getByRole('complementary', { name: 'Ghi chú khi đọc' })
    fireEvent.click(within(panel).getByRole('button', { name: 'Lưu ghi chú' }))
    expect(await screen.findByText('Ghi chú và bản vẽ quá lớn để đồng bộ. Hãy rút ngắn ghi chú hoặc giảm nét vẽ.')).toBeTruthy()
    expect(fixtures.mutate.mock.calls.filter(([, kind]) => kind === 'highlights')).toHaveLength(0)
    expect(readReaderNoteDraft('DEVICE_LOCAL', 'QA document')).toEqual(draft)
  })

  it('blocks a duplicate save after closing and reopening the same book while the first save is pending', async () => {
    const oldPanel = await reader()
    const pending = deferred<void>()
    fixtures.mutate.mockImplementation((_profile, kind) => kind === 'highlights' ? pending.promise : Promise.resolve())
    fireEvent.change(within(oldPanel).getByRole('textbox'), { target: { value: 'Save this draft once' } })
    fireEvent.click(within(oldPanel).getByRole('button', { name: 'Lưu ghi chú' }))
    fireEvent.click(screen.getByRole('button', { name: 'Quay lại tủ sách' }))
    await act(async () => {
      window.history.pushState(null, '', '/read/QA%20document')
      window.dispatchEvent(new PopStateEvent('popstate'))
    })
    await screen.findByText('QA reader content')
    const reopened = screen.getByRole('complementary', { name: 'Ghi chú khi đọc' })
    const draft = within(reopened).getByRole('textbox') as HTMLTextAreaElement
    expect(draft.disabled).toBe(true)
    fireEvent.submit(draft.closest('form')!)
    expect(fixtures.mutate.mock.calls.filter(([, kind]) => kind === 'highlights')).toHaveLength(1)
    await act(async () => { pending.resolve(); await pending.promise })
    await waitFor(() => expect(draft.value).toBe(''))
    expect(draft.disabled).toBe(false)
    expect(readReaderNoteDraft('DEVICE_LOCAL', 'QA document')).toBeNull()
  })

  it('keeps a newer draft from another tab when reopening the same book during an older save', async () => {
    const oldPanel = await reader()
    const pending = deferred<void>()
    fixtures.mutate.mockImplementation((_profile, kind) => kind === 'highlights' ? pending.promise : Promise.resolve())
    fireEvent.change(within(oldPanel).getByRole('textbox'), { target: { value: 'Older snapshot being saved' } })
    fireEvent.click(within(oldPanel).getByRole('button', { name: 'Lưu ghi chú' }))
    const newer = { ...emptyReaderNoteDraft(), note: 'A newer idea written in another tab' }
    writeReaderNoteDraft('DEVICE_LOCAL', 'QA document', newer)
    fireEvent.click(screen.getByRole('button', { name: 'Quay lại tủ sách' }))
    await act(async () => {
      window.history.pushState(null, '', '/read/QA%20document')
      window.dispatchEvent(new PopStateEvent('popstate'))
    })
    await screen.findByText('QA reader content')
    const reopened = screen.getByRole('complementary', { name: 'Ghi chú khi đọc' })
    const draft = within(reopened).getByRole('textbox') as HTMLTextAreaElement
    expect(draft.value).toBe(newer.note)
    expect(draft.disabled).toBe(true)
    await act(async () => { pending.resolve(); await pending.promise })
    await waitFor(() => expect(draft.disabled).toBe(false))
    expect(draft.value).toBe(newer.note)
    expect(readReaderNoteDraft('DEVICE_LOCAL', 'QA document')).toEqual(newer)
    fireEvent.change(draft, { target: { value: newer.note + ' — continued' } })
    expect(readReaderNoteDraft('DEVICE_LOCAL', 'QA document')?.note).toBe(newer.note + ' — continued')
    expect(fixtures.mutate.mock.calls.filter(([, kind]) => kind === 'highlights')).toHaveLength(1)
  })

  const initialLocator = '{"type":"TEXT","progression":0.6}'

  function note(id: string, bookId = 'QA document', profile = 'DEVICE_LOCAL'): SyncRecord {
    return { key: `${profile}:highlights:${id}`, profile, kind: 'highlights', id, version: 1, deleted: false,
      payload: { id, book_id: bookId, text: `Passage ${id}`, note: `Thought ${id}`, locator_json: initialLocator, chapter_title: 'QA', color: 'YELLOW', created_at: Date.now() } }
  }

  async function reader() {
    fixtures.getFiles.mockResolvedValue([file('QA document'), file('Another document')])
    window.history.replaceState(null, '', '/read/QA%20document')
    render(<App />)
    await screen.findByText('QA reader content')
    fireEvent.click(screen.getByRole('button', { name: 'Bảng ghi chú' }))
    return screen.getByRole('complementary', { name: 'Ghi chú khi đọc' })
  }

  it('keeps the panel open after saving and shows the same note in Reading Memory', async () => {
    const stored: SyncRecord[] = []
    fixtures.localRecords.mockImplementation(async () => [...stored])
    fixtures.mutate.mockImplementation(async (profile, kind, id, payload, deleted) => {
      if (kind === 'highlights') stored.push({ key: `${profile}:${kind}:${id}`, profile, kind, id, payload, deleted, version: 1 })
    })
    const panel = await reader()
    const draft = within(panel).getByRole('textbox') as HTMLTextAreaElement
    fireEvent.change(draft, { target: { value: 'An idea shared with Reading Memory' } })
    fireEvent.click(within(panel).getByRole('button', { name: 'Lưu ghi chú' }))
    await within(panel).findByText('An idea shared with Reading Memory')
    expect(panel.hidden).toBe(false)
    expect(screen.getByRole('button', { name: 'Bảng ghi chú' }).getAttribute('aria-expanded')).toBe('true')
    expect(draft.value).toBe('')
    const write = fixtures.mutate.mock.calls.find(([, kind]) => kind === 'highlights')!
    expect(write[0]).toBe('DEVICE_LOCAL')
    expect(write[5]).toBe(true)
    fireEvent.click(screen.getByRole('button', { name: 'Quay lại tủ sách' }))
    fireEvent.click(screen.getAllByRole('button', { name: 'Ghi nhớ' })[0])
    expect(await screen.findByText('An idea shared with Reading Memory')).toBeTruthy()
  })

  it('keeps a committed note visible and prevents retry when refreshing its list fails', async () => {
    const panel = await reader()
    const draft = within(panel).getByRole('textbox') as HTMLTextAreaElement
    fixtures.getFiles.mockRejectedValue(new Error('Note list refresh unavailable'))
    fireEvent.change(draft, { target: { value: 'This note was already committed' } })
    fireEvent.click(within(panel).getByRole('button', { name: 'Lưu ghi chú' }))
    expect(await within(panel).findByText('This note was already committed')).toBeTruthy()
    expect(await screen.findByText('Đã lưu ghi chú.')).toBeTruthy()
    expect(screen.queryByText('Note list refresh unavailable')).toBeNull()
    expect(draft.value).toBe('')
    expect(within(panel).getByRole('button', { name: 'Lưu ghi chú' }).hasAttribute('disabled')).toBe(true)
    // Even an explicit form submission must not offer the committed draft for retry.
    fireEvent.submit(draft.closest('form')!)
    expect(fixtures.mutate.mock.calls.filter(([, kind]) => kind === 'highlights')).toHaveLength(1)
    expect(within(panel).getAllByText('This note was already committed')).toHaveLength(1)
    fireEvent.click(screen.getByRole('button', { name: 'Quay lại tủ sách' }))
    fireEvent.click(screen.getAllByRole('button', { name: 'Ghi nhớ' })[0])
    expect(await screen.findByText('This note was already committed')).toBeTruthy()
  })

  it('keeps an unsaved draft and selected color when the panel is hidden and reopened', async () => {
    const panel = await reader()
    fireEvent.change(within(panel).getByRole('textbox'), { target: { value: 'Draft while I keep reading' } })
    fireEvent.click(within(panel).getByRole('button', { name: 'Xanh dương' }))
    fireEvent.click(within(panel).getByRole('button', { name: 'Đóng bảng ghi chú' }))
    expect(screen.queryByRole('complementary', { name: 'Ghi chú khi đọc' })).toBeNull()
    expect(screen.getByRole('button', { name: 'Bảng ghi chú' }).getAttribute('aria-expanded')).toBe('false')
    fireEvent.click(screen.getByRole('button', { name: 'Bảng ghi chú' }))
    const reopened = screen.getByRole('complementary', { name: 'Ghi chú khi đọc' })
    expect((within(reopened).getByRole('textbox') as HTMLTextAreaElement).value).toBe('Draft while I keep reading')
    expect(within(reopened).getByRole('button', { name: 'Xanh dương' }).getAttribute('aria-pressed')).toBe('true')
  })

  it('anchors a typed thought to the location where typing started while the reader moves on', async () => {
    const panel = await reader()
    fireEvent.change(within(panel).getByRole('textbox'), { target: { value: 'Thought about the original paragraph' } })
    fireEvent.click(screen.getByRole('button', { name: 'QA background reader location' }))
    fireEvent.click(within(panel).getByRole('button', { name: 'Lưu ghi chú' }))
    await waitFor(() => expect(fixtures.mutate.mock.calls.find(([, kind]) => kind === 'highlights')).toBeTruthy())
    const payload = fixtures.mutate.mock.calls.find(([, kind]) => kind === 'highlights')![3]
    expect(payload.locator_json).toBe(initialLocator)
    expect(payload.note).toBe('Thought about the original paragraph')
  })

  it('creates one highlight while a note save is pending and preserves the draft until saved', async () => {
    const panel = await reader()
    const pending = deferred<void>()
    fixtures.mutate.mockImplementation((_profile, kind) => kind === 'highlights' ? pending.promise : Promise.resolve())
    const draft = within(panel).getByRole('textbox') as HTMLTextAreaElement
    fireEvent.change(draft, { target: { value: 'Only save this thought once' } })
    const form = draft.closest('form')!
    fireEvent.submit(form); fireEvent.submit(form)
    try {
      expect(fixtures.mutate.mock.calls.filter(([, kind]) => kind === 'highlights')).toHaveLength(1)
      expect(draft.value).toBe('Only save this thought once')
      expect(draft.disabled).toBe(true)
      expect(within(panel).getByRole('button', { name: 'Đang lưu…' }).hasAttribute('disabled')).toBe(true)
    } finally { await act(async () => { pending.resolve(); await pending.promise }) }
    await waitFor(() => expect(draft.value).toBe(''))
    expect(draft.disabled).toBe(false)
    expect(panel.hidden).toBe(false)
  })

  it('opens notes for a selected passage and saves the quote with its exact source locator', async () => {
    await reader()
    fireEvent.click(screen.getByRole('button', { name: 'Bảng ghi chú' }))
    fireEvent.click(screen.getByRole('button', { name: 'QA select passage' }))
    const panel = screen.getByRole('complementary', { name: 'Ghi chú khi đọc' })
    expect(within(panel).getByText('A selected passage worth remembering')).toBeTruthy()
    fireEvent.click(within(panel).getByRole('button', { name: 'Lưu ghi chú' }))
    await waitFor(() => expect(fixtures.mutate.mock.calls.find(([, kind]) => kind === 'highlights')).toBeTruthy())
    const payload = fixtures.mutate.mock.calls.find(([, kind]) => kind === 'highlights')![3]
    expect(payload.text).toBe('A selected passage worth remembering')
    expect(JSON.parse(payload.locator_json)).toEqual({ type: 'TEXT', progression: 0.35, text: 'A selected passage worth remembering' })
    expect(payload.note).toBe('')
  })

  it('shows only current-account live highlights from the current book', async () => {
    saveSession(session)
    fixtures.localRecords.mockResolvedValue([
      note('this book', 'QA document', 'ACCOUNT:qa-user'),
      note('another book', 'Another document', 'ACCOUNT:qa-user'),
      note('another account', 'QA document', 'ACCOUNT:other-user'),
      { ...note('deleted', 'QA document', 'ACCOUNT:qa-user'), deleted: true },
      { ...note('bookmark', 'QA document', 'ACCOUNT:qa-user'), kind: 'bookmarks' },
    ])
    const panel = await reader()
    expect(within(panel).getByText('Thought this book')).toBeTruthy()
    expect(within(panel).queryByText('Thought another book')).toBeNull()
    expect(within(panel).queryByText('Thought another account')).toBeNull()
    expect(within(panel).queryByText('Thought deleted')).toBeNull()
    expect(within(panel).queryByText('Thought bookmark')).toBeNull()
  })

  it('can revisit the same source repeatedly without fetching the publication again', async () => {
    fixtures.localRecords.mockResolvedValue([note('jump')])
    const panel = await reader()
    const loaded = fixtures.loadBytes.mock.calls.length
    const source = within(panel).getByRole('button', { name: 'Về đoạn gốc' })
    fireEvent.click(source)
    const first = JSON.parse(screen.getByTestId('qa-reader-navigation').textContent!)
    expect(first.locatorJson).toBe(initialLocator)
    fireEvent.click(source)
    const second = JSON.parse(screen.getByTestId('qa-reader-navigation').textContent!)
    expect(second.locatorJson).toBe(initialLocator)
    expect(second.requestId).toBeGreaterThan(first.requestId)
    expect(fixtures.loadBytes).toHaveBeenCalledTimes(loaded)
    expect(panel.hidden).toBe(false)
  })

  it('does not clear a new book draft when a pending save from the previous book completes', async () => {
    const oldPanel = await reader()
    const pending = deferred<void>()
    fixtures.mutate.mockImplementation((_profile, kind) => kind === 'highlights' ? pending.promise : Promise.resolve())
    fireEvent.change(within(oldPanel).getByRole('textbox'), { target: { value: 'Pending thought for the old book' } })
    fireEvent.click(within(oldPanel).getByRole('button', { name: 'Lưu ghi chú' }))
    fireEvent.click(screen.getByRole('button', { name: 'Quay lại tủ sách' }))
    await act(async () => {
      window.history.pushState(null, '', '/read/Another%20document')
      window.dispatchEvent(new PopStateEvent('popstate'))
    })
    await screen.findByText('QA reader content')
    fireEvent.click(screen.getByRole('button', { name: 'Bảng ghi chú' }))
    const newPanel = screen.getByRole('complementary', { name: 'Ghi chú khi đọc' })
    const newDraft = within(newPanel).getByRole('textbox') as HTMLTextAreaElement
    fireEvent.change(newDraft, { target: { value: 'New book draft must survive' } })
    await act(async () => { pending.resolve(); await pending.promise })
    expect(newDraft.value).toBe('New book draft must survive')
    expect(screen.queryByText('Đã lưu ghi chú.')).toBeNull()
    expect(fixtures.mutate.mock.calls.filter(([, kind]) => kind === 'highlights')).toHaveLength(1)
  })

  it('does not clear a replacement account draft when the old account finishes saving', async () => {
    saveSession(session)
    const oldPanel = await reader()
    const pending = deferred<void>()
    fixtures.mutate.mockImplementation((_profile, kind) => kind === 'highlights' ? pending.promise : Promise.resolve())
    fireEvent.change(within(oldPanel).getByRole('textbox'), { target: { value: 'Private thought belonging to the old account' } })
    fireEvent.click(within(oldPanel).getByRole('button', { name: 'Lưu ghi chú' }))
    const replacement: Session = { ...session, token: 'replacement-notes-token', user: { ...session.user, id: 'replacement-reader', email: 'replacement@example.test' } }
    saveSession(replacement)
    fireEvent(window, new StorageEvent('storage', { key: SESSION_STORAGE_KEY, storageArea: localStorage }))
    await act(async () => {
      window.history.pushState(null, '', '/read/QA%20document')
      window.dispatchEvent(new PopStateEvent('popstate'))
    })
    await screen.findByText('QA reader content')
    fireEvent.click(screen.getByRole('button', { name: 'Bảng ghi chú' }))
    const newPanel = screen.getByRole('complementary', { name: 'Ghi chú khi đọc' })
    const newDraft = within(newPanel).getByRole('textbox') as HTMLTextAreaElement
    expect(newDraft.value).toBe('')
    fireEvent.change(newDraft, { target: { value: 'Replacement account thought' } })
    await act(async () => { pending.resolve(); await pending.promise })
    expect(newDraft.value).toBe('Replacement account thought')
    expect(newPanel.hidden).toBe(false)
    expect(screen.queryByText('Đã lưu ghi chú.')).toBeNull()
    expect(fixtures.mutate.mock.calls.find(([, kind]) => kind === 'highlights')?.[0]).toBe('ACCOUNT:qa-user')
  })
})

describe('searching inside the open book', () => {
  const locator = '{"type":"TEXT","progression":0.24,"text":"quiet river","start":2,"end":13}'
  const excerpt = 'A quiet river runs beside this library'
  const result: ReaderSearchResult = {
    hits: [{ id: 'qa-search-hit', locatorJson: locator, text: 'quiet river', excerpt, matchStart: 2, matchEnd: 13, label: 'QA chapter' }],
    truncated: false, scanned: 1, total: 1, textAvailable: true,
  }

  async function reader() {
    fixtures.getFiles.mockResolvedValue([file('QA document'), file('Another document')])
    window.history.replaceState(null, '', '/read/QA%20document')
    // A visible mocked reader can precede App's passive keyboard effect. Flush
    // the asynchronous navigation before testing a shortcut against that reader.
    await act(async () => { render(<App />) })
    await screen.findByText('QA reader content')
    return screen.getByRole('button', { name: 'Tìm trong sách' })
  }

  function searchPanel() {
    return screen.getByRole('complementary', { name: 'Tìm trong sách' })
  }

  async function search(query = 'quiet river') {
    fireEvent.change(within(searchPanel()).getByRole('searchbox', { name: 'Từ khóa trong sách' }), { target: { value: query } })
    await waitFor(() => expect(fixtures.searchBook).toHaveBeenCalledWith(query, expect.any(AbortSignal), expect.any(Function)))
  }

  async function hitButton() {
    let button: HTMLElement | undefined
    await waitFor(() => {
      button = within(searchPanel()).getAllByRole('button').find(item => item.textContent?.includes(excerpt))
      expect(button).toBeTruthy()
    })
    return button!
  }

  function annotations(): ReaderAnnotation[] {
    return JSON.parse(screen.getByTestId('qa-reader-annotations').textContent!)
  }

  it('opens with Ctrl/Cmd+F, focuses its input, and returns focus to the toolbar on Escape', async () => {
    const toggle = await reader()
    await act(async () => { toggle.focus() })
    const shortcut = new KeyboardEvent('keydown', { key: 'f', ctrlKey: true, bubbles: true, cancelable: true })
    fireEvent(window, shortcut)
    expect(shortcut.defaultPrevented).toBe(true)
    const input = within(searchPanel()).getByRole('searchbox', { name: 'Từ khóa trong sách' })
    await waitFor(() => expect(document.activeElement).toBe(input))
    fireEvent.keyDown(input, { key: 'Escape' })
    expect(screen.queryByRole('complementary', { name: 'Tìm trong sách' })).toBeNull()
    expect(document.activeElement).toBe(toggle)
    expect(screen.getByText('QA reader content')).toBeTruthy()
    fireEvent.keyDown(window, { key: 'f', metaKey: true })
    expect(searchPanel()).toBeTruthy()
    expect(toggle.getAttribute('aria-expanded')).toBe('true')
  })

  it('searches existing bytes without recording a new location or persisting a highlight', async () => {
    fixtures.searchBook.mockResolvedValue(result)
    const toggle = await reader()
    // Flush this reader's initial location explicitly rather than waiting for any
    // debounce, which could otherwise belong to an earlier test under load.
    await act(async () => { fireEvent(window, new Event('pagehide')) })
    expect(fixtures.mutate).toHaveBeenCalledWith('DEVICE_LOCAL', 'reading_progress', expect.any(String), expect.objectContaining({ progression: 0.6 }), false, true)
    fixtures.mutate.mockClear()
    const loaded = fixtures.loadBytes.mock.calls.length
    fireEvent.click(toggle)
    await search()
    await hitButton()
    expect(fixtures.loadBytes).toHaveBeenCalledTimes(loaded)
    expect(fixtures.mutate).not.toHaveBeenCalled()
    expect(screen.getByTestId('qa-reader-navigation').textContent).toBe('null')
    expect(annotations()).toEqual([])
  })

  it('opens and focuses search when an embedded reader forwards its search shortcut', async () => {
    const toggle = await reader()
    fireEvent.click(screen.getByRole('button', { name: 'QA embedded reader search request' }))
    expect(toggle.getAttribute('aria-expanded')).toBe('true')
    const input = within(searchPanel()).getByRole('searchbox', { name: 'Từ khóa trong sách' })
    await waitFor(() => expect(document.activeElement).toBe(input))
  })

  it('does not run a deferred reading-progress write after the application unmounts', async () => {
    fixtures.getFiles.mockResolvedValue([file('QA document')])
    window.history.replaceState(null, '', '/read/QA%20document')
    vi.useFakeTimers()
    try {
      const view = render(<App />)
      await act(async () => { await vi.advanceTimersByTimeAsync(0) })
      expect(screen.getByText('QA reader content')).toBeTruthy()
      expect(fixtures.mutate).not.toHaveBeenCalled()
      view.unmount()
      await act(async () => { await vi.advanceTimersByTimeAsync(2000) })
      expect(fixtures.mutate).not.toHaveBeenCalled()
    } finally { vi.useRealTimers() }
  })

  it('navigates repeated results through unique requests and uses a temporary reader decoration', async () => {
    const saved: SyncRecord = { key: 'DEVICE_LOCAL:highlights:saved', profile: 'DEVICE_LOCAL', kind: 'highlights', id: 'saved', version: 1, deleted: false,
      payload: { book_id: 'QA document', text: 'My existing quote', locator_json: '{"type":"TEXT","progression":0.7}', color: 'YELLOW' } }
    fixtures.localRecords.mockResolvedValue([saved])
    fixtures.searchBook.mockResolvedValue(result)
    const toggle = await reader()
    fireEvent.click(toggle)
    await search()
    const hit = await hitButton()
    const loaded = fixtures.loadBytes.mock.calls.length
    fireEvent.click(hit)
    const first = JSON.parse(screen.getByTestId('qa-reader-navigation').textContent!)
    expect(first.locatorJson).toBe(locator)
    expect(annotations()).toEqual(expect.arrayContaining([
      expect.objectContaining({ id: 'saved', color: 'YELLOW', text: 'My existing quote' }),
      expect.objectContaining({ id: 'nocap-search-active', color: 'BLUE', locatorJson: locator, text: 'quiet river' }),
    ]))
    fireEvent.click(hit)
    const next = JSON.parse(screen.getByTestId('qa-reader-navigation').textContent!)
    expect(next.locatorJson).toBe(locator)
    expect(next.requestId).toBeGreaterThan(first.requestId)
    expect(fixtures.loadBytes).toHaveBeenCalledTimes(loaded)
    expect(fixtures.mutate.mock.calls.filter(call => call[1] === 'highlights')).toHaveLength(0)
    fireEvent.click(toggle)
    expect(annotations()).toEqual([expect.objectContaining({ id: 'saved', color: 'YELLOW' })])
  })

  it('switches between search and notes without discarding an unsaved thought or its color', async () => {
    fixtures.searchBook.mockResolvedValue(result)
    const toggle = await reader()
    fireEvent.click(screen.getByRole('button', { name: 'Bảng ghi chú' }))
    const notes = screen.getByRole('complementary', { name: 'Ghi chú khi đọc' })
    fireEvent.change(within(notes).getByRole('textbox'), { target: { value: 'Keep this unfinished thought' } })
    fireEvent.click(within(notes).getByRole('button', { name: 'Xanh dương' }))
    fireEvent.click(toggle)
    expect(screen.queryByRole('complementary', { name: 'Ghi chú khi đọc' })).toBeNull()
    await search()
    fireEvent.click(await hitButton())
    expect(annotations().some(item => item.id === 'nocap-search-active')).toBe(true)
    fireEvent.click(screen.getByRole('button', { name: 'Bảng ghi chú' }))
    expect(screen.queryByRole('complementary', { name: 'Tìm trong sách' })).toBeNull()
    const reopened = screen.getByRole('complementary', { name: 'Ghi chú khi đọc' })
    expect((within(reopened).getByRole('textbox') as HTMLTextAreaElement).value).toBe('Keep this unfinished thought')
    expect(within(reopened).getByRole('button', { name: 'Xanh dương' }).getAttribute('aria-pressed')).toBe('true')
    expect(annotations().some(item => item.id === 'nocap-search-active')).toBe(false)
  })

  it('clears a selected match as soon as the query changes', async () => {
    fixtures.searchBook.mockResolvedValue(result)
    fireEvent.click(await reader())
    await search()
    fireEvent.click(await hitButton())
    expect(annotations().some(item => item.id === 'nocap-search-active')).toBe(true)
    fireEvent.change(within(searchPanel()).getByRole('searchbox', { name: 'Từ khóa trong sách' }), { target: { value: 'a different query' } })
    expect(annotations().some(item => item.id === 'nocap-search-active')).toBe(false)
  })

  it('aborts a previous book search and ignores its late results in the next book', async () => {
    const pending = deferred<ReaderSearchResult>()
    fixtures.searchBook.mockReturnValueOnce(pending.promise)
    fireEvent.click(await reader())
    await search()
    const oldSignal = fixtures.searchBook.mock.calls[0][1] as AbortSignal
    fireEvent.click(screen.getByRole('button', { name: 'Quay lại tủ sách' }))
    await act(async () => {
      window.history.pushState(null, '', '/read/Another%20document')
      window.dispatchEvent(new PopStateEvent('popstate'))
    })
    await screen.findByText('QA reader content')
    fireEvent.click(screen.getByRole('button', { name: 'Tìm trong sách' }))
    expect((within(searchPanel()).getByRole('searchbox', { name: 'Từ khóa trong sách' }) as HTMLInputElement).value).toBe('')
    expect(oldSignal.aborted).toBe(true)
    await act(async () => { pending.resolve(result); await pending.promise })
    expect(searchPanel().textContent).not.toContain(excerpt)
    expect(screen.getByTestId('qa-reader-navigation').textContent).toBe('null')
    expect(annotations()).toEqual([])
  })

  it('aborts a private search and clears its query after the account is replaced', async () => {
    saveSession(session)
    const pending = deferred<ReaderSearchResult>()
    fixtures.searchBook.mockReturnValueOnce(pending.promise)
    fireEvent.click(await reader())
    await search('private account query')
    const oldSignal = fixtures.searchBook.mock.calls[0][1] as AbortSignal
    saveSession({ ...session, token: 'replacement-search-token', user: { ...session.user, id: 'replacement-search-user' } })
    fireEvent(window, new StorageEvent('storage', { key: SESSION_STORAGE_KEY, storageArea: localStorage }))
    expect(screen.queryByRole('complementary', { name: 'Tìm trong sách' })).toBeNull()
    await act(async () => {
      window.history.pushState(null, '', '/read/QA%20document')
      window.dispatchEvent(new PopStateEvent('popstate'))
    })
    await screen.findByText('QA reader content')
    fireEvent.click(screen.getByRole('button', { name: 'Tìm trong sách' }))
    expect((within(searchPanel()).getByRole('searchbox', { name: 'Từ khóa trong sách' }) as HTMLInputElement).value).toBe('')
    expect(oldSignal.aborted).toBe(true)
    await act(async () => { pending.resolve(result); await pending.promise })
    expect(searchPanel().textContent).not.toContain(excerpt)
    expect(screen.getByTestId('qa-reader-navigation').textContent).toBe('null')
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
  it('keeps the stealth row on pagehide even if the hidden normal reader publishes another location', async () => {
    saveSession(session)
    fixtures.getFiles.mockResolvedValue([file('QA document')])
    fixtures.entitlement.mockResolvedValue({ userId: session.user.id, plan: 'PRO', status: 'ACTIVE', updatedAt: Date.now(), expiresAt: Date.now() + 86400000 })
    window.history.replaceState(null, '', '/read/QA%20document')
    render(<App />)
    await screen.findByText('QA reader content')
    await waitFor(() => expect(fixtures.entitlement).toHaveBeenCalled())
    await act(async () => { fireEvent.keyDown(window, { key: 'F2' }) })
    fireEvent.click(await screen.findByRole('button', { name: 'QA stealth advance' }, { timeout: 3000 }))
    fireEvent.click(screen.getByRole('button', { name: 'QA background reader location' }))
    fireEvent(window, new Event('pagehide'))
    await waitFor(() => expect(fixtures.mutate.mock.calls.some(([, kind, , payload]) => kind === 'reading_progress' && payload.progression === 0.73 && JSON.parse(payload.locator_json).rowIndex === 73)).toBe(true))
    expect(fixtures.mutate.mock.calls.some(([, kind, , payload]) => kind === 'reading_progress' && payload.progression === 0.1)).toBe(false)
    fixtures.mutate.mockClear()
    fireEvent.click(screen.getByRole('button', { name: 'QA stealth close' }))
    expect(fixtures.mutate.mock.calls.some(([, kind, , payload]) => kind === 'reading_progress' && JSON.parse(payload.locator_json).rowOffset === 8)).toBe(true)
  })

  it('uses a synchronous stealth checkpoint if the tab closed before its database write finished', async () => {
    fixtures.getFiles.mockResolvedValue([file('QA document')])
    saveStealthCheckpoint('DEVICE_LOCAL', 'QA document', { progression: 0.73, rowIndex: 73, rowCount: 101, rowId: 'REC-73', rowOffset: 8 })
    window.history.replaceState(null, '', '/read/QA%20document')
    render(<App />)
    await screen.findByText('QA reader content')
    // Opening at a checkpoint also starts its reading session at the restored percentage.
    vi.spyOn(Date, 'now').mockReturnValue(Date.now() + 6000)
    fireEvent(window, new Event('pagehide'))
    await waitFor(() => expect(fixtures.mutate.mock.calls.some(([, kind, , payload]) => kind === 'reading_sessions' && payload.start_progress === 0.73)).toBe(true))
  })

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
    // This exercises the render boundary, independently of the lazy bundle's
    // initial transform/import time on a busy test worker.
    await import('./admin/AdminWorkspace')
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
    fireEvent.click(screen.getByRole('button', { name: 'Bảng ghi chú' }))
    const panel = screen.getByRole('complementary', { name: 'Ghi chú khi đọc' })
    fireEvent.change(within(panel).getByRole('textbox'), { target: { value: 'Private note belonging to the old account' } })
    const pending = deferred<void>()
    fixtures.mutate.mockImplementation((_profile, kind) => kind === 'highlights' ? pending.promise : Promise.resolve())
    fireEvent.click(within(panel).getByRole('button', { name: 'Lưu ghi chú' }))
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

  it('offers administrator sign-in again after administrative access expires', async () => {
    saveSession(session); window.history.replaceState(null, '', '/admin')
    fixtures.adminIdentity.mockResolvedValue({ id: session.user.id, email: session.user.email, photoUrl: null, adminExpiresAt: Date.now() - 1 })
    render(<App />)
    expect(await screen.findByText('Phiên quản trị đã hết hạn. Hãy đăng nhập lại.')).toBeTruthy()
    expect(screen.queryByRole('heading', { name: 'Quản trị thư viện' })).toBeNull()
    expect(fixtures.adminRequest).not.toHaveBeenCalled()
    fireEvent.click(screen.getByRole('button', { name: 'Đăng nhập' }))
    expect(screen.getByRole('dialog', { name: 'Chào mừng quay lại.' })).toBeTruthy()
  })

  it('hides every administration entry for a Pro reader but exposes all entries for an approved admin', async () => {
    saveSession(session); window.history.replaceState(null, '', '/account')
    fixtures.entitlement.mockResolvedValue({ userId: session.user.id, plan: 'PRO', status: 'ACTIVE', expiresAt: Date.now() + 86400000 })
    const view = render(<App />)
    await waitFor(() => expect(fixtures.adminIdentity).toHaveBeenCalled())
    expect(screen.queryByRole('button', { name: 'Quản trị' })).toBeNull()
    expect(screen.queryByRole('button', { name: 'Mở khu vực quản trị' })).toBeNull()
    view.unmount()
    fixtures.adminIdentity.mockResolvedValue({ id: session.user.id, email: session.user.email, photoUrl: null, adminExpiresAt: Date.now() + 3600000 })
    render(<App />)
    expect(await screen.findByRole('button', { name: 'Mở khu vực quản trị' })).toBeTruthy()
    expect(screen.getAllByRole('button', { name: 'Quản trị' })).toHaveLength(2)
  })

  it('removes the workspace and admin menu while rechecking revoked privileges', async () => {
    saveSession(session); window.history.replaceState(null, '', '/admin')
    const recheck = deferred<import('./admin/api').AdminIdentity>()
    fixtures.adminIdentity.mockResolvedValueOnce({ id: session.user.id, email: session.user.email, photoUrl: null, adminExpiresAt: Date.now() + 3600000 }).mockReturnValue(recheck.promise)
    fixtures.adminRequest.mockRejectedValue(new ApiError(403, 'Revoked', 'ADMIN_REQUIRED'))
    render(<App />)
    await waitFor(() => expect(fixtures.adminIdentity).toHaveBeenCalledTimes(2))
    expect(screen.queryByRole('heading', { name: 'Quản trị thư viện' })).toBeNull()
    expect(screen.queryByRole('button', { name: 'Quản trị' })).toBeNull()
    expect(screen.getByText('Đang kiểm tra quyền quản trị…')).toBeTruthy()
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
    // The lazy reader may paint before its passive location effect publishes.
    // Sign out only after the location being asserted is actually available.
    await screen.findByText('60% · QA')
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
