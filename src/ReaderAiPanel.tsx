import { useEffect, useRef, useState } from 'react'
import { ArrowUpRight, LoaderCircle, Send, Sparkles, X } from 'lucide-react'
import { ApiError } from './api'
import { askReadingAi, readingAiStatus, type ReadingAiAnswer, type ReadingAiMode, type ReadingAiStatus, type TranslationLanguage } from './readingAi'
import type { ReaderSpeechSource } from './readerSpeech'
import type { Lang } from './i18n'
import { contentLanguage } from './typography'
import './ReaderAiPanel.css'

type Props = {
  lang: Lang
  token: string
  bookTitle: string
  source: ReaderSpeechSource | null
  locatorJson?: string
  chapterTitle?: string
  selection: { text: string; locator: string } | null
  onNavigate: (locator: string) => void
  onClose: () => void
}
type Result = ReadingAiAnswer & { locator: string; excerpt: string; sourceTruncated: boolean }

function errorText(error: unknown, vi: boolean) {
  if (error instanceof ApiError) {
    if (error.status === 401) return vi ? 'Phiên đăng nhập hết hạn. Hãy đăng nhập lại.' : 'Your session expired. Sign in again.'
    if (error.code === 'AI_ADMIN_ONLY') return vi ? 'AI hiện chỉ dành cho quản trị viên kiểm thử.' : 'AI is currently available to administrators for testing.'
    if (error.code === 'EMAIL_NOT_VERIFIED') return vi ? 'Hãy xác minh email trước khi dùng AI.' : 'Verify your email before using AI.'
    if (error.status === 429) return vi ? 'Đã chạm giới hạn yêu cầu của NoCap hoặc dịch vụ AI. Hãy thử lại sau.' : 'A NoCap or AI provider request limit was reached. Try again later.'
    if (error.code === 'AI_UNAVAILABLE') return vi ? 'AI đang tạm tắt hoặc chưa được cấu hình.' : 'AI is disabled or not configured yet.'
  }
  if (error instanceof Error && ['no-text', 'image-only'].includes(error.message)) return vi ? 'Phần này chưa có văn bản để gửi. PDF scan cần OCR trước khi dùng AI.' : 'This passage has no extractable text. Scanned PDFs need OCR before using AI.'
  return vi ? 'Chưa lấy được câu trả lời. Kiểm tra kết nối rồi thử lại.' : 'Could not get an answer. Check your connection and try again.'
}

