import { useEffect, useId, useMemo, useRef, useState, type CSSProperties, type FormEvent, type ReactNode } from 'react'
import { ArrowUp, BookOpen, ChevronDown, ChevronRight, Folder, FolderOpen, FolderPlus, LayoutGrid, ListTree, MoreHorizontal, MoveRight, Network, Pencil, Plus, Search, Trash2, X } from 'lucide-react'
import type { Lang } from './i18n'
import type { Book, SyncRecord } from './types'
import { createLibraryFolder, deleteLibraryFolder, folderPath, getLibraryFolderState, isDescendant, moveLibraryBooks, moveLibraryFolder, renameLibraryFolder, type LibraryFolder } from './libraryFolders'
import { LibraryFolderMap } from './LibraryFolderMap'
import './LibraryFoldersWorkspace.css'

export type LibraryFoldersWorkspaceProps = {
  lang: Lang
  profile: string
  records: SyncRecord[]
  books: Book[]
  allBooks: Book[]
  filterActive: boolean
  renderBook: (book: Book) => ReactNode
  onOpenBook: (book: Book) => void
  onDetailsBook: (book: Book) => void
  onMutate: (action: () => Promise<unknown>) => Promise<boolean>
  mapPage?: boolean
  onOpenMap?: () => void
  onBackFromMap?: (openedFolderId?: string | null) => void
}

type View = 'normal' | 'tree'
type FolderDialog = { kind: 'create'; parentId: string | null } | { kind: 'rename'; folderId: string } | { kind: 'moveFolder'; folderId: string } | { kind: 'delete'; folderId: string } | { kind: 'moveBooks'; bookIds: string[] } | { kind: 'addBooks'; folderId: string }
type TreeRow = { kind: 'folder'; folder: LibraryFolder; depth: number } | { kind: 'book'; book: Book; depth: number }
const VIEW_KEY = 'nocap-library-view-v1'
function initialView(): View {
  try { return localStorage.getItem(VIEW_KEY) === 'tree' ? 'tree' : 'normal' } catch { return 'normal' }
}

/** Key the local navigation and pending UI by account, including standalone use. */
export function LibraryFoldersWorkspace(props: LibraryFoldersWorkspaceProps) {
  return <Workspace key={props.profile} {...props} />
}

