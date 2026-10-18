import { useEffect, useRef, useState } from 'react'
import { ArrowDown, ArrowUp, Search, X } from 'lucide-react'
import type { Lang } from './i18n'
import type { ReaderFormat } from './readerFormat'
import { SEARCH_RESULT_LIMIT, type ReaderSearchHit, type ReaderSearchProgress, type ReaderSearchResult, type ReaderSearchSource } from './readerSearch'
import './ReaderSearchPanel.css'
import { trackWebFeature } from './webAnalytics'

export type ReaderSearchPanelProps = {
  open: boolean
  lang: Lang
  bookTitle: string
  source: ReaderSearchSource | null
  format: ReaderFormat
  activeId?: string
  onNavigate: (hit: ReaderSearchHit) => void
  onClearActive: () => void
  onClose: () => void
}

type CompletedSearch = { query: string; source: ReaderSearchSource; retry: number; result: ReaderSearchResult }

/** Keep mounted while closed so a completed search and its query survive toggling. */
export function ReaderSearchPanel({ open, lang, bookTitle, source, format, activeId, onNavigate, onClearActive, onClose }: ReaderSearchPanelProps) {
  const vi = lang === 'vi'
  const [query, setQuery] = useState('')
  const [retry, setRetry] = useState(0)
  const [completed, setCompleted] = useState<CompletedSearch | null>(null)
  const [failed, setFailed] = useState<{ query: string; source: ReaderSearchSource; retry: number } | null>(null)
  const [lastProgress, setProgress] = useState<{ query: string; source: ReaderSearchSource; retry: number; value: ReaderSearchProgress } | null>(null)
  const input = useRef<HTMLInputElement>(null)
  const request = useRef<AbortController | null>(null)
  const generation = useRef(0)
  const cache = useRef<CompletedSearch | null>(null)
  const unsupported = format === 'image' || format === 'cbz'
  const needle = query.trim()
  const result = completed?.query === needle && completed.source === source && completed.retry === retry ? completed.result : null
  const hits = result?.hits ?? []
  const activeIndex = hits.findIndex(hit => hit.id === activeId)
  const eligible = open && Boolean(needle) && Boolean(source) && !unsupported
  const error = failed?.query === needle && failed.source === source && failed.retry === retry
  const status = !eligible || result ? 'idle' : error ? 'error' : 'loading'
  const progress = lastProgress?.query === needle && lastProgress.source === source && lastProgress.retry === retry ? lastProgress.value : { scanned: 0, total: 0 }

  useEffect(() => {
    if (open) input.current?.focus()
  }, [open])

  useEffect(() => {
    const version = ++generation.current
    const controller = new AbortController()
    request.current = controller
    if (!open || !needle || !source || unsupported) {
      return () => controller.abort()
    }
    if (cache.current?.query === needle && cache.current.source === source && cache.current.retry === retry) {
      return () => controller.abort()
    }
    const current = () => !controller.signal.aborted && generation.current === version
    const timer = window.setTimeout(() => {
      void Promise.resolve().then(() => source(needle, controller.signal, value => {
        if (current()) setProgress({ query: needle, source, retry, value })
      })).then(value => {
        if (!current()) return
        const next = { query: needle, source, retry, result: value }
        cache.current = next
        setCompleted(next)
        setFailed(null)
        if (value.textAvailable) trackWebFeature('reader_search', 'reader')
      }, () => {
        if (current()) setFailed({ query: needle, source, retry })
      })
    }, 250)
    return () => {
      controller.abort()
      window.clearTimeout(timer)
    }
  }, [open, needle, source, unsupported, retry])

  function changeQuery(value: string) {
    if (value.trim() !== needle) {
      request.current?.abort()
      generation.current++
      onClearActive()
    }
    setQuery(value)
  }

  function navigate(direction: number) {
    if (!hits.length) return
    const next = activeIndex < 0 ? (direction < 0 ? hits.length - 1 : 0) : (activeIndex + direction + hits.length) % hits.length
    onNavigate(hits[next])
  }

  return <aside id="reader-search-panel" className="reader-search-panel" role="complementary" aria-label={vi ? 'Tìm trong sách' : 'Search in book'} hidden={!open}>
    <header className="reader-search-heading"><div><span className="reader-search-kicker">{vi ? 'Tìm lại một ý tưởng' : 'Find a passage'}</span><h2>{vi ? 'Tìm trong sách' : 'Search in book'}</h2><p title={bookTitle}>{bookTitle}</p></div><button type="button" className="reader-search-close" onClick={onClose} aria-label={vi ? 'Đóng bảng tìm kiếm' : 'Close search panel'}><X size={19} aria-hidden="true" /></button></header>
    <div className="reader-search-content">
      <form className="reader-search-form" onSubmit={event => { event.preventDefault(); navigate(1) }}>
        <label htmlFor="reader-search-query">{vi ? 'Từ khóa trong sách' : 'Search book text'}</label>
        <div className="reader-search-field"><Search size={16} aria-hidden="true" /><input ref={input} id="reader-search-query" type="search" value={query} maxLength={200} disabled={unsupported} autoComplete="off" spellCheck={false} placeholder={vi ? 'Nhập một từ hoặc cụm từ…' : 'Enter a word or phrase…'} onChange={event => changeQuery(event.target.value)} onKeyDown={event => {
          if (event.key === 'Enter') { event.preventDefault(); navigate(event.shiftKey ? -1 : 1) }
        }} />{query && <button type="button" onClick={() => { changeQuery(''); input.current?.focus() }} aria-label={vi ? 'Xóa từ khóa' : 'Clear search'}><X size={15} aria-hidden="true" /></button>}</div>
      </form>
      {unsupported ? <p className="reader-search-message">{vi ? 'Tệp ảnh và truyện CBZ không có lớp văn bản để tìm kiếm. Cần nhận dạng chữ (OCR) trước.' : 'Images and CBZ comics have no searchable text layer. Text recognition (OCR) is needed first.'}</p> : <>
        {!source && <p className="reader-search-message" role="status">{vi ? 'Đang chuẩn bị văn bản của sách…' : 'Preparing book text…'}</p>}
        {source && !needle && <p className="reader-search-message">{vi ? 'Tìm từ hoặc cụm từ trong nội dung cuốn sách. Không cần gõ đúng dấu hay chữ hoa.' : 'Find a word or phrase in this book. Matching ignores case and accents.'}</p>}
        {source && needle && status === 'loading' && <p className="reader-search-status" role="status">{vi ? 'Đang tìm kiếm…' : 'Searching…'}{progress.total > 0 && <span>{progress.scanned} / {progress.total} {format === 'pdf' ? (vi ? 'trang' : 'pages') : (vi ? 'phần' : 'sections')}</span>}</p>}
        {status === 'error' && <div className="reader-search-error" role="alert"><p>{vi ? 'Chưa tìm kiếm được trong sách. Vui lòng thử lại.' : 'Unable to search this book. Please try again.'}</p><button type="button" onClick={() => setRetry(value => value + 1)}>{vi ? 'Thử lại' : 'Retry search'}</button></div>}
        {result && status !== 'loading' && <>
          {!result.textAvailable ? <p className="reader-search-message">{format === 'pdf' ? (vi ? 'PDF này chưa có lớp văn bản có thể tìm kiếm. Nếu đây là bản scan, cần nhận dạng chữ (OCR) trước.' : 'This PDF has no searchable text layer. Scanned pages need text recognition (OCR) first.') : (vi ? 'Không tìm thấy văn bản có thể tìm kiếm trong tệp này.' : 'No searchable text was found in this file.')}</p> : <>
            <div className="reader-search-summary"><p role="status">{hits.length} {vi ? 'kết quả' : (hits.length === 1 ? 'result' : 'results')}</p>{hits.length > 0 && <div><button type="button" onClick={() => navigate(-1)} aria-label={vi ? 'Kết quả trước' : 'Previous result'}><ArrowUp size={15} aria-hidden="true" /></button><span>{activeIndex >= 0 ? activeIndex + 1 : '—'} / {hits.length}</span><button type="button" onClick={() => navigate(1)} aria-label={vi ? 'Kết quả tiếp theo' : 'Next result'}><ArrowDown size={15} aria-hidden="true" /></button></div>}</div>
            {result.truncated && <p className="reader-search-limit">{vi ? `Hiển thị ${SEARCH_RESULT_LIMIT} kết quả đầu tiên. Thêm từ khóa để thu hẹp tìm kiếm.` : `Showing the first ${SEARCH_RESULT_LIMIT} results. Add more words to narrow your search.`}</p>}
            {!hits.length && <div className="reader-search-empty"><p>{vi ? 'Chưa tìm thấy đoạn phù hợp.' : 'No matching passages.'}</p><span>{vi ? 'Thử một từ ngắn hơn hoặc cách diễn đạt khác.' : 'Try a shorter word or a different phrase.'}</span></div>}
            {hits.length > 0 && <p className="reader-search-shortcut">{vi ? 'Enter: kết quả tiếp · Shift + Enter: kết quả trước' : 'Enter: next result · Shift + Enter: previous result'}</p>}
            <ol className="reader-search-results">{hits.map((hit, index) => <li key={hit.id}><button type="button" className="reader-search-result" aria-current={hit.id === activeId ? 'location' : undefined} onClick={() => onNavigate(hit)}>
              <span className="reader-search-result-label"><span>{hit.label || (hit.pageNumber ? `${vi ? 'Trang' : 'Page'} ${hit.pageNumber}` : `${vi ? 'Đoạn' : 'Passage'} ${index + 1}`)}</span><span>{String(index + 1).padStart(2, '0')}</span></span>
              <span className="reader-search-excerpt">{hit.excerpt.slice(0, hit.matchStart)}<mark>{hit.excerpt.slice(hit.matchStart, hit.matchEnd)}</mark>{hit.excerpt.slice(hit.matchEnd)}</span>
            </button></li>)}</ol>
          </>}
        </>}
      </>}
    </div>
  </aside>
}
