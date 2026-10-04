import { useCallback, useEffect, useMemo, useRef, useState } from 'react'
import { AlignJustify, AlignLeft, ArrowLeft, ArrowRight, Award, BarChart3, BookMarked, BookOpen, Bookmark, Briefcase, Check, CheckCircle2, ChevronLeft, ChevronRight, Cloud, CloudOff, Download, FileDown, FileText, Flame, Globe, Highlighter, Home, Layers, Library, List, LogIn, LogOut, Menu, Plus, RotateCcw, RotateCw, Search, Settings2, Sparkles, Star, Trash2, Type, X } from 'lucide-react'
import { forgotPassword, getCatalog, getEntitlement, getUser, loadBookBytes, login, logout, register, uploadBlob, type Entitlement } from './api'
import { ReaderPane } from './Reader'
import { StealthReader } from './stealth/StealthReader'
import { getCachedCatalog, getFile, getFiles, getOfflineBook, getOfflineBooks, getPending, readSession, removeLocalDocument, removeOfflineBook, saveCachedCatalog, saveFile, saveOfflineBook, saveSession } from './store'
import { androidRecordId, localRecords, mutate, profileFor, readableError, syncNow } from './sync'
import { initialReviewItem, nextReview, reviewIsDue, type ReviewItemPayload } from './review'
import type { Book, Category, FontFamily, LocalFile, ReaderLocation, ReaderWidth, Session, SyncRecord, TextAlignment, TocItem } from './types'
import { OceanWaves } from './OceanWaves'
import { getStoredLang, setStoredLang, t, type Lang } from './i18n'
import './App.css'

type Page = 'home' | 'catalog' | 'library' | 'memory' | 'stats' | 'account'
type ShelfFilter = 'all' | 'reading' | 'favorites' | 'completed' | 'offline' | 'local'
type AuthMode = 'login' | 'register' | 'forgot'
type Theme = 'paper' | 'sepia' | 'night'
type ReaderComfort = { fontSize: number; fontFamily: FontFamily; lineHeight: number; textAlignment: TextAlignment; theme: Theme; readerWidth: ReaderWidth }

const defaultComfort: ReaderComfort = { fontSize: 100, fontFamily: 'serif', lineHeight: 1.65, textAlignment: 'left', theme: 'paper', readerWidth: 'standard' }

function storedComfort(): ReaderComfort {
  try {
    const raw = JSON.parse(localStorage.getItem('nocap-reader-comfort-v1') || 'null') as Partial<ReaderComfort> | null
    if (!raw) return defaultComfort
    return {
      fontSize: Number.isFinite(raw.fontSize) ? Math.max(80, Math.min(170, Number(raw.fontSize))) : defaultComfort.fontSize,
      fontFamily: ['serif', 'sans', 'mono'].includes(String(raw.fontFamily)) ? raw.fontFamily as FontFamily : defaultComfort.fontFamily,
      lineHeight: [1.4, 1.65, 1.9].includes(Number(raw.lineHeight)) ? Number(raw.lineHeight) : defaultComfort.lineHeight,
      textAlignment: raw.textAlignment === 'justify' ? 'justify' : 'left',
      theme: ['paper', 'sepia', 'night'].includes(String(raw.theme)) ? raw.theme as Theme : defaultComfort.theme,
      readerWidth: ['narrow', 'standard', 'wide'].includes(String(raw.readerWidth)) ? raw.readerWidth as ReaderWidth : defaultComfort.readerWidth,
    }
  } catch { return defaultComfort }
}

function comfortFromRecord(record: SyncRecord | undefined, readerWidth: ReaderWidth): ReaderComfort | null {
  if (!record || record.deleted || record.kind !== 'per_book_preferences' || record.payload.use_book_override === 0 || record.payload.use_book_override === false) return null
  const p = record.payload
  const theme: Theme = p.theme === 'DARK' ? 'night' : p.theme === 'SEPIA' ? 'sepia' : 'paper'
  const fontFamily: FontFamily = p.font_family === 'SANS_SERIF' || p.font_family === 'ROBOTO' ? 'sans' : p.font_family === 'CUSTOM' ? 'mono' : 'serif'
  return {
    fontSize: Math.max(80, Math.min(170, Math.round((Number(p.font_size) || 1) * 100))),
    fontFamily,
    lineHeight: Math.max(1.2, Math.min(2, Number(p.line_height) || defaultComfort.lineHeight)),
    textAlignment: p.text_alignment === 'JUSTIFY' ? 'justify' : 'left',
    theme,
    readerWidth,
  }
}

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

function bookLabel(book: Book, lang: Lang = 'vi') { return book.author || (book.source === 'local' ? t[lang].bookCard.browserDoc : t[lang].bookCard.libraryDefault) }

