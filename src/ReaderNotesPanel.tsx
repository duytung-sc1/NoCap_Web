import { useRef, useState } from 'react'
import { ArrowUpRight, Check, FilePenLine, Pencil, Search, Trash2, X } from 'lucide-react'
import { highlightColors, type HighlightColor } from './annotations'
import type { Lang } from './i18n'
import type { SyncRecord } from './types'
import './ReaderNotesPanel.css'

export type ReaderNotesPanelProps = {
  open: boolean
  lang: Lang
  bookTitle: string
  records: SyncRecord[]
  note: string
  color: HighlightColor
  quote: string
  saving: boolean
  canSave: boolean
  onNoteChange: (value: string) => void
  onColorChange: (color: HighlightColor) => void
  onClearQuote: () => void
  onSave: () => void
  onNavigate: (record: SyncRecord) => void
  onUpdate: (record: SyncRecord, changes: { note: string; color: HighlightColor }) => Promise<void>
  onDelete: (record: SyncRecord) => Promise<void>
  onClose: () => void
}

function recordColor(record: SyncRecord): HighlightColor {
  return highlightColors.includes(record.payload.color as HighlightColor) ? record.payload.color as HighlightColor : 'YELLOW'
}

function NoteColors({ lang, color, disabled, onChange }: { lang: Lang; color: HighlightColor; disabled: boolean; onChange: (color: HighlightColor) => void }) {
  const names = lang === 'vi' ? ['Vàng', 'Xanh lá', 'Xanh dương', 'Hồng', 'Tím'] : ['Yellow', 'Green', 'Blue', 'Pink', 'Purple']
  return <fieldset className="reader-note-colors" disabled={disabled}>
    <legend>{lang === 'vi' ? 'Màu highlight' : 'Highlight color'}</legend>
    <div>{highlightColors.map((value, index) => <button type="button" key={value} className={`reader-note-color ${value.toLowerCase()}`} aria-label={names[index]} aria-pressed={value === color} onClick={() => onChange(value)}>
      {value === color && <Check size={14} aria-hidden="true" />}
    </button>)}</div>
  </fieldset>
}

function ReadingNote({ record, lang, onNavigate, onUpdate, onDelete }: Pick<ReaderNotesPanelProps, 'lang' | 'onNavigate' | 'onUpdate' | 'onDelete'> & { record: SyncRecord }) {
  const vi = lang === 'vi'
  const [editing, setEditing] = useState(false)
  const [confirmingDelete, setConfirmingDelete] = useState(false)
  const [draft, setDraft] = useState('')
  const [color, setColor] = useState<HighlightColor>(recordColor(record))
  const [busy, setBusy] = useState(false)
  const [error, setError] = useState('')
  const pending = useRef(false)
  const text = String(record.payload.text || '')
  const chapter = String(record.payload.chapter_title || '')
  const savedNote = String(record.payload.note || '')

  async function submit(deleting: boolean) {
    if (pending.current) return
    pending.current = true
    setBusy(true)
    setError('')
    try {
      if (deleting) await onDelete(record)
      else await onUpdate(record, { note: draft, color })
      setEditing(false)
      setConfirmingDelete(false)
    } catch (cause) {
      setError(cause instanceof Error ? cause.message : vi ? 'Chưa lưu được thay đổi. Vui lòng thử lại.' : 'Unable to save changes. Please try again.')
    } finally {
      pending.current = false
      setBusy(false)
    }
  }

  return <article className={`reader-note-card ${recordColor(record).toLowerCase()}`}>
    <div className="reader-note-meta"><span>{chapter || (vi ? 'Ghi chú trong sách' : 'Book note')}</span>
      <button type="button" className="reader-note-source" onClick={() => onNavigate(record)}>{vi ? 'Về đoạn gốc' : 'Go to source'}<ArrowUpRight size={14} aria-hidden="true" /></button>
    </div>
    {text && <blockquote>{text}</blockquote>}
    {editing ? <form className="reader-note-edit" onSubmit={event => { event.preventDefault(); void submit(false) }}>
      <label>{vi ? 'Sửa ghi chú' : 'Edit note'}<textarea value={draft} onChange={event => setDraft(event.target.value)} rows={4} maxLength={10000} disabled={busy} /></label>
      <NoteColors lang={lang} color={color} disabled={busy} onChange={setColor} />
      <div className="reader-note-edit-actions"><button type="button" className="reader-note-quiet" disabled={busy} onClick={() => { setEditing(false); setError('') }}>{vi ? 'Hủy' : 'Cancel'}</button><button className="reader-note-save" disabled={busy}>{busy ? (vi ? 'Đang lưu…' : 'Saving…') : (vi ? 'Lưu thay đổi' : 'Save changes')}</button></div>
    </form> : <>
      {savedNote && <p className="reader-note-saved-text">{savedNote}</p>}
      {!confirmingDelete && <div className="reader-note-card-actions">
        <button type="button" onClick={() => { setDraft(savedNote); setColor(recordColor(record)); setEditing(true); setError('') }}><Pencil size={13} aria-hidden="true" />{vi ? 'Sửa' : 'Edit'}</button>
        <button type="button" onClick={() => { setConfirmingDelete(true); setError('') }}><Trash2 size={13} aria-hidden="true" />{vi ? 'Xóa' : 'Delete'}</button>
      </div>}
    </>}
    {confirmingDelete && <div className="reader-note-delete-confirm">
      <p>{vi ? 'Xóa ghi chú này và các thẻ ôn tập liên quan?' : 'Delete this note and its linked review cards?'}</p>
      <div><button type="button" className="reader-note-quiet" disabled={busy} onClick={() => { setConfirmingDelete(false); setError('') }}>{vi ? 'Giữ lại' : 'Keep note'}</button><button type="button" className="reader-note-delete" disabled={busy} onClick={() => { void submit(true) }}>{busy ? (vi ? 'Đang xóa…' : 'Deleting…') : (vi ? 'Xóa ghi chú' : 'Delete note')}</button></div>
    </div>}
    {error && <p className="reader-note-error" role="alert">{error}</p>}
  </article>
}

