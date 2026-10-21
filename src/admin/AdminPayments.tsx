import { useEffect, useId, useRef, useState, type FormEvent } from 'react'
import { Download, RefreshCw } from 'lucide-react'
import { ApiError } from '../api'
import type { Lang } from '../i18n'
import { adminRequest, type AdminPaymentFilters, type AdminPaymentReport, type AdminTransactionStatus } from './api'
import { downloadPaymentReport } from './paymentReportCsv'
import { paymentRange } from './paymentReportDates'
import './AdminAnalytics.css'
import './AdminPayments.css'

export type AdminPaymentsProps = { token: string; lang: Lang; onError: (error: unknown) => string; onSignIn: () => void }
type Resource = { key: string; data?: AdminPaymentReport; error?: string; reauth?: boolean }
const statusLabels: Record<AdminTransactionStatus, [string, string]> = {
  PENDING: ['Chờ thanh toán', 'Pending'], PROCESSING: ['Đang xử lý', 'Processing'], PAID: ['Đã thanh toán', 'Paid'],
  EXPIRED: ['Hết hạn thanh toán', 'Expired'], CANCELLED: ['Đã hủy', 'Cancelled'],
}
const query = (filters: AdminPaymentFilters) => new URLSearchParams(filters).toString()

export function AdminPayments(props: AdminPaymentsProps) { return <PaymentsDashboard key={props.token} {...props} /> }

