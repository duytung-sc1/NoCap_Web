import { useEffect, useId, useRef, useState } from 'react'
import { X } from 'lucide-react'
import type { Book } from './types'
import type { Lang } from './i18n'

export function ComparisonSourcesDialog({ books, initialBookId, lang, onClose, onCompare }: {
  books: Book[]; initialBookId?: string; lang: Lang; onClose: () => void; onCompare: (left: Book, right: Book) => void
}) {
  const [left, setLeft] = useState(initialBookId || books[0]?.id || '')
  const [right, setRight] = useState(books.find(book => book.id !== (initialBookId || books[0]?.id))?.id || books[0]?.id || '')
  const dialog = useRef<HTMLFormElement>(null)
  const id = useId()
  const vi = lang === 'vi'
  useEffect(() => {
    const previous = document.activeElement as HTMLElement | null
    dialog.current?.querySelector<HTMLElement>('select,button')?.focus()
    return () => previous?.focus()
  }, [])
  return <div className="modal-shade"><form className="dialog comparison-sources-dialog" ref={dialog} role="dialog" aria-modal="true" aria-labelledby="comparison-sources-title" onKeyDown={event => {
    if (event.key === 'Escape') { event.preventDefault(); event.stopPropagation(); onClose() }
    if (event.key === 'Tab') {
      const items = Array.from(dialog.current?.querySelectorAll<HTMLElement>('button, select') || []).filter(item => !(item as HTMLButtonElement).disabled)
      const first = items[0], last = items.at(-1)
      if (event.shiftKey && document.activeElement === first) { event.preventDefault(); last?.focus() }
      if (!event.shiftKey && document.activeElement === last) { event.preventDefault(); first?.focus() }
    }
  }} onSubmit={event => {
    event.preventDefault()
    const a = books.find(book => book.id === left), b = books.find(book => book.id === right)
    if (a && b) onCompare(a, b)
  }}>
    <button type="button" className="icon-button dialog-close" aria-label={vi ? 'Đóng chọn nguồn' : 'Close source selection'} onClick={onClose}><X size={19} /></button>
    <h2 id="comparison-sources-title">{vi ? 'Đọc đối chiếu hai nguồn' : 'Compare two sources'}</h2>
    <p className="muted">{vi ? 'Mỗi nguồn có trang đọc, tìm kiếm và ghi chú riêng. Bạn cũng có thể mở cùng một sách ở hai vị trí.' : 'Each source has its own navigation, search and notes. You can also open one book at two positions.'}</p>
    <label htmlFor={`${id}-left`}>{vi ? 'Nguồn bên trái' : 'Left source'}</label>
    <select id={`${id}-left`} value={left} onChange={event => setLeft(event.target.value)} required>{books.map(book => <option key={book.id} value={book.id}>{book.title}</option>)}</select>
    <label htmlFor={`${id}-right`}>{vi ? 'Nguồn bên phải' : 'Right source'}</label>
    <select id={`${id}-right`} value={right} onChange={event => setRight(event.target.value)} required>{books.map(book => <option key={book.id} value={book.id}>{book.title}</option>)}</select>
    {!books.length && <p>{vi ? 'Hãy nhập tài liệu hoặc chọn một sách trong Khám phá trước.' : 'Import a document or choose a book in Explore first.'}</p>}
    <div className="dialog-actions"><button type="button" className="secondary" onClick={onClose}>{vi ? 'Hủy' : 'Cancel'}</button><button className="primary" disabled={!left || !right}>{vi ? 'Mở hai nguồn' : 'Open both sources'}</button></div>
  </form></div>
}
