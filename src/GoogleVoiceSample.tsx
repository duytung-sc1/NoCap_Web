import { useEffect, useId, useLayoutEffect, useRef, useState } from 'react'
import { Play, RotateCcw } from 'lucide-react'
import type { Lang } from './i18n'
import './GoogleVoiceSample.css'

type Props = { lang: Lang; onPlayStart: () => void }
type Voice = 'Achernar'
type Status = 'idle' | 'loading' | 'playing' | 'paused' | 'ended' | 'error'
type Failure = 'load' | 'play' | 'timeout'
type Session = { dispose: () => void }
const sampleUrl = (voice: Voice) => `https://docs.cloud.google.com/static/text-to-speech/docs/audio/vi-VN-Chirp3-HD-${voice}.wav`
const LOAD_TIMEOUT = 15_000

export function GoogleVoiceSample({ lang, onPlayStart }: Props) {
  const vi = lang === 'vi'
  const text = (vietnamese: string, english: string) => vi ? vietnamese : english
  const headingId = useId()
  const host = useRef<HTMLDivElement>(null)
  const session = useRef<Session | null>(null)
  const latestOnPlayStart = useRef(onPlayStart)
  useLayoutEffect(() => { latestOnPlayStart.current = onPlayStart }, [onPlayStart])
  const [chosen, setChosen] = useState<Voice | null>(null)
  const [status, setStatus] = useState<Status>('idle')
  const [failure, setFailure] = useState<Failure>('load')

  useEffect(() => () => { session.current?.dispose() }, [])

  function start(voice: Voice) {
    if (!host.current) return
    session.current?.dispose()
    const audio = document.createElement('audio')
    audio.controls = true
    audio.preload = 'none'
    audio.setAttribute('aria-label', text(`Mẫu giọng Google: ${voice}`, `Google voice sample: ${voice}`))
    audio.src = sampleUrl(voice)
    let timer: ReturnType<typeof setTimeout> | undefined
    let notified = false
    let disposed = false
    const current = () => !disposed && session.current === next
    const clearTimer = () => { clearTimeout(timer); timer = undefined }
    const listen = (name: string, listener: () => void) => {
      audio.addEventListener(name, listener)
      return () => audio.removeEventListener(name, listener)
    }
    const next: Session = {
      dispose() {
        if (disposed) return
        disposed = true
        clearTimer()
        removeListeners.forEach(remove => remove())
        if (session.current === next) session.current = null
        audio.pause()
        audio.removeAttribute('src')
        audio.load()
        audio.remove()
      },
    }
    function fail(reason: Failure) {
      if (!current()) return
      next.dispose()
      setFailure(reason)
      setStatus('error')
    }
    function wait() {
      if (!current()) return
      clearTimer()
      setStatus('loading')
      timer = setTimeout(() => fail('timeout'), LOAD_TIMEOUT)
    }
    function notify() {
      if (!current() || notified) return
      notified = true
      latestOnPlayStart.current()
    }
    const removeListeners = [
      listen('play', () => { notify(); wait() }),
      listen('playing', () => { if (current()) { notify(); clearTimer(); setStatus('playing') } }),
      listen('waiting', wait),
      listen('pause', () => { if (current()) { clearTimer(); notified = false; setStatus('paused') } }),
      listen('ended', () => { if (current()) { clearTimer(); notified = false; setStatus('ended') } }),
      listen('error', () => fail('load')),
    ]
    session.current = next
    host.current.replaceChildren(audio)
    setChosen(voice)
    wait()
    notify()
    // Keep play() inside the original click gesture, including on mobile browsers.
    try { void audio.play()?.catch(() => fail('play')) } catch { fail('play') }
  }

  const statusText = status === 'loading' ? text('Đang tải mẫu…', 'Loading sample…')
    : status === 'playing' ? text('Đang phát mẫu.', 'Playing sample.')
      : status === 'paused' ? text('Đã tạm dừng.', 'Sample paused.')
        : status === 'ended' ? text('Đã nghe xong mẫu. Bạn có thể nghe lại.', 'Sample finished. You can replay it.')
          : ''
  return <section className="google-voice-samples" aria-labelledby={headingId}>
    <div className="google-voice-samples-heading"><strong id={headingId}>{text('Nghe mẫu giọng Achernar', 'Preview the Achernar voice')}</strong><span>{text('Mẫu Google', 'Google sample')}</span></div>
    <p className="google-voice-samples-description">{text('Mẫu tiếng Việt cố định khoảng 7–8 giây. Bấm nghe để tải âm thanh từ Google. Mẫu này chưa đọc nội dung sách và không cần API key.', 'A fixed Vietnamese sample, about 7–8 seconds. Press play to load audio from Google. This sample does not read your book and needs no API key.')}</p>
    <div className="google-voice-samples-choices">
      <button type="button" onClick={() => start('Achernar')}><Play size={14} aria-hidden="true" />{text('Nghe mẫu Achernar', 'Play Achernar sample')}</button>
    </div>
    {chosen && <p className="google-voice-samples-selected">{text('Mẫu đã chọn:', 'Selected sample:')} <strong>{chosen}</strong> · {text('Tiếng Việt', 'Vietnamese')}</p>}
    <div className="google-voice-samples-player" ref={host} hidden={!chosen || status === 'error'} />
    {statusText && <p className="google-voice-samples-status" role="status">{statusText}</p>}
    {status === 'error' && <div className="google-voice-samples-error"><p role="alert">{failure === 'timeout'
      ? text('Mẫu tải quá lâu. Kiểm tra kết nối rồi thử lại.', 'The sample took too long to load. Check your connection and retry.')
      : failure === 'play' ? text('Trình duyệt chưa phát được mẫu. Bấm Thử lại để nghe lại.', 'The browser could not play this sample. Press Retry to try again.')
        : text('Không tải được mẫu từ Google. Kiểm tra kết nối rồi thử lại.', 'The Google sample could not load. Check your connection and retry.')}</p><button type="button" onClick={() => { if (chosen) start(chosen) }}><RotateCcw size={14} aria-hidden="true" />{text('Thử lại', 'Retry')}</button></div>}
  </section>
}