function PaymentsDashboard({ token, lang, onError, onSignIn }: AdminPaymentsProps) {
  const text = (vi: string, en: string) => lang === 'vi' ? vi : en
  const [filters, setFilters] = useState<AdminPaymentFilters>(() => ({ ...paymentRange(30), status: 'ALL', plan: 'ALL', q: '' }))
  const [draft, setDraft] = useState(filters)
  const [today, setToday] = useState(() => paymentRange(1).to)
  const [page, setPage] = useState(0), [revision, setRevision] = useState(0)
  const [resource, setResource] = useState<Resource | null>(null)
  const [exportState, setExportState] = useState<{ key: string; busy?: boolean; error?: string; reauth?: boolean } | null>(null)
  const reportError = useRef(onError), exportRequest = useRef<AbortController | null>(null)
  const chartId = useId(), filterQuery = query(filters)
  const key = JSON.stringify([filterQuery, page, revision, lang])
  const loaded = resource?.key === key ? resource : null, data = loaded?.data
  const exporting = exportState?.key === key ? exportState : null
  const loading = !loaded
  const locale = lang === 'vi' ? 'vi-VN' : 'en-US'
  const number = (value: number) => value.toLocaleString(locale)
  const money = (value: number) => value.toLocaleString(locale, { style: 'currency', currency: 'VND', maximumFractionDigits: 0 })
  const stamp = (value: number | null) => value == null ? '—' : new Date(value).toLocaleString(locale, { timeZone: 'Asia/Ho_Chi_Minh', year: 'numeric', month: '2-digit', day: '2-digit', hour: '2-digit', minute: '2-digit' })
  const planLabel = (days: number) => days === 30 ? text('30 ngày', '30 days') : days === 365 ? text('1 năm · 365 ngày', '1 year · 365 days') : text(`${days} ngày`, `${days} days`)
  const statusLabel = (status: AdminTransactionStatus) => statusLabels[status][lang === 'vi' ? 0 : 1]
  const refresh = () => { setToday(paymentRange(1).to); setRevision(value => value + 1) }
  useEffect(() => { reportError.current = onError }, [onError])
  useEffect(() => {
    const controller = new AbortController()
    void adminRequest<AdminPaymentReport>(token, `transactions?${filterQuery}&page=${page}`, controller.signal).then(result => {
      if (!controller.signal.aborted) setResource({ key, data: result })
    }).catch(error => {
      if (!controller.signal.aborted) setResource({ key, error: reportError.current(error), reauth: error instanceof ApiError && error.status === 401 })
    })
    return () => { controller.abort(); exportRequest.current?.abort() }
  }, [token, key, filterQuery, page])

  const apply = (event: FormEvent<HTMLFormElement>) => { event.preventDefault(); setFilters({ ...draft, q: draft.q.trim() }); setPage(0); refresh() }
  const preset = (days: number) => { const next = { ...draft, ...paymentRange(days), q: draft.q.trim() }; setDraft(next); setFilters(next); setPage(0); refresh() }
  async function exportCsv() {
    if (!data || exportRequest.current && !exportRequest.current.signal.aborted) return
    const controller = new AbortController(); exportRequest.current = controller
    setExportState({ key, busy: true })
    try {
      const result = await adminRequest<AdminPaymentReport>(token, `transactions/export?${filterQuery}`, controller.signal)
      if (!controller.signal.aborted) { downloadPaymentReport(result); setExportState({ key }) }
    } catch (error) {
      if (!controller.signal.aborted) {
        const reauth = error instanceof ApiError && error.status === 401
        const message = reportError.current(error)
        if (error instanceof ApiError && (error.status === 401 || error.status === 403)) { setResource({ key, error: message, reauth }); setExportState({ key }) }
        else setExportState({ key, error: message, reauth })
      }
    } finally { controller.abort(); if (exportRequest.current === controller) exportRequest.current = null }
  }
  const maximum = Math.max(1, ...(data?.daily.map(row => row.paidAmount) || []))
  const points = data?.daily.map((row, index, all) => ({ x: all.length === 1 ? 420 : 100 + index / (all.length - 1) * 610, y: 198 - row.paidAmount / maximum * 166, row })) || []
  const plot = points.map(point => `${point.x},${point.y}`).join(' ')

  return <div className="admin-analytics admin-payments">
    <div className="admin-analytics-toolbar"><div className="admin-actions" aria-label={text('Chọn nhanh thời gian', 'Quick date ranges')}>{[1, 7, 30, 90].map(days => <button className="secondary" type="button" key={days} onClick={() => preset(days)}>{days === 1 ? text('Hôm nay', 'Today') : text(`${days} ngày`, `${days} days`)}</button>)}</div><div className="admin-actions"><button className="secondary" type="button" disabled={loading || !!exporting?.busy} onClick={refresh}><RefreshCw size={15} aria-hidden="true" />{text('Tải lại', 'Refresh')}</button><button className="secondary" type="button" disabled={!data || !!exporting?.busy} onClick={() => void exportCsv()}><Download size={15} aria-hidden="true" />{exporting?.busy ? text('Đang xuất…', 'Exporting…') : text('Xuất CSV', 'Export CSV')}</button></div></div>
    <form className="admin-payments-filters" aria-label={text('Bộ lọc giao dịch', 'Payment filters')} onSubmit={apply}>
      <label>{text('Từ ngày', 'From date')}<input type="date" required max={today} value={draft.from} onChange={event => setDraft({ ...draft, from: event.target.value })} /></label>
      <label>{text('Đến ngày', 'To date')}<input type="date" required min={draft.from} max={today} value={draft.to} onChange={event => setDraft({ ...draft, to: event.target.value })} /></label>
      <label>{text('Trạng thái', 'Status')}<select value={draft.status} onChange={event => setDraft({ ...draft, status: event.target.value as AdminPaymentFilters['status'] })}><option value="ALL">{text('Tất cả trạng thái', 'All statuses')}</option>{(Object.keys(statusLabels) as AdminTransactionStatus[]).map(status => <option key={status} value={status}>{statusLabel(status)}</option>)}</select></label>
      <label>{text('Gói Pro', 'Pro plan')}<select value={draft.plan} onChange={event => setDraft({ ...draft, plan: event.target.value as AdminPaymentFilters['plan'] })}><option value="ALL">{text('Tất cả các gói', 'All plans')}</option><option value="30">{planLabel(30)}</option><option value="365">{planLabel(365)}</option><option value="OTHER">{text('Thời hạn khác', 'Other durations')}</option></select></label>
      <label className="admin-payments-search">{text('Tài khoản hoặc mã giao dịch', 'Account or transaction code')}<input type="search" maxLength={100} value={draft.q} onChange={event => setDraft({ ...draft, q: event.target.value })} placeholder={text('Tên, email, mã đơn, mã thanh toán…', 'Name, email, order or payment code…')} /></label><button type="submit" className="primary">{text('Áp dụng bộ lọc', 'Apply filters')}</button>
    </form>
    <p className="admin-analytics-method">{text('Chỉ gồm đơn SePay. Tiền đã thanh toán chỉ cộng đơn PAID, theo ngày trả tiền thực tế; các trạng thái khác lọc theo ngày tạo đơn. Pro do admin cấp không được tính. Múi giờ Việt Nam (UTC+7), tối đa 366 ngày.', 'SePay orders only. Paid amounts include PAID orders by actual payment date; other statuses use order creation dates. Admin-granted Pro is excluded. Vietnam time (UTC+7), up to 366 days.')}</p>
    {loading && <p role="status">{text('Đang tải giao dịch…', 'Loading payments…')}</p>}
    {loaded?.error && <div role="alert" className="admin-analytics-error"><p>{loaded.error}</p><div className="admin-actions"><button type="button" className="secondary" onClick={refresh}>{text('Thử lại', 'Retry')}</button>{loaded.reauth && <button type="button" className="primary" onClick={onSignIn}>{text('Đăng nhập lại', 'Sign in again')}</button>}</div></div>}
    {exporting?.error && <p role="alert" className="admin-analytics-error">{exporting.error}</p>}
    {exporting?.busy && <p role="status">{text('Đang xuất toàn bộ kết quả theo bộ lọc…', 'Exporting all filtered results…')}</p>}
    {data && <>
      <p className="admin-analytics-method">{data.from} – {data.to} · {text('Cập nhật', 'Generated')}: {stamp(data.generatedAt)} · {text('Tất cả số liệu bên dưới áp dụng bộ lọc đã chọn.', 'All figures below use the applied filters.')}</p>
      {data.undatedPaidOrders > 0 && <p className="admin-notice" role="status">{text(`Có ${number(data.undatedPaidOrders)} đơn PAID thiếu ngày thanh toán trong dữ liệu phù hợp bộ lọc trạng thái/gói/tìm kiếm (mọi ngày). Các đơn này được loại khỏi báo cáo theo ngày.`, `${number(data.undatedPaidOrders)} PAID orders matching the status/plan/search filters have no payment date (all dates). They are excluded from this dated report.`)}</p>}
      <div className="admin-analytics-metrics admin-payments-metrics">{[
        [text('Tiền đã thanh toán', 'Paid amount'), money(data.summary.paidAmount), text('Tổng tiền của đơn PAID; chưa trừ chi phí hay hoàn tiền.', 'Total PAID order amounts, before costs or refunds.')],
        [text('Đơn thanh toán thành công', 'Paid orders'), number(data.summary.paidOrders), text('Số đơn PAID trong kết quả đã lọc.', 'PAID orders in the filtered results.')],
        [text('Khách trả tiền', 'Paying customers'), number(data.summary.paidCustomers), text('Tài khoản duy nhất có đơn PAID trong kỳ.', 'Distinct accounts with a PAID order in this range.')],
        [text('Tổng đơn theo bộ lọc', 'Filtered orders'), number(data.summary.orders), text('Gồm các trạng thái đang được chọn.', 'Includes the selected order statuses.')],
      ].map(([label, value, hint]) => <article className="admin-analytics-metric" key={label}><h3>{label}</h3><strong>{value}</strong><p>{hint}</p></article>)}</div>
      {data.summary.orders === 0 && <p className="admin-analytics-empty" role="status">{text('Không có giao dịch phù hợp bộ lọc.', 'No payments match these filters.')}</p>}
      <section className="admin-analytics-panel"><h3>{text('Phân chia gói Pro', 'Pro plan breakdown')}</h3><p className="admin-analytics-method">{text('Khách được đếm riêng theo từng gói; một tài khoản có thể xuất hiện ở nhiều gói.', 'Customers are distinct within each plan; one account may appear in multiple plans.')}</p><div className="admin-analytics-table-wrap"><table className="admin-analytics-table"><thead><tr>{[text('Gói', 'Plan'), text('Tổng đơn', 'Orders'), text('Đơn PAID', 'Paid orders'), text('Khách trả tiền', 'Paying customers'), text('Tiền đã thanh toán', 'Paid amount')].map(label => <th scope="col" key={label}>{label}</th>)}</tr></thead><tbody>{[30, 365, ...data.plans.filter(row => row.planDays !== 30 && row.planDays !== 365).map(row => row.planDays)].map(days => { const row = data.plans.find(plan => plan.planDays === days); return <tr key={days}><td>{planLabel(days)}</td><td>{number(row?.orders || 0)}</td><td>{number(row?.paidOrders || 0)}</td><td>{number(row?.paidCustomers || 0)}</td><td>{money(row?.paidAmount || 0)}</td></tr> })}</tbody></table></div></section>
      <section className="admin-analytics-panel"><h3>{text('Tiền đã thanh toán theo ngày', 'Daily paid amount')}</h3><figure className="admin-analytics-chart"><svg viewBox="0 0 730 238" role="img" aria-labelledby={`${chartId}-title ${chartId}-desc`}><title id={`${chartId}-title`}>{text('Biểu đồ tiền đã thanh toán', 'Paid amount chart')}</title><desc id={`${chartId}-desc`}>{text('Tiền VND theo ngày thanh toán, số liệu chính xác ở bảng bên dưới.', 'VND by payment date. Exact values are in the table below.')}</desc>{[0, 0.5, 1].map(ratio => <g key={ratio}><line className="admin-analytics-chart-grid" x1={100} x2={710} y1={198 - ratio * 166} y2={198 - ratio * 166} /><text className="admin-analytics-chart-label" x={90} y={202 - ratio * 166} textAnchor="end">{number(Math.round(maximum * ratio))}</text></g>)}<polyline className="admin-analytics-chart-line" points={plot} />{points.map(({ x, y, row }) => <circle className="admin-analytics-chart-dot" key={row.date} cx={x} cy={y} r={3}><title>{row.date}: {money(row.paidAmount)}</title></circle>)}{points[0] && <text className="admin-analytics-chart-label" x={100} y={228}>{points[0].row.date}</text>}{points.length > 1 && <text className="admin-analytics-chart-label" x={710} y={228} textAnchor="end">{points.at(-1)!.row.date}</text>}</svg><figcaption>{text('Đơn vị VND · Khách được đếm riêng theo ngày, không cộng dồn thành tổng khách.', 'VND · Daily customer counts cannot be added to obtain distinct customers for the range.')}</figcaption><details><summary>{text('Xem bảng số liệu theo ngày', 'View daily data table')}</summary><div className="admin-analytics-table-wrap"><table className="admin-analytics-table"><thead><tr><th scope="col">{text('Ngày', 'Date')}</th><th scope="col">{text('Đơn PAID', 'Paid orders')}</th><th scope="col">{text('Khách trả tiền', 'Paying customers')}</th><th scope="col">{text('Tiền đã thanh toán', 'Paid amount')}</th></tr></thead><tbody>{data.daily.map(row => <tr key={row.date}><td>{row.date}</td><td>{number(row.paidOrders)}</td><td>{number(row.paidCustomers)}</td><td>{money(row.paidAmount)}</td></tr>)}</tbody></table></div></details></figure></section>
      <section className="admin-analytics-panel"><h3>{text('Tất cả giao dịch', 'All payments')}</h3><p className="admin-analytics-method">{number(data.totalRows)} {text('đơn phù hợp', 'matching orders')} · {text('50 đơn mỗi trang. CSV gồm toàn bộ kết quả, tối đa 10.000 đơn; không chỉ trang đang xem.', '50 orders per page. CSV contains all results, up to 10,000 orders, beyond the current page.')}</p><div className="admin-analytics-table-wrap" role="region" aria-label={text('Danh sách giao dịch', 'Payment list')} tabIndex={0}><table className="admin-analytics-table admin-payments-table"><thead><tr>{[text('Tài khoản', 'Account'), text('Mã giao dịch', 'Payment reference'), text('Gói / Số tiền', 'Plan / Amount'), text('Trạng thái', 'Status'), text('Ngày tạo / Thanh toán', 'Created / Paid')].map(label => <th scope="col" key={label}>{label}</th>)}</tr></thead><tbody>{data.items.map(row => <tr key={row.id}><td><strong>{row.displayName || row.email}</strong><small>{row.email}</small></td><td><code>{row.paymentCode}</code><small>{text('Đơn', 'Order')}: {row.id}</small><small>{text('SePay', 'SePay')}: {row.transactionId || '—'}</small></td><td>{planLabel(row.planDays)}<small>{money(row.amount)}</small></td><td><span className={`admin-payments-status admin-payments-status-${row.status.toLowerCase()}`}>{statusLabel(row.status)}</span></td><td><small>{text('Tạo', 'Created')}: {stamp(row.createdAt)}</small><small>{text('Trả tiền', 'Paid')}: {stamp(row.status === 'PAID' ? row.paidAt : null)}</small></td></tr>)}</tbody></table></div><nav className="admin-pagination" aria-label={text('Phân trang giao dịch', 'Payment pagination')}><button type="button" className="secondary" disabled={page === 0} onClick={() => setPage(value => value - 1)}>{text('Trước', 'Previous')}</button><span>{text('Trang', 'Page')} {page + 1} / {Math.max(1, Math.ceil(data.totalRows / 50))}</span><button type="button" className="secondary" disabled={!data.hasMore} onClick={() => setPage(value => value + 1)}>{text('Sau', 'Next')}</button></nav></section>
    </>}
  </div>
}
