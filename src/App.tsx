import { useCallback, useEffect, useMemo, useRef, useState } from 'react'
import { ArrowLeft, ArrowRight, BookMarked, BookOpen, Bookmark, Check, ChevronLeft, ChevronRight, Cloud, CloudOff, Download, FileText, Highlighter, Library, LogIn, LogOut, Menu, Plus, RotateCw, Search, Settings2, Trash2, X } from 'lucide-react'
import { forgotPassword, getCatalog, getUser, loadBookBytes, login, logout, register, uploadBlob } from './api'
import { ReaderPane } from './Reader'
import { getCachedCatalog, getFile, getFiles, getOfflineBook, getOfflineBooks, getPending, readSession, removeLocalDocument, removeOfflineBook, saveCachedCatalog, saveFile, saveOfflineBook, saveSession } from './store'
import { androidRecordId, localRecords, mutate, profileFor, readableError, syncNow } from './sync'
import type { Book, Category, LocalFile, ReaderLocation, Session, SyncRecord } from './types'
import './App.css'

type Page = 'home' | 'catalog' | 'library' | 'memory' | 'account'
type AuthMode = 'login' | 'register' | 'forgot'
type Theme = 'paper' | 'sepia' | 'night'

const toText = (value: unknown) => typeof value === 'string' ? value : ''
const ms = () => Date.now()
const offlineProfileFor = (book: Book, accountProfile: string) => book.source === 'cloud' || book.fileUrl?.startsWith('nocap-private:') ? accountProfile : 'PUBLIC_OFFLINE'

function syncedBook(record: SyncRecord): Book | null {
  if (record.deleted || record.kind !== 'catalog_books') return null
  const p = record.payload
  return {
    id: toText(p.id), title: toText(p.user_title_override) || toText(p.title) || 'Tài liệu',
    author: toText(p.user_author_override) || toText(p.author), description: toText(p.description),
    coverUrl: toText(p.cover_url), categoryId: toText(p.category_id), fileUrl: toText(p.file_url),
    format: toText(p.format), source: 'cloud', fileSizeBytes: Number(p.file_size_bytes) || 0,
  }
}

function progressFor(records: SyncRecord[], bookId: string) {
  return records.find(r => r.kind === 'reading_progress' && !r.deleted && r.payload.book_id === bookId)
}

function bookLabel(book: Book) { return book.author || (book.source === 'local' ? 'Tài liệu trên trình duyệt' : 'NoCap Library') }

