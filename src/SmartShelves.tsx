import { useEffect, useMemo, useState } from 'react'
import { ChevronDown, LayoutGrid } from 'lucide-react'
import type { Lang } from './i18n'
import type { Book, SyncRecord } from './types'
import { contentLanguage } from './typography'
import './WorkspaceTools.css'

type Progress = 'any' | 'unread' | 'reading' | 'completed'
export type SmartShelf = { id: string; name: string; progress: Progress; notes: boolean; organization: string }
type Option = { id: string; name: string }
const modes: Progress[] = ['any', 'unread', 'reading', 'completed']
const empty = { name: '', progress: 'any' as Progress, notes: false, organization: '' }

function smartShelfBooks(shelf: Pick<SmartShelf, 'progress' | 'notes' | 'organization'>, books: Book[], records: SyncRecord[], profile: string, progressFor: (bookId: string) => number) {
  const noteBooks = new Set<unknown>(), organizedBooks = new Set<unknown>()
  const [kind, id] = shelf.organization.split(/:(.*)/s)
  for (const record of records) {
    if (record.profile !== profile || record.deleted) continue
    if (record.kind === 'highlights' || record.kind === 'bookmarks') noteBooks.add(record.payload.book_id)
    if ((kind === 'tag' && record.kind === 'book_tag_cross_ref' && record.payload.tag_id === id) || (kind === 'collection' && record.kind === 'book_collection_cross_ref' && record.payload.collection_id === id)) organizedBooks.add(record.payload.book_id)
  }
  return books.filter(book => {
    if ((shelf.notes && !noteBooks.has(book.id)) || (shelf.organization && !organizedBooks.has(book.id))) return false
    const progression = progressFor(book.id)
    return shelf.progress === 'any' || (shelf.progress === 'reading' ? progression > 0 && progression < 0.99 : shelf.progress === 'completed' ? progression >= 0.99 : progression <= 0)
  })
}

function storedShelves(key: string): SmartShelf[] {
  try {
    const items: unknown = JSON.parse(localStorage.getItem(key) || '[]')
    return Array.isArray(items) ? items.filter(item => item && typeof item.id === 'string' && typeof item.name === 'string' && modes.includes(item.progress) && typeof item.notes === 'boolean' && typeof item.organization === 'string').slice(0, 30) : []
  } catch { return [] }
}

