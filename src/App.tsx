import { lazy, Suspense, useCallback, useEffect, useMemo, useRef, useState } from 'react'
import { AlignJustify, AlignLeft, ArrowLeft, ArrowRight, Award, BarChart3, BookMarked, BookOpen, Bookmark, Briefcase, Check, CheckCircle2, ChevronLeft, ChevronRight, Cloud, CloudOff, Download, Edit3, FileDown, FileText, Flame, FolderPlus, Globe, Highlighter, Home, Layers, Library, List, LogIn, Menu, PanelRightOpen, Plus, RotateCcw, Search, Settings2, Sparkles, Tag, Trash2, Type, X } from 'lucide-react'
import { ApiError, deleteAccount, forgotPassword, getCatalog, getEntitlement, getUser, loadBookBytes, login, loginWithGoogle, logout, register, updateProfile, type Entitlement } from './api'
import type { StealthPosition } from './stealth/StealthReader'
import { readStealthCheckpoint, stealthLocator } from './stealth/checkpoint'
import { applyLibraryRestore, getCachedCatalog, getFile, getFiles, getOfflineBook, getOfflineBooks, getPending, keyFor, readSession, removeFile, removeLocalDocument, removeOfflineBook, saveCachedCatalog, saveSession, SESSION_STORAGE_KEY } from './store'
import { androidCompositeRecordId, androidRecordId, broadcastSyncRequired, canKeepLocalConflict, connectLiveSync, getConflicts, getDeviceId, localRecords, mutate, profileFor, readableError, resolveConflict, syncNow } from './sync'
import { prepareBookDownload, saveBookDownload } from './bookDownload'
import { currentLocalFile, mergeBooksById } from './library'
import { importWithChunkRecovery } from './lazyRecovery'
import { reviewIsDue, type ReviewItemPayload } from './review'
import type { Book, Category, FontFamily, LocalFile, PendingOperation, ReaderLocation, ReaderWidth, Session, SyncRecord, TextAlignment, TocItem } from './types'
import { OceanWaves } from './OceanWaves'
import { getStoredLang, setStoredLang, t, type Lang } from './i18n'
import './App.css'

const ReaderPane = lazy(() => importWithChunkRecovery(() => import('./Reader')).then(module => ({ default: module.ReaderPane })))
const StealthReader = lazy(() => importWithChunkRecovery(() => import('./stealth/StealthReader')).then(module => ({ default: module.StealthReader })))

import type { Page } from './routing'
import { useAppRoute } from './useAppRoute'
import { AccountSettings, type AccountSettingsSection } from './AccountSettings'
import { useAdminAccess } from './admin/useAdminAccess'
import { AnnotationEditor, AnnotationDeleteDialog } from './AnnotationDialogs'
import { ProRequiredDialog } from './ProRequiredDialog'
import { addAnnotationReview, annotationId, deleteAnnotation, updateAnnotation, type AnnotationChanges } from './annotations'
import { buildReviewQueue, reconcileReviewSession, recordReviewAttempt, type ReviewRating, type ReviewScope, type ReviewSessionState } from './reviewSession'
import { hasDrawing, parseDrawing, type Drawing } from './drawing'
import { DrawingPreview } from './DrawingEditor'
import { clearReaderNoteDraft, emptyReaderNoteDraft, readReaderNoteDraft, writeReaderNoteDraft, type ReaderNoteDraft } from './readerNoteDrafts'
import { allowsPro, proAccessExpiresAt, verifyProAccess, type ProFeature } from './entitlements'

const AdminWorkspace = lazy(() => importWithChunkRecovery(() => import('./admin/AdminWorkspace')))
const ResearchWorkspace = lazy(() => importWithChunkRecovery(() => import('./ResearchWorkspace')).then(module => ({ default: module.ResearchWorkspace })))
const AnnotationSourceActions = lazy(() => importWithChunkRecovery(() => import('./ResearchWorkspace')).then(module => ({ default: module.AnnotationSourceActions })))
const ComparisonReader = lazy(() => importWithChunkRecovery(() => import('./ComparisonReader')).then(module => ({ default: module.ComparisonReader })))
import { readingActivity } from './readingStats'
import { translate } from './uiText'
import { ImportDocumentDialog } from './ImportDocumentDialog'
import { ComparisonSourcesDialog } from './ComparisonSourcesDialog'
import { ReaderErrorBoundary } from './ReaderErrorBoundary'
import { ReaderNotesPanel } from './ReaderNotesPanel'
import { ReaderSearchPanel } from './ReaderSearchPanel'
import { Volume2 } from 'lucide-react'
import { ReaderSpeechPanel } from './ReaderSpeechPanel'
import { speechScopeKey, type ReaderSpeechSource } from './readerSpeech'
import type { ReaderSearchHit, ReaderSearchSource } from './readerSearch'
import { detectReaderFormat } from './readerFormat'
import { useWebAnalytics } from './useWebAnalytics'
import { trackWebFeature } from './webAnalytics'
type ShelfFilter = 'all' | 'reading' | 'favorites' | 'completed' | 'local'
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
    id: toText(p.id), title: toText(p.user_title_override) || toText(p.title) || translate('Tài liệu', getStoredLang()),
    author: toText(p.user_author_override) || toText(p.author), description: toText(p.description),
    coverUrl: toText(p.cover_url), categoryId: toText(p.category_id), fileUrl: toText(p.file_url),
    format: toText(p.format), source: 'cloud', fileSizeBytes: Number(p.file_size_bytes) || 0,
  }
}

function progressFor(records: SyncRecord[], bookId: string) {
  return records.find(r => r.kind === 'reading_progress' && !r.deleted && r.payload.book_id === bookId)
}

function bookLabel(book: Book, lang: Lang = 'vi') {
  return (book.source === 'local' && book.author === 'Tài liệu của bạn' ? translate(book.author, lang) : book.author) ||
    (book.source === 'local' ? t[lang].bookCard.browserDoc : t[lang].bookCard.libraryDefault)
}

