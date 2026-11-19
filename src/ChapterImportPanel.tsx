import { useEffect, useRef, useState } from 'react'
import { ArrowLeft, Check, ChevronLeft, ChevronRight, Download, Pause, Play, RotateCcw, Trash2 } from 'lucide-react'
import type { Lang } from './i18n'
import { MAX_BATCH_CHAPTERS, MAX_BATCH_HTML_BYTES, type ChapterCatalog } from '../shared/chapterImport'
import { discoverChapters } from './chapterDiscovery'
import { buildChapterEpub, createChapterBatch, discardChapterBatch, loadChapterBatch, runChapterBatch, type ChapterBatchDraft } from './chapterBatch'
import { HttpsImportError } from '../shared/httpsPublication'
import { httpsImportMessage } from './httpsImport'
import { previewChapterContents, type ChapterContentPreview } from './chapterContentPreview'
import { contentLanguage } from './typography'
import './ChapterImportPanel.css'

type Phase = 'loading' | 'idle' | 'discover' | 'prepare' | 'download' | 'build' | 'save'
type Confirmation = 'partial' | 'replace' | 'discard' | null
type SelectionMode = 'number' | 'position'
const PREVIEW_PAGE_SIZE = 15

function copyDraft(draft: ChapterBatchDraft): ChapterBatchDraft {
  return { ...draft, chapters: draft.chapters.map(chapter => ({ ...chapter })) }
}

function chapterNumberBounds(catalog: ChapterCatalog): { min: number; max: number } | null {
  const numbers = catalog.chapters.map(chapter => chapter.number)
  if (!numbers.length || !numbers.every((number): number is number => typeof number === 'number' && Number.isSafeInteger(number)) || new Set(numbers).size !== numbers.length) return null
  return { min: Math.min(...numbers), max: Math.max(...numbers) }
}

function initialNumberEnd(bounds: { min: number; max: number }): number {
  return Math.min(bounds.max, bounds.min > 200 ? bounds.min + 199 : 200)
}

function SourceCheck({ catalog, lang }: { catalog: ChapterCatalog; lang: Lang }) {
  const vi = lang === 'vi'
  const diagnostics = catalog.diagnostics
  const expected = diagnostics?.expectedChapters
  const mismatch = expected !== undefined && expected !== catalog.chapters.length
  const partial = catalog.truncated || diagnostics?.completeness === 'partial' || mismatch
  const verified = !partial && diagnostics?.completeness === 'verified' && expected !== undefined
  const warnings = diagnostics?.warnings || []
  const warningCopy = {
    'page-limit': vi ? 'Đã chạm giới hạn số trang mục lục trong một lần kiểm tra.' : 'The scan reached its contents-page limit.',
    'chapter-limit': vi ? 'Đã chạm giới hạn số chương nhận diện trong một lần kiểm tra.' : 'The scan reached its chapter-count limit.',
    'size-limit': vi ? 'Mục lục vượt giới hạn dung lượng đọc trong một lần kiểm tra.' : 'The contents list exceeded the scan size limit.',
    'page-failed': vi ? 'Một số trang mục lục chưa tải được.' : 'Some contents pages could not be loaded.',
    'dynamic-pagination': vi ? 'Cách chuyển trang của nguồn chưa được hỗ trợ đầy đủ.' : 'The source’s page controls are not fully supported.',
    'catalog-changed': vi ? 'Dữ liệu mục lục thay đổi hoặc không nhất quán trong lúc kiểm tra.' : 'The contents data changed or was inconsistent during the scan.',
  }
  return <section className={`chapter-source-check${partial ? ' is-partial' : ''}`} aria-labelledby="chapter-source-check-heading">
    <h4 id="chapter-source-check-heading">{vi ? 'Kiểm tra nguồn' : 'Source check'}</h4>
    <p className="chapter-source-result" role="status">{partial ? (vi ? 'Danh sách chưa đầy đủ' : 'Partial chapter list') : verified ? (vi ? 'Đã đối chiếu đủ với nguồn' : 'Matches the source chapter count') : (vi ? 'Đã nhận diện mục lục' : 'Contents recognized')}</p>
    <dl><div><dt>{vi ? 'Chương nhận được' : 'Chapters received'}</dt><dd>{catalog.chapters.length}{expected !== undefined ? ` / ${expected}` : ''}</dd></div><div><dt>{vi ? 'Trang đã đọc' : 'Pages read'}</dt><dd>{catalog.pages.length}</dd></div></dl>
    {!verified && !partial && <p>{vi ? 'Đã quét các trang mục lục nhận diện được. Chưa xác minh được tổng số chương của nguồn.' : 'All identified contents pages were scanned. The source’s total chapter count could not be verified.'}</p>}
    {partial && <p>{vi ? 'Danh sách có thể chưa đầy đủ. Chỉ những chương được liệt kê bên dưới có thể được chọn trong đợt này.' : 'Only the listed chapters can be selected; this list may be incomplete.'}</p>}
    {warnings.map((warning, index) => <p className="chapter-source-warning" key={`${warning.code}-${index}`}>{warningCopy[warning.code]}{warning.errorCode ? ` ${httpsImportMessage(new HttpsImportError(warning.errorCode), lang)}` : ''}</p>)}
  </section>
}