function App() {
  const initialComfort = useMemo(storedComfort, [])
  const [lang, setLang] = useState<Lang>(getStoredLang)
  const toggleLang = () => {
    const next: Lang = lang === 'vi' ? 'en' : 'vi'
    setLang(next)
    setStoredLang(next)
  }
  const curT = t[lang]
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
  const [fontSize, setFontSize] = useState(initialComfort.fontSize)
  const [fontFamily, setFontFamily] = useState<FontFamily>(initialComfort.fontFamily)
  const [lineHeight, setLineHeight] = useState<number>(initialComfort.lineHeight)
  const [textAlignment, setTextAlignment] = useState<TextAlignment>(initialComfort.textAlignment)
  const [theme, setTheme] = useState<Theme>(initialComfort.theme)
  const [readerWidth, setReaderWidth] = useState<ReaderWidth>(initialComfort.readerWidth)
  const [toc, setToc] = useState<TocItem[]>([])
  const [tocOpen, setTocOpen] = useState(false)
  const [settingsOpen, setSettingsOpen] = useState(false)
  const [navigateTarget, setNavigateTarget] = useState<string | null>(null)
  const [location, setLocation] = useState<ReaderLocation | null>(null)
  const [selection, setSelection] = useState<{ text: string; locator: string } | null>(null)
  const [noteOpen, setNoteOpen] = useState(false)
  const [noteText, setNoteText] = useState('')
  const [noteColor, setNoteColor] = useState<'YELLOW' | 'GREEN' | 'BLUE' | 'PINK' | 'PURPLE'>('YELLOW')
  const [noteSaving, setNoteSaving] = useState(false)
  const [sortOrder, setSortOrder] = useState<'recent' | 'title' | 'progress'>('recent')
  const [shelfFilter, setShelfFilter] = useState<ShelfFilter>('all')
  const [organizationFilter, setOrganizationFilter] = useState('all')
  const [reviewOpen, setReviewOpen] = useState(false)
  const [reviewIndex, setReviewIndex] = useState(0)
  const [cardFlipped, setCardFlipped] = useState(false)
  const [reviewQueue, setReviewQueue] = useState<SyncRecord[]>([])
  const [reviewStats, setReviewStats] = useState({ mastered: 0, reviewAgain: 0 })
  const [entitlement, setEntitlement] = useState<Entitlement | null>(null)
  const [controls, setControls] = useState<{ previous: () => void; next: () => void } | null>(null)
  const [selectedBook, setSelectedBook] = useState<Book | null>(null)
  const [stealthActive, setStealthActive] = useState(false)
  const fileInput = useRef<HTMLInputElement>(null)
  const progressTimer = useRef<ReturnType<typeof setTimeout> | null>(null)
  const preferenceTimer = useRef<ReturnType<typeof setTimeout> | null>(null)
  const readingSessionRef = useRef<{ id: string; bookId: string; startedAt: number; startProgress: number; format: string; localOnly: boolean } | null>(null)
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

  useEffect(() => {
    localStorage.setItem('nocap-reader-comfort-v1', JSON.stringify({ fontSize, fontFamily, lineHeight, textAlignment, theme, readerWidth }))
  }, [fontSize, fontFamily, lineHeight, textAlignment, theme, readerWidth])

  useEffect(() => {
    if (!reader) return
    document.documentElement.classList.add('reader-open')
    document.body.classList.add('reader-open')
    return () => {
      document.documentElement.classList.remove('reader-open')
      document.body.classList.remove('reader-open')
    }
  }, [reader])

  useEffect(() => {
    const onGlobalKey = (e: KeyboardEvent) => {
      if (e.key === 'F2') {
        if (reader) {
          e.preventDefault()
          setStealthActive(prev => !prev)
        }
      }
      if (e.key === 'Escape') {
        if (tocOpen) { setTocOpen(false); return }
        if (settingsOpen) { setSettingsOpen(false); return }
        if (noteOpen) { setNoteOpen(false); return }
        if (reviewOpen) { setReviewOpen(false); return }
        if (authOpen) { setAuthOpen(false); return }
        if (selectedBook) { setSelectedBook(null); return }
        if (reader) {
          e.preventDefault()
          closeReader()
          setPage('home')
          window.scrollTo({ top: 0, behavior: 'smooth' })
        }
      }
    }
    window.addEventListener('keydown', onGlobalKey)
    return () => window.removeEventListener('keydown', onGlobalKey)
  }, [reader, tocOpen, settingsOpen, noteOpen, reviewOpen, authOpen, selectedBook])

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

  const beginReadingSession = useCallback((book: Book, startProgress: number) => {
    readingSessionRef.current = {
      id: crypto.randomUUID(),
      bookId: book.id,
      startedAt: ms(),
      startProgress: Math.max(0, Math.min(1, startProgress)),
      format: book.format || 'EPUB',
      localOnly: book.source === 'local',
    }
  }, [])

  const completeReadingSession = useCallback(async (book: Book, endProgress: number) => {
    const tracked = readingSessionRef.current
    if (!tracked || tracked.bookId !== book.id) return
    readingSessionRef.current = null
    const endedAt = ms()
    const duration = Math.max(0, endedAt - tracked.startedAt)
    if (duration < 5000) return
    const selectedProfile = profileRef.current
    const payload = {
      id: tracked.id,
      book_id: tracked.bookId,
      started_at: tracked.startedAt,
      ended_at: endedAt,
      duration_ms: duration,
      start_progress: tracked.startProgress,
      end_progress: Math.max(0, Math.min(1, endProgress)),
      format: tracked.format,
    }
    await mutate(selectedProfile, 'reading_sessions', androidRecordId('reading_sessions', tracked.id), payload, false, tracked.localOnly)
    await refreshLocal(selectedProfile)
    const activeSession = sessionRef.current
    if (activeSession && navigator.onLine && !tracked.localOnly) void synchronize(activeSession, true)
  }, [refreshLocal, synchronize])

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
    if (!sessionToken) { setEntitlement(null); return }
    let active = true
    void getEntitlement(sessionToken).then(value => {
      if (active) setEntitlement(value)
    }).catch(() => {
      if (active) setEntitlement(null)
    })
    return () => { active = false }
  }, [sessionToken])

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
        const book = readerRef.current
        if (book) void completeReadingSession(book, locationRef.current?.progression || 0)
      } else if (document.visibilityState === 'visible') {
        const book = readerRef.current
        if (book && !readingSessionRef.current) beginReadingSession(book, locationRef.current?.progression || 0)
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
  }, [synchronize, refreshLocal, beginReadingSession, completeReadingSession])

  const cloudBooks = useMemo(() => records.map(syncedBook).filter((book): book is Book => !!book && !!book.id && !catalog.some(item => item.id === book.id)), [records, catalog])
  const books = useMemo(() => [...catalog, ...cloudBooks, ...localFiles.map(file => file.book)], [catalog, cloudBooks, localFiles])
  const favorites = useMemo(() => new Set(records.filter(r => r.kind === 'favorites' && !r.deleted).map(r => toText(r.payload.book_id))), [records])
  const reading = useMemo(() => books.filter(book => !!progressFor(records, book.id)).sort((a, b) => Number(progressFor(records, b.id)?.payload.last_read_at || 0) - Number(progressFor(records, a.id)?.payload.last_read_at || 0)), [books, records])
  const libraryBooks = useMemo(() => books.filter(book => book.source === 'local' || book.source === 'cloud' || offlineIds.has(book.id) || favorites.has(book.id) || !!progressFor(records, book.id)), [books, offlineIds, favorites, records])
  const tags = useMemo(() => records.filter(record => record.kind === 'tags' && !record.deleted).map(record => ({ id: toText(record.payload.id), name: toText(record.payload.name) })).filter(item => item.id && item.name), [records])
  const collections = useMemo(() => records.filter(record => record.kind === 'collections' && !record.deleted).map(record => ({ id: toText(record.payload.id), name: toText(record.payload.name) })).filter(item => item.id && item.name), [records])
  const filteredBooks = useMemo(() => {
    let list = page === 'library' ? libraryBooks : catalog
    if (page === 'library') {
      if (shelfFilter === 'reading') {
        list = list.filter(b => {
          const prog = Number(progressFor(records, b.id)?.payload.progression || 0)
          return prog > 0 && prog < 0.99
        })
      } else if (shelfFilter === 'favorites') {
        list = list.filter(b => favorites.has(b.id))
      } else if (shelfFilter === 'completed') {
        list = list.filter(b => Number(progressFor(records, b.id)?.payload.progression || 0) >= 0.99)
      } else if (shelfFilter === 'offline') {
        list = list.filter(b => b.source === 'local' || offlineIds.has(b.id))
      } else if (shelfFilter === 'local') {
        list = list.filter(b => b.source === 'local' || b.source === 'cloud')
      }
      if (organizationFilter.startsWith('tag:')) {
        const tagId = organizationFilter.slice(4)
        const bookIds = new Set(records.filter(record => record.kind === 'book_tag_cross_ref' && !record.deleted && record.payload.tag_id === tagId).map(record => toText(record.payload.book_id)))
        list = list.filter(book => bookIds.has(book.id))
      } else if (organizationFilter.startsWith('collection:')) {
        const collectionId = organizationFilter.slice('collection:'.length)
        const bookIds = new Set(records.filter(record => record.kind === 'book_collection_cross_ref' && !record.deleted && record.payload.collection_id === collectionId).map(record => toText(record.payload.book_id)))
        list = list.filter(book => bookIds.has(book.id))
      }
    }
    const filtered = list.filter(book => (category === 'all' || book.categoryId === category) && `${book.title} ${book.author}`.toLocaleLowerCase().includes(query.toLocaleLowerCase()))
    return [...filtered].sort((a, b) => {
      if (sortOrder === 'title') return a.title.localeCompare(b.title, 'vi')
      if (sortOrder === 'progress') {
        const progA = Number(progressFor(records, a.id)?.payload.progression || 0)
        const progB = Number(progressFor(records, b.id)?.payload.progression || 0)
        return progB - progA
      }
      const timeA = Number(progressFor(records, a.id)?.payload.last_read_at || 0)
      const timeB = Number(progressFor(records, b.id)?.payload.last_read_at || 0)
      return timeB - timeA
    })
  }, [page, libraryBooks, catalog, category, query, sortOrder, records, shelfFilter, favorites, offlineIds, organizationFilter])
  const annotations = useMemo(() => records.filter(r => !r.deleted && (r.kind === 'highlights' || r.kind === 'bookmarks')).sort((a, b) => Number(b.payload.created_at || 0) - Number(a.payload.created_at || 0)), [records])
  const readerAnnotations = useMemo(() => {
    if (!reader) return []
    return records.filter(record => record.kind === 'highlights' && !record.deleted && record.payload.book_id === reader.book.id).map(record => ({
      id: record.id,
      locatorJson: toText(record.payload.locator_json),
      text: toText(record.payload.text),
      color: toText(record.payload.color) || 'YELLOW',
    }))
  }, [reader, records])
  const currentBookmarked = !!(reader && location && records.some(record => record.kind === 'bookmarks' && !record.deleted && record.payload.book_id === reader.book.id && record.payload.locator_json === location.locatorJson))
  const reviewItems = useMemo(() => records.filter(record => record.kind === 'review_items' && !record.deleted), [records])
  const dueReviewCount = useMemo(() => {
    const byAnnotation = new Map(reviewItems.map(item => [toText(item.payload.annotation_id), item]))
    return annotations.filter(annotation => {
      if (annotation.kind !== 'highlights') return false
      const item = byAnnotation.get(toText(annotation.payload.id) || annotation.id)
      return !item || reviewIsDue(item.payload as unknown as ReviewItemPayload)
    }).length
  }, [annotations, reviewItems])
  const readingSessions = useMemo(() => records.filter(record => record.kind === 'reading_sessions' && !record.deleted && Number(record.payload.duration_ms) >= 5000), [records])
  const totalReadingMinutes = Math.round(readingSessions.reduce((sum, record) => sum + Number(record.payload.duration_ms || 0), 0) / 60000)
  const readingDayCount = useMemo(() => new Set(readingSessions.map(record => new Date(Number(record.payload.started_at) || 0).toISOString().slice(0, 10))).size, [readingSessions])

  async function authenticated(value: Session) {
    if (progressTimer.current) clearTimeout(progressTimer.current)
    if (preferenceTimer.current) clearTimeout(preferenceTimer.current)
    if (readerRef.current) await completeReadingSession(readerRef.current, locationRef.current?.progression || 0)
    setReader(null); readerRef.current = null; setRecords([]); setLocalFiles([]); setOfflineIds(new Set())
    saveSession(value); setSession(value); setAuthOpen(false); setPage('home'); setNotice(`Đã đăng nhập ${value.user.email}.`)
  }

  async function signOut() {
    if (progressTimer.current) clearTimeout(progressTimer.current)
    if (preferenceTimer.current) clearTimeout(preferenceTimer.current)
    if (readerRef.current) await completeReadingSession(readerRef.current, locationRef.current?.progression || 0)
    const oldToken = session?.token
    saveSession(null); setSession(null); setRecords([]); setLocalFiles([]); setOfflineIds(new Set()); setReader(null); readerRef.current = null
    setPage('home'); setNotice('Đã đăng xuất. Dữ liệu tài khoản được giữ riêng và không bị xóa.')
    if (oldToken) void logout(oldToken).catch(() => {})
  }

  function applyComfort(next: ReaderComfort) {
    setFontSize(next.fontSize)
    setFontFamily(next.fontFamily)
    setLineHeight(next.lineHeight)
    setTextAlignment(next.textAlignment)
    setTheme(next.theme)
    setReaderWidth(next.readerWidth)
  }

  function updateComfort(patch: Partial<ReaderComfort>) {
    const next: ReaderComfort = { fontSize, fontFamily, lineHeight, textAlignment, theme, readerWidth, ...patch }
    applyComfort(next)
    const book = readerRef.current
    if (!book) return
    if (preferenceTimer.current) clearTimeout(preferenceTimer.current)
    const selectedProfile = profileRef.current
    const activeSession = sessionRef.current
    preferenceTimer.current = setTimeout(() => {
      preferenceTimer.current = null
      const payload = {
        book_id: book.id,
        theme: next.theme === 'night' ? 'DARK' : next.theme === 'sepia' ? 'SEPIA' : 'LIGHT',
        font_family: next.fontFamily === 'sans' ? 'SANS_SERIF' : next.fontFamily === 'mono' ? 'CUSTOM' : 'SERIF',
        font_size: next.fontSize / 100,
        line_height: next.lineHeight,
        text_alignment: next.textAlignment === 'justify' ? 'JUSTIFY' : 'START',
        scroll_mode: 1,
        use_book_override: 1,
        updated_at: ms(),
      }
      void mutate(selectedProfile, 'per_book_preferences', androidRecordId('per_book_preferences', book.id), payload, false, book.source === 'local').then(() => {
        void refreshLocal(selectedProfile)
        if (activeSession && navigator.onLine && book.source !== 'local') void synchronize(activeSession, true)
      }).catch(error => setNotice(readableError(error)))
    }, 350)
  }