export function SmartShelves({ profile, lang, books, records, tags, collections, authorize, progressFor, onOpenBook }: {
  profile: string; lang: Lang; books: Book[]; records: SyncRecord[]; tags: Option[]; collections: Option[]
  authorize: () => Promise<boolean>; progressFor: (id: string) => number; onOpenBook: (book: Book) => void
}) {
  const vi = lang === 'vi'
  const tx = (a: string, b: string) => vi ? a : b
  const key = `nocap-smart-shelves-v1:${profile}`
  const [shelves, setShelves] = useState(() => storedShelves(key))
  const [selected, setSelected] = useState('')
  const [editing, setEditing] = useState<string | null>(null)
  const [form, setForm] = useState(empty)
  const [error, setError] = useState('')
  const [busy, setBusy] = useState(false)
  useEffect(() => {
    const change = (event: StorageEvent) => { if (event.key === key || event.key === null) setShelves(storedShelves(key)) }
    window.addEventListener('storage', change)
    return () => window.removeEventListener('storage', change)
  }, [key])
  const shelf = shelves.find(item => item.id === selected)
  const matches = useMemo(() => shelf ? smartShelfBooks(shelf, books, records, profile, progressFor) : [], [shelf, books, records, profile, progressFor])
  const nameKey = (value: string) => value.toLowerCase().normalize('NFC')

  function edit(item?: SmartShelf) {
    setForm(item || empty)
    setEditing(item?.id || '')
  }

  async function save() {
    if (busy || editing === null || !form.name.trim()) return
    setBusy(true); setError('')
    try {
      if (!await authorize()) return
      const current = storedShelves(key)
      const name = form.name.trim()
      if (current.some(item => item.id !== editing && nameKey(item.name) === nameKey(name))) { setError(tx('Tên tủ này đã được sử dụng.', 'This shelf name is already in use.')); return }
      if (!editing && current.length >= 30) { setError(tx('Đã đạt giới hạn 30 tủ.', 'The 30-shelf limit has been reached.')); return }
      if (editing && !current.some(item => item.id === editing)) { setError(tx('Tủ sách đã thay đổi ở tab khác.', 'The shelf changed in another tab.')); return }
      const next = { ...form, id: editing || crypto.randomUUID(), name }
      const updated = [...current.filter(item => item.id !== next.id), next]
      localStorage.setItem(key, JSON.stringify(updated)); setShelves(updated); setSelected(next.id); setEditing(null)
    } catch { setError(tx('Chưa lưu được tủ sách trên trình duyệt này.', 'The shelf could not be saved in this browser.')) }
    finally { setBusy(false) }
  }

  function remove() {
    if (!shelf) return
    try {
      const next = storedShelves(key).filter(item => item.id !== shelf.id)
      localStorage.setItem(key, JSON.stringify(next)); setShelves(next); setSelected(''); setEditing(null); setError('')
    } catch { setError(tx('Chưa xóa được tủ sách đã lưu.', 'The saved shelf could not be removed.')) }
  }

  return <details className="workspace-tools workspace-tool-card" name="nocap-library-tools">
    <summary><LayoutGrid size={18} aria-hidden="true" />{tx('Tủ sách thông minh', 'Smart shelves')}<ChevronDown className="workspace-tool-chevron" size={16} aria-hidden="true" /></summary>
    <div className="workspace-tool-content">
    <p>{tx('Các bộ lọc được lưu trên trình duyệt này.', 'Filters are saved in this browser.')}</p>
    {error && <p role="alert">{error}</p>}
    <div className="workspace-tool-controls">
      {!!shelves.length && <label>{tx('Tủ đã lưu', 'Saved shelves')}<select value={shelf?.id || ''} onChange={event => { setSelected(event.target.value); setEditing(null) }}><option value="">{tx('Chọn tủ', 'Choose a shelf')}</option>{shelves.map(item => <option key={item.id} value={item.id} lang={contentLanguage(item.name, undefined, lang)}>{item.name}</option>)}</select></label>}
      <button type="button" className="secondary" onClick={() => edit()}>{tx('Tạo tủ thông minh', 'Create smart shelf')}</button>
      {shelf && <><button type="button" className="secondary" onClick={() => edit(shelf)}>{tx('Sửa bộ lọc', 'Edit filter')}</button>
        <button type="button" className="text-button" onClick={remove}>{tx('Xóa bộ lọc đã lưu', 'Remove saved filter')}</button></>}
    </div>
    {editing !== null && <form className="workspace-tool-controls workspace-shelf-form" onSubmit={event => { event.preventDefault(); void save() }}>
      <label>{tx('Tên tủ', 'Shelf name')}<input maxLength={80} required value={form.name} lang={contentLanguage(form.name, undefined, lang)} onChange={event => setForm({ ...form, name: event.target.value })} /></label>
      <label>{tx('Tiến độ', 'Progress')}<select value={form.progress} onChange={event => setForm({ ...form, progress: event.target.value as Progress })}>
        <option value="any">{tx('Bất kỳ', 'Any')}</option><option value="unread">{tx('Chưa đọc', 'Unread')}</option><option value="reading">{tx('Đọc dở', 'In progress')}</option><option value="completed">{tx('Đã đọc xong', 'Completed')}</option>
      </select></label>
      <label>{tx('Thẻ hoặc bộ sưu tập', 'Tag or collection')}<select value={form.organization} onChange={event => setForm({ ...form, organization: event.target.value })}>
        <option value="">{tx('Bất kỳ', 'Any')}</option>{tags.map(item => <option key={`tag:${item.id}`} value={`tag:${item.id}`} lang={contentLanguage(item.name, undefined, lang)}>{item.name}</option>)}{collections.map(item => <option key={`collection:${item.id}`} value={`collection:${item.id}`} lang={contentLanguage(item.name, undefined, lang)}>{item.name}</option>)}
      </select></label>
      <label className="writing-tools-check"><input type="checkbox" checked={form.notes} onChange={event => setForm({ ...form, notes: event.target.checked })} />{tx('Có ghi chú hoặc dấu trang', 'Has notes or bookmarks')}</label>
      <button className="primary" disabled={busy || !form.name.trim()}>{tx('Lưu bộ lọc', 'Save filter')}</button>
      <button type="button" className="text-button" onClick={() => setEditing(null)}>{tx('Hủy', 'Cancel')}</button>
    </form>}
    {shelf && <><p role="status">{tx(`${matches.length} tài liệu khớp bộ lọc`, `${matches.length} matching documents`)}</p><ul className="workspace-tool-list">
      {matches.map(book => <li key={book.id}><button type="button" className="text-button" onClick={() => onOpenBook(book)} lang={contentLanguage(book.title, book.language, lang)}>{book.title}</button></li>)}
    </ul></>}
    </div>
  </details>
}
