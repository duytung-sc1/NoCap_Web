import { useEffect, useRef, useState, type FormEvent } from 'react'
import { ChevronDown, Search } from 'lucide-react'
import { detectReaderFormat } from './readerFormat'
import { createEpubSearchSource, createPdfSearchSource } from './readerSearchSources'
import type { ReaderSearchHit, ReaderSearchResult } from './readerSearch'
import type { Lang } from './i18n'
import type { Book } from './types'
import { contentLanguage } from './typography'
import './WorkspaceTools.css'

const maxResults = 120
const maxBookBytes = 64 * 1024 * 1024

async function searchFile(book: Book, bytes: ArrayBuffer, query: string, signal: AbortSignal): Promise<ReaderSearchResult | null> {
  signal.throwIfAborted()
  const format = detectReaderFormat(book, bytes)
  if (format === 'pdf') {
    const [{ getDocument, GlobalWorkerOptions }, { pdfDocumentOptions }, { default: workerUrl }] = await Promise.all([
      import('pdfjs-dist'), import('./pdfResources'), import('pdfjs-dist/build/pdf.worker.min.mjs?url'),
    ])
    signal.throwIfAborted()
    GlobalWorkerOptions.workerSrc = workerUrl
    const task = getDocument(pdfDocumentOptions(bytes))
    let cleanup: Promise<void> | undefined
    const destroy = () => { cleanup ??= task.destroy().catch(() => {}) }
    signal.addEventListener('abort', destroy, { once: true })
    try { return await createPdfSearchSource(await task.promise, () => !signal.aborted)(query, signal) }
    finally { signal.removeEventListener('abort', destroy); destroy(); await cleanup }
  }
  if (format === 'epub') {
    const { default: ePub } = await import('epubjs')
    signal.throwIfAborted()
    const publication = ePub(bytes)
    let rejectAbort: () => void
    const aborted = new Promise<never>((_resolve, reject) => { rejectAbort = () => reject(signal.reason) })
    const cancel = () => rejectAbort()
    signal.addEventListener('abort', cancel, { once: true })
    try {
      await Promise.race([publication.ready, aborted])
      return await Promise.race([createEpubSearchSource(publication, () => !signal.aborted)(query, signal), aborted])
    } finally { signal.removeEventListener('abort', cancel); publication.destroy() }
  }
  return null
}

type Result = { book: Book; hit: ReaderSearchHit }
type Progress = { checked: number; total: number; failures: number; withoutText: number; limited: boolean }
type Props = {
  lang: Lang; books: Book[]; authorize: () => Promise<boolean>
  load: (book: Book, signal: AbortSignal) => Promise<ArrayBuffer>
  onOpen: (book: Book, locator: string) => void
}