function App() {
  const initialComfort = useMemo(storedComfort, [])
  const [lang, setLang] = useState<Lang>(getStoredLang)
  const toggleLang = () => {
    const next: Lang = lang === 'vi' ? 'en' : 'vi'
    setLang(next)
    setNotice('')
    setStoredLang(next)
  }
  const curT = t[lang]
  useEffect(() => {
    document.documentElement.lang = lang
    document.title = lang === 'vi' ? 'NoCap — Không gian đọc của bạn' : 'NoCap — Your reading space'
  }, [lang])
  const { route, navigate } = useAppRoute()
  useWebAnalytics(route)
  const page = route.kind === 'page' ? route.page : route.kind === 'notFound' ? 'notFound' : 'catalog'
  const backgroundPageRef = useRef<Page>('catalog')
  const openingBookRef = useRef<string | null>(null)
  const routeAttemptRef = useRef<string | null>(null)
  const [catalogReady, setCatalogReady] = useState(false)
  const [loadedProfile, setLoadedProfile] = useState<string | null>(null)
  const [session, setSession] = useState<Session | null>(() => readSession())
  const sessionToken = session?.token
  const { access: adminAccess, reload: reloadAdminAccess, invalidate: invalidateAdminAccess } = useAdminAccess(sessionToken, session?.user.id)
  const isAdmin = adminAccess?.status === 'allowed'
  const profile = profileFor(session)
  const [catalog, setCatalog] = useState<Book[]>([])
  const [categories, setCategories] = useState<Category[]>([])
  const [records, setRecords] = useState<SyncRecord[]>([])
  const [localFiles, setLocalFiles] = useState<LocalFile[]>([])
  const [offlineIds, setOfflineIds] = useState<Set<string>>(new Set())
  const [downloadBusy, setDownloadBusy] = useState<string | null>(null)
  const downloadActive = useRef(false)
  const [query, setQuery] = useState('')
  const [category, setCategory] = useState('all')
  const [reader, setReader] = useState<{ book: Book; bytes: ArrayBuffer; initial?: string } | null>(null)
  const [comparison, setComparison] = useState<{ profile: string; books: [Book, Book]; initialLocators: [string | undefined, string | undefined] } | null>(null)
  const [comparisonChoosing, setComparisonChoosing] = useState(false)
  const comparisonPositions = useRef(new Map<string, { profile: string; book: Book; location: ReaderLocation; session: Session | null }>())
  const comparisonProgressTimer = useRef<ReturnType<typeof setTimeout> | null>(null)
  const [readerLoading, setReaderLoading] = useState(false)
  const [readerError, setReaderError] = useState('')
  const [notice, setNotice] = useState('')
  const [authOpen, setAuthOpen] = useState(false)
  const [importOpen, setImportOpen] = useState(false)
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
  const [noteDrawing, setNoteDrawing] = useState<Drawing | null>(null)
  const noteDraft = useRef<ReaderNoteDraft>(emptyReaderNoteDraft())
  const [noteColor, setNoteColor] = useState<'YELLOW' | 'GREEN' | 'BLUE' | 'PINK' | 'PURPLE'>('YELLOW')
  const [noteSaving, setNoteSaving] = useState(false)
  const noteFlight = useRef<object | null>(null)
  const noteFlights = useRef(new Map<string, object>())
  const noteAnchor = useRef<ReaderLocation | null>(null)
  const notesToggle = useRef<HTMLButtonElement>(null)
  const [noteNavigation, setNoteNavigation] = useState<{ locatorJson: string; requestId: number } | null>(null)
  const noteNavigationId = useRef(0)
  const [searchOpen, setSearchOpen] = useState(false)
  const [readerSearchSource, setReaderSearchSource] = useState<ReaderSearchSource | null>(null)
  const [activeSearchHit, setActiveSearchHit] = useState<ReaderSearchHit | null>(null)
  const searchToggle = useRef<HTMLButtonElement>(null)
  const [speechOpen, setSpeechOpen] = useState(false)
  const [readerSpeechSource, setReaderSpeechSource] = useState<ReaderSpeechSource | null>(null)
  const speechToggle = useRef<HTMLButtonElement>(null)
  const onReaderSpeechReady = useCallback((source: ReaderSpeechSource | null) => setReaderSpeechSource(() => source), [])
  const onReaderSearchReady = useCallback((source: ReaderSearchSource | null) => setReaderSearchSource(() => source), [])
  const openReaderSearch = useCallback(() => {
    setNoteOpen(false); setSearchOpen(true); setTocOpen(false); setSettingsOpen(false)
    requestAnimationFrame(() => document.querySelector<HTMLInputElement>('#reader-search-panel input[type="search"]')?.focus())
  }, [])
  const [bookmarkSaving, setBookmarkSaving] = useState<string | null>(null)
  const bookmarkFlights = useRef(new Set<string>())
  const favoriteFlights = useRef(new Set<string>())
  const deletionFlights = useRef(new Set<string>())
  const [editingAnnotation, setEditingAnnotation] = useState<SyncRecord | null>(null)
  const [deletingAnnotation, setDeletingAnnotation] = useState<SyncRecord | null>(null)
  const [annotationBusy, setAnnotationBusy] = useState(false)
  const [pdfExportBusy, setPdfExportBusy] = useState(false)
  const pdfExportActive = useRef(false)
  const [annotationError, setAnnotationError] = useState('')
  const [proRequiredFeature, setProRequiredFeature] = useState<ProFeature | null>(null)
  const [statsNow, setStatsNow] = useState(ms)
  const [sortOrder, setSortOrder] = useState<'recent' | 'title' | 'progress'>('recent')
  const [shelfFilter, setShelfFilter] = useState<ShelfFilter>('all')
  const [organizationFilter, setOrganizationFilter] = useState('all')
  const [reviewOpen, setReviewOpen] = useState(false)
  const [cardFlipped, setCardFlipped] = useState(false)
  const [reviewSession, setReviewSession] = useState<ReviewSessionState>({ scope: {}, queue: [], index: 0 })
  const activeReview = reconcileReviewSession(reviewSession, records, profile)
  const reviewIndex = activeReview.index
  const reviewQueue = activeReview.queue
  const reviewRatingActive = useRef(false)
  const reviewRun = useRef(0)
  const reviewStarting = useRef(false)
  const [reviewBusy, setReviewBusy] = useState(false)
  const [reviewStats, setReviewStats] = useState({ mastered: 0, reviewAgain: 0, skipped: 0 })
  const [entitlement, setEntitlement] = useState<Entitlement | null>(null)
  const [accountSection, setAccountSection] = useState<AccountSettingsSection>('profile')
  const [controls, setControls] = useState<{ previous: () => void; next: () => void } | null>(null)
  const [selectedBook, setSelectedBook] = useState<Book | null>(null)
  const [stealthGrant, setStealthGrant] = useState<{ token: string; bookId: string } | null>(null)
  const stealthActive = !!stealthGrant && stealthGrant.token === session?.token && stealthGrant.bookId === reader?.book.id && allowsPro(entitlement, session)
  const stealthActiveRef = useRef(stealthActive)
  stealthActiveRef.current = stealthActive
  const [stealthProgressRequest, setStealthProgressRequest] = useState<{ progression: number; requestId: number; href?: string } | null>(null)
  const [editNameOpen, setEditNameOpen] = useState(false)
  const [editNameInput, setEditNameInput] = useState('')
  const [savingName, setSavingName] = useState(false)
  const [deleteAccountOpen, setDeleteAccountOpen] = useState(false)
  const [deleteAccountBusy, setDeleteAccountBusy] = useState(false)
  const [conflicts, setConflicts] = useState<PendingOperation[]>([])
  const [conflictModalOpen, setConflictModalOpen] = useState(false)
  const [tagsCollectionsOpen, setTagsCollectionsOpen] = useState(false)
  const [tagTab, setTagTab] = useState<'tags' | 'collections'>('tags')
  const [newTagName, setNewTagName] = useState('')
  const [newCollectionName, setNewCollectionName] = useState('')
  const [editingItemId, setEditingItemId] = useState<string | null>(null)
  const [editingItemName, setEditingItemName] = useState('')
  const [organizationBusy, setOrganizationBusy] = useState(false)
  const organizationFlight = useRef<object | null>(null)
  const fileInput = useRef<HTMLInputElement>(null)
  const progressTimer = useRef<ReturnType<typeof setTimeout> | null>(null)
  const preferenceTimer = useRef<ReturnType<typeof setTimeout> | null>(null)
  const readingSessionRef = useRef<{ id: string; bookId: string; startedAt: number; startProgress: number; format: string; localOnly: boolean } | null>(null)
  const syncFlight = useRef<{ profile: string; token: string; promise: Promise<void> } | null>(null)
  const readerRef = useRef<Book | null>(null)
  const profileRef = useRef(profile)
  profileRef.current = profile
  const localRefreshId = useRef(0)
  const sessionRef = useRef(session)
  sessionRef.current = session
  useEffect(() => () => {
    if (progressTimer.current) clearTimeout(progressTimer.current)
    if (preferenceTimer.current) clearTimeout(preferenceTimer.current)
  }, [])
  const locationRef = useRef(location)
  locationRef.current = location
  const lastSyncAt = useRef(0)
  const syncNeedsRerun = useRef(false)
  const openRequestId = useRef(0)
  const openController = useRef<AbortController | null>(null)
  const closeReaderRef = useRef<() => void>(() => {})
  const openBookRef = useRef<(book: Book) => Promise<boolean>>(async () => false)
  const launchStealthRef = useRef<(book?: Book) => Promise<void>>(async () => {})
  const stealthLaunchBusy = useRef(false)

  const setPage = useCallback((next: Page) => {
    if (next === 'account') setAccountSection('profile')
    closeReaderRef.current()
    setSelectedBook(null)
    setSidebarOpen(false)
    backgroundPageRef.current = next
    navigate({ kind: 'page', page: next })
    window.scrollTo({ top: 0 })
  }, [navigate])

  const resetAccountView = useCallback(() => {
    setPage('home')
    if (preferenceTimer.current) { clearTimeout(preferenceTimer.current); preferenceTimer.current = null }
    setRecords([]); setLocalFiles([]); setOfflineIds(new Set()); setPendingCount(0)
    setConflicts([]); setConflictModalOpen(false)
    setAuthOpen(false); setEditNameOpen(false); setDeleteAccountOpen(false)
    lastSyncAt.current = 0
  }, [setPage])

  const invalidateSession = useCallback((token: string) => {
    if (sessionRef.current?.token !== token) return
    const stored = readSession()
    if (stored && stored.token !== token) return
    resetAccountView()
    saveSession(null)
    sessionRef.current = null; profileRef.current = profileFor(null)
    setSession(null); setEntitlement(null)
  }, [resetAccountView])

  const closeBookDetails = useCallback(() => {
    setSelectedBook(null)
    navigate({ kind: 'page', page: backgroundPageRef.current }, true)
  }, [navigate])

  function showBookDetails(book: Book) {
    if (route.kind === 'page') backgroundPageRef.current = route.page
    navigate({ kind: 'book', bookId: book.id })
  }

  useEffect(() => {
    try {
      localStorage.setItem('nocap-reader-comfort-v1', JSON.stringify({ fontSize, fontFamily, lineHeight, textAlignment, theme, readerWidth }))
    } catch {
      // Reading still works when browser privacy settings disable localStorage.
    }
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
      if (comparison || comparisonChoosing) return
      if (stealthActive) return
      if (reader && (e.ctrlKey || e.metaKey) && !e.altKey && e.key.toLowerCase() === 'f' && !editingAnnotation && !deletingAnnotation && !authOpen && !proRequiredFeature) {
        e.preventDefault()
        openReaderSearch()
        return
      }
      if (e.key === 'F2') {
        if (reader) {
          e.preventDefault()
          if (!e.repeat && !proRequiredFeature) void launchStealthRef.current()
        }
      }
      if (e.key === 'Escape') {
        if (annotationBusy) return
        if (editingAnnotation) { setEditingAnnotation(null); return }
        if (deletingAnnotation) { setDeletingAnnotation(null); return }
        if (proRequiredFeature) { setProRequiredFeature(null); return }
        if (tocOpen) { setTocOpen(false); return }
        if (settingsOpen) { setSettingsOpen(false); return }
        if (speechOpen) { e.preventDefault(); setSpeechOpen(false); speechToggle.current?.focus(); return }
        if (searchOpen) { e.preventDefault(); setSearchOpen(false); setActiveSearchHit(null); searchToggle.current?.focus(); return }
        if (noteOpen) { e.preventDefault(); setNoteOpen(false); notesToggle.current?.focus(); return }
        if (reviewOpen) { setReviewOpen(false); return }
        if (authOpen) { setAuthOpen(false); return }
        if (selectedBook) { closeBookDetails(); return }
        if (reader) {
          e.preventDefault()
          closeReaderRef.current()
          setPage('home')
          window.scrollTo({ top: 0, behavior: 'smooth' })
        }
      }
    }
    window.addEventListener('keydown', onGlobalKey)
    return () => window.removeEventListener('keydown', onGlobalKey)
  }, [comparison, comparisonChoosing, reader, tocOpen, settingsOpen, noteOpen, searchOpen, speechOpen, reviewOpen, authOpen, selectedBook, stealthActive, setPage, closeBookDetails, editingAnnotation, deletingAnnotation, annotationBusy, proRequiredFeature, openReaderSearch])

  useEffect(() => {
    const updateDay = () => setStatsNow(ms())
    const timer = window.setInterval(updateDay, 60000)
    window.addEventListener('focus', updateDay)
    return () => { window.clearInterval(timer); window.removeEventListener('focus', updateDay) }
  }, [])

  useEffect(() => {
    setEditingAnnotation(null); setDeletingAnnotation(null); setAnnotationError(''); setProRequiredFeature(null)
    setImportOpen(false)
    setTagsCollectionsOpen(false); setNewTagName(''); setNewCollectionName('')
    setOrganizationFilter('all')
    setStealthGrant(null)
    reviewRun.current++
    setReviewOpen(false); setReviewSession({ scope: {}, queue: [], index: 0 }); setComparison(null); setComparisonChoosing(false)
  }, [profile])

  useEffect(() => {
    setEditNameOpen(false); setEditNameInput(''); setSavingName(false)
    setDeleteAccountOpen(false); setDeleteAccountBusy(false)
    setEditingItemId(null); setEditingItemName(''); setOrganizationBusy(false)
    organizationFlight.current = null
  }, [session?.token])

  const refreshLocal = useCallback(async (selectedProfile: string) => {
    if (profileRef.current !== selectedProfile) return
    const requestId = ++localRefreshId.current
    const [nextRecords, nextFiles, nextPending, nextOffline, publicOffline] = await Promise.all([localRecords(selectedProfile), getFiles(selectedProfile), getPending(selectedProfile), getOfflineBooks(selectedProfile), getOfflineBooks('PUBLIC_OFFLINE')])
    if (profileRef.current !== selectedProfile || requestId !== localRefreshId.current) return
    setRecords(nextRecords)
    setLocalFiles(nextFiles)
    setPendingCount(nextPending.length)
    setOfflineIds(new Set([...nextOffline, ...publicOffline].map(item => item.bookId)))
    setLoadedProfile(selectedProfile)
  }, [])
  const currentReviewKey = reviewQueue[reviewIndex]?.key
  useEffect(() => { setCardFlipped(false) }, [currentReviewKey])
  useEffect(() => {
    const channel = typeof BroadcastChannel !== 'undefined' ? new BroadcastChannel('nocap_tab_sync') : null
    const refresh = () => { void refreshLocal(profile).catch(() => {}) }
    const onMessage = (event: MessageEvent) => { if (event.data?.type === 'sync_required' && event.data.profile === profile) refresh() }
    channel?.addEventListener('message', onMessage)
    window.addEventListener('focus', refresh)
    return () => { channel?.close(); window.removeEventListener('focus', refresh) }
  }, [profile, refreshLocal])
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
        if (active && !cached) setNotice(readableError(error, lang))
      } finally {
        if (active) setCatalogReady(true)
      }
    })()
    const update = () => setOnline(navigator.onLine)
    window.addEventListener('online', update)
    window.addEventListener('offline', update)
    return () => { active = false; window.removeEventListener('online', update); window.removeEventListener('offline', update) }
  }, [lang])

  useEffect(() => {
    void refreshLocal(profile).catch(() => {
      if (profileRef.current === profile) setLoadedProfile(profile)
      setNotice(lang === 'vi'
        ? 'Bộ nhớ cục bộ của trình duyệt đang bị gián đoạn. Sách trực tuyến vẫn có thể đọc bình thường.'
        : 'Browser storage is temporarily unavailable. Online books can still be read normally.')
    })
  }, [profile, refreshLocal, lang])

  const synchronize = useCallback(async (activeSession: Session, silent = false) => {
    if (!navigator.onLine) {
      if (!silent) setNotice(translate("Đang ngoại tuyến. Thay đổi của bạn được giữ trên trình duyệt.", lang))
      return
    }
    const targetProfile = profileFor(activeSession)
    if (profileRef.current !== targetProfile || sessionRef.current?.token !== activeSession.token) return
    if (syncFlight.current) {
      if (syncFlight.current.profile === targetProfile && syncFlight.current.token === activeSession.token) {
        syncNeedsRerun.current = true
        return syncFlight.current.promise
      }
      await syncFlight.current.promise
      if (profileRef.current !== targetProfile || sessionRef.current?.token !== activeSession.token) return
    }
    setSyncing(true)
    const flight = (async () => {
      try {
        do {
          syncNeedsRerun.current = false
          await syncNow(activeSession)
          if (profileRef.current !== targetProfile || sessionRef.current?.token !== activeSession.token) return
          lastSyncAt.current = Date.now()
          await refreshLocal(profileFor(activeSession))
          const currentConflicts = await getConflicts(targetProfile)
          if (profileRef.current === targetProfile && sessionRef.current?.token === activeSession.token) {
            setConflicts(currentConflicts)
            if (currentConflicts.length) {
              setNotice((lang === 'vi' ? `${currentConflicts.length} xung đột đồng bộ cần giải quyết.` : `${currentConflicts.length} sync conflicts need your attention.`))
            } else if (!silent && !syncNeedsRerun.current) {
              setNotice(translate("Đã đồng bộ với tài khoản của bạn.", lang))
            }
          }
        } while (syncNeedsRerun.current && profileRef.current === targetProfile)
      } catch (error) {
        if (profileRef.current === targetProfile && sessionRef.current?.token === activeSession.token) {
          if (error instanceof ApiError && error.status === 401) invalidateSession(activeSession.token)
          if (!silent || (error instanceof Error && error.message.includes('hết hạn'))) {
            setNotice(readableError(error, lang))
          }
        }
      } finally {
        syncFlight.current = null
        syncNeedsRerun.current = false
        setSyncing(false)
      }
    })()
    syncFlight.current = { profile: targetProfile, token: activeSession.token, promise: flight }
    try { await flight } finally { if (syncFlight.current?.promise === flight) syncFlight.current = null }
  }, [refreshLocal, lang, invalidateSession])
  const persistReadingProgress = useCallback(async (selectedProfile: string, book: Book, loc: ReaderLocation, activeSession: Session | null) => {
    try {
      const payload = { book_id: book.id, locator_json: loc.locatorJson, progression: Math.max(0, Math.min(1, loc.progression)), chapter_title: loc.chapterTitle || null, last_read_at: ms(), sync_version: 1 }
      await mutate(selectedProfile, 'reading_progress', androidRecordId('reading_progress', book.id), payload, false, book.source === 'local')
    } catch {
      if (profileRef.current === selectedProfile) setNotice(lang === 'vi'
        ? 'Không lưu được tiến độ đọc. Kiểm tra bộ nhớ trình duyệt rồi thử lại.'
        : 'Could not save reading progress. Check browser storage and try again.')
      return
    }
    // A display refresh failure must not prevent an already-persisted change
    // from reaching the sync queue. Both actions remain bound to its owner.
    await refreshLocal(selectedProfile).catch(() => {})
    if (activeSession && navigator.onLine && book.source !== 'local') void synchronize(activeSession, true)
  }, [refreshLocal, synchronize, lang])

  const flushComparisonProgress = useCallback(() => {
    if (comparisonProgressTimer.current) { clearTimeout(comparisonProgressTimer.current); comparisonProgressTimer.current = null }
    const positions = [...comparisonPositions.current.values()]
    comparisonPositions.current.clear()
    for (const saved of positions) void persistReadingProgress(saved.profile, saved.book, saved.location, saved.session)
  }, [persistReadingProgress])
  const recordComparisonLocation = useCallback((book: Book, next: ReaderLocation) => {
    const owner = profileRef.current
    comparisonPositions.current.set(`${owner}:${book.id}`, { profile: owner, book, location: next, session: sessionRef.current })
    if (comparisonProgressTimer.current) clearTimeout(comparisonProgressTimer.current)
    comparisonProgressTimer.current = setTimeout(flushComparisonProgress, 1000)
  }, [flushComparisonProgress])
  useEffect(() => {
    window.addEventListener('pagehide', flushComparisonProgress)
    return () => { window.removeEventListener('pagehide', flushComparisonProgress); flushComparisonProgress() }
  }, [flushComparisonProgress])

  useEffect(() => {
    if (!session) return
    const deviceId = getDeviceId()
    const cleanup = connectLiveSync(session, deviceId, () => {
      void synchronize(session, true)
    })
    return cleanup
  }, [session, synchronize])


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
    const activeSession = sessionRef.current
    try {
      await mutate(selectedProfile, 'reading_sessions', androidRecordId('reading_sessions', tracked.id), payload, false, tracked.localOnly)
      await refreshLocal(selectedProfile).catch(() => {})
      if (activeSession && navigator.onLine && !tracked.localOnly) void synchronize(activeSession, true)
    } catch {
      if (profileRef.current === selectedProfile) setNotice(lang === 'vi'
        ? 'Không lưu được thời gian đọc. Kiểm tra bộ nhớ trình duyệt rồi thử lại.'
        : 'Could not save reading time. Check browser storage and try again.')
    }
  }, [refreshLocal, synchronize, lang])

  useEffect(() => {
    const restoreSession = () => {
      const next = readSession()
      const current = sessionRef.current
      if (current?.token !== next?.token) {
        setEntitlement(null)
        if (profileFor(current) !== profileFor(next)) {
          // Close the old reader before changing profile, keeping its progress in its own library.
          resetAccountView()
        }
        sessionRef.current = next
        profileRef.current = profileFor(next)
      }
      if (JSON.stringify(current) !== JSON.stringify(next)) setSession(next)
    }
    const onStorage = (event: StorageEvent) => {
      if (event.storageArea === localStorage && (event.key === SESSION_STORAGE_KEY || event.key === null)) restoreSession()
    }
    const onVisible = () => { if (document.visibilityState === 'visible') restoreSession() }
    window.addEventListener('storage', onStorage)
    window.addEventListener('focus', restoreSession)
    document.addEventListener('visibilitychange', onVisible)
    return () => {
      window.removeEventListener('storage', onStorage)
      window.removeEventListener('focus', restoreSession)
      document.removeEventListener('visibilitychange', onVisible)
    }
  }, [resetAccountView])

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
      if (!active || sessionRef.current?.token !== token) return
      const stored = readSession()
      if (stored && stored.token !== token) return
      if (error?.status === 401 || error?.status === 403) { invalidateSession(token); setNotice(translate("Phiên đăng nhập đã hết hạn. Dữ liệu trên trình duyệt vẫn được giữ riêng.", lang)) }
      else setNotice(readableError(error, lang))
    })
    return () => { active = false }
    // Only verify when the account identity changes; sync retries use the online event.
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [sessionToken, synchronize, lang, invalidateSession])

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
        void persistReadingProgress(curProfile, book, loc, curSession)
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

    const onPageHide = () => {
      flushReadingProgress()
      const book = readerRef.current
      if (book) void completeReadingSession(book, locationRef.current?.progression || 0)
    }
    const onPageShow = () => {
      const book = readerRef.current
      if (book && document.visibilityState === 'visible' && !readingSessionRef.current) beginReadingSession(book, locationRef.current?.progression || 0)
    }

    const interval = setInterval(() => {
      const curSession = sessionRef.current
      if (curSession && navigator.onLine && document.visibilityState === 'visible' && Date.now() - lastSyncAt.current > 45000) {
        void synchronize(curSession, true)
      }
    }, 45000)

    document.addEventListener('visibilitychange', onVisibilityChange)
    window.addEventListener('focus', onFocus)
    window.addEventListener('pagehide', onPageHide)
    window.addEventListener('pageshow', onPageShow)

    return () => {
      document.removeEventListener('visibilitychange', onVisibilityChange)
      window.removeEventListener('focus', onFocus)
      window.removeEventListener('pagehide', onPageHide)
      window.removeEventListener('pageshow', onPageShow)
      clearInterval(interval)
    }
  }, [synchronize, persistReadingProgress, beginReadingSession, completeReadingSession])

  const cloudBooks = useMemo(() => records.map(syncedBook).filter((book): book is Book => !!book && !!book.id && !catalog.some(item => item.id === book.id)), [records, catalog])
  const browserBooks = useMemo(() => {
    const deletedCatalogIds = new Set(records.filter(record => record.kind === 'catalog_books' && record.deleted).map(record => record.id))
    return localFiles.filter(file => file.book.source !== 'cloud' || !deletedCatalogIds.has(androidRecordId('catalog_books', file.book.id))).map(file => file.book)
  }, [localFiles, records])
  const books = useMemo(() => mergeBooksById(catalog, browserBooks, cloudBooks), [catalog, cloudBooks, browserBooks])
  const routeBook = route.kind === 'book' || route.kind === 'read' ? books.find(book => book.id === route.bookId) : undefined
  useEffect(() => {
    if (route.kind === 'page' || route.kind === 'notFound') {
      routeAttemptRef.current = null
      setSelectedBook(null)
      if (readerRef.current || openingBookRef.current) closeReaderRef.current()
      return
    }
    if (route.kind === 'book') {
      routeAttemptRef.current = null
      if (readerRef.current || openingBookRef.current) closeReaderRef.current()
      setSelectedBook(routeBook || null)
      return
    }
    setSelectedBook(null)
    if (loadedProfile !== profile || !routeBook || readerRef.current?.id === route.bookId || openingBookRef.current === route.bookId) return
    const attempt = `${profile}:${route.bookId}`
    if (routeAttemptRef.current === attempt) return
    routeAttemptRef.current = attempt
    void openBookRef.current(routeBook)
  }, [route, routeBook, profile, loadedProfile])
  const favorites = useMemo(() => new Set(records.filter(r => r.kind === 'favorites' && !r.deleted).map(r => toText(r.payload.book_id))), [records])
  const reading = useMemo(() => books.filter(book => !!progressFor(records, book.id)).sort((a, b) => Number(progressFor(records, b.id)?.payload.last_read_at || 0) - Number(progressFor(records, a.id)?.payload.last_read_at || 0)), [books, records])
  const libraryBooks = useMemo(() => books.filter(book => book.source === 'local' || book.source === 'cloud' || offlineIds.has(book.id) || favorites.has(book.id) || !!progressFor(records, book.id)), [books, offlineIds, favorites, records])
  const tags = useMemo(() => records.filter(record => record.kind === 'tags' && !record.deleted).map(record => ({ id: toText(record.payload.id), name: toText(record.payload.name) })).filter(item => item.id && item.name), [records])
  const collections = useMemo(() => records.filter(record => record.kind === 'collections' && !record.deleted).map(record => ({ id: toText(record.payload.id), name: toText(record.payload.name) })).filter(item => item.id && item.name), [records])
  const bookTags = useMemo(() => {
    const map = new Map<string, Set<string>>()
    for (const record of records) {
      if (record.kind === 'book_tag_cross_ref' && !record.deleted) {
        const bookId = toText(record.payload.book_id)
        const tagId = toText(record.payload.tag_id)
        if (bookId && tagId) {
          if (!map.has(bookId)) map.set(bookId, new Set())
          map.get(bookId)!.add(tagId)
        }
      }
    }
    return map
  }, [records])
  const bookCollections = useMemo(() => {
    const map = new Map<string, Set<string>>()
    for (const record of records) {
      if (record.kind === 'book_collection_cross_ref' && !record.deleted) {
        const bookId = toText(record.payload.book_id)
        const colId = toText(record.payload.collection_id)
        if (bookId && colId) {
          if (!map.has(bookId)) map.set(bookId, new Set())
          map.get(bookId)!.add(colId)
        }
      }
    }
    return map
  }, [records])
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
  }, [page, libraryBooks, catalog, category, query, sortOrder, records, shelfFilter, favorites, organizationFilter])
  const annotations = useMemo(() => records.filter(r => !r.deleted && (r.kind === 'highlights' || r.kind === 'bookmarks')).sort((a, b) => Number(b.payload.created_at || 0) - Number(a.payload.created_at || 0)), [records])
  const readerAnnotations = useMemo(() => {
    if (!reader) return []
    const saved = records.filter(record => record.kind === 'highlights' && !record.deleted && record.payload.book_id === reader.book.id).map(record => ({
      id: record.id,
      locatorJson: toText(record.payload.locator_json),
      text: toText(record.payload.text),
      color: toText(record.payload.color) || 'YELLOW',
    }))
    return activeSearchHit ? [...saved, { id: 'nocap-search-active', locatorJson: activeSearchHit.locatorJson, text: activeSearchHit.text, color: 'BLUE' }] : saved
  }, [reader, records, activeSearchHit])
  const readerNotes = useMemo(() => reader ? annotations.filter(record => record.profile === profile && record.kind === 'highlights' && record.payload.book_id === reader.book.id) : [], [annotations, reader, profile])
  const currentBookmarked = !!(reader && location && records.some(record => record.kind === 'bookmarks' && !record.deleted && record.payload.book_id === reader.book.id && record.payload.locator_json === location.locatorJson))
  const reviewItems = useMemo(() => records.filter(record => record.kind === 'review_items' && !record.deleted), [records])
  const dueReviewCount = useMemo(() => {
    const byAnnotation = new Map(reviewItems.map(item => [toText(item.payload.annotation_id), item]))
    return annotations.filter(annotation => {
      if (annotation.kind !== 'highlights') return false
      const item = byAnnotation.get(toText(annotation.payload.id) || annotation.id)
      return !!item && reviewIsDue(item.payload as unknown as ReviewItemPayload)
    }).length
  }, [annotations, reviewItems])
  const readingSessions = useMemo(() => records.filter(record => record.kind === 'reading_sessions' && !record.deleted && Number(record.payload.duration_ms) >= 5000), [records])
  const totalReadingMinutes = Math.round(readingSessions.reduce((sum, record) => sum + Number(record.payload.duration_ms || 0), 0) / 60000)
  const activity = useMemo(() => readingActivity(readingSessions.map(record => Number(record.payload.started_at)), new Date(statsNow)), [readingSessions, statsNow])
  const readingDayCount = activity.activeDays
  const readingStreak = activity.streak

  async function authenticated(value: Session) {
    closeReaderRef.current()
    if (preferenceTimer.current) clearTimeout(preferenceTimer.current)
    setRecords([]); setLocalFiles([]); setOfflineIds(new Set())
    sessionRef.current = value; profileRef.current = profileFor(value)
    saveSession(value); setSession(value); setAuthOpen(false)
    if (route.kind !== 'book' && route.kind !== 'read' && !(route.kind === 'page' && route.page === 'admin')) setPage('home')
    setNotice(curT.auth.signedIn(value.user.email))
  }

  async function signOut() {
    const oldToken = sessionRef.current?.token
    resetAccountView()
    saveSession(null); sessionRef.current = null; profileRef.current = profileFor(null)
    setSession(null); setEntitlement(null)
    setNotice(translate("Đã đăng xuất. Dữ liệu tài khoản được giữ riêng và không bị xóa.", lang))
    if (oldToken) void logout(oldToken).catch(() => {})
  }

  async function handleUpdateDisplayName() {
    if (!session || !editNameInput.trim()) return
    const isCurrent = () => sessionRef.current?.token === session.token && readSession()?.token === session.token
    setSavingName(true)
    try {
      const updated = await updateProfile(session.token, { displayName: editNameInput.trim() })
      if (!isCurrent()) return
      const newSession: Session = { ...session, user: updated }
      saveSession(newSession)
      setSession(newSession)
      setEditNameOpen(false)
      setNotice(lang === 'vi' ? 'Đã cập nhật tên tài khoản thành công.' : 'Account name updated successfully.')
    } catch (err) {
      if (isCurrent()) setNotice(readableError(err, lang))
    } finally {
      if (isCurrent()) setSavingName(false)
    }
  }

  async function handleDeleteAccount() {
    if (!session) return
    const isCurrent = () => sessionRef.current?.token === session.token && readSession()?.token === session.token
    setDeleteAccountBusy(true)
    try {
      await deleteAccount(session.token)
      if (!isCurrent()) return
      saveSession(null)
      setSession(null)
      setRecords([])
      setLocalFiles([])
      setOfflineIds(new Set())
      openRequestId.current++
      setReader(null)
      readerRef.current = null
      setConflicts([])

      setPage('home')
      setDeleteAccountOpen(false)
      setNotice(lang === 'vi' ? 'Tài khoản của bạn đã được xóa thành công.' : 'Your account has been deleted.')
    } catch (err) {
      if (!isCurrent()) return
      if (err instanceof ApiError && err.status === 401) {
        setDeleteAccountOpen(false)
        setNotice(lang === 'vi' ? 'Vui lòng đăng nhập lại trước khi xóa tài khoản để xác minh bảo mật.' : 'Please sign in again before deleting your account.')
        setAuthOpen(true)
      } else {
        setNotice(readableError(err, lang))
      }
    } finally {
      if (isCurrent()) setDeleteAccountBusy(false)
    }
  }

  async function handleResolveConflict(key: string, strategy: 'keep_local' | 'take_remote') {
    if (!session) return
    const targetProfile = profileFor(session)
    const token = session.token
    const isCurrent = () => profileRef.current === targetProfile && sessionRef.current?.token === token
    try {
      await resolveConflict(session, key, strategy)
      if (!isCurrent()) return
      const nextConflicts = await getConflicts(targetProfile)
      if (!isCurrent()) return
      setConflicts(nextConflicts)
      if (!nextConflicts.length) {
        setConflictModalOpen(false)
        setNotice(lang === 'vi' ? 'Đã giải quyết xung đột đồng bộ.' : 'Sync conflicts resolved.')
      } else {
        setNotice(lang === 'vi' ? `${nextConflicts.length} xung đột đồng bộ cần giải quyết.` : `${nextConflicts.length} sync conflicts need your attention.`)
      }
      void refreshLocal(profileFor(session))
      void synchronize(session, true)
    } catch (err) {
      if (isCurrent()) {
        setNotice(readableError(err, lang))
        const latest = await getConflicts(targetProfile).catch(() => null)
        if (isCurrent() && latest) setConflicts(latest)
      }
    }
  }

  async function changeOrganization(kind: 'tags' | 'collections', id: string, payload: Record<string, unknown>, deleted = false, onSaved?: () => void) {
    if (organizationFlight.current) return
    const flight = {}
    organizationFlight.current = flight
    setOrganizationBusy(true)
    const targetProfile = profile
    const token = session?.token
    const isCurrent = () => profileRef.current === targetProfile && sessionRef.current?.token === token && readSession()?.token === token
    try {
      await mutate(targetProfile, kind, androidRecordId(kind, id), payload, deleted, !session)
      broadcastSyncRequired(targetProfile)
      if (!isCurrent()) return
      onSaved?.()
      await refreshLocal(targetProfile)
      if (isCurrent() && session) void synchronize(session, true)
    } catch (error) {
      if (isCurrent()) setNotice(readableError(error, lang))
    } finally {
      if (organizationFlight.current === flight) {
        organizationFlight.current = null
        setOrganizationBusy(false)
      }
    }
  }

  async function handleCreateTag() {
    if (!newTagName.trim()) return
    const id = crypto.randomUUID()
    const name = newTagName.trim()
    await changeOrganization('tags', id, { id, name, created_at: ms() }, false,
      () => setNewTagName(current => current.trim() === name ? '' : current))
  }

  async function handleDeleteTag(tagId: string) {
    await changeOrganization('tags', tagId, { id: tagId }, true)
  }

  async function handleCreateCollection() {
    if (!newCollectionName.trim()) return
    const id = crypto.randomUUID()
    const name = newCollectionName.trim()
    await changeOrganization('collections', id, { id, name, created_at: ms() }, false,
      () => setNewCollectionName(current => current.trim() === name ? '' : current))
  }

  async function handleDeleteCollection(colId: string) {
    await changeOrganization('collections', colId, { id: colId }, true)
  }

  async function handleUpdateTag(tagId: string, name: string) {
    if (!name.trim()) return
    const existing = records.find(r => r.kind === 'tags' && !r.deleted && (r.payload.id === tagId || r.id === androidRecordId('tags', tagId)))
    const payload = { ...(existing?.payload || {}), id: tagId, name: name.trim(), updated_at: ms() }
    await changeOrganization('tags', tagId, payload, false,
      () => setEditingItemId(current => current === tagId ? null : current))
  }

  async function handleUpdateCollection(colId: string, name: string) {
    if (!name.trim()) return
    const existing = records.find(r => r.kind === 'collections' && !r.deleted && (r.payload.id === colId || r.id === androidRecordId('collections', colId)))
    const payload = { ...(existing?.payload || {}), id: colId, name: name.trim(), updated_at: ms() }
    await changeOrganization('collections', colId, payload, false,
      () => setEditingItemId(current => current === colId ? null : current))
  }

  async function handleToggleBookTag(bookId: string, tagId: string) {
    const isAssigned = bookTags.get(bookId)?.has(tagId)
    const recId = androidCompositeRecordId('book_tag_cross_ref', [bookId, tagId])
    await mutate(profile, 'book_tag_cross_ref', recId, { book_id: bookId, tag_id: tagId, created_at: ms() }, !!isAssigned, !session)
    broadcastSyncRequired(profile)
    await refreshLocal(profile)
    if (session) void synchronize(session, true)
  }

  async function handleToggleBookCollection(bookId: string, colId: string) {
    const isAssigned = bookCollections.get(bookId)?.has(colId)
    const recId = androidCompositeRecordId('book_collection_cross_ref', [bookId, colId])
    await mutate(profile, 'book_collection_cross_ref', recId, { book_id: bookId, collection_id: colId, created_at: ms() }, !!isAssigned, !session)
    broadcastSyncRequired(profile)
    await refreshLocal(profile)
    if (session) void synchronize(session, true)
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
      }).catch(error => setNotice(readableError(error, lang)))
    }, 350)
  }