function Workspace({ lang, profile, records, books, allBooks, filterActive, renderBook, onOpenBook, onDetailsBook, onMutate, mapPage, onOpenMap, onBackFromMap }: LibraryFoldersWorkspaceProps) {
  const text = (vi: string, en: string) => lang === 'vi' ? vi : en
  const rootLabel = text('Tủ sách', 'Library')
  const state = useMemo(() => getLibraryFolderState(records, profile), [records, profile])
  const [view, setView] = useState<View>(initialView)
  const [localMap, setLocalMap] = useState(false)
  const showingMap = mapPage || localMap
  const [currentId, setCurrentId] = useState<string | null>(null)
  const currentFolder = currentId ? state.folderById.get(currentId) : undefined
  const current = currentFolder?.id ?? null
  const path = useMemo(() => folderPath(state, current), [state, current])
  const [expanded, setExpanded] = useState<Set<string>>(() => new Set())
  const matchKey = `${filterActive}:${books.map(book => book.id).join('\u0000')}`
  const [selectionScope, setSelectionScope] = useState(matchKey)
  const [selection, setSelected] = useState<Set<string>>(() => new Set())
  const availableBookIds = useMemo(() => new Set(books.map(book => book.id)), [books])
  const selected = useMemo(() => new Set([...selection].filter(id => availableBookIds.has(id))), [selection, availableBookIds])
  const [dialog, setDialog] = useState<FolderDialog | null>(null)
  const [name, setName] = useState('')
  const [destination, setDestination] = useState('')
  const [pickerQuery, setPickerQuery] = useState('')
  const [pickedBooks, setPickedBooks] = useState<Set<string>>(() => new Set())
  const [busy, setBusy] = useState(false)
  const [saveFailed, setSaveFailed] = useState(false)
  const [notice, setNotice] = useState('')
  const pending = useRef(false), mounted = useRef(false)
  const dialogReturn = useRef<HTMLElement | null>(null), newFolderButton = useRef<HTMLButtonElement>(null), workspaceElement = useRef<HTMLElement>(null)
  const dialogId = useId()
  const [filterClosed, setFilterClosed] = useState<{ key: string; ids: Set<string> }>({ key: '', ids: new Set() })
  if (selectionScope !== matchKey) {
    setSelectionScope(matchKey)
    setSelected(new Set())
  }

  useEffect(() => { mounted.current = true; return () => { mounted.current = false } }, [])
  useEffect(() => { try { localStorage.setItem(VIEW_KEY, view) } catch { /* Storage is optional. */ } }, [view])

  const { children, folderRows, counts } = useMemo(() => {
    const children = new Map<string | null, LibraryFolder[]>()
    for (const folder of state.folders) {
      const siblings = children.get(folder.parentId) ?? []
      siblings.push(folder); children.set(folder.parentId, siblings)
    }
    for (const siblings of children.values()) siblings.sort((a, b) => a.name.localeCompare(b.name, lang) || a.id.localeCompare(b.id))
    const folderRows: { folder: LibraryFolder; depth: number }[] = []
    const stack = [...(children.get(null) ?? [])].reverse().map(folder => ({ folder, depth: 0 }))
    const visited = new Set<string>()
    while (stack.length) {
      const row = stack.pop()!
      if (visited.has(row.folder.id)) continue
      visited.add(row.folder.id); folderRows.push(row)
      const descendants = children.get(row.folder.id) ?? []
      for (let index = descendants.length - 1; index >= 0; index--) stack.push({ folder: descendants[index], depth: row.depth + 1 })
    }
    const counts = new Map<string | null, number>()
    for (const book of allBooks) {
      const id = state.bookFolders.get(book.id) ?? null
      counts.set(id, (counts.get(id) ?? 0) + 1)
    }
    // Reverse preorder propagates counts without recursion, even on deep trees.
    for (let index = folderRows.length - 1; index >= 0; index--) {
      const folder = folderRows[index].folder
      counts.set(folder.parentId, (counts.get(folder.parentId) ?? 0) + (counts.get(folder.id) ?? 0))
    }
    return { children, folderRows, counts }
  }, [state, allBooks, lang])

  const { booksByFolder, matchingFolders } = useMemo(() => {
    const booksByFolder = new Map<string | null, Book[]>(), matchingFolders = new Set<string>()
    for (const book of books) {
      const folderId = state.bookFolders.get(book.id) ?? null
      const siblings = booksByFolder.get(folderId) ?? []
      siblings.push(book); booksByFolder.set(folderId, siblings)
      if (filterActive) {
        let next = folderId
        // Shared ancestors need only one walk across the matching documents.
        while (next && !matchingFolders.has(next)) {
          matchingFolders.add(next); next = state.folderById.get(next)?.parentId ?? null
        }
      }
    }
    return { booksByFolder, matchingFolders }
  }, [state, books, filterActive])

  function isExpanded(id: string) {
    const closed = filterClosed.key === matchKey && filterClosed.ids.has(id)
    return !closed && (expanded.has(id) || (filterActive && matchingFolders.has(id)))
  }
  function toggleExpanded(id: string) {
    const opening = !isExpanded(id)
    setExpanded(previous => { const next = new Set(previous); if (opening) next.add(id); else next.delete(id); return next })
    if (filterActive) setFilterClosed(previous => {
      const ids = new Set(previous.key === matchKey ? previous.ids : [])
      if (opening) ids.delete(id); else ids.add(id)
      return { key: matchKey, ids }
    })
  }
  function navigate(id: string | null) {
    setCurrentId(id); setSelected(new Set())
    if (id && view === 'tree') setExpanded(previous => new Set([...previous, id]))
  }
  function changeView(next: View) {
    setView(next); setSelected(new Set())
    if (next === 'tree' && path.length) {
      const ancestors = path.map(folder => folder.id)
      setExpanded(previous => new Set([...previous, ...ancestors]))
      setFilterClosed(previous => ({ key: matchKey, ids: new Set([...previous.ids].filter(id => !ancestors.includes(id))) }))
    }
  }
  function expandAll() {
    setExpanded(new Set(folderRows.map(row => row.folder.id)))
    setFilterClosed({ key: matchKey, ids: new Set() })
  }
  function collapseAll() {
    setExpanded(new Set())
    setFilterClosed({ key: matchKey, ids: new Set(folderRows.map(row => row.folder.id)) })
  }
  function toggleSelected(id: string) {
    if (pending.current) return
    setSelected(previous => { const next = new Set([...previous].filter(item => availableBookIds.has(item))); if (next.has(id)) next.delete(id); else if (next.size < 1000) next.add(id); return next })
  }
  function fullPath(id: string | null) { return [rootLabel, ...folderPath(state, id).map(folder => folder.name)].join(' / ') }
  function openDialog(next: FolderDialog, trigger: HTMLElement) {
    if (pending.current) return
    const details = trigger.closest('details')
    dialogReturn.current = details?.querySelector<HTMLElement>('summary') ?? trigger
    if (details) details.open = false
    setName(next.kind === 'rename' ? state.folderById.get(next.folderId)?.name ?? '' : '')
    const parent = next.kind === 'moveFolder' ? state.folderById.get(next.folderId)?.parentId ?? null :
      next.kind === 'moveBooks' ? state.bookFolders.get(next.bookIds[0]) ?? null : current
    setDestination(parent ?? ''); setPickerQuery(''); setPickedBooks(new Set()); setSaveFailed(false); setNotice(''); setDialog(next)
  }
  function closeDialog() { if (!pending.current) setDialog(null) }
  function restoreFocus() {
    const target = dialogReturn.current?.isConnected ? dialogReturn.current : newFolderButton.current ?? workspaceElement.current
    if (target?.isConnected) target.focus()
  }
  function leaveMap(openedFolderId?: string | null) {
    if (pending.current) return
    if (openedFolderId !== undefined) { setView('normal'); navigate(openedFolderId) }
    setLocalMap(false)
    onBackFromMap?.(openedFolderId)
  }

  const dialogFolder = dialog && 'folderId' in dialog ? state.folderById.get(dialog.folderId) : undefined
  const addCandidates = useMemo(() => dialog?.kind === 'addBooks' ? allBooks.filter(book => state.bookFolders.get(book.id) !== dialog.folderId) : [], [dialog, allBooks, state])
  const candidateIds = useMemo(() => new Set(addCandidates.map(book => book.id)), [addCandidates])
  const validPicked = useMemo(() => [...pickedBooks].filter(id => candidateIds.has(id)), [pickedBooks, candidateIds])
  const normalizeSearch = (value: string) => value.normalize('NFD').replace(/\p{Diacritic}/gu, '').toLocaleLowerCase(lang).replace(/đ/g, 'd')
  const pickerResults = addCandidates.filter(book => normalizeSearch(`${book.title} ${book.author ?? ''}`).includes(normalizeSearch(pickerQuery.trim())))
  function togglePicked(id: string) {
    if (pending.current || !candidateIds.has(id)) return
    setPickedBooks(previous => {
      const next = new Set([...previous].filter(item => candidateIds.has(item)))
      if (next.has(id)) next.delete(id)
      else if (next.size < 1000) next.add(id)
      return next
    })
  }
  function selectPickerResults() {
    if (pending.current) return
    setPickedBooks(new Set([...new Set([...validPicked, ...pickerResults.map(book => book.id)])].slice(0, 1000)))
  }
  const destinations = useMemo(() => {
    if (!dialog || (dialog.kind !== 'moveFolder' && dialog.kind !== 'moveBooks')) return []
    return folderRows.filter(({ folder }) => dialog.kind !== 'moveFolder' || (folder.id !== dialog.folderId && !isDescendant(state, folder.id, dialog.folderId)))
      .map(({ folder }) => ({ id: folder.id, label: [lang === 'vi' ? 'Tủ sách' : 'Library', ...folderPath(state, folder.id).map(item => item.name)].join(' / ') }))
  }, [dialog, state, folderRows, lang])

  async function submit(event: FormEvent) {
    event.preventDefault()
    if (!dialog || pending.current || ((dialog.kind === 'create' || dialog.kind === 'rename') && !name.trim())) return
    if ('folderId' in dialog && !state.folderById.has(dialog.folderId)) return
    if (dialog.kind === 'addBooks' && !validPicked.length) return
    if ((dialog.kind === 'moveFolder' || dialog.kind === 'moveBooks') && destination && !destinations.some(item => item.id === destination)) return
    const snapshot = dialog, target = dialog.kind === 'addBooks' ? dialog.folderId : destination || null, nextName = name.trim(), selectedToAdd = validPicked.slice(0, 1000)
    const deletedParent = dialogFolder?.parentId ?? null
    pending.current = true; setBusy(true); setSaveFailed(false)
    let committed = false, refreshed = false
    try {
      refreshed = await onMutate(async () => {
        if (snapshot.kind === 'create') await createLibraryFolder(profile, nextName, snapshot.parentId)
        else if (snapshot.kind === 'rename') await renameLibraryFolder(profile, snapshot.folderId, nextName)
        else if (snapshot.kind === 'moveFolder') await moveLibraryFolder(profile, snapshot.folderId, target)
        else if (snapshot.kind === 'delete') await deleteLibraryFolder(profile, snapshot.folderId)
        else if (snapshot.kind === 'addBooks') await moveLibraryBooks(profile, selectedToAdd, target)
        else await moveLibraryBooks(profile, snapshot.bookIds, target)
        committed = true
      })
      if (!mounted.current) return
      if (committed || refreshed) {
        setDialog(null)
        if (snapshot.kind === 'moveBooks' || snapshot.kind === 'addBooks') setSelected(new Set())
        if (snapshot.kind === 'delete' && current === snapshot.folderId) setCurrentId(deletedParent)
        setNotice(refreshed ? text('Đã lưu thay đổi.', 'Changes saved.') : text('Đã lưu thay đổi. Danh sách đang chờ làm mới.', 'Changes saved. The list is waiting to refresh.'))
      } else setSaveFailed(true)
    } catch {
      // onMutate owns the detailed, localized error. Retire a committed create
      // even if a caller throws while refreshing, so retry cannot duplicate it.
      if (mounted.current) {
        if (committed) { setDialog(null); setNotice(text('Đã lưu thay đổi. Danh sách đang chờ làm mới.', 'Changes saved. The list is waiting to refresh.')) }
        else setSaveFailed(true)
      }
    } finally {
      if (mounted.current) { pending.current = false; setBusy(false) }
    }
  }

  function folderActions(folder: LibraryFolder) {
    return <details className="library-folder-menu">
      <summary aria-label={text(`Thao tác thư mục ${folder.name}`, `Actions for folder ${folder.name}`)} aria-disabled={busy} onClick={event => { if (pending.current) event.preventDefault() }}><MoreHorizontal size={18} aria-hidden="true" /></summary>
      <div className="library-folder-menu-items">
        <button type="button" disabled={busy} onClick={event => openDialog({ kind: 'addBooks', folderId: folder.id }, event.currentTarget)}><Plus size={14} aria-hidden="true" />{text('Thêm tài liệu…', 'Add documents…')}</button>
        <button type="button" disabled={busy} onClick={event => openDialog({ kind: 'rename', folderId: folder.id }, event.currentTarget)}><Pencil size={14} aria-hidden="true" />{text('Đổi tên', 'Rename')}</button>
        <button type="button" disabled={busy} onClick={event => openDialog({ kind: 'moveFolder', folderId: folder.id }, event.currentTarget)}><MoveRight size={14} aria-hidden="true" />{text('Di chuyển…', 'Move folder…')}</button>
        <button type="button" className="library-folder-danger" disabled={busy} onClick={event => openDialog({ kind: 'delete', folderId: folder.id }, event.currentTarget)}><Trash2 size={14} aria-hidden="true" />{text('Xóa thư mục…', 'Delete folder…')}</button>
      </div>
    </details>
  }
  function bookSelection(book: Book) {
    return <input type="checkbox" aria-label={text(`Chọn ${book.title}`, `Select ${book.title}`)} checked={selected.has(book.id)} disabled={busy || (!selected.has(book.id) && selected.size >= 1000)} onChange={() => toggleSelected(book.id)} />
  }
  function bookMove(book: Book) {
    return <button type="button" className="library-folder-button library-book-move" disabled={busy} aria-label={text(`Chuyển ${book.title}`, `Move ${book.title}`)} onClick={event => openDialog({ kind: 'moveBooks', bookIds: [book.id] }, event.currentTarget)}><MoveRight size={14} aria-hidden="true" />{text('Chuyển…', 'Move…')}</button>
  }

  const normalBooks = filterActive ? books : booksByFolder.get(current) ?? []
  const immediateFolders = filterActive ? [] : children.get(current) ?? []
  const treeRows: TreeRow[] = []
  if (view === 'tree' && !showingMap) {
    const stack: TreeRow[] = []
    const append = (parentId: string | null, depth: number) => {
      const documents = booksByFolder.get(parentId) ?? [], folders = children.get(parentId) ?? []
      for (let index = documents.length - 1; index >= 0; index--) stack.push({ kind: 'book', book: documents[index], depth })
      for (let index = folders.length - 1; index >= 0; index--) if (!filterActive || matchingFolders.has(folders[index].id)) stack.push({ kind: 'folder', folder: folders[index], depth })
    }
    append(null, 0)
    const visited = new Set<string>()
    while (stack.length) {
      const row = stack.pop()!
      if (row.kind === 'folder') {
        if (visited.has(row.folder.id)) continue
        visited.add(row.folder.id); treeRows.push(row)
        if (isExpanded(row.folder.id)) append(row.folder.id, row.depth + 1)
      } else treeRows.push(row)
    }
  }

  const dialogTitle = !dialog ? '' : dialog.kind === 'create' ? text('Tạo thư mục', 'New folder') : dialog.kind === 'rename' ? text('Đổi tên thư mục', 'Rename folder') :
    dialog.kind === 'moveFolder' ? text('Di chuyển thư mục', 'Move folder') : dialog.kind === 'delete' ? text('Xóa thư mục', 'Delete folder') : dialog.kind === 'addBooks' ? text('Thêm tài liệu vào thư mục', 'Add documents to folder') : text('Chuyển tài liệu', 'Move documents')
  const breadcrumbs = path.length > 3 ? path.slice(-2) : path
  return <section ref={workspaceElement} tabIndex={-1} className={`library-folders-workspace${showingMap ? ' is-map-page' : ''}`} lang={lang} aria-label={text('Thư mục tủ sách', 'Library folders')} aria-busy={busy}>
    {notice && <div className="library-folders-notice" role="status"><span>{notice}</span><button type="button" className="library-folder-notice-close" aria-label={text('Đóng thông báo', 'Dismiss notice')} onClick={() => setNotice('')}><X size={15} aria-hidden="true" /></button></div>}
    {showingMap ? <LibraryFolderMap lang={lang} state={state} books={allBooks} busy={busy} initialFolderId={current} renderBook={renderBook}
      onBack={() => leaveMap()}
      onOpenFolder={id => leaveMap(id)}
      onCreateFolder={(parentId, trigger) => openDialog({ kind: 'create', parentId }, trigger)}
      onRenameFolder={(folder, trigger) => openDialog({ kind: 'rename', folderId: folder.id }, trigger)}
      onMoveFolder={(folder, trigger) => openDialog({ kind: 'moveFolder', folderId: folder.id }, trigger)}
      onDeleteFolder={(folder, trigger) => openDialog({ kind: 'delete', folderId: folder.id }, trigger)}
      onMoveBooks={(bookIds, trigger) => openDialog({ kind: 'moveBooks', bookIds }, trigger)}
      onAddBooks={(folderId, trigger) => openDialog({ kind: 'addBooks', folderId }, trigger)}
      onOpenBook={onOpenBook} onDetailsBook={onDetailsBook} /> : <>
    <div className="library-folders-toolbar">
      <nav className="library-folder-breadcrumbs" aria-label={text('Đường dẫn thư mục', 'Folder path')} title={fullPath(current)}>
        <button type="button" disabled={busy} aria-current={current === null ? 'location' : undefined} onClick={() => navigate(null)}><BookOpen size={16} aria-hidden="true" />{rootLabel}</button>
        {path.length > 3 && <span aria-hidden="true">/ …</span>}
        {breadcrumbs.map(folder => <span className="library-folder-crumb" key={folder.id}><ChevronRight size={13} aria-hidden="true" /><button type="button" disabled={busy} aria-current={current === folder.id ? 'location' : undefined} title={folder.name} onClick={() => navigate(folder.id)}>{folder.name}</button></span>)}
      </nav>
      <div className="library-folders-display-controls"><button type="button" className="library-folder-button library-folder-map-entry" disabled={busy} onClick={() => { if (onOpenMap) onOpenMap(); else setLocalMap(true) }}><Network size={16} aria-hidden="true" />{text('Bản đồ tủ sách', 'Library map')}</button><div className="library-folders-view" role="group" aria-label={text('Cách hiển thị tủ sách', 'Library view')}>
        <button type="button" disabled={busy} aria-pressed={view === 'normal'} onClick={() => changeView('normal')}><LayoutGrid size={15} aria-hidden="true" />{text('Thông thường', 'Normal')}</button>
        <button type="button" disabled={busy} aria-pressed={view === 'tree'} onClick={() => changeView('tree')}><ListTree size={16} aria-hidden="true" />{text('Cây thư mục', 'Tree')}</button>
      </div></div>
    </div>
    <div className="library-folders-actions">
      {currentFolder && <button type="button" className="library-folder-button" disabled={busy} onClick={() => navigate(currentFolder.parentId)}><ArrowUp size={16} aria-hidden="true" />{text('Thư mục cha', 'Up one level')}</button>}
      <button ref={newFolderButton} type="button" className="library-folder-button" disabled={busy} onClick={event => openDialog({ kind: 'create', parentId: current }, event.currentTarget)}><FolderPlus size={16} aria-hidden="true" />{text('Thư mục mới', 'New folder')}</button>
      {currentFolder && <button type="button" className="library-folder-button" disabled={busy} onClick={event => openDialog({ kind: 'addBooks', folderId: currentFolder.id }, event.currentTarget)}><Plus size={16} aria-hidden="true" />{text('Thêm tài liệu vào thư mục', 'Add documents to folder')}</button>}
      {currentFolder && <div className="library-current-folder-actions">{folderActions(currentFolder)}</div>}
      {view === 'tree' && <>
        <button type="button" className="library-folder-link" disabled={busy || !folderRows.length} onClick={expandAll}>{text('Mở rộng tất cả', 'Expand all')}</button>
        <button type="button" className="library-folder-link" disabled={busy || !folderRows.length} onClick={collapseAll}>{text('Thu gọn tất cả', 'Collapse all')}</button>
      </>}
      <span className="library-folder-selection" aria-live="polite">{selected.size ? text(`Đã chọn ${selected.size} tài liệu`, `${selected.size} documents selected`) : text(view === 'tree' ? `${books.length} tài liệu` : `${normalBooks.length} tài liệu`, `${view === 'tree' ? books.length : normalBooks.length} documents`)}</span>
      <button type="button" className="library-folder-link" disabled={busy || !(view === 'tree' ? treeRows.some(row => row.kind === 'book') : normalBooks.length)} onClick={() => {
        const visible = view === 'tree' ? treeRows.flatMap(row => row.kind === 'book' ? [row.book] : []) : normalBooks
        setSelected(new Set(visible.slice(0, 1000).map(book => book.id)))
      }}>{text('Chọn tất cả', 'Select all')}</button>
      {selected.size > 0 && <button type="button" className="library-folder-link" disabled={busy} onClick={() => setSelected(new Set())}>{text('Bỏ chọn', 'Clear selection')}</button>}
      <button type="button" className="library-folder-button" disabled={busy || !selected.size} onClick={event => openDialog({ kind: 'moveBooks', bookIds: [...selected] }, event.currentTarget)}><MoveRight size={15} aria-hidden="true" />{text('Chuyển đã chọn…', 'Move selected…')}</button>
    </div>
    {filterActive && <p className="library-folders-hint">{text('Đang hiển thị tài liệu phù hợp trong toàn bộ tủ sách.', 'Showing matching documents across the entire library.')}</p>}
    {selected.size >= 1000 && <p className="library-folders-hint">{text('Mỗi lần có thể chuyển tối đa 1.000 tài liệu.', 'Move up to 1,000 documents at a time.')}</p>}

    {view === 'normal' ? <>
      {immediateFolders.length > 0 && <div className="library-folder-grid" aria-label={text('Thư mục con', 'Subfolders')}>
        {immediateFolders.map(folder => <div key={folder.id} className="library-folder-card">
          <button type="button" className="library-folder-card-open" disabled={busy} aria-label={text(`Mở thư mục ${folder.name}`, `Open folder ${folder.name}`)} onClick={() => navigate(folder.id)}><Folder size={27} aria-hidden="true" /><span><strong>{folder.name}</strong><small title={text('Bao gồm tài liệu trong thư mục con', 'Includes documents in subfolders')}>{text(`${counts.get(folder.id) ?? 0} tài liệu`, `${counts.get(folder.id) ?? 0} documents`)}</small></span></button>
          {folderActions(folder)}
        </div>)}
      </div>}
      {normalBooks.length > 0 && <div className="book-grid library-folder-book-grid">
        {normalBooks.map(book => <div className={`library-folder-book${selected.has(book.id) ? ' is-selected' : ''}`} key={book.id}>
          {filterActive && <p className="library-book-path" title={fullPath(state.bookFolders.get(book.id) ?? null)}>{fullPath(state.bookFolders.get(book.id) ?? null)}</p>}
          {renderBook(book)}
          <div className="library-book-controls"><label>{bookSelection(book)}<span>{text('Chọn', 'Select')}</span></label>{bookMove(book)}</div>
        </div>)}
      </div>}
      {!normalBooks.length && <div className="library-folders-empty"><BookOpen size={25} aria-hidden="true" /><p>{filterActive ? text('Không có tài liệu phù hợp với bộ lọc.', 'No documents match these filters.') : currentFolder ? text('Thư mục này chưa có tài liệu. Chọn tài liệu từ tủ sách để thêm vào đây.', 'This folder has no documents yet. Choose documents from your library to add here.') : text('Chưa có tài liệu ở đây. Dùng “Chuyển…” trên một tài liệu để đưa vào thư mục này.', 'No documents here yet. Use “Move…” on a document to place it in this folder.')}</p>{currentFolder && !filterActive && <button type="button" className="library-folder-button library-folder-submit" disabled={busy} onClick={event => openDialog({ kind: 'addBooks', folderId: currentFolder.id }, event.currentTarget)}><Plus size={16} aria-hidden="true" />{text('Chọn tài liệu từ tủ sách', 'Choose documents from library')}</button>}</div>}
    </> : <>
      <ul className="library-folder-tree" aria-label={text('Cây thư mục tủ sách', 'Library folder tree')}>
        {treeRows.map(row => row.kind === 'folder' ? <li className={`library-tree-row library-tree-folder${current === row.folder.id ? ' is-current' : ''}`} key={`folder:${row.folder.id}`} style={{ '--library-depth': Math.min(row.depth, 6) } as CSSProperties}>
          <button type="button" className="library-tree-expand" disabled={busy} aria-expanded={isExpanded(row.folder.id)} aria-label={isExpanded(row.folder.id) ? text(`Thu gọn ${row.folder.name}`, `Collapse ${row.folder.name}`) : text(`Mở rộng ${row.folder.name}`, `Expand ${row.folder.name}`)} onClick={() => toggleExpanded(row.folder.id)}>{isExpanded(row.folder.id) ? <ChevronDown size={16} /> : <ChevronRight size={16} />}</button>
          <button type="button" className="library-tree-name" disabled={busy} aria-current={current === row.folder.id ? 'location' : undefined} title={row.folder.name} onClick={() => navigate(row.folder.id)}>{isExpanded(row.folder.id) ? <FolderOpen size={19} aria-hidden="true" /> : <Folder size={19} aria-hidden="true" />}<span>{row.folder.name}</span></button>
          <span className="library-tree-count" title={text('Số tài liệu, gồm thư mục con', 'Documents, including subfolders')}>{counts.get(row.folder.id) ?? 0}</span>{folderActions(row.folder)}
        </li> : <li className={`library-tree-row library-tree-book${selected.has(row.book.id) ? ' is-selected' : ''}`} key={`book:${row.book.id}`} style={{ '--library-depth': Math.min(row.depth, 6) } as CSSProperties}>
          {bookSelection(row.book)}<BookOpen size={16} className="library-tree-book-icon" aria-hidden="true" /><button type="button" className="library-tree-book-title" title={row.book.title} aria-label={text(`Mở ${row.book.title}`, `Open ${row.book.title}`)} disabled={busy} onClick={() => onOpenBook(row.book)}><span>{row.book.title}</span>{row.book.author && <small>{row.book.author}</small>}</button>
          <button type="button" className="library-folder-link library-tree-details" disabled={busy} aria-label={text(`Chi tiết ${row.book.title}`, `Details for ${row.book.title}`)} onClick={() => onDetailsBook(row.book)}>{text('Chi tiết', 'Details')}</button>{bookMove(row.book)}
        </li>)}
      </ul>
      {!treeRows.length && <div className="library-folders-empty"><Folder size={25} aria-hidden="true" /><p>{filterActive ? text('Không có tài liệu phù hợp với bộ lọc.', 'No documents match these filters.') : text('Tạo thư mục để sắp xếp tài liệu trong tủ sách.', 'Create a folder to organize your library documents.')}</p></div>}
    </>}
    </>}

    {dialog && <FolderModal title={dialogTitle} id={dialogId} busy={busy} lang={lang} onClose={closeDialog} onSubmit={submit} onReturnFocus={restoreFocus}>
      {(dialog.kind === 'create' || dialog.kind === 'rename') && <>
        <p className="library-dialog-context">{dialog.kind === 'create' ? fullPath(dialog.parentId) : dialogFolder?.name}</p>
        <label htmlFor={`${dialogId}-name`}>{text('Tên thư mục', 'Folder name')}</label>
        <input id={`${dialogId}-name`} data-autofocus value={name} disabled={busy} onChange={event => setName(event.target.value)} maxLength={80} required autoComplete="off" />
      </>}
      {(dialog.kind === 'moveBooks' || dialog.kind === 'moveFolder') && <>
        <p className="library-dialog-context">{dialog.kind === 'moveFolder' ? dialogFolder?.name : text(`${dialog.bookIds.length} tài liệu đã chọn`, `${dialog.bookIds.length} selected documents`)}</p>
        <label htmlFor={`${dialogId}-destination`}>{text('Thư mục đích', 'Destination folder')}</label>
        <select id={`${dialogId}-destination`} data-autofocus value={destination} disabled={busy} onChange={event => setDestination(event.target.value)}><option value="">{rootLabel}</option>{destinations.map(item => <option value={item.id} key={item.id}>{item.label}</option>)}</select>
      </>}
      {dialog.kind === 'addBooks' && <>
        <p className="library-dialog-context">{fullPath(dialog.folderId)}</p>
        <p className="library-add-explanation">{text('Chọn tài liệu đã có trong tủ sách của bạn. Tài liệu ở thư mục khác sẽ được chuyển vào thư mục này, không tạo bản sao.', 'Choose documents already in your library. Documents in another folder will be moved here; no copy is created.')}</p>
        <label htmlFor={`${dialogId}-search`}>{text('Tìm tài liệu', 'Search documents')}</label>
        <div className="library-add-search"><Search size={16} aria-hidden="true" /><input id={`${dialogId}-search`} data-autofocus type="search" placeholder={text('Tên sách hoặc tác giả…', 'Title or author…')} value={pickerQuery} disabled={busy} onChange={event => setPickerQuery(event.target.value)} autoComplete="off" /></div>
        <div className="library-add-selection"><p className="library-add-count" role="status">{text(`Đã chọn ${validPicked.length} / tối đa 1.000 tài liệu`, `${validPicked.length} selected / up to 1,000 documents`)}</p><div><button type="button" className="library-folder-link" disabled={busy || !pickerResults.length || validPicked.length >= 1000} onClick={selectPickerResults}>{text('Chọn kết quả', 'Select results')}</button>{validPicked.length > 0 && <button type="button" className="library-folder-link" disabled={busy} onClick={() => setPickedBooks(new Set())}>{text('Bỏ chọn', 'Clear selection')}</button>}</div></div>
        <div className="library-add-list" role="group" aria-label={text('Tài liệu trong tủ sách', 'Documents in your library')}>
          {pickerResults.map(book => <label className="library-add-item" key={book.id}><input type="checkbox" checked={validPicked.includes(book.id)} disabled={busy || (!validPicked.includes(book.id) && validPicked.length >= 1000)} onChange={() => togglePicked(book.id)} /><span><strong>{book.title}</strong>{book.author && <small>{book.author}</small>}<small>{fullPath(state.bookFolders.get(book.id) ?? null)}</small></span></label>)}
          {!pickerResults.length && <p className="library-add-empty">{addCandidates.length ? text('Không có tài liệu phù hợp. Thử tên sách hoặc tác giả khác.', 'No matching documents. Try another title or author.') : text('Không còn tài liệu nào trong tủ sách để thêm vào thư mục này.', 'There are no other library documents to add to this folder.')}</p>}
        </div>
      </>}
      {dialog.kind === 'delete' && <p className="library-delete-explanation">{text(`Xóa thư mục “${dialogFolder?.name ?? ''}” sẽ chuyển các tài liệu và thư mục con trực tiếp về “${fullPath(dialogFolder?.parentId ?? null)}”. Tài liệu và ghi chú được giữ nguyên.`, `Deleting “${dialogFolder?.name ?? ''}” moves its immediate documents and subfolders to “${fullPath(dialogFolder?.parentId ?? null)}”. Documents and notes are preserved.`)}</p>}
      {'folderId' in dialog && !dialogFolder ? <p className="library-folder-error" role="alert">{text('Thư mục này đã bị xóa. Đóng hộp thoại để tiếp tục.', 'This folder was removed. Close the dialog to continue.')}</p> : saveFailed && <p className="library-folder-error" role="alert">{text('Chưa lưu được thay đổi. Hãy kiểm tra thông báo và thử lại.', 'Changes could not be saved. Check the message and try again.')}</p>}
      <div className="library-folder-dialog-actions"><button type="button" className="library-folder-button" disabled={busy} onClick={closeDialog}>{text('Hủy', 'Cancel')}</button><button type="submit" className={`library-folder-button library-folder-submit${dialog.kind === 'delete' ? ' library-folder-delete-submit' : ''}`} disabled={busy || ('folderId' in dialog && !dialogFolder) || (dialog.kind === 'addBooks' && !validPicked.length) || ((dialog.kind === 'create' || dialog.kind === 'rename') && !name.trim())}>{busy ? text('Đang lưu…', 'Saving…') : dialog.kind === 'delete' ? text('Xóa thư mục', 'Delete folder') : dialog.kind === 'addBooks' ? text('Thêm vào thư mục', 'Add to folder') : dialog.kind === 'moveBooks' || dialog.kind === 'moveFolder' ? text('Chuyển', 'Move') : text('Lưu', 'Save')}</button></div>
    </FolderModal>}
  </section>
}