export function LibraryContentSearch({ lang, books, authorize, load, onOpen }: Props) {
  const vi = lang === 'vi'
  const tx = (a: string, b: string) => vi ? a : b
  const [query, setQuery] = useState('')
  const [results, setResults] = useState<Result[]>([])
  const [progress, setProgress] = useState<Progress | null>(null)
  const [busy, setBusy] = useState(false)
  const [cancelled, setCancelled] = useState(false)
  const flight = useRef<AbortController | null>(null)
  useEffect(() => () => { flight.current?.abort(); flight.current = null }, [])

  async function search(event: FormEvent) {
    event.preventDefault()
    const term = query.trim()
    if (!term || flight.current) return
    const controller = new AbortController()
    flight.current = controller
    setBusy(true); setProgress(null); setResults([]); setCancelled(false)
    const signal = controller.signal
    try {
      if (!await authorize() || signal.aborted) return
      const candidates = books.filter(book => (book.source === 'local' || book.source === 'cloud' || book.fileUrl?.startsWith('nocap-private:')) &&
        ['epub','pdf'].includes(detectReaderFormat(book, new ArrayBuffer(0))))
      const state = { checked: 0, total: candidates.length, failures: 0, withoutText: 0, limited: false }
      const found: Result[] = []
      setProgress({ ...state })
      for (const book of candidates) {
        signal.throwIfAborted()
        try {
          if (book.fileSizeBytes && book.fileSizeBytes > maxBookBytes) throw new Error('FILE_LIMIT')
          const bytes = await load(book, signal)
          if (bytes.byteLength > maxBookBytes) throw new Error('FILE_LIMIT')
          const matches = await searchFile(book, bytes, term, signal)
          signal.throwIfAborted()
          if (!matches) state.failures++
          else if (!matches.textAvailable) state.withoutText++
          else {
            found.push(...matches.hits.slice(0, maxResults - found.length).map(hit => ({ book, hit })))
            state.limited ||= matches.truncated || found.length >= maxResults
            setResults([...found])
          }
        } catch { if (signal.aborted) return; state.failures++ }
        state.checked++
        setProgress({ ...state })
        if (found.length >= maxResults) break
      }
    } catch {
      if (!signal.aborted) setProgress({ checked: 0, total: 0, failures: 1, withoutText: 0, limited: false })
    } finally {
      if (flight.current === controller) { flight.current = null; setBusy(false) }
    }
  }

  function cancel() {
    flight.current?.abort(); flight.current = null; setCancelled(true); setBusy(false)
  }

  return <details className="workspace-tools workspace-tool-card" name="nocap-library-tools" onToggle={event => { if (!event.currentTarget.open && flight.current) cancel() }}>
    <summary><Search size={18} aria-hidden="true" />{tx('Tìm nội dung trong thư viện', 'Search library content')}<ChevronDown className="workspace-tool-chevron" size={16} aria-hidden="true" /></summary>
    <div className="workspace-tool-content">
    <p>{tx('Tìm trong EPUB và PDF có văn bản trong thư viện cá nhân, tối đa 64 MiB mỗi tệp.', 'Search personal EPUBs and text-based PDFs, up to 64 MiB per file.')}</p>
    <form className="workspace-tool-controls workspace-search-form" onSubmit={event => void search(event)}>
      <label>{tx('Từ khóa hoặc cụm từ', 'Word or phrase')}<input type="search" maxLength={300} value={query} disabled={busy} onChange={event => { setQuery(event.target.value); setProgress(null); setResults([]); setCancelled(false) }} /></label>
      <button className="secondary" disabled={busy || !query.trim()}><Search size={16} />{tx('Tìm nhiều tài liệu', 'Search documents')}</button>
      {busy && <button type="button" className="text-button" onClick={cancel}>{tx('Dừng tìm', 'Stop search')}</button>}
    </form>
    {progress && <p role="status">{tx(`Đã xem ${progress.checked}/${progress.total} tài liệu · ${results.length} kết quả`, `Checked ${progress.checked}/${progress.total} documents · ${results.length} results`)}
      {progress.withoutText > 0 && tx(` · ${progress.withoutText} tệp thiếu lớp văn bản`, ` · ${progress.withoutText} without selectable text`)}
      {progress.failures > 0 && tx(` · ${progress.failures} tệp được bỏ qua`, ` · ${progress.failures} files skipped`)}
      {progress.limited && tx(' · Đã giới hạn số kết quả. Thử cụm từ cụ thể hơn.', ' · Result limit reached. Try a more specific phrase.')}
      {cancelled && tx(' · Đã dừng tìm.', ' · Search stopped.')}</p>}
    {!!results.length && <ul className="workspace-tool-list">{results.map(({ book, hit }) => <li key={`${book.id}:${hit.id}`}>
      <button type="button" className="text-button" onClick={() => onOpen(book, hit.locatorJson)}><span lang={contentLanguage(book.title, book.language, lang)}>{book.title}</span>{hit.pageNumber ? ` · ${tx('Trang', 'Page')} ${hit.pageNumber}` : hit.label ? <span lang={contentLanguage(hit.label, book.language, lang)}> · {hit.label}</span> : null}</button>
      <p lang={contentLanguage(hit.excerpt, book.language, lang)}>{hit.excerpt.slice(0, hit.matchStart)}<mark>{hit.excerpt.slice(hit.matchStart, hit.matchEnd)}</mark>{hit.excerpt.slice(hit.matchEnd)}</p>
    </li>)}</ul>}
    </div>
  </details>
}
