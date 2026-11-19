import { AlertCircle, ArrowRight, CheckCircle2, LoaderCircle, RotateCcw, X } from 'lucide-react'
import type { Lang } from './i18n'
import { contentLanguage } from './typography'
import './ImportFeedback.css'

export type ImportFeedbackStatus = 'preparing' | 'saving' | 'success' | 'error'

export type ImportFeedbackProps = {
  lang: Lang
  status: ImportFeedbackStatus
  title: string
  destinationPath: string
  message?: string
  onOpen?: () => void
  onRetry?: () => void
  onDismiss?: () => void
}

export function ImportFeedback({
  lang, status, title, destinationPath, message, onOpen, onRetry, onDismiss,
}: ImportFeedbackProps) {
  const vi = lang === 'vi'
  const busy = status === 'preparing' || status === 'saving'
  const headings = vi ? {
    preparing: 'Đang chuẩn bị tài liệu…', saving: 'Đang lưu tài liệu…',
    success: 'Đã thêm tài liệu', error: 'Chưa thêm được tài liệu',
  } : {
    preparing: 'Preparing document…', saving: 'Saving document…',
    success: 'Document added', error: 'Could not add document',
  }

  return <section className="import-feedback" data-status={status} lang={lang}
    role={status === 'error' ? 'alert' : 'status'} aria-live={status === 'error' ? 'assertive' : 'polite'} aria-atomic="true">
    <div className="import-feedback-icon" aria-hidden="true">
      {busy ? <LoaderCircle size={21} className="spin" />
        : status === 'error' ? <AlertCircle size={21} /> : <CheckCircle2 size={21} />}
    </div>
    <div className="import-feedback-content">
      <h3>{headings[status]}</h3>
      <strong className="import-feedback-title" lang={contentLanguage(title, undefined, lang)}>{title}</strong>
      <p className="import-feedback-destination">
        <span>{vi ? 'Thư mục' : 'Folder'}</span>
        <span lang={contentLanguage(destinationPath, undefined, lang)}>{destinationPath}</span>
      </p>
      {message && <p className="import-feedback-message" lang={contentLanguage(message, undefined, lang)}>{message}</p>}
      {(status === 'success' && onOpen || status === 'error' && onRetry) && <div className="import-feedback-actions">
        {status === 'success' && onOpen && <button type="button" className="import-feedback-open" onClick={onOpen}>
          {vi ? 'Mở đọc' : 'Open to read'}<ArrowRight size={16} aria-hidden="true" />
        </button>}
        {status === 'error' && onRetry && <button type="button" className="import-feedback-retry" onClick={onRetry}>
          <RotateCcw size={16} aria-hidden="true" />{vi ? 'Thêm lại' : 'Try again'}
        </button>}
      </div>}
    </div>
    {!busy && onDismiss && <button type="button" className="import-feedback-dismiss" onClick={onDismiss}
      aria-label={vi ? 'Đóng kết quả nhập tài liệu' : 'Dismiss import result'}><X size={18} aria-hidden="true" /></button>}
  </section>
}
