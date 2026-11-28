import { useEffect, useId, useRef, useState, type FormEvent } from 'react'
import { ArrowUpRight, Sparkles, X } from 'lucide-react'
import { ApiError } from './api'
import { aiQuotaError, aiQuotaLabel } from './aiQuota'
import type { Lang } from './i18n'
import { askMemoryAi, findMemorySources, memorySource, organizeMemoryAi, type MemoryAnswer, type MemoryOrganization, type MemorySource } from './memoryAi'
import { readingAiStatus, type ReadingAiStatus } from './readingAi'
import { readableError } from './sync'
import { contentLanguage } from './typography'
import type { Book, SyncRecord } from './types'
import './MemoryAiPanel.css'

type Props = {
  lang: Lang
  token: string
  profile: string
  annotations: SyncRecord[]
  books: Book[]
  organize?: { source: MemorySource; options: MemoryOrganization }
  onApply: (source: MemorySource, choices: MemoryOrganization) => Promise<void>
  onManage: () => void
  onOpenSource: (record: SyncRecord) => void
  onClose: () => void
}

export function MemoryAiPanel({ lang, token, profile, annotations, books, organize, onApply, onManage, onOpenSource, onClose }: Props) {
  const vi = lang === 'vi'
  const headingId = useId()
  const heading = useRef<HTMLHeadingElement>(null)
  const flight = useRef<AbortController>(null)
  const [status, setStatus] = useState<ReadingAiStatus | null>(null)
  const [retry, setRetry] = useState(0)
  const [question, setQuestion] = useState('')
  const [sources, setSources] = useState<MemorySource[] | null>(null)
  const [consent, setConsent] = useState(false)
  const [busy, setBusy] = useState(false)
  const [error, setError] = useState('')
  const [statusError, setStatusError] = useState('')
  const [answer, setAnswer] = useState<MemoryAnswer | null>(null)
  const [suggestion, setSuggestion] = useState<{ source: MemorySource; choices: MemoryOrganization } | null>(null)
  const [remaining, setRemaining] = useState<number | null>(null)
  const [applied, setApplied] = useState(false)

  useEffect(() => {
    heading.current?.focus({ preventScroll: true })
    heading.current?.scrollIntoView?.({ block: 'nearest' })
  }, [])

  useEffect(() => {
    const controller = new AbortController()
    setStatusError('')
    setBusy(false)
    readingAiStatus(token, controller.signal).then(value => {
      if (!controller.signal.aborted) { setStatus(value); setStatusError('') }
    }).catch(cause => {
      if (!controller.signal.aborted) setStatusError(readableError(cause, lang))
    })
    return () => {
      controller.abort()
      flight.current?.abort()
      flight.current = null
    }
  }, [token, lang, retry])

  const canOrganize = !!organize && !!(organize.options.tags.length || organize.options.collections.length)
  const exhausted = status?.quota?.remaining === 0
  const canRequest = status?.available && !exhausted && consent && !busy && (organize ? canOrganize && !applied : !!sources?.length)

  function preview(event: FormEvent) {
    event.preventDefault()
    if (!question.trim() || busy) return
    setSources(findMemorySources(question, annotations, books, profile))
    setAnswer(null)
    setConsent(false)
    setError('')
  }

  async function request() {
    if (!canRequest || flight.current) return
    if (sources?.some(source => {
      const note = annotations.find(record => record.key === source.record.key)
      const book = books.find(item => item.id === source.book.id)
      const latest = note && memorySource(note, book, profile)
      return !latest || latest.excerpt !== source.excerpt || latest.title !== source.title || latest.record.payload.locator_json !== source.record.payload.locator_json
    })) {
      setSources(null)
      setConsent(false)
      setError(vi ? 'Ghi chú đã thay đổi. Hãy tìm lại các đoạn liên quan.' : 'Your notes changed. Find relevant excerpts again.')
      return
    }
    const controller = new AbortController()
    flight.current = controller
    setBusy(true)
    setError('')
    setConsent(false)
    setAnswer(null)
    setSuggestion(null)
    try {
      if (organize) {
        const { source, options } = organize
        const result = await organizeMemoryAi(token, lang, source, options, controller.signal)
        if (controller.signal.aborted) return
        const tags = result.tags.map(index => options.tags[index - 1]).filter(Boolean)
        const collection = result.collection === null ? undefined : options.collections[result.collection - 1]
        setSuggestion({ source, choices: { tags, collections: collection ? [collection] : [] } })
        setRemaining(result.remaining)
        const quota = result.quota
        if (quota) setStatus(current => current && { ...current, quota })
      } else if (sources?.length) {
        const result = await askMemoryAi(token, lang, question.trim(), sources, controller.signal)
        if (controller.signal.aborted) return
        setAnswer(result)
        setRemaining(result.remaining)
        const quota = result.quota
        if (quota) setStatus(current => current && { ...current, quota })
      }
    } catch (cause) {
      if (!controller.signal.aborted) {
        const code = cause instanceof ApiError ? cause.code : ''
        setError(aiQuotaError(code, lang) || readableError(cause, lang))
        if (code === 'AI_DAILY_LIMIT' || code === 'AI_TRIAL_EXHAUSTED') setRetry(value => value + 1)
      }
    } finally {
      if (flight.current === controller) {
        flight.current = null
        setBusy(false)
      }
    }
  }

  async function apply() {
    if (!organize || !suggestion || busy || applied) return
    setBusy(true)
    setError('')
    try {
      await onApply(suggestion.source, suggestion.choices)
      setApplied(true)
    } catch (cause) {
      setError(readableError(cause, lang))
    } finally {
      setBusy(false)
    }
  }

  const choices = suggestion?.choices
  const chosen = choices && !!(choices.tags.length || choices.collections.length)
  return <section className="memory-ai" aria-labelledby={headingId}>
    <div className="memory-ai-header">
      <h3 id={headingId} ref={heading} tabIndex={-1}>{organize ? (vi ? 'Gợi ý phân loại' : 'Organization suggestions') : (vi ? 'Hỏi kho ghi chú' : 'Ask your notes')}</h3>
      <button className="icon-button" type="button" aria-label={vi ? 'Đóng bảng AI' : 'Close AI panel'} onClick={onClose}><X size={19} /></button>
    </div>

    {organize ? <>
      <p>{vi ? 'Dùng ghi chú này để chọn thẻ và bộ sưu tập có sẵn cho sách.' : 'Use this note to suggest existing tags and a collection for its book.'}</p>
      <details>
        <summary>{vi ? 'Xem dữ liệu sẽ gửi' : 'Preview data to send'}</summary>
        <SourcePreview source={organize.source} lang={lang} />
        {!!organize.options.tags.length && <p>{vi ? 'Thẻ có thể chọn' : 'Available tags'} · {organize.options.tags.map(item => item.name).join(', ')}</p>}
        {!!organize.options.collections.length && <p>{vi ? 'Bộ sưu tập có thể chọn' : 'Available collections'} · {organize.options.collections.map(item => item.name).join(', ')}</p>}
      </details>
      {!canOrganize && !suggestion && <div className="memory-ai-actions"><p>{vi ? 'Chưa có thẻ hoặc bộ sưu tập phù hợp để chọn. Bạn có thể tạo thêm.' : 'There are no available tags or collections to choose from. You can create more.'}</p><button className="secondary" onClick={onManage}>{vi ? 'Quản lý thẻ và bộ sưu tập' : 'Manage tags and collections'}</button></div>}
    </> : <>
      <p>{vi ? 'Tìm trong highlight và ghi chú đã lưu để hỏi AI và mở lại đoạn nguồn.' : 'Find saved highlights and notes, then ask AI and reopen the cited passages.'}</p>
      <form className="memory-ai-question" onSubmit={preview}>
        <label htmlFor={`${headingId}-question`}>{vi ? 'Câu hỏi của bạn' : 'Your question'}</label>
        <input id={`${headingId}-question`} value={question} maxLength={600} disabled={busy} onChange={event => {
          setQuestion(event.target.value); setSources(null); setAnswer(null); setConsent(false); setError('')
        }} placeholder={vi ? 'Ví dụ: Các ghi chú nói gì về thói quen đọc?' : 'What do my notes say about reading habits?'} />
        <button className="secondary" disabled={!question.trim() || busy}>{vi ? 'Tìm đoạn liên quan' : 'Find relevant excerpts'}</button>
      </form>
      {sources && (sources.length ? <details>
        <summary>{vi ? `Xem ${sources.length} đoạn sẽ gửi` : `Preview ${sources.length} excerpts to send`}</summary>
        <ol>{sources.map(source => <li key={source.record.key}><SourcePreview source={source} lang={lang} /></li>)}</ol>
      </details> : <p role="status">{vi ? 'Chưa tìm thấy đoạn liên quan. Thử dùng từ khóa có trong ghi chú hoặc tên sách.' : 'No relevant passages found. Try words from your notes or book titles.'}</p>)}
    </>}

    {statusError && <p role="alert">{statusError}</p>}
    {status && !status.available && <p role="status">{vi ? 'AI hiện chưa khả dụng.' : 'AI is currently unavailable.'}</p>}
    {status?.available && !applied && (organize ? canOrganize && !suggestion : !!sources?.length && !answer) && <div className="memory-ai-actions">
      <label className="memory-ai-consent"><input type="checkbox" checked={consent} disabled={busy} onChange={event => setConsent(event.target.checked)} />
        {vi ? `Tôi đồng ý gửi ${organize ? 'tên sách, đoạn ghi chú và tên các thẻ, bộ sưu tập ở trên' : 'câu hỏi, tên sách và các đoạn đã chọn'} đến ${status.provider}.` : `I agree to send ${organize ? 'the book title, saved excerpt, and the tag and collection names above' : 'my question, book titles, and the selected excerpts'} to ${status.provider}.`}
      </label>
      <button className="primary" type="button" disabled={!canRequest} onClick={() => void request()}><Sparkles size={16} />{busy ? (vi ? 'Đang xử lý…' : 'Working…') : organize ? (vi ? 'Tạo gợi ý' : 'Generate suggestions') : (vi ? 'Hỏi AI' : 'Ask AI')}</button>
    </div>}
    {error && <p role="alert">{error}</p>}
    {answer && <div className="memory-ai-result" aria-live="polite">
      <p className="memory-ai-answer">{answer.answer ?? (vi ? 'Các đoạn đã chọn chưa đủ để trả lời câu hỏi.' : 'The selected excerpts do not contain enough information to answer.')}</p>
      {answer.citations.map(number => {
        const source = sources?.[number - 1]
        return source && <button key={number} className="text-button" type="button" onClick={() => onOpenSource(source.record)}><ArrowUpRight size={16} /> <span lang={contentLanguage(source.title, source.book.language, lang)}>[{number}] {source.title}</span></button>
      })}
    </div>}
    {suggestion && <div className="memory-ai-result" aria-live="polite">
      {chosen ? <>
        {!!choices.tags.length && <p>{vi ? 'Thẻ' : 'Tags'} · {choices.tags.map(item => item.name).join(', ')}</p>}
        {!!choices.collections.length && <p>{vi ? 'Bộ sưu tập' : 'Collection'} · {choices.collections[0].name}</p>}
        {applied ? <p role="status">{vi ? 'Đã áp dụng cho sách.' : 'Applied to the book.'}</p> : <button className="primary" disabled={busy} onClick={() => void apply()}>{vi ? 'Áp dụng cho sách' : 'Apply to book'}</button>}
      </> : <p>{vi ? 'AI chưa tìm thấy thẻ hoặc bộ sưu tập phù hợp.' : 'AI found no matching tags or collection.'}</p>}
      {!applied && <button className="text-button" disabled={busy} onClick={() => setSuggestion(null)}>{vi ? 'Tạo lại gợi ý' : 'Try again'}</button>}
    </div>}
    {status?.available && <p className="muted">{status.quota ? aiQuotaLabel(status.quota, lang) : remaining === null ? (vi ? `Dùng chung hạn mức AI · ${status.dailyLimit} lượt/ngày` : `Shared AI limit · ${status.dailyLimit} requests/day`) : (vi ? `Còn ${remaining} lượt AI hôm nay` : `${remaining} AI requests left today`)}</p>}
    {exhausted && <div className="memory-ai-actions"><p>{aiQuotaError(status?.quota?.period === 'trial' ? 'AI_TRIAL_EXHAUSTED' : 'AI_DAILY_LIMIT', lang)}</p><button className="secondary" type="button" onClick={() => setRetry(value => value + 1)}>{vi ? 'Cập nhật hạn mức' : 'Refresh allowance'}</button></div>}
  </section>
}

function SourcePreview({ source, lang }: { source: MemorySource; lang: Lang }) {
  return <div className="memory-ai-source">
    <strong lang={contentLanguage(source.title, source.book.language, lang)}>{source.title}</strong>
    <p lang={contentLanguage(source.excerpt, undefined, lang)}>{source.excerpt}</p>
  </div>
}