async function sha256Hex(file: Blob): Promise<string> {
  const buffer = await file.arrayBuffer()
  const digestBuffer = await crypto.subtle.digest('SHA-256', buffer)
  return Array.from(new Uint8Array(digestBuffer), b => b.toString(16).padStart(2, '0')).join('')
}

  async function importFile(file: File, sourceUrl?: string): Promise<boolean> {
    if (profileRef.current !== profile) return false
    const extension = file.name.split('.').pop()?.toLowerCase() || ''
    if (!['epub', 'pdf', 'cbz', 'txt', 'md', 'markdown', 'html', 'htm', 'docx', 'jpg', 'jpeg', 'png', 'webp'].includes(extension)) { setNotice(translate("Hỗ trợ EPUB, PDF, CBZ, TXT, Markdown, HTML, DOCX, JPG, PNG và WebP.", lang)); return false }
    if (!file.size || file.size > 250 * 1024 * 1024) { setNotice(translate("Tệp trống hoặc vượt giới hạn 250 MB.", lang)); return false }
    setNotice(translate("Đang tính mã băm và chuẩn bị tài liệu...", lang))
    try {
      const hash = await sha256Hex(file)
      if (profileRef.current !== profile) return false
      const isCloud = !!session
      const bookId = `web-${crypto.randomUUID()}`
      const book: Book = {
        id: bookId,
        title: file.name.replace(/\.[^.]+$/, ''),
        author: translate("Tài liệu của bạn", lang),
        fileUrl: `nocap-private:${hash}`,
        format: extension.toUpperCase(),
        categoryId: 'imported',
        source: isCloud ? 'cloud' : 'local',
        fileSizeBytes: file.size,
      }
      const importedRecords: Array<{ record: SyncRecord; sync: boolean }> = []
      if (isCloud && session) {
        const mediaType = extension === 'pdf' ? 'application/pdf'
          : extension === 'cbz' ? 'application/vnd.comicbook+zip'
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
          source_type: sourceUrl ? 'REMOTE_URL' : 'LOCAL_FILE',
          source_url: sourceUrl || null,
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
        const id = androidRecordId('catalog_books', book.id)
        importedRecords.push({ record: { key: keyFor(profile, `catalog_books:${id}`), profile, kind: 'catalog_books', id, version: 0, deleted: false, payload }, sync: true })
      }
      // Reuse the atomic file/record/pending transaction. The existing sync queue
      // uploads private bytes before publishing metadata and retains failed uploads.
      await applyLibraryRestore(profile, importedRecords, [{ key: keyFor(profile, book.id), profile, book, data: file, addedAt: ms() }], [])
      await refreshLocal(profile)
      if (profileRef.current !== profile) return false
      setQuery(''); setCategory('all'); setShelfFilter('all'); setOrganizationFilter('all')
      setPage('library')
      trackWebFeature('import', 'library')
      if (isCloud && session) {
        setNotice(lang === 'vi' ? 'Đã thêm tài liệu. Tệp sẽ được tự động tải lên Cloud khi có kết nối.' : 'Document added. It will automatically upload to Cloud when connected.')
        broadcastSyncRequired(profile)
        if (navigator.onLine) void synchronize(session, true)
      } else {
        setNotice(translate("Đã thêm tài liệu vào trình duyệt này. Đăng nhập để tự động sao lưu lên Cloud.", lang))
      }
      return true
    } catch {
      if (profileRef.current === profile) setNotice(lang === 'vi'
        ? 'Không lưu được tệp. Bộ nhớ trình duyệt có thể đang bị gián đoạn hoặc không đủ dung lượng.'
        : 'Could not save the file. Browser storage may be temporarily unavailable or out of space.')
      return false
    }
  }

  async function openBook(book: Book, initialOverride?: string): Promise<boolean> {
    if (readerRef.current && readerRef.current.id !== book.id) closeReaderRef.current()
    openController.current?.abort()
    const controller = new AbortController()
    openController.current = controller
    if (route.kind === 'page') backgroundPageRef.current = route.page
    openingBookRef.current = book.id
    routeAttemptRef.current = `${profile}:${book.id}`
    if (route.kind !== 'read' || route.bookId !== book.id) navigate({ kind: 'read', bookId: book.id })
    const requestId = ++openRequestId.current
    const targetProfile = profile
    if (progressTimer.current) clearTimeout(progressTimer.current)
    setReaderError(''); setReaderLoading(true); setLocation(null); setSelection(null); setStealthProgressRequest(null); setControls(null); setToc([]); setNavigateTarget(null)
    setNoteOpen(false); resetReaderNoteDraft(); setNoteNavigation(null); noteFlight.current = null; setNoteSaving(false)
    setSearchOpen(false); setReaderSearchSource(null); setActiveSearchHit(null)
    setSpeechOpen(false); setReaderSpeechSource(null)
    try {
      const [localResult, offlineResult] = await Promise.allSettled([
        getFile(profile, book.id),
        getOfflineBook(offlineProfileFor(book, profile), book.id),
      ])
      const stored = localResult.status === 'fulfilled' ? localResult.value : undefined
      const local = currentLocalFile(book, stored)
      const offlineCopy = (!stored || local) && offlineResult.status === 'fulfilled' ? offlineResult.value : undefined
      if (!local && !offlineCopy && (book.source === 'local' || book.fileUrl?.startsWith('nocap-private:')) && localResult.status === 'rejected') {
        throw new Error(lang === 'vi'
          ? 'Bộ nhớ trình duyệt vừa bị đóng. Hãy tải lại trang rồi mở tài liệu riêng này.'
          : 'Browser storage was closed. Reload the page, then open this private document again.')
      }
      controller.signal.throwIfAborted()
      const bytes = local ? await local.data.arrayBuffer() : offlineCopy ? await offlineCopy.data.arrayBuffer() : await loadBookBytes(book, session?.token, { signal: controller.signal })
      if (profileRef.current !== targetProfile || openRequestId.current !== requestId) return false
      if (!bytes.byteLength) throw new Error(translate("Tệp sách không có nội dung.", lang))
      const savedComfort = comfortFromRecord(records.find(record => record.kind === 'per_book_preferences' && !record.deleted && record.payload.book_id === book.id), readerWidth)
      if (savedComfort) applyComfort(savedComfort)
      const savedProgress = progressFor(records, book.id)
      const checkpoint = readStealthCheckpoint(targetProfile, book.id)
      const useCheckpoint = !initialOverride && checkpoint && checkpoint.updatedAt > Number(savedProgress?.payload.last_read_at || 0)
      const initialProgress = useCheckpoint ? checkpoint.progression : Number(savedProgress?.payload.progression || 0)
      beginReadingSession(book, initialProgress)
      readerRef.current = book
      const initialLoc = initialOverride || (useCheckpoint ? stealthLocator(checkpoint) : toText(savedProgress?.payload.locator_json))
      locationRef.current = { locatorJson: initialLoc, progression: initialProgress, chapterTitle: '' }
      setLocation(locationRef.current)
      setReader({ book, bytes, initial: initialLoc })
      const draft = readReaderNoteDraft(targetProfile, book.id)
      if (draft) {
        resetReaderNoteDraft(draft)
        setNoteOpen(true)
      }
      const savingDraft = noteFlights.current.get(keyFor(targetProfile, book.id))
      if (savingDraft) { noteFlight.current = savingDraft; setNoteSaving(true) }
      trackWebFeature('book_open', 'reader')
      return true
    } catch (error) {
      if (profileRef.current === targetProfile && openRequestId.current === requestId) setReaderError(readableError(error, lang))
      return false
    }
    finally {
      if (openRequestId.current === requestId) {
        openController.current = null
        setReaderLoading(false)
        openingBookRef.current = null
      }
    }
  }
  openBookRef.current = openBook

  async function downloadBook(book: Book) {
    if (downloadActive.current) return
    downloadActive.current = true
    const targetProfile = profile
    setDownloadBusy(book.id)
    try {
      const originalFilename = records.find(record => record.kind === 'catalog_books' && !record.deleted && record.payload.id === book.id)?.payload.original_filename
      const file = await prepareBookDownload(book, targetProfile, session?.token, typeof originalFilename === 'string' ? originalFilename : undefined)
      if (profileRef.current !== targetProfile) return
      saveBookDownload(file)
      setNotice(curT.download.started(file.filename))
      trackWebFeature('download')
    } catch (error) { if (profileRef.current === targetProfile) setNotice(readableError(error, lang)) }
    finally { downloadActive.current = false; setDownloadBusy(null) }
  }

  const recordLocation = useCallback((next: ReaderLocation) => {
    setLocation(next)
    locationRef.current = next
    const book = readerRef.current
    if (!book) return
    if (progressTimer.current) clearTimeout(progressTimer.current)
    const currentProfile = profileRef.current
    const currentSession = sessionRef.current
    progressTimer.current = setTimeout(() => {
      progressTimer.current = null
      void persistReadingProgress(currentProfile, book, next, currentSession)
    }, 1500)
  }, [persistReadingProgress])

  const onLocation = useCallback((next: ReaderLocation) => {
    // The normal reader stays mounted underneath the disguise. Its layout or
    // scroll callbacks must not overwrite the Excel row currently being read.
    if (!stealthActiveRef.current) recordLocation(next)
  }, [recordLocation])

  const onStealthProgressChange = useCallback((position: StealthPosition) => {
    const next: ReaderLocation = {
      locatorJson: stealthLocator(position),
      progression: position.progression,
      chapterTitle: locationRef.current?.chapterTitle || '',
    }
    recordLocation(next)
  }, [recordLocation])

  const closeStealthReader = useCallback((position?: StealthPosition) => {
    setStealthGrant(null)
    if (position) {
      onStealthProgressChange(position)
      const book = readerRef.current
      const current = locationRef.current
      if (progressTimer.current) { clearTimeout(progressTimer.current); progressTimer.current = null }
      if (book && current) void persistReadingProgress(profileRef.current, book, current, sessionRef.current)
      setStealthProgressRequest(previous => ({
        progression: Math.min(1, Math.max(0, position.progression)),
        requestId: (previous?.requestId || 0) + 1,
        href: position.sourceHref,
      }))
    }
  }, [onStealthProgressChange, persistReadingProgress])

  useEffect(() => {
    if (!stealthGrant) return
    const revokeAccess = () => {
      const current = locationRef.current
      let sourceHref: string | undefined
      try { sourceHref = JSON.parse(current?.locatorJson || '{}').href } catch { /* No saved section. */ }
      closeStealthReader(current ? { progression: current.progression, sourceHref } : undefined)
      if (sessionRef.current?.token === stealthGrant.token && readerRef.current?.id === stealthGrant.bookId) setProRequiredFeature('STEALTH_READING')
    }
    if (!stealthActive || !entitlement || !session) { revokeAccess(); return }
    const timer = window.setTimeout(revokeAccess, Math.max(0, proAccessExpiresAt(entitlement, session) - ms()))
    return () => window.clearTimeout(timer)
  }, [stealthGrant, stealthActive, entitlement, session, closeStealthReader])

  function closeReader() {
    openRequestId.current++
    openController.current?.abort()
    openController.current = null
    openingBookRef.current = null
    setReaderLoading(false)
    setReaderError('')
    if (progressTimer.current) { clearTimeout(progressTimer.current); progressTimer.current = null }
    const loc = locationRef.current || location
    const book = readerRef.current
    if (book && loc) {
      void completeReadingSession(book, loc.progression)
      void persistReadingProgress(profileRef.current, book, loc, sessionRef.current)
    }
    if (book && !loc) void completeReadingSession(book, 0)
    setReader(null); readerRef.current = null; locationRef.current = null; setSelection(null); setStealthGrant(null); setStealthProgressRequest(null); setControls(null)
    setToc([]); setTocOpen(false); setSettingsOpen(false); setNoteOpen(false); setNavigateTarget(null)
    resetReaderNoteDraft(); setNoteNavigation(null); noteFlight.current = null; setNoteSaving(false)
    setSearchOpen(false); setReaderSearchSource(null); setActiveSearchHit(null)
    setSpeechOpen(false); setReaderSpeechSource(null)
  }
  closeReaderRef.current = closeReader

  async function toggleFavorite(book: Book) {
    const targetProfile = profile
    const activeSession = session
    const flightKey = keyFor(targetProfile, book.id)
    if (favoriteFlights.current.has(flightKey)) return
    favoriteFlights.current.add(flightKey)
    const isCurrent = () => profileRef.current === targetProfile && sessionRef.current?.token === activeSession?.token
    const value = !favorites.has(book.id)
    try {
      await mutate(targetProfile, 'favorites', androidRecordId('favorites', book.id), { book_id: book.id, added_at: ms(), sync_version: 1 }, !value, book.source === 'local')
      await refreshLocal(targetProfile).catch(() => {})
      if (isCurrent() && activeSession && online && book.source !== 'local') void synchronize(activeSession, true)
    } catch (error) { if (isCurrent()) setNotice(readableError(error, lang)) }
    finally { favoriteFlights.current.delete(flightKey) }
  }

  async function toggleBookmark() {
    if (!reader || !location) return
    const targetProfile = profile
    const activeSession = session
    const book = reader.book
    const targetLocation = location
    const flightKey = keyFor(targetProfile, book.id)
    if (bookmarkFlights.current.has(flightKey)) return
    bookmarkFlights.current.add(flightKey)
    setBookmarkSaving(flightKey)
    const isCurrent = () => profileRef.current === targetProfile && sessionRef.current?.token === activeSession?.token && readerRef.current?.id === book.id
    const existing = records.find(r => r.kind === 'bookmarks' && !r.deleted && r.payload.book_id === book.id && r.payload.locator_json === targetLocation.locatorJson)
    try {
      if (existing) {
        await mutate(targetProfile, 'bookmarks', existing.id, {}, true, book.source === 'local')
      } else {
        const id = crypto.randomUUID()
        await mutate(targetProfile, 'bookmarks', androidRecordId('bookmarks', id), { id, book_id: book.id, locator_json: targetLocation.locatorJson, chapter_title: targetLocation.chapterTitle || '', snippet: null, created_at: ms(), sync_version: 1, is_deleted: 0 }, false, book.source === 'local')
      }
      await refreshLocal(targetProfile).catch(() => {})
      if (!isCurrent()) return
      setNotice(translate(existing ? "Đã bỏ dấu trang tại vị trí này." : "Đã thêm dấu trang.", lang))
      if (activeSession && online && book.source !== 'local') void synchronize(activeSession, true)
    } catch (error) { if (isCurrent()) setNotice(readableError(error, lang)) }
    finally {
      bookmarkFlights.current.delete(flightKey)
      setBookmarkSaving(current => current === flightKey ? null : current)
    }
  }

  async function saveNote() {
    const anchor = selection ? { locatorJson: selection.locator, chapterTitle: '', progression: 0 } : noteAnchor.current || locationRef.current
    if (!reader || !anchor || (!noteText.trim() && !selection?.text && !hasDrawing(noteDrawing)) || noteFlight.current || noteFlights.current.has(keyFor(profile, reader.book.id))) return
    const flight = {}
    noteFlight.current = flight
    const targetProfile = profile
    const activeSession = session
    const targetBook = reader.book
    const flightKey = keyFor(targetProfile, targetBook.id)
    noteFlights.current.set(flightKey, flight)
    const draftSnapshot = noteDraft.current
    const isCurrent = () => noteFlight.current === flight && profileRef.current === targetProfile && sessionRef.current?.token === activeSession?.token && readerRef.current?.id === targetBook.id
    setNoteSaving(true)
    try {
      const id = crypto.randomUUID()
      const selected = selection?.text || anchor.chapterTitle || translate("Ghi chú tại vị trí đọc", lang)
      const drawing = noteDrawing === null ? null : parseDrawing(noteDrawing)
      if (noteDrawing !== null && !drawing) throw new Error(translate('Bản vẽ không hợp lệ. Vui lòng vẽ lại.', lang))
      const payload = { id, book_id: targetBook.id, locator_json: anchor.locatorJson, text: selected, color: noteColor, note: noteText.trim().slice(0, 10000), ...(drawing && hasDrawing(drawing) ? { drawing } : {}), created_at: ms(), updated_at: ms() }
      if (JSON.stringify(payload).length > 32768) throw new Error(translate('Ghi chú và bản vẽ quá lớn để đồng bộ. Hãy rút ngắn ghi chú hoặc giảm nét vẽ.', lang))
      const recordId = androidRecordId('highlights', id)
      await mutate(targetProfile, 'highlights', recordId, payload, false, targetBook.source === 'local')
      clearReaderNoteDraft(targetProfile, targetBook.id, draftSnapshot)
      broadcastSyncRequired(targetProfile)
      // A committed note must not be offered for retry when refreshing the list fails.
      await refreshLocal(targetProfile).catch(() => {})
      if (!isCurrent()) return
      const key = keyFor(targetProfile, `highlights:${recordId}`)
      setRecords(current => current.some(record => record.key === key) ? current : [...current, { key, profile: targetProfile, kind: 'highlights', id: recordId, version: 0, deleted: false, payload }])
      // Reopening can restore a newer draft written by another tab while this
      // save was pending. Only clear the exact content that was committed.
      if (JSON.stringify(noteDraft.current) === JSON.stringify(draftSnapshot)) resetReaderNoteDraft()
      setNotice(translate("Đã lưu ghi chú.", lang))
      trackWebFeature('note_save', 'reader')
      if (activeSession && online && targetBook.source !== 'local') void synchronize(activeSession)
    } catch (error) { if (isCurrent()) setNotice(readableError(error, lang)) }
    finally {
      if (noteFlights.current.get(flightKey) === flight) noteFlights.current.delete(flightKey)
      if (noteFlight.current === flight) { noteFlight.current = null; setNoteSaving(false) }
    }
  }

  function selectReaderPassage(text: string, locator: string) {
    if (noteFlight.current) return
    changeReaderNoteDraft({ selection: { text, locator }, anchor: { locatorJson: locator, progression: locationRef.current?.progression || 0, chapterTitle: locationRef.current?.chapterTitle || '' } }); setNoteOpen(true)
    setSearchOpen(false); setActiveSearchHit(null)
  }

  function resetReaderNoteDraft(draft = emptyReaderNoteDraft()) {
    noteDraft.current = draft
    noteAnchor.current = draft.anchor
    setNoteText(draft.note); setNoteDrawing(draft.drawing); setNoteColor(draft.color); setSelection(draft.selection)
  }

  function changeReaderNoteDraft(changes: Partial<ReaderNoteDraft>) {
    if (noteFlight.current) return
    const draft = { ...noteDraft.current, ...changes }
    resetReaderNoteDraft(draft)
    const book = readerRef.current
    if (book && !writeReaderNoteDraft(profileRef.current, book.id, draft)) setNotice(lang === 'vi'
      ? 'Chưa giữ được bản nháp trên trình duyệt. Hãy bấm Lưu ghi chú trước khi đóng trang.'
      : 'The browser could not retain this draft. Save the note before closing the page.')
  }

  function changeReaderNote(value: string) {
    const anchor = !noteDraft.current.note && !hasDrawing(noteDraft.current.drawing) && value && !noteDraft.current.selection ? locationRef.current : noteDraft.current.anchor
    changeReaderNoteDraft({ note: value, anchor })
  }

  function changeReaderDrawing(value: Drawing | null) {
    const anchor = !noteDraft.current.note && !hasDrawing(noteDraft.current.drawing) && hasDrawing(value) && !noteDraft.current.selection ? locationRef.current : noteDraft.current.anchor
    changeReaderNoteDraft({ drawing: value, anchor })
  }

  function navigateToReaderNote(record: SyncRecord) {
    if (record.profile !== profile || record.payload.book_id !== readerRef.current?.id) return
    const locatorJson = toText(record.payload.locator_json)
    if (locatorJson) {
      setStealthProgressRequest(null); setNavigateTarget(null)
      setNoteNavigation({ locatorJson, requestId: ++noteNavigationId.current })
    }
  }

  function navigateToSearchHit(hit: ReaderSearchHit) {
    setActiveSearchHit(hit)
    setStealthProgressRequest(null); setNavigateTarget(null)
    setNoteNavigation({ locatorJson: hit.locatorJson, requestId: ++noteNavigationId.current })
  }

  async function changeReaderAnnotation(record: SyncRecord, changes?: AnnotationChanges) {
    const targetProfile = profile
    const targetBook = readerRef.current
    const activeSession = session
    if (!targetBook || record.profile !== targetProfile || record.payload.book_id !== targetBook.id) return
    const localOnly = targetBook.source === 'local'
    try {
      if (changes) await updateAnnotation(targetProfile, record, changes, localOnly)
      else await deleteAnnotation(targetProfile, record, localOnly)
      broadcastSyncRequired(targetProfile)
      await refreshLocal(targetProfile)
      if (activeSession && online && !localOnly && profileRef.current === targetProfile && sessionRef.current?.token === activeSession.token) void synchronize(activeSession, true)
    } catch (error) { throw new Error(readableError(error, lang)) }
  }

  async function exportPdf() {
    if (!annotations.length || pdfExportActive.current) return
    pdfExportActive.current = true
    setPdfExportBusy(true)
    const targetProfile = profileRef.current
    try {
      const access = await requireProFeature('KNOWLEDGE_EXPORT')
      if (!access || profileRef.current !== targetProfile) return
      const { prepareNotesPdf } = await importWithChunkRecovery(() => import('./notesPdf'))
      if (sessionRef.current?.token !== access.session.token || profileRef.current !== targetProfile) return
      const download = await prepareNotesPdf(annotations, books, lang)
      if (sessionRef.current?.token !== access.session.token || profileRef.current !== targetProfile || !allowsPro(access.entitlement, sessionRef.current)) return
      saveBookDownload(download)
      setNotice(translate('Đã xuất trích dẫn và ghi chú ra tệp PDF.', lang))
    } catch {
      if (profileRef.current === targetProfile) setNotice(translate('Không xuất được PDF. Vui lòng thử lại.', lang))
    } finally { pdfExportActive.current = false; setPdfExportBusy(false) }
  }

  async function requireProFeature(feature: ProFeature) {
    const currentSession = sessionRef.current
    try {
      const access = await verifyProAccess({
        getSession: () => sessionRef.current,
        entitlement,
        refresh: navigator.onLine ? getEntitlement : undefined,
      })
      if (access.status === 'changed') return null
      setEntitlement(access.entitlement)
      if (access.status === 'denied') { setProRequiredFeature(feature); return null }
      return access
    } catch (error) {
      if (sessionRef.current?.token === currentSession?.token) setNotice(readableError(error, lang))
      return null
    }
  }

  async function launchStealth(book?: Book) {
    const target = book || readerRef.current
    if (!target || stealthLaunchBusy.current) return
    stealthLaunchBusy.current = true
    const targetProfile = profileRef.current
    const requestId = openRequestId.current
    try {
      const access = await requireProFeature('STEALTH_READING')
      if (!access || profileRef.current !== targetProfile || openRequestId.current !== requestId) return
      if (readerRef.current?.id !== target.id && !await openBookRef.current(target)) return
      if (sessionRef.current?.token !== access.session.token || readerRef.current?.id !== target.id || !allowsPro(access.entitlement, sessionRef.current)) return
      setSelectedBook(null); setSettingsOpen(false); setTocOpen(false); setNoteOpen(false); setNoteNavigation(null)
      setSearchOpen(false); setActiveSearchHit(null)
      setStealthGrant({ token: access.session.token, bookId: target.id })
    } finally { stealthLaunchBusy.current = false }
  }
  launchStealthRef.current = launchStealth

  async function handleAnnotationSave(changes: AnnotationChanges) {
    const record = editingAnnotation
    if (!record || annotationBusy) return
    setAnnotationBusy(true); setAnnotationError('')
    const targetProfile = profile
    try {
      const localOnly = books.find(book => book.id === record.payload.book_id)?.source === 'local'
      await updateAnnotation(targetProfile, record, changes, localOnly)
      await refreshLocal(targetProfile)
      if (profileRef.current !== targetProfile) return
      setEditingAnnotation(null); setNotice(lang === 'vi' ? 'Đã cập nhật ghi chú và highlight.' : 'Note and highlight updated.')
      if (session && online && !localOnly) void synchronize(session, true)
    } catch (error) { if (profileRef.current === targetProfile) setAnnotationError(readableError(error, lang)) }
    finally { setAnnotationBusy(false) }
  }

  async function handleAnnotationDelete() {
    const record = deletingAnnotation
    if (!record || annotationBusy) return
    setAnnotationBusy(true); setAnnotationError('')
    const targetProfile = profile
    try {
      const localOnly = books.find(book => book.id === record.payload.book_id)?.source === 'local'
      await deleteAnnotation(targetProfile, record, localOnly)
      await refreshLocal(targetProfile)
      if (profileRef.current !== targetProfile) return
      setDeletingAnnotation(null); setNotice(lang === 'vi' ? 'Đã xóa mục ghi nhớ và thẻ ôn liên quan.' : 'Memory entry and linked review cards deleted.')
      if (session && online && !localOnly) void synchronize(session, true)
    } catch (error) { if (profileRef.current === targetProfile) setAnnotationError(readableError(error, lang)) }
    finally { setAnnotationBusy(false) }
  }

  async function handleAddReview(record: SyncRecord) {
    const targetProfile = profile
    try {
      const localOnly = books.find(book => book.id === record.payload.book_id)?.source === 'local'
      await addAnnotationReview(targetProfile, record, localOnly)
      await refreshLocal(targetProfile)
      if (profileRef.current !== targetProfile) return
      setNotice(lang === 'vi' ? 'Đã thêm thẻ vào lịch ôn tập.' : 'Card added to your review schedule.')
      if (session && online && !localOnly) void synchronize(session, true)
    } catch (error) { if (profileRef.current === targetProfile) setNotice(readableError(error, lang)) }
  }

  async function researchChanged() {
    const owner = profile
    if (profileRef.current !== owner) return
    broadcastSyncRequired(owner)
    await refreshLocal(owner)
    if (profileRef.current === owner && session && navigator.onLine) void synchronize(session, true)
  }

  async function loadComparisonBook(book: Book, signal: AbortSignal): Promise<ArrayBuffer> {
    const owner = profile
    const activeSession = session
    if (profileRef.current !== owner) throw new Error(lang === 'vi' ? 'Tài khoản đã thay đổi.' : 'Account changed.')
    const [stored, offlineCopy] = await Promise.all([getFile(owner, book.id), getOfflineBook(offlineProfileFor(book, owner), book.id)])
    signal.throwIfAborted()
    if (profileRef.current !== owner || sessionRef.current?.token !== activeSession?.token) throw new Error(lang === 'vi' ? 'Phiên đọc đã thay đổi.' : 'Reading session changed.')
    const local = currentLocalFile(book, stored)
    const bytes = local ? await local.data.arrayBuffer() : offlineCopy ? await offlineCopy.data.arrayBuffer() : await loadBookBytes(book, activeSession?.token, { signal })
    signal.throwIfAborted()
    if (profileRef.current !== owner || !bytes.byteLength) throw new Error(lang === 'vi' ? 'Không mở được nguồn này.' : 'Unable to open this source.')
    return bytes
  }

  function compareBooks(left: Book, right: Book, locators?: [string | undefined, string | undefined]) {
    if (readerRef.current) closeReaderRef.current()
    setPage('memory')
    setComparisonChoosing(false)
    setComparison({ profile, books: [left, right], initialLocators: locators || [toText(progressFor(records, left.id)?.payload.locator_json) || undefined, toText(progressFor(records, right.id)?.payload.locator_json) || undefined] })
  }

  async function compareNotes(left: SyncRecord, right: SyncRecord) {
    const latest = await localRecords(profile)
    if (profileRef.current !== profile) return
    const a = latest.find(note => note.key === left.key && !note.deleted && note.kind === 'highlights')
    const b = latest.find(note => note.key === right.key && !note.deleted && note.kind === 'highlights')
    const first = books.find(book => book.id === a?.payload.book_id), second = books.find(book => book.id === b?.payload.book_id)
    if (!a || !b || !first || !second) { setNotice(lang === 'vi' ? 'Một nguồn không còn trong thư viện. Ghi chú trích dẫn vẫn được giữ lại.' : 'One source is no longer available. Your saved quotation is retained.'); return }
    compareBooks(first, second, [toText(a.payload.locator_json), toText(b.payload.locator_json)])
  }

  async function openResearchSource(record: SyncRecord) {
    const latest = (await localRecords(profile)).find(note => note.key === record.key && !note.deleted)
    if (profileRef.current !== profile) return
    const book = books.find(item => item.id === latest?.payload.book_id)
    if (!latest || !book) { setNotice(lang === 'vi' ? 'Nguồn không còn trong thư viện. Ghi chú trích dẫn vẫn được giữ lại.' : 'This source is no longer in your library. Your saved quotation is retained.'); return }
    const locatorJson = toText(latest.payload.locator_json)
    const opened = await openBook(book, locatorJson)
    if (opened && profileRef.current === profile && readerRef.current?.id === book.id && locatorJson) setNoteNavigation({ locatorJson, requestId: ++noteNavigationId.current })
  }

  async function startFlashcardReview(autoGenerate = false, scope: ReviewScope = {}) {
    if (reviewStarting.current || reviewRatingActive.current) return
    if (autoGenerate && !await requireProFeature('ADVANCED_READING_MEMORY')) return
    const targetProfile = profile
    if (profileRef.current !== targetProfile) return
    reviewStarting.current = true
    const run = ++reviewRun.current
    try {
      if (autoGenerate) {
        for (const highlight of annotations.filter(record => record.kind === 'highlights')) {
          if (profileRef.current !== targetProfile) return
          await addAnnotationReview(targetProfile, highlight, books.find(book => book.id === highlight.payload.book_id)?.source === 'local')
        }
      }
      const queue = buildReviewQueue(await localRecords(targetProfile), targetProfile, scope)
      await refreshLocal(targetProfile)
      if (profileRef.current !== targetProfile || reviewRun.current !== run) return
      if (session && online) void synchronize(session, true)
      if (!queue.length) {
        setNotice(lang === 'vi' ? 'Chưa có thẻ cần ôn trong phạm vi này. Hãy thêm ghi chú vào Flashcards; thẻ đã nhớ sẽ xuất hiện khi đến hạn.' : 'No cards need review in this scope. Add notes to Flashcards; remembered cards return when due.')
        return
      }
      setReviewSession({ scope, queue, index: 0 })
      setCardFlipped(false)
      setReviewStats({ mastered: 0, reviewAgain: 0, skipped: 0 })
      setReviewOpen(true)
      trackWebFeature('review_start', 'memory')
    } catch (error) {
      if (profileRef.current === targetProfile) setNotice(readableError(error, lang))
    } finally { reviewStarting.current = false }
  }

  async function handleFlashcardRating(rating: ReviewRating) {
    if (reviewRatingActive.current || !reviewQueue.length || reviewIndex >= reviewQueue.length) return
    reviewRatingActive.current = true
    setReviewBusy(true)
    const currentCard = reviewQueue[reviewIndex]
    const targetProfile = profile
    const run = reviewRun.current
    const scope = activeReview.scope
    try {
      const localOnly = books.find(book => book.id === currentCard.payload.book_id)?.source === 'local'
      const committed = await recordReviewAttempt(targetProfile, currentCard, rating, scope, localOnly)
      broadcastSyncRequired(targetProfile)
      const latest = await localRecords(targetProfile)
      await refreshLocal(targetProfile)
      if (profileRef.current !== targetProfile || reviewRun.current !== run || !committed) return
      if (session && online && !localOnly) void synchronize(session, true)
      setCardFlipped(false)
      setReviewStats(prev => ({ ...prev, mastered: prev.mastered + Number(rating === 'good'), reviewAgain: prev.reviewAgain + Number(rating === 'again'), skipped: prev.skipped + Number(rating === 'skip') }))
      setReviewSession(previous => {
        const current = reconcileReviewSession(previous, latest, targetProfile)
        if (current.queue[current.index]?.key !== currentCard.key) return current
        return { ...current, queue: rating === 'again' ? [...current.queue, currentCard] : current.queue, index: current.index + 1 }
      })
      if (rating !== 'again' && reviewIndex + 1 >= reviewQueue.length) trackWebFeature('review_complete', 'memory')
    } catch (error) {
      if (profileRef.current === targetProfile) setNotice(readableError(error, lang))
    } finally { reviewRatingActive.current = false; setReviewBusy(false) }
  }

  async function deleteBook(book: Book) {
    if (book.source !== 'local' && book.source !== 'cloud') return
    const targetProfile = profile
    const activeSession = session
    const flightKey = keyFor(targetProfile, book.id)
    if (deletionFlights.current.has(flightKey)) return
    if (!window.confirm(lang === 'vi' ? `Xóa “${book.title}” khỏi thư viện?` : `Remove “${book.title}” from your library?`)) return
    deletionFlights.current.add(flightKey)
    const isCurrent = () => profileRef.current === targetProfile && sessionRef.current?.token === activeSession?.token
    try {
      if (book.source === 'local') {
        await removeLocalDocument(targetProfile, book.id)
      } else {
        await removeFile(targetProfile, book.id)
        await removeOfflineBook(offlineProfileFor(book, targetProfile), book.id)
        await mutate(targetProfile, 'catalog_books', androidRecordId('catalog_books', book.id), {}, true)
      }
      await refreshLocal(targetProfile).catch(() => {})
      if (!isCurrent()) return
      setNotice(translate("Đã xóa tài liệu.", lang))
      if (book.source === 'cloud' && activeSession && online) void synchronize(activeSession, true)
    } catch (error) { if (isCurrent()) setNotice(readableError(error, lang)) }
    finally { deletionFlights.current.delete(flightKey) }
  }

  const nav: Array<{ id: Page; label: string; icon: typeof BookOpen }> = [
    { id: 'home', label: curT.nav.home, icon: BookOpen },
    { id: 'catalog', label: curT.nav.catalog, icon: Search },
    { id: 'library', label: curT.nav.library, icon: Library },
    { id: 'memory', label: curT.nav.memory, icon: Highlighter },
    { id: 'stats', label: curT.nav.stats, icon: BarChart3 },
    { id: 'account', label: curT.nav.account, icon: Settings2 },
    ...(isAdmin ? [{ id: 'admin' as const, label: lang === 'vi' ? 'Quản trị' : 'Administration', icon: Settings2 }] : []),
  ]

  const noticeBanner = notice && <div className={reader ? 'notice reader-notice' : 'notice'} role="status"><span>{notice}</span><button onClick={() => setNotice('')} aria-label={translate("Đóng thông báo", lang)}><X size={17} /></button></div>

  return <div className="app-shell">
    <div className="analog-grain-overlay" aria-hidden="true" />
    <OceanWaves enabled={!reader && !reviewOpen && !comparison} />
    <aside className={`sidebar ${sidebarOpen ? 'open' : ''}`}>
      <div className="brand"><div className="brand-mark"><BookOpen size={24} /></div><div><strong>NoCap</strong><span>Quiet Knowledge Workspace</span></div><button className="mobile-close icon-button" onClick={() => setSidebarOpen(false)} aria-label={translate("Đóng menu", lang)}><X size={20} /></button></div>
      <div className="sidebar-caption">{curT.nav.mySpace}</div>
      <nav className="main-nav" aria-label={translate("Điều hướng", lang)}>
        {nav.map(item => <button key={item.id} className={page === item.id ? 'active' : ''} onClick={() => { setPage(item.id); setSidebarOpen(false); setQuery(''); setCategory('all') }}><item.icon size={19} /><span>{item.label}</span></button>)}
      </nav>
      <div className="sidebar-bottom"><div className="sync-summary">{online ? <Cloud size={17} /> : <CloudOff size={17} />}<div><strong>{!session ? curT.nav.guestMode : syncing ? curT.nav.syncing : pendingCount ? curT.nav.pendingShort : curT.nav.autoSyncOn}</strong><small>{session ? (pendingCount ? `${pendingCount} ${curT.nav.pending}` : session.user.email) : curT.nav.loginPrompt}</small></div></div>{!session && <button className="primary wide" onClick={() => setAuthOpen(true)}><LogIn size={16} /> {curT.nav.login}</button>}</div>
    </aside>
    {sidebarOpen && <button className="sidebar-shade" aria-label={translate("Đóng menu", lang)} onClick={() => setSidebarOpen(false)} />}

    <main className="main-area" inert={!!comparison || comparisonChoosing || reviewOpen}>
      <header className="swiss-header">
        <div className="swiss-header-brand" onClick={() => { setPage('home'); setQuery(''); setCategory('all') }}>
          <div className="swiss-header-logo">
            NOCAP <span>QUIET WORKSPACE</span>
          </div>
        </div>
        <nav className="swiss-header-nav" aria-label={translate("Menu chính", lang)}>
          <button className={`swiss-nav-link ${page === 'home' ? 'active' : ''}`} onClick={() => { setPage('home'); setQuery(''); setCategory('all') }}>{curT.nav.home}</button>
          <button className={`swiss-nav-link ${page === 'catalog' ? 'active' : ''}`} onClick={() => { setPage('catalog'); setQuery(''); setCategory('all') }}>{curT.nav.catalog}</button>
          <button className={`swiss-nav-link ${page === 'library' ? 'active' : ''}`} onClick={() => { setPage('library'); setQuery(''); setCategory('all') }}>{curT.nav.library}</button>
          <button className={`swiss-nav-link ${page === 'memory' ? 'active' : ''}`} onClick={() => { setPage('memory'); setQuery(''); setCategory('all') }}>{curT.nav.memory}</button>
          <button className={`swiss-nav-link ${page === 'stats' ? 'active' : ''}`} onClick={() => { setPage('stats'); setQuery(''); setCategory('all') }}>{curT.nav.stats}</button>
          <button className={`swiss-nav-link ${page === 'account' ? 'active' : ''}`} onClick={() => { setPage('account'); setQuery(''); setCategory('all') }}>{curT.nav.account}</button>
          {isAdmin && <button className={`swiss-nav-link ${page === 'admin' ? 'active' : ''}`} onClick={() => setPage('admin')}>{lang === 'vi' ? 'Quản trị' : 'Admin'}</button>}
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
          {!session && (
            <button className="swiss-pill-btn" onClick={() => setAuthOpen(true)} aria-label={curT.header.login} title={curT.header.login}>
              <LogIn size={13} /> <span>{curT.header.login}</span>
            </button>
          )}
          <button className="profile-button" onClick={() => session ? setPage('account') : setAuthOpen(true)} aria-label={translate("Tài khoản", lang)}>
            {session?.user.displayName?.slice(0, 1).toUpperCase() || session?.user.email.slice(0, 1).toUpperCase() || 'G'}
          </button>
          <button className="mobile-menu icon-button" onClick={() => setSidebarOpen(true)} aria-label={translate("Mở menu", lang)}><Menu size={22} /></button>
        </div>
      </header>

      {page === 'home' && <>
        <section className="swiss-hero">
          <div className="editorial-eyebrow">
            <span className="editorial-eyebrow-dot" />
            <span>SWISS EDITORIAL & QUIET WORKSPACE</span>
          </div>
          <div className="swiss-hero-echo-container">
            <h1 className="swiss-hero-echo-text" aria-label="NOCAP">
              {(['4', '3', '2', '1', 'fore'] as const).map(layer =>
                <span key={layer} className={`swiss-hero-echo-layer swiss-echo-${layer}`} aria-hidden="true">
                  {Array.from('NOCAP').map((letter, index) =>
                    <span key={index} className="swiss-echo-letter" style={layer === 'fore' ? { animationDelay: `${index * 75}ms` } : undefined}>{letter}</span>
                  )}
                </span>
              )}
            </h1>
          </div>
          <p className="swiss-hero-sub">
            {curT.hero.sub}
          </p>
          <div className="swiss-hero-actions">
            <button className="pill-btn primary-pill" onClick={() => setPage('catalog')}>
              {curT.hero.exploreBtn} <ArrowRight size={16} />
            </button>
            <button className="pill-btn invert-pill" onClick={() => setImportOpen(true)}>
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
                <h3 style={{ fontFamily: 'var(--font-ui)', fontSize: '26px', margin: '14px 0 8px', letterSpacing: '-0.01em' }}>
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

            <button type="button" className="asym-card-pill-4" onClick={() => setPage('catalog')} aria-label={curT.showcase.explorePill}>
              <div className="asym-pill-art">
                <img className="library-photo" src="/photos/reading-nook.webp" width={1000} height={1500} alt="" loading="lazy" decoding="async" />
                <div className="asym-pill-caption">
                  <span className="asym-pill-tag">{curT.showcase.editionBadge}</span>
                  <strong>NOCAP</strong>
                  <small>QUIET KNOWLEDGE</small>
                  <span className="asym-pill-link">{curT.showcase.explorePill} <ArrowRight size={14} /></span>
                </div>
              </div>
            </button>

            <div className="asym-card-circle-5">
              <img className="habit-photo" src="/photos/reading-tea.webp" width={900} height={675} alt="" loading="lazy" decoding="async" />
              <div className="habit-copy">
                <span className="editorial-chip peach" style={{ marginBottom: '10px' }}>{curT.showcase.habitChip}</span>
                <div className="habit-value">
                  {readingStreak > 0 ? `${readingStreak}D` : '15M'}
                </div>
                <p className="habit-description">
                  {readingStreak > 0 ? curT.showcase.habitDesc : curT.showcase.habitDescEmpty}
                </p>
                <button className="text-button" onClick={() => setPage('stats')}>{curT.showcase.viewAnalytics} <ArrowRight size={12} /></button>
              </div>
            </div>

            <div className="asym-card-wide-7">
              <div>
                <span className="editorial-chip lavender" style={{ marginBottom: '14px' }}>{curT.showcase.notesChip}</span>
                <h4 style={{ fontFamily: 'var(--font-editorial)', fontSize: '18px', fontStyle: 'italic', fontWeight: '500', color: '#111111', margin: '12px 0 8px', lineHeight: '1.5' }}>
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
        {page === 'admin' && (session && adminAccess?.status === 'allowed'
          ? <ReaderErrorBoundary key={session.token} area="admin" lang={lang} onClose={() => setPage('home')}><Suspense fallback={<p role="status">{lang === 'vi' ? 'Đang mở khu vực quản trị…' : 'Opening administration…'}</p>}><AdminWorkspace
            key={session.token}
            token={session.token}
            admin={adminAccess.admin}
            lang={lang}
            onSignIn={() => setAuthOpen(true)}
            onAccessLost={invalidateAdminAccess}
            onCatalogChanged={() => {
              const token = session.token
              void getCatalog().then(result => { if (sessionRef.current?.token === token) { setCatalog(result.books); setCategories(result.categories) } }).catch(() => {})
            }}
            onProfileChanged={() => {
              const token = session.token
              reloadAdminAccess()
              void getUser(token).then(result => {
                const current = sessionRef.current
                if (current?.token !== token) return
                const updated = { ...current, user: result.user }
                saveSession(updated); setSession(updated)
              }).catch(() => {})
            }}
          /></Suspense></ReaderErrorBoundary>
          : <div className="empty-state admin-access-gate">
            <h2>{lang === 'vi' ? 'Khu vực quản trị' : 'Administration'}</h2>
            <p>{!session ? (lang === 'vi' ? 'Đăng nhập bằng tài khoản có quyền admin để tiếp tục.' : 'Sign in with an administrator account to continue.')
              : !adminAccess ? (lang === 'vi' ? 'Đang kiểm tra quyền quản trị…' : 'Checking administrator access…')
              : adminAccess.status === 'error' ? (lang === 'vi' ? 'Chưa kiểm tra được quyền quản trị. Hãy thử lại.' : 'Could not verify administrator access. Try again.')
              : (lang === 'vi' ? 'Tài khoản này không có quyền quản trị.' : 'This account does not have administrator access.')}</p>
            <div className="admin-actions">{!session && <button className="primary" onClick={() => setAuthOpen(true)}>{curT.header.login}</button>}
              {session && adminAccess?.status === 'error' && <button className="secondary" onClick={reloadAdminAccess}>{lang === 'vi' ? 'Thử lại' : 'Retry'}</button>}
              <button className="secondary" onClick={() => setPage('home')}>{curT.nav.home}</button>
            </div>
          </div>)}
        {page === 'notFound' && <div className="empty-state"><h2>{lang === 'vi' ? 'Không tìm thấy trang' : 'Page not found'}</h2><button className="secondary" onClick={() => setPage('home')}>{lang === 'vi' ? 'Về trang chủ' : 'Go home'}</button></div>}
        {(route.kind === 'book' || route.kind === 'read') && !routeBook && <div className="empty-state">
          <h2>{!catalogReady || loadedProfile !== profile || syncing ? (lang === 'vi' ? 'Đang tìm sách…' : 'Finding book…') : (lang === 'vi' ? 'Không tìm thấy sách trong thư viện hiện tại' : 'Book not found in this library')}</h2>
          <p>{lang === 'vi' ? 'Tài liệu riêng cần đúng tài khoản; tệp chỉ lưu trên trình duyệt cần được mở trên thiết bị đã nhập.' : 'Private books require their owning account. Browser-only files need the device where they were imported.'}</p>
          {!session && <button className="secondary" onClick={() => setAuthOpen(true)}>{curT.header.login}</button>}
          <button className="text-button" onClick={() => setPage('catalog')}>{curT.nav.catalog}</button>
        </div>}
        {conflicts.length > 0 && (
          <div className="conflict-banner">
            <span>⚠️ {lang === 'vi' ? `Phát hiện ${conflicts.length} xung đột dữ liệu giữa máy này và Cloud.` : `Detected ${conflicts.length} sync conflicts.`}</span>
            <button onClick={() => setConflictModalOpen(true)}>{lang === 'vi' ? 'Xem & Giải quyết' : 'Review & Resolve'}</button>
          </div>
        )}
        {!reader && noticeBanner}
        {page === 'home' && <>
          <SectionHeader title={lang === 'vi' ? 'Đọc tiếp gần đây' : 'Continue Reading'} action={curT.showcase.viewAll} onAction={() => setPage('library')} />
          {reading.length ? <div className="book-grid">{reading.slice(0, 4).map(book => <BookCard key={book.id} book={book} lang={lang} progress={Number(progressFor(records, book.id)?.payload.progression || 0)} onOpen={() => void openBook(book)} onStealth={() => void launchStealth(book)} onDetails={() => showBookDetails(book)} onFavorite={() => void toggleFavorite(book)} favorite={favorites.has(book.id)} offline={book.source === 'local' || offlineIds.has(book.id)} downloadBusy={downloadBusy === book.id} onDownload={(book.source === 'local' || book.fileUrl) ? () => void downloadBook(book) : undefined} />)}</div> : <div className="empty-state"><BookOpen size={30} /><h3>{lang === 'vi' ? 'Hành trình đọc bắt đầu ở đây' : 'Your reading journey begins here'}</h3><p>{lang === 'vi' ? 'Chọn một cuốn sách hoặc thêm tài liệu của bạn để bắt đầu.' : 'Pick a book or import your own document to begin.'}</p><button className="secondary" onClick={() => setPage('catalog')}>{curT.hero.exploreBtn}</button></div>}
          <SectionHeader title={lang === 'vi' ? 'Gợi ý cho bạn' : 'Recommended for You'} action={lang === 'vi' ? 'Xem tất cả' : 'View all'} onAction={() => setPage('catalog')} />
          <div className="book-grid">{catalog.filter(book => book.fileUrl).slice(0, 4).map(book => <BookCard key={book.id} book={book} lang={lang} onOpen={() => void openBook(book)} onStealth={() => void launchStealth(book)} onDetails={() => showBookDetails(book)} onFavorite={() => void toggleFavorite(book)} favorite={favorites.has(book.id)} offline={offlineIds.has(book.id)} downloadBusy={downloadBusy === book.id} onDownload={() => void downloadBook(book)} />)}</div>
        </>}

        {(page === 'catalog' || page === 'library') && <>
          <div className="inner-page-banner">
            <div className="banner-text">
              <div className="banner-eyebrow">{page === 'catalog' ? curT.banners.catalog.eyebrow : curT.banners.library.eyebrow}</div>
              <h2>{page === 'catalog' ? curT.banners.catalog.title : curT.banners.library.title}</h2>
              <p>{page === 'catalog' ? curT.banners.catalog.desc : curT.banners.library.desc}</p>
            </div>
            <div className="banner-action" style={{ display: 'flex', gap: '8px', flexWrap: 'wrap' }}>
              <button className="light-button" onClick={() => setImportOpen(true)}><Plus size={16} /> {curT.banners.catalog.addDoc}</button>
              {page === 'library' && (
                <>
                  <button className="light-button" onClick={() => setTagsCollectionsOpen(true)}><Tag size={15} /> {curT.accountPage.manageTagsCollections}</button>
                </>
              )}
            </div>
          </div>
          {page === 'library' && (
            <div className="shelf-chips" role="tablist" aria-label={translate("Bộ lọc tủ sách", lang)}>
              <button className={`shelf-chip ${shelfFilter === 'all' ? 'active' : ''}`} onClick={() => setShelfFilter('all')}>{curT.libraryTabs.all} ({libraryBooks.length})</button>
              <button className={`shelf-chip ${shelfFilter === 'reading' ? 'active' : ''}`} onClick={() => setShelfFilter('reading')}><BookOpen size={14} /> {curT.libraryTabs.reading}</button>
              <button className={`shelf-chip ${shelfFilter === 'favorites' ? 'active' : ''}`} onClick={() => setShelfFilter('favorites')}><BookMarked size={14} /> {curT.libraryTabs.favorites} ({favorites.size})</button>
              <button className={`shelf-chip ${shelfFilter === 'completed' ? 'active' : ''}`} onClick={() => setShelfFilter('completed')}><CheckCircle2 size={14} /> {curT.libraryTabs.completed}</button>
              <button className={`shelf-chip ${shelfFilter === 'local' ? 'active' : ''}`} onClick={() => setShelfFilter('local')}><Layers size={14} /> {curT.libraryTabs.local}</button>
            </div>
          )}
          {page === 'library' && (tags.length > 0 || collections.length > 0) && (
            <div className="tag-chip-row" style={{ marginBottom: '14px' }}>
              {tags.map(tag => (
                <button
                  key={tag.id}
                  className={`tag-badge ${organizationFilter === `tag:${tag.id}` ? 'active' : ''}`}
                  onClick={() => setOrganizationFilter(prev => prev === `tag:${tag.id}` ? 'all' : `tag:${tag.id}`)}
                  style={{ cursor: 'pointer', border: organizationFilter === `tag:${tag.id}` ? '1px solid #167e70' : '1px solid #e2e8f0', background: organizationFilter === `tag:${tag.id}` ? '#e6f4f1' : '#f8fafc' }}
                >
                  <Tag size={11} /> {tag.name}
                </button>
              ))}
              {collections.map(col => (
                <button
                  key={col.id}
                  className={`tag-badge collection ${organizationFilter === `collection:${col.id}` ? 'active' : ''}`}
                  onClick={() => setOrganizationFilter(prev => prev === `collection:${col.id}` ? 'all' : `collection:${col.id}`)}
                  style={{ cursor: 'pointer', border: organizationFilter === `collection:${col.id}` ? '1px solid #4338ca' : '1px solid #e0e7ff', background: organizationFilter === `collection:${col.id}` ? '#e0e7ff' : '#f5f3ff' }}
                >
                  <FolderPlus size={11} /> {col.name}
                </button>
              ))}
            </div>
          )}
          <div className="filter-bar"><label className="search-field"><Search size={18} /><input value={query} onChange={event => setQuery(event.target.value)} placeholder={curT.filters.searchPlaceholder} aria-label={translate("Tìm sách", lang)} /></label><select value={category} onChange={event => setCategory(event.target.value)} aria-label={translate("Lọc thể loại", lang)}><option value="all">{curT.filters.allCategories}</option>{categories.map(item => <option key={item.id} value={item.id}>{translate(item.name, lang)}</option>)}</select><select value={sortOrder} onChange={e => setSortOrder(e.target.value as 'recent' | 'title' | 'progress')} aria-label={translate("Sắp xếp sách", lang)}><option value="recent">{curT.filters.recent}</option><option value="title">{curT.filters.title}</option><option value="progress">{curT.filters.progress}</option></select>{page === 'library' && (tags.length > 0 || collections.length > 0) && <select value={organizationFilter} onChange={event => setOrganizationFilter(event.target.value)} aria-label={translate("Lọc theo thẻ hoặc bộ sưu tập", lang)}><option value="all">{curT.filters.allTagsAndCollections}</option>{tags.length > 0 && <optgroup label={curT.filters.tagsGroup}>{tags.map(tag => <option key={`tag:${tag.id}`} value={`tag:${tag.id}`}>{tag.name}</option>)}</optgroup>}{collections.length > 0 && <optgroup label={curT.filters.collectionsGroup}>{collections.map(collection => <option key={`collection:${collection.id}`} value={`collection:${collection.id}`}>{collection.name}</option>)}</optgroup>}</select>}<span>{curT.filters.docCount(filteredBooks.length)}</span></div>
          {filteredBooks.length ? <div className="book-grid">{filteredBooks.map(book => <BookCard key={book.id} book={book} lang={lang} progress={Number(progressFor(records, book.id)?.payload.progression || 0)} onOpen={() => void openBook(book)} onStealth={() => void launchStealth(book)} onDetails={() => showBookDetails(book)} onFavorite={book.source === 'local' ? undefined : () => void toggleFavorite(book)} favorite={favorites.has(book.id)} onDelete={book.source === 'local' || book.source === 'cloud' ? () => void deleteBook(book) : undefined} offline={book.source === 'local' || offlineIds.has(book.id)} downloadBusy={downloadBusy === book.id} onDownload={(book.source === 'local' || book.fileUrl) ? () => void downloadBook(book) : undefined} />)}</div> : <div className="empty-state"><Library size={30} /><h3>{curT.filters.emptyTitle}</h3><p>{curT.filters.emptyDesc}</p><button className="secondary" onClick={() => { setQuery(''); setCategory('all'); setShelfFilter('all'); setOrganizationFilter('all') }}>{curT.filters.clearFilter}</button></div>}
        </>}

        {page === 'memory' && <><div className="inner-page-banner">
            <div className="banner-text">
              <div className="banner-eyebrow">{curT.banners.memory.eyebrow}</div>
              <h2>{curT.banners.memory.title}</h2>
              <p>{curT.banners.memory.desc}</p>
            </div>
            <div className="banner-action" style={{ display: 'flex', gap: '10px', flexWrap: 'wrap' }}>
              <div className="count-chip" style={{ background: 'rgba(255,255,255,0.08)', color: '#c8d8f8', border: '1px solid rgba(100,140,255,0.2)' }}>{curT.banners.memory.statsSnippet(annotations.length, dueReviewCount)}</div>
              {annotations.length > 0 && <><button className="light-button" onClick={() => void startFlashcardReview()}><Sparkles size={15} /> {curT.banners.memory.reviewBtn}</button><button className="light-button" onClick={() => void startFlashcardReview(true)}><Sparkles size={15} />{lang === 'vi' ? 'Tạo thẻ tự động · Pro' : 'Auto-generate cards · Pro'}</button><button className="light-button" disabled={pdfExportBusy} aria-busy={pdfExportBusy} onClick={() => void exportPdf()}><FileDown size={15} /> {pdfExportBusy ? (lang === 'vi' ? 'Đang tạo PDF…' : 'Creating PDF…') : curT.banners.memory.exportBtn}</button></>}
            </div>
          </div>
          <div className="section-header" style={{ margin: '22px 0 12px' }}><h3>{lang === 'vi' ? 'Không gian nghiên cứu' : 'Research workspace'}</h3><button className="secondary" onClick={() => setComparisonChoosing(true)}><Layers size={16} />{lang === 'vi' ? 'Đọc đối chiếu hai nguồn' : 'Compare two sources'}</button></div>
          <Suspense fallback={<p className="muted">{lang === 'vi' ? 'Đang mở chủ đề…' : 'Loading topics…'}</p>}><ResearchWorkspace key={profile} profile={profile} lang={lang} records={records} books={books} onChanged={researchChanged} onOpenSource={record => { void openResearchSource(record).catch(error => setNotice(readableError(error, lang))) }} onCompare={(left, right) => { void compareNotes(left, right).catch(error => setNotice(readableError(error, lang))) }} onStartReview={scope => { void startFlashcardReview(false, scope) }} onAddReview={async record => { await addAnnotationReview(profile, record, books.find(book => book.id === record.payload.book_id)?.source === 'local'); await researchChanged() }} /></Suspense>
          <h3 style={{ margin: '28px 0 14px' }}>{lang === 'vi' ? 'Tất cả ghi chú' : 'All notes'}</h3>
          <label className="search-field memory-search"><Search size={18} /><input value={query} onChange={event => setQuery(event.target.value)} placeholder={curT.memoryPage.searchPlaceholder} aria-label={translate("Tìm ghi chú", lang)} /></label>{annotations.filter(record => `${record.payload.text || ''} ${record.payload.note || ''} ${record.payload.chapter_title || ''}`.toLocaleLowerCase().includes(query.toLocaleLowerCase())).length ? <div className="memory-list">{annotations.filter(record => `${record.payload.text || ''} ${record.payload.note || ''} ${record.payload.chapter_title || ''}`.toLocaleLowerCase().includes(query.toLocaleLowerCase())).map(record => { const book = books.find(item => item.id === record.payload.book_id); return <div className="memory-item" key={record.key}><div className="memory-icon">{record.kind === 'highlights' ? <Highlighter size={18} /> : <Bookmark size={18} />}</div><div><div className="memory-book">{book?.title || curT.memoryPage.privateDoc}</div><blockquote>{toText(record.payload.text) || toText(record.payload.chapter_title) || curT.memoryPage.bookmarkFallback}</blockquote>{!!record.payload.note && <p>{toText(record.payload.note)}</p>}{hasDrawing(record.payload.drawing) && <DrawingPreview drawing={record.payload.drawing} label={lang === 'vi' ? 'Ghi chú vẽ tay' : 'Handwritten note'} />}</div><div className="memory-item-actions">
          <Suspense fallback={null}><AnnotationSourceActions record={record} records={records} books={books} lang={lang} onOpenSource={item => { void openResearchSource(item).catch(error => setNotice(readableError(error, lang))) }} onCompare={(left, right) => { void compareNotes(left, right).catch(error => setNotice(readableError(error, lang))) }} /></Suspense>
          {record.kind === 'highlights' && <>
            {!reviewItems.some(item => item.payload.annotation_id === annotationId(record)) && <button className="text-button" onClick={() => void handleAddReview(record)}><Plus size={15} />{lang === 'vi' ? 'Thêm vào ôn tập' : 'Add to review'}</button>}
            <button className="icon-button" aria-label={lang === 'vi' ? 'Sửa highlight và ghi chú' : 'Edit highlight and note'} title={lang === 'vi' ? 'Sửa' : 'Edit'} onClick={() => { setAnnotationError(''); setEditingAnnotation(record) }}><Edit3 size={17} /></button>
          </>}
          <button className="icon-button danger-action" aria-label={lang === 'vi' ? 'Xóa mục ghi nhớ' : 'Delete memory entry'} title={lang === 'vi' ? 'Xóa' : 'Delete'} onClick={() => { setAnnotationError(''); setDeletingAnnotation(record) }}><Trash2 size={17} /></button>
        </div></div> })}</div> : <div className="empty-state"><Highlighter size={30} /><h3>{curT.memoryPage.emptyTitle}</h3><p>{curT.memoryPage.emptyDesc}</p><button className="secondary" onClick={() => setPage('catalog')}>{curT.memoryPage.findBook}</button></div>}</>}

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
                return <div className="active-reading-item" key={book.id}><button className="cover-button" onClick={() => void openBook(book)} aria-label={`${translate('Mở', lang)} ${book.title}`}><div className="book-cover">{book.coverUrl ? <img src={book.coverUrl} alt="" loading="lazy" onError={e => { e.currentTarget.style.display = 'none' }} /> : null}<div className="cover-fallback"><BookOpen size={20} /></div></div></button><div className="active-reading-details"><div className="active-reading-title">{book.title}</div><div className="active-reading-author">{book.author || curT.statsPage.unknownAuthor} · {prog}% {curT.statsPage.progressSuffix}</div><div className="progress-bar"><span style={{ width: `${Math.max(4, prog)}%` }} /></div></div><button className="secondary" onClick={() => void openBook(book)}>{curT.statsPage.readContinue} <ArrowRight size={14} /></button></div>
              })}</div> : <p className="muted">{curT.statsPage.noBooksYet}</p>}
            </div>
            <div className="streak-box">
              <div className="streak-flame"><Flame size={28} /></div>
              <div className="streak-num">{readingStreak > 0 ? curT.statsPage.streakDays(readingStreak) : curT.statsPage.startNow}</div>
              <p className="eyebrow" style={{ color: '#ffbe76', margin: '8px 0 4px' }}>{curT.statsPage.habitStreak}</p>
              <div className="streak-desc">{reading.length > 0 ? curT.statsPage.streakActive(reading.length, annotations.length) : curT.statsPage.streakEmpty}</div>
              {annotations.length > 0 && <button className="light-button" style={{ marginTop: '16px' }} onClick={() => void startFlashcardReview()}><Sparkles size={16} /> {curT.statsPage.reviewToday}</button>}
            </div>
          </div>
        </>}

        {page === 'account' && <AccountSettings
          key={profile}
          session={session}
          entitlement={entitlement}
          lang={lang}
          now={statsNow}
          section={accountSection}
          onSectionChange={setAccountSection}
          comfort={{ fontSize, fontFamily, textAlignment, theme }}
          onComfortChange={updateComfort}
          onSignIn={() => setAuthOpen(true)}
          onSignOut={() => void signOut()}
          onEditName={() => { setEditNameInput(session?.user.displayName || ''); setEditNameOpen(true) }}
          onDeleteAccount={() => setDeleteAccountOpen(true)}
          onPaid={setEntitlement}
          onAdmin={isAdmin ? () => setPage('admin') : undefined}
        />}
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
              <h4>{curT.footer.linksHeading}</h4>
              <ul className="swiss-footer-links">
                <li><a href="https://www.facebook.com/profile.php?id=61595026831013" target="_blank" rel="noopener noreferrer">Facebook · NoCap</a></li>
                <li><a href="https://x.com/nocapexe201" target="_blank" rel="noopener noreferrer">X · @nocapexe201</a></li>
                <li><a href="/privacy">{curT.footer.privacy}</a></li>
                <li><a href="/terms">{curT.footer.terms}</a></li>
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
          </div>
        </div>
      </footer>

      <input ref={fileInput} type="file" accept=".epub,.pdf,.cbz,.txt,.md,.markdown,.html,.htm,.docx,.jpg,.jpeg,.png,.webp" hidden onChange={event => { const file = event.target.files?.[0]; if (file) void importFile(file); event.target.value = '' }} />
      {importOpen && <ImportDocumentDialog key={profile} profile={profile} lang={lang} onClose={() => setImportOpen(false)} onPickFile={() => fileInput.current?.click()} onImport={importFile} />}
    </main>

    {(readerLoading || readerError) && <div className="overlay"><div className="loading-card"><button className="icon-button close-floating" onClick={() => setPage(backgroundPageRef.current)} aria-label={lang === 'vi' ? 'Đóng' : 'Close'}><X size={20} /></button>{readerLoading ? <><div className="loader" /><h2>{lang === 'vi' ? 'Đang mở sách…' : 'Opening book…'}</h2><p>{lang === 'vi' ? 'Đang chuẩn bị nội dung để đọc.' : 'Preparing the document for reading.'}</p></> : <><FileText size={32} /><h2>{lang === 'vi' ? 'Chưa mở được tài liệu' : 'Unable to open document'}</h2><p>{readerError}</p><button className="primary" onClick={() => setPage(backgroundPageRef.current)}>{lang === 'vi' ? 'Đóng' : 'Close'}</button></>}</div></div>}

    {comparisonChoosing && <ComparisonSourcesDialog books={books} initialBookId={reader?.book.id} lang={lang} onClose={() => setComparisonChoosing(false)} onCompare={(left, right) => compareBooks(left, right)} />}
    {comparison?.profile === profile && <Suspense fallback={<div className="overlay"><div className="loading-card"><p>{lang === 'vi' ? 'Đang mở hai nguồn…' : 'Opening both sources…'}</p><button className="secondary" onClick={() => setComparison(null)}>{lang === 'vi' ? 'Đóng' : 'Close'}</button></div></div>}><ComparisonReader key={JSON.stringify([profile, comparison.books.map(book => book.id), comparison.initialLocators])} profile={profile} lang={lang} books={comparison.books} initialLocators={comparison.initialLocators} records={records} loadBook={loadComparisonBook} onChanged={researchChanged} onLocation={recordComparisonLocation} onClose={() => { flushComparisonProgress(); setComparison(null) }} /></Suspense>}
    {reader && noticeBanner}
    {reader && <div className={`reader-shell ${theme}`}>
      <div className="reader-topbar">
        <button className="reader-back reader-home-btn" onClick={() => { closeReader(); setPage('home'); window.scrollTo({ top: 0, behavior: 'smooth' }) }} aria-label={lang === 'vi' ? 'Trở về Trang chủ' : 'Home'} title={lang === 'vi' ? 'Trở về Trang chủ (Esc)' : 'Home (Esc)'}><Home size={18} /><span>{lang === 'vi' ? 'Trang chủ' : 'Home'}</span></button>
        <button className="reader-back" onClick={() => setPage('library')} aria-label={lang === 'vi' ? 'Quay lại tủ sách' : 'Back to library'}><ArrowLeft size={19} /><span>{lang === 'vi' ? 'Tủ sách' : 'Library'}</span></button>
        <div className="reader-title"><strong>{reader.book.title}</strong><small>{bookLabel(reader.book, lang)}</small></div>
        <div className="reader-actions">
          <button className="icon-button" onClick={() => setComparisonChoosing(true)} aria-label={lang === 'vi' ? 'Đọc đối chiếu hai nguồn' : 'Compare two sources'} title={lang === 'vi' ? 'Đọc đối chiếu' : 'Compare sources'}><Layers size={19} /></button>
          <button className="stealth-topbar-pill" title={curT.stealth.btnTitle} aria-label={curT.stealth.btnLabel} onClick={() => void launchStealth()}><Briefcase size={15} /><span>{lang === 'vi' ? 'Đọc ẩn · Pro (F2)' : 'Stealth · Pro (F2)'}</span></button>
          <button className="icon-button" title={lang === 'vi' ? 'Mục lục sách' : 'Table of contents'} aria-label={lang === 'vi' ? 'Mục lục' : 'Table of contents'} onClick={() => { setNavigateTarget(null); setTocOpen(true) }}><List size={20} /></button>
          <button ref={searchToggle} className="icon-button reader-search-toggle" title={lang === 'vi' ? 'Tìm trong sách (Ctrl+F / ⌘F)' : 'Search in book (Ctrl+F / ⌘F)'} aria-label={lang === 'vi' ? 'Tìm trong sách' : 'Search in book'} aria-expanded={searchOpen} aria-controls="reader-search-panel" onClick={() => { setSearchOpen(open => !open); setNoteOpen(false); setActiveSearchHit(null) }}><Search size={19} /></button>
          <button className="icon-button" title={lang === 'vi' ? 'Tùy chỉnh đọc & font' : 'Reading settings'} aria-label={lang === 'vi' ? 'Tùy chỉnh' : 'Settings'} onClick={() => setSettingsOpen(true)}><Type size={20} /></button>
          <button ref={speechToggle} className="icon-button" title={lang === 'vi' ? 'Đọc thành tiếng · Bản thử' : 'Read aloud · Preview'} aria-label={lang === 'vi' ? 'Đọc thành tiếng' : 'Read aloud'} aria-expanded={speechOpen} aria-controls="reader-speech-panel" onClick={() => setSpeechOpen(open => !open)}><Volume2 size={20} /></button>
          <button className={`icon-button ${currentBookmarked ? 'active' : ''}`} title={currentBookmarked ? (lang === 'vi' ? 'Bỏ dấu trang' : 'Remove bookmark') : (lang === 'vi' ? 'Thêm dấu trang' : 'Add bookmark')} aria-label={currentBookmarked ? (lang === 'vi' ? 'Bỏ dấu trang' : 'Remove bookmark') : (lang === 'vi' ? 'Đánh dấu vị trí' : 'Bookmark position')} aria-pressed={currentBookmarked} disabled={bookmarkSaving === keyFor(profile, reader.book.id)} aria-busy={bookmarkSaving === keyFor(profile, reader.book.id)} onClick={() => void toggleBookmark()}><Bookmark size={20} fill={currentBookmarked ? 'currentColor' : 'none'} /></button>
          <button ref={notesToggle} className={`reader-notes-toggle ${noteOpen ? 'active' : ''}`} title={lang === 'vi' ? 'Vừa đọc vừa ghi chú' : 'Read and take notes'} aria-label={lang === 'vi' ? 'Bảng ghi chú' : 'Notes panel'} aria-expanded={noteOpen} aria-controls="reader-notes-panel" onClick={() => { setNoteOpen(open => !open); setSearchOpen(false); setActiveSearchHit(null) }}><PanelRightOpen size={18} /><span>{lang === 'vi' ? 'Ghi chú' : 'Notes'}</span></button>
        </div>
      </div>
      {speechOpen && !stealthActive && !comparison && <ReaderSpeechPanel key={`speech:${profile}:${reader.book.id}`} lang={lang} language={reader.book.language}
        source={readerSpeechSource} selection={selection?.text || ''} scopeKey={JSON.stringify([speechScopeKey(location?.locatorJson), navigateTarget, noteNavigation?.requestId, stealthProgressRequest?.requestId])}
        onClose={() => { setSpeechOpen(false); speechToggle.current?.focus() }} />}
      <div className="reader-workspace">
        <div className="reader-document-column">
          <div className="reader-body">
            <ReaderErrorBoundary key={`${profile}:${reader.book.id}`} lang={lang} onClose={() => setPage('library')}>
              <Suspense fallback={<div className="reader-error">{lang === 'vi' ? 'Đang chuẩn bị trình đọc…' : 'Preparing reader…'}</div>}>
                <ReaderPane lang={lang} book={reader.book} bytes={reader.bytes} initial={reader.initial} fontSize={fontSize} fontFamily={fontFamily} lineHeight={lineHeight} textAlignment={textAlignment} readerWidth={readerWidth} theme={theme} onLocation={onLocation} onSelection={selectReaderPassage} onControls={setControls} onToc={setToc} navigateTarget={navigateTarget} navigateProgression={stealthProgressRequest} navigateLocator={noteNavigation} annotations={readerAnnotations} onSearchReady={onReaderSearchReady} onSpeechReady={onReaderSpeechReady} onSearchRequest={openReaderSearch} />
              </Suspense>
            </ReaderErrorBoundary>
          </div>
          <div className={`reader-footer ${controls ? 'has-controls' : 'progress-only'}`}>
            {controls && <button onClick={() => controls.previous()} aria-label={lang === 'vi' ? 'Trang trước' : 'Previous page'}><ChevronLeft size={21} />{lang === 'vi' ? 'Trước' : 'Previous'}</button>}
            <span>{Math.round((location?.progression || 0) * 100)}% · {location?.chapterTitle || (lang === 'vi' ? 'Đang đọc' : 'Reading')}</span>
            {controls && <button onClick={() => controls.next()} aria-label={lang === 'vi' ? 'Trang sau' : 'Next page'}>{lang === 'vi' ? 'Sau' : 'Next'}<ChevronRight size={21} /></button>}
          </div>
        </div>
        <ReaderNotesPanel key={`${profile}:${reader.book.id}`} open={noteOpen} lang={lang} bookTitle={reader.book.title}
          records={readerNotes} note={noteText} color={noteColor} quote={selection?.text || ''} saving={noteSaving}
          drawing={noteDrawing} onDrawingChange={changeReaderDrawing}
          canSave={!!(selection || noteAnchor.current || location) && !!(noteText.trim() || selection?.text || hasDrawing(noteDrawing))}
          onNoteChange={changeReaderNote} onColorChange={color => changeReaderNoteDraft({ color })}
          onClearQuote={() => changeReaderNoteDraft({ selection: null, anchor: locationRef.current })}
          onSave={() => void saveNote()} onNavigate={navigateToReaderNote}
          onUpdate={(record, changes) => changeReaderAnnotation(record, changes)} onDelete={record => changeReaderAnnotation(record)}
          onClose={() => { setNoteOpen(false); notesToggle.current?.focus() }} />
        <ReaderSearchPanel key={`search:${profile}:${reader.book.id}`} open={searchOpen} lang={lang} bookTitle={reader.book.title}
          source={readerSearchSource} format={detectReaderFormat(reader.book, reader.bytes)} activeId={activeSearchHit?.id}
          onNavigate={navigateToSearchHit} onClearActive={() => setActiveSearchHit(null)}
          onClose={() => { setSearchOpen(false); setActiveSearchHit(null); searchToggle.current?.focus() }} />
      </div></div>}

    {stealthActive && reader && (
      <ReaderErrorBoundary key={`${profile}:${reader.book.id}:stealth`} lang={lang} onClose={() => setPage('library')}><Suspense fallback={null}><StealthReader
        profile={profile}
        book={reader.book}
        bytes={reader.bytes}
        lang={lang}
        initialProgression={location?.progression || 0}
        initialLocator={location?.locatorJson}
        onClose={closeStealthReader}
        onExitHome={() => {
          setStealthGrant(null)
          closeReader()
          setPage('home')
          window.scrollTo({ top: 0, behavior: 'smooth' })
        }}
        onProgressChange={onStealthProgressChange}
      /></Suspense></ReaderErrorBoundary>
    )}

    {tocOpen && reader && <div className="modal-shade" role="presentation" onMouseDown={event => { if (event.target === event.currentTarget) setTocOpen(false) }}><aside className="toc-drawer" role="dialog" aria-modal="true" aria-label={translate("Mục lục sách", lang)}><div className="toc-header"><div><p className="eyebrow">{translate("MỤC LỤC SÁCH", lang)}</p><h2>{reader.book.title}</h2></div><button className="icon-button" onClick={() => setTocOpen(false)} aria-label={translate("Đóng mục lục", lang)}><X size={19} /></button></div><div className="toc-list">{toc.length ? <TocTree items={toc} onSelect={target => { setNoteNavigation(null); setNavigateTarget(target); setTocOpen(false) }} /> : <p className="muted" style={{ padding: '20px', textAlign: 'center', fontSize: '13px' }}>{translate("Tài liệu không có cấu trúc mục lục sẵn.", lang)}</p>}</div></aside></div>}

    {settingsOpen && reader && <div className="modal-shade" role="presentation" onMouseDown={event => { if (event.target === event.currentTarget) setSettingsOpen(false) }}><div className="dialog settings-popup" role="dialog" aria-modal="true" aria-label={translate("Tùy chỉnh đọc", lang)}><div className="dialog-header"><h2>{translate("Tùy chỉnh đọc", lang)}</h2><button className="icon-button" onClick={() => setSettingsOpen(false)} aria-label={translate("Đóng", lang)}><X size={18} /></button></div><label className="range-label">{translate("Cỡ chữ", lang)} <strong>{fontSize}%</strong><input type="range" min="80" max="170" step="10" value={fontSize} onChange={event => updateComfort({ fontSize: Number(event.target.value) })} /></label><div className="setting-group"><span className="setting-label">{translate("Kiểu chữ", lang)}</span><div className="toggle-row"><button className={`choice-chip ${fontFamily === 'serif' ? 'active' : ''}`} onClick={() => updateComfort({ fontFamily: 'serif' })}>{translate("Literata · Sách", lang)}</button><button className={`choice-chip ${fontFamily === 'sans' ? 'active' : ''}`} onClick={() => updateComfort({ fontFamily: 'sans' })}>{curT.accountPage.sansChoice}</button><button className={`choice-chip ${fontFamily === 'mono' ? 'active' : ''}`} onClick={() => updateComfort({ fontFamily: 'mono' })}>{translate("Đơn cách", lang)}</button></div></div><div className="setting-group"><span className="setting-label">{translate("Căn lề", lang)}</span><div className="toggle-row"><button className={`choice-chip ${textAlignment === 'left' ? 'active' : ''}`} onClick={() => updateComfort({ textAlignment: 'left' })}><AlignLeft size={15} />  {translate("Trái", lang)}</button><button className={`choice-chip ${textAlignment === 'justify' ? 'active' : ''}`} onClick={() => updateComfort({ textAlignment: 'justify' })}><AlignJustify size={15} />  {translate("Căn đều 2 bên", lang)}</button></div></div><div className="setting-group"><span className="setting-label">{translate("Khoảng cách dòng", lang)}</span><div className="toggle-row"><button className={`choice-chip ${lineHeight === 1.4 ? 'active' : ''}`} onClick={() => updateComfort({ lineHeight: 1.4 })}>{translate("Gọn (1.4)", lang)}</button><button className={`choice-chip ${lineHeight === 1.65 ? 'active' : ''}`} onClick={() => updateComfort({ lineHeight: 1.65 })}>{translate("Vừa (1.65)", lang)}</button><button className={`choice-chip ${lineHeight === 1.9 ? 'active' : ''}`} onClick={() => updateComfort({ lineHeight: 1.9 })}>{translate("Thoáng (1.9)", lang)}</button></div></div><div className="setting-group"><span className="setting-label">{translate("Độ rộng trang", lang)}</span><div className="toggle-row"><button className={`choice-chip ${readerWidth === 'narrow' ? 'active' : ''}`} onClick={() => updateComfort({ readerWidth: 'narrow' })}>{translate("Gọn", lang)}</button><button className={`choice-chip ${readerWidth === 'standard' ? 'active' : ''}`} onClick={() => updateComfort({ readerWidth: 'standard' })}>{translate("Tiêu chuẩn", lang)}</button><button className={`choice-chip ${readerWidth === 'wide' ? 'active' : ''}`} onClick={() => updateComfort({ readerWidth: 'wide' })}>{translate("Rộng", lang)}</button></div></div><div className="setting-group"><span className="setting-label">{translate("Màu nền", lang)}</span><div className="theme-row">{(['paper', 'sepia', 'night'] as const).map(value => <button key={value} className={`theme-chip ${value} ${theme === value ? 'chosen' : ''}`} onClick={() => updateComfort({ theme: value })}>{value === 'paper' ? translate("Giấy sáng", lang) : value === 'sepia' ? translate("Vàng dịu", lang) : translate("Ban đêm", lang)}</button>)}</div></div><div className="setting-group stealth-settings-section"><span className="setting-label">{lang === 'vi' ? 'Chế độ ngụy trang công sở (Boss Key)' : 'Workplace Disguise (Boss Key)'}</span><p className="muted" style={{ fontSize: '11px', margin: '4px 0 10px', lineHeight: 1.5 }}>{curT.stealth.keyboardGuide} {lang === 'vi' ? 'F2: bật/tắt Đọc ẩn · Pro. F10: toàn màn hình. Alt + 1/2/3: Excel/VS Code/Word. F12 hoặc Alt + P: ẩn nội dung sách.' : 'F2: enter/leave Stealth · Pro. F10: fullscreen. Alt + 1/2/3: Excel/VS Code/Word. F12 or Alt + P: hide book content.'}</p><button type="button" className="stealth-launch-btn" onClick={() => void launchStealth()}><Briefcase size={16} /> {lang === 'vi' ? 'Bật Đọc ẩn · Pro (F2)' : 'Activate Stealth · Pro (F2)'}</button></div></div></div>}


    {reviewOpen && reviewSession.queue.every(card => card.profile === profile) && <div className="modal-shade" role="presentation" onMouseDown={e => { if (e.target === e.currentTarget) setReviewOpen(false) }}><div className="flashcard-modal" role="dialog" aria-modal="true" aria-label={translate("Ôn tập ghi chú Flashcards", lang)}>
      <div className="flashcard-header">
        <div className="flashcard-header-copy"><p className="eyebrow">{translate('ÔN TẬP GHI CHÚ', lang)}</p>{(activeReview.scope.topicId || activeReview.scope.examPlanId) && <p className="muted" style={{ fontSize: 12, margin: '4px 0', overflowWrap: 'anywhere' }}>{toText(records.find(record => !record.deleted && record.payload.id === (activeReview.scope.topicId || activeReview.scope.examPlanId) && record.kind === (activeReview.scope.topicId ? 'knowledge_topics' : 'exam_plans'))?.payload.name)}</p>}<p className="flashcard-count">{reviewIndex < reviewQueue.length ? `${translate('Thẻ', lang)} ${reviewIndex + 1} / ${reviewQueue.length}` : translate('Đã hoàn thành', lang)}</p></div>
        <span className="flashcard-mastered"><strong>{reviewStats.mastered}</strong><span>{translate('đã thuộc', lang)}</span></span>
        <button type="button" className="icon-button flashcard-close" onClick={() => setReviewOpen(false)} aria-label={translate('Đóng', lang)} autoFocus><X size={20} /></button>
      </div>
      {reviewIndex < reviewQueue.length ? (() => {
      const card = reviewQueue[reviewIndex]
      const book = books.find(b => b.id === card.payload.book_id)
      const quote = toText(card.payload.text)
      const note = toText(card.payload.note)
      const chapter = toText(card.payload.chapter_title)
      const progressPct = Math.round((reviewIndex / reviewQueue.length) * 100)
      return <>
        <div className="flashcard-progress-bar" role="progressbar" aria-label={translate('Tiến độ ôn tập', lang)} aria-valuemin={0} aria-valuemax={reviewQueue.length} aria-valuenow={reviewIndex}><span style={{ width: `${progressPct}%` }} /></div>
        <div className={`flashcard ${cardFlipped ? 'flipped' : ''}`} role="button" tabIndex={0} aria-label={cardFlipped ? translate('Xem lại mặt trước', lang) : translate('Lật thẻ xem ghi chú', lang)} aria-pressed={cardFlipped} onClick={() => setCardFlipped(!cardFlipped)} onKeyDown={event => { if (event.target === event.currentTarget && (event.key === 'Enter' || event.key === ' ')) { event.preventDefault(); setCardFlipped(value => !value) } }}>
          <div className="flashcard-inner">
            <div className="flashcard-front" aria-hidden={cardFlipped}>
              <div className="flashcard-book"><span className="flashcard-book-title" title={book?.title}>{book?.title || translate('Tài liệu', lang)}</span>{chapter && <span className="flashcard-chapter">{chapter}</span>}</div>
              <div className="flashcard-quote">“{quote || note || translate("Ghi nhớ quan trọng", lang)}”</div>
              <div className="flashcard-hint">{translate('Bấm thẻ để xem ghi chú', lang)}</div>
            </div>
            <div className="flashcard-back" aria-hidden={!cardFlipped}>
              <div className="flashcard-book">{translate('GHI CHÚ & SUY NGẪM', lang)}</div>
              <div className="flashcard-note-title">{translate("Nội dung ghi chú của bạn:", lang)}</div>
              <div className="flashcard-note">{note || (!hasDrawing(card.payload.drawing) && translate("Không có ghi chú riêng; hãy ghi nhớ lại đoạn trích trên.", lang))}</div>
              {hasDrawing(card.payload.drawing) && <DrawingPreview drawing={card.payload.drawing} label={lang === 'vi' ? 'Ghi chú vẽ tay' : 'Handwritten note'} />}
              <div className="flashcard-hint">{translate('Đánh giá khả năng ghi nhớ bên dưới:', lang)}</div>
            </div>
          </div>
        </div>
        <button className="flip-card-btn" onClick={() => setCardFlipped(!cardFlipped)}><RotateCcw size={15} /> {cardFlipped ? translate('Xem lại mặt trước', lang) : translate('Lật thẻ xem ghi chú', lang)}</button>
        <div className="flashcard-actions">
          <button className="rating-btn again" disabled={reviewBusy} onClick={() => void handleFlashcardRating('again')}>{translate('Cần ôn lại', lang)}</button>
          <button className="rating-btn good" disabled={reviewBusy} onClick={() => void handleFlashcardRating('good')}>{translate('Đã nhớ rõ', lang)}</button>
        </div>
        <button className="text-button" disabled={reviewBusy} onClick={() => void handleFlashcardRating('skip')}>{lang === 'vi' ? 'Bỏ qua lần này — không tính là quên' : 'Skip for now — not a failed review'}</button>
      </>
    })() : <div className="review-complete">
      <h2>{lang === 'vi' ? 'Phiên ôn đã kết thúc' : 'Review session finished'}</h2>
      <p className="muted">{lang === 'vi' ? 'Thẻ bỏ qua vẫn chưa được tính là đã ôn. Ghi chú bị gỡ khỏi chủ đề không nhận kết quả ôn tập.' : 'Skipped cards remain unreviewed. Notes removed from a topic receive no review result.'}</p>
      <div className="review-stats-row">
        <div className="review-stat-pill">{translate('Đã nhớ:', lang)} {reviewStats.mastered} {lang === 'en' && reviewStats.mastered === 1 ? 'card' : translate('thẻ', lang)}</div>
        <div className="review-stat-pill">{translate('Ôn lại:', lang)} {reviewStats.reviewAgain} {lang === 'en' && reviewStats.reviewAgain === 1 ? 'time' : translate('lần', lang)}</div>
        <div className="review-stat-pill">{lang === 'vi' ? 'Bỏ qua:' : 'Skipped:'} {reviewStats.skipped}</div>
      </div>
      <div className="review-complete-actions">
        <button className="secondary" onClick={() => void startFlashcardReview(false, activeReview.scope)}>{translate("Ôn tập lại", lang)}</button>
        <button className="primary" onClick={() => setReviewOpen(false)}>{translate("Hoàn tất", lang)}</button>
      </div>
    </div>}</div></div>}

    {editingAnnotation?.profile === profile && <AnnotationEditor key={editingAnnotation.key} record={editingAnnotation} lang={lang} busy={annotationBusy} error={annotationError} onClose={() => { if (!annotationBusy) setEditingAnnotation(null) }} onSave={changes => void handleAnnotationSave(changes)} />}
    {deletingAnnotation?.profile === profile && <AnnotationDeleteDialog record={deletingAnnotation} lang={lang} busy={annotationBusy} error={annotationError} onClose={() => { if (!annotationBusy) setDeletingAnnotation(null) }} onDelete={() => void handleAnnotationDelete()} />}
    {proRequiredFeature && <ProRequiredDialog feature={proRequiredFeature} lang={lang} onClose={() => setProRequiredFeature(null)} onPlans={() => { setProRequiredFeature(null); setPage('account'); setAccountSection('pro') }} />}

    {editNameOpen && session && <div className="modal-shade"><div className="dialog" role="dialog" aria-modal="true" aria-labelledby="edit-name-title">
      <button className="icon-button dialog-close" onClick={() => setEditNameOpen(false)} disabled={savingName} aria-label={curT.auth.close}><X size={19} /></button>
      <h2 id="edit-name-title">{curT.accountPage.editDisplayName}</h2>
      <form onSubmit={event => { event.preventDefault(); void handleUpdateDisplayName() }}>
        <label htmlFor="display-name">{lang === 'vi' ? 'Tên hiển thị' : 'Display name'}</label>
        <input id="display-name" value={editNameInput} onChange={event => setEditNameInput(event.target.value)} maxLength={80} required autoFocus />
        <div className="dialog-actions"><button type="button" className="secondary" onClick={() => setEditNameOpen(false)} disabled={savingName}>{curT.auth.close}</button><button className="primary" disabled={savingName || !editNameInput.trim()}>{savingName ? curT.auth.processing : curT.accountPage.saveName}</button></div>
      </form>
    </div></div>}

    {deleteAccountOpen && session && <div className="modal-shade"><div className="dialog" role="dialog" aria-modal="true" aria-labelledby="delete-account-title">
      <h2 id="delete-account-title">{curT.accountPage.deleteAccountBtn}</h2>
      <p>{curT.accountPage.deleteAccountWarning}</p>
      <div className="dialog-actions"><button className="secondary" onClick={() => setDeleteAccountOpen(false)} disabled={deleteAccountBusy}>{lang === 'vi' ? 'Hủy' : 'Cancel'}</button><button className="primary" onClick={() => void handleDeleteAccount()} disabled={deleteAccountBusy}>{deleteAccountBusy ? curT.auth.processing : curT.accountPage.deleteAccountBtn}</button></div>
    </div></div>}

    {tagsCollectionsOpen && <div className="modal-shade"><div className="dialog" role="dialog" aria-modal="true" aria-labelledby="organization-title">
      <button className="icon-button dialog-close" onClick={() => setTagsCollectionsOpen(false)} aria-label={curT.auth.close}><X size={19} /></button>
      <h2 id="organization-title">{curT.accountPage.manageTagsCollections}</h2>
      <div className="toggle-row"><button className={`choice-chip ${tagTab === 'tags' ? 'active' : ''}`} onClick={() => setTagTab('tags')}>{curT.filters.tagsGroup}</button><button className={`choice-chip ${tagTab === 'collections' ? 'active' : ''}`} onClick={() => setTagTab('collections')}>{curT.filters.collectionsGroup}</button></div>
      <form onSubmit={event => { event.preventDefault(); void (tagTab === 'tags' ? handleCreateTag() : handleCreateCollection()) }}>
        <label htmlFor="organization-name">{tagTab === 'tags' ? curT.filters.tagsGroup : curT.filters.collectionsGroup}</label>
        <input id="organization-name" value={tagTab === 'tags' ? newTagName : newCollectionName} onChange={event => tagTab === 'tags' ? setNewTagName(event.target.value) : setNewCollectionName(event.target.value)} maxLength={80} required />
        <div className="dialog-actions"><button className="primary" disabled={organizationBusy || !(tagTab === 'tags' ? newTagName : newCollectionName).trim()}><Plus size={16} />{organizationBusy ? curT.auth.processing : (lang === 'vi' ? 'Thêm' : 'Add')}</button></div>
      </form>
      <div style={{ maxHeight: '40vh', overflow: 'auto', marginTop: '12px' }}>
        {(tagTab === 'tags' ? tags : collections).map(item => (
          <div key={item.id} className="backup-item">
            {editingItemId === item.id ? (
              <form
                onSubmit={e => {
                  e.preventDefault()
                  void (tagTab === 'tags' ? handleUpdateTag(item.id, editingItemName) : handleUpdateCollection(item.id, editingItemName))
                }}
                style={{ display: 'flex', gap: '6px', width: '100%' }}
              >
                <input
                  value={editingItemName}
                  onChange={e => setEditingItemName(e.target.value)}
                  autoFocus
                  style={{ flex: 1, padding: '4px 8px', borderRadius: '4px', border: '1px solid #cbd5e1' }}
                />
                <button type="submit" className="primary" disabled={organizationBusy} aria-label={lang === 'vi' ? 'Lưu tên' : 'Save name'} style={{ padding: '4px 8px' }}><Check size={14} /></button>
                <button type="button" className="secondary" style={{ padding: '4px 8px' }} onClick={() => setEditingItemId(null)}><X size={14} /></button>
              </form>
            ) : (
              <>
                <span style={{ fontWeight: 500 }}>{item.name}</span>
                <div style={{ display: 'flex', gap: '4px' }}>
                  <button
                    className="icon-button"
                    disabled={organizationBusy}
                    title={lang === 'vi' ? 'Đổi tên' : 'Rename'}
                    aria-label={`${lang === 'vi' ? 'Sửa' : 'Edit'} ${item.name}`}
                    onClick={() => { setEditingItemId(item.id); setEditingItemName(item.name) }}
                  >
                    <Edit3 size={15} />
                  </button>
                  <button
                    className="icon-button"
                    disabled={organizationBusy}
                    title={lang === 'vi' ? 'Xóa' : 'Delete'}
                    aria-label={`${lang === 'vi' ? 'Xóa' : 'Delete'} ${item.name}`}
                    onClick={() => {
                      if (confirm(`${lang === 'vi' ? 'Xóa' : 'Delete'} ${item.name}?`)) {
                        void (tagTab === 'tags' ? handleDeleteTag(item.id) : handleDeleteCollection(item.id))
                      }
                    }}
                  >
                    <Trash2 size={15} />
                  </button>
                </div>
              </>
            )}
          </div>
        ))}
      </div>
    </div></div>}

    {conflictModalOpen && session && <div className="modal-shade"><div className="dialog" role="dialog" aria-modal="true" aria-labelledby="conflict-title">
      <button className="icon-button dialog-close" onClick={() => setConflictModalOpen(false)} aria-label={curT.auth.close}><X size={19} /></button>
      <h2 id="conflict-title">{lang === 'vi' ? 'Xung đột đồng bộ' : 'Sync conflicts'}</h2>
      <p className="muted">{lang === 'vi' ? 'Chọn phiên bản muốn giữ cho mỗi mục.' : 'Choose which version to keep for each item.'}</p>
      <div style={{ maxHeight: '55vh', overflow: 'auto' }}>{conflicts.map(item => <section key={item.key}>
        <p>{toText(item.operation.payload.text) || toText(item.operation.payload.name) || item.operation.kind}</p>
        {!canKeepLocalConflict(item) && <p className="muted">{lang === 'vi' ? 'Mục nghiên cứu này đã bị xóa trên thiết bị khác. Dùng bản cloud để xác nhận xóa; bạn có thể tạo một mục mới. Ghi chú gốc vẫn được giữ.' : 'This research item was deleted on another device. Use the cloud version to accept deletion; you can create a new item. Original notes are retained.'}</p>}
        <div className="dialog-actions"><button className="secondary" onClick={() => void handleResolveConflict(item.key, 'take_remote')}>{lang === 'vi' ? 'Dùng bản cloud' : 'Use cloud version'}</button><button className="primary" disabled={!canKeepLocalConflict(item)} onClick={() => void handleResolveConflict(item.key, 'keep_local')}>{lang === 'vi' ? 'Giữ bản trên máy' : 'Keep local version'}</button></div>
      </section>)}</div>
    </div></div>}

    {authOpen && <AuthDialog lang={lang} onClose={() => setAuthOpen(false)} onSuccess={value => void authenticated(value)} />}
    {selectedBook && <BookDetailsModal
      book={selectedBook}
      lang={lang}
      categories={categories}
      progress={Number(progressFor(records, selectedBook.id)?.payload.progression || 0)}
      isFavorite={favorites.has(selectedBook.id)}
      downloadBusy={downloadBusy === selectedBook.id}
      allTags={tags}
      allCollections={collections}
      assignedTagIds={bookTags.get(selectedBook.id) || new Set()}
      assignedCollectionIds={bookCollections.get(selectedBook.id) || new Set()}
      onToggleTag={tagId => void handleToggleBookTag(selectedBook.id, tagId)}
      onToggleCollection={colId => void handleToggleBookCollection(selectedBook.id, colId)}
      onClose={closeBookDetails}
      onRead={() => { const b = selectedBook; setSelectedBook(null); void openBook(b) }}
      onStealthRead={() => void launchStealth(selectedBook)}
      onFavorite={selectedBook.source === 'local' ? undefined : () => void toggleFavorite(selectedBook)}
      onDownload={(selectedBook.source === 'local' || selectedBook.fileUrl) ? () => void downloadBook(selectedBook) : undefined}
      onDelete={selectedBook.source === 'local' || selectedBook.source === 'cloud' ? () => { const b = selectedBook; closeBookDetails(); void deleteBook(b) } : undefined}
    />}
  </div>
}

