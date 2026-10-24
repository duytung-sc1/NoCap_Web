import { useEffect, useId, useMemo, useRef, useState, type CSSProperties, type ReactNode } from 'react'
import { ArrowLeft, ArrowUpRight, BookOpen, ChevronDown, ChevronRight, Expand, Folder, FolderOpen, FolderPlus, GitFork, ListTree, Maximize, Minus, Move, MoveRight, Network, Pencil, Plus, Search, Trash2, X } from 'lucide-react'
import type { Lang } from './i18n'
import { folderPath, type LibraryFolder, type LibraryFolderState } from './libraryFolders'
import { buildFolderMapModel, layoutFolderMap, visibleFolderMapRows, type FolderMapRow } from './libraryFolderMapModel'
import type { Book } from './types'
import './LibraryFolderMap.css'

export type LibraryFolderMapProps = {
  lang: Lang
  state: LibraryFolderState
  books: Book[]
  busy: boolean
  initialFolderId?: string | null
  renderBook: (book: Book) => ReactNode
  onBack: () => void
  onOpenFolder: (id: string | null) => void
  onCreateFolder: (parentId: string | null, trigger: HTMLElement) => void
  onRenameFolder: (folder: LibraryFolder, trigger: HTMLElement) => void
  onMoveFolder: (folder: LibraryFolder, trigger: HTMLElement) => void
  onDeleteFolder: (folder: LibraryFolder, trigger: HTMLElement) => void
  onMoveBooks: (ids: string[], trigger: HTMLElement) => void
  onOpenBook: (book: Book) => void
  onDetailsBook: (book: Book) => void
}

const ROOT = '__library_root__'
const MIN_ZOOM = .65
const MAX_ZOOM = 1.5
const PAGE_SIZE = 60

