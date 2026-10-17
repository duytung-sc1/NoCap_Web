import { useEffect, useRef, useState } from 'react'
import { RefreshCw } from 'lucide-react'
import { ApiError } from '../api'
import type { Lang } from '../i18n'
import { adminRequest, type AdminTransaction, type AdminTransactionStatus, type AdminUser, type PageResult } from './api'
import './AdminTransactions.css'

export type AdminTransactionsProps = {
  token: string
  user: AdminUser
  lang: Lang
  onError: (error: unknown) => string
  onClose: () => void
  onSignIn: () => void
}

type Filter = 'ALL' | AdminTransactionStatus
type Resource = { key: string; data?: PageResult<AdminTransaction>; error?: string; reauth?: boolean }

// A new session or account must never inherit another account's filters or results.
export function AdminTransactions(props: AdminTransactionsProps) {
  return <TransactionHistory key={JSON.stringify([props.token, props.user.id])} {...props} />
}

export default AdminTransactions

function TransactionHistory({ token, user, lang, onError, onClose, onSignIn }: AdminTransactionsProps) {
  const text = (vi: string, en: string) => lang === 'vi' ? vi : en
  const [status, setStatus] = useState<Filter>('ALL')
  const [page, setPage] = useState(0)
  const [revision, setRevision] = useState(0)
  const [openedAt] = useState(Date.now)
  const [resource, setResource] = useState<Resource | null>(null)
  const reportError = useRef(onError)
  useEffect(() => { reportError.current = onError }, [onError])
  const path = `users/transactions?id=${encodeURIComponent(user.id)}&page=${page}&status=${status}`
  const key = JSON.stringify([path, revision, lang])
  const loaded = resource?.key === key ? resource : null
  const loading = !loaded
  const data = loaded?.data
  const labels: Record<Filter, string> = {
    ALL: text('Tất cả trạng thái', 'All statuses'),
    PENDING: text('Chờ thanh toán', 'Pending'),
    PROCESSING: text('Đang xử lý', 'Processing'),
    PAID: text('Đã thanh toán', 'Paid'),
    EXPIRED: text('Hết hạn', 'Expired'),
    CANCELLED: text('Đã hủy', 'Cancelled'),
  }

  useEffect(() => {
    const controller = new AbortController()
    void adminRequest<PageResult<AdminTransaction>>(token, path, controller.signal).then(result => {
      if (!controller.signal.aborted) setResource({ key, data: result })
    }).catch(error => {
      if (controller.signal.aborted) return
      const message = reportError.current(error)
      if (!controller.signal.aborted) setResource({ key, error: message, reauth: error instanceof ApiError && error.status === 401 })
    })
    return () => controller.abort()
  }, [token, path, key])

  const timestamp = (value: string | number | null | undefined) => {
    if (value == null) return <span>—</span>
    const date = new Date(value)
    if (!Number.isFinite(date.getTime())) return <span>—</span>
    return <time dateTime={date.toISOString()} title={date.toISOString()}>{date.toLocaleString(lang === 'vi' ? 'vi-VN' : 'en-US', {
      year: 'numeric', month: '2-digit', day: '2-digit', hour: '2-digit', minute: '2-digit', second: '2-digit', timeZoneName: 'short',
    })}</time>
  }
  const duration = (days: number) => days === 365 ? text('1 năm · 365 ngày', '1 year · 365 days') : days === 30 ? text('30 ngày', '30 days') : text(`${days} ngày`, `${days} days`)
  const hasActiveGrant = user.adminGrantStatus === 'ACTIVE' && !!user.adminGrantExpiresAt && user.adminGrantExpiresAt > openedAt
  const refresh = () => setRevision(value => value + 1)

  return <div className="admin-transactions">
    <header className="admin-transactions-account"><strong>{user.displayName || user.email}</strong>{user.displayName && <span>{user.email}</span>}</header>
    <p className="admin-transactions-description">{text('Chỉ hiển thị đơn thanh toán SePay của tài khoản này. Pro do quản trị viên cấp không phải giao dịch đã thanh toán.', 'Only this account’s SePay payment orders are listed. Pro granted by an administrator is not a paid transaction.')}</p>
    {hasActiveGrant && <p className="admin-transactions-grant">{text('Pro do quản trị viên cấp đang có hiệu lực đến: ', 'Administrator-granted Pro is currently active until: ')}{timestamp(user.adminGrantExpiresAt)}</p>}
    <div className="admin-transactions-toolbar"><label>{text('Trạng thái thanh toán', 'Payment status')}<select value={status} onChange={event => { setStatus(event.target.value as Filter); setPage(0) }}>{Object.entries(labels).map(([value, label]) => <option value={value} key={value}>{label}</option>)}</select></label>
      <button className="secondary" type="button" disabled={loading} onClick={refresh}><RefreshCw size={15} aria-hidden="true" />{text('Tải lại', 'Refresh')}</button>
    </div>
    {loading && <p role="status">{text('Đang tải lịch sử giao dịch…', 'Loading transaction history…')}</p>}
    {loaded?.error && <div className="admin-transactions-error" role="alert"><p>{loaded.error}</p><div className="admin-transactions-error-actions"><button className="secondary" type="button" onClick={refresh}>{text('Thử lại', 'Retry')}</button>{loaded.reauth && <button className="primary" type="button" onClick={onSignIn}>{text('Đăng nhập lại', 'Sign in again')}</button>}</div></div>}
    {data && <>
      {data.items.length ? <div className="admin-transactions-table-wrap" role="region" aria-label={text('Đơn thanh toán SePay', 'SePay payment orders')} tabIndex={0}>
        <table className="admin-transactions-table"><thead><tr><th scope="col">{text('Đơn thanh toán', 'Payment order')}</th><th scope="col">{text('Gói & Số tiền', 'Plan & Amount')}</th><th scope="col">{text('Trạng thái', 'Status')}</th><th scope="col">{text('Thời điểm', 'Timestamps')}</th><th scope="col">{text('Mã giao dịch', 'Transaction ID')}</th></tr></thead>
          <tbody>{data.items.map(item => <tr key={item.id}>
            <td><strong>{item.paymentCode}</strong><span className="admin-transactions-detail"><span>{text('Mã đơn', 'Order ID')}</span><span className="admin-transactions-id">{item.id}</span></span></td>
            <td><strong>{new Intl.NumberFormat(lang === 'vi' ? 'vi-VN' : 'en-US', { style: 'currency', currency: item.currency, maximumFractionDigits: 0 }).format(item.amount)}</strong><span className="admin-transactions-detail">{duration(item.planDays)}</span>{item.status === 'PAID' && item.entitlementExpiresAt != null && <span className="admin-transactions-detail"><span>{text('Pro được gia hạn đến', 'Pro extended until')}</span>{timestamp(item.entitlementExpiresAt)}</span>}</td>
            <td><span className={`admin-transactions-status is-${item.status.toLowerCase()}`}>{labels[item.status]}</span></td>
            <td><dl className="admin-transactions-timestamps"><dt>{text('Tạo đơn', 'Created')}</dt><dd>{timestamp(item.createdAt)}</dd><dt>{text('Hạn thanh toán', 'Payment deadline')}</dt><dd>{timestamp(item.expiresAt)}</dd><dt>{text('Đã thanh toán', 'Paid at')}</dt><dd>{timestamp(item.paidAt)}</dd></dl></td>
            <td className="admin-transactions-id">{item.transactionId || '—'}</td>
          </tr>)}</tbody></table>
      </div> : <p className="admin-transactions-empty" role="status">{status === 'ALL' ? text('Tài khoản này chưa có đơn thanh toán SePay.', 'This account has no SePay payment orders yet.') : text('Không có đơn thanh toán với trạng thái đã chọn.', 'No payment orders match the selected status.')}</p>}
    </>}
    <div className="admin-form-actions">
      {data && <nav className="admin-transactions-pagination" aria-label={text('Trang lịch sử giao dịch', 'Transaction history pages')}><button className="secondary" type="button" disabled={page === 0} onClick={() => setPage(value => value - 1)}>{text('Trước', 'Previous')}</button><span>{text('Trang ', 'Page ')}{page + 1}</span><button className="secondary" type="button" disabled={!data.hasMore} onClick={() => setPage(value => value + 1)}>{text('Sau', 'Next')}</button></nav>}
      <button className="secondary" type="button" onClick={onClose}>{text('Đóng', 'Close')}</button>
    </div>
  </div>
}