function TocTree({ items, onSelect }: { items: TocItem[]; onSelect: (href: string) => void }) {
  return <div>{items.map(item => <div key={item.id}><button className="toc-btn" disabled={!item.href} onClick={() => onSelect(item.href)}>{item.label}</button>{item.subitems && item.subitems.length > 0 && <div className="toc-sub"><TocTree items={item.subitems} onSelect={onSelect} /></div>}</div>)}</div>
}


function SectionHeader({ title, action, onAction }: { title: string; action: string; onAction: () => void }) {
  return <div className="section-header"><h2>{title}</h2><button onClick={onAction}>{action} <ArrowRight size={16} /></button></div>
}

function BookCard({ book, progress, onOpen, onStealth, onDetails, favorite, onFavorite, onDelete, offline, downloadBusy, onDownload, lang = 'vi' }: { book: Book; progress?: number; onOpen: () => void; onStealth?: () => void; onDetails?: () => void; favorite: boolean; onFavorite?: () => void; onDelete?: () => void; offline?: boolean; downloadBusy?: boolean; onDownload?: () => void; lang?: Lang }) {
  const handleDetails = onDetails || onOpen
  const curT = t[lang]
  const metaText = offline ? curT.bookCard.availableLocally : book.source === 'cloud' ? curT.bookCard.cloudPersonal : book.language === 'vi' ? curT.bookCard.vietnamese : curT.bookCard.ebook
  return <article className="book-card"><button className="cover-button" onClick={handleDetails} aria-label={curT.bookCard.detailsAria(book.title)}><div className="book-cover">{book.coverUrl ? <img src={book.coverUrl} alt="" loading="lazy" onError={event => { event.currentTarget.style.display = 'none' }} /> : null}<div className="cover-fallback"><BookOpen size={34} /><small>NoCap</small></div></div></button><div className="book-info"><div className="book-meta">{metaText}</div><button className="book-title" onClick={handleDetails}>{book.title}</button><p>{bookLabel(book, lang)}</p>{!!progress && <div className="progress-bar" aria-label={curT.bookCard.readPercentAria(Math.round(progress * 100))}><span style={{ width: `${Math.max(2, progress * 100)}%` }} /></div>}<div className="card-actions"><button className="read-link" onClick={onOpen}>{progress ? curT.bookCard.continueReading : curT.bookCard.startReading} <ArrowRight size={15} /></button>{onStealth && <button type="button" className="icon-button stealth-card-btn" title={curT.bookCard.stealthRead || (lang === 'vi' ? 'Đọc ẩn công sở · Pro (F2)' : 'Stealth Read · Pro (F2)')} aria-label={curT.bookCard.stealthRead || translate("Đọc ẩn công sở", lang)} onClick={e => { e.stopPropagation(); onStealth() }}><Briefcase size={16} /></button>}{onDownload && <button className="icon-button" title={downloadBusy ? curT.download.preparing : curT.bookCard.downloadFile} aria-label={`${downloadBusy ? curT.download.preparing : curT.bookCard.downloadFile}: ${book.title}`} onClick={onDownload} disabled={downloadBusy} aria-busy={downloadBusy}><Download size={17} /></button>}{onFavorite && <button className="icon-button" title={favorite ? curT.bookCard.unfavorite : curT.bookCard.favorite} aria-label={favorite ? `${curT.bookCard.unfavorite}: ${book.title}` : `${curT.bookCard.favorite}: ${book.title}`} onClick={onFavorite}><BookMarked size={17} fill={favorite ? 'currentColor' : 'none'} /></button>}{onDelete && <button className="icon-button" title={curT.bookCard.deleteFile} aria-label={curT.bookCard.deleteFile} onClick={onDelete}><Trash2 size={17} /></button>}</div></div></article>
}