/** Kept mounted when closed so inline editing survives toggling the panel. */
export function ReaderNotesPanel(props: ReaderNotesPanelProps) {
  const { open, lang, bookTitle, records, note, color, quote, saving, canSave, onNoteChange, onColorChange, onClearQuote, onSave, onNavigate, onUpdate, onDelete, onClose } = props
  const vi = lang === 'vi'
  const [search, setSearch] = useState('')
  const notes = records.filter(record => !record.deleted && record.kind === 'highlights')
  const needle = search.trim().toLocaleLowerCase(lang)
  const filtered = notes.filter(record => !needle || [record.payload.text, record.payload.note, record.payload.chapter_title].some(value => String(value || '').toLocaleLowerCase(lang).includes(needle)))

  return <aside id="reader-notes-panel" className="reader-notes-panel" role="complementary" aria-label={vi ? 'Ghi chú khi đọc' : 'Reading notes'} hidden={!open}>
    <header className="reader-notes-heading"><div><span className="reader-notes-kicker">{vi ? 'Đọc & lưu ý tưởng' : 'Read & collect ideas'}</span><h2>{vi ? 'Ghi chú khi đọc' : 'Reading notes'}</h2><p title={bookTitle}>{bookTitle}</p></div><button type="button" className="reader-notes-close" onClick={onClose} aria-label={vi ? 'Đóng bảng ghi chú' : 'Close notes panel'}><X size={19} aria-hidden="true" /></button></header>
    <div className="reader-notes-content">
      <form className="reader-note-composer" onSubmit={event => { event.preventDefault(); if (!saving && canSave) onSave() }}>
        <h3><FilePenLine size={16} aria-hidden="true" />{vi ? 'Ý tưởng mới' : 'New thought'}</h3>
        {quote ? <div className="reader-note-selection"><div><span>{vi ? 'Đoạn trích đã chọn' : 'Selected passage'}</span><button type="button" disabled={saving} onClick={onClearQuote} aria-label={vi ? 'Bỏ đoạn trích đã chọn' : 'Clear selected passage'}><X size={14} aria-hidden="true" /></button></div><blockquote>{quote}</blockquote></div> : <p className="reader-note-hint">{vi ? 'Bôi đen một đoạn trong sách để trích dẫn, hoặc viết ý tưởng tại vị trí đang đọc.' : 'Select a passage to quote it, or write a thought at your current reading position.'}</p>}
        <label htmlFor="reader-note-draft">{vi ? 'Ghi chú của bạn' : 'Your note'}</label>
        <textarea id="reader-note-draft" value={note} rows={4} maxLength={10000} disabled={saving} placeholder={vi ? 'Điều gì khiến bạn muốn ghi nhớ?' : 'What would you like to remember?'} onChange={event => onNoteChange(event.target.value)} />
        <div className="reader-note-composer-bottom"><NoteColors lang={lang} color={color} disabled={saving} onChange={onColorChange} /><button type="submit" className="reader-note-save" disabled={saving || !canSave}>{saving ? (vi ? 'Đang lưu…' : 'Saving…') : (vi ? 'Lưu ghi chú' : 'Save note')}</button></div>
      </form>
      <section className="reader-notes-saved" aria-label={vi ? 'Ghi chú của sách này' : 'Notes in this book'}>
        <div className="reader-notes-list-heading"><h3>{vi ? 'Trong cuốn sách này' : 'In this book'}</h3><span>{notes.length}</span></div>
        {notes.length > 0 && <label className="reader-notes-search"><Search size={15} aria-hidden="true" /><span className="reader-notes-sr-only">{vi ? 'Tìm trong ghi chú' : 'Search notes'}</span><input type="search" value={search} onChange={event => setSearch(event.target.value)} placeholder={vi ? 'Tìm trong ghi chú…' : 'Search notes…'} /></label>}
        {notes.length === 0 && <div className="reader-notes-empty"><p>{vi ? 'Những ý tưởng hay bắt đầu từ một dòng.' : 'A good idea starts with a line.'}</p><span>{vi ? 'Ghi chú và highlight của cuốn sách sẽ xuất hiện ở đây.' : 'Your notes and highlights from this book will appear here.'}</span></div>}
        {notes.length > 0 && filtered.length === 0 && <p className="reader-notes-no-results">{vi ? 'Không có ghi chú phù hợp.' : 'No matching notes.'}</p>}
        <div className="reader-notes-list">{notes.map(record => <div key={record.key} hidden={!filtered.includes(record)}><ReadingNote record={record} lang={lang} onNavigate={onNavigate} onUpdate={onUpdate} onDelete={onDelete} /></div>)}</div>
      </section>
    </div>
  </aside>
}
