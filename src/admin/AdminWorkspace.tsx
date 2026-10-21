import { useEffect, useRef, useState, type FormEvent, type ReactNode } from 'react'
import { BarChart3, BookOpen, CreditCard, Database, History, LayoutDashboard, Megaphone, Plus, RefreshCw, Tags, Users } from 'lucide-react'
import { ApiError } from '../api'
import type { Lang } from '../i18n'
import { adminRequest, type AdminCategory, type AdminIdentity, type AdminUser, type Announcement, type AuditEntry, type CatalogRow, type Conflict, type Overview, type PageResult, type StorageScan } from './api'
import './AdminWorkspace.css'
import { adminError } from './errors'
import { AdminTransactions } from './AdminTransactions'
import { AdminAnalytics } from './AdminAnalytics'
import { AdminPayments } from './AdminPayments'

type View = 'overview' | 'analytics' | 'payments' | 'catalog' | 'categories' | 'users' | 'announcements' | 'storage' | 'audit'
type Dataset = { overview?: Overview; catalog?: PageResult<CatalogRow>; categories?: PageResult<AdminCategory>; users?: PageResult<AdminUser>; announcements?: PageResult<Announcement>; audit?: PageResult<AuditEntry> }
type Modal = { kind: 'book'; row?: CatalogRow } | { kind: 'category'; item?: AdminCategory }
  | { kind: 'announcement'; item?: Announcement } | { kind: 'conflicts'; user: AdminUser } | { kind: 'transactions'; user: AdminUser } | { kind: 'avatar' }
  | { kind: 'confirm'; title: string; description: string; endpoint: string; data: object; days?: boolean }
type Props = { token: string; admin: AdminIdentity; lang: Lang; onSignIn: () => void; onCatalogChanged: () => void; onProfileChanged: () => void; onAccessLost: () => void }

function Table({ heads, rows, label, className }: { heads: string[]; rows: ReactNode[][]; label: string; className?: string }) {
  return <div className="admin-table-wrap" role="region" aria-label={label} tabIndex={0}><table className={className}><thead><tr>{heads.map(head => <th key={head} scope="col">{head}</th>)}</tr></thead><tbody>{rows.map((cells, index) => <tr key={index}>{cells.map((cell, i) => <td key={i}>{cell}</td>)}</tr>)}</tbody></table></div>
}

function ModalShell({ title, children, busy, close, wide = false }: { title: string; children: ReactNode; busy: boolean; close: () => void; wide?: boolean }) {
  const panel = useRef<HTMLDivElement>(null)
  const closeRef = useRef(close)
  const busyRef = useRef(busy)
  useEffect(() => { closeRef.current = close; busyRef.current = busy }, [close, busy])
  useEffect(() => {
    const previous = document.activeElement as HTMLElement | null
    const previousOverflow = document.body.style.overflow
    document.body.style.overflow = 'hidden'
    const focusable = 'button:not(:disabled), input:not(:disabled), textarea:not(:disabled), select:not(:disabled), [tabindex="0"]'
    const initial = panel.current?.querySelector<HTMLElement>(focusable) || panel.current
    initial?.focus()
    const onKey = (event: KeyboardEvent) => {
      if (event.key === 'Escape') { event.preventDefault(); event.stopImmediatePropagation(); if (!busyRef.current) closeRef.current() }
      if (event.key !== 'Tab') return
      const nodes = Array.from(panel.current?.querySelectorAll<HTMLElement>(focusable) || [])
        .sort((a, b) => a === b ? 0 : a.compareDocumentPosition(b) & Node.DOCUMENT_POSITION_FOLLOWING ? -1 : 1)
      const first = nodes[0], last = nodes.at(-1)
      if (!nodes.length) { event.preventDefault(); panel.current?.focus() }
      else if (!panel.current?.contains(document.activeElement)) { event.preventDefault(); (event.shiftKey ? last : first)?.focus() }
      else if (event.shiftKey && document.activeElement === first) { event.preventDefault(); last?.focus() }
      else if (!event.shiftKey && document.activeElement === last) { event.preventDefault(); first?.focus() }
    }
    document.addEventListener('keydown', onKey, true)
    return () => { document.removeEventListener('keydown', onKey, true); document.body.style.overflow = previousOverflow; previous?.focus() }
  }, [])
  return <div className="modal-shade admin-modal-shade" onMouseDown={event => { if (event.target === event.currentTarget && !busy) close() }}><div ref={panel} className={`dialog admin-dialog${wide ? ' admin-dialog-wide' : ''}`} role="dialog" aria-modal="true" aria-labelledby="admin-dialog-title" tabIndex={-1}><h2 id="admin-dialog-title">{title}</h2>{children}</div></div>
}