export function ReaderAiPanel({ lang, token, bookTitle, source, locatorJson, chapterTitle, selection, onNavigate, onClose }: Props) {
  const vi = lang === 'vi'
  const [status, setStatus] = useState<ReadingAiStatus | null>(null)
  const [statusError, setStatusError] = useState('')
  const [retry, setRetry] = useState(0)
  const [scope, setScope] = useState<'current' | 'selection'>('current')
  const [consent, setConsent] = useState(false)
  const [question, setQuestion] = useState('')
  const [targetLanguage, setTargetLanguage] = useState<TranslationLanguage>(lang)
  const [busy, setBusy] = useState(false)
  const [error, setError] = useState('')
  const [result, setResult] = useState<Result | null>(null)
  const flight = useRef<AbortController | null>(null)
  const alive = useRef(true)
  const ready = !!status?.available && consent && (scope === 'selection' ? !!selection?.text.trim() : !!source) && !busy

  useEffect(() => {
    const controller = new AbortController()
    void readingAiStatus(token, controller.signal).then(value => {
      if (!controller.signal.aborted) { setStatus(value); setStatusError('') }
    }).catch(error => { if (!controller.signal.aborted) setStatusError(errorText(error, lang === 'vi')) })
    return () => controller.abort()
  }, [token, retry, lang])

  useEffect(() => {
    alive.current = true
    return () => { alive.current = false; flight.current?.abort() }
  }, [])

  async function submit(mode: ReadingAiMode) {
    const canTranslate = !!status?.available && consent && !!selection?.text.trim() && selection.text.trim().length <= 4000 && !busy
    if (!(mode === 'translate' ? canTranslate : ready) || flight.current || mode === 'question' && !question.trim()) return
    const controller = new AbortController()
    flight.current = controller
    setBusy(true); setError('')
    // Snapshot location and selection before asynchronous extraction starts.
    const translating = mode === 'translate'
    const locator = translating || scope === 'selection' ? selection?.locator || '' : locatorJson || ''
    try {
      if (translating && (!selection?.text.trim() || selection.text.trim().length > 4000)) { setError(vi ? 'Hãy bôi chọn một đoạn không quá 4.000 ký tự để dịch.' : 'Select a passage of up to 4,000 characters to translate.'); return }
      const captured = translating || scope === 'selection'
        ? { text: selection?.text || '', label: vi ? 'Đoạn được chọn' : 'Selected passage', truncated: false }
        : await source!(controller.signal)
      controller.signal.throwIfAborted()
      const text = captured.text.slice(0, 20000).replace(/[\uD800-\uDBFF]$/u, '').trim()
      if (!text) throw new Error('no-text')
      const label = (captured.label || chapterTitle || (vi ? 'Phần đang đọc' : 'Current passage')).slice(0, 160)
      const response = await askReadingAi(token, { mode, text, title: bookTitle.slice(0, 300), label, language: lang, consent: true, ...(translating ? { targetLanguage } : {}), ...(mode === 'question' ? { question: question.trim() } : {}) }, controller.signal)
      if (alive.current && !controller.signal.aborted) setResult({ ...response, locator, excerpt: text, sourceTruncated: captured.truncated || captured.text.length > text.length })
    } catch (error) {
      if (alive.current && !controller.signal.aborted) setError(errorText(error, vi))
    } finally {
      if (flight.current === controller) flight.current = null
      if (alive.current) setBusy(false)
    }
  }

  return <aside id="reader-ai-panel" className="reader-ai-panel" lang={lang} aria-label={vi ? 'Trợ lý AI đọc sách' : 'AI reading assistant'}>
    <header className="reader-ai-heading"><div><h2><Sparkles size={20} aria-hidden="true" />NoCap AI</h2><span>{vi ? 'Admin · Bản thử' : 'Admin · Preview'}</span><p lang={contentLanguage(bookTitle, undefined, lang)}>{bookTitle}</p></div><button type="button" className="reader-ai-close" onClick={onClose} aria-label={vi ? 'Đóng trợ lý AI' : 'Close AI assistant'}><X size={19} /></button></header>
    <div className="reader-ai-content">
      <p className="reader-ai-hint">{vi ? 'Tóm tắt và hỏi đáp phần đang đọc hoặc đoạn được chọn. Chưa tìm kiếm toàn bộ cuốn sách.' : 'Summarize and ask about the current passage or a selection. Whole-book search is not included yet.'}</p>
      {statusError ? <div role="alert"><p className="reader-ai-error">{statusError}</p><button type="button" onClick={() => setRetry(value => value + 1)}>{vi ? 'Thử lại kết nối' : 'Retry connection'}</button></div> : !status ? <p role="status">{vi ? 'Đang kiểm tra dịch vụ AI…' : 'Checking AI service…'}</p> : !status.available ? <p className="reader-ai-error" role="status">{vi ? 'AI đang tạm tắt hoặc chưa được cấu hình.' : 'AI is disabled or not configured yet.'}</p> : <p className="reader-ai-provider">{status.provider} · {status.dailyLimit} {vi ? 'yêu cầu/ngày/tài khoản' : 'requests/day/account'}</p>}
      <fieldset className="reader-ai-scope" disabled={busy}><legend>{vi ? 'Nội dung gửi đi' : 'Source to send'}</legend>
        <label><input type="radio" name="ai-scope" checked={scope === 'current'} onChange={() => setScope('current')} />{vi ? 'Phần đang đọc' : 'Current passage'}</label>
        <label><input type="radio" name="ai-scope" checked={scope === 'selection'} disabled={!selection?.text} onChange={() => setScope('selection')} />{vi ? 'Đoạn được chọn' : 'Selected passage'}</label>
      </fieldset>
      {scope === 'selection' && selection?.text && <blockquote lang={contentLanguage(selection.text, undefined, lang)} className="reader-ai-selection">{selection.text.slice(0, 1000)}</blockquote>}
      <label className="reader-ai-consent"><input type="checkbox" checked={consent} disabled={busy} onChange={event => setConsent(event.target.checked)} /><span>{vi ? `Tôi đồng ý gửi tối đa 20.000 ký tự nội dung đã chọn và câu hỏi tới ${status?.provider || 'dịch vụ AI'} để xử lý.` : `I agree to send up to 20,000 characters of the chosen passage and my question to ${status?.provider || 'the AI service'} for processing.`}</span></label>
      <div className="reader-ai-shortcuts"><button type="button" disabled={!ready} onClick={() => void submit('summary')}>{vi ? 'Tóm tắt' : 'Summarize'}</button><button type="button" disabled={!ready} onClick={() => void submit('explain')}>{vi ? 'Giải thích' : 'Explain'}</button></div>
      <div className="reader-ai-translation"><label>{vi ? 'Dịch đoạn được chọn sang' : 'Translate selection into'}<select value={targetLanguage} disabled={busy} onChange={event => setTargetLanguage(event.target.value as TranslationLanguage)}>{Object.entries({ vi: 'Tiếng Việt', en: 'English', ja: '日本語', ko: '한국어', zh: '中文', fr: 'Français' }).map(([value, name]) => <option key={value} value={value}>{name}</option>)}</select></label><button type="button" disabled={!status?.available || !consent || !selection?.text.trim() || selection.text.trim().length > 4000 || busy} onClick={() => void submit('translate')}>{vi ? 'Dịch đoạn này' : 'Translate passage'}</button><p className="reader-ai-hint">{vi ? 'Chọn tối đa 4.000 ký tự. Mỗi lần dịch dùng 1 lượt AI; không tự dịch khi chuyển trang. PDF scan cần OCR.' : 'Select up to 4,000 characters. Each translation uses 1 AI request; page changes do not trigger translation. Scanned PDFs need OCR.'}</p></div>
      <form onSubmit={event => { event.preventDefault(); void submit('question') }}>
        <label className="reader-ai-question">{vi ? 'Hỏi về nội dung này' : 'Ask about this passage'}<textarea value={question} maxLength={1000} rows={3} disabled={busy} onChange={event => setQuestion(event.target.value)} placeholder={vi ? 'Ý chính của phần này là gì?' : 'What is the main idea of this passage?'} /></label>
        <button className="reader-ai-send" type="submit" disabled={!ready || !question.trim()}><Send size={15} />{vi ? 'Gửi câu hỏi' : 'Ask question'}</button>
      </form>
      {busy && <div className="reader-ai-busy" role="status"><LoaderCircle size={17} className="spin" />{vi ? 'Đang đọc nội dung…' : 'Reading the passage…'}<button type="button" onClick={() => flight.current?.abort()}>{vi ? 'Dừng' : 'Stop'}</button></div>}
      {error && <p className="reader-ai-error" role="alert">{error}</p>}
      {result && <section className="reader-ai-result" aria-label={vi ? 'Câu trả lời AI' : 'AI answer'}>
        <p className="reader-ai-source-label">[1] {result.sourceLabel}</p>
        <div className="reader-ai-answer" lang={contentLanguage(result.answer, undefined, lang)}>{result.answer}</div>
        {result.truncated && <p>{vi ? 'Câu trả lời đã chạm giới hạn độ dài.' : 'The answer reached the output length limit.'}</p>}
        {result.locator && <button type="button" className="reader-ai-source" onClick={() => onNavigate(result.locator)}><ArrowUpRight size={16} />{vi ? 'Về vị trí nguồn [1]' : 'Return to source [1]'}</button>}
        <details><summary>{vi ? 'Xem nội dung đã gửi' : 'View submitted excerpt'}</summary><blockquote lang={contentLanguage(result.excerpt, undefined, lang)}>{result.excerpt}</blockquote>{result.sourceTruncated && <p>{vi ? 'Chỉ phần đầu trong giới hạn 20.000 ký tự được gửi.' : 'Only the first 20,000 characters were sent.'}</p>}</details>
        <p className="reader-ai-hint">{vi ? `Còn ${result.remaining} lượt theo hạn mức tài khoản hôm nay. AI có thể nhầm; hãy kiểm tra nguồn.` : `${result.remaining} account requests remaining today. AI can make mistakes; check the source.`}</p>
      </section>}
    </div>
  </aside>
}