export function ChapterImportPanel({ lang, profile, onImport, onClose, onBack, onBusyChange, onDestinationLockChange, saveError }: {
  lang: Lang; profile: string; onImport: (file: File, sourceUrl: string) => Promise<boolean>
  onClose: () => void; onBack: () => void; onBusyChange?: (saving: boolean) => void
  onDestinationLockChange?: (locked: boolean) => void; saveError?: string
}) {
  const vi = lang === 'vi'
  const [phase, setPhase] = useState<Phase>('loading')
  const [url, setUrl] = useState('')
  const [title, setTitle] = useState('')
  const [catalog, setCatalog] = useState<ChapterCatalog | null>(null)
  const [discoveryProgress, setDiscoveryProgress] = useState({ pages: 0, chapters: 0 })
  const [start, setStart] = useState('1')
  const [end, setEnd] = useState('200')
  const [selectionMode, setSelectionMode] = useState<SelectionMode>('position')
  const [previewPage, setPreviewPage] = useState(0)
  const [draft, setDraft] = useState<ChapterBatchDraft | null>(null)
  const [savedDraft, setSavedDraft] = useState<ChapterBatchDraft | null>(null)
  const [confirmation, setConfirmation] = useState<Confirmation>(null)
  const [error, setError] = useState('')
  const [contentSamples, setContentSamples] = useState<ChapterContentPreview[]>([])
  const [sampleLoading, setSampleLoading] = useState(false)
  const [sampleError, setSampleError] = useState('')
  const active = useRef<AbortController | null>(null)
  const sampleActive = useRef<AbortController | null>(null)
  const sampleKey = useRef('')
  const mounted = useRef(true)
  const resultHeading = useRef<HTMLHeadingElement>(null)
  const busyCallback = useRef(onBusyChange)
  busyCallback.current = onBusyChange
  const destinationLockCallback = useRef(onDestinationLockChange)
  destinationLockCallback.current = onDestinationLockChange

  useEffect(() => {
    mounted.current = true
    active.current = null
    sampleActive.current?.abort(); sampleActive.current = null
    setContentSamples([]); setSampleLoading(false); setSampleError('')
    setPhase('loading'); setDraft(null); setSavedDraft(null); setCatalog(null); setConfirmation(null); setError('')
    let current = true
    void loadChapterBatch(profile).then(value => {
      if (current) setSavedDraft(value)
    }).catch(() => {
      if (current) setError(vi ? 'Không đọc được tiến độ đã lưu trong trình duyệt. Hãy kiểm tra bộ nhớ rồi thử lại.' : 'Could not load saved progress. Check browser storage and try again.')
    }).finally(() => { if (current) setPhase('idle') })
    return () => { current = false; mounted.current = false; active.current?.abort(); active.current = null; sampleActive.current?.abort(); sampleActive.current = null; busyCallback.current?.(false); destinationLockCallback.current?.(false) }
  // Language changes should not restart a running download or reload its draft.
  // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [profile])
  useEffect(() => { if (catalog) resultHeading.current?.focus() }, [catalog])

  const idle = phase === 'idle'
  const loading = phase === 'loading'
  const saving = phase === 'save'
  const busy = !idle && !loading
  useEffect(() => { destinationLockCallback.current?.(busy) }, [busy])
  const from = Number(start), to = Number(end)
  const numberedBounds = catalog ? chapterNumberBounds(catalog) : null
  const byNumber = selectionMode === 'number' && !!numberedBounds
  const lowerBound = byNumber ? numberedBounds!.min : 1
  const upperBound = byNumber ? numberedBounds!.max : catalog?.chapters.length || 0
  const validBounds = !!catalog && !!start.trim() && !!end.trim() && Number.isSafeInteger(from) && Number.isSafeInteger(to) && from >= lowerBound && to >= from && to <= upperBound
  const selected = validBounds ? byNumber ? catalog.chapters.filter(chapter => chapter.number! >= from && chapter.number! <= to) : catalog.chapters.slice(from - 1, to) : []
  const tooMany = selected.length > MAX_BATCH_CHAPTERS
  const missingNumbers = byNumber && validBounds ? Math.max(0, to - from + 1 - selected.length) : 0
  const validSelection = validBounds && !!selected.length && !tooMany && !!title.trim()
  const done = draft?.chapters.filter(chapter => chapter.status === 'done').length || 0
  const failed = draft?.chapters.filter(chapter => chapter.status === 'error').length || 0
  const pending = draft?.chapters.filter(chapter => chapter.status === 'pending').length || 0
  const preview = draft?.chapters || selected
  const pageCount = Math.max(1, Math.ceil(preview.length / PREVIEW_PAGE_SIZE))
  const currentPage = Math.min(previewPage, pageCount - 1)
  const previewItems = preview.slice(currentPage * PREVIEW_PAGE_SIZE, (currentPage + 1) * PREVIEW_PAGE_SIZE)
  const selectionKey = JSON.stringify([profile, url, catalog?.sourceUrl, start, end, selectionMode, draft?.id, selected.slice(0, 2).map(chapter => [chapter.url, chapter.title])])
  sampleKey.current = selectionKey

  const clearContentPreview = () => {
    sampleActive.current?.abort(); sampleActive.current = null
    setSampleLoading(false); setContentSamples([]); setSampleError('')
  }
  useEffect(() => {
    sampleActive.current?.abort(); sampleActive.current = null
    setSampleLoading(false); setContentSamples([]); setSampleError('')
    return () => { sampleActive.current?.abort(); sampleActive.current = null }
  }, [selectionKey])

  const loadContentPreview = async () => {
    if (!idle || !validBounds || !selected.length || sampleActive.current) return
    const controller = new AbortController(), key = sampleKey.current
    sampleActive.current = controller
    setSampleLoading(true); setContentSamples([]); setSampleError('')
    try {
      const samples = await previewChapterContents(selected.slice(0, 2), { signal: controller.signal })
      if (mounted.current && !controller.signal.aborted && sampleActive.current === controller && sampleKey.current === key) setContentSamples(samples)
    } catch (failure) {
      if (mounted.current && !controller.signal.aborted && sampleActive.current === controller && sampleKey.current === key) setSampleError(httpsImportMessage(failure, lang))
    } finally {
      if (sampleActive.current === controller) { sampleActive.current = null; if (mounted.current) setSampleLoading(false) }
    }
  }

  const findChapters = async () => {
    if (active.current || !url.trim()) return
    clearContentPreview()
    const controller = new AbortController()
    active.current = controller
    setError(''); setConfirmation(null); setCatalog(null); setPhase('discover')
    setDiscoveryProgress({ pages: 0, chapters: 0 })
    try {
      const found = await discoverChapters(url, { signal: controller.signal, onProgress: value => {
        if (mounted.current && !controller.signal.aborted) setDiscoveryProgress(value)
      } })
      controller.signal.throwIfAborted()
      if (!mounted.current || active.current !== controller) return
      const numberBounds = chapterNumberBounds(found)
      setCatalog(found); setTitle(found.title.slice(0, 160)); setSelectionMode(numberBounds ? 'number' : 'position')
      setStart(String(numberBounds?.min ?? 1)); setEnd(String(numberBounds ? initialNumberEnd(numberBounds) : Math.min(200, found.chapters.length))); setPreviewPage(0)
    } catch (failure) {
      if (mounted.current && !controller.signal.aborted) setError(httpsImportMessage(failure, lang))
    } finally {
      if (active.current === controller) { active.current = null; if (mounted.current) setPhase('idle') }
    }
  }

  const download = async (value: ChapterBatchDraft, retryFailed = false) => {
    if (active.current) return
    clearContentPreview()
    const controller = new AbortController()
    active.current = controller
    setError(''); setConfirmation(null); setPhase('download')
    try {
      const result = await runChapterBatch(value, { signal: controller.signal, retryFailed, onProgress: progress => {
        if (mounted.current && active.current === controller && !controller.signal.aborted) setDraft(copyDraft(progress))
      } })
      if (mounted.current && active.current === controller) setDraft(copyDraft(result))
    } catch (failure) {
      if (mounted.current && !controller.signal.aborted) setError(httpsImportMessage(failure, lang))
    } finally {
      if (active.current === controller) { active.current = null; if (mounted.current) setPhase('idle') }
    }
  }

  const beginBatch = async (replace = false) => {
    if (!validSelection || active.current) return
    clearContentPreview()
    if (savedDraft && !replace) { setConfirmation('replace'); return }
    const controller = new AbortController()
    active.current = controller
    setPhase('prepare'); setError(''); setConfirmation(null)
    try {
      controller.signal.throwIfAborted()
      // Creation replaces the previous draft and its chapters in one transaction.
      // Keep saved progress intact if validation or storage rejects this selection.
      const created = await createChapterBatch({ profile, title: title.trim(), sourceUrl: catalog!.sourceUrl, chapters: selected, expectedDraftId: savedDraft?.id ?? null })
      if (!mounted.current || controller.signal.aborted || active.current !== controller) return
      setDraft(copyDraft(created)); setSavedDraft(null); setPreviewPage(0)
      active.current = null
      await download(created)
    } catch (failure) {
      if (mounted.current && !controller.signal.aborted) setError(httpsImportMessage(failure, lang))
    } finally {
      if (active.current === controller) { active.current = null; if (mounted.current) setPhase('idle') }
    }
  }

  const saveBook = async (allowPartial = false) => {
    if (!draft || !done || active.current) return
    if ((pending || failed) && !allowPartial) { setConfirmation('partial'); return }
    const controller = new AbortController()
    active.current = controller
    setPhase('build'); setError(''); setConfirmation(null)
    try {
      const file = await buildChapterEpub(draft, { signal: controller.signal })
      controller.signal.throwIfAborted()
      if (!mounted.current || active.current !== controller) return
      setPhase('save'); busyCallback.current?.(true)
      if (!await onImport(file, draft.sourceUrl)) throw new HttpsImportError('SAVE_FAILED')
      // Import has succeeded. Cleanup must not turn it into a failed save and invite duplicates.
      try { await discardChapterBatch(profile, draft.id) } catch { /* the book is already in the library */ }
      if (mounted.current && active.current === controller) onClose()
    } catch (failure) {
      if (mounted.current && !controller.signal.aborted) setError(failure instanceof HttpsImportError && failure.code === 'SAVE_FAILED' ? 'SAVE_FAILED' : httpsImportMessage(failure, lang))
    } finally {
      if (active.current === controller) {
        busyCallback.current?.(false)
        active.current = null
        if (mounted.current) setPhase('idle')
      }
    }
  }

  const discard = async () => {
    const value = draft || savedDraft
    if (!value || active.current) return
    const controller = new AbortController()
    active.current = controller
    setPhase('prepare'); setConfirmation(null); setError('')
    try {
      await discardChapterBatch(profile, value.id)
      if (mounted.current && active.current === controller) { setDraft(null); setSavedDraft(null); setPreviewPage(0) }
    } catch (failure) { if (mounted.current && active.current === controller) setError(httpsImportMessage(failure, lang)) }
    finally { if (active.current === controller) { active.current = null; if (mounted.current) setPhase('idle') } }
  }

  return <div className="chapter-import-panel">
    <p className="chapter-import-intro">{vi ? 'Dán mục lục công khai, chọn khoảng chương bạn muốn đọc và gộp thành một cuốn EPUB có mục lục.' : 'Paste a public contents page, choose the chapters you want and combine them into one EPUB with a table of contents.'}</p>
    <p className="chapter-import-notice">{vi ? 'Giữ tab NoCap mở trong lúc tải. Tiến độ được lưu trên trình duyệt này để tiếp tục sau; đóng tab sẽ dừng tải.' : 'Keep this NoCap tab open while downloading. Progress is saved in this browser so you can resume later; closing the tab stops the download.'}</p>

    {loading && <p role="status">{vi ? 'Đang kiểm tra tiến độ đã lưu…' : 'Checking saved progress…'}</p>}
    {!draft && savedDraft && <section className="chapter-recovery" aria-label={vi ? 'Tiến độ đã lưu' : 'Saved progress'}>
      <strong>{vi ? 'Có một đợt tải chưa hoàn tất' : 'You have a saved download'}</strong>
      <p><span lang={contentLanguage(savedDraft.title, 'en')}>{savedDraft.title}</span> · {savedDraft.chapters.filter(chapter => chapter.status === 'done').length}/{savedDraft.chapters.length} {vi ? 'chương đã tải' : 'chapters downloaded'}</p>
      <div className="chapter-inline-actions"><button className="secondary" type="button" disabled={!idle} onClick={() => { setDraft(copyDraft(savedDraft)); setSavedDraft(null); setConfirmation(null); setPreviewPage(0); setError('') }}><Play size={15} />{vi ? 'Khôi phục đợt tải' : 'Restore download'}</button><button className="chapter-subtle-button" type="button" disabled={!idle} onClick={() => setConfirmation('discard')}><Trash2 size={15} />{vi ? 'Xóa tiến độ' : 'Discard progress'}</button></div>
    </section>}

    {!draft && <>
      <form className="chapter-discovery-form" onSubmit={event => { event.preventDefault(); void findChapters() }}>
        <label htmlFor="chapter-contents-url">{vi ? 'Liên kết mục lục truyện' : 'Story contents URL'}</label>
        <div className="chapter-discovery-row"><input id="chapter-contents-url" type="url" value={url} onChange={event => { setUrl(event.target.value); setCatalog(null); setConfirmation(null); setError('') }} placeholder="https://example.com/story/contents" maxLength={8192} autoComplete="off" autoCapitalize="none" spellCheck={false} disabled={!idle} required autoFocus aria-describedby="chapter-source-help" /><button type="submit" className="secondary" disabled={!idle || !url.trim()}>{vi ? 'Tìm chương' : 'Find chapters'}</button></div>
        <p id="chapter-source-help" className="import-help">{vi ? 'Dùng mục lục HTTPS công khai. Trang cần đăng nhập hoặc chỉ tải chương bằng JavaScript có thể chưa được hỗ trợ.' : 'Use a public HTTPS contents page. Pages that require sign-in or load chapters only with JavaScript may not be supported yet.'}</p>
      </form>
      {phase === 'discover' && <div className="chapter-discovery-status" role="status" aria-live="polite"><span>{vi ? `Đang đọc mục lục · ${discoveryProgress.pages} trang · ${discoveryProgress.chapters} chương` : `Reading contents · ${discoveryProgress.pages} pages · ${discoveryProgress.chapters} chapters`}</span><button type="button" className="chapter-subtle-button" onClick={() => active.current?.abort()}>{vi ? 'Hủy tìm' : 'Cancel search'}</button></div>}

      {catalog && <section className="chapter-selection" aria-labelledby="chapter-selection-heading">
        <h3 id="chapter-selection-heading" ref={resultHeading} tabIndex={-1}>{vi ? `Tìm thấy ${catalog.chapters.length} chương` : `${catalog.chapters.length} chapters found`}</h3>
        <p className="import-help">{vi ? `Đã đọc ${catalog.pages.length} trang mục lục. Hãy kiểm tra tên và thứ tự trước khi tải.` : `Read ${catalog.pages.length} contents pages. Check the titles and order before downloading.`}</p>
        <SourceCheck catalog={catalog} lang={lang} />
        <label htmlFor="chapter-book-title">{vi ? 'Tên sách trong thư viện' : 'Book title in your library'}</label>
        <input id="chapter-book-title" lang={contentLanguage(title, 'en')} value={title} maxLength={160} onChange={event => setTitle(event.target.value)} disabled={!idle} required />
        {numberedBounds && <div className="chapter-range-mode"><label htmlFor="chapter-selection-mode">{vi ? 'Chọn theo' : 'Select by'}</label><select id="chapter-selection-mode" value={selectionMode} disabled={!idle} onChange={event => {
          const mode = event.target.value as SelectionMode
          setSelectionMode(mode); setStart(String(mode === 'number' ? numberedBounds.min : 1)); setEnd(String(mode === 'number' ? initialNumberEnd(numberedBounds) : Math.min(200, catalog.chapters.length))); setPreviewPage(0); setConfirmation(null)
        }}><option value="number">{vi ? 'Số chương' : 'Chapter number'}</option><option value="position">{vi ? 'Vị trí mục lục' : 'Contents position'}</option></select></div>}
        <div className="chapter-range-fields"><div><label htmlFor="chapter-range-start">{byNumber ? (vi ? 'Từ chương' : 'From chapter') : (vi ? 'Từ vị trí' : 'From position')}</label><input id="chapter-range-start" type="number" min={lowerBound} max={upperBound} step={1} value={start} onChange={event => { setStart(event.target.value); setPreviewPage(0); setConfirmation(null) }} disabled={!idle} aria-describedby="chapter-range-help" /></div><div><label htmlFor="chapter-range-end">{byNumber ? (vi ? 'Đến chương' : 'To chapter') : (vi ? 'Đến vị trí' : 'To position')}</label><input id="chapter-range-end" type="number" min={lowerBound} max={upperBound} step={1} value={end} onChange={event => { setEnd(event.target.value); setPreviewPage(0); setConfirmation(null) }} disabled={!idle} aria-describedby="chapter-range-help" /></div><div className="chapter-range-count"><strong>{validBounds ? selected.length : '—'}</strong><span>{vi ? 'chương đã chọn' : 'chapters selected'}</span></div></div>
        <p id="chapter-range-help" className="import-help">{byNumber ? (vi ? 'Chọn theo số chương trên website. NoCap chỉ lấy những chương có trong khoảng này; số lượng thực tế có thể ít hơn nếu mục lục thiếu số chương.' : 'Choose chapter numbers from the website. NoCap includes only chapters found within this range; the actual count may be lower if numbers are missing.') : (vi ? 'Vị trí trong mục lục, không nhất thiết trùng số chương trên website (có thể có lời mở đầu hoặc ngoại truyện).' : 'Positions in the contents list may differ from chapter numbers on the website (for example, a prologue or bonus chapter).')} {vi ? `Tối đa ${MAX_BATCH_CHAPTERS} chương và ${MAX_BATCH_HTML_BYTES / 1024 / 1024} MB nội dung/đợt.` : `Up to ${MAX_BATCH_CHAPTERS} chapters and ${MAX_BATCH_HTML_BYTES / 1024 / 1024} MB of content per batch.`}</p>
        {!validBounds && <p role="alert" className="chapter-import-warning">{vi ? `Nhập khoảng ${byNumber ? 'số chương' : 'vị trí'} hợp lệ từ ${lowerBound} đến ${upperBound}; giá trị cuối phải lớn hơn hoặc bằng giá trị đầu.` : `Enter a valid range from ${lowerBound} to ${upperBound}; the last ${byNumber ? 'chapter number' : 'position'} must be at least the first.`}</p>}
        {validBounds && !selected.length && <p role="alert" className="chapter-import-warning">{vi ? 'Không có chương nào trong khoảng số này. Hãy chọn khoảng khác.' : 'No chapters were found in this number range. Choose another range.'}</p>}
        {tooMany && <p role="alert" className="chapter-import-warning">{vi ? `Bạn đã chọn ${selected.length} chương. Hãy chia thành các đợt tối đa ${MAX_BATCH_CHAPTERS} chương.` : `You selected ${selected.length} chapters. Split the selection into batches of up to ${MAX_BATCH_CHAPTERS}.`}</p>}
        {!!missingNumbers && !!selected.length && <p role="status" className="chapter-import-warning">{vi ? `Mục lục nguồn thiếu ${missingNumbers} số chương trong khoảng này. Đợt tải chỉ gồm ${selected.length} chương hiện có.` : `The source list is missing ${missingNumbers} chapter number${missingNumbers === 1 ? '' : 's'} in this range. Only the ${selected.length} existing chapters will be downloaded.`}</p>}
        {validBounds && !!selected.length && <div className="chapter-range-summary"><p><span>{vi ? 'Đầu khoảng' : 'First'}</span><strong lang={contentLanguage(selected[0].title, 'en')}>{selected[0].title}</strong></p><p><span>{vi ? 'Cuối khoảng' : 'Last'}</span><strong lang={contentLanguage(selected.at(-1)!.title, 'en')}>{selected.at(-1)!.title}</strong></p></div>}
        <section className="chapter-content-preview" aria-labelledby="chapter-content-preview-heading">
          <h4 id="chapter-content-preview-heading">{vi ? 'Xem thử trước khi tải' : 'Check content before downloading'}</h4>
          <p className="import-help">{vi ? 'Đọc thử đoạn đầu của tối đa 2 chương đầu trong khoảng đang chọn để kiểm tra đúng truyện và bản dịch. Bước này là tùy chọn, chưa lưu sách vào thư viện.' : 'Read an opening sample from up to the first 2 selected chapters to check the story and translation. This optional step does not add a book to your library.'}</p>
          <div className="chapter-inline-actions">
            <button type="button" className="secondary" disabled={!idle || !validBounds || !selected.length || sampleLoading} onClick={() => void loadContentPreview()}>{contentSamples.some(sample => sample.status === 'error') || sampleError ? (vi ? 'Thử lại xem nội dung' : 'Retry content preview') : (vi ? 'Xem thử nội dung' : 'Preview chapter content')}</button>
            {sampleLoading && <button type="button" className="chapter-subtle-button" onClick={clearContentPreview}>{vi ? 'Hủy xem thử' : 'Cancel preview'}</button>}
          </div>
          {sampleLoading && <p role="status">{vi ? 'Đang tải đoạn xem thử…' : 'Loading chapter samples…'}</p>}
          {sampleError && <p className="chapter-sample-error" role="alert">{sampleError}</p>}
          {!!contentSamples.length && <div className="chapter-content-samples" aria-live="polite">
            {contentSamples.map(sample => <article className="chapter-content-sample" key={sample.url}>
              <h5 lang={contentLanguage(sample.title, 'en')}>{sample.title}</h5>
              {sample.status === 'ready' ? <>
                {sample.sourceTitle && sample.sourceTitle !== sample.title && <p className="chapter-sample-source" lang={contentLanguage(sample.sourceTitle, 'en')}>{sample.sourceTitle}</p>}
                {typeof sample.characters === 'number' && <p className="chapter-sample-meta">{vi ? `Nhận được ${sample.characters.toLocaleString('vi-VN')} ký tự. Đây là đoạn đầu chương.` : `Received ${sample.characters.toLocaleString('en-US')} characters. This is the chapter opening.`}</p>}
                <p className="chapter-sample-excerpt" lang={contentLanguage(sample.excerpt, 'en')}>{sample.excerpt}</p>
              </> : <p className="chapter-sample-error" role="alert">{httpsImportMessage(new HttpsImportError(sample.errorCode || 'SOURCE_UNAVAILABLE'), lang)}</p>}
            </article>)}
          </div>}
        </section>
      </section>}
    </>}

    {draft && <section className="chapter-batch" aria-labelledby="chapter-batch-title">
      <h3 id="chapter-batch-title" lang={contentLanguage(draft.title, 'en')}>{draft.title}</h3>
      <div className="chapter-batch-counts" aria-live="polite"><span><strong>{done}</strong>{vi ? 'Đã tải' : 'Downloaded'}</span><span><strong>{pending}</strong>{vi ? 'Chưa tải' : 'Pending'}</span><span className={failed ? 'has-errors' : ''}><strong>{failed}</strong>{vi ? 'Lỗi' : 'Failed'}</span></div>
      <progress value={done} max={draft.chapters.length || 1} aria-label={vi ? 'Số chương tải thành công' : 'Chapters downloaded successfully'} />
      <p className="chapter-batch-status" role="status">{phase === 'download' ? (vi ? `Đang tải · ${done}/${draft.chapters.length} chương đã lưu` : `Downloading · ${done}/${draft.chapters.length} chapters saved`) : phase === 'build' ? (vi ? 'Đang gộp sách EPUB…' : 'Building EPUB…') : saving ? (vi ? 'Đang thêm sách vào thư viện…' : 'Adding book to your library…') : pending ? (vi ? 'Đợt tải đang tạm dừng. Tiếp tục để tải những chương còn lại.' : 'This download is paused. Continue to download the remaining chapters.') : failed ? (vi ? 'Một số chương bị lỗi. Bạn có thể thử lại riêng những chương đó.' : 'Some chapters failed. You can retry only those chapters.') : (vi ? 'Đã tải đủ chương. Hãy thêm sách vào thư viện để bắt đầu đọc.' : 'All chapters downloaded. Add the book to your library to start reading.')}</p>
      {phase === 'download' ? <button type="button" className="secondary" onClick={() => active.current?.abort()}><Pause size={15} />{vi ? 'Tạm dừng và giữ tiến độ' : 'Pause and keep progress'}</button> : <div className="chapter-inline-actions">{!!pending && <button type="button" className="secondary" disabled={!idle} onClick={() => void download(draft)}><Play size={15} />{vi ? 'Tiếp tục tải' : 'Continue download'}</button>}{!!failed && <button type="button" className="secondary" disabled={!idle} onClick={() => void download(draft, true)}><RotateCcw size={15} />{vi ? `Thử lại ${failed} chương lỗi` : `Retry ${failed} failed chapters`}</button>}</div>}
    </section>}

    {!!preview.length && <section className="chapter-preview" aria-label={vi ? 'Danh sách chương đã chọn' : 'Selected chapters'}>
      <div className="chapter-preview-heading"><strong>{vi ? 'Chương trong đợt tải' : 'Chapters in this batch'}</strong><span>{currentPage * PREVIEW_PAGE_SIZE + 1}–{Math.min((currentPage + 1) * PREVIEW_PAGE_SIZE, preview.length)} / {preview.length}</span></div>
      <ol start={draft || byNumber ? currentPage * PREVIEW_PAGE_SIZE + 1 : from + currentPage * PREVIEW_PAGE_SIZE}>
        {previewItems.map((chapter, index) => {
          const status = 'status' in chapter && typeof chapter.status === 'string' ? chapter.status : null
          return <li key={`${chapter.url}-${index}`}><span className="chapter-preview-title" lang={contentLanguage(chapter.title, 'en')}>{chapter.title}</span>{status && <span className={`chapter-status chapter-status-${status}`}>{status === 'done' ? <><Check size={12} />{vi ? 'Đã tải' : 'Downloaded'}</> : status === 'error' ? (vi ? 'Lỗi' : 'Failed') : (vi ? 'Chưa tải' : 'Pending')}</span>}</li>
        })}
      </ol>
      {pageCount > 1 && <nav className="chapter-preview-pages" aria-label={vi ? 'Trang danh sách chương' : 'Chapter list pages'}><button type="button" className="icon-button" disabled={currentPage === 0} onClick={() => setPreviewPage(currentPage - 1)} aria-label={vi ? 'Danh sách chương trước' : 'Previous chapter list page'}><ChevronLeft size={17} /></button><span>{vi ? 'Trang' : 'Page'} {currentPage + 1}/{pageCount}</span><button type="button" className="icon-button" disabled={currentPage >= pageCount - 1} onClick={() => setPreviewPage(currentPage + 1)} aria-label={vi ? 'Danh sách chương sau' : 'Next chapter list page'}><ChevronRight size={17} /></button></nav>}
    </section>}

    {confirmation && <section className="chapter-confirmation" role="group" aria-label={vi ? 'Xác nhận thao tác' : 'Confirm action'}>
      <p>{confirmation === 'partial' ? (vi ? `Chỉ gộp ${done}/${draft!.chapters.length} chương đã tải thành công? ${failed + pending} chương còn thiếu sẽ không nằm trong cuốn sách này. Tiến độ đợt tải sẽ được xóa sau khi lưu sách thành công.` : `Combine only ${done}/${draft!.chapters.length} downloaded chapters? The ${failed + pending} missing chapters will not be included. Batch progress will be removed after the book is saved successfully.`) : confirmation === 'replace' ? (vi ? 'Bắt đầu truyện mới sẽ xóa tiến độ của đợt tải trước trên trình duyệt này. Bạn có muốn tiếp tục?' : 'Starting a new story removes the previous download’s saved progress from this browser. Continue?') : (vi ? 'Xóa toàn bộ tiến độ của đợt tải này? Những chương đã tải nhưng chưa thêm vào thư viện sẽ bị xóa.' : 'Discard all progress for this download? Downloaded chapters that have not been added to your library will be removed.')}</p>
      <div className="chapter-inline-actions"><button type="button" className="secondary" disabled={!idle} onClick={() => setConfirmation(null)}>{vi ? 'Quay lại' : 'Go back'}</button><button type="button" className="primary" disabled={!idle} onClick={() => { if (confirmation === 'partial') void saveBook(true); else if (confirmation === 'replace') void beginBatch(true); else void discard() }}>{confirmation === 'partial' ? (vi ? `Lưu ${done} chương đã tải` : `Save ${done} downloaded chapters`) : confirmation === 'replace' ? (vi ? 'Xóa tiến độ cũ và tải mới' : 'Replace progress and download') : (vi ? 'Xóa tiến độ' : 'Discard progress')}</button></div>
    </section>}
    {error && <p role="alert" className="form-message">{error === 'SAVE_FAILED' ? saveError || httpsImportMessage(new HttpsImportError('SAVE_FAILED'), lang) : error}</p>}
    {phase === 'prepare' && <p role="status">{vi ? 'Đang cập nhật tiến độ…' : 'Updating saved progress…'}</p>}
    <div className="dialog-actions chapter-import-actions">
      <button type="button" className="secondary" disabled={saving} onClick={() => { active.current?.abort(); clearContentPreview(); onBack() }}><ArrowLeft size={15} />{vi ? 'Quay lại' : 'Back'}</button>
      {draft ? <>
        <button type="button" className="chapter-subtle-button" disabled={!idle} onClick={() => setConfirmation('discard')} aria-label={vi ? 'Xóa tiến độ đợt tải' : 'Discard this download’s progress'}><Trash2 size={15} /></button>
        <button type="button" className="secondary" disabled={saving} onClick={() => { active.current?.abort(); clearContentPreview(); onClose() }}>{vi ? 'Đóng, giữ tiến độ' : 'Close, keep progress'}</button>
        <button type="button" className="primary" disabled={!idle || !done || !!confirmation} onClick={() => void saveBook()}><Check size={16} />{vi ? 'Thêm EPUB vào thư viện' : 'Add EPUB to library'}</button>
      </> : catalog && <button type="button" className="primary" disabled={loading || busy || !validSelection || !!confirmation} onClick={() => void beginBatch()}><Download size={16} />{vi ? `Tải ${validBounds ? selected.length : '…'} chương` : `Download ${validBounds ? selected.length : '…'} chapters`}</button>}
    </div>
  </div>
}
