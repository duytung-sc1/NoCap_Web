import { useEffect, useRef, useState } from 'react'
import { Download, FileUp, Link, X } from 'lucide-react'
import type { Lang } from './i18n'
import { downloadHttpsPublication, httpsImportMessage, type ImportProgress } from './httpsImport'
import { HttpsImportError, publicationSource } from '../shared/httpsPublication'

export function ImportDocumentDialog({ lang, onClose, onPickFile, onImport }: {
  lang: Lang; onClose: () => void; onPickFile: () => void
  onImport: (file: File, sourceUrl: string) => Promise<boolean>
}) {
  const vi = lang === 'vi'
  const [fromUrl, setFromUrl] = useState(false)
  const [url, setUrl] = useState('')
  const [phase, setPhase] = useState<'idle' | 'download' | 'save'>('idle')
  const [progress, setProgress] = useState<ImportProgress>({ received: 0 })
  const [error, setError] = useState('')
  const active = useRef<AbortController | null>(null)
  const dialog = useRef<HTMLDivElement>(null)
  const mounted = useRef(true)
  useEffect(() => {
    mounted.current = true
    const previous = document.activeElement as HTMLElement | null
    return () => { mounted.current = false; active.current?.abort(); previous?.focus() }
  }, [])
  const close = () => {
    if (phase === 'save') return
    active.current?.abort()
    onClose()
  }
  const submit = async () => {
    if (active.current) return
    const controller = new AbortController()
    active.current = controller
    setError('')
    setProgress({ received: 0 })
    setPhase('download')
    try {
      const file = await downloadHttpsPublication(url, { signal: controller.signal, onProgress: setProgress })
      controller.signal.throwIfAborted()
      if (!mounted.current) return
      setPhase('save')
      if (!await onImport(file, publicationSource(url))) throw new HttpsImportError('SAVE_FAILED')
      if (mounted.current) onClose()
    } catch (failure) {
      if (!controller.signal.aborted && mounted.current) setError(httpsImportMessage(failure, lang))
    } finally {
      active.current = null
      if (mounted.current) setPhase('idle')
    }
  }
  const busy = phase !== 'idle'
  return <div className="modal-shade import-document-shade" onKeyDown={event => {
    if (event.key === 'Escape') { event.preventDefault(); event.stopPropagation(); close() }
    if (event.key === 'F2') { event.preventDefault(); event.stopPropagation() }
    if (event.key === 'Tab') {
      const controls = Array.from(dialog.current?.querySelectorAll<HTMLElement>('button:not(:disabled), input:not(:disabled), a[href]') || [])
      const target = event.shiftKey ? controls.at(-1) : controls[0]
      if (document.activeElement === (event.shiftKey ? controls[0] : controls.at(-1))) { event.preventDefault(); target?.focus() }
    }
  }}><div ref={dialog} className="dialog import-document-dialog" role="dialog" aria-modal="true" aria-labelledby="import-document-title">
    <button className="icon-button dialog-close" onClick={close} disabled={phase === 'save'} aria-label={vi ? 'Đóng' : 'Close'}><X size={19} /></button>
    <p className="eyebrow">NOCAP</p>
    <h2 id="import-document-title">{vi ? 'Thêm tài liệu' : 'Import document'}</h2>
    {!fromUrl ? <>
      <p>{vi ? 'Chọn tệp trên máy hoặc tải tài liệu từ liên kết HTTPS.' : 'Choose a file on your device or download a document from an HTTPS link.'}</p>
      <div className="import-source-options">
        <button className="import-source-option" onClick={() => { onClose(); onPickFile() }} autoFocus><FileUp size={23} /><span><strong>{vi ? 'Từ thiết bị' : 'From device'}</strong><small>{vi ? 'Chọn tệp có sẵn trên máy.' : 'Choose an existing file.'}</small></span></button>
        <button className="import-source-option" onClick={() => setFromUrl(true)}><Link size={23} /><span><strong>{vi ? 'Từ liên kết HTTPS' : 'From HTTPS link'}</strong><small>{vi ? 'Tải tệp hoặc lưu nội dung bài viết.' : 'Download a file or save a readable article.'}</small></span></button>
      </div>
      <p className="import-help">EPUB, PDF, CBZ, DOCX, TXT, Markdown, HTML, JPG, PNG, WebP · {vi ? 'Tối đa 250 MB' : 'Up to 250 MB'}</p>
    </> : <form onSubmit={event => { event.preventDefault(); void submit() }}>
      <p>{vi ? 'Dùng link tải công khai, không yêu cầu đăng nhập. Với trang web, NoCap chỉ giữ nội dung bài viết và bỏ menu, quảng cáo, liên kết.' : 'Use a public link that does not require signing in. For web pages, NoCap keeps the article and removes menus, ads and links.'}</p>
      <label htmlFor="https-import-url">{vi ? 'Liên kết HTTPS' : 'HTTPS link'}</label>
      <input id="https-import-url" type="url" value={url} onChange={event => { setUrl(event.target.value); setError('') }} placeholder="https://example.com/document.pdf" required maxLength={8192} disabled={busy} autoFocus autoComplete="off" autoCapitalize="none" spellCheck={false} aria-describedby="https-import-help" />
      <p id="https-import-help" className="import-help">{vi ? 'Tối đa 250 MB. Tài liệu sẽ được thêm vào tủ sách của bạn; không cần Pro.' : 'Up to 250 MB. The document is added to your library; Pro is not required.'}</p>
      {busy && <div className="import-progress" role="status" aria-live="polite">
        <span>{phase === 'save' ? (vi ? 'Đang lưu tài liệu…' : 'Saving document…') : (vi ? 'Đang tải tài liệu…' : 'Downloading document…')}</span>
        {phase === 'download' && <><progress max={progress.total || 1} value={progress.total ? Math.min(progress.received, progress.total) : undefined} aria-label={vi ? 'Tiến độ tải' : 'Download progress'} /><small>{(progress.received / 1024 / 1024).toFixed(1)} MB{progress.total ? ` / ${(progress.total / 1024 / 1024).toFixed(1)} MB` : ''}</small></>}
      </div>}
      {error && <p role="alert" className="form-message">{error}</p>}
      <div className="dialog-actions"><button type="button" className="secondary" onClick={() => { if (busy) close(); else { setFromUrl(false); setError('') } }} disabled={phase === 'save'}>{phase === 'download' ? (vi ? 'Hủy tải' : 'Cancel download') : (vi ? 'Quay lại' : 'Back')}</button><button className="primary" disabled={busy || !url.trim()}><Download size={16} />{busy ? (vi ? 'Đang xử lý…' : 'Working…') : (vi ? 'Tải và thêm vào tủ sách' : 'Download and add to library')}</button></div>
    </form>}
  </div></div>
}