async function sha256Hex(file: Blob): Promise<string> {
  const buffer = await file.arrayBuffer()
  const digestBuffer = await crypto.subtle.digest('SHA-256', buffer)
  return Array.from(new Uint8Array(digestBuffer), b => b.toString(16).padStart(2, '0')).join('')
}

  async function importFile(file: File) {
    const extension = file.name.split('.').pop()?.toLowerCase() || ''
    if (!['epub', 'pdf', 'txt', 'md', 'markdown', 'html', 'htm', 'docx', 'jpg', 'jpeg', 'png', 'webp'].includes(extension)) { setNotice('Hỗ trợ EPUB, PDF, TXT, Markdown, HTML, DOCX, JPG, PNG và WebP.'); return }
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
            : extension === 'md' || extension === 'markdown' ? 'text/markdown'
            : extension === 'html' || extension === 'htm' ? 'text/html'
            : extension === 'docx' ? 'application/vnd.openxmlformats-officedocument.wordprocessingml.document'
            : extension === 'png' ? 'image/png'
            : extension === 'webp' ? 'image/webp'
            : extension === 'jpg' || extension === 'jpeg' ? 'image/jpeg'
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
            content_version: 1,
            content_hash: hash,
            is_featured: 0,
            is_new: 0,
            is_premium: 0,
            play_product_id: null,
            entitlement_type: 'FREE',
            rating: 0,
            published_date: null,
            format: extension.toUpperCase(),
            media_type: mediaType,
            source_type: 'LOCAL_FILE',
            source_url: null,
            is_in_inbox: 1,
            inbox_added_at: now,
            is_pinned: 0,
            is_archived: 0,
            reading_status: 'UNREAD',
            user_title_override: null,
            user_author_override: null,
            custom_cover_path: null,
            last_opened_at: null,
            added_at: now,
            updated_at: now,
            original_filename: file.name,
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

  async function openBook(book: Book, initialOverride?: string): Promise<boolean> {
    const targetProfile = profile
    if (progressTimer.current) clearTimeout(progressTimer.current)
    setReaderError(''); setReaderLoading(true); setLocation(null); setSelection(null)
    try {
      const [local, offlineCopy] = await Promise.all([getFile(profile, book.id), getOfflineBook(offlineProfileFor(book, profile), book.id)])
      const bytes = local ? await local.data.arrayBuffer() : offlineCopy ? await offlineCopy.data.arrayBuffer() : await loadBookBytes(book, session?.token)
      if (profileRef.current !== targetProfile) return false
      if (!bytes.byteLength) throw new Error('Tệp sách không có nội dung.')
      const savedComfort = comfortFromRecord(records.find(record => record.kind === 'per_book_preferences' && !record.deleted && record.payload.book_id === book.id), readerWidth)
      if (savedComfort) applyComfort(savedComfort)
      const initialProgress = Number(progressFor(records, book.id)?.payload.progression || 0)
      beginReadingSession(book, initialProgress)
      readerRef.current = book
      const initialLoc = initialOverride || toText(progressFor(records, book.id)?.payload.locator_json)
      locationRef.current = { locatorJson: initialLoc, progression: initialProgress, chapterTitle: '' }
      setLocation(locationRef.current)
      setReader({ book, bytes, initial: initialLoc })
      return true
    } catch (error) {
      if (profileRef.current === targetProfile) setReaderError(readableError(error))
      return false
    }
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
      void completeReadingSession(book, loc.progression)
      const payload = { book_id: book.id, locator_json: loc.locatorJson, progression: Math.max(0, Math.min(1, loc.progression)), chapter_title: loc.chapterTitle || null, last_read_at: ms(), sync_version: 1 }
      void mutate(profile, 'reading_progress', androidRecordId('reading_progress', book.id), payload, false, book.source === 'local').then(() => {
        void refreshLocal(profile)
        if (session && book.source !== 'local') void synchronize(session, true)
      })
    }
    if (reader && !loc) void completeReadingSession(reader.book, 0)
    setReader(null); readerRef.current = null; locationRef.current = null; setSelection(null); setStealthActive(false)
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
    if (existing) {
      await mutate(profile, 'bookmarks', existing.id, {}, true, reader.book.source === 'local')
      setNotice('Đã bỏ dấu trang tại vị trí này.')
    }
    else {
      const id = crypto.randomUUID()
      await mutate(profile, 'bookmarks', androidRecordId('bookmarks', id), { id, book_id: reader.book.id, locator_json: location.locatorJson, chapter_title: location.chapterTitle || '', snippet: null, created_at: ms(), sync_version: 1, is_deleted: 0 }, false, reader.book.source === 'local')
      setNotice('Đã thêm dấu trang.')
    }
    await refreshLocal(profile)
    if (session && online && reader.book.source !== 'local') void synchronize(session)
  }

  async function saveNote() {
    if (!reader || !location || (!noteText.trim() && !selection?.text)) return
    setNoteSaving(true)
    try {
      const id = crypto.randomUUID()
      const selected = selection?.text || (location.chapterTitle || 'Ghi chú tại vị trí đọc')
      const payload = { id, book_id: reader.book.id, locator_json: selection?.locator || location.locatorJson, text: selected, color: noteColor, note: noteText.trim().slice(0, 10000), created_at: ms(), updated_at: ms() }
      await mutate(profile, 'highlights', androidRecordId('highlights', id), payload, false, reader.book.source === 'local')
      await refreshLocal(profile)
      setNoteOpen(false); setNoteText(''); setSelection(null); setNotice('Đã lưu ghi chú.')
      if (session && online && reader.book.source !== 'local') void synchronize(session)
    } catch (error) { setNotice(readableError(error)) }
    finally { setNoteSaving(false) }
  }

  function exportMarkdown() {
    if (!annotations.length) return
    let md = `# NoCap - Sổ tay trích dẫn & Ghi chú\n\n*Xuất ngày: ${new Date().toLocaleDateString('vi-VN')}*\n\n---\n\n`
    const booksWithNotes = new Map<string, SyncRecord[]>()
    for (const ann of annotations) {
      const bId = ann.payload.book_id as string
      if (!booksWithNotes.has(bId)) booksWithNotes.set(bId, [])
      booksWithNotes.get(bId)!.push(ann)
    }
    for (const [bId, notes] of booksWithNotes.entries()) {
      const book = books.find(b => b.id === bId)
      md += `## 📚 ${book?.title || 'Tài liệu không tên'}\n`
      if (book?.author) md += `*Tác giả: ${book.author}*\n\n`
      for (const item of notes) {
        const text = toText(item.payload.text)
        const note = toText(item.payload.note)
        const chapter = toText(item.payload.chapter_title)
        const color = toText(item.payload.color) || 'YELLOW'
        if (text) md += `> ${text.split('\n').join('\n> ')}\n\n`
        if (note) md += `**Ghi chú [${color}]:** ${note}\n\n`
        if (chapter) md += `*Vị trí: ${chapter}*\n\n`
        md += `---\n\n`
      }
    }
    const blob = new Blob([md], { type: 'text/markdown;charset=utf-8' })
    const url = URL.createObjectURL(blob)
    const a = document.createElement('a')
    a.href = url
    a.download = `NoCap_Reading_Notes_${new Date().toISOString().slice(0, 10)}.md`
    a.click()
    URL.revokeObjectURL(url)
    setNotice('Đã xuất toàn bộ ghi chú ra tệp Markdown (.md)!')
  }

  async function startFlashcardReview() {
    const eligible = annotations.filter(r => r.kind === 'highlights')
    if (!eligible.length) {
      setNotice('Chưa có trích dẫn hoặc ghi chú nào trong mục Điều đáng nhớ để ôn tập.')
      return
    }
    try {
      const persistedReviewItems = (await localRecords(profile)).filter(item => item.kind === 'review_items' && !item.deleted)
      const existingByAnnotation = new Map(persistedReviewItems.map(item => [toText(item.payload.annotation_id), item]))
      const now = ms()
      const newlyCreated: SyncRecord[] = []
      for (const highlight of eligible) {
        const annotationId = toText(highlight.payload.id) || highlight.id
        if (existingByAnnotation.has(annotationId)) continue
        const reviewId = crypto.randomUUID()
        const payload = initialReviewItem(reviewId, annotationId, toText(highlight.payload.book_id), now)
        await mutate(profile, 'review_items', androidRecordId('review_items', reviewId), payload, false, books.find(book => book.id === highlight.payload.book_id)?.source === 'local')
        newlyCreated.push({ key: '', profile, kind: 'review_items', id: androidRecordId('review_items', reviewId), version: 0, deleted: false, payload })
        existingByAnnotation.set(annotationId, newlyCreated[newlyCreated.length - 1])
      }
      const dueAnnotations = new Set(
        [...persistedReviewItems, ...newlyCreated]
          .filter(item => reviewIsDue(item.payload as unknown as ReviewItemPayload, now))
          .map(item => toText(item.payload.annotation_id)),
      )
      const queue = eligible.filter(item => dueAnnotations.has(toText(item.payload.id) || item.id))
      await refreshLocal(profile)
      if (session && online) void synchronize(session, true)
      if (!queue.length) {
        setNotice('Hôm nay chưa có thẻ nào đến hạn ôn. Tiến độ đã được giữ cho lần tiếp theo.')
        return
      }
      const shuffled = [...queue].sort(() => Math.random() - 0.5)
      setReviewQueue(shuffled)
      setReviewIndex(0)
      setCardFlipped(false)
      setReviewStats({ mastered: 0, reviewAgain: 0 })
      setReviewOpen(true)
    } catch (error) {
      setNotice(readableError(error))
    }
  }

  async function handleFlashcardRating(rating: 'again' | 'good') {
    if (!reviewQueue.length || reviewIndex >= reviewQueue.length) return
    const currentCard = reviewQueue[reviewIndex]
    try {
      const annotationId = toText(currentCard.payload.id) || currentCard.id
      const currentRecords = await localRecords(profile)
      const existing = currentRecords.find(record => record.kind === 'review_items' && !record.deleted && record.payload.annotation_id === annotationId)
      const reviewId = existing ? toText(existing.payload.id) : crypto.randomUUID()
      const base = existing
        ? existing.payload as unknown as ReviewItemPayload
        : initialReviewItem(reviewId, annotationId, toText(currentCard.payload.book_id))
      const payload = nextReview(base, rating)
      const localOnly = books.find(book => book.id === currentCard.payload.book_id)?.source === 'local'
      await mutate(profile, 'review_items', androidRecordId('review_items', reviewId), payload, false, localOnly)
      await refreshLocal(profile)
      if (session && online && !localOnly) void synchronize(session, true)
      setCardFlipped(false)
      if (rating === 'again') {
        setReviewStats(prev => ({ ...prev, reviewAgain: prev.reviewAgain + 1 }))
        setReviewQueue(prev => [...prev, currentCard])
        setReviewIndex(prev => prev + 1)
      } else {
        setReviewStats(prev => ({ ...prev, mastered: prev.mastered + 1 }))
        setReviewIndex(prev => prev + 1)
      }
    } catch (error) {
      setNotice(readableError(error))
    }
  }

  async function deleteBook(book: Book) {
    if (!window.confirm(`Xóa “${book.title}” khỏi thư viện?`)) return
    if (book.source === 'local') {
      await removeLocalDocument(profile, book.id)
    } else if (book.source === 'cloud') {
      await removeOfflineBook(offlineProfileFor(book, profile), book.id)
      await mutate(profile, 'catalog_books', androidRecordId('catalog_books', book.id), {}, true)
      if (session && online) void synchronize(session)
    }
    await refreshLocal(profile)
    setNotice('Đã xóa tài liệu.')
  }

  const nav: Array<{ id: Page; label: string; icon: typeof BookOpen }> = [
    { id: 'home', label: curT.nav.home, icon: BookOpen },
    { id: 'catalog', label: curT.nav.catalog, icon: Search },
    { id: 'library', label: curT.nav.library, icon: Library },
    { id: 'memory', label: curT.nav.memory, icon: Highlighter },
    { id: 'stats', label: curT.nav.stats, icon: BarChart3 },
    { id: 'account', label: curT.nav.account, icon: Settings2 },
  ]

  return <div className="app-shell">
    <div className="analog-grain-overlay" aria-hidden="true" />
    <OceanWaves />
    <aside className={`sidebar ${sidebarOpen ? 'open' : ''}`}>
      <div className="brand"><div className="brand-mark"><BookOpen size={24} /></div><div><strong>NoCap</strong><span>Quiet Knowledge Workspace</span></div><button className="mobile-close icon-button" onClick={() => setSidebarOpen(false)} aria-label="Đóng menu"><X size={20} /></button></div>
      <div className="sidebar-caption">{curT.nav.mySpace}</div>
      <nav className="main-nav" aria-label="Điều hướng">
        {nav.map(item => <button key={item.id} className={page === item.id ? 'active' : ''} onClick={() => { setPage(item.id); setSidebarOpen(false); setQuery(''); setCategory('all') }}><item.icon size={19} /><span>{item.label}</span></button>)}
      </nav>
      <div className="sidebar-bottom"><div className="sync-summary">{online ? <Cloud size={17} /> : <CloudOff size={17} />}<div><strong>{!session ? curT.nav.guestMode : syncing ? curT.nav.syncing : pendingCount ? curT.nav.pendingShort : curT.nav.autoSyncOn}</strong><small>{session ? (pendingCount ? `${pendingCount} ${curT.nav.pending}` : session.user.email) : curT.nav.loginPrompt}</small></div></div>{session ? <button className="secondary wide" onClick={() => void synchronize(session)} disabled={syncing}><RotateCw size={16} className={syncing ? 'spin' : ''} /> {curT.nav.syncNow}</button> : <button className="primary wide" onClick={() => setAuthOpen(true)}><LogIn size={16} /> {curT.nav.login}</button>}</div>
    </aside>
    {sidebarOpen && <button className="sidebar-shade" aria-label="Đóng menu" onClick={() => setSidebarOpen(false)} />}

    <main className="main-area">
      <header className="swiss-header">
        <div className="swiss-header-brand" onClick={() => { setPage('home'); setQuery(''); setCategory('all') }}>
          <div className="swiss-header-logo">
            NOCAP <span>QUIET WORKSPACE</span>
          </div>
        </div>
        <nav className="swiss-header-nav" aria-label="Menu chính">
          <button className={`swiss-nav-link ${page === 'home' ? 'active' : ''}`} onClick={() => { setPage('home'); setQuery(''); setCategory('all') }}>{curT.nav.home}</button>
          <button className={`swiss-nav-link ${page === 'catalog' ? 'active' : ''}`} onClick={() => { setPage('catalog'); setQuery(''); setCategory('all') }}>{curT.nav.catalog}</button>
          <button className={`swiss-nav-link ${page === 'library' ? 'active' : ''}`} onClick={() => { setPage('library'); setQuery(''); setCategory('all') }}>{curT.nav.library}</button>
          <button className={`swiss-nav-link ${page === 'memory' ? 'active' : ''}`} onClick={() => { setPage('memory'); setQuery(''); setCategory('all') }}>{curT.nav.memory}</button>
          <button className={`swiss-nav-link ${page === 'stats' ? 'active' : ''}`} onClick={() => { setPage('stats'); setQuery(''); setCategory('all') }}>{curT.nav.stats}</button>
          <button className={`swiss-nav-link ${page === 'account' ? 'active' : ''}`} onClick={() => { setPage('account'); setQuery(''); setCategory('all') }}>{curT.nav.account}</button>
        </nav>
        <div className="swiss-header-actions">
          <button
            className="swiss-lang-toggle"
            onClick={toggleLang}
            title={curT.header.langTooltip}
            aria-label="Switch Language"
          >
            <Globe size={14} />
            <span className="swiss-lang-current">{lang.toUpperCase()}</span>
            <span style={{ opacity: 0.35 }}>|</span>
            <span style={{ fontSize: '11px', opacity: 0.65 }}>{lang === 'vi' ? 'EN' : 'VI'}</span>
          </button>
          <span className={`swiss-status-dot ${online ? '' : 'offline'}`}>{online ? curT.header.online : curT.header.offline}</span>
          {session ? (
            <button className="swiss-pill-btn" onClick={() => void synchronize(session)} disabled={syncing}>
              <RotateCw size={13} className={syncing ? 'spin' : ''} /> {syncing ? curT.header.syncing : curT.header.sync}
            </button>
          ) : (
            <button className="swiss-pill-btn" onClick={() => setAuthOpen(true)}>
              <LogIn size={13} /> {curT.header.login}
            </button>
          )}
          <button className="profile-button" onClick={() => session ? setPage('account') : setAuthOpen(true)} aria-label="Tài khoản">
            {session?.user.displayName?.slice(0, 1).toUpperCase() || session?.user.email.slice(0, 1).toUpperCase() || 'G'}
          </button>
          <button className="mobile-menu icon-button" onClick={() => setSidebarOpen(true)} aria-label="Mở menu"><Menu size={22} /></button>
        </div>
      </header>

      {page === 'home' && <>
        <section className="swiss-hero">
          <div className="editorial-eyebrow">
            <span className="editorial-eyebrow-dot" />
            <span>SWISS EDITORIAL & QUIET WORKSPACE</span>
          </div>
          <div className="swiss-hero-echo-container">
            <div className="swiss-hero-echo-text" aria-label="NOCAP">
              <span className="swiss-hero-echo-layer swiss-echo-4">NOCAP</span>
              <span className="swiss-hero-echo-layer swiss-echo-3">NOCAP</span>
              <span className="swiss-hero-echo-layer swiss-echo-2">NOCAP</span>
              <span className="swiss-hero-echo-layer swiss-echo-1">NOCAP</span>
              <span className="swiss-hero-echo-layer swiss-echo-fore">NOCAP</span>
            </div>
          </div>
          <p className="swiss-hero-sub">
            {curT.hero.sub}
          </p>
          <div className="swiss-hero-actions">
            <button className="pill-btn primary-pill" onClick={() => setPage('catalog')}>
              {curT.hero.exploreBtn} <ArrowRight size={16} />
            </button>
            <button className="pill-btn invert-pill" onClick={() => fileInput.current?.click()}>
              <Plus size={16} /> {curT.banners.library.addDoc}
            </button>
          </div>
          <div className="editorial-pills-row" style={{ justifyContent: 'center' }}>
            <span className="editorial-chip sage">{curT.hero.pills[0]}</span>
            <span className="editorial-chip starry-sky">{curT.hero.pills[1]}</span>
            <span className="editorial-chip peach">{curT.hero.pills[2]}</span>
          </div>
        </section>

        <section className="swiss-philosophy-section">
          <div className="swiss-hairline-v" />
          <h2 className="swiss-philosophy-quote">
            {curT.philosophy.quotePart1} <em>{curT.philosophy.quoteEm}</em> {curT.philosophy.quotePart2}
          </h2>
          <p className="swiss-philosophy-sub">{curT.philosophy.hairline}</p>

          <div className="swiss-bespoke-grid">
            <div className="swiss-bespoke-card">
              <div className="swiss-icon-box-64"><BookOpen size={26} /></div>
              <h3>{curT.philosophy.card1Title}</h3>
              <p>{curT.philosophy.card1Desc}</p>
              <button className="swiss-bespoke-cta" onClick={() => setPage('catalog')}>{curT.philosophy.card1Cta} <ArrowRight size={14} /></button>
            </div>
            <div className="swiss-bespoke-card">
              <div className="swiss-icon-box-64"><Sparkles size={26} /></div>
              <h3>{curT.philosophy.card2Title}</h3>
              <p>{curT.philosophy.card2Desc}</p>
              <button className="swiss-bespoke-cta" onClick={() => setPage('memory')}>{curT.philosophy.card2Cta} <ArrowRight size={14} /></button>
            </div>
            <div className="swiss-bespoke-card">
              <div className="swiss-icon-box-64"><Cloud size={26} /></div>
              <h3>{curT.philosophy.card3Title}</h3>
              <p>{curT.philosophy.card3Desc}</p>
              <button className="swiss-bespoke-cta" onClick={() => setPage('account')}>{curT.philosophy.card3Cta} <ArrowRight size={14} /></button>
            </div>
          </div>
        </section>

        <section className="swiss-showcase-section">
          <div className="swiss-showcase-header">
            <div>
              <h2>{curT.showcase.title}</h2>
              <p>{curT.showcase.sub}</p>
            </div>
            <button className="text-button" onClick={() => setPage('library')}>{curT.showcase.viewAll} <ArrowRight size={14} /></button>
          </div>

          <div className="swiss-asym-grid">
            <div className="asym-card-8">
              <div>
                <span className="editorial-chip sage" style={{ marginBottom: '16px' }}>{curT.showcase.journeyChip}</span>
                <h3 style={{ fontFamily: "'Plus Jakarta Sans', 'Be Vietnam Pro', sans-serif", fontSize: '26px', margin: '14px 0 8px', letterSpacing: '-0.01em' }}>
                  {reading[0]?.title || curT.showcase.defaultTitle}
                </h3>
                <p style={{ color: '#78716c', fontSize: '14px', maxWidth: '520px', lineHeight: '1.6' }}>
                  {reading[0] ? curT.showcase.readingDesc(reading[0].author || (lang === 'vi' ? 'Tác giả' : 'Author'), Math.round((Number(progressFor(records, reading[0].id)?.payload.progression || 0)) * 100)) : curT.showcase.defaultDesc}
                </p>
              </div>
              <div style={{ display: 'flex', gap: '14px', alignItems: 'center', marginTop: '24px' }}>
                {reading[0] ? (
                  <button className="pill-btn primary-pill" onClick={() => void openBook(reading[0])}>
                    {curT.showcase.continueReading} <ArrowRight size={16} />
                  </button>
                ) : (
                  <button className="pill-btn primary-pill" onClick={() => setPage('catalog')}>
                    {curT.showcase.pickBook} <ArrowRight size={16} />
                  </button>
                )}
                <button className="pill-btn invert-pill" onClick={() => setPage('library')}>
                  {curT.showcase.openShelf}
                </button>
              </div>
            </div>

            <div className="asym-card-pill-4" onClick={() => setPage('catalog')} title={curT.showcase.explorePill}>
              <div className="asym-pill-art">
                <div className="asym-pill-circle-glow" />
                <div className="asym-pill-icon-wrap">
                  <BookOpen size={44} strokeWidth={1.5} />
                </div>
                <div className="asym-pill-caption">
                  <span className="asym-pill-tag">{curT.showcase.editionBadge}</span>
                  <strong>NOCAP</strong>
                  <small>QUIET KNOWLEDGE</small>
                </div>
              </div>
              <div className="asym-pill-overlay">
                <div className="asym-pill-badge">
                  {curT.showcase.explorePill}
                </div>
              </div>
            </div>

            <div className="asym-card-circle-5">
              <span className="editorial-chip peach" style={{ marginBottom: '10px' }}>{curT.showcase.habitChip}</span>
              <div style={{ fontFamily: "'Plus Jakarta Sans', 'Be Vietnam Pro', sans-serif", fontSize: '44px', fontWeight: '800', lineHeight: '1', margin: '8px 0', color: '#111111' }}>
                {readingDayCount > 0 ? `${readingDayCount}D` : '15M'}
              </div>
              <p style={{ fontSize: '12px', color: '#78716c', maxWidth: '180px', margin: '4px 0 12px' }}>
                {readingDayCount > 0 ? curT.showcase.habitDesc : curT.showcase.habitDescEmpty}
              </p>
              <button className="text-button" onClick={() => setPage('stats')}>{curT.showcase.viewAnalytics} <ArrowRight size={12} /></button>
            </div>

            <div className="asym-card-wide-7">
              <div>
                <span className="editorial-chip lavender" style={{ marginBottom: '14px' }}>{curT.showcase.notesChip}</span>
                <h4 style={{ fontFamily: 'Literata Variable, serif', fontSize: '18px', fontStyle: 'italic', fontWeight: '500', color: '#111111', margin: '12px 0 8px', lineHeight: '1.5' }}>
                  {toText(annotations[0]?.payload.text) ? `“${toText(annotations[0]?.payload.text).slice(0, 110)}...”` : curT.showcase.defaultQuote}
                </h4>
                <p style={{ fontSize: '12px', color: '#838282' }}>
                  {curT.showcase.notesSaved(annotations.length)}
                </p>
              </div>
              <div style={{ display: 'flex', gap: '12px', marginTop: '16px' }}>
                {annotations.length > 0 ? (
                  <button className="pill-btn invert-pill" onClick={() => void startFlashcardReview()}>
                    <Sparkles size={14} /> {curT.showcase.reviewNow}
                  </button>
                ) : (
                  <button className="pill-btn invert-pill" onClick={() => setPage('catalog')}>
                    {curT.showcase.allNotes}
                  </button>
                )}
              </div>
            </div>
          </div>
        </section>
      </>}

      <div className="content">
        {notice && <div className="notice" role="status"><span>{notice}</span><button onClick={() => setNotice('')} aria-label="Đóng thông báo"><X size={17} /></button></div>}
        {page === 'home' && <>
          <SectionHeader title={lang === 'vi' ? 'Đọc tiếp gần đây' : 'Continue Reading'} action={curT.showcase.viewAll} onAction={() => setPage('library')} />
          {reading.length ? <div className="book-grid">{reading.slice(0, 4).map(book => <BookCard key={book.id} book={book} lang={lang} progress={Number(progressFor(records, book.id)?.payload.progression || 0)} onOpen={() => void openBook(book)} onStealth={() => void openBook(book).then(ok => { if (ok) setStealthActive(true) })} onDetails={() => setSelectedBook(book)} onFavorite={() => void toggleFavorite(book)} favorite={favorites.has(book.id)} offline={book.source === 'local' || offlineIds.has(book.id)} offlineBusy={offlineBusy === book.id} onOffline={book.source !== 'local' && book.fileUrl ? () => void toggleOffline(book) : undefined} />)}</div> : <div className="empty-state"><BookOpen size={30} /><h3>{lang === 'vi' ? 'Hành trình đọc bắt đầu ở đây' : 'Your reading journey begins here'}</h3><p>{lang === 'vi' ? 'Chọn một cuốn sách hoặc thêm tài liệu của bạn để bắt đầu.' : 'Pick a book or import your own document to begin.'}</p><button className="secondary" onClick={() => setPage('catalog')}>{curT.hero.exploreBtn}</button></div>}
          <SectionHeader title={lang === 'vi' ? 'Gợi ý cho bạn' : 'Recommended for You'} action={lang === 'vi' ? 'Xem tất cả' : 'View all'} onAction={() => setPage('catalog')} />
          <div className="book-grid">{catalog.filter(book => book.fileUrl).slice(0, 4).map(book => <BookCard key={book.id} book={book} lang={lang} onOpen={() => void openBook(book)} onStealth={() => void openBook(book).then(ok => { if (ok) setStealthActive(true) })} onDetails={() => setSelectedBook(book)} onFavorite={() => void toggleFavorite(book)} favorite={favorites.has(book.id)} offline={offlineIds.has(book.id)} offlineBusy={offlineBusy === book.id} onOffline={() => void toggleOffline(book)} />)}</div>
        </>}

        {(page === 'catalog' || page === 'library') && <>
          <div className="inner-page-banner">
            <div className="banner-text">
              <div className="banner-eyebrow">{page === 'catalog' ? curT.banners.catalog.eyebrow : curT.banners.library.eyebrow}</div>
              <h2>{page === 'catalog' ? curT.banners.catalog.title : curT.banners.library.title}</h2>
              <p>{page === 'catalog' ? curT.banners.catalog.desc : curT.banners.library.desc}</p>
            </div>
            <div className="banner-action">
              <button className="light-button" onClick={() => fileInput.current?.click()}><Plus size={16} /> {curT.banners.catalog.addDoc}</button>
            </div>
          </div>
          {page === 'library' && (
            <div className="shelf-chips" role="tablist" aria-label="Bộ lọc tủ sách">
              <button className={`shelf-chip ${shelfFilter === 'all' ? 'active' : ''}`} onClick={() => setShelfFilter('all')}>{curT.libraryTabs.all} ({libraryBooks.length})</button>
              <button className={`shelf-chip ${shelfFilter === 'reading' ? 'active' : ''}`} onClick={() => setShelfFilter('reading')}><BookOpen size={14} /> {curT.libraryTabs.reading}</button>
              <button className={`shelf-chip ${shelfFilter === 'favorites' ? 'active' : ''}`} onClick={() => setShelfFilter('favorites')}><BookMarked size={14} /> {curT.libraryTabs.favorites} ({favorites.size})</button>
              <button className={`shelf-chip ${shelfFilter === 'completed' ? 'active' : ''}`} onClick={() => setShelfFilter('completed')}><CheckCircle2 size={14} /> {curT.libraryTabs.completed}</button>
              <button className={`shelf-chip ${shelfFilter === 'offline' ? 'active' : ''}`} onClick={() => setShelfFilter('offline')}><Download size={14} /> {curT.libraryTabs.offline} ({offlineIds.size})</button>
              <button className={`shelf-chip ${shelfFilter === 'local' ? 'active' : ''}`} onClick={() => setShelfFilter('local')}><Layers size={14} /> {curT.libraryTabs.local}</button>
            </div>
          )}
          <div className="filter-bar"><label className="search-field"><Search size={18} /><input value={query} onChange={event => setQuery(event.target.value)} placeholder={curT.filters.searchPlaceholder} aria-label="Tìm sách" /></label><select value={category} onChange={event => setCategory(event.target.value)} aria-label="Lọc thể loại"><option value="all">{curT.filters.allCategories}</option>{categories.map(item => <option key={item.id} value={item.id}>{item.name}</option>)}</select><select value={sortOrder} onChange={e => setSortOrder(e.target.value as 'recent' | 'title' | 'progress')} aria-label="Sắp xếp sách"><option value="recent">{curT.filters.recent}</option><option value="title">{curT.filters.title}</option><option value="progress">{curT.filters.progress}</option></select>{page === 'library' && (tags.length > 0 || collections.length > 0) && <select value={organizationFilter} onChange={event => setOrganizationFilter(event.target.value)} aria-label="Lọc theo thẻ hoặc bộ sưu tập"><option value="all">{curT.filters.allTagsAndCollections}</option>{tags.length > 0 && <optgroup label={curT.filters.tagsGroup}>{tags.map(tag => <option key={`tag:${tag.id}`} value={`tag:${tag.id}`}>{tag.name}</option>)}</optgroup>}{collections.length > 0 && <optgroup label={curT.filters.collectionsGroup}>{collections.map(collection => <option key={`collection:${collection.id}`} value={`collection:${collection.id}`}>{collection.name}</option>)}</optgroup>}</select>}<span>{curT.filters.docCount(filteredBooks.length)}</span></div>
          {filteredBooks.length ? <div className="book-grid">{filteredBooks.map(book => <BookCard key={book.id} book={book} lang={lang} progress={Number(progressFor(records, book.id)?.payload.progression || 0)} onOpen={() => void openBook(book)} onStealth={() => void openBook(book).then(ok => { if (ok) setStealthActive(true) })} onDetails={() => setSelectedBook(book)} onFavorite={book.source === 'local' ? undefined : () => void toggleFavorite(book)} favorite={favorites.has(book.id)} onDelete={book.source === 'local' || book.source === 'cloud' ? () => void deleteBook(book) : undefined} offline={book.source === 'local' || offlineIds.has(book.id)} offlineBusy={offlineBusy === book.id} onOffline={book.source !== 'local' && book.fileUrl ? () => void toggleOffline(book) : undefined} />)}</div> : <div className="empty-state"><Library size={30} /><h3>{curT.filters.emptyTitle}</h3><p>{curT.filters.emptyDesc}</p><button className="secondary" onClick={() => { setQuery(''); setCategory('all'); setShelfFilter('all'); setOrganizationFilter('all') }}>{curT.filters.clearFilter}</button></div>}
        </>}

        {page === 'memory' && <><div className="inner-page-banner">
            <div className="banner-text">
              <div className="banner-eyebrow">{curT.banners.memory.eyebrow}</div>
              <h2>{curT.banners.memory.title}</h2>
              <p>{curT.banners.memory.desc}</p>
            </div>
            <div className="banner-action" style={{ display: 'flex', gap: '10px', flexWrap: 'wrap' }}>
              <div className="count-chip" style={{ background: 'rgba(255,255,255,0.08)', color: '#c8d8f8', border: '1px solid rgba(100,140,255,0.2)' }}>{curT.banners.memory.statsSnippet(annotations.length, dueReviewCount)}</div>
              {annotations.length > 0 && <><button className="light-button" onClick={() => void startFlashcardReview()}><Sparkles size={15} /> {curT.banners.memory.reviewBtn}</button><button className="light-button" onClick={exportMarkdown}><FileDown size={15} /> {curT.banners.memory.exportBtn}</button></>}
            </div>
          </div><label className="search-field memory-search"><Search size={18} /><input value={query} onChange={event => setQuery(event.target.value)} placeholder={curT.memoryPage.searchPlaceholder} aria-label="Tìm ghi chú" /></label>{annotations.filter(record => `${record.payload.text || ''} ${record.payload.note || ''} ${record.payload.chapter_title || ''}`.toLocaleLowerCase().includes(query.toLocaleLowerCase())).length ? <div className="memory-list">{annotations.filter(record => `${record.payload.text || ''} ${record.payload.note || ''} ${record.payload.chapter_title || ''}`.toLocaleLowerCase().includes(query.toLocaleLowerCase())).map(record => { const book = books.find(item => item.id === record.payload.book_id); return <div className="memory-item" key={record.key}><div className="memory-icon">{record.kind === 'highlights' ? <Highlighter size={18} /> : <Bookmark size={18} />}</div><div><div className="memory-book">{book?.title || curT.memoryPage.privateDoc}</div><blockquote>{toText(record.payload.text) || toText(record.payload.chapter_title) || curT.memoryPage.bookmarkFallback}</blockquote>{!!record.payload.note && <p>{toText(record.payload.note)}</p>}</div>{book && <button className="text-button" onClick={() => void openBook(book, toText(record.payload.locator_json))}>{curT.memoryPage.openBook} <ArrowRight size={15} /></button>}</div> })}</div> : <div className="empty-state"><Highlighter size={30} /><h3>{curT.memoryPage.emptyTitle}</h3><p>{curT.memoryPage.emptyDesc}</p><button className="secondary" onClick={() => setPage('catalog')}>{curT.memoryPage.findBook}</button></div>}</>}

        {page === 'stats' && <>
          <div className="inner-page-banner">
            <div className="banner-text">
              <div className="banner-eyebrow">{curT.banners.stats.eyebrow}</div>
              <h2>{curT.banners.stats.title}</h2>
              <p>{curT.banners.stats.desc}</p>
            </div>
          </div>
          <div className="stats-summary-grid">
            <div className="stat-widget"><div className="stat-icon-wrap"><Library size={22} /></div><div className="stat-content"><div className="stat-value">{libraryBooks.length}</div><div className="stat-title">{curT.statsPage.inShelf}</div></div></div>
            <div className="stat-widget"><div className="stat-icon-wrap orange"><BookOpen size={22} /></div><div className="stat-content"><div className="stat-value">{reading.filter(b => (Number(progressFor(records, b.id)?.payload.progression || 0)) < 0.99).length}</div><div className="stat-title">{curT.statsPage.reading}</div></div></div>
            <div className="stat-widget"><div className="stat-icon-wrap purple"><Highlighter size={22} /></div><div className="stat-content"><div className="stat-value">{annotations.length}</div><div className="stat-title">{curT.statsPage.notesAndQuotes}</div></div></div>
            <div className="stat-widget"><div className="stat-icon-wrap blue"><Award size={22} /></div><div className="stat-content"><div className="stat-value">{reading.filter(b => (Number(progressFor(records, b.id)?.payload.progression || 0)) >= 0.99).length}</div><div className="stat-title">{curT.statsPage.completed}</div></div></div><div className="stat-widget"><div className="stat-icon-wrap orange"><Flame size={22} /></div><div className="stat-content"><div className="stat-value">{totalReadingMinutes} {curT.statsPage.minutesUnit}</div><div className="stat-title">{curT.statsPage.readingTime}</div></div></div><div className="stat-widget"><div className="stat-icon-wrap blue"><BarChart3 size={22} /></div><div className="stat-content"><div className="stat-value">{readingDayCount}</div><div className="stat-title">{curT.statsPage.activeDays}</div></div></div>
          </div>
          <div className="stats-section-row">
            <div className="stats-panel">
              <h2>{curT.statsPage.activeJourney}</h2>
              {reading.length ? <div className="active-reading-list">{reading.map(book => {
                const prog = Math.round((Number(progressFor(records, book.id)?.payload.progression || 0)) * 100)
                return <div className="active-reading-item" key={book.id}><button className="cover-button" onClick={() => void openBook(book)} aria-label={`Mở ${book.title}`}><div className="book-cover">{book.coverUrl ? <img src={book.coverUrl} alt="" loading="lazy" onError={e => { e.currentTarget.style.display = 'none' }} /> : null}<div className="cover-fallback"><BookOpen size={20} /></div></div></button><div className="active-reading-details"><div className="active-reading-title">{book.title}</div><div className="active-reading-author">{book.author || curT.statsPage.unknownAuthor} · {prog}% {curT.statsPage.progressSuffix}</div><div className="progress-bar"><span style={{ width: `${Math.max(4, prog)}%` }} /></div></div><button className="secondary" onClick={() => void openBook(book)}>{curT.statsPage.readContinue} <ArrowRight size={14} /></button></div>
              })}</div> : <p className="muted">{curT.statsPage.noBooksYet}</p>}
            </div>
            <div className="streak-box">
              <div className="streak-flame"><Flame size={28} /></div>
              <div className="streak-num">{readingDayCount > 0 ? curT.statsPage.streakDays(readingDayCount) : curT.statsPage.startNow}</div>
              <p className="eyebrow" style={{ color: '#ffbe76', margin: '8px 0 4px' }}>{curT.statsPage.habitStreak}</p>
              <div className="streak-desc">{reading.length > 0 ? curT.statsPage.streakActive(reading.length, annotations.length) : curT.statsPage.streakEmpty}</div>
              {annotations.length > 0 && <button className="light-button" style={{ marginTop: '16px' }} onClick={() => void startFlashcardReview()}><Sparkles size={16} /> {curT.statsPage.reviewToday}</button>}
            </div>
          </div>
        </>}

        {page === 'account' && <><div className="inner-page-banner">
            <div className="banner-text">
              <div className="banner-eyebrow">{curT.banners.account.eyebrow}</div>
              <h2>{session ? curT.banners.account.titleUser : curT.banners.account.titleGuest}</h2>
              <p>{session ? curT.banners.account.descUser : curT.banners.account.descGuest}</p>
            </div>
            {!session && <div className="banner-action"><button className="light-button" onClick={() => setAuthOpen(true)}>{curT.banners.account.loginNow}</button></div>}
          </div><div className="settings-grid"><section className="settings-card"><h2>{curT.accountPage.accountHeading}</h2>{session ? <><p className="account-email">{session.user.displayName || session.user.email}</p><p className="muted">{session.user.email}</p>{!session.user.emailVerified && <p className="warning-text">{curT.accountPage.unverifiedWarning}</p>}<p className="muted">{curT.accountPage.currentPlan} <strong>{entitlement?.plan || 'FREE'}</strong>{entitlement?.plan === 'PRO' && entitlement.expiresAt ? ` · ${curT.accountPage.validUntil(new Date(entitlement.expiresAt).toLocaleDateString(lang === 'vi' ? 'vi-VN' : 'en-US'))}` : ''}</p><button className="secondary" onClick={() => void signOut()}><LogOut size={17} /> {curT.accountPage.logout}</button></> : <><p className="muted">{curT.accountPage.loginPrompt}</p><button className="primary" onClick={() => setAuthOpen(true)}>{curT.accountPage.loginRegister}</button></>}</section><section className="settings-card"><h2>{curT.accountPage.autoSyncHeading}</h2><p>{online ? curT.accountPage.connectedCloud : curT.accountPage.offline}</p><p className="muted">{session ? (pendingCount ? curT.accountPage.pendingSync(pendingCount) : curT.accountPage.syncInfo) : curT.accountPage.guestSyncInfo}</p>{session && <button className="secondary" onClick={() => void synchronize(session)} disabled={syncing}><RotateCw size={17} className={syncing ? 'spin' : ''} /> {syncing ? curT.accountPage.syncing : curT.accountPage.syncNow}</button>}</section><section className="settings-card"><h2>{curT.accountPage.comfortHeading}</h2><label className="range-label">{curT.accountPage.fontSize} <strong>{fontSize}%</strong><input type="range" min="80" max="170" step="10" value={fontSize} onChange={event => updateComfort({ fontSize: Number(event.target.value) })} /></label><div className="setting-group" style={{ margin: '14px 0 10px' }}><span className="setting-label">{curT.accountPage.typeface}</span><div className="toggle-row"><button className={`choice-chip ${fontFamily === 'serif' ? 'active' : ''}`} onClick={() => updateComfort({ fontFamily: 'serif' })}>{curT.accountPage.serifChoice}</button><button className={`choice-chip ${fontFamily === 'sans' ? 'active' : ''}`} onClick={() => updateComfort({ fontFamily: 'sans' })}>{curT.accountPage.sansChoice}</button><button className={`choice-chip ${fontFamily === 'mono' ? 'active' : ''}`} onClick={() => updateComfort({ fontFamily: 'mono' })}>{curT.accountPage.monoChoice}</button></div></div><div className="setting-group" style={{ margin: '14px 0 10px' }}><span className="setting-label">{curT.accountPage.align}</span><div className="toggle-row"><button className={`choice-chip ${textAlignment === 'left' ? 'active' : ''}`} onClick={() => updateComfort({ textAlignment: 'left' })}><AlignLeft size={14} /> {curT.accountPage.alignLeft}</button><button className={`choice-chip ${textAlignment === 'justify' ? 'active' : ''}`} onClick={() => updateComfort({ textAlignment: 'justify' })}><AlignJustify size={14} /> {curT.accountPage.alignJustify}</button></div></div><div className="setting-group" style={{ margin: '14px 0 10px' }}><span className="setting-label">{curT.accountPage.theme}</span><div className="theme-row">{(['paper', 'sepia', 'night'] as const).map(value => <button key={value} className={`theme-chip ${value} ${theme === value ? 'chosen' : ''}`} onClick={() => updateComfort({ theme: value })}>{value === 'paper' ? curT.accountPage.themePaper : value === 'sepia' ? curT.accountPage.themeSepia : curT.accountPage.themeNight}</button>)}</div></div></section></div></>}
      </div>

      <footer className="swiss-footer">
        <div className="swiss-footer-container">
          <div className="swiss-footer-grid">
            <div>
              <h4>NOCAP</h4>
              <p>{curT.footer.brandDesc}</p>
              <p style={{ fontSize: '12px', color: '#838282' }}>{curT.footer.pwaNote}</p>
            </div>
            <div>
              <h4>{curT.footer.navHeading}</h4>
              <ul className="swiss-footer-links">
                <li><button onClick={() => { setPage('home'); window.scrollTo({ top: 0, behavior: 'smooth' }) }}>{curT.nav.home}</button></li>
                <li><button onClick={() => { setPage('catalog'); window.scrollTo({ top: 0, behavior: 'smooth' }) }}>{curT.nav.catalog}</button></li>
                <li><button onClick={() => { setPage('library'); window.scrollTo({ top: 0, behavior: 'smooth' }) }}>{curT.nav.library}</button></li>
                <li><button onClick={() => { setPage('memory'); window.scrollTo({ top: 0, behavior: 'smooth' }) }}>{curT.nav.memory}</button></li>
                <li><button onClick={() => { setPage('stats'); window.scrollTo({ top: 0, behavior: 'smooth' }) }}>{curT.nav.stats}</button></li>
              </ul>
            </div>
            <div>
              <h4>{curT.footer.archHeading}</h4>
              <ul className="swiss-footer-links">
                <li><button onClick={() => { setPage('account'); window.scrollTo({ top: 0, behavior: 'smooth' }) }}>{curT.footer.archSync}</button></li>
                <li><button onClick={() => void startFlashcardReview()}>{curT.philosophy.card2Title}</button></li>
                <li><button onClick={exportMarkdown}>{curT.banners.memory.exportBtn}</button></li>
                <li><button onClick={() => fileInput.current?.click()}>{curT.banners.catalog.addDoc}</button></li>
              </ul>
            </div>
            <div>
              <h4>{curT.footer.connectHeading}</h4>
              <p>{online ? (lang === 'vi' ? 'Trạng thái: Trực tuyến Cloud' : 'Status: Online Cloud') : (lang === 'vi' ? 'Trạng thái: Ngoại tuyến' : 'Status: Offline')}</p>
              <p>{session ? `${lang === 'vi' ? 'Tài khoản' : 'Account'}: ${session.user.email}` : (lang === 'vi' ? 'Chế độ khách — lưu cục bộ trên trình duyệt' : 'Guest mode — stored locally')}</p>
              {!session && (
                <button className="swiss-pill-btn" style={{ borderColor: 'rgba(255,255,255,0.3)', color: '#fff', marginTop: '8px' }} onClick={() => setAuthOpen(true)}>
                  {curT.header.login}
                </button>
              )}
            </div>
          </div>
          <div className="swiss-footer-bottom">
            <span>{curT.footer.copyright}</span>
            <span>{curT.footer.architectureTag}</span>
          </div>
        </div>
      </footer>

      <input ref={fileInput} type="file" accept=".epub,.pdf,.txt,.md,.markdown,.html,.htm,.docx,.jpg,.jpeg,.png,.webp" hidden onChange={event => { const file = event.target.files?.[0]; if (file) void importFile(file); event.target.value = '' }} />
    </main>

    {(readerLoading || readerError) && <div className="overlay"><div className="loading-card"><button className="icon-button close-floating" onClick={() => { setReaderLoading(false); setReaderError('') }} aria-label="Đóng"><X size={20} /></button>{readerLoading ? <><div className="loader" /><h2>Đang mở sách…</h2><p>Đang chuẩn bị nội dung để đọc.</p></> : <><FileText size={32} /><h2>Chưa mở được tài liệu</h2><p>{readerError}</p><button className="primary" onClick={() => setReaderError('')}>Thử lại sau</button></>}</div></div>}

    {reader && <div className={`reader-shell ${theme}`}><div className="reader-topbar"><button className="reader-back reader-home-btn" onClick={() => { closeReader(); setPage('home'); window.scrollTo({ top: 0, behavior: 'smooth' }); }} aria-label={lang === 'vi' ? 'Trở về Trang chủ' : 'Home'} title={lang === 'vi' ? 'Trở về Trang chủ (Esc)' : 'Home (Esc)'}><Home size={18} /> <span>{lang === 'vi' ? 'Trang chủ' : 'Home'}</span></button><button className="reader-back" onClick={closeReader} aria-label="Quay lại tủ sách"><ArrowLeft size={19} /> <span>{lang === 'vi' ? 'Tủ sách' : 'Library'}</span></button><div className="reader-title"><strong>{reader.book.title}</strong><small>{bookLabel(reader.book)}</small></div><div className="reader-actions"><button className="stealth-topbar-pill" title={curT.stealth.btnTitle} aria-label={curT.stealth.btnLabel} onClick={() => setStealthActive(true)}><Briefcase size={15} /> <span>{lang === 'vi' ? 'Đọc ẩn (F2)' : 'Stealth (F2)'}</span></button><button className="icon-button" title="Mục lục sách" aria-label="Mục lục" onClick={() => setTocOpen(true)}><List size={20} /></button><button className="icon-button" title="Tùy chỉnh đọc & font" aria-label="Tùy chỉnh" onClick={() => setSettingsOpen(true)}><Type size={20} /></button><button className={`icon-button ${currentBookmarked ? 'active' : ''}`} title={currentBookmarked ? 'Bỏ dấu trang' : 'Thêm dấu trang'} aria-label={currentBookmarked ? 'Bỏ dấu trang' : 'Đánh dấu vị trí'} aria-pressed={currentBookmarked} onClick={() => void toggleBookmark()}><Bookmark size={20} fill={currentBookmarked ? 'currentColor' : 'none'} /></button><button className="icon-button" title="Ghi chú" aria-label="Thêm ghi chú" onClick={() => { setNoteText(''); setNoteOpen(true) }}><Highlighter size={20} /></button></div></div><div className="reader-body"><ReaderPane book={reader.book} bytes={reader.bytes} initial={reader.initial} fontSize={fontSize} fontFamily={fontFamily} lineHeight={lineHeight} textAlignment={textAlignment} readerWidth={readerWidth} theme={theme} onLocation={onLocation} onSelection={(text, locator) => setSelection({ text, locator })} onControls={setControls} onToc={setToc} navigateTarget={navigateTarget} annotations={readerAnnotations} /></div><div className="reader-footer"><button onClick={() => controls?.previous()} disabled={!controls} aria-label="Trang trước"><ChevronLeft size={21} /> Trước</button><span>{Math.round((location?.progression || 0) * 100)}% · {location?.chapterTitle || 'Đang đọc'}</span><button onClick={() => controls?.next()} disabled={!controls} aria-label="Trang sau">Sau <ChevronRight size={21} /></button></div></div>}

    {stealthActive && reader && (
      <StealthReader
        book={reader.book}
        bytes={reader.bytes}
        lang={lang}
        initialProgression={location?.progression || 0}
        onClose={() => setStealthActive(false)}
        onExitHome={() => {
          setStealthActive(false)
          closeReader()
          setPage('home')
          window.scrollTo({ top: 0, behavior: 'smooth' })
        }}
        onProgressChange={pct => {
          const nextLoc: ReaderLocation = {
            locatorJson: locationRef.current?.locatorJson || '',
            progression: pct,
            chapterTitle: locationRef.current?.chapterTitle || '',
          }
          onLocation(nextLoc)
        }}
      />
    )}

    {tocOpen && reader && <div className="modal-shade" role="presentation" onMouseDown={event => { if (event.target === event.currentTarget) setTocOpen(false) }}><aside className="toc-drawer" role="dialog" aria-modal="true" aria-label="Mục lục sách"><div className="toc-header"><div><p className="eyebrow">MỤC LỤC SÁCH</p><h2>{reader.book.title}</h2></div><button className="icon-button" onClick={() => setTocOpen(false)} aria-label="Đóng mục lục"><X size={19} /></button></div><div className="toc-list">{toc.length ? <TocTree items={toc} onSelect={target => { setNavigateTarget(target); setTocOpen(false) }} /> : <p className="muted" style={{ padding: '20px', textAlign: 'center', fontSize: '13px' }}>Tài liệu không có cấu trúc mục lục sẵn.</p>}</div></aside></div>}

    {settingsOpen && reader && <div className="modal-shade" role="presentation" onMouseDown={event => { if (event.target === event.currentTarget) setSettingsOpen(false) }}><div className="dialog settings-popup" role="dialog" aria-modal="true" aria-label="Tùy chỉnh đọc"><div className="dialog-header"><h2>Tùy chỉnh đọc</h2><button className="icon-button" onClick={() => setSettingsOpen(false)} aria-label="Đóng"><X size={18} /></button></div><label className="range-label">Cỡ chữ <strong>{fontSize}%</strong><input type="range" min="80" max="170" step="10" value={fontSize} onChange={event => updateComfort({ fontSize: Number(event.target.value) })} /></label><div className="setting-group"><span className="setting-label">Kiểu chữ</span><div className="toggle-row"><button className={`choice-chip ${fontFamily === 'serif' ? 'active' : ''}`} onClick={() => updateComfort({ fontFamily: 'serif' })}>Literata · Sách</button><button className={`choice-chip ${fontFamily === 'sans' ? 'active' : ''}`} onClick={() => updateComfort({ fontFamily: 'sans' })}>Atkinson · Dễ đọc</button><button className={`choice-chip ${fontFamily === 'mono' ? 'active' : ''}`} onClick={() => updateComfort({ fontFamily: 'mono' })}>Đơn cách</button></div></div><div className="setting-group"><span className="setting-label">Căn lề</span><div className="toggle-row"><button className={`choice-chip ${textAlignment === 'left' ? 'active' : ''}`} onClick={() => updateComfort({ textAlignment: 'left' })}><AlignLeft size={15} /> Trái</button><button className={`choice-chip ${textAlignment === 'justify' ? 'active' : ''}`} onClick={() => updateComfort({ textAlignment: 'justify' })}><AlignJustify size={15} /> Căn đều 2 bên</button></div></div><div className="setting-group"><span className="setting-label">Khoảng cách dòng</span><div className="toggle-row"><button className={`choice-chip ${lineHeight === 1.4 ? 'active' : ''}`} onClick={() => updateComfort({ lineHeight: 1.4 })}>Gọn (1.4)</button><button className={`choice-chip ${lineHeight === 1.65 ? 'active' : ''}`} onClick={() => updateComfort({ lineHeight: 1.65 })}>Vừa (1.65)</button><button className={`choice-chip ${lineHeight === 1.9 ? 'active' : ''}`} onClick={() => updateComfort({ lineHeight: 1.9 })}>Thoáng (1.9)</button></div></div><div className="setting-group"><span className="setting-label">Độ rộng trang</span><div className="toggle-row"><button className={`choice-chip ${readerWidth === 'narrow' ? 'active' : ''}`} onClick={() => updateComfort({ readerWidth: 'narrow' })}>Gọn</button><button className={`choice-chip ${readerWidth === 'standard' ? 'active' : ''}`} onClick={() => updateComfort({ readerWidth: 'standard' })}>Tiêu chuẩn</button><button className={`choice-chip ${readerWidth === 'wide' ? 'active' : ''}`} onClick={() => updateComfort({ readerWidth: 'wide' })}>Rộng</button></div></div><div className="setting-group"><span className="setting-label">Màu nền</span><div className="theme-row">{(['paper', 'sepia', 'night'] as const).map(value => <button key={value} className={`theme-chip ${value} ${theme === value ? 'chosen' : ''}`} onClick={() => updateComfort({ theme: value })}>{value === 'paper' ? 'Giấy sáng' : value === 'sepia' ? 'Vàng dịu' : 'Ban đêm'}</button>)}</div></div><div className="setting-group stealth-settings-section"><span className="setting-label">{lang === 'vi' ? 'Chế độ ngụy trang công sở (Boss Key)' : 'Workplace Disguise (Boss Key)'}</span><p className="muted" style={{ fontSize: '11px', margin: '4px 0 10px', lineHeight: 1.5 }}>{lang === 'vi' ? 'Chuyển đổi giao diện đọc thành Microsoft Excel 365, VS Code hoặc tài liệu ISO để đọc an toàn tại văn phòng. Phím tắt: F2.' : 'Disguise reader into Excel 365, VS Code, or ISO doc to read discreetly at work. Quick toggle: F2.'}</p><button type="button" className="stealth-launch-btn" onClick={() => { setSettingsOpen(false); setStealthActive(true) }}><Briefcase size={16} /> {lang === 'vi' ? 'Bật chế độ ngụy trang ngay (F2)' : 'Activate Stealth Mode (F2)'}</button></div></div></div>}

    {noteOpen && reader && <div className="modal-shade" role="presentation" onMouseDown={event => { if (event.target === event.currentTarget) setNoteOpen(false) }}><div className="dialog" role="dialog" aria-modal="true" aria-labelledby="note-title"><button className="icon-button dialog-close" onClick={() => setNoteOpen(false)} aria-label="Đóng"><X size={19} /></button><p className="eyebrow">READING MEMORY</p><h2 id="note-title">Lưu điều đáng nhớ</h2>{selection?.text && <blockquote className="selection-preview">“{selection.text.slice(0, 300)}{selection.text.length > 300 ? '…' : ''}”</blockquote>}<div className="color-selector"><span>Màu highlight:</span>{(['YELLOW', 'GREEN', 'BLUE', 'PINK', 'PURPLE'] as const).map(c => <button key={c} type="button" className={`color-dot ${c.toLowerCase()} ${noteColor === c ? 'active' : ''}`} onClick={() => setNoteColor(c)} aria-label={`Màu ${c}`} />)}</div><label htmlFor="note-input">Ghi chú của bạn</label><textarea id="note-input" value={noteText} onChange={event => setNoteText(event.target.value)} maxLength={10000} rows={5} placeholder="Điều gì khiến bạn muốn giữ đoạn này?" autoFocus /><div className="dialog-actions"><button className="secondary" onClick={() => setNoteOpen(false)}>Hủy</button><button className="primary" onClick={() => void saveNote()} disabled={(!noteText.trim() && !selection?.text) || noteSaving}><Check size={17} /> {noteSaving ? 'Đang lưu…' : noteText.trim() ? 'Lưu ghi chú' : 'Lưu đoạn trích'}</button></div></div></div>}

    {reviewOpen && <div className="modal-shade" role="presentation" onMouseDown={e => { if (e.target === e.currentTarget) setReviewOpen(false) }}><div className="flashcard-modal" role="dialog" aria-modal="true" aria-label="Ôn tập ghi chú Flashcards"><button className="icon-button dialog-close" onClick={() => setReviewOpen(false)} aria-label="Đóng"><X size={19} /></button>{reviewIndex < reviewQueue.length ? (() => {
      const card = reviewQueue[reviewIndex]
      const book = books.find(b => b.id === card.payload.book_id)
      const quote = toText(card.payload.text)
      const note = toText(card.payload.note)
      const chapter = toText(card.payload.chapter_title)
      const progressPct = Math.round((reviewIndex / reviewQueue.length) * 100)
      return <>
        <div style={{ display: 'flex', justifyContent: 'space-between', alignItems: 'center' }}><p className="eyebrow" style={{ margin: 0 }}>FLASHCARD REVIEW · THẺ {reviewIndex + 1}/{reviewQueue.length}</p><span style={{ fontSize: '11px', fontWeight: 700, color: '#167e70' }}>{reviewStats.mastered} đã thuộc</span></div>
        <div className="flashcard-progress-bar"><span style={{ width: `${progressPct}%` }} /></div>
        <div className={`flashcard ${cardFlipped ? 'flipped' : ''}`} onClick={() => setCardFlipped(!cardFlipped)}>
          <div className="flashcard-inner">
            <div className="flashcard-front">
              <div className="flashcard-book">📚 {book?.title || 'Tài liệu'} {chapter ? `· ${chapter}` : ''}</div>
              <div className="flashcard-quote">“{quote || note || 'Ghi nhớ quan trọng'}”</div>
              <div className="flashcard-hint">💡 Bấm thẻ để lật xem ghi chú suy ngẫm</div>
            </div>
            <div className="flashcard-back">
              <div className="flashcard-book" style={{ opacity: 0.7 }}>GHI CHÚ & SUY NGẪM</div>
              <div className="flashcard-note-title">Nội dung ghi chú của bạn:</div>
              <div className="flashcard-note">{note || 'Không có ghi chú riêng; hãy ghi nhớ lại đoạn trích trên.'}</div>
              <div className="flashcard-hint" style={{ marginTop: '14px' }}>Đánh giá khả năng ghi nhớ bên dưới:</div>
            </div>
          </div>
        </div>
        <button className="flip-card-btn" onClick={() => setCardFlipped(!cardFlipped)}><RotateCcw size={15} style={{ display: 'inline', marginRight: '6px' }} /> {cardFlipped ? 'Xem lại mặt trước' : 'Lật thẻ xem ghi chú'}</button>
        <div className="flashcard-actions">
          <button className="rating-btn again" onClick={() => void handleFlashcardRating('again')}>🔴 Cần ôn lại</button>
          <button className="rating-btn good" onClick={() => void handleFlashcardRating('good')}>🟢 Đã nhớ rõ</button>
        </div>
      </>
    })() : <div className="review-complete">
      <CheckCircle2 size={54} color="#167e70" style={{ margin: '0 auto' }} />
      <h2>Hoàn thành phiên ôn tập!</h2>
      <p className="muted">Tuyệt vời! Bạn đã xem lại toàn bộ các thẻ ghi chú trong phiên này.</p>
      <div className="review-stats-row">
        <div className="review-stat-pill" style={{ color: '#166534', background: '#dcfce7' }}>✓ Đã nhớ: {reviewStats.mastered} thẻ</div>
        <div className="review-stat-pill" style={{ color: '#991b1b', background: '#fee2e2' }}>↺ Ôn lại: {reviewStats.reviewAgain} lần</div>
      </div>
      <div style={{ display: 'flex', gap: '12px', justifyContent: 'center', marginTop: '16px' }}>
        <button className="secondary" onClick={() => void startFlashcardReview()}>Ôn tập lại</button>
        <button className="primary" onClick={() => setReviewOpen(false)}>Hoàn tất</button>
      </div>
    </div>}</div></div>}

    {authOpen && <AuthDialog onClose={() => setAuthOpen(false)} onSuccess={value => void authenticated(value)} />}
    {selectedBook && <BookDetailsModal book={selectedBook} lang={lang} categories={categories} progress={Number(progressFor(records, selectedBook.id)?.payload.progression || 0)} isFavorite={favorites.has(selectedBook.id)} isOffline={selectedBook.source === 'local' || offlineIds.has(selectedBook.id)} offlineBusy={offlineBusy === selectedBook.id} onClose={() => setSelectedBook(null)} onRead={() => { const b = selectedBook; setSelectedBook(null); void openBook(b) }} onStealthRead={() => { const b = selectedBook; setSelectedBook(null); void openBook(b).then(ok => { if (ok) setStealthActive(true) }) }} onFavorite={selectedBook.source === 'local' ? undefined : () => void toggleFavorite(selectedBook)} onOffline={selectedBook.source !== 'local' && selectedBook.fileUrl ? () => void toggleOffline(selectedBook) : undefined} onDelete={selectedBook.source === 'local' || selectedBook.source === 'cloud' ? () => { const b = selectedBook; setSelectedBook(null); void deleteBook(b) } : undefined} />}
  </div>
}

