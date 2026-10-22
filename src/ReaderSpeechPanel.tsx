import { useEffect, useMemo, useRef, useState } from 'react'
import { Pause, Play, Square, Volume2, X } from 'lucide-react'
import type { Lang } from './i18n'
import { createReaderSpeech, onlineVoiceProvider, preferredSpeechVoice, speechLanguage, speechVoiceSample, speechVoices, vietnameseFemaleVoice, vietnameseVoiceGender, voiceKey, type ReaderSpeechSource, type ReaderSpeechText, type SpeechState } from './readerSpeech'
import './ReaderSpeechPanel.css'

type Props = { lang: Lang; language?: string; source: ReaderSpeechSource | null; selection: string; scopeKey: string; onClose: () => void }
const idle: SpeechState = { status: 'idle', index: 0, total: 0, text: '' }
type Scoped<T> = { resource: object; value: T }

export function ReaderSpeechPanel({ lang, language, source, selection, scopeKey, onClose }: Props) {
  const vi = lang === 'vi', targetLanguage = language?.trim() || lang
  const text = (a: string, b: string) => vi ? a : b
  const supported = typeof window !== 'undefined' && 'speechSynthesis' in window && typeof SpeechSynthesisUtterance !== 'undefined'
  const [discovered, setDiscovered] = useState<SpeechSynthesisVoice[]>([])
  const [allowOnline, setAllowOnline] = useState(false)
  const voices = useMemo(() => speechVoices(discovered, allowOnline), [discovered, allowOnline])
  const [chosen, setChosen] = useState('')
  const [delivery, setDelivery] = useState<'natural' | 'gentle'>(() => speechLanguage(targetLanguage) === 'vi' ? 'gentle' : 'natural')
  const [rate, setRate] = useState(() => speechLanguage(targetLanguage) === 'vi' ? 0.9 : 1)
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
  const currentVoice = voices.find(voice => voiceKey(voice) === chosen) ?? preferredSpeechVoice(voices, targetLanguage, allowOnline)
  const provider = currentVoice ? onlineVoiceProvider(currentVoice) : null
  const femaleVoice = vietnameseFemaleVoice(voices, allowOnline)
  const hasOnline = speechVoices(discovered, true).some(voice => onlineVoiceProvider(voice))
  const vietnameseAvailable = voices.some(voice => speechLanguage(voice.lang) === 'vi')
  const busy = state.status === 'speaking' || state.status === 'paused'
  useEffect(() => {
    if (!supported) return
    const synthesis = window.speechSynthesis
    const updateVoices = () => { try { setDiscovered([...synthesis.getVoices()]) } catch { setDiscovered([]) } }
    const controller = createReaderSpeech(synthesis, value => new SpeechSynthesisUtterance(value), setState)
    engine.current = controller; updateVoices()
    synthesis.addEventListener('voiceschanged', updateVoices)
    return () => { request.current?.abort(); synthesis.removeEventListener('voiceschanged', updateVoices); controller.dispose(); engine.current = null }
  }, [supported])
  useEffect(() => {
    if (currentVoice) engine.current?.configure({ voice: currentVoice, rate, pauseMs: delivery === 'gentle' ? 100 : 0, allowOnline })
  }, [currentVoice, rate, delivery, allowOnline])
  useEffect(() => {
    return () => { request.current?.abort(); request.current = null; engine.current?.stop() }
  }, [resource])

  function stop() { request.current?.abort(); request.current = null; setFlight(null); setError(null); setPart(null); engine.current?.stop() }
  async function start(mode: 'section' | 'selection' | 'sample') {
    if (!currentVoice || loading) return
    stop()
    const controller = new AbortController(); request.current = controller
    setFlight({ resource, value: controller })
    try {
      const next = mode === 'sample' ? { text: speechVoiceSample(currentVoice.lang), label: text('Nghe thử giọng', 'Voice sample'), truncated: false }
        : mode === 'selection' ? { text: selection, label: text('Đoạn đã chọn', 'Selected passage'), truncated: false } : await source?.(controller.signal)
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
  const languageAvailable = voices.some(voice => speechLanguage(voice.lang) === speechLanguage(targetLanguage))
  return <section id="reader-speech-panel" className="reader-speech-panel" aria-label={text('Đọc thành tiếng', 'Read aloud')}>
    <div className="reader-speech-heading"><strong><Volume2 size={17} aria-hidden="true" />{text('Đọc thành tiếng', 'Read aloud')}<span>{text('Bản thử', 'Preview')}</span></strong><button type="button" className="icon-button" aria-label={text('Đóng bảng giọng đọc', 'Close read aloud')} onClick={onClose}><X size={18} /></button></div>
    <p className="reader-speech-hint">{provider ? text(`Đang dùng giọng trực tuyến của ${provider}. Trình duyệt chuyển văn bản được đọc tới dịch vụ này để tạo âm thanh. NoCap không cấu hình API trả phí.`, `Using an online ${provider} voice. Your browser sends the text being read to this service to generate audio. NoCap does not configure a paid speech API.`)
      : text('Đang dùng giọng cục bộ trên thiết bị. Nội dung đọc không được gửi tới dịch vụ tạo giọng trực tuyến.', 'Using a local voice on this device. The text is not sent to an online speech service.')}</p>
    {!supported ? <p role="status">{text('Trình duyệt này chưa hỗ trợ đọc thành tiếng. Hãy thử trình duyệt khác trên máy tính.', 'This browser does not support read aloud. Try another desktop browser.')}</p> : <>
      <label className="reader-speech-online"><input type="checkbox" checked={allowOnline} onChange={event => { stop(); setChosen(''); setAllowOnline(event.target.checked) }} />{text('Cho phép giọng Google/Microsoft trực tuyến', 'Allow Google/Microsoft online voices')}</label>
      <p className="reader-speech-hint">{text('Khi chọn giọng trực tuyến, văn bản được đọc có thể được gửi tới Google hoặc Microsoft. Tắt mục này để chỉ dùng giọng cục bộ. Không cần nhập API key.', 'When an online voice is selected, the text being read may be sent to Google or Microsoft. Turn this off to use only local voices. No API key is required.')}</p>
      {allowOnline && !hasOnline && <p className="reader-speech-availability" role="status">{text('Trình duyệt này chưa cung cấp giọng trực tuyến phù hợp. Bạn có thể thử trên Edge hoặc Chrome; nếu không có, NoCap vẫn dùng giọng trên máy.', 'This browser is not offering a supported online voice. You can try Edge or Chrome; local voices remain available as a fallback.')}</p>}
      {!voices.length && <p role="status">{text('Chưa tìm thấy giọng đọc phù hợp. Hãy cài giọng trong cài đặt ngôn ngữ của hệ điều hành hoặc thử trình duyệt khác, rồi tải lại trang.', 'No supported voice was found. Install a voice in your operating system language settings or try another browser, then reload this page.')}</p>}
      {voices.length > 0 && !languageAvailable && <p className="reader-speech-hint">{allowOnline ? text('Chưa có giọng khớp ngôn ngữ tài liệu. Bạn có thể chọn giọng có sẵn bên dưới.', 'No available voice matches the document language. You can choose an available voice below.') : text('Thiết bị chưa có giọng cục bộ khớp ngôn ngữ tài liệu. Bạn có thể chọn giọng có sẵn bên dưới.', 'No local voice matches the document language. You can choose an available voice below.')}</p>}
      <div className="reader-speech-presets"><button type="button" disabled={!femaleVoice || loading} onClick={() => { if (femaleVoice) { setChosen(voiceKey(femaleVoice)); setDelivery('gentle'); setRate(0.9) } }}>{text('Nữ Việt · nhẹ nhàng', 'Vietnamese female · gentle')}</button>
        <span>{femaleVoice ? text(`Giọng có thể dùng: ${femaleVoice.name}. Bấm để chọn ở tốc độ 0.9×.`, `Available voice: ${femaleVoice.name}. Select it at 0.9× speed.`)
          : vietnameseAvailable ? text('Chưa nhận diện được giọng nữ Việt trong các giọng được phép dùng. Bạn vẫn có thể thử kiểu Nhẹ nhàng với giọng tiếng Việt hiện có.', 'No Vietnamese female voice could be identified among the allowed voices. You can still try Gentle delivery with an available Vietnamese voice.')
            : text('Chưa có giọng tiếng Việt trong các giọng được phép dùng.', 'No Vietnamese voice is available among the allowed voices.')}</span></div>
      <div className="reader-speech-controls"><label>{text('Giọng đọc', 'Voice')}<select value={currentVoice ? voiceKey(currentVoice) : ''} disabled={!voices.length || loading} onChange={event => setChosen(event.target.value)}>{!voices.length && <option value="">{text('Chưa có giọng', 'No voices')}</option>}{voices.map(voice => <option value={voiceKey(voice)} key={voiceKey(voice)}>{voice.name} · {voice.lang}{vietnameseVoiceGender(voice) === 'female' ? text(' · Nữ Việt', ' · Vietnamese female') : vietnameseVoiceGender(voice) === 'male' ? text(' · Nam Việt', ' · Vietnamese male') : ''}{onlineVoiceProvider(voice) ? text(` · Trực tuyến ${onlineVoiceProvider(voice)}`, ` · Online ${onlineVoiceProvider(voice)}`) : ''}</option>)}</select></label>
        <label>{text('Kiểu đọc', 'Delivery')}<select value={delivery} onChange={event => { const next = event.target.value as 'natural' | 'gentle'; setDelivery(next); setRate(next === 'gentle' ? 0.9 : 1) }}><option value="natural">{text('Tự nhiên', 'Natural')}</option><option value="gentle">{text('Nhẹ nhàng', 'Gentle')}</option></select></label>
        <label>{text('Tốc độ', 'Speed')}<select value={rate} onChange={event => setRate(Number(event.target.value))}>{[0.75, 0.9, 1, 1.25, 1.5, 1.75, 2].map(value => <option key={value} value={value}>{value}×</option>)}</select></label>
        <div className="reader-speech-buttons"><button type="button" disabled={!currentVoice || loading} onClick={() => void start('sample')}><Volume2 size={15} aria-hidden="true" />{text('Nghe thử giọng', 'Preview voice')}</button><button type="button" disabled={!currentVoice || !source || loading} onClick={() => void start('section')}><Play size={15} aria-hidden="true" />{text('Nghe phần hiện tại', 'Read current section')}</button><button type="button" disabled={!currentVoice || !selection.trim() || loading} onClick={() => void start('selection')}>{text('Nghe đoạn đã chọn', 'Read selection')}</button>
          {busy && <button type="button" onClick={() => state.status === 'paused' ? engine.current?.resume() : engine.current?.pause()}>{state.status === 'paused' ? <Play size={15} /> : <Pause size={15} />}{state.status === 'paused' ? text('Tiếp tục', 'Resume') : text('Tạm dừng', 'Pause')}</button>}
          <button type="button" disabled={!busy && !loading && state.status !== 'error'} onClick={stop}><Square size={14} aria-hidden="true" />{text('Dừng', 'Stop')}</button></div></div>
      {loading && <p role="status">{text('Đang lấy văn bản phần hiện tại…', 'Preparing the current text…')}</p>}
      {(error || state.status === 'error') && <p className="reader-speech-error" role="alert">{error || text('Chưa phát được giọng đọc. Hãy bấm nghe lại hoặc chọn giọng khác; giọng trực tuyến cần kết nối mạng.', 'Speech could not start. Try playing again or choose another voice; online voices need an internet connection.')}</p>}
      {part && busy && <div className="reader-speech-progress"><p role="status">{state.status === 'paused' ? text('Đã tạm dừng', 'Paused') : text('Đang đọc', 'Reading')} · {part.label || text('Phần hiện tại', 'Current section')} · {Math.min(state.index + 1, state.total)} / {state.total}</p><p className="reader-speech-snippet">{state.text}</p></div>}
      {state.status === 'finished' && <p role="status">{text('Đã đọc xong phần này.', 'Finished reading this section.')}</p>}
      {part?.truncated && <p className="reader-speech-hint">{text('Bản thử đọc tối đa 20.000 ký tự mỗi lượt. Bạn có thể cuộn đến phần tiếp theo rồi bấm nghe lại.', 'Preview reads up to 20,000 characters per run. Scroll to the next part and start reading again.')}</p>}
      <p className="reader-speech-hint">{text('Văn bản được gom theo câu và đoạn, không theo dòng hiển thị. Kiểu Nhẹ nhàng đặt tốc độ 0.9× và chỉ thêm nghỉ ngắn ở cuối đoạn hoàn chỉnh; kiểu Tự nhiên không thêm khoảng nghỉ.', 'Text is grouped by sentences and paragraphs, not visual lines. Gentle delivery sets 0.9× speed and adds a short pause only after completed paragraphs; Natural adds no extra pauses.')}</p>
      <p className="reader-speech-hint">{text('Đọc từ đoạn đang thấy đến hết phần hiện tại; không tự lật trang. Đổi trang PDF, đổi chương hoặc đóng bảng sẽ dừng giọng đọc. Giọng/tốc độ/kiểu đọc mới áp dụng từ đoạn tiếp theo.', 'Reads from the visible passage to the end of this section; pages do not turn automatically. Changing PDF pages, chapters or closing this panel stops speech. Voice/speed/delivery changes apply from the next passage.')}</p>
    </>}
  </section>
}
