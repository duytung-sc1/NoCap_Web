import { useEffect, useRef, useState } from 'react'
import { Languages, LoaderCircle, X } from 'lucide-react'
import type { Lang } from './i18n'
import { contentLanguage } from './typography'
import './ReaderAiPanel.css'

const languages = { vi: 'Tiếng Việt', en: 'English', ja: '日本語', ko: '한국어', zh: '简体中文', fr: 'Français' }
type TranslationLanguage = keyof typeof languages
type BrowserTranslator = {
  create(options: { sourceLanguage: string; targetLanguage: string; signal: AbortSignal }): Promise<{
    translate(text: string, options: { signal: AbortSignal }): Promise<string>
  }>
}

const passageLimit = 4000

export function ReaderTranslationPanel({ lang, bookLanguage, selection, onClose }: {
  lang: Lang
  bookLanguage?: string
  selection: string
  onClose: () => void
}) {
  const vi = lang === 'vi'
  const text = selection.trim()
  const declared = bookLanguage?.trim().toLowerCase().split(/[-_]/)[0]
  const initialSource = declared && Object.hasOwn(languages, declared) ? declared as TranslationLanguage : (vi ? 'en' : 'vi')
  const [sourceLanguage, setSourceLanguage] = useState(initialSource)
  const [targetLanguage, setTargetLanguage] = useState<TranslationLanguage>(initialSource === lang ? (vi ? 'en' : 'vi') : lang)
  const [busy, setBusy] = useState(false)
  const [error, setError] = useState('')
  const [copyStatus, setCopyStatus] = useState('')
  const [result, setResult] = useState<{ original: string; translated: string } | null>(null)
  const flight = useRef<AbortController | null>(null)
  const translator = (globalThis as { Translator?: BrowserTranslator }).Translator
  const canTranslate = !!text && text.length <= passageLimit

  useEffect(() => () => {
    flight.current?.abort()
    flight.current = null
  }, [])

  async function translateSelection() {
    if (!translator || !canTranslate || sourceLanguage === targetLanguage || flight.current) return
    const controller = new AbortController()
    flight.current = controller
    setBusy(true)
    setError('')
    setResult(null)
    try {
      const engine = await translator.create({ sourceLanguage, targetLanguage, signal: controller.signal })
      const translated = await engine.translate(text, { signal: controller.signal })
      if (!controller.signal.aborted) setResult({ original: text, translated })
    } catch {
      if (!controller.signal.aborted) setError(vi
        ? 'Chưa dịch được trên thiết bị. Hãy thử lại hoặc mở Google Dịch.'
        : 'On-device translation failed. Try again or open Google Translate.')
    } finally {
      controller.abort()
      if (flight.current === controller) {
        flight.current = null
        setBusy(false)
      }
    }
  }

  async function copySelection() {
    try {
      await navigator.clipboard.writeText(text)
      setCopyStatus(vi ? 'Đã sao chép.' : 'Copied.')
    } catch {
      setCopyStatus(vi ? 'Hãy chọn và sao chép đoạn gốc thủ công.' : 'Select and copy the original passage manually.')
    }
  }

  const options = Object.entries(languages).map(([language, name]) => <option key={language} value={language} lang={language}>{name}</option>)
  const title = vi ? 'Dịch đoạn' : 'Translate passage'
  return <aside id="reader-translation-panel" className="reader-ai-panel" lang={lang} aria-label={title}>
    <header className="reader-ai-heading">
      <div><h2><Languages size={20} aria-hidden="true" />{title}</h2></div>
      <button type="button" className="reader-ai-close" onClick={onClose} aria-label={vi ? 'Đóng bảng dịch' : 'Close translation panel'}><X size={19} /></button>
    </header>
    <div className="reader-ai-content">
      {text ? <blockquote lang={contentLanguage(text, bookLanguage, lang)} className="reader-ai-selection">{text}</blockquote>
        : <p className="reader-ai-hint">{vi ? 'Bôi chọn một đoạn trong sách để dịch. PDF chỉ có ảnh cần nhận dạng chữ trước.' : 'Select some text in the book to translate. Image-only PDFs need text recognition first.'}</p>}
      {text.length > passageLimit && <p role="status">{vi ? 'Hãy chọn đoạn không quá 4.000 ký tự.' : 'Select a passage of up to 4,000 characters.'}</p>}
      {translator && <form className="reader-translation-controls" onSubmit={event => { event.preventDefault(); void translateSelection() }}>
        <label>{vi ? 'Ngôn ngữ gốc' : 'Source language'}
          <select value={sourceLanguage} disabled={busy} onChange={event => { setSourceLanguage(event.target.value as TranslationLanguage); setResult(null); setError('') }}>{options}</select>
        </label>
        <label>{vi ? 'Dịch sang' : 'Translate to'}
          <select value={targetLanguage} disabled={busy} onChange={event => { setTargetLanguage(event.target.value as TranslationLanguage); setResult(null); setError('') }}>{options}</select>
        </label>
        {sourceLanguage === targetLanguage && <p className="reader-ai-hint">{vi ? 'Chọn hai ngôn ngữ khác nhau.' : 'Choose two different languages.'}</p>}
        <button type="submit" disabled={!canTranslate || busy || sourceLanguage === targetLanguage}>{vi ? 'Dịch trên thiết bị' : 'Translate on this device'}</button>
        <p className="reader-ai-hint">{vi ? 'Nội dung được dịch trên thiết bị. Lần đầu có thể cần tải gói ngôn ngữ.' : 'Text is translated on this device. The first use may require a language pack download.'}</p>
      </form>}
      {busy && <div className="reader-ai-busy" role="status"><LoaderCircle size={17} className="spin" />{vi ? 'Đang chuẩn bị bản dịch…' : 'Preparing your translation…'}<button type="button" onClick={() => flight.current?.abort()}>{vi ? 'Dừng' : 'Stop'}</button></div>}
      {error && <p className="reader-ai-error" role="alert">{error}</p>}
      {result?.original === text && <section className="reader-ai-result" aria-label={vi ? 'Bản dịch' : 'Translation'}>
        <div className="reader-ai-answer" lang={targetLanguage}>{result.translated}</div>
      </section>}
      {(!translator || error) && <div className="reader-translation-controls">
        {!translator && <p className="reader-ai-hint">{vi ? 'Trình duyệt này chưa hỗ trợ dịch trong NoCap. Sao chép đoạn đã chọn rồi dán vào Google Dịch.' : 'This browser cannot translate inside NoCap. Copy the selection, then paste it into Google Translate.'}</p>}
        <button type="button" disabled={!canTranslate} onClick={() => void copySelection()}>{vi ? 'Sao chép đoạn đã chọn' : 'Copy selection'}</button>
        <a href="https://translate.google.com/" target="_blank" rel="noopener noreferrer">{vi ? 'Mở Google Dịch' : 'Open Google Translate'}</a>
        {copyStatus && <p className="reader-ai-hint" role="status">{copyStatus}</p>}
      </div>}
    </div>
  </aside>
}