function TocTree({ items, onSelect }: { items: TocItem[]; onSelect: (href: string) => void }) {
  return <div>{items.map(item => <div key={item.id}><button className="toc-btn" onClick={() => onSelect(item.href)}>{item.label}</button>{item.subitems && item.subitems.length > 0 && <div className="toc-sub"><TocTree items={item.subitems} onSelect={onSelect} /></div>}</div>)}</div>
}


function SectionHeader({ title, action, onAction }: { title: string; action: string; onAction: () => void }) {
  return <div className="section-header"><h2>{title}</h2><button onClick={onAction}>{action} <ArrowRight size={16} /></button></div>
}

function BookCard({ book, progress, onOpen, onStealth, onDetails, favorite, onFavorite, onDelete, offline, offlineBusy, onOffline, lang = 'vi' }: { book: Book; progress?: number; onOpen: () => void; onStealth?: () => void; onDetails?: () => void; favorite: boolean; onFavorite?: () => void; onDelete?: () => void; offline?: boolean; offlineBusy?: boolean; onOffline?: () => void; lang?: Lang }) {
  const handleDetails = onDetails || onOpen
  const curT = t[lang]
  const metaText = offline ? curT.bookCard.savedOffline : book.source === 'cloud' ? curT.bookCard.cloudPersonal : book.language === 'vi' ? curT.bookCard.vietnamese : curT.bookCard.ebook
  return <article className="book-card"><button className="cover-button" onClick={handleDetails} aria-label={curT.bookCard.detailsAria(book.title)}><div className="book-cover">{book.coverUrl ? <img src={book.coverUrl} alt="" loading="lazy" onError={event => { event.currentTarget.style.display = 'none' }} /> : null}<div className="cover-fallback"><BookOpen size={34} /><small>NoCap</small></div></div></button><div className="book-info"><div className="book-meta">{metaText}</div><button className="book-title" onClick={handleDetails}>{book.title}</button><p>{bookLabel(book, lang)}</p>{!!progress && <div className="progress-bar" aria-label={curT.bookCard.readPercentAria(Math.round(progress * 100))}><span style={{ width: `${Math.max(2, progress * 100)}%` }} /></div>}<div className="card-actions"><button className="read-link" onClick={onOpen}>{progress ? curT.bookCard.continueReading : curT.bookCard.startReading} <ArrowRight size={15} /></button>{onStealth && <button type="button" className="icon-button stealth-card-btn" title={curT.bookCard.stealthRead || (lang === 'vi' ? 'Đọc ẩn công sở (F2)' : 'Stealth Read (F2)')} aria-label={curT.bookCard.stealthRead || 'Đọc ẩn công sở'} onClick={e => { e.stopPropagation(); onStealth() }}><Briefcase size={16} /></button>}{onOffline && <button className="icon-button" title={offline ? curT.bookCard.removeOffline : curT.bookCard.downloadOffline} aria-label={offline ? `${curT.bookCard.removeOffline}: ${book.title}` : `${curT.bookCard.downloadOffline}: ${book.title}`} onClick={onOffline} disabled={offlineBusy}>{offline ? <Check size={17} /> : <Download size={17} />}</button>}{onFavorite && <button className="icon-button" title={favorite ? curT.bookCard.unfavorite : curT.bookCard.favorite} aria-label={favorite ? `${curT.bookCard.unfavorite}: ${book.title}` : `${curT.bookCard.favorite}: ${book.title}`} onClick={onFavorite}><BookMarked size={17} fill={favorite ? 'currentColor' : 'none'} /></button>}{onDelete && <button className="icon-button" title={curT.bookCard.deleteFile} aria-label={curT.bookCard.deleteFile} onClick={onDelete}><Trash2 size={17} /></button>}</div></div></article>
}