function BookDetailsModal({
  book,
  categories,
  progress,
  isFavorite,
  downloadBusy,
  allTags = [],
  allCollections = [],
  assignedTagIds = new Set(),
  assignedCollectionIds = new Set(),
  onToggleTag,
  onToggleCollection,
  onClose,
  onRead,
  onStealthRead,
  onFavorite,
  onDownload,
  onDelete,
  lang = 'vi',
}: {
  book: Book
  categories: Category[]
  progress?: number
  isFavorite: boolean
  downloadBusy?: boolean
  allTags?: { id: string; name: string }[]
  allCollections?: { id: string; name: string }[]
  assignedTagIds?: Set<string>
  assignedCollectionIds?: Set<string>
  onToggleTag?: (tagId: string) => void
  onToggleCollection?: (colId: string) => void
  onClose: () => void
  onRead: () => void
  onStealthRead?: () => void
  onFavorite?: () => void
  onDownload?: () => void
  onDelete?: () => void
  lang?: Lang
}) {
  const curT = t[lang]
  const categoryName = translate(categories.find(c => c.id === book.categoryId)?.name || (book.source === 'local' ? curT.bookModal.privateDoc : curT.bookModal.generalCategory), lang)
  const progressPct = progress ? Math.round(progress * 100) : 0
  const sizeFormatted = book.fileSizeBytes ? `${(book.fileSizeBytes / (1024 * 1024)).toFixed(1)} MB` : undefined

  return (
    <div className="modal-shade" role="presentation" onMouseDown={e => { if (e.target === e.currentTarget) onClose() }}>
      <div className="book-details-modal" role="dialog" aria-modal="true" aria-labelledby="book-detail-title">
        <button className="icon-button dialog-close" onClick={onClose} aria-label={translate("Đóng", lang)}><X size={20} /></button>
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
                <button className="secondary stealth-modal-btn" onClick={onStealthRead} title={lang === 'vi' ? 'Đọc ngụy trang giao diện Excel / VS Code công sở (Phím F2)' : 'Stealth Read disguised as Excel / VS Code (F2)'}>
                  <Briefcase size={16} /> {lang === 'vi' ? 'Đọc ẩn · Pro (F2)' : 'Stealth · Pro (F2)'}
                </button>
              )}
              {onDownload && (
                <button className="secondary" onClick={onDownload} disabled={downloadBusy}>
                  <Download size={16} /> {downloadBusy ? curT.download.preparing : curT.bookModal.downloadFile}
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
        {(allTags.length > 0 || allCollections.length > 0) && (
          <div className="book-details-tags-section">
            {allTags.length > 0 && (
              <div className="book-details-tag-group">
                <span className="book-details-group-label"><Tag size={12} /> {lang === 'vi' ? 'Thẻ' : 'Tags'}</span>
                <div className="book-details-tag-chips">
                  {allTags.map(tag => (
                    <button
                      key={tag.id}
                      className={`tag-chip${assignedTagIds.has(tag.id) ? ' active' : ''}`}
                      onClick={() => onToggleTag?.(tag.id)}
                      title={assignedTagIds.has(tag.id) ? (lang === 'vi' ? 'Bỏ thẻ' : 'Remove tag') : (lang === 'vi' ? 'Gán thẻ' : 'Assign tag')}
                    >
                      {assignedTagIds.has(tag.id) && <Check size={11} />} {tag.name}
                    </button>
                  ))}
                </div>
              </div>
            )}
            {allCollections.length > 0 && (
              <div className="book-details-tag-group">
                <span className="book-details-group-label"><Layers size={12} /> {lang === 'vi' ? 'Bộ sưu tập' : 'Collections'}</span>
                <div className="book-details-tag-chips">
                  {allCollections.map(col => (
                    <button
                      key={col.id}
                      className={`collection-chip${assignedCollectionIds.has(col.id) ? ' active' : ''}`}
                      onClick={() => onToggleCollection?.(col.id)}
                      title={assignedCollectionIds.has(col.id) ? (lang === 'vi' ? 'Bỏ khỏi bộ sưu tập' : 'Remove from collection') : (lang === 'vi' ? 'Thêm vào bộ sưu tập' : 'Add to collection')}
                    >
                      {assignedCollectionIds.has(col.id) && <Check size={11} />} {col.name}
                    </button>
                  ))}
                </div>
              </div>
            )}
          </div>
        )}
      </div>
    </div>
  )
}