/** A separate, bounded overview of the same user-owned library folders. */
export function LibraryFolderMap(props: LibraryFolderMapProps) {
  const { lang, state, books, busy, initialFolderId = null, renderBook, onBack, onOpenFolder, onCreateFolder, onRenameFolder, onMoveFolder, onDeleteFolder, onMoveBooks } = props
  const vi = lang === 'vi'
  const rootName = vi ? 'Tủ sách của bạn' : 'Your library'
  const model = useMemo(() => buildFolderMapModel(state, books, lang), [state, books, lang])
  const [view, setView] = useState<'map' | 'list'>('map')
  const [scopeId, setScopeId] = useState<string | null>(initialFolderId)
  const [selectedId, setSelectedId] = useState<string | null>(initialFolderId)
  const [expanded, setExpanded] = useState<Set<string | null>>(() => new Set([null, ...model.allRows.filter(row => row.depth < 2).map(row => row.id), ...folderPath(state, initialFolderId).map(folder => folder.id)]))
  const [query, setQuery] = useState('')
  const [zoom, setZoom] = useState(1)
  const [viewport, setViewport] = useState({ width: 1000, height: 560 })
  const [dragging, setDragging] = useState(false)
  const [bookLimit, setBookLimit] = useState(PAGE_SIZE)
  const canvasRef = useRef<HTMLDivElement>(null)
  const searchRef = useRef<HTMLInputElement>(null)
  const inspectorRef = useRef<HTMLElement>(null)
  const dragRef = useRef<{ id: number; x: number; y: number; left: number; top: number } | null>(null)
  const centerOnLayoutRef = useRef(true)
  const lastCenteredViewportRef = useRef(0)
  const zoomAnchorRef = useRef<{ x: number; y: number } | null>(null)
  const searchId = useId()
  const inspectorId = useId()
  const scope = scopeId && state.folderById.has(scopeId) ? scopeId : null
  const selected = selectedId && state.folderById.has(selectedId) ? selectedId : null
  const selectedFolder = selected ? state.folderById.get(selected)! : null
  const selectedRow = model.rowById.get(selected)!
  const visible = useMemo(() => visibleFolderMapRows(model, scope, expanded, 300), [model, scope, expanded])
  const layout = useMemo(() => layoutFolderMap(visible.rows, viewport.width), [visible.rows, viewport.width])
  const worldOffset = Math.max(0, (viewport.width - layout.width * zoom) / 2)
  const nodeById = useMemo(() => new Map(layout.nodes.map(node => [node.id, node])), [layout.nodes])
  const branchColors = useMemo(() => new Map((model.children.get(null) ?? []).map((folder, index) => [folder.id, index % 4])), [model])
  const selectedPath = folderPath(state, selected)
  const selectedRoute = new Set<string | null>([null, ...selectedPath.map(folder => folder.id)])
  const scopePath = folderPath(state, scope)
  const queryText = query.trim().normalize('NFC').toLocaleLowerCase(lang)
  const searchMatches = useMemo(() => queryText ? model.allRows.filter(row => row.folder?.name.toLocaleLowerCase(lang).includes(queryText)) : [], [model, queryText, lang])
  const directBooks = model.booksByFolder.get(selected) ?? []
  const shownBooks = directBooks.slice(0, bookLimit)
  const fitScale = Math.min(1, (viewport.width - 32) / Math.max(1, layout.width), (viewport.height - 28) / Math.max(1, layout.height))
  const fitClamped = fitScale < MIN_ZOOM
  const deepTree = visible.rows.some(row => row.depth > 9)

  useEffect(() => {
    const canvas = canvasRef.current
    if (!canvas || view !== 'map') return
    const measure = () => {
      const width = canvas.clientWidth || 1000, height = canvas.clientHeight || 560
      setViewport(previous => previous.width === width && previous.height === height ? previous : { width, height })
    }
    measure()
    if (typeof ResizeObserver === 'undefined') { window.addEventListener('resize', measure); return () => window.removeEventListener('resize', measure) }
    const observer = new ResizeObserver(measure)
    observer.observe(canvas)
    return () => observer.disconnect()
  }, [view])

  useEffect(() => {
    const canvas = canvasRef.current
    if (view !== 'map' || !canvas) return
    if (centerOnLayoutRef.current || lastCenteredViewportRef.current !== viewport.width) {
      canvas.scrollLeft = Math.max(0, (layout.width * zoom - viewport.width) / 2)
      canvas.scrollTop = 0
      centerOnLayoutRef.current = false
      lastCenteredViewportRef.current = viewport.width
    } else if (zoomAnchorRef.current) {
      canvas.scrollLeft = Math.max(0, zoomAnchorRef.current.x * zoom + worldOffset - viewport.width / 2)
      canvas.scrollTop = Math.max(0, zoomAnchorRef.current.y * zoom - viewport.height / 2)
    }
    zoomAnchorRef.current = null
  }, [layout, zoom, viewport.width, viewport.height, worldOffset, view])

  const label = (row: FolderMapRow) => row.folder?.name ?? rootName
  const count = (row: FolderMapRow) => vi ? `${row.childCount} nhánh · ${row.totalBookCount} tài liệu` : `${row.childCount} branches · ${row.totalBookCount} documents`
  const branch = (row: FolderMapRow): CSSProperties => ({ '--folder-branch': branchColors.get(row.branchId ?? '') ?? 0 }) as CSSProperties
  function toggle(id: string | null) { setExpanded(previous => { const next = new Set(previous); if (next.has(id)) next.delete(id); else next.add(id); return next }) }
  function choose(id: string | null) { setSelectedId(id); setBookLimit(PAGE_SIZE) }
  function createFolder(parentId: string | null, trigger: HTMLElement) {
    setExpanded(previous => new Set([...previous, parentId]))
    onCreateFolder(parentId, trigger)
  }
  function focusBranch(id: string | null) {
    centerOnLayoutRef.current = true
    zoomAnchorRef.current = null
    setScopeId(id); choose(id); setExpanded(previous => new Set([...previous, id, ...(model.children.get(id) ?? []).map(folder => folder.id)]))
    setQuery(''); setZoom(1)
    if (canvasRef.current) { canvasRef.current.scrollLeft = 0; canvasRef.current.scrollTop = 0 }
  }
  function fit() {
    const nextZoom = Math.max(MIN_ZOOM, fitScale)
    centerOnLayoutRef.current = true
    zoomAnchorRef.current = null
    setZoom(nextZoom)
    if (canvasRef.current) { canvasRef.current.scrollLeft = Math.max(0, (layout.width * nextZoom - viewport.width) / 2); canvasRef.current.scrollTop = 0 }
  }
  function revealFocusedNode(id: string | null) {
    const node = nodeById.get(id), canvas = canvasRef.current
    if (!node || !canvas) return
    const left = node.x * zoom + worldOffset, top = node.y * zoom, right = (node.x + node.width) * zoom + worldOffset, bottom = (node.y + node.height) * zoom
    if (left < canvas.scrollLeft || right > canvas.scrollLeft + canvas.clientWidth) canvas.scrollLeft = Math.max(0, left - 24)
    if (top < canvas.scrollTop || bottom > canvas.scrollTop + canvas.clientHeight) canvas.scrollTop = Math.max(0, top - 24)
  }
  function changeZoom(delta: number) {
    const nextZoom = Math.max(MIN_ZOOM, Math.min(MAX_ZOOM, Math.round((zoom + delta) * 100) / 100))
    if (nextZoom === zoom) return
    const canvas = canvasRef.current
    if (canvas) zoomAnchorRef.current = { x: (canvas.scrollLeft + viewport.width / 2 - worldOffset) / zoom, y: (canvas.scrollTop + viewport.height / 2) / zoom }
    setZoom(nextZoom)
  }

  return <section className="library-map-page" aria-label={vi ? 'Bản đồ tủ sách' : 'Library map'}>
    <header className="library-map-heading">
      <div><button type="button" className="library-map-back" onClick={onBack}><ArrowLeft size={17} />{vi ? 'Về tủ sách' : 'Back to library'}</button>
        <h1>{vi ? 'Bản đồ tủ sách' : 'Library map'}</h1><p>{vi ? 'Nhìn tổng thể các nhánh thư mục và tài liệu bên trong.' : 'Explore your folder hierarchy and the documents inside.'}</p></div>
      <button type="button" className="library-map-button" disabled={busy} onClick={event => createFolder(scope, event.currentTarget)}><FolderPlus size={17} />{vi ? 'Thư mục mới' : 'New folder'}</button>
    </header>

    <div className="library-map-toolbar">
      <div className="library-map-view" role="group" aria-label={vi ? 'Cách xem cấu trúc tủ sách' : 'Library structure view'}>
        <button type="button" aria-pressed={view === 'map'} onClick={() => { centerOnLayoutRef.current = true; setView('map') }}><Network size={17} />{vi ? 'Sơ đồ cây' : 'Tree map'}</button>
        <button type="button" aria-pressed={view === 'list'} onClick={() => setView('list')}><ListTree size={17} />{vi ? 'Danh sách' : 'Folder list'}</button>
      </div>
      <div className="library-map-tools">
        <button type="button" className="library-map-button" onClick={() => setExpanded(new Set([null, ...model.allRows.map(row => row.id)]))}><Expand size={16} />{vi ? 'Mở tất cả' : 'Expand all'}</button>
        <button type="button" className="library-map-button" onClick={() => setExpanded(new Set([scope]))}><ChevronRight size={16} />{vi ? 'Thu gọn' : 'Collapse all'}</button>
        {view === 'map' && <><button type="button" className="library-map-button" onClick={fit} title={vi ? 'Căn sơ đồ trong vùng xem, giữ chữ đủ lớn để đọc' : 'Fit the map while keeping labels readable'}><Maximize size={16} />{vi ? 'Căn sơ đồ' : 'Fit view'}</button>
          <div className="library-map-zoom" role="group" aria-label={vi ? 'Thu phóng sơ đồ' : 'Map zoom'}><button type="button" disabled={zoom <= MIN_ZOOM} onClick={() => changeZoom(-.1)} aria-label={vi ? 'Thu nhỏ' : 'Zoom out'}><Minus size={16} /></button><output>{Math.round(zoom * 100)}%</output><button type="button" disabled={zoom >= MAX_ZOOM} onClick={() => changeZoom(.1)} aria-label={vi ? 'Phóng to' : 'Zoom in'}><Plus size={16} /></button></div></>}
      </div>
    </div>

    <div className="library-map-navigation">
      <nav aria-label={vi ? 'Nhánh đang xem' : 'Current branch'}><button type="button" onClick={() => focusBranch(null)}>{rootName}</button>{scopePath.length > 4 && <span title={scopePath.map(folder => folder.name).join(' / ')}>…</span>}{scopePath.slice(-4).map(folder => <span key={folder.id}><ChevronRight size={14} /><button type="button" aria-current={folder.id === scope ? 'location' : undefined} onClick={() => focusBranch(folder.id)}>{folder.name}</button></span>)}</nav>
      <div className="library-map-search"><Search size={16} /><label className="library-map-sr-only" htmlFor={searchId}>{vi ? 'Tìm thư mục trong toàn tủ sách' : 'Search all library folders'}</label><input id={searchId} ref={searchRef} value={query} onChange={event => setQuery(event.target.value)} placeholder={vi ? 'Tìm thư mục trong toàn tủ sách…' : 'Search all library folders…'} onKeyDown={event => { if (event.key === 'Escape') { event.stopPropagation(); setQuery('') } }} />{query && <button type="button" aria-label={vi ? 'Xóa tìm kiếm' : 'Clear search'} onClick={() => { setQuery(''); searchRef.current?.focus() }}><X size={15} /></button>}</div>
    </div>

    <div className="library-map-selection-summary"><div role="status" aria-live="polite"><strong>{vi ? 'Đang chọn: ' : 'Selected: '}{selectedFolder?.name ?? rootName}</strong><span title={[rootName, ...selectedPath.map(folder => folder.name)].join(' / ')}>{[rootName, ...(selectedPath.length > 3 ? ['…'] : []), ...selectedPath.slice(-3).map(folder => folder.name)].join(' / ')}</span><small>{vi ? `${directBooks.length} tài liệu trực tiếp · ${selectedRow.totalBookCount} tài liệu toàn nhánh` : `${directBooks.length} direct documents · ${selectedRow.totalBookCount} documents in branch`}</small></div><div><button type="button" className="library-map-button" onClick={() => { inspectorRef.current?.scrollIntoView?.({ behavior: 'auto', block: 'start' }); inspectorRef.current?.focus({ preventScroll: true }) }}><BookOpen size={16} />{vi ? 'Xem tài liệu' : 'View documents'}</button>{selected !== scope && <button type="button" className="library-map-button" onClick={() => focusBranch(selected)}><GitFork size={16} />{vi ? 'Xem riêng nhánh' : 'Focus branch'}</button>}</div></div>

    {queryText && <div className="library-map-search-results" aria-label={vi ? 'Kết quả tìm thư mục' : 'Folder search results'}><p role="status">{vi ? `${searchMatches.length} thư mục phù hợp${searchMatches.length > 40 ? ' · Hiển thị 40 kết quả đầu, hãy nhập thêm để thu hẹp.' : ''}` : `${searchMatches.length} matching folders${searchMatches.length > 40 ? ' · Showing the first 40; refine your search.' : ''}`}</p>{searchMatches.slice(0, 40).map(row => <button type="button" key={row.id} onClick={() => focusBranch(row.id)}><Folder size={17} /><span><strong>{label(row)}</strong><small>{[rootName, ...folderPath(state, row.parentId).slice(-3).map(folder => folder.name)].join(' / ')}</small></span><ArrowUpRight size={16} /></button>)}</div>}

    {visible.truncated && <p className="library-map-hint" role="status">{vi ? 'Sơ đồ đang hiển thị tối đa 300 thư mục để giữ thao tác mượt. Tìm tên thư mục hoặc chọn “Xem riêng nhánh” để xem phần còn lại.' : 'Showing up to 300 folders to keep the map responsive. Search any folder or focus a branch to explore the rest.'}</p>}
    {deepTree && <p className="library-map-hint">{vi ? 'Nhánh có hơn 9 cấp: khoảng thụt dòng được giới hạn để tránh sơ đồ quá rộng; đường nối và cột Cấp vẫn giữ đúng quan hệ. Chọn “Xem riêng nhánh” để xem rõ các cấp sâu hơn.' : 'This branch exceeds 9 levels: indentation is capped to avoid an excessively wide map; connectors and the Level column retain the hierarchy. Focus a branch to see deeper levels clearly.'}</p>}
    {view === 'map' ? <>
      <div className={`library-map-canvas${dragging ? ' is-dragging' : ''}`} ref={canvasRef} tabIndex={0} role="region" aria-label={vi ? 'Sơ đồ thư mục, gốc ở trên và các nhánh trải ngang. Cuộn hoặc kéo nền để di chuyển.' : 'Folder map with root at the top and branches across. Scroll or drag the background to pan.'}
        onPointerDown={event => {
          if (event.pointerType === 'touch' || event.button !== 0 || (event.target as Element).closest('button')) return
          const canvas = event.currentTarget
          dragRef.current = { id: event.pointerId, x: event.clientX, y: event.clientY, left: canvas.scrollLeft, top: canvas.scrollTop }
          canvas.setPointerCapture?.(event.pointerId); setDragging(true)
        }}
        onPointerMove={event => { const drag = dragRef.current; if (drag?.id !== event.pointerId) return; event.currentTarget.scrollLeft = drag.left + drag.x - event.clientX; event.currentTarget.scrollTop = drag.top + drag.y - event.clientY }}
        onPointerUp={event => { if (dragRef.current?.id === event.pointerId) { dragRef.current = null; setDragging(false); event.currentTarget.releasePointerCapture?.(event.pointerId) } }}
        onPointerCancel={() => { dragRef.current = null; setDragging(false) }} onLostPointerCapture={() => { dragRef.current = null; setDragging(false) }}>
        <div className="library-map-scroll-size" style={{ width: Math.max(viewport.width - 2, layout.width * zoom), height: layout.height * zoom }}>
          <div className="library-map-world" style={{ left: worldOffset, width: layout.width, height: layout.height, transform: `scale(${zoom})`, '--map-inverse': 1 / zoom } as CSSProperties}>
            <svg className="library-map-edges" width={layout.width} height={layout.height} aria-hidden="true">{layout.edges.map(edge => {
              const from = nodeById.get(edge.parentId), to = nodeById.get(edge.childId)
              if (!from || !to) return null
              const main = from.id === scope
              const fromX = main ? from.x + from.width / 2 : from.x + 15, fromY = from.y + from.height
              const toX = main ? to.x + to.width / 2 : to.x, toY = main ? to.y : to.y + to.height / 2
              const splitY = fromY + 22
              const path = main ? `M${fromX} ${fromY} V${splitY} H${toX} V${toY}` : `M${fromX} ${fromY} V${toY - 8} Q${fromX} ${toY} ${fromX + 8} ${toY} H${toX}`
              return <g key={edge.childId} data-branch={branchColors.get(to.branchId ?? '') ?? 0} className={selectedRoute.has(from.id) && selectedRoute.has(to.id) ? 'is-selected-route' : undefined}><path d={path} /><circle cx={toX} cy={toY} r={2.5} /></g>
            })}</svg>
            {layout.nodes.map(node => <div key={node.id ?? ROOT} className={`library-map-node${node.id === selected ? ' is-selected' : ''}${node.id === scope ? ' is-root' : ''}`} data-branch={branchColors.get(node.branchId ?? '') ?? 0} style={{ ...branch(node), left: node.x, top: node.y, width: node.width, height: node.height }}>
              <button type="button" className="library-map-node-main" aria-label={`${vi ? 'Chọn thư mục' : 'Select folder'} ${label(node)}. ${count(node)}`} aria-pressed={node.id === selected} aria-controls={inspectorId} title={label(node)} onClick={() => choose(node.id)} onFocus={() => revealFocusedNode(node.id)}>{node.id === null || expanded.has(node.id) ? <FolderOpen size={24} /> : <Folder size={24} />}<span><strong>{label(node)}</strong><small>{count(node)}</small></span></button>
              {node.childCount > 0 && <button type="button" className="library-map-node-toggle" aria-expanded={expanded.has(node.id)} aria-label={`${expanded.has(node.id) ? vi ? 'Thu gọn' : 'Collapse' : vi ? 'Mở rộng' : 'Expand'} ${label(node)}`} onFocus={() => revealFocusedNode(node.id)} onClick={() => toggle(node.id)}>{expanded.has(node.id) ? <ChevronDown size={16} /> : <ChevronRight size={16} />}</button>}
            </div>)}
          </div>
        </div>
      </div>
      <p className="library-map-gesture"><Move size={15} />{fitClamped ? vi ? 'Nhánh rộng: kéo/cuộn để xem tiếp hoặc chọn thư mục rồi “Xem riêng nhánh”. Giữ thu phóng tối thiểu 65% để chữ dễ đọc.' : 'Large branch: pan/scroll or select a folder and focus its branch. Zoom stays at 65% or above for readable labels.' : vi ? 'Kéo nền hoặc cuộn để di chuyển · Chọn thư mục để xem tài liệu bên dưới' : 'Drag the background or scroll to pan · Select a folder to see its documents below'}</p>
    </> : <div className="library-map-table-wrap"><table className="library-map-table"><thead><tr><th>{vi ? 'Tên thư mục' : 'Folder name'}</th><th>{vi ? 'Thư mục cha' : 'Parent folder'}</th><th>{vi ? 'Cấp' : 'Level'}</th><th>{vi ? 'Tài liệu' : 'Documents'}</th><th>{vi ? 'Cập nhật' : 'Updated'}</th></tr></thead><tbody>{visible.rows.map(row => <tr key={row.id ?? ROOT} className={row.id === selected ? 'is-selected' : ''}><td><div className="library-map-list-name" style={{ '--map-depth': Math.min(8, row.depth) } as CSSProperties}>{row.childCount > 0 ? <button type="button" className="library-map-list-toggle" aria-expanded={expanded.has(row.id)} aria-label={`${expanded.has(row.id) ? vi ? 'Thu gọn' : 'Collapse' : vi ? 'Mở rộng' : 'Expand'} ${label(row)}`} onClick={() => toggle(row.id)}>{expanded.has(row.id) ? <ChevronDown size={16} /> : <ChevronRight size={16} />}</button> : <span className="library-map-list-spacer" />}<button type="button" className="library-map-list-select" aria-pressed={row.id === selected} onClick={() => choose(row.id)}><Folder size={19} /><span>{label(row)}</span></button></div></td><td>{row.folder?.parentId ? state.folderById.get(row.folder.parentId)?.name ?? rootName : row.folder ? rootName : '—'}</td><td>{row.id ? folderPath(state, row.id).length : 0}</td><td>{row.totalBookCount}</td><td>{row.folder?.updatedAt ? new Date(row.folder.updatedAt).toLocaleDateString(vi ? 'vi-VN' : 'en-GB') : '—'}</td></tr>)}</tbody></table></div>}

    <section id={inspectorId} ref={inspectorRef} tabIndex={-1} className="library-map-inspector" aria-label={vi ? 'Thư mục đang chọn' : 'Selected folder'}>
      <div className="library-map-inspector-heading"><div><h2>{selectedFolder?.name ?? rootName}</h2><p className="library-map-selected-path" title={[rootName, ...selectedPath.map(folder => folder.name)].join(' / ')}>{[rootName, ...(selectedPath.length > 4 ? ['…'] : []), ...selectedPath.slice(-4).map(folder => folder.name)].join(' / ')}</p><p>{vi ? `${selectedRow.childCount} thư mục con · ${directBooks.length} tài liệu trực tiếp · ${selectedRow.totalBookCount} tài liệu toàn nhánh` : `${selectedRow.childCount} subfolders · ${directBooks.length} direct documents · ${selectedRow.totalBookCount} documents in branch`}</p></div>
        <div className="library-map-inspector-actions"><button type="button" className="library-map-button is-primary" onClick={() => onOpenFolder(selected)}><FolderOpen size={16} />{vi ? 'Mở thư mục' : 'Open folder'}</button></div>
      </div>
      <div className="library-map-folder-actions"><button type="button" className="library-map-button" disabled={busy} onClick={event => createFolder(selected, event.currentTarget)}><FolderPlus size={16} />{vi ? 'Tạo thư mục con' : 'New subfolder'}</button>{selectedFolder && <><button type="button" className="library-map-button" disabled={busy} onClick={event => onRenameFolder(selectedFolder, event.currentTarget)}><Pencil size={15} />{vi ? 'Đổi tên' : 'Rename'}</button><button type="button" className="library-map-button" disabled={busy} onClick={event => onMoveFolder(selectedFolder, event.currentTarget)}><MoveRight size={16} />{vi ? 'Di chuyển thư mục' : 'Move folder'}</button><button type="button" className="library-map-button is-danger" disabled={busy} onClick={event => onDeleteFolder(selectedFolder, event.currentTarget)}><Trash2 size={15} />{vi ? 'Xóa thư mục' : 'Delete folder'}</button></>}</div>
      <h3><BookOpen size={17} />{vi ? 'Tài liệu trong thư mục này' : 'Documents in this folder'}</h3>
      {directBooks.length ? <><div className="library-map-books">{shownBooks.map(book => <div key={book.id} className="library-map-book">{renderBook(book)}<button type="button" className="library-map-button library-map-book-move" disabled={busy} onClick={event => onMoveBooks([book.id], event.currentTarget)}><MoveRight size={15} />{vi ? 'Chuyển tài liệu' : 'Move document'}</button></div>)}</div>{shownBooks.length < directBooks.length && <button type="button" className="library-map-button library-map-load-more" onClick={() => setBookLimit(previous => previous + PAGE_SIZE)}>{vi ? `Xem thêm · ${shownBooks.length}/${directBooks.length} tài liệu` : `Show more · ${shownBooks.length}/${directBooks.length} documents`}</button>}</> : <p className="library-map-empty">{selectedRow.totalBookCount ? vi ? 'Tài liệu đang nằm trong các thư mục con. Chọn một nhánh phía trên để xem.' : 'Documents are in subfolders. Select a branch above to see them.' : vi ? 'Thư mục này chưa có tài liệu.' : 'This folder has no documents yet.'}</p>}
    </section>
  </section>
}
