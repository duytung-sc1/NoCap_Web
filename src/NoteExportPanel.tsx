import { useState } from 'react'
import { ChevronDown, FileDown } from 'lucide-react'
import { scopedExportNotes, type NoteExportScope } from './noteExport'
import type { Book, SyncRecord } from './types'
import type { Lang } from './i18n'
import { contentLanguage } from './typography'
import './WorkspaceTools.css'

type Props = { profile: string; records: SyncRecord[]; books: Book[]; lang: Lang; onExport: (scope: NoteExportScope, name: string, format: 'md' | 'csv') => Promise<void> }

export function NoteExportPanel({ profile, records, books, lang, onExport }: Props) {
  const vi = lang === 'vi'
  const [kind, setKind] = useState<NoteExportScope['kind']>('book')
  const [open, setOpen] = useState(false)
  const [id, setId] = useState('')
  const [busy, setBusy] = useState(false)
  const bookIds = new Set(records.filter(r => r.profile === profile && !r.deleted && (r.kind === 'highlights' || r.kind === 'bookmarks') && typeof r.payload.book_id === 'string').map(r => r.payload.book_id as string))
  const choices = kind === 'book' ? [...bookIds].map(value => ({ id: value, name: books.find(book => book.id === value)?.title || (vi ? 'Tài liệu không còn trong thư viện' : 'Document unavailable') })) : records.flatMap(record =>
    record.profile === profile && !record.deleted && record.kind === 'knowledge_topics' && typeof record.payload.name === 'string' ? [{ id: typeof record.payload.id === 'string' && record.payload.id ? record.payload.id : record.id, name: record.payload.name }] : [])
  const choice = choices.find(option => option.id === id)
  const count = choice ? scopedExportNotes(records, profile, { kind, id }).length : 0

  async function download(format: 'md' | 'csv') {
    if (!choice || !count || busy) return
    setBusy(true)
    try { await onExport({ kind, id }, choice.name, format) } finally { setBusy(false) }
  }

  return <details className="workspace-tools workspace-tool-card" onToggle={event => setOpen(event.currentTarget.open)}>
    <summary><FileDown size={18} aria-hidden="true" />{vi ? 'Xuất ghi chú theo sách hoặc chủ đề' : 'Export notes by book or topic'}<ChevronDown className="workspace-tool-chevron" size={16} aria-hidden="true" /></summary>
    {open && <div className="workspace-tool-content"><div className="workspace-tool-controls">
      <label>{vi ? 'Phạm vi' : 'Scope'}<select value={kind} onChange={event => { setKind(event.target.value as NoteExportScope['kind']); setId('') }}>
        <option value="book">{vi ? 'Sách' : 'Book'}</option><option value="topic">{vi ? 'Chủ đề' : 'Topic'}</option>
      </select></label>
      <label>{kind === 'book' ? (vi ? 'Tên sách' : 'Book title') : (vi ? 'Tên chủ đề' : 'Topic name')}<select value={choice?.id || ''} onChange={event => setId(event.target.value)}>
        <option value="">{vi ? 'Chọn một mục' : 'Choose an item'}</option>
        {choices.map(item => <option key={item.id} value={item.id} lang={contentLanguage(item.name, undefined, lang)}>{item.name}</option>)}
      </select></label>
      <button type="button" className="secondary" disabled={!count || busy} onClick={() => void download('md')}>{vi ? 'Xuất Markdown' : 'Export Markdown'}</button>
      <button type="button" className="secondary" disabled={!count || busy} onClick={() => void download('csv')}>{vi ? 'Xuất CSV' : 'Export CSV'}</button>
    </div>
    {choice && <p role="status">{vi ? `${count} ghi chú và dấu trang` : `${count} notes and bookmarks`}</p>}</div>}
  </details>
}
