import { useCallback, useEffect, useId, useMemo, useRef, useState } from 'react'
import { createPortal } from 'react-dom'
import { Bookmark, BookOpen, ChevronLeft, ChevronRight, FilePenLine, List, RefreshCw, Search, Settings2, X } from 'lucide-react'
import { ReaderPane } from './Reader'
import { ReaderErrorBoundary } from './ReaderErrorBoundary'
import { ReaderNotesPanel } from './ReaderNotesPanel'
import { ReaderSearchPanel } from './ReaderSearchPanel'
import { annotationId, deleteAnnotation, updateAnnotation, type AnnotationChanges } from './annotations'
import { hasDrawing, parseDrawing, type Drawing } from './drawing'
import { emptyReaderNoteDraft, readReaderNoteDraft, writeReaderNoteDraft, clearReaderNoteDraft, type ReaderNoteDraft } from './readerNoteDrafts'
import { detectReaderFormat } from './readerFormat'
import type { ReaderSearchHit, ReaderSearchSource } from './readerSearch'
import { applyLocalMutations, keyFor } from './store'
import { androidRecordId, mutate, readableError } from './sync'
import type { Lang } from './i18n'
import type { Book, FontFamily, ReaderAnnotation, ReaderLocation, ReaderWidth, SyncRecord, TextAlignment, TocItem } from './types'
import './ComparisonReader.css'

export type ComparisonReaderProps = {
  profile: string
  lang: Lang
  books: [Book, Book]
  initialLocators: [string | undefined, string | undefined]
  records: SyncRecord[]
  loadBook: (book: Book, signal: AbortSignal) => Promise<ArrayBuffer>
  onClose: () => void
  onChanged: () => Promise<void>
  onLocation?: (book: Book, location: ReaderLocation) => void
}

type ToolPanel = 'notes' | 'search' | null
type Actions = { page: (direction: number) => void; search: () => void; dismiss: () => boolean; closeTool: () => void }
type PaneProps = Omit<ComparisonReaderProps, 'books' | 'initialLocators' | 'onClose'> & {
  book: Book; initial?: string; index: number; active: boolean; onActivate: () => void
  register: (actions: Actions | null) => void
  onCommitted: (record: SyncRecord) => Promise<void>
  toolsHost: HTMLElement | null
  onPanelState: (index: number, panel: ToolPanel) => void
}
type Controls = { previous: () => void; next: () => void }
type Comfort = { fontSize: number; fontFamily: FontFamily; theme: 'paper' | 'sepia' | 'night'; lineHeight: number; textAlignment: TextAlignment; readerWidth: ReaderWidth }
type NoteFlight = { snapshot: ReaderNoteDraft; promise: Promise<SyncRecord> }
// Keep a local commit single-flight even if the comparison is closed/reopened.
const noteFlights = new Map<string, NoteFlight>()
const bookmarkFlights = new Set<string>()

function initialNavigation(locatorJson?: string): { locatorJson: string; requestId: number } | null {
  if (!locatorJson) return null
  try {
    const locator = JSON.parse(locatorJson)
    return locator && typeof locator === 'object' && !Array.isArray(locator) ? { locatorJson, requestId: 1 } : null
  } catch { return null }
}

function initialComfort(records: SyncRecord[], profile: string, bookId: string): Comfort {
  const defaults: Comfort = { fontSize: 100, fontFamily: 'serif', theme: 'paper', lineHeight: 1.65, textAlignment: 'left', readerWidth: 'standard' }
  try {
    const stored = JSON.parse(localStorage.getItem('nocap-reader-comfort-v1') || 'null')
    if (stored) {
      if (Number.isFinite(stored.fontSize)) defaults.fontSize = Math.max(80, Math.min(170, stored.fontSize))
      if (['serif', 'sans', 'mono'].includes(stored.fontFamily)) defaults.fontFamily = stored.fontFamily
      if (['paper', 'sepia', 'night'].includes(stored.theme)) defaults.theme = stored.theme
      if ([1.4, 1.65, 1.9].includes(stored.lineHeight)) defaults.lineHeight = stored.lineHeight
      if (stored.textAlignment === 'justify') defaults.textAlignment = 'justify'
      if (['narrow', 'standard', 'wide'].includes(stored.readerWidth)) defaults.readerWidth = stored.readerWidth
    }
  } catch { /* retain the default reading comfort */ }
  const saved = records.find(record => record.profile === profile && !record.deleted && record.kind === 'per_book_preferences' && record.payload.book_id === bookId)?.payload
  if (!saved || saved.use_book_override === 0 || saved.use_book_override === false) return defaults
  return { fontSize: Math.max(80, Math.min(170, Math.round((Number(saved.font_size) || 1) * 100))), fontFamily: saved.font_family === 'SANS_SERIF' || saved.font_family === 'ROBOTO' ? 'sans' : saved.font_family === 'CUSTOM' ? 'mono' : 'serif', theme: saved.theme === 'DARK' ? 'night' : saved.theme === 'SEPIA' ? 'sepia' : 'paper', lineHeight: Math.max(1.2, Math.min(2, Number(saved.line_height) || defaults.lineHeight)), textAlignment: saved.text_alignment === 'JUSTIFY' ? 'justify' : 'left', readerWidth: defaults.readerWidth }
}

