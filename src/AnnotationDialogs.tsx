import { useState } from 'react'
import { X } from 'lucide-react'
import { highlightColors, type HighlightColor } from './annotations'
import type { SyncRecord } from './types'
import type { Lang } from './i18n'

export function AnnotationEditor({ record, lang, busy, error, onClose, onSave }: {
  record: SyncRecord; lang: Lang; busy: boolean; error: string
  onClose: () => void; onSave: (changes: { note: string; color: HighlightColor }) => void
}) {
  const [note, setNote] = useState(String(record.payload.note || ''))
  const [color, setColor] = useState<HighlightColor>(highlightColors.includes(record.payload.color as HighlightColor) ? record.payload.color as HighlightColor : 'YELLOW')
  const vi = lang === 'vi'
  const names = vi ? ['Vàng', 'Xanh lá', 'Xanh dương', 'Hồng', 'Tím'] : ['Yellow', 'Green', 'Blue', 'Pink', 'Purple']
  return <div className="modal-shade"><form className="dialog annotation-dialog" role="dialog" aria-modal="true" aria-labelledby="annotation-editor-title" onSubmit={event => { event.preventDefault(); onSave({ note, color }) }}>
    <button type="button" className="icon-button dialog-close" onClick={onClose} disabled={busy} aria-label={vi ? 'Đóng' : 'Close'}><X size={19} /></button>
    <h2 id="annotation-editor-title">{vi ? 'Sửa highlight và ghi chú' : 'Edit highlight and note'}</h2>
    <blockquote className="selection-preview">{String(record.payload.text || '')}</blockquote>
    <fieldset className="color-selector"><legend>{vi ? 'Màu highlight' : 'Highlight color'}</legend>{highlightColors.map((value, index) => <button key={value} type="button" className={`color-dot ${value.toLowerCase()} ${color === value ? 'active' : ''}`} onClick={() => setColor(value)} disabled={busy} aria-label={names[index]} aria-pressed={color === value} />)}</fieldset>
    <label htmlFor="annotation-edit-note">{vi ? 'Ghi chú của bạn' : 'Your note'}</label>
    <textarea id="annotation-edit-note" value={note} onChange={event => setNote(event.target.value)} maxLength={10000} rows={5} disabled={busy} autoFocus />
    {error && <p role="alert" className="form-message">{error}</p>}
    <div className="dialog-actions"><button type="button" className="secondary" onClick={onClose} disabled={busy}>{vi ? 'Hủy' : 'Cancel'}</button><button className="primary" disabled={busy}>{busy ? (vi ? 'Đang lưu…' : 'Saving…') : (vi ? 'Lưu thay đổi' : 'Save changes')}</button></div>
  </form></div>
}

export function AnnotationDeleteDialog({ record, lang, busy, error, onClose, onDelete }: {
  record: SyncRecord; lang: Lang; busy: boolean; error: string; onClose: () => void; onDelete: () => void
}) {
  const vi = lang === 'vi'
  return <div className="modal-shade"><div className="dialog annotation-dialog" role="dialog" aria-modal="true" aria-labelledby="annotation-delete-title">
    <h2 id="annotation-delete-title">{record.kind === 'bookmarks' ? (vi ? 'Xóa dấu trang?' : 'Delete bookmark?') : (vi ? 'Xóa highlight và ghi chú?' : 'Delete highlight and note?')}</h2>
    <blockquote className="selection-preview">{String(record.payload.text || record.payload.chapter_title || '')}</blockquote>
    <p>{vi ? 'Mục này và các thẻ ôn tập liên quan sẽ được xóa. Sách vẫn được giữ trong thư viện.' : 'This entry and its linked review cards will be removed. The book stays in your library.'}</p>
    {error && <p role="alert" className="form-message">{error}</p>}
    <div className="dialog-actions"><button className="secondary" onClick={onClose} disabled={busy} autoFocus>{vi ? 'Hủy' : 'Cancel'}</button><button className="primary danger-action" onClick={onDelete} disabled={busy}>{busy ? (vi ? 'Đang xóa…' : 'Deleting…') : (vi ? 'Xóa' : 'Delete')}</button></div>
  </div></div>
}