function App() {
  const [page, setPage] = useState<Page>('home')
  const [session, setSession] = useState<Session | null>(() => readSession())
  const sessionToken = session?.token
  const profile = profileFor(session)
  const [catalog, setCatalog] = useState<Book[]>([])
  const [categories, setCategories] = useState<Category[]>([])
  const [records, setRecords] = useState<SyncRecord[]>([])
  const [localFiles, setLocalFiles] = useState<LocalFile[]>([])
  const [offlineIds, setOfflineIds] = useState<Set<string>>(new Set())
  const [offlineBusy, setOfflineBusy] = useState<string | null>(null)
  const [query, setQuery] = useState('')
  const [category, setCategory] = useState('all')
  const [reader, setReader] = useState<{ book: Book; bytes: ArrayBuffer; initial?: string } | null>(null)
  const [readerLoading, setReaderLoading] = useState(false)
  const [readerError, setReaderError] = useState('')
  const [notice, setNotice] = useState('')
  const [authOpen, setAuthOpen] = useState(false)
  const [sidebarOpen, setSidebarOpen] = useState(false)
  const [syncing, setSyncing] = useState(false)
  const [pendingCount, setPendingCount] = useState(0)
  const [online, setOnline] = useState(navigator.onLine)
  const [fontSize, setFontSize] = useState(100)
  const [theme, setTheme] = useState<Theme>('paper')
  const [location, setLocation] = useState<ReaderLocation | null>(null)
  const [selection, setSelection] = useState<{ text: string; locator: string } | null>(null)
  const [noteOpen, setNoteOpen] = useState(false)
  const [noteText, setNoteText] = useState('')
  const [noteSaving, setNoteSaving] = useState(false)
  const [controls, setControls] = useState<{ previous: () => void; next: () => void } | null>(null)
  const fileInput = useRef<HTMLInputElement>(null)
  const progressTimer = useRef<ReturnType<typeof setTimeout> | null>(null)
  const syncFlight = useRef<{ profile: string; promise: Promise<void> } | null>(null)
  const readerRef = useRef<Book | null>(null)
  const profileRef = useRef(profile)
  profileRef.current = profile
  const sessionRef = useRef(session)
  sessionRef.current = session
  const locationRef = useRef(location)
  locationRef.current = location
  const lastSyncAt = useRef(0)
  const syncNeedsRerun = useRef(false)

  const refreshLocal = useCallback(async (selectedProfile: string) => {
    const [nextRecords, nextFiles, nextPending, nextOffline, publicOffline] = await Promise.all([localRecords(selectedProfile), getFiles(selectedProfile), getPending(selectedProfile), getOfflineBooks(selectedProfile), getOfflineBooks('PUBLIC_OFFLINE')])
    if (profileRef.current !== selectedProfile) return
    setRecords(nextRecords)
    setLocalFiles(nextFiles)
    setPendingCount(nextPending.length)
    setOfflineIds(new Set([...nextOffline, ...publicOffline].map(item => item.bookId)))
  }, [])

  useEffect(() => {
    let active = true
    void (async () => {
      const cached = await getCachedCatalog().catch(() => null)
      if (active && cached) { setCatalog(cached.books); setCategories(cached.categories) }
      try {
        const data = await getCatalog()
        if (active) { setCatalog(data.books); setCategories(data.categories) }
        await saveCachedCatalog(data.books, data.categories)
      } catch (error) {
        if (active && !cached) setNotice(readableError(error))
      }
    })()
    const update = () => setOnline(navigator.onLine)
    window.addEventListener('online', update)
    window.addEventListener('offline', update)
    return () => { active = false; window.removeEventListener('online', update); window.removeEventListener('offline', update) }
  }, [])

  useEffect(() => { void refreshLocal(profile) }, [profile, refreshLocal])

  const synchronize = useCallback(async (activeSession: Session, silent = false) => {
    if (!navigator.onLine) {
      if (!silent) setNotice('Đang ngoại tuyến. Thay đổi của bạn được giữ trên trình duyệt.')
      return
    }
    const targetProfile = profileFor(activeSession)
    if (syncFlight.current) {
      if (syncFlight.current.profile === targetProfile) {
        syncNeedsRerun.current = true
        return syncFlight.current.promise
      }
      await syncFlight.current.promise
      if (profileRef.current !== targetProfile) return
    }
    setSyncing(true)
    const flight = (async () => {
      try {
        do {
          syncNeedsRerun.current = false
          const result = await syncNow(activeSession)
          lastSyncAt.current = Date.now()
          await refreshLocal(profileFor(activeSession))
          if (profileRef.current === profileFor(activeSession)) {
            if (result.conflicts) {
              setNotice(`${result.conflicts} thay đổi cần đối soát; bản trên trình duyệt vẫn được giữ.`)
            } else if (!silent && !syncNeedsRerun.current) {
              setNotice('Đã đồng bộ với tài khoản của bạn.')
            }
          }
        } while (syncNeedsRerun.current && profileRef.current === targetProfile)
      } catch (error) {
        if (profileRef.current === profileFor(activeSession)) {
          if (!silent || (error instanceof Error && error.message.includes('hết hạn'))) {
            setNotice(readableError(error))
          }
        }
      } finally {
        syncFlight.current = null
        syncNeedsRerun.current = false
        setSyncing(false)
      }
    })()
    syncFlight.current = { profile: targetProfile, promise: flight }
    try { await flight } finally { if (syncFlight.current?.promise === flight) syncFlight.current = null }
  }, [refreshLocal])

  useEffect(() => {
    const token = sessionToken
    if (!token) return
    let active = true
    void getUser(token).then(result => {
      if (!active) return
      const stored = readSession()
      if (!stored || stored.token !== token) return
      const updated = { ...stored, user: result.user }
      saveSession(updated)
      setSession(updated)
      void synchronize(updated)
    }).catch(error => {
      if (!active) return
      if (error?.status === 401 || error?.status === 403) { saveSession(null); setSession(null); setNotice('Phiên đăng nhập đã hết hạn. Dữ liệu trên trình duyệt vẫn được giữ riêng.') }
      else setNotice(readableError(error))
    })
    return () => { active = false }
    // Only verify when the account identity changes; sync retries use the online event.
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [sessionToken, synchronize])

  useEffect(() => {
    if (!online || !session) return
    void synchronize(session, true)
  }, [online, session, synchronize])

  useEffect(() => {
    const flushReadingProgress = () => {
      const book = readerRef.current
      const loc = locationRef.current
      const curProfile = profileRef.current
      const curSession = sessionRef.current
      if (book && loc) {
        if (progressTimer.current) {
          clearTimeout(progressTimer.current)
          progressTimer.current = null
        }
        const payload = { book_id: book.id, locator_json: loc.locatorJson, progression: Math.max(0, Math.min(1, loc.progression)), chapter_title: loc.chapterTitle || null, last_read_at: ms(), sync_version: 1 }
        void mutate(curProfile, 'reading_progress', androidRecordId('reading_progress', book.id), payload, false, book.source === 'local').then(() => {
          void refreshLocal(curProfile)
          if (curSession && navigator.onLine && book.source !== 'local') {
            void synchronize(curSession, true)
          }
        })
      }
    }

    const onVisibilityChange = () => {
      if (document.visibilityState === 'hidden') {
        flushReadingProgress()
      } else if (document.visibilityState === 'visible') {
        const curSession = sessionRef.current
        if (curSession && navigator.onLine && Date.now() - lastSyncAt.current > 15000) {
          void synchronize(curSession, true)
        }
      }
    }

    const onFocus = () => {
      const curSession = sessionRef.current
      if (curSession && navigator.onLine && Date.now() - lastSyncAt.current > 15000) {
        void synchronize(curSession, true)
      }
    }

    const interval = setInterval(() => {
      const curSession = sessionRef.current
      if (curSession && navigator.onLine && document.visibilityState === 'visible' && Date.now() - lastSyncAt.current > 45000) {
        void synchronize(curSession, true)
      }
    }, 45000)

    document.addEventListener('visibilitychange', onVisibilityChange)
    window.addEventListener('focus', onFocus)
    window.addEventListener('pagehide', flushReadingProgress)

    return () => {
      document.removeEventListener('visibilitychange', onVisibilityChange)
      window.removeEventListener('focus', onFocus)
      window.removeEventListener('pagehide', flushReadingProgress)
      clearInterval(interval)
    }
  }, [synchronize])

  const cloudBooks = useMemo(() => records.map(syncedBook).filter((book): book is Book => !!book && !!book.id && !catalog.some(item => item.id === book.id)), [records, catalog])
  const books = useMemo(() => [...catalog, ...cloudBooks, ...localFiles.map(file => file.book)], [catalog, cloudBooks, localFiles])
  const favorites = useMemo(() => new Set(records.filter(r => r.kind === 'favorites' && !r.deleted).map(r => toText(r.payload.book_id))), [records])
  const reading = useMemo(() => books.filter(book => !!progressFor(records, book.id)).sort((a, b) => Number(progressFor(records, b.id)?.payload.last_read_at || 0) - Number(progressFor(records, a.id)?.payload.last_read_at || 0)), [books, records])
  const libraryBooks = useMemo(() => books.filter(book => book.source === 'local' || book.source === 'cloud' || offlineIds.has(book.id) || favorites.has(book.id) || !!progressFor(records, book.id)), [books, offlineIds, favorites, records])
  const filteredBooks = useMemo(() => {
    const list = page === 'library' ? libraryBooks : catalog
    return list.filter(book => (category === 'all' || book.categoryId === category) && `${book.title} ${book.author}`.toLocaleLowerCase().includes(query.toLocaleLowerCase()))
  }, [page, libraryBooks, catalog, category, query])
  const annotations = useMemo(() => records.filter(r => !r.deleted && (r.kind === 'highlights' || r.kind === 'bookmarks')).sort((a, b) => Number(b.payload.created_at || 0) - Number(a.payload.created_at || 0)), [records])

  async function authenticated(value: Session) {
    if (progressTimer.current) clearTimeout(progressTimer.current)
    setReader(null); readerRef.current = null; setRecords([]); setLocalFiles([]); setOfflineIds(new Set())
    saveSession(value); setSession(value); setAuthOpen(false); setPage('home'); setNotice(`Đã đăng nhập ${value.user.email}.`)
  }

  async function signOut() {
    if (progressTimer.current) clearTimeout(progressTimer.current)
    const oldToken = session?.token
    saveSession(null); setSession(null); setRecords([]); setLocalFiles([]); setOfflineIds(new Set()); setReader(null); readerRef.current = null
    setPage('home'); setNotice('Đã đăng xuất. Dữ liệu tài khoản được giữ riêng và không bị xóa.')
    if (oldToken) void logout(oldToken).catch(() => {})
  }

async function sha256Hex(file: Blob): Promise<string> {
  const buffer = await file.arrayBuffer()
  const digestBuffer = await crypto.subtle.digest('SHA-256', buffer)
  return Array.from(new Uint8Array(digestBuffer), b => b.toString(16).padStart(2, '0')).join('')
}

  async function importFile(file: File) {
    const extension = file.name.split('.').pop()?.toLowerCase() || ''
    if (!['epub', 'pdf', 'txt', 'html', 'htm', 'docx'].includes(extension)) { setNotice('Hỗ trợ EPUB, PDF, TXT, HTML và DOCX.'); return }
    if (!file.size || file.size > 250 * 1024 * 1024) { setNotice('Tệp trống hoặc vượt giới hạn 250 MB.'); return }
    setNotice('Đang tính mã băm và chuẩn bị tài liệu...')
    try {
      const hash = await sha256Hex(file)
      const isCloud = !!session
      const bookId = `web-${crypto.randomUUID()}`
      const book: Book = {
        id: bookId,
        title: file.name.replace(/\.[^.]+$/, ''),
        author: 'Tài liệu của bạn',
        fileUrl: `nocap-private:${hash}`,
        format: extension.toUpperCase(),
        categoryId: 'imported',
        source: isCloud ? 'cloud' : 'local',
        fileSizeBytes: file.size,
      }
      await saveFile({ key: `${profile}:${book.id}`, profile, book, data: file, addedAt: ms() })
      await refreshLocal(profile)
      if (profileRef.current !== profile) return
      setPage('library')

      if (isCloud && session) {
        setNotice('Đang tải tệp lên Cloud...')
        try {
          await uploadBlob(session.token, hash, file)
          const mediaType = extension === 'pdf' ? 'application/pdf'
            : extension === 'txt' ? 'text/plain'
            : extension === 'html' || extension === 'htm' ? 'text/html'
            : extension === 'docx' ? 'application/vnd.openxmlformats-officedocument.wordprocessingml.document'
            : 'application/epub+zip'
          const now = ms()
          const payload = {
            id: book.id,
            title: book.title,
            author: book.author,
            description: '',
            cover_url: '',
            category_id: 'imported',
            file_url: `nocap-private:${hash}`,
            file_size_bytes: file.size,
            content_hash: hash,
            format: extension.toUpperCase(),
            media_type: mediaType,
            source_type: 'LOCAL_FILE',
            is_in_inbox: 1,
            reading_status: 'UNREAD',
            added_at: now,
            updated_at: now,
          }
          await mutate(profile, 'catalog_books', androidRecordId('catalog_books', book.id), payload, false, false)
          await refreshLocal(profile)
          void synchronize(session)
          setNotice('Đã thêm và đồng bộ tài liệu riêng lên Cloud thành công.')
        } catch (uploadError) {
          setNotice(`Tài liệu đã lưu trên trình duyệt, nhưng tải lên cloud gặp sự cố: ${readableError(uploadError)}`)
        }
      } else {
        setNotice('Đã thêm tài liệu vào trình duyệt này. Đăng nhập để tự động sao lưu lên Cloud.')
      }
    } catch {
      if (profileRef.current === profile) setNotice('Không lưu được tệp. Kiểm tra dung lượng trình duyệt rồi thử lại.')
    }
  }

  async function openBook(book: Book) {
    const targetProfile = profile
    if (progressTimer.current) clearTimeout(progressTimer.current)
    setReaderError(''); setReaderLoading(true); setLocation(null); setSelection(null)
    try {
      const [local, offlineCopy] = await Promise.all([getFile(profile, book.id), getOfflineBook(offlineProfileFor(book, profile), book.id)])
      const bytes = local ? await local.data.arrayBuffer() : offlineCopy ? await offlineCopy.data.arrayBuffer() : await loadBookBytes(book, session?.token)
      if (profileRef.current !== targetProfile) return
      if (!bytes.byteLength) throw new Error('Tệp sách không có nội dung.')
      readerRef.current = book
      setReader({ book, bytes, initial: toText(progressFor(records, book.id)?.payload.locator_json) })
    } catch (error) { if (profileRef.current === targetProfile) setReaderError(readableError(error)) }
    finally { setReaderLoading(false) }
  }

  async function toggleOffline(book: Book) {
    if (offlineBusy) return
    const targetProfile = profile
    const storageProfile = offlineProfileFor(book, targetProfile)
    setOfflineBusy(book.id)
    try {
      if (offlineIds.has(book.id)) {
        await removeOfflineBook(storageProfile, book.id)
        if (profileRef.current === targetProfile) setNotice('Đã bỏ bản tải offline. Ghi chú và tiến độ đọc vẫn được giữ.')
      } else {
        if (!navigator.onLine) throw new Error('Cần kết nối mạng để tải sách lần đầu.')
        const bytes = await loadBookBytes(book, session?.token)
        if (!bytes.byteLength) throw new Error('Tệp sách không có nội dung.')
        await saveOfflineBook(storageProfile, book.id, new Blob([bytes]))
        if (profileRef.current === targetProfile) setNotice('Đã tải sách để đọc offline trên trình duyệt này.')
      }
      await refreshLocal(targetProfile)
    } catch (error) { if (profileRef.current === targetProfile) setNotice(readableError(error)) }
    finally { setOfflineBusy(null) }
  }

  const onLocation = useCallback((next: ReaderLocation) => {
    setLocation(next)
    locationRef.current = next
    const book = readerRef.current
    if (!book) return
    if (progressTimer.current) clearTimeout(progressTimer.current)
    const currentProfile = profileRef.current
    progressTimer.current = setTimeout(() => {
      progressTimer.current = null
      const payload = { book_id: book.id, locator_json: next.locatorJson, progression: Math.max(0, Math.min(1, next.progression)), chapter_title: next.chapterTitle || null, last_read_at: ms(), sync_version: 1 }
      void mutate(currentProfile, 'reading_progress', androidRecordId('reading_progress', book.id), payload, false, book.source === 'local').then(() => {
        void refreshLocal(currentProfile)
        const curSession = sessionRef.current
        if (curSession && navigator.onLine && book.source !== 'local') {
          void synchronize(curSession, true)
        }
      })
    }, 1500)
  }, [refreshLocal, synchronize])

  function closeReader() {
    if (progressTimer.current) { clearTimeout(progressTimer.current); progressTimer.current = null }
    const loc = locationRef.current || location
    if (reader && loc) {
      const book = reader.book
      const payload = { book_id: book.id, locator_json: loc.locatorJson, progression: Math.max(0, Math.min(1, loc.progression)), chapter_title: loc.chapterTitle || null, last_read_at: ms(), sync_version: 1 }
      void mutate(profile, 'reading_progress', androidRecordId('reading_progress', book.id), payload, false, book.source === 'local').then(() => {
        void refreshLocal(profile)
        if (session && book.source !== 'local') void synchronize(session, true)
      })
    }
    setReader(null); readerRef.current = null; locationRef.current = null; setSelection(null)
  }

  async function toggleFavorite(book: Book) {
    const value = !favorites.has(book.id)
    await mutate(profile, 'favorites', androidRecordId('favorites', book.id), { book_id: book.id, added_at: ms(), sync_version: 1 }, !value)
    await refreshLocal(profile)
    if (session && online) void synchronize(session)
  }

  async function toggleBookmark() {
    if (!reader || !location) return
    const existing = records.find(r => r.kind === 'bookmarks' && !r.deleted && r.payload.book_id === reader.book.id && r.payload.locator_json === location.locatorJson)
    if (existing) await mutate(profile, 'bookmarks', existing.id, {}, true, reader.book.source === 'local')
    else {
      const id = crypto.randomUUID()
      await mutate(profile, 'bookmarks', androidRecordId('bookmarks', id), { id, book_id: reader.book.id, locator_json: location.locatorJson, chapter_title: location.chapterTitle || '', snippet: null, created_at: ms(), sync_version: 1, is_deleted: 0 }, false, reader.book.source === 'local')
    }
    await refreshLocal(profile)
    if (session && online && reader.book.source !== 'local') void synchronize(session)
  }

  async function saveNote() {
    if (!reader || !location || !noteText.trim()) return
    setNoteSaving(true)
    try {
      const id = crypto.randomUUID()
      const selected = selection?.text || (location.chapterTitle || 'Ghi chú tại vị trí đọc')
      const payload = { id, book_id: reader.book.id, locator_json: selection?.locator || location.locatorJson, text: selected, color: 'YELLOW', note: noteText.trim().slice(0, 10000), created_at: ms(), updated_at: ms() }
      await mutate(profile, 'highlights', androidRecordId('highlights', id), payload, false, reader.book.source === 'local')
      await refreshLocal(profile)
      setNoteOpen(false); setNoteText(''); setSelection(null); setNotice('Đã lưu ghi chú.')
      if (session && online && reader.book.source !== 'local') void synchronize(session)
    } catch (error) { setNotice(readableError(error)) }
    finally { setNoteSaving(false) }
  }

  async function deleteBook(book: Book) {
    if (!window.confirm(`Xóa “${book.title}” khỏi thư viện?`)) return
    if (book.source === 'local') {
      await removeLocalDocument(profile, book.id)
    } else if (book.source === 'cloud') {
      await mutate(profile, 'catalog_books', androidRecordId('catalog_books', book.id), {}, true)
      if (session && online) void synchronize(session)
    }
    await refreshLocal(profile)
    setNotice('Đã xóa tài liệu.')
  }

  const nav: Array<{ id: Page; label: string; icon: typeof BookOpen }> = [
    { id: 'home', label: 'Trang chủ', icon: BookOpen }, { id: 'catalog', label: 'Khám phá sách', icon: Search },
    { id: 'library', label: 'Tủ sách', icon: Library }, { id: 'memory', label: 'Ghi chú & dấu trang', icon: Highlighter },
    { id: 'account', label: 'Tài khoản', icon: Settings2 },
  ]

  return <div className="app-shell">
    <aside className={`sidebar ${sidebarOpen ? 'open' : ''}`}>
      <div className="brand"><div className="brand-mark"><BookOpen size={24} /></div><div><strong>NoCap</strong><span>Quiet Knowledge Workspace</span></div><button className="mobile-close icon-button" onClick={() => setSidebarOpen(false)} aria-label="Đóng menu"><X size={20} /></button></div>
      <div className="sidebar-caption">KHÔNG GIAN CỦA BẠN</div>
      <nav className="main-nav" aria-label="Điều hướng">
        {nav.map(item => <button key={item.id} className={page === item.id ? 'active' : ''} onClick={() => { setPage(item.id); setSidebarOpen(false); setQuery(''); setCategory('all') }}><item.icon size={19} /><span>{item.label}</span></button>)}
      </nav>
      <div className="sidebar-bottom"><div className="sync-summary">{online ? <Cloud size={17} /> : <CloudOff size={17} />}<div><strong>{!session ? 'Chế độ khách' : syncing ? 'Đang tự động đồng bộ…' : pendingCount ? 'Chờ gửi tự động' : 'Tự động đồng bộ bật'}</strong><small>{session ? (pendingCount ? `${pendingCount} thay đổi trên máy` : session.user.email) : 'Đăng nhập để tự đồng bộ qua Android'}</small></div></div>{session ? <button className="secondary wide" onClick={() => void synchronize(session)} disabled={syncing}><RotateCw size={16} className={syncing ? 'spin' : ''} /> Đồng bộ ngay</button> : <button className="primary wide" onClick={() => setAuthOpen(true)}><LogIn size={16} /> Đăng nhập</button>}</div>
    </aside>
    {sidebarOpen && <button className="sidebar-shade" aria-label="Đóng menu" onClick={() => setSidebarOpen(false)} />}

    <main className="main-area">
      <header className="topbar"><button className="mobile-menu icon-button" onClick={() => setSidebarOpen(true)} aria-label="Mở menu"><Menu size={22} /></button><div className="topbar-title">NO<span>CAP</span><small>READ • REMEMBER • GROW</small></div><div className="topbar-actions"><span className={`connection ${online ? '' : 'offline'}`}>{online ? 'Trực tuyến' : 'Ngoại tuyến'}</span><button className="profile-button" onClick={() => session ? setPage('account') : setAuthOpen(true)} aria-label="Tài khoản">{session?.user.displayName?.slice(0, 1).toUpperCase() || session?.user.email.slice(0, 1).toUpperCase() || 'G'}</button></div></header>

      <div className="content">
        {notice && <div className="notice" role="status"><span>{notice}</span><button onClick={() => setNotice('')} aria-label="Đóng thông báo"><X size={17} /></button></div>}
        {page === 'home' && <>
          <div className="hero"><div><p className="eyebrow">KHÔNG GIAN KIẾN THỨC CỦA BẠN</p><h1>Đọc chậm lại.<br /><em>Nhớ lâu hơn.</em></h1><p>Mọi cuốn sách, ghi chú và ý tưởng của bạn ở một nơi yên tĩnh.</p><div className="hero-actions"><button className="primary" onClick={() => setPage('catalog')}>Khám phá sách <ArrowRight size={17} /></button><button className="light-button" onClick={() => fileInput.current?.click()}><Plus size={17} /> Thêm tài liệu</button></div></div><div className="hero-art" aria-hidden="true"><div className="orbit one" /><div className="orbit two" /><BookOpen size={92} strokeWidth={1.2} /></div></div>
          <SectionHeader title="Đọc tiếp" action="Xem tủ sách" onAction={() => setPage('library')} />
          {reading.length ? <div className="book-grid">{reading.slice(0, 4).map(book => <BookCard key={book.id} book={book} progress={Number(progressFor(records, book.id)?.payload.progression || 0)} onOpen={() => void openBook(book)} onFavorite={() => void toggleFavorite(book)} favorite={favorites.has(book.id)} offline={book.source === 'local' || offlineIds.has(book.id)} offlineBusy={offlineBusy === book.id} onOffline={book.source !== 'local' && book.fileUrl ? () => void toggleOffline(book) : undefined} />)}</div> : <div className="empty-state"><BookOpen size={30} /><h3>Hành trình đọc bắt đầu ở đây</h3><p>Chọn một cuốn sách hoặc thêm tài liệu của bạn để bắt đầu.</p><button className="secondary" onClick={() => setPage('catalog')}>Xem thư viện sách</button></div>}
          <SectionHeader title="Gợi ý cho bạn" action="Xem tất cả" onAction={() => setPage('catalog')} />
          <div className="book-grid">{catalog.filter(book => book.fileUrl).slice(0, 4).map(book => <BookCard key={book.id} book={book} onOpen={() => void openBook(book)} onFavorite={() => void toggleFavorite(book)} favorite={favorites.has(book.id)} offline={offlineIds.has(book.id)} offlineBusy={offlineBusy === book.id} onOffline={() => void toggleOffline(book)} />)}</div>
        </>}

        {(page === 'catalog' || page === 'library') && <>
          <div className="page-heading"><div><p className="eyebrow">{page === 'catalog' ? 'THƯ VIỆN MỞ' : 'KHÔNG GIAN CÁ NHÂN'}</p><h1>{page === 'catalog' ? 'Khám phá sách' : 'Tủ sách của bạn'}</h1><p>{page === 'catalog' ? 'Những cuốn sách để đọc, tìm hiểu và ghi nhớ.' : 'Sách đã lưu, đang đọc và tài liệu thêm từ trình duyệt.'}</p></div><button className="primary" onClick={() => fileInput.current?.click()}><Plus size={17} /> Thêm tài liệu</button></div>
          <div className="filter-bar"><label className="search-field"><Search size={18} /><input value={query} onChange={event => setQuery(event.target.value)} placeholder="Tìm tên sách hoặc tác giả…" aria-label="Tìm sách" /></label><select value={category} onChange={event => setCategory(event.target.value)} aria-label="Lọc thể loại"><option value="all">Tất cả thể loại</option>{categories.map(item => <option key={item.id} value={item.id}>{item.name}</option>)}</select><span>{filteredBooks.length} tài liệu</span></div>
          {filteredBooks.length ? <div className="book-grid">{filteredBooks.map(book => <BookCard key={book.id} book={book} progress={Number(progressFor(records, book.id)?.payload.progression || 0)} onOpen={() => void openBook(book)} onFavorite={book.source === 'local' ? undefined : () => void toggleFavorite(book)} favorite={favorites.has(book.id)} onDelete={book.source === 'local' || book.source === 'cloud' ? () => void deleteBook(book) : undefined} offline={book.source === 'local' || offlineIds.has(book.id)} offlineBusy={offlineBusy === book.id} onOffline={book.source !== 'local' && book.fileUrl ? () => void toggleOffline(book) : undefined} />)}</div> : <div className="empty-state"><Library size={30} /><h3>Chưa có tài liệu phù hợp</h3><p>Thử từ khóa khác hoặc thêm một tài liệu từ máy của bạn.</p><button className="secondary" onClick={() => { setQuery(''); setCategory('all') }}>Xóa bộ lọc</button></div>}
        </>}

        {page === 'memory' && <><div className="page-heading"><div><p className="eyebrow">READING MEMORY</p><h1>Điều đáng nhớ</h1><p>Tìm lại ghi chú, đoạn đánh dấu và dấu trang trong một chỗ.</p></div><div className="count-chip">{annotations.length} mục đã lưu</div></div><label className="search-field memory-search"><Search size={18} /><input value={query} onChange={event => setQuery(event.target.value)} placeholder="Tìm trong ghi chú…" aria-label="Tìm ghi chú" /></label>{annotations.filter(record => `${record.payload.text || ''} ${record.payload.note || ''} ${record.payload.chapter_title || ''}`.toLocaleLowerCase().includes(query.toLocaleLowerCase())).length ? <div className="memory-list">{annotations.filter(record => `${record.payload.text || ''} ${record.payload.note || ''} ${record.payload.chapter_title || ''}`.toLocaleLowerCase().includes(query.toLocaleLowerCase())).map(record => { const book = books.find(item => item.id === record.payload.book_id); return <div className="memory-item" key={record.key}><div className="memory-icon">{record.kind === 'highlights' ? <Highlighter size={18} /> : <Bookmark size={18} />}</div><div><div className="memory-book">{book?.title || 'Tài liệu riêng'}</div><blockquote>{toText(record.payload.text) || toText(record.payload.chapter_title) || 'Dấu trang'}</blockquote>{!!record.payload.note && <p>{toText(record.payload.note)}</p>}</div>{book && <button className="text-button" onClick={() => void openBook(book)}>Mở sách <ArrowRight size={15} /></button>}</div> })}</div> : <div className="empty-state"><Highlighter size={30} /><h3>Chưa có điều gì được lưu</h3><p>Khi đọc, chọn đoạn văn để thêm ghi chú hoặc bấm dấu trang.</p><button className="secondary" onClick={() => setPage('catalog')}>Tìm sách để đọc</button></div>}</>}

        {page === 'account' && <><div className="page-heading"><div><p className="eyebrow">TÀI KHOẢN & ĐỒNG BỘ</p><h1>{session ? 'Không gian của bạn' : 'Đọc như khách'}</h1><p>{session ? 'Sách và ghi chú của tài khoản này được tách riêng.' : 'Bạn vẫn có thể đọc và thêm tài liệu trên trình duyệt này.'}</p></div></div><div className="settings-grid"><section className="settings-card"><h2>Tài khoản</h2>{session ? <><p className="account-email">{session.user.displayName || session.user.email}</p><p className="muted">{session.user.email}</p>{!session.user.emailVerified && <p className="warning-text">Email chưa xác minh. Một số thao tác cloud cần xác minh email.</p>}<button className="secondary" onClick={() => void signOut()}><LogOut size={17} /> Đăng xuất</button></> : <><p className="muted">Đăng nhập để tiếp tục trên Android và các thiết bị khác.</p><button className="primary" onClick={() => setAuthOpen(true)}>Đăng nhập / Đăng ký</button></>}</section><section className="settings-card"><h2>Tự động đồng bộ</h2><p>{online ? 'Đang kết nối Cloud • Tự động đồng bộ đa thiết bị' : 'Đang ngoại tuyến'}</p><p className="muted">{session ? (pendingCount ? `${pendingCount} thay đổi đang chờ tự động đồng bộ.` : 'Tiến độ đọc và ghi chú được tự động đồng bộ giữa Web và Android khi bạn đọc.') : 'Dữ liệu khách được lưu riêng trên trình duyệt hiện tại.'}</p>{session && <button className="secondary" onClick={() => void synchronize(session)} disabled={syncing}><RotateCw size={17} className={syncing ? 'spin' : ''} /> {syncing ? 'Đang đồng bộ…' : 'Đồng bộ ngay'}</button>}</section><section className="settings-card"><h2>Đọc thoải mái</h2><label className="range-label">Cỡ chữ <strong>{fontSize}%</strong><input type="range" min="80" max="170" step="10" value={fontSize} onChange={event => setFontSize(Number(event.target.value))} /></label><div className="theme-row">{(['paper', 'sepia', 'night'] as const).map(value => <button key={value} className={`theme-chip ${value} ${theme === value ? 'chosen' : ''}`} onClick={() => setTheme(value)}>{value === 'paper' ? 'Giấy sáng' : value === 'sepia' ? 'Vàng dịu' : 'Ban đêm'}</button>)}</div></section></div></>}
      </div>
      <input ref={fileInput} type="file" accept=".epub,.pdf,.txt,.html,.htm,.docx" hidden onChange={event => { const file = event.target.files?.[0]; if (file) void importFile(file); event.target.value = '' }} />
    </main>

    {(readerLoading || readerError) && <div className="overlay"><div className="loading-card"><button className="icon-button close-floating" onClick={() => { setReaderLoading(false); setReaderError('') }} aria-label="Đóng"><X size={20} /></button>{readerLoading ? <><div className="loader" /><h2>Đang mở sách…</h2><p>Đang chuẩn bị nội dung để đọc.</p></> : <><FileText size={32} /><h2>Chưa mở được tài liệu</h2><p>{readerError}</p><button className="primary" onClick={() => setReaderError('')}>Thử lại sau</button></>}</div></div>}

    {reader && <div className={`reader-shell ${theme}`}><div className="reader-topbar"><button className="reader-back" onClick={closeReader} aria-label="Quay lại tủ sách"><ArrowLeft size={19} /> <span>Tủ sách</span></button><div className="reader-title"><strong>{reader.book.title}</strong><small>{bookLabel(reader.book)}</small></div><div className="reader-actions"><button className="icon-button" title="Dấu trang" aria-label="Đánh dấu vị trí" onClick={() => void toggleBookmark()}><Bookmark size={20} /></button><button className="icon-button" title="Ghi chú" aria-label="Thêm ghi chú" onClick={() => { setNoteText(''); setNoteOpen(true) }}><Highlighter size={20} /></button></div></div><div className="reader-body"><ReaderPane book={reader.book} bytes={reader.bytes} initial={reader.initial} fontSize={fontSize} theme={theme} onLocation={onLocation} onSelection={(text, locator) => setSelection({ text, locator })} onControls={setControls} /></div><div className="reader-footer"><button onClick={() => controls?.previous()} disabled={!controls} aria-label="Trang trước"><ChevronLeft size={21} /> Trước</button><span>{Math.round((location?.progression || 0) * 100)}% · {location?.chapterTitle || 'Đang đọc'}</span><button onClick={() => controls?.next()} disabled={!controls} aria-label="Trang sau">Sau <ChevronRight size={21} /></button></div></div>}

    {noteOpen && reader && <div className="modal-shade" role="presentation" onMouseDown={event => { if (event.target === event.currentTarget) setNoteOpen(false) }}><div className="dialog" role="dialog" aria-modal="true" aria-labelledby="note-title"><button className="icon-button dialog-close" onClick={() => setNoteOpen(false)} aria-label="Đóng"><X size={19} /></button><p className="eyebrow">READING MEMORY</p><h2 id="note-title">Lưu điều đáng nhớ</h2>{selection?.text && <blockquote className="selection-preview">“{selection.text.slice(0, 300)}{selection.text.length > 300 ? '…' : ''}”</blockquote>}<label htmlFor="note-input">Ghi chú của bạn</label><textarea id="note-input" value={noteText} onChange={event => setNoteText(event.target.value)} maxLength={10000} rows={5} placeholder="Điều gì khiến bạn muốn giữ đoạn này?" autoFocus /><div className="dialog-actions"><button className="secondary" onClick={() => setNoteOpen(false)}>Hủy</button><button className="primary" onClick={() => void saveNote()} disabled={!noteText.trim() || noteSaving}><Check size={17} /> {noteSaving ? 'Đang lưu…' : 'Lưu ghi chú'}</button></div></div></div>}

    {authOpen && <AuthDialog onClose={() => setAuthOpen(false)} onSuccess={value => void authenticated(value)} />}
  </div>
}

function SectionHeader({ title, action, onAction }: { title: string; action: string; onAction: () => void }) {
  return <div className="section-header"><h2>{title}</h2><button onClick={onAction}>{action} <ArrowRight size={16} /></button></div>
}

function BookCard({ book, progress, onOpen, favorite, onFavorite, onDelete, offline, offlineBusy, onOffline }: { book: Book; progress?: number; onOpen: () => void; favorite: boolean; onFavorite?: () => void; onDelete?: () => void; offline?: boolean; offlineBusy?: boolean; onOffline?: () => void }) {
  return <article className="book-card"><button className="cover-button" onClick={onOpen} aria-label={`Mở ${book.title}`}><div className="book-cover">{book.coverUrl ? <img src={book.coverUrl} alt="" loading="lazy" onError={event => { event.currentTarget.style.display = 'none' }} /> : null}<div className="cover-fallback"><BookOpen size={34} /><small>NoCap</small></div></div></button><div className="book-info"><div className="book-meta">{offline ? 'ĐÃ LƯU OFFLINE' : book.source === 'cloud' ? 'CLOUD CỦA BẠN' : book.language === 'vi' ? 'TIẾNG VIỆT' : 'SÁCH ĐIỆN TỬ'}</div><button className="book-title" onClick={onOpen}>{book.title}</button><p>{bookLabel(book)}</p>{!!progress && <div className="progress-bar" aria-label={`Đã đọc ${Math.round(progress * 100)} phần trăm`}><span style={{ width: `${Math.max(2, progress * 100)}%` }} /></div>}<div className="card-actions"><button className="read-link" onClick={onOpen}>{progress ? 'Đọc tiếp' : 'Bắt đầu đọc'} <ArrowRight size={15} /></button>{onOffline && <button className="icon-button" title={offline ? 'Bỏ bản tải offline' : 'Tải để đọc offline'} aria-label={offline ? `Bỏ bản tải offline của ${book.title}` : `Tải ${book.title} để đọc offline`} onClick={onOffline} disabled={offlineBusy}>{offline ? <Check size={17} /> : <Download size={17} />}</button>}{onFavorite && <button className="icon-button" title={favorite ? 'Bỏ lưu' : 'Lưu vào tủ sách'} aria-label={favorite ? 'Bỏ lưu' : 'Lưu vào tủ sách'} onClick={onFavorite}><BookMarked size={17} fill={favorite ? 'currentColor' : 'none'} /></button>}{onDelete && <button className="icon-button" title="Xóa tệp trên trình duyệt" aria-label="Xóa tệp" onClick={onDelete}><Trash2 size={17} /></button>}</div></div></article>
}

function AuthDialog({ onClose, onSuccess }: { onClose: () => void; onSuccess: (session: Session) => void }) {
  const [mode, setMode] = useState<AuthMode>('login')
  const [email, setEmail] = useState('')
  const [password, setPassword] = useState('')
  const [busy, setBusy] = useState(false)
  const [message, setMessage] = useState('')
  async function submit(event: React.FormEvent) {
    event.preventDefault(); setBusy(true); setMessage('')
    try {
      if (mode === 'forgot') { const result = await forgotPassword(email); setMessage(result.message); return }
      const result = mode === 'register' ? await register(email, password) : await login(email, password)
      onSuccess(result)
    } catch (error) { setMessage(readableError(error)) }
    finally { setBusy(false) }
  }
  return <div className="modal-shade" role="presentation" onMouseDown={event => { if (event.target === event.currentTarget) onClose() }}><div className="dialog auth-dialog" role="dialog" aria-modal="true" aria-labelledby="auth-title"><button className="icon-button dialog-close" onClick={onClose} aria-label="Đóng"><X size={19} /></button><div className="auth-mark"><BookOpen size={25} /></div><p className="eyebrow">NO CAP ACCOUNT</p><h2 id="auth-title">{mode === 'login' ? 'Chào mừng quay lại.' : mode === 'register' ? 'Tạo không gian của bạn.' : 'Lấy lại quyền truy cập.'}</h2><p className="muted">{mode === 'forgot' ? 'Chúng tôi sẽ gửi hướng dẫn đặt lại mật khẩu nếu email tồn tại.' : 'Đăng nhập bằng tài khoản NoCap đang dùng trên Android.'}</p><form onSubmit={event => void submit(event)}><label>Email<input type="email" autoComplete="email" required value={email} onChange={event => setEmail(event.target.value)} placeholder="email@example.com" /></label>{mode !== 'forgot' && <label>Mật khẩu<input type="password" autoComplete={mode === 'login' ? 'current-password' : 'new-password'} minLength={mode === 'register' ? 12 : undefined} required value={password} onChange={event => setPassword(event.target.value)} placeholder={mode === 'register' ? 'Ít nhất 12 ký tự' : 'Nhập mật khẩu'} /></label>}{message && <p className="form-message" role="status">{message}</p>}<button className="primary wide" type="submit" disabled={busy}>{busy ? 'Đang xử lý…' : mode === 'login' ? 'Đăng nhập' : mode === 'register' ? 'Tạo tài khoản' : 'Gửi hướng dẫn'} <ArrowRight size={17} /></button></form><div className="auth-links">{mode !== 'login' && <button onClick={() => { setMode('login'); setMessage('') }}>Đăng nhập</button>}{mode !== 'register' && <button onClick={() => { setMode('register'); setMessage('') }}>Tạo tài khoản</button>}{mode === 'login' && <button onClick={() => { setMode('forgot'); setMessage('') }}>Quên mật khẩu?</button>}</div></div></div>
}

export default App