function Contents({ items, onNavigate, depth = 0 }: { items: TocItem[]; onNavigate: (href: string) => void; depth?: number }) {
  return <ul>{items.map((item, index) => <li key={`${item.id}:${index}`}><button type="button" style={{ paddingInlineStart: `${12 + depth * 12}px` }} onClick={() => onNavigate(item.href)}>{item.label}</button>{item.subitems?.length ? <Contents items={item.subitems} onNavigate={onNavigate} depth={depth + 1} /> : null}</li>)}</ul>
}

function ComparisonPane({ profile, lang, book, initial, records, loadBook, index, active, onActivate, register, onCommitted, onLocation, toolsHost, onPanelState }: PaneProps) {
  const vi = lang === 'vi'
  const text = (v: string, e: string) => vi ? v : e
  const id = useId().replaceAll(':', '')
  const prefix = `comparison-${index}-${id}`
  // This namespace keeps two independent drafts for the same source and leaves
  // the normal reader's account/book draft untouched.
  const draftProfile = `COMPARISON:${JSON.stringify([profile, index])}`
  const flightKey = JSON.stringify([profile, book.id, index])
  const [draft, setDraft] = useState<ReaderNoteDraft>(() => readReaderNoteDraft(draftProfile, book.id) || emptyReaderNoteDraft())
  const draftRef = useRef(draft)
  const [panel, setPanel] = useState<ToolPanel>(() => draft.note || draft.selection || hasDrawing(draft.drawing) ? 'notes' : null)
  const [comfort, setComfort] = useState<Comfort>(() => initialComfort(records, profile, book.id))
  const [settings, setSettings] = useState(false)
  const [tocOpen, setTocOpen] = useState(false)
  const [toc, setToc] = useState<TocItem[]>([])
  const [load, setLoad] = useState<{ bytes?: ArrayBuffer; error?: string }>({})
  const ready = Boolean(load.bytes)
  const [retry, setRetry] = useState(0)
  const [notice, setNotice] = useState('')
  const [saving, setSaving] = useState(false)
  const [bookmarkSaving, setBookmarkSaving] = useState(false)
  const [location, setLocation] = useState<ReaderLocation | null>(null)
  const locationRef = useRef(location)
  const controls = useRef<Controls | null>(null)
  const [source, setSource] = useState<ReaderSearchSource | null>(null)
  const [activeHit, setActiveHit] = useState<ReaderSearchHit | null>(null)
  const [target, setTarget] = useState<string | null>(null)
  const [navigate, setNavigate] = useState<{ locatorJson: string; requestId: number } | null>(() => initialNavigation(initial))
  const requestId = useRef(1)
  const host = useRef<HTMLDivElement>(null)
  const noteButton = useRef<HTMLButtonElement>(null)
  const searchButton = useRef<HTMLButtonElement>(null)
  const alive = useRef(true)
  const activeRef = useRef(active)
  useEffect(() => { activeRef.current = active }, [active])
  const busy = useRef(false)
  const bookmarkBusy = useRef(false)
  const loader = useRef(loadBook)
  const callbacks = useRef({ onLocation, onCommitted })
  const sourceBook = useRef(book)
  const [initialLocator] = useState(initial)
  useEffect(() => { loader.current = loadBook; callbacks.current = { onLocation, onCommitted } }, [loadBook, onLocation, onCommitted])
  useEffect(() => { sourceBook.current = book }, [book])
  useEffect(() => {
    if (active && locationRef.current && alive.current) callbacks.current.onLocation?.(sourceBook.current, locationRef.current)
  }, [active])
  useEffect(() => { alive.current = true; return () => { alive.current = false } }, [])
  useEffect(() => {
    let current = true
    const pending = noteFlights.get(flightKey)
    if (pending) { busy.current = true; setSaving(true); void finishNote(pending, () => current && alive.current) }
    return () => { current = false }
    // A keyed pane can reattach to a local write that outlived the old overlay.
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [])

  useEffect(() => {
    let current = true
    const controller = new AbortController()
    setLoad({})
    void Promise.resolve().then(() => loader.current(book, controller.signal)).then(bytes => {
      if (!bytes.byteLength) throw new Error(text('Tệp sách không có nội dung.', 'The book file is empty.'))
      if (current && !controller.signal.aborted) setLoad({ bytes })
    }).catch(error => { if (current && !controller.signal.aborted) setLoad({ error: readableError(error, lang) }) })
    return () => { current = false; controller.abort() }
    // Identity is keyed by the parent; callback and language changes do not reload bytes.
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [retry])

  const reportLocation = useCallback((next: ReaderLocation) => {
    if (!alive.current) return
    locationRef.current = next; setLocation(next)
    if (activeRef.current) callbacks.current.onLocation?.(book, next)
  }, [book])
  const receiveControls = useCallback((next: Controls | null) => { controls.current = next }, [])
  const receiveSearch = useCallback((next: ReaderSearchSource | null) => { setSource(() => next) }, [])
  const openSearch = useCallback(() => { setPanel('search'); setTocOpen(false); setSettings(false) }, [])
  const panelRef = useRef(panel)
  panelRef.current = panel
  const closeTool = useCallback(() => {
    const button = panelRef.current === 'search' ? searchButton : noteButton
    setPanel(null); setActiveHit(null)
    requestAnimationFrame(() => button.current?.focus({ preventScroll: true }))
  }, [])
  useEffect(() => { onPanelState(index, ready ? panel : null) }, [index, ready, panel, onPanelState])
  useEffect(() => {
    const root = host.current
    if (!root || !load.bytes) return
    const documents = new Set<Document>()
    const frames = new Map<HTMLIFrameElement, () => void>()
    function bridge(event: KeyboardEvent) {
      if (!activeRef.current || event.defaultPrevented || !['Escape', 'PageUp', 'PageDown', 'ArrowLeft', 'ArrowRight'].includes(event.key)) return
      const target = event.target && typeof (event.target as Element).closest === 'function' ? event.target as Element : null
      if (event.key !== 'Escape' && target?.closest('input, textarea, select, button, [contenteditable=true]')) return
      const forwarded = new KeyboardEvent('keydown', { key: event.key, ctrlKey: event.ctrlKey, metaKey: event.metaKey, altKey: event.altKey, shiftKey: event.shiftKey, cancelable: true, bubbles: true })
      document.dispatchEvent(forwarded)
      if (forwarded.defaultPrevented) { event.preventDefault(); event.stopImmediatePropagation() }
    }
    function scan() {
      for (const frame of root!.querySelectorAll('iframe')) {
        if (!frames.has(frame)) {
          const bind = () => { try { const doc = frame.contentDocument; if (doc && !documents.has(doc)) { documents.add(doc); doc.addEventListener('keydown', bridge, true) } } catch { /* cross-origin frames remain controlled by visible buttons */ } }
          frames.set(frame, bind); frame.addEventListener('load', bind); bind()
        } else frames.get(frame)?.()
      }
    }
    const observer = new MutationObserver(scan)
    observer.observe(root, { childList: true, subtree: true })
    scan()
    return () => { observer.disconnect(); for (const [frame, bind] of frames) frame.removeEventListener('load', bind); for (const doc of documents) doc.removeEventListener('keydown', bridge, true) }
  }, [load.bytes])
  const move = useCallback((direction: number) => {
    if (controls.current) { if (direction < 0) controls.current.previous(); else controls.current.next(); return }
    const scroll = host.current?.querySelector<HTMLElement>('.text-host, .pdf-host, .archive-host, .epub-container')
    if (scroll) scroll.scrollBy({ top: direction * Math.max(120, scroll.clientHeight * .85), behavior: 'smooth' })
  }, [])
  useEffect(() => {
    register({ page: move, search: openSearch, closeTool, dismiss: () => {
      if (tocOpen) { setTocOpen(false); return true }
      if (settings) { setSettings(false); return true }
      if (panel) { closeTool(); return true }
      return false
    } })
    return () => register(null)
  }, [register, move, openSearch, closeTool, panel, tocOpen, settings])

  function changeDraft(changes: Partial<ReaderNoteDraft>) {
    if (!alive.current || busy.current) return
    const next = { ...draftRef.current, ...changes }
    draftRef.current = next; setDraft(next)
    if (!writeReaderNoteDraft(draftProfile, book.id, next)) setNotice(text('Chưa giữ được bản nháp. Hãy lưu ghi chú trước khi đóng trang.', 'The draft could not be retained. Save your note before closing this page.'))
  }
  function selectPassage(value: string, locator: string) {
    if (!alive.current || busy.current) return
    onActivate()
    changeDraft({ selection: { text: value, locator }, anchor: { locatorJson: locator, chapterTitle: locationRef.current?.chapterTitle || '', progression: locationRef.current?.progression || 0 } })
    setPanel('notes'); setActiveHit(null); setTocOpen(false); setSettings(false)
  }
  function changeNote(note: string) {
    const previous = draftRef.current
    const anchor = !previous.note && !hasDrawing(previous.drawing) && note && !previous.selection ? locationRef.current : previous.anchor
    changeDraft({ note, anchor })
  }
  function changeDrawing(drawing: Drawing | null) {
    const previous = draftRef.current
    const anchor = !previous.note && !hasDrawing(previous.drawing) && hasDrawing(drawing) && !previous.selection ? locationRef.current : previous.anchor
    changeDraft({ drawing, anchor })
  }
  function navigateTo(locatorJson: string) { setTarget(null); setNavigate({ locatorJson, requestId: ++requestId.current }) }

  async function finishNote(flight: NoteFlight, isCurrent = () => alive.current) {
    try {
      const record = await flight.promise
      if (!isCurrent()) return
      if (JSON.stringify(draftRef.current) === JSON.stringify(flight.snapshot)) { draftRef.current = emptyReaderNoteDraft(); setDraft(draftRef.current) }
      setNotice(text('Đã lưu ghi chú.', 'Note saved.'))
      await callbacks.current.onCommitted(record)
    } catch (error) { if (isCurrent()) setNotice(readableError(error, lang)) }
    finally { if (isCurrent()) { busy.current = false; setSaving(false) } }
  }

  async function saveNote() {
    const snapshot = draftRef.current
    const anchor = snapshot.selection ? { locatorJson: snapshot.selection.locator, chapterTitle: '', progression: 0 } : snapshot.anchor || locationRef.current
    if (!alive.current || busy.current || noteFlights.has(flightKey) || !anchor || (!snapshot.note.trim() && !snapshot.selection?.text && !hasDrawing(snapshot.drawing))) return
    busy.current = true; setSaving(true); setNotice('')
    const promise = Promise.resolve().then(async (): Promise<SyncRecord> => {
      const drawing = snapshot.drawing === null ? null : parseDrawing(snapshot.drawing)
      if (snapshot.drawing !== null && !drawing) throw new Error(text('Bản vẽ không hợp lệ. Vui lòng vẽ lại.', 'The drawing is invalid. Please draw it again.'))
      const id = crypto.randomUUID(), now = Date.now()
      const payload = { id, book_id: book.id, locator_json: anchor.locatorJson, text: snapshot.selection?.text || anchor.chapterTitle || text('Ghi chú tại vị trí đọc', 'Note at reading position'), color: snapshot.color, note: snapshot.note.trim().slice(0, 10000), ...(drawing && hasDrawing(drawing) ? { drawing } : {}), created_at: now, updated_at: now }
      if (JSON.stringify(payload).length > 32768) throw new Error(text('Ghi chú và bản vẽ quá lớn. Hãy rút ngắn ghi chú hoặc giảm nét vẽ.', 'The note and drawing are too large. Shorten the note or reduce the drawing.'))
      const recordId = androidRecordId('highlights', id)
      await mutate(profile, 'highlights', recordId, payload, false, book.source === 'local')
      clearReaderNoteDraft(draftProfile, book.id, snapshot)
      return { key: keyFor(profile, `highlights:${recordId}`), profile, kind: 'highlights', id: recordId, version: 0, deleted: false, payload }
    })
    const flight = { snapshot, promise }
    noteFlights.set(flightKey, flight)
    const clear = () => { if (noteFlights.get(flightKey) === flight) noteFlights.delete(flightKey) }
    void promise.then(clear, clear)
    await finishNote(flight)
  }

  async function changeAnnotation(record: SyncRecord, changes?: AnnotationChanges) {
    if (!alive.current || record.profile !== profile || record.payload.book_id !== book.id) return
    try {
      if (changes) await updateAnnotation(profile, record, changes, book.source === 'local')
      else await deleteAnnotation(profile, record, book.source === 'local')
    } catch (error) { throw new Error(readableError(error, lang)) }
    if (!alive.current) return
    const payload = changes ? { ...record.payload, note: changes.note.trim(), color: changes.color, updated_at: Date.now(), ...(changes.drawing !== undefined ? { drawing: changes.drawing } : {}) } : record.payload
    await callbacks.current.onCommitted({ ...record, deleted: !changes, payload })
  }

  async function toggleBookmark() {
    const position = locationRef.current
    if (!alive.current || !position || bookmarkBusy.current) return
    const bookmarkKey = JSON.stringify([profile, book.id, position.locatorJson])
    if (bookmarkFlights.has(bookmarkKey)) return
    bookmarkBusy.current = true; bookmarkFlights.add(bookmarkKey); setBookmarkSaving(true)
    let changed: SyncRecord[] = []
    let removing = false
    try {
      const id = crypto.randomUUID(), recordId = androidRecordId('bookmarks', id), now = Date.now()
      await applyLocalMutations(profile, current => {
        if (!alive.current) return []
        const matching = current.filter(record => record.profile === profile && record.kind === 'bookmarks' && !record.deleted && record.payload.book_id === book.id && record.payload.locator_json === position.locatorJson)
        removing = matching.length > 0
        changed = removing ? matching.map(record => ({ ...record, deleted: true })) : [{ key: keyFor(profile, `bookmarks:${recordId}`), profile, kind: 'bookmarks', id: recordId, version: 0, deleted: false, payload: { id, book_id: book.id, locator_json: position.locatorJson, chapter_title: position.chapterTitle || '', snippet: null, created_at: now, sync_version: 1, is_deleted: 0 } }]
        return changed.map(record => ({ kind: record.kind, id: record.id, payload: record.payload, deleted: record.deleted, localOnly: book.source === 'local' }))
      })
      if (!alive.current) return
      setNotice(removing ? text('Đã bỏ dấu trang tại vị trí này.', 'Bookmark removed from this position.') : text('Đã thêm dấu trang.', 'Bookmark added.'))
      for (const record of changed) { if (!alive.current) break; await callbacks.current.onCommitted(record) }
    } catch (error) { if (alive.current) setNotice(readableError(error, lang)) }
    finally { bookmarkBusy.current = false; bookmarkFlights.delete(bookmarkKey); if (alive.current) setBookmarkSaving(false) }
  }

  const notes = records.filter(record => record.profile === profile && record.kind === 'highlights' && !record.deleted && record.payload.book_id === book.id)
  const annotations: ReaderAnnotation[] = notes.map(record => ({ id: annotationId(record), locatorJson: String(record.payload.locator_json || ''), text: String(record.payload.text || ''), color: String(record.payload.color || 'YELLOW') }))
  if (activeHit) annotations.push({ id: `comparison-search-${index}`, locatorJson: activeHit.locatorJson, text: activeHit.text, color: 'BLUE' })
  const bookmarked = Boolean(location && records.some(record => record.profile === profile && record.kind === 'bookmarks' && !record.deleted && record.payload.book_id === book.id && record.payload.locator_json === location.locatorJson))

  // Toolbar actions activate on click. Activating on pointerdown/focus first
  // would make a previously hidden tool toggle closed on that same click.
  function activateContent(event: { target: EventTarget | null }) {
    if (!(event.target instanceof Element) || !event.target.closest('.comparison-toolbar')) onActivate()
  }

  return <section className={`comparison-source reader-shell ${comfort.theme}${active ? ' is-active' : ''}`} aria-label={text(`Nguồn ${index + 1}: ${book.title}`, `Source ${index + 1}: ${book.title}`)} onPointerDownCapture={activateContent} onFocusCapture={activateContent}>
    <header className="comparison-source-heading"><div><span>{text('NGUỒN', 'SOURCE')} {String(index + 1).padStart(2, '0')}</span><h2 title={book.title}>{book.title}</h2><p>{book.author}</p></div><button type="button" className="comparison-active-label" aria-pressed={active} onClick={onActivate}>{active ? text('Đang đọc', 'Active') : text('Chọn nguồn', 'Activate')}</button></header>
    <div className="comparison-toolbar" role="toolbar" aria-label={text(`Công cụ nguồn ${index + 1}`, `Source ${index + 1} tools`)}>
      <button type="button" disabled={!ready} aria-expanded={tocOpen} onClick={() => { onActivate(); setTocOpen(value => !value); setSettings(false) }}><List size={15} />{text('Mục lục', 'Contents')}</button>
      <button ref={searchButton} type="button" disabled={!ready} aria-expanded={active && panel === 'search'} aria-controls={`${prefix}-search-panel`} onClick={() => { onActivate(); setPanel(panel === 'search' && active ? null : 'search'); setTocOpen(false); setSettings(false) }}><Search size={15} />{text('Tìm', 'Search')}</button>
      <button ref={noteButton} type="button" disabled={!ready} aria-expanded={active && panel === 'notes'} aria-controls={`${prefix}-notes-panel`} onClick={() => { onActivate(); setPanel(panel === 'notes' && active ? null : 'notes'); setTocOpen(false); setSettings(false) }}><FilePenLine size={15} />{text('Ghi chú', 'Notes')}</button>
      <button type="button" disabled={!ready || !location || bookmarkSaving} aria-pressed={bookmarked} aria-busy={bookmarkSaving} aria-label={bookmarked ? text('Bỏ dấu trang', 'Remove bookmark') : text('Đánh dấu vị trí', 'Bookmark position')} onClick={() => { onActivate(); void toggleBookmark() }}><Bookmark size={15} fill={bookmarked ? 'currentColor' : 'none'} />{text('Dấu trang', 'Bookmark')}</button>
      <button type="button" aria-expanded={settings} onClick={() => { onActivate(); setSettings(value => !value); setTocOpen(false) }}><Settings2 size={15} />{text('Giao diện', 'Appearance')}</button>
    </div>
    {settings && <div className="comparison-comfort"><label>{text('Cỡ chữ', 'Text size')}<select value={comfort.fontSize} onChange={event => setComfort(value => ({ ...value, fontSize: Number(event.target.value) }))}>{[...new Set([80, 90, 100, 110, 120, 140, 160, 170, 180, 200, comfort.fontSize])].sort((a, b) => a - b).map(size => <option key={size} value={size}>{size}%</option>)}</select></label><label>{text('Kiểu chữ', 'Typeface')}<select value={comfort.fontFamily} onChange={event => setComfort(value => ({ ...value, fontFamily: event.target.value as FontFamily }))}><option value="serif">Literata</option><option value="sans">Atkinson</option><option value="mono">{text('Đơn cách', 'Monospace')}</option></select></label><label>{text('Màu nền', 'Theme')}<select value={comfort.theme} onChange={event => setComfort(value => ({ ...value, theme: event.target.value as Comfort['theme'] }))}><option value="paper">{text('Giấy sáng', 'Paper')}</option><option value="sepia">{text('Vàng dịu', 'Sepia')}</option><option value="night">{text('Ban đêm', 'Night')}</option></select></label></div>}
    {notice && <div className="comparison-notice" role="status"><span>{notice}</span><button type="button" aria-label={text('Đóng thông báo', 'Dismiss message')} onClick={() => setNotice('')}><X size={14} /></button></div>}
    <div className="comparison-document" ref={host}>
      {!ready && !load.error && <div className="comparison-loading" role="status">{text('Đang mở tài liệu…', 'Opening document…')}</div>}
      {load.error && <div className="comparison-load-error" role="alert"><p>{load.error}</p><button type="button" onClick={() => setRetry(value => value + 1)}><RefreshCw size={15} />{text('Thử lại', 'Try again')}</button></div>}
      {load.bytes && <ReaderErrorBoundary key={retry} lang={lang} onClose={() => setRetry(value => value + 1)}><div className="reader-body"><ReaderPane lang={lang} book={book} bytes={load.bytes} initial={initialLocator} fontSize={comfort.fontSize} fontFamily={comfort.fontFamily} lineHeight={comfort.lineHeight} textAlignment={comfort.textAlignment} readerWidth={comfort.readerWidth} theme={comfort.theme} keyboardActive={active} onLocation={reportLocation} onSelection={selectPassage} onControls={receiveControls} onToc={setToc} navigateTarget={target} navigateLocator={navigate} annotations={annotations} onSearchReady={receiveSearch} onSearchRequest={openSearch} /></div></ReaderErrorBoundary>}
      {tocOpen && <nav className="comparison-contents" aria-label={text('Mục lục của nguồn', 'Source table of contents')}><div><h3>{text('Mục lục', 'Contents')}</h3><button type="button" aria-label={text('Đóng mục lục', 'Close contents')} onClick={() => setTocOpen(false)}><X size={17} /></button></div>{toc.length ? <Contents items={toc} onNavigate={href => { setNavigate(null); setTarget(null); requestAnimationFrame(() => { if (alive.current) setTarget(href) }); setTocOpen(false) }} /> : <p>{text('Tài liệu này không có mục lục.', 'This document has no table of contents.')}</p>}</nav>}
      {!active && ready && <button type="button" className="comparison-activate-surface" onClick={onActivate} aria-label={text(`Đọc nguồn ${index + 1}`, `Read source ${index + 1}`)}><span>{text('Nhấn để thao tác với nguồn này', 'Click to interact with this source')}</span></button>}
    </div>
    {ready && <div className="comparison-pagination"><button type="button" onClick={() => move(-1)} aria-label={text('Trang trước', 'Previous page')}><ChevronLeft size={17} />{text('Trước', 'Previous')}</button><span>{Math.round((location?.progression || 0) * 100)}%{location?.chapterTitle ? ` · ${location.chapterTitle}` : ''}</span><button type="button" onClick={() => move(1)} aria-label={text('Trang sau', 'Next page')}>{text('Sau', 'Next')}<ChevronRight size={17} /></button></div>}
    {toolsHost && createPortal(<div className={`comparison-tools-source reader-shell ${comfort.theme}`} data-source-index={index} hidden={!active || !ready || !panel}>
      <ReaderNotesPanel idPrefix={prefix} open={active && ready && panel === 'notes'} lang={lang} bookTitle={book.title} records={notes} note={draft.note} color={draft.color} quote={draft.selection?.text || ''} drawing={draft.drawing} saving={saving} canSave={Boolean(draft.selection || draft.anchor || location) && Boolean(draft.note.trim() || draft.selection?.text || hasDrawing(draft.drawing))} onNoteChange={changeNote} onDrawingChange={changeDrawing} onColorChange={color => changeDraft({ color })} onClearQuote={() => changeDraft({ selection: null, anchor: locationRef.current })} onSave={() => { void saveNote() }} onNavigate={record => navigateTo(String(record.payload.locator_json || ''))} onUpdate={(record, changes) => changeAnnotation(record, changes)} onDelete={record => changeAnnotation(record)} onClose={closeTool} />
      <ReaderSearchPanel idPrefix={prefix} open={ready && panel === 'search' && active} lang={lang} bookTitle={book.title} source={source} format={load.bytes ? detectReaderFormat(book, load.bytes) : 'text'} activeId={activeHit?.id} onNavigate={hit => { setActiveHit(hit); navigateTo(hit.locatorJson) }} onClearActive={() => setActiveHit(null)} onClose={closeTool} />
    </div>, toolsHost)}
  </section>
}

function ComparisonSession(props: ComparisonReaderProps) {
  const { profile, lang, books, initialLocators, records, onChanged, onClose } = props
  const vi = lang === 'vi'
  const [active, setActive] = useState(0)
  const [toolsHost, setToolsHost] = useState<HTMLDivElement | null>(null)
  const [panels, setPanels] = useState<ToolPanel[]>([null, null])
  const panelState = useCallback((index: number, panel: ToolPanel) => setPanels(previous => previous[index] === panel ? previous : previous.map((value, i) => i === index ? panel : value)), [])
  const [optimistic, setOptimistic] = useState<SyncRecord[]>([])
  const [notice, setNotice] = useState('')
  const scope = useRef(true)
  const root = useRef<HTMLDivElement>(null)
  const closeButton = useRef<HTMLButtonElement>(null)
  const actions = useRef<Array<Actions | null>>([null, null])
  const current = useRef({ active, onClose, onChanged })
  useEffect(() => { current.current = { active, onClose, onChanged } }, [active, onClose, onChanged])
  const registerFirst = useCallback((value: Actions | null) => { actions.current[0] = value }, [])
  const registerSecond = useCallback((value: Actions | null) => { actions.current[1] = value }, [])
  const merged = useMemo(() => {
    const map = new Map(records.filter(record => record.profile === profile).map(record => [record.key, record]))
    for (const record of optimistic) map.set(record.key, record)
    return [...map.values()]
  }, [records, optimistic, profile])
  const committed = useCallback(async (record: SyncRecord) => {
    if (!scope.current || record.profile !== profile) return
    setOptimistic(currentRecords => [...currentRecords.filter(item => item.key !== record.key), record])
    try {
      await current.current.onChanged()
      if (scope.current) setOptimistic(currentRecords => currentRecords.filter(item => item !== record))
    } catch {
      if (scope.current) setNotice(lang === 'vi' ? 'Đã lưu thay đổi trên trình duyệt; chưa làm mới được danh sách. Bạn không cần lưu lại.' : 'Changes are saved in this browser; the list could not refresh. You do not need to save again.')
    }
  }, [profile, lang])

  useEffect(() => {
    scope.current = true
    const previous = document.activeElement as HTMLElement | null
    const previousOverflow = document.body.style.overflow
    const previousRootOverflow = document.documentElement.style.overflow
    document.body.style.overflow = 'hidden'
    document.documentElement.style.overflow = 'hidden'
    closeButton.current?.focus()
    function keydown(event: KeyboardEvent) {
      if (event.defaultPrevented) return
      const action = actions.current[current.current.active]
      if (event.key === 'Escape') { event.preventDefault(); event.stopImmediatePropagation(); if (!action?.dismiss()) current.current.onClose(); return }
      if ((event.ctrlKey || event.metaKey) && !event.altKey && event.key.toLowerCase() === 'f') { event.preventDefault(); event.stopImmediatePropagation(); action?.search(); return }
      const target = event.target instanceof Element ? event.target : null
      if (!event.altKey && !event.ctrlKey && !event.metaKey && !target?.closest('input, textarea, select, button, [contenteditable=true]') && ['ArrowLeft', 'ArrowRight', 'PageUp', 'PageDown'].includes(event.key)) { event.preventDefault(); event.stopImmediatePropagation(); action?.page(event.key === 'ArrowLeft' || event.key === 'PageUp' ? -1 : 1); return }
      if (event.key === 'Tab') {
        const nodes = [...root.current?.querySelectorAll<HTMLElement>('button:not(:disabled), input:not(:disabled), select:not(:disabled), textarea:not(:disabled), [tabindex="0"]') || []].filter(node => !node.closest('[hidden]') && getComputedStyle(node).visibility !== 'hidden' && node.getClientRects().length > 0)
        const first = nodes[0], last = nodes.at(-1)
        if (event.shiftKey && document.activeElement === first && last) { event.preventDefault(); last.focus() }
        else if (!event.shiftKey && document.activeElement === last && first) { event.preventDefault(); first.focus() }
      }
    }
    document.addEventListener('keydown', keydown, true)
    return () => { scope.current = false; document.removeEventListener('keydown', keydown, true); document.body.style.overflow = previousOverflow; document.documentElement.style.overflow = previousRootOverflow; previous?.focus() }
  }, [])

  return <div ref={root} className="comparison-reader" role="dialog" aria-modal="true" aria-labelledby="comparison-reader-title">
    <header className="comparison-heading"><div><span><BookOpen size={16} />{vi ? 'KHÔNG GIAN NGHIÊN CỨU' : 'RESEARCH WORKSPACE'}</span><h1 id="comparison-reader-title">{vi ? 'Đọc đối chiếu hai nguồn' : 'Compare two sources'}</h1></div><button ref={closeButton} type="button" onClick={onClose} aria-label={vi ? 'Đóng đọc đối chiếu' : 'Close comparison'}><X size={20} /><span>{vi ? 'Đóng' : 'Close'}</span></button></header>
    <div className="comparison-source-tabs" role="group" aria-label={vi ? 'Nguồn đang thao tác' : 'Active source'}>{books.map((book, index) => <button key={index} type="button" aria-pressed={active === index} onClick={() => setActive(index)}><span>{String(index + 1).padStart(2, '0')}</span>{book.title}</button>)}</div>
    {notice && <p className="comparison-shared-notice" role="status">{notice}</p>}
    <div className={`comparison-workspace${panels[active] ? ' has-tool-panel' : ''}`}>
      <div className="comparison-columns">{books.map((book, index) => <ComparisonPane key={index} {...props} book={book} initial={initialLocators[index]} index={index} records={merged} active={active === index} onActivate={() => setActive(index)} register={index === 0 ? registerFirst : registerSecond} onCommitted={committed} toolsHost={toolsHost} onPanelState={panelState} />)}</div>
      <div ref={setToolsHost} className="comparison-tools-host" hidden={!panels[active]}>
        <button type="button" className="comparison-tools-return" onClick={() => actions.current[active]?.closeTool()}><ChevronLeft size={17} />{vi ? 'Quay lại đọc hai nguồn' : 'Back to reading sources'}</button>
      </div>
    </div>
    <footer className="comparison-help">{vi ? 'Mỗi nguồn giữ vị trí riêng · Ctrl/Cmd + F: tìm trong nguồn đang chọn · Esc: đóng bảng hoặc trở về' : 'Independent reading positions · Ctrl/Cmd + F: search active source · Esc: close a panel or return'}</footer>
  </div>
}

/** A profile/source change retires every pending load and callback from the old workspace. */
export function ComparisonReader(props: ComparisonReaderProps) {
  const identity = JSON.stringify([props.profile, props.books.map(book => [book.id, book.fileUrl, book.source])])
  return <ComparisonSession key={identity} {...props} />
}

export default ComparisonReader