const emptyStorage: StorageScan['groups'] = { public: { objects: 0, bytes: 0 }, private: { objects: 0, bytes: 0 }, other: { objects: 0, bytes: 0 } }
const localTime = (value: string | null) => value ? new Date(Date.parse(value) - new Date(value).getTimezoneOffset() * 60000).toISOString().slice(0, 16) : ''

export default function AdminWorkspace({ token, admin, lang, onSignIn, onCatalogChanged, onProfileChanged, onAccessLost }: Props) {
  const text = (vi: string, en: string) => lang === 'vi' ? vi : en
  const [view, setView] = useState<View>('overview')
  const [page, setPage] = useState(0)
  const [query, setQuery] = useState('')
  const [search, setSearch] = useState('')
  const [revision, setRevision] = useState(0)
  const [resource, setResource] = useState<{ key: string; data?: Dataset; error?: string } | null>(null)
  const [modal, setModal] = useState<Modal | null>(null)
  const [busy, setBusy] = useState(false)
  const busyRef = useRef(false)
  const lifetime = useRef<AbortController | null>(null)
  const [formError, setFormError] = useState('')
  const [notice, setNotice] = useState('')
  const [reauth, setReauth] = useState(false)
  const [storage, setStorage] = useState<{ groups: StorageScan['groups']; cursor: string | null; complete: boolean; measuredAt: string } | null>(null)
  const [avatar, setAvatar] = useState(admin.photoUrl || '')
  const [conflictPage, setConflictPage] = useState(0)
  const [conflicts, setConflicts] = useState<{ key: string; data?: PageResult<Conflict>; error?: string } | null>(null)
  const [categoryOptions, setCategoryOptions] = useState<AdminCategory[]>([])
  const [bookCategory, setBookCategory] = useState('')
  const key = JSON.stringify([view, page, search, revision, lang])
  const loaded = resource?.key === key ? resource : null
  const data = loaded?.data
  const loading = !loaded
  const sections = [
    { id: 'overview' as const, label: text('Tổng quan', 'Overview'), icon: LayoutDashboard },
    { id: 'analytics' as const, label: text('Thống kê Web', 'Web Analytics'), icon: BarChart3 },
    { id: 'payments' as const, label: text('Giao dịch & Pro', 'Payments & Pro'), icon: CreditCard },
    { id: 'catalog' as const, label: text('Sách', 'Books'), icon: BookOpen },
    { id: 'categories' as const, label: text('Thể loại', 'Categories'), icon: Tags },
    { id: 'users' as const, label: text('Người dùng & Pro', 'Users & Pro'), icon: Users },
    { id: 'announcements' as const, label: text('Thông báo', 'Announcements'), icon: Megaphone },
    { id: 'storage' as const, label: text('Dung lượng R2', 'R2 storage'), icon: Database },
    { id: 'audit' as const, label: text('Lịch sử thao tác', 'Audit log'), icon: History },
  ]
  const title = sections.find(section => section.id === view)!.label
  const date = (value?: string | number | null) => value ? new Date(value).toLocaleString(lang === 'vi' ? 'vi-VN' : 'en-US') : '—'
  const button = (label: string, onClick: () => void, disabled = false) => <button type="button" className="secondary" disabled={disabled || busy} onClick={onClick}>{label}</button>
  const handleFailure = (error: unknown) => {
    if (error instanceof ApiError && error.status === 401) setReauth(true)
    if (error instanceof ApiError && error.status === 403 && ['ADMIN_REQUIRED', 'FORBIDDEN', 'EMAIL_NOT_VERIFIED'].includes(error.code || '')) { setModal(null); onAccessLost() }
    return adminError(error, lang)
  }
  useEffect(() => {
    const controller = new AbortController(); lifetime.current = controller
    return () => controller.abort()
  }, [token])
  useEffect(() => {
    const controller = new AbortController()
    const paths: Record<View, string> = { overview: 'overview', analytics: '', payments: '', catalog: `catalog?page=${page}&q=${encodeURIComponent(search)}`, categories: 'categories', users: `users?page=${page}&q=${encodeURIComponent(search)}`, announcements: 'announcements', storage: '', audit: `audit?page=${page}` }
    const path = paths[view]
    void (path ? adminRequest<unknown>(token, path, controller.signal) : Promise.resolve(null)).then(value => {
      if (!controller.signal.aborted) setResource({ key, data: path ? { [view]: value } : {} })
    }).catch(error => {
      if (!controller.signal.aborted) setResource({ key, error: handleFailure(error) })
    })
    return () => controller.abort()
    // Request identity includes all filters; callbacks only report this request's failure.
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [token, key])
  useEffect(() => {
    if (modal?.kind !== 'book') return
    const controller = new AbortController()
    void adminRequest<PageResult<AdminCategory>>(token, 'categories', controller.signal).then(result => {
      if (!controller.signal.aborted) setCategoryOptions(result.items)
    }).catch(error => { if (!controller.signal.aborted) setFormError(handleFailure(error)) })
    return () => controller.abort()
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [token, modal?.kind])
  const conflictKey = modal?.kind === 'conflicts' ? `${modal.user.id}:${conflictPage}:${lang}` : ''
  useEffect(() => {
    if (modal?.kind !== 'conflicts') return
    const controller = new AbortController()
    void adminRequest<PageResult<Conflict>>(token, `users/conflicts?id=${encodeURIComponent(modal.user.id)}&page=${conflictPage}`, controller.signal).then(result => {
      if (!controller.signal.aborted) setConflicts({ key: conflictKey, data: result })
    }).catch(error => { if (!controller.signal.aborted) setConflicts({ key: conflictKey, error: handleFailure(error) }) })
    return () => controller.abort()
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [token, conflictKey])
  const open = (next: Modal) => { setFormError(''); setReauth(false); setConflictPage(0); if (next.kind === 'book') setBookCategory(next.row?.book.categoryId || ''); setModal(next) }
  const confirm = (label: string, description: string, endpoint: string, values: object, days = false) => open({ kind: 'confirm', title: label, description, endpoint, data: values, days })
  const signInAgain = () => { setModal(null); onSignIn() }
  async function submit(event: FormEvent<HTMLFormElement>) {
    event.preventDefault()
    if (!modal || busyRef.current) return
    const values = new FormData(event.currentTarget), value = (name: string) => String(values.get(name) || '').trim()
    let endpoint: string, payload: object
    try {
      const reason = value('reason')
      switch (modal.kind) {
        case 'book': endpoint = 'catalog/save'; payload = { id: value('id'), revision: modal.row?.revision ?? null, reason, book: { title: value('title'), author: value('author'), description: value('description'), categoryId: value('categoryId'), fileUrl: value('fileUrl'), coverUrl: value('coverUrl'), language: value('language'), isFeatured: values.has('isFeatured'), isNew: values.has('isNew') } }; break
        case 'category': endpoint = 'categories/save'; payload = { id: value('id'), name: value('name'), reason }; break
        case 'announcement': endpoint = 'announcements/save'; payload = { id: value('id'), title: value('title'), message: value('message'), type: value('type'), active: values.has('active'), startsAt: value('startsAt') ? new Date(value('startsAt')).toISOString() : null, endsAt: value('endsAt') ? new Date(value('endsAt')).toISOString() : null, reason }; break
        case 'avatar': endpoint = 'profile'; payload = { photoUrl: avatar }; break
        case 'confirm': endpoint = modal.endpoint; payload = { ...modal.data, reason, ...(modal.days ? { days: Number(value('days')) } : {}) }; break
        default: return
      }
    } catch { setFormError(text('Thời điểm không hợp lệ.', 'Invalid date or time.')); return }
    const signal = lifetime.current!.signal
    busyRef.current = true; setBusy(true); setFormError('')
    try {
      await adminRequest(token, endpoint, signal, payload)
      if (signal.aborted) return
      setModal(null); setNotice(text('Đã lưu thay đổi.', 'Changes saved.')); setRevision(n => n + 1)
      if (endpoint.startsWith('catalog/') || endpoint.startsWith('categories/')) onCatalogChanged()
      if (endpoint === 'profile') onProfileChanged()
    } catch (error) { if (!signal.aborted) setFormError(handleFailure(error)) }
    finally { if (!signal.aborted) { busyRef.current = false; setBusy(false) } }
  }
  async function scanStorage(restart: boolean) {
    if (busyRef.current || (!restart && (!storage || storage.complete))) return
    const signal = lifetime.current!.signal
    busyRef.current = true; setBusy(true); setNotice('')
    try {
      const result = await adminRequest<StorageScan>(token, `storage${!restart && storage?.cursor ? `?cursor=${encodeURIComponent(storage.cursor)}` : ''}`, signal)
      if (signal.aborted) return
      const previous = restart ? emptyStorage : storage!.groups
      const groups = Object.fromEntries(Object.entries(result.groups).map(([group, total]) => [group, { objects: previous[group as keyof typeof previous].objects + total.objects, bytes: previous[group as keyof typeof previous].bytes + total.bytes }])) as StorageScan['groups']
      setStorage({ ...result, groups })
    } catch (error) { if (!signal.aborted) setNotice(handleFailure(error)) }
    finally { if (!signal.aborted) { busyRef.current = false; setBusy(false) } }
  }
  async function chooseAvatar(file?: File) {
    if (!file || busyRef.current) return
    if (!['image/png', 'image/jpeg', 'image/webp'].includes(file.type) || file.size > 5 * 1024 * 1024) { setFormError(text('Chọn PNG, JPG hoặc WebP dưới 5 MB.', 'Choose PNG, JPG or WebP under 5 MB.')); return }
    const signal = lifetime.current!.signal, url = URL.createObjectURL(file)
    busyRef.current = true; setBusy(true); setFormError('')
    try {
      const image = new Image()
      await new Promise<void>((resolve, reject) => { image.onload = () => resolve(); image.onerror = () => reject(new Error(text('Không đọc được ảnh.', 'Could not read image.'))); image.src = url })
      if (signal.aborted) return
      const canvas = document.createElement('canvas'), ratio = Math.min(1, 96 / Math.max(image.width, image.height))
      canvas.width = Math.max(1, Math.round(image.width * ratio)); canvas.height = Math.max(1, Math.round(image.height * ratio))
      const context = canvas.getContext('2d'); if (!context) throw new Error(text('Không xử lý được ảnh.', 'Could not process image.'))
      context.drawImage(image, 0, 0, canvas.width, canvas.height)
      setAvatar(canvas.toDataURL('image/png'))
    } catch (error) { if (!signal.aborted) setFormError(adminError(error, lang)) }
    finally { URL.revokeObjectURL(url); if (!signal.aborted) { busyRef.current = false; setBusy(false) } }
  }
  const modalTitle = modal?.kind === 'confirm' ? modal.title : modal?.kind === 'book' ? text('Thông tin sách', 'Book details') : modal?.kind === 'category' ? text('Thông tin thể loại', 'Category details') : modal?.kind === 'announcement' ? text('Thông báo', 'Announcement') : modal?.kind === 'avatar' ? text('Ảnh đại diện', 'Avatar') : modal?.kind === 'transactions' ? text('Lịch sử giao dịch', 'Transaction history') : text('Xung đột đồng bộ', 'Sync conflicts')
  const field = (name: string, label: string, initial = '', required = true, maxLength = 300, type = 'text', readOnly = false) => <label>{label}<input name={name} type={type} defaultValue={initial} required={required} maxLength={maxLength} readOnly={readOnly} pattern={name === 'id' ? '[a-zA-Z0-9_-]+' : undefined} /></label>
  const resultPage = view === 'catalog' ? data?.catalog : view === 'users' ? data?.users : view === 'audit' ? data?.audit : null

  return <section className="admin-workspace" aria-label={text('Khu vực quản trị NoCap', 'NoCap administrator workspace')}>
    <header className="admin-workspace-heading"><div><p className="eyebrow">NOCAP · {text('QUẢN TRỊ', 'ADMINISTRATION')}</p><h1>{text('Quản trị thư viện', 'Library administration')}</h1><p>{text('Quản lý sách, người đọc và dịch vụ NoCap.', 'Manage books, readers and NoCap services.')}</p></div><div className="admin-identity"><strong>{admin.name || admin.email}</strong><span>{admin.email}</span>{button(text('Đổi ảnh đại diện', 'Change avatar'), () => { setAvatar(admin.photoUrl || ''); open({ kind: 'avatar' }) })}</div></header>
    <div className="admin-workspace-layout"><nav className="admin-navigation" aria-label={text('Mục quản trị', 'Administration sections')}>{sections.map(section => <button type="button" key={section.id} aria-current={view === section.id ? 'page' : undefined} disabled={busy} onClick={() => { setView(section.id); setPage(0); setSearch(''); setQuery(''); setNotice(''); setModal(null) }}><section.icon size={18} />{section.label}</button>)}</nav>
    <div className="admin-main"><div className="admin-heading-row"><h2>{title}</h2>{view !== 'analytics' && view !== 'payments' && <div key="actions" className="admin-actions"><button className="secondary" disabled={loading || busy} onClick={() => { setNotice(''); setRevision(n => n + 1) }}><RefreshCw size={15} />{text('Tải lại', 'Refresh')}</button>{['catalog', 'categories', 'announcements'].includes(view) && <button className="primary" disabled={busy || loading || !!loaded?.error} onClick={() => open(view === 'catalog' ? { kind: 'book' } : view === 'categories' ? { kind: 'category' } : { kind: 'announcement' })}><Plus size={15} />{text('Thêm mới', 'Add new')}</button>}</div>}</div>
      {(view === 'catalog' || view === 'users') && <form className="admin-search" onSubmit={event => { event.preventDefault(); setPage(0); setSearch(query) }}><label className="sr-only" htmlFor="admin-search">{text('Tìm kiếm', 'Search')}</label><input id="admin-search" value={query} onChange={event => setQuery(event.target.value)} maxLength={100} placeholder={view === 'catalog' ? text('Tên sách hoặc tác giả…', 'Book title or author…') : text('Email hoặc tên người dùng…', 'Email or display name…')} /><button className="secondary">{text('Tìm kiếm', 'Search')}</button></form>}
      {notice && <p className="admin-notice" role="status">{notice}</p>}
      {reauth && <div className="admin-notice" role="alert"><p>{text('Vui lòng đăng nhập lại để tiếp tục quản trị.', 'Sign in again to continue administration.')}</p><button className="primary" onClick={signInAgain}>{text('Đăng nhập lại', 'Sign in again')}</button></div>}
      {loading && view !== 'analytics' && view !== 'payments' && <p role="status">{text('Đang tải dữ liệu…', 'Loading data…')}</p>}
      {view === 'analytics' && <AdminAnalytics token={token} lang={lang} onError={handleFailure} onSignIn={signInAgain} />}
      {view === 'payments' && <AdminPayments token={token} lang={lang} onError={handleFailure} onSignIn={signInAgain} />}
      {loaded?.error && <div role="alert" className="admin-notice"><p>{loaded.error}</p>{button(text('Thử lại', 'Retry'), () => setRevision(n => n + 1))}</div>}
      {data?.overview && <><div className="admin-metrics">{[
        [text('Sách', 'Books'), data.overview.books], [text('Thể loại', 'Categories'), data.overview.categories], [text('Người dùng', 'Users'), data.overview.users],
        [text('Tài khoản được bật', 'Enabled accounts'), data.overview.activeUsers], ['Pro', data.overview.proSnapshots], [text('Bản ghi đồng bộ', 'Sync records'), data.overview.syncRecords], [text('Xung đột', 'Conflicts'), data.overview.syncConflicts],
      ].map(([label, count]) => <div className="admin-metric" key={String(label)}><span>{label}</span><strong>{count}</strong></div>)}</div><p className="muted">{text('Pro phản ánh trạng thái đã lưu trên máy chủ. Số thiết bị và đồng bộ không phải số người đang trực tuyến.', 'Pro reflects the stored server state. Device and sync counts are not live online presence.')}</p><p>{text('Google Play: ', 'Google Play: ')}{data.overview.playConfigured ? text('Đã cấu hình', 'Configured') : text('Chưa cấu hình', 'Not configured')}</p></>}
      {data?.catalog && <Table label={title} heads={[text('Sách', 'Book'), text('Tác giả / Ngôn ngữ', 'Author / Language'), text('Thể loại', 'Category'), text('Thao tác', 'Actions')]} rows={data.catalog.items.map(row => [<><strong>{row.book.title}</strong><small>{row.book.id}{row.book.isFeatured ? text(' · Nổi bật', ' · Featured') : ''}{row.book.isNew ? text(' · Mới', ' · New') : ''}</small></>, <>{row.book.author}<small>{row.book.language}</small></>, row.book.categoryId, <div key="actions" className="admin-actions">{button(text('Sửa', 'Edit'), () => open({ kind: 'book', row }))}{button(text('Gỡ khỏi danh mục', 'Remove from catalog'), () => confirm(text('Gỡ sách khỏi danh mục?', 'Remove book from catalog?'), text(`Gỡ “${row.book.title}”. Tệp sách và bản đã tải được giữ nguyên.`, `Remove “${row.book.title}”. Files and downloaded copies are preserved.`), 'catalog/delete', { id: row.book.id, revision: row.revision }))}</div>])} />}
      {data?.categories && <Table label={title} heads={[text('Mã', 'ID'), text('Tên thể loại', 'Category'), text('Số sách', 'Books'), text('Thao tác', 'Actions')]} rows={data.categories.items.map(item => [item.id, item.name, item.bookCount, <div key="actions" className="admin-actions">{button(text('Sửa', 'Edit'), () => open({ kind: 'category', item }))}{button(text('Xóa', 'Delete'), () => confirm(text('Xóa thể loại?', 'Delete category?'), item.name, 'categories/delete', { id: item.id }), item.bookCount > 0)}</div>])} />}
      {data?.users && <Table label={title} className="admin-users-table" heads={[text('Tài khoản', 'Account'), text('Trạng thái', 'Status'), 'Pro', text('Thiết bị / Đồng bộ', 'Devices / Sync'), text('Thao tác', 'Actions')]} rows={data.users.items.map(user => [<><strong>{user.displayName || user.email}</strong><small className="admin-account-email" title={user.email}>{user.email}</small><small>{user.id}</small>{!!user.isAdmin && <span className="admin-badge">Admin</span>}</>, user.status === 'ACTIVE' ? text('Hoạt động', 'Active') : text('Đã khóa', 'Suspended'), <>{user.plan || 'FREE'}<small>{user.purchaseSource || '—'} · {user.planStatus || '—'}</small><small>{date(user.expiresAt)}</small>{user.adminGrantStatus === 'ACTIVE' && <small>{text('Pro thử nghiệm đến ', 'Test Pro until ')}{date(user.adminGrantExpiresAt)}</small>}</>, <>{user.devices} / {user.syncRecords}<small>{text('Xung đột: ', 'Conflicts: ')}{user.syncConflicts}</small><small>{text('Đăng nhập: ', 'Last login: ')}{date(user.lastLoginAt)}</small></>, <div key="actions" className="admin-actions">
        {button(user.status === 'ACTIVE' ? text('Khóa', 'Suspend') : text('Mở khóa', 'Reactivate'), () => confirm(text('Đổi trạng thái tài khoản?', 'Change account status?'), user.email, 'users/status', { id: user.id, status: user.status === 'ACTIVE' ? 'DISABLED' : 'ACTIVE', expectedStatus: user.status }), !!user.isAdmin)}
        {button(text('Thu hồi phiên', 'Revoke sessions'), () => confirm(text('Đăng xuất khỏi mọi thiết bị?', 'Sign out all devices?'), user.email, 'users/revoke', { id: user.id }), !!user.isAdmin)}
        {button(text('Cấp Pro thử nghiệm', 'Grant test Pro'), () => confirm(text('Cấp Pro thử nghiệm', 'Grant test Pro'), text(`${user.email} · Quyền thử nghiệm tách biệt với gói đã thanh toán.`, `${user.email} · Trial access is separate from paid subscriptions.`), 'users/pro/grant', { id: user.id }, true))}
        {user.adminGrantStatus === 'ACTIVE' && button(text('Thu hồi Pro thử nghiệm', 'Revoke test Pro'), () => confirm(text('Thu hồi Pro thử nghiệm?', 'Revoke test Pro?'), text(`${user.email} · Giữ nguyên quyền đã thanh toán.`, `${user.email} · Paid access is preserved.`), 'users/pro/revoke', { id: user.id }))}
        {button(text('Xem xung đột', 'View conflicts'), () => open({ kind: 'conflicts', user }))}
        {button(text('Lịch sử giao dịch', 'Transaction history'), () => open({ kind: 'transactions', user }))}
      </div>])} />}
      {data?.announcements && <Table label={title} heads={[text('Tiêu đề', 'Title'), text('Nội dung', 'Message'), text('Lịch / Trạng thái', 'Schedule / Status'), text('Thao tác', 'Actions')]} rows={data.announcements.items.map(item => [<><strong>{item.title}</strong><small>{item.id} · {item.type}</small></>, item.message, <>{item.active ? text('Đã bật', 'Enabled') : text('Đã tắt', 'Disabled')}<small>{date(item.startsAt)} → {date(item.endsAt)}</small></>, <div key="actions" className="admin-actions">{button(text('Sửa', 'Edit'), () => open({ kind: 'announcement', item }))}{button(text('Xóa', 'Delete'), () => confirm(text('Xóa thông báo?', 'Delete announcement?'), item.title, 'announcements/delete', { id: item.id }))}</div>])} />}
      {view === 'storage' && !loading && !loaded?.error && <><p className="muted">{text('Quét tối đa 500 đối tượng mỗi lượt. Chỉ hiển thị số lượng và dung lượng tổng; không mở tệp riêng của người dùng.', 'Scan up to 500 objects per batch. Only totals are shown; private user files are not opened.')}</p><div key="actions" className="admin-actions">{button(storage ? text('Quét lại từ đầu', 'Restart scan') : text('Bắt đầu quét', 'Start scan'), () => void scanStorage(true))}{storage && !storage.complete && button(text('Quét lượt tiếp', 'Scan next batch'), () => void scanStorage(false))}</div>{storage && <><Table label={title} heads={[text('Phạm vi', 'Scope'), text('Đối tượng', 'Objects'), text('Dung lượng', 'Size')]} rows={Object.entries(storage.groups).map(([group, total]) => [group === 'public' ? text('Công khai', 'Public') : group === 'private' ? text('Riêng tư', 'Private') : text('Khác', 'Other'), total.objects, `${(total.bytes / 1024 / 1024).toLocaleString(lang, { maximumFractionDigits: 2 })} MB`])} /><p role="status">{storage.complete ? text('Quét hoàn tất', 'Scan complete') : text('Kết quả tạm tính; còn đối tượng chưa quét.', 'Partial results; more objects remain.')} · {date(storage.measuredAt)}</p></>}</>}
      {data?.audit && <Table label={title} heads={[text('Thời điểm', 'Time'), text('Người thực hiện', 'Actor'), text('Thao tác', 'Action'), text('Đối tượng', 'Target'), text('Lý do', 'Reason')]} rows={data.audit.items.map(item => [date(item.created_at), item.actor_id, item.action, item.target_id, item.reason])} />}
      {resultPage && <div className="admin-pagination">{button(text('Trước', 'Previous'), () => setPage(n => n - 1), page === 0)}<span>{text('Trang ', 'Page ')}{page + 1}</span>{button(text('Sau', 'Next'), () => setPage(n => n + 1), !resultPage.hasMore)}</div>}
      {data && view !== 'overview' && view !== 'storage' && (resultPage?.items.length === 0 || (view === 'categories' && !data.categories?.items.length) || (view === 'announcements' && !data.announcements?.items.length)) && <p className="muted">{text('Chưa có dữ liệu.', 'No data found.')}</p>}
    </div></div>
    {modal && <ModalShell title={modalTitle} busy={busy} wide={modal.kind === 'transactions'} close={() => setModal(null)}>
      {modal.kind === 'transactions' ? <AdminTransactions key={`${token}:${modal.user.id}`} token={token} user={modal.user} lang={lang} onError={handleFailure} onClose={() => setModal(null)} onSignIn={signInAgain} /> : modal.kind === 'conflicts' ? <><p>{modal.user.email}</p><p className="muted">{text('Chỉ hiển thị mã và phiên bản; không hiển thị nội dung ghi chú hoặc tài liệu.', 'Only IDs and versions are shown; document and note contents remain private.')}</p>{conflicts?.key === conflictKey ? conflicts.error ? <p role="alert">{conflicts.error}</p> : <><Table label={modalTitle} heads={[text('Loại', 'Type'), text('Bản ghi', 'Record'), text('Phiên bản', 'Versions'), text('Lý do', 'Reason')]} rows={conflicts.data?.items.map(item => [item.kind, item.recordId, `${item.baseVersion} → ${item.currentVersion ?? '—'}`, item.reason]) || []} />{!conflicts.data?.items.length && <p>{text('Không có xung đột đã lưu.', 'No saved conflicts.')}</p>}<div className="admin-pagination">{button(text('Trước', 'Previous'), () => setConflictPage(n => n - 1), conflictPage === 0)}<span>{conflictPage + 1}</span>{button(text('Sau', 'Next'), () => setConflictPage(n => n + 1), !conflicts.data?.hasMore)}</div></> : <p role="status">{text('Đang tải…', 'Loading…')}</p>}<div className="admin-form-actions">{button(text('Đóng', 'Close'), () => setModal(null))}</div></> : <form onSubmit={event => void submit(event)}>
        <fieldset disabled={busy}><div className="admin-form-fields">
        {modal.kind === 'book' && <>{field('id', text('Mã sách', 'Book ID'), modal.row?.book.id, true, 100, 'text', !!modal.row)}{field('title', text('Tên sách', 'Title'), modal.row?.book.title)}{field('author', text('Tác giả', 'Author'), modal.row?.book.author)}<label>{text('Thể loại', 'Category')}<select name="categoryId" required value={bookCategory} onChange={event => setBookCategory(event.target.value)}><option value="">{text('Chọn thể loại', 'Select category')}</option>{categoryOptions.map(category => <option value={category.id} key={category.id}>{category.name}</option>)}</select></label>{field('language', text('Ngôn ngữ', 'Language'), modal.row?.book.language || '', false, 30)}{field('fileUrl', text('Liên kết tệp HTTPS', 'HTTPS file URL'), modal.row?.book.fileUrl, true, 2048, 'url')}{field('coverUrl', text('Liên kết bìa HTTPS', 'HTTPS cover URL'), modal.row?.book.coverUrl || '', false, 2048, 'url')}<label className="admin-form-wide">{text('Mô tả', 'Description')}<textarea name="description" defaultValue={modal.row?.book.description || ''} maxLength={10000} rows={4} /></label><label className="admin-checkbox"><input type="checkbox" name="isFeatured" defaultChecked={modal.row?.book.isFeatured} />{text('Sách nổi bật', 'Featured book')}</label><label className="admin-checkbox"><input type="checkbox" name="isNew" defaultChecked={modal.row?.book.isNew} />{text('Sách mới', 'New book')}</label></>}
        {modal.kind === 'category' && <>{field('id', text('Mã thể loại', 'Category ID'), modal.item?.id, true, 100, 'text', !!modal.item)}{field('name', text('Tên thể loại', 'Category name'), modal.item?.name, true, 200)}</>}
        {modal.kind === 'announcement' && <>{field('id', text('Mã thông báo', 'Announcement ID'), modal.item?.id, true, 100, 'text', !!modal.item)}{field('title', text('Tiêu đề', 'Title'), modal.item?.title)}<label className="admin-form-wide">{text('Nội dung', 'Message')}<textarea name="message" required maxLength={2000} defaultValue={modal.item?.message || ''} rows={4} /></label><label>{text('Loại thông báo', 'Type')}<select name="type" defaultValue={modal.item?.type || 'info'}><option value="info">{text('Thông tin', 'Information')}</option><option value="warning">{text('Cảnh báo', 'Warning')}</option><option value="maintenance">{text('Bảo trì', 'Maintenance')}</option></select></label>{field('startsAt', text('Bắt đầu (tùy chọn)', 'Starts (optional)'), localTime(modal.item?.startsAt || null), false, 32, 'datetime-local')}{field('endsAt', text('Kết thúc (tùy chọn)', 'Ends (optional)'), localTime(modal.item?.endsAt || null), false, 32, 'datetime-local')}<label className="admin-checkbox"><input name="active" type="checkbox" defaultChecked={modal.item?.active ?? true} />{text('Bật thông báo', 'Enable announcement')}</label></>}
        {modal.kind === 'confirm' && <><p className="admin-form-wide">{modal.description}</p>{modal.days && <label>{text('Thời hạn Pro (ngày)', 'Pro duration (days)')}<input name="days" type="number" min={1} max={365} step={1} required defaultValue={7} /></label>}</>}
        {modal.kind === 'avatar' && <div className="admin-form-wide"><label>{text('Chọn ảnh PNG, JPG hoặc WebP', 'Choose PNG, JPG or WebP')}<input type="file" accept="image/png,image/jpeg,image/webp" onChange={event => void chooseAvatar(event.target.files?.[0])} /></label><label>{text('Hoặc URL ảnh HTTPS', 'Or HTTPS image URL')}<input type="url" value={avatar.startsWith('data:') ? '' : avatar} onChange={event => setAvatar(event.target.value)} maxLength={2048} /></label>{avatar && <img className="admin-avatar-preview" src={avatar} alt={text('Ảnh đã chọn', 'Selected avatar')} referrerPolicy="no-referrer" />}{button(text('Gỡ ảnh', 'Remove avatar'), () => setAvatar(''))}</div>}
        {modal.kind !== 'avatar' && <label className="admin-form-wide">{text('Lý do thay đổi', 'Reason for change')}<input name="reason" required maxLength={300} /></label>}
        </div></fieldset>{formError && <p className="admin-form-error" role="alert">{formError}</p>}{reauth && <button type="button" className="secondary" onClick={signInAgain}>{text('Đăng nhập lại', 'Sign in again')}</button>}<div className="admin-form-actions">{button(text('Hủy', 'Cancel'), () => setModal(null))}<button type="submit" className="primary" disabled={busy}>{busy ? text('Đang lưu…', 'Saving…') : text('Xác nhận', 'Confirm')}</button></div>
      </form>}
    </ModalShell>}
  </section>
}