function BookDetailsModal({
  book,
  categories,
  progress,
  isFavorite,
  isOffline,
  offlineBusy,
  onClose,
  onRead,
  onStealthRead,
  onFavorite,
  onOffline,
  onDelete,
  lang = 'vi',
}: {
  book: Book
  categories: Category[]
  progress?: number
  isFavorite: boolean
  isOffline: boolean
  offlineBusy?: boolean
  onClose: () => void
  onRead: () => void
  onStealthRead?: () => void
  onFavorite?: () => void
  onOffline?: () => void
  onDelete?: () => void
  lang?: Lang
}) {
  const curT = t[lang]
  const categoryName = categories.find(c => c.id === book.categoryId)?.name || (book.source === 'local' ? curT.bookModal.privateDoc : curT.bookModal.generalCategory)
  const progressPct = progress ? Math.round(progress * 100) : 0
  const sizeFormatted = book.fileSizeBytes ? `${(book.fileSizeBytes / (1024 * 1024)).toFixed(1)} MB` : undefined

  return (
    <div className="modal-shade" role="presentation" onMouseDown={e => { if (e.target === e.currentTarget) onClose() }}>
      <div className="book-details-modal" role="dialog" aria-modal="true" aria-labelledby="book-detail-title">
        <button className="icon-button dialog-close" onClick={onClose} aria-label="Đóng"><X size={20} /></button>
        <div className="book-details-top">
          <div className="book-details-cover">
            {book.coverUrl ? (
              <img src={book.coverUrl} alt={book.title} loading="lazy" onError={e => { e.currentTarget.style.display = 'none' }} />
            ) : (
              <div className="cover-fallback" style={{ height: '100%' }}><BookOpen size={40} /><small>NoCap</small></div>
            )}
          </div>
          <div className="book-details-info">
            <h2 id="book-detail-title" className="book-details-title">{book.title}</h2>
            <div className="book-details-author">{curT.bookModal.authorPrefix} <strong>{book.author || curT.bookModal.unknownAuthor}</strong></div>
            <div className="book-details-badges">
              <span className="book-badge rating"><Star size={13} fill="currentColor" /> 4.8</span>
              <span className="book-badge">{categoryName}</span>
              <span className="book-badge format">{book.format?.toUpperCase() || 'EPUB'}</span>
              {sizeFormatted && <span className="book-badge format">{sizeFormatted}</span>}
              {progressPct > 0 && <span className="book-badge progress">{curT.bookModal.readPercent(progressPct)}</span>}
            </div>
            <div className="book-details-actions">
              <button className="primary" onClick={onRead}>
                <BookOpen size={16} /> {progressPct > 0 ? curT.bookModal.continueReading : curT.bookModal.readBook}
              </button>
              {onStealthRead && (
                <button
                  className="secondary stealth-modal-btn"
                  onClick={onStealthRead}
                  title={lang === 'vi' ? 'Đọc ngụy trang giao diện Excel / VS Code công sở (Phím F2)' : 'Stealth Read disguised as Excel / VS Code (F2)'}
                >
                  <Briefcase size={16} /> {lang === 'vi' ? 'Đọc ẩn (F2)' : 'Stealth (F2)'}
                </button>
              )}
              {onOffline && (
                <button className="secondary" onClick={onOffline} disabled={offlineBusy}>
                  {isOffline ? <><Check size={16} /> {curT.bookModal.savedOffline}</> : <><Download size={16} /> {curT.bookModal.downloadOffline}</>}
                </button>
              )}
              {onFavorite && (
                <button className="secondary" onClick={onFavorite}>
                  <BookMarked size={16} fill={isFavorite ? 'currentColor' : 'none'} /> {isFavorite ? curT.bookModal.favorited : curT.bookModal.favorite}
                </button>
              )}
              {onDelete && (
                <button className="secondary" style={{ color: '#b91c1c' }} onClick={onDelete}>
                  <Trash2 size={16} /> {curT.bookModal.deleteBook}
                </button>
              )}
            </div>
          </div>
        </div>
        <div className="book-details-desc">
          <h3>{lang === 'vi' ? 'Giới thiệu' : 'Overview'}</h3>
          <p>{book.description || (lang === 'vi' ? 'Chưa có phần giới thiệu chi tiết cho tác phẩm này. Bạn có thể mở đọc sách ngay để khám phá toàn bộ nội dung.' : 'No detailed description available for this work yet. You can open and read the book right away.')}</p>
        </div>
      </div>
    </div>
  )
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