function AuthDialog({ lang, onClose, onSuccess }: { lang: Lang; onClose: () => void; onSuccess: (session: Session) => void }) {
  const [mode, setMode] = useState<AuthMode>('login')
  const [email, setEmail] = useState('')
  const [password, setPassword] = useState('')
  const [busy, setBusy] = useState(false)
  const [message, setMessage] = useState('')
  const googleBtnRef = useRef<HTMLDivElement>(null)
  const request = useRef({ mounted: true, generation: 0, busy: false })
  const copy = t[lang].auth

  useEffect(() => {
    const lifecycle = request.current
    lifecycle.mounted = true
    return () => { lifecycle.mounted = false; lifecycle.generation++; lifecycle.busy = false }
  }, [])

  function cancelAttempt() {
    request.current.generation++
    request.current.busy = false
    setBusy(false)
  }

  function close() { cancelAttempt(); onClose() }
  function changeMode(next: AuthMode) { cancelAttempt(); setMode(next); setMessage('') }

  const authenticate = useCallback(async (action: () => Promise<Session | undefined>, successMessage = '') => {
    if (!request.current.mounted || request.current.busy) return
    const generation = ++request.current.generation
    request.current.busy = true
    setBusy(true); setMessage('')
    const current = () => request.current.mounted && request.current.generation === generation
    try {
      const result = await action()
      if (!current()) return
      if (result) onSuccess(result)
      else setMessage(successMessage)
    } catch (error) { if (current()) setMessage(readableError(error, lang)) }
    finally { if (current()) { request.current.busy = false; setBusy(false) } }
  }, [lang, onSuccess])

  useEffect(() => {
    if (mode !== 'login' && mode !== 'register') return
    let cancelled = false
    function initGoogle() {
      if (cancelled) return
      const g = (window as unknown as Record<string, unknown>).google as { accounts: { id: { initialize: (opts: Record<string, unknown>) => void; renderButton: (el: HTMLElement, opts: Record<string, unknown>) => void } } } | undefined
      if (!g?.accounts?.id) return
      g.accounts.id.initialize({
        client_id: '847491126060-3dikoskpsf80ibrnf799tivmpe8vj2bn.apps.googleusercontent.com',
        callback: async (resp: { credential?: string }) => {
          if (cancelled || !resp.credential) return
          await authenticate(() => loginWithGoogle(resp.credential!))
        },
      })
      if (googleBtnRef.current) {
        g.accounts.id.renderButton(googleBtnRef.current, {
          type: 'standard',
          theme: 'outline',
          size: 'large',
          text: mode === 'register' ? 'signup_with' : 'signin_with',
          shape: 'rectangular',
          width: Math.min(320, googleBtnRef.current.clientWidth || 320),
          locale: lang === 'vi' ? 'vi' : 'en',
        })
      }
    }
    // If GIS already loaded
    if ((window as unknown as Record<string, unknown>).google) { initGoogle(); return () => { cancelled = true } }
    // Otherwise inject the script and wait
    const existing = document.getElementById('gsi-script')
    if (!existing) {
      const script = document.createElement('script')
      script.id = 'gsi-script'
      script.src = 'https://accounts.google.com/gsi/client'
      script.async = true
      script.defer = true
      script.onload = initGoogle
      document.head.appendChild(script)
    } else {
      existing.addEventListener('load', initGoogle)
    }
    return () => { cancelled = true; existing?.removeEventListener('load', initGoogle) }
  }, [mode, lang, authenticate])

  async function submit(event: React.FormEvent) {
    event.preventDefault()
    await authenticate(async () => {
      if (mode === 'forgot') { await forgotPassword(email); return undefined }
      return mode === 'register' ? register(email, password) : login(email, password)
    }, copy.forgotDescription)
  }

  return (
    <div className="modal-shade" role="presentation" onMouseDown={event => { if (event.target === event.currentTarget) close() }}>
      <div className="dialog auth-dialog" role="dialog" aria-modal="true" aria-labelledby="auth-title">
        <button className="icon-button dialog-close" onClick={close} aria-label={copy.close}><X size={19} /></button>
        <div className="auth-mark"><BookOpen size={25} /></div>
        <p className="eyebrow">{copy.accountEyebrow}</p>
        <h2 id="auth-title">{mode === 'login' ? copy.loginTitle : mode === 'register' ? copy.registerTitle : copy.forgotTitle}</h2>
        <p className="muted">{mode === 'forgot' ? copy.forgotDescription : copy.description}</p>
        {(mode === 'login' || mode === 'register') && (
          <div className="auth-social-section">
            <div className="google-btn-wrapper" ref={googleBtnRef} />
          </div>
        )}
        {(mode === 'login' || mode === 'register') && (
          <div className="auth-divider"><span>{lang === 'vi' ? 'hoặc dùng email' : 'or use email'}</span></div>
        )}
        <form onSubmit={event => void submit(event)}>
          <label>Email<input type="email" autoComplete="email" required value={email} onChange={event => setEmail(event.target.value)} placeholder="email@example.com" /></label>
          {mode !== 'forgot' && <label>{copy.password}<input type="password" autoComplete={mode === 'login' ? 'current-password' : 'new-password'} minLength={mode === 'register' ? 8 : undefined} required value={password} onChange={event => setPassword(event.target.value)} placeholder={mode === 'register' ? copy.newPasswordPlaceholder : copy.passwordPlaceholder} /></label>}
          {message && <p className="form-message" role="status">{message}</p>}
          <button className="primary wide" type="submit" disabled={busy}>{busy ? copy.processing : mode === 'login' ? copy.login : mode === 'register' ? copy.register : copy.sendInstructions} <ArrowRight size={17} /></button>
        </form>
        <div className="auth-links">
          {mode !== 'login' && <button onClick={() => changeMode('login')}>{copy.login}</button>}
          {mode !== 'register' && <button onClick={() => changeMode('register')}>{copy.register}</button>}
          {mode === 'login' && <button onClick={() => changeMode('forgot')}>{copy.forgotPassword}</button>}
        </div>
      </div>
    </div>
  )
}

export default App
