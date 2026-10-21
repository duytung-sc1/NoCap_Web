import { useEffect, useMemo, useRef, useState } from 'react'
import { Pause, Play, Square, Volume2, X } from 'lucide-react'
import type { Lang } from './i18n'
import { createReaderSpeech, localSpeechVoices, preferredSpeechVoice, voiceKey, type ReaderSpeechSource, type ReaderSpeechText, type SpeechState } from './readerSpeech'
import './ReaderSpeechPanel.css'

type Props = { lang: Lang; language?: string; source: ReaderSpeechSource | null; selection: string; scopeKey: string; onClose: () => void }
const idle: SpeechState = { status: 'idle', index: 0, total: 0, text: '' }
type Scoped<T> = { resource: object; value: T }

export function ReaderSpeechPanel({ lang, language, source, selection, scopeKey, onClose }: Props) {
  const vi = lang === 'vi', targetLanguage = language?.trim() || lang
  const text = (a: string, b: string) => vi ? a : b
  const supported = typeof window !== 'undefined' && 'speechSynthesis' in window && typeof SpeechSynthesisUtterance !== 'undefined'
  const [voices, setVoices] = useState<SpeechSynthesisVoice[]>([])
  const [chosen, setChosen] = useState(''), [rate, setRate] = useState(1)
  const [state, setState] = useState<SpeechState>(idle)
  const resource = useMemo(() => ({ source, scopeKey }), [source, scopeKey])
  const [partRecord, setPart] = useState<Scoped<ReaderSpeechText> | null>(null)
  const [flight, setFlight] = useState<Scoped<AbortController> | null>(null)
  const [issue, setError] = useState<Scoped<string> | null>(null)
  const part = partRecord?.resource === resource ? partRecord.value : null
  const loading = flight?.resource === resource && !flight.value.signal.aborted
  const error = issue?.resource === resource ? issue.value : ''
  const engine = useRef<ReturnType<typeof createReaderSpeech> | null>(null)
  const request = useRef<AbortController | null>(null)
  const currentVoice = voices.find(voice => voiceKey(voice) === chosen) ?? preferredSpeechVoice(voices, targetLanguage)
  const busy = state.status === 'speaking' || state.status === 'paused'
  useEffect(() => {
    if (!supported) return
    const synthesis = window.speechSynthesis
    const updateVoices = () => { try { setVoices(localSpeechVoices(synthesis.getVoices())) } catch { setVoices([]) } }
    const controller = createReaderSpeech(synthesis, value => new SpeechSynthesisUtterance(value), setState)
    engine.current = controller; updateVoices()
    synthesis.addEventListener('voiceschanged', updateVoices)
    return () => { request.current?.abort(); synthesis.removeEventListener('voiceschanged', updateVoices); controller.dispose(); engine.current = null }
  }, [supported])
  useEffect(() => {
    if (currentVoice) engine.current?.configure({ voice: currentVoice, rate })
  }, [currentVoice, rate])
  useEffect(() => {
    return () => { request.current?.abort(); request.current = null; engine.current?.stop() }
  }, [resource])

  function stop() { request.current?.abort(); request.current = null; setFlight(null); setError(null); setPart(null); engine.current?.stop() }
  async function start(selected: boolean) {
    if (!currentVoice || loading) return
    stop()
    const controller = new AbortController(); request.current = controller
    setFlight({ resource, value: controller })
    try {
      const next = selected ? { text: selection, label: text('Đoạn đã chọn', 'Selected passage'), truncated: false } : await source?.(controller.signal)
      if (controller.signal.aborted) return
      if (!next?.text.trim()) throw new Error('no-text')
      setPart({ resource, value: next }); engine.current?.start(next.text)
    } catch (cause) {
      if (!controller.signal.aborted) {
        const code = cause instanceof Error ? cause.message : ''
        setError({ resource, value: code === 'preparing' ? text('Trang đang được chuẩn bị. Hãy chờ nội dung hiện ra rồi thử lại.', 'The page is still loading. Wait for its content and try again.') : text('Phần này chưa có văn bản đọc được. Với PDF scan hoặc ảnh, cần nhận dạng chữ (OCR) trước.', 'No readable text is available here. Scanned PDFs and images need text recognition (OCR) first.') })
      }
    } finally { if (request.current === controller) { setFlight(null); request.current = null } }
  }
  const languageAvailable = voices.some(voice => voice.lang.toLowerCase().split('-')[0] === targetLanguage.toLowerCase().split('-')[0])
  return <section id="reader-speech-panel" className="reader-speech-panel" aria-label={text('Đọc thành tiếng', 'Read aloud')}>
    <div className="reader-speech-heading"><strong><Volume2 size={17} aria-hidden="true" />{text('Đọc thành tiếng', 'Read aloud')}<span>{text('Bản thử', 'Preview')}</span></strong><button type="button" className="icon-button" aria-label={text('Đóng bảng giọng đọc', 'Close read aloud')} onClick={onClose}><X size={18} /></button></div>
    <p className="reader-speech-hint">{text('Dùng giọng cục bộ có sẵn trên thiết bị. NoCap không gửi nội dung sang dịch vụ tạo giọng và không phát sinh phí API.', 'Uses local voices available on this device. NoCap does not send the text to a speech service or incur speech API charges.')}</p>
    {!supported ? <p role="status">{text('Trình duyệt này chưa hỗ trợ đọc thành tiếng. Hãy thử trình duyệt khác trên máy tính.', 'This browser does not support read aloud. Try another desktop browser.')}</p> : <>
      {!voices.length && <p role="status">{text('Chưa tìm thấy giọng đọc cục bộ. Hãy cài giọng đọc trong cài đặt ngôn ngữ của hệ điều hành, rồi tải lại trang.', 'No local voice was found. Install a voice in your operating system language settings, then reload this page.')}</p>}
      {voices.length > 0 && !languageAvailable && <p className="reader-speech-hint">{text('Thiết bị chưa có giọng cục bộ khớp ngôn ngữ tài liệu. Bạn có thể chọn giọng có sẵn bên dưới.', 'No local voice matches the document language. You can choose an available voice below.')}</p>}
      <div className="reader-speech-controls"><label>{text('Giọng đọc', 'Voice')}<select value={currentVoice ? voiceKey(currentVoice) : ''} disabled={!voices.length || loading} onChange={event => setChosen(event.target.value)}>{!voices.length && <option value="">{text('Chưa có giọng', 'No voices')}</option>}{voices.map(voice => <option value={voiceKey(voice)} key={voiceKey(voice)}>{voice.name} · {voice.lang}</option>)}</select></label>
        <label>{text('Tốc độ', 'Speed')}<select value={rate} onChange={event => setRate(Number(event.target.value))}>{[0.75, 1, 1.25, 1.5, 1.75, 2].map(value => <option key={value} value={value}>{value}×</option>)}</select></label>
        <div className="reader-speech-buttons"><button type="button" disabled={!currentVoice || !source || loading} onClick={() => void start(false)}><Play size={15} aria-hidden="true" />{text('Nghe phần hiện tại', 'Read current section')}</button><button type="button" disabled={!currentVoice || !selection.trim() || loading} onClick={() => void start(true)}>{text('Nghe đoạn đã chọn', 'Read selection')}</button>
          {busy && <button type="button" onClick={() => state.status === 'paused' ? engine.current?.resume() : engine.current?.pause()}>{state.status === 'paused' ? <Play size={15} /> : <Pause size={15} />}{state.status === 'paused' ? text('Tiếp tục', 'Resume') : text('Tạm dừng', 'Pause')}</button>}
          <button type="button" disabled={!busy && !loading && state.status !== 'error'} onClick={stop}><Square size={14} aria-hidden="true" />{text('Dừng', 'Stop')}</button></div></div>
      {loading && <p role="status">{text('Đang lấy văn bản phần hiện tại…', 'Preparing the current text…')}</p>}
      {(error || state.status === 'error') && <p className="reader-speech-error" role="alert">{error || text('Chưa phát được giọng đọc. Hãy bấm nghe lại hoặc chọn giọng cục bộ khác.', 'Speech could not start. Try playing again or choose another local voice.')}</p>}
      {part && busy && <div className="reader-speech-progress"><p role="status">{state.status === 'paused' ? text('Đã tạm dừng', 'Paused') : text('Đang đọc', 'Reading')} · {part.label || text('Phần hiện tại', 'Current section')} · {Math.min(state.index + 1, state.total)} / {state.total}</p><p className="reader-speech-snippet">{state.text}</p></div>}
      {state.status === 'finished' && <p role="status">{text('Đã đọc xong phần này.', 'Finished reading this section.')}</p>}
      {part?.truncated && <p className="reader-speech-hint">{text('Bản thử đọc tối đa 20.000 ký tự mỗi lượt. Bạn có thể cuộn đến phần tiếp theo rồi bấm nghe lại.', 'Preview reads up to 20,000 characters per run. Scroll to the next part and start reading again.')}</p>}
      <p className="reader-speech-hint">{text('Đọc từ đoạn đang thấy đến hết phần hiện tại; không tự lật trang. Đổi trang PDF, đổi chương hoặc đóng bảng sẽ dừng giọng đọc. Giọng/tốc độ mới áp dụng từ đoạn tiếp theo.', 'Reads from the visible passage to the end of this section; pages do not turn automatically. Changing PDF pages, chapters or closing this panel stops speech. Voice/speed changes apply from the next passage.')}</p>
    </>}
  </section>
}