function FolderModal({ title, id, busy, lang, onClose, onSubmit, onReturnFocus, children }: { title: string; id: string; busy: boolean; lang: Lang; onClose: () => void; onSubmit: (event: FormEvent) => void; onReturnFocus: () => void; children: ReactNode }) {
  const form = useRef<HTMLFormElement>(null), returnFocus = useRef(onReturnFocus)
  useEffect(() => { returnFocus.current = onReturnFocus }, [onReturnFocus])
  useEffect(() => {
    const node = form.current
    node?.querySelector<HTMLElement>('[data-autofocus], button')?.focus()
    return () => {
      // The trigger may still be disabled while a successful submit commits.
      // Restore immediately on cancel, then retry only if the DOM update has
      // temporarily left focus on the body. Skip StrictMode's connected probe.
      returnFocus.current()
      queueMicrotask(() => { if (!node?.isConnected && document.activeElement === document.body) returnFocus.current() })
    }
  }, [])
  return <div className="modal-shade library-folder-overlay"><form ref={form} className="library-folder-dialog" role="dialog" aria-modal="true" aria-labelledby={`${id}-title`} aria-busy={busy} tabIndex={-1} onSubmit={onSubmit} onKeyDown={event => {
    if (event.key === 'Escape') { event.preventDefault(); event.stopPropagation(); if (!busy) onClose() }
    if (event.key === 'Tab') {
      const items = Array.from(form.current?.querySelectorAll<HTMLInputElement | HTMLButtonElement | HTMLSelectElement>('button, input, select') ?? []).filter(item => !item.disabled)
      const first = items[0], last = items.at(-1)
      if (!first) { event.preventDefault(); form.current?.focus() }
      else if (event.shiftKey && document.activeElement === first) { event.preventDefault(); last?.focus() }
      else if (!event.shiftKey && document.activeElement === last) { event.preventDefault(); first.focus() }
    }
  }}>
    <h2 id={`${id}-title`}>{title}</h2>
    {children}
    <button type="button" className="library-folder-dialog-close" aria-label={lang === 'vi' ? 'Đóng hộp thoại' : 'Close dialog'} disabled={busy} onClick={onClose}><X size={19} aria-hidden="true" /></button>
  </form></div>
}
