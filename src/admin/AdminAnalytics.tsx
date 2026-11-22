import { useEffect, useId, useRef, useState, type ReactNode } from 'react'
import { Download, RefreshCw } from 'lucide-react'
import { ApiError } from '../api'
import type { Lang } from '../i18n'
import { adminRequest, type AdminAnalytics as AnalyticsReport, type AdminAnalyticsDays } from './api'
import { analyticsCsv } from './analyticsCsv'
import { analyticsDuration } from './analyticsDuration'
import { AdminAcquisition } from './AdminAcquisition'
import './AdminAnalytics.css'

export type AdminAnalyticsProps = {
  token: string; lang: Lang; onError: (error: unknown) => string; onSignIn: () => void
}
type Resource = { key: string; data?: AnalyticsReport; error?: string; reauth?: boolean }
const ranges: AdminAnalyticsDays[] = [1, 7, 30, 90]
const featureLabels: Record<string, [string, string]> = {
  book_open: ['Mở sách', 'Books opened'], note_save: ['Lưu ghi chú', 'Notes saved'],
  review_start: ['Bắt đầu ôn tập', 'Reviews started'], review_complete: ['Hoàn thành ôn tập', 'Reviews completed'],
  reader_search: ['Tìm trong sách', 'In-book searches'], import: ['Nhập tài liệu', 'Document imports'],
  download: ['Tải tệp', 'File downloads'], checkout_start: ['Bắt đầu thanh toán', 'Checkouts started'],
}
const pageLabels: Record<string, [string, string]> = {
  home: ['Trang chủ', 'Home'], explore: ['Khám phá', 'Explore'], library: ['Thư viện', 'Library'],
  memory: ['Reading Memory', 'Reading Memory'], stats: ['Thống kê đọc', 'Reading statistics'],
  account: ['Tài khoản', 'Account'], book: ['Chi tiết sách', 'Book details'], reader: ['Đọc sách', 'Reader'], other: ['Trang khác', 'Other pages'],
}
const numeric = (value: number) => Number.isFinite(value) ? Math.max(0, value) : 0
const chartLeft = 90
const chartRight = 702

function ReportPanel({ title, children }: { title: string; children: ReactNode }) {
  return <section className="admin-analytics-panel admin-analytics-disclosure">
    <details><summary><h3>{title}</h3></summary><div className="admin-analytics-disclosure-body">{children}</div></details>
  </section>
}

function downloadCsv(data: AnalyticsReport) {
  const url = URL.createObjectURL(new Blob([analyticsCsv(data)], { type: 'text/csv;charset=utf-8;' }))
  const anchor = document.createElement('a')
  anchor.href = url
  anchor.download = `NoCap-Web-Analytics-${data.from}-${data.to}.csv`
  document.body.append(anchor)
  anchor.click()
  anchor.remove()
  setTimeout(() => URL.revokeObjectURL(url), 1000)
}

export function AdminAnalytics(props: AdminAnalyticsProps) {
  return <AnalyticsDashboard key={props.token} {...props} />
}
export default AdminAnalytics

function AnalyticsDashboard({ token, lang, onError, onSignIn }: AdminAnalyticsProps) {
  const text = (vi: string, en: string) => lang === 'vi' ? vi : en
  const [days, setDays] = useState<AdminAnalyticsDays>(7)
  const [revision, setRevision] = useState(0)
  const [resource, setResource] = useState<Resource | null>(null)
  const reportError = useRef(onError)
  const chartId = useId()
  useEffect(() => { reportError.current = onError }, [onError])
  const key = JSON.stringify([days, revision, lang])
  const loaded = resource?.key === key ? resource : null
  const data = loaded?.data
  const loading = !loaded
  const refresh = () => setRevision(value => value + 1)
  const number = (value: number) => numeric(value).toLocaleString(lang === 'vi' ? 'vi-VN' : 'en-US')
  const chartNumber = (value: number) => numeric(value).toLocaleString(lang === 'vi' ? 'vi-VN' : 'en-US', { notation: 'compact', maximumFractionDigits: 1 })
  const duration = (value: number) => analyticsDuration(value, lang)
  const date = (value: string) => new Date(`${value}T00:00:00Z`).toLocaleDateString(lang === 'vi' ? 'vi-VN' : 'en-US', { day: '2-digit', month: 'short', year: 'numeric', timeZone: 'UTC' })
  const stamp = (value: number) => new Date(value).toLocaleString(lang === 'vi' ? 'vi-VN' : 'en-US', { timeZone: data?.timezone || 'Asia/Ho_Chi_Minh', year: 'numeric', month: '2-digit', day: '2-digit', hour: '2-digit', minute: '2-digit' })

  useEffect(() => {
    const controller = new AbortController()
    void adminRequest<AnalyticsReport>(token, `analytics?days=${days}`, controller.signal).then(result => {
      if (!controller.signal.aborted) setResource({ key, data: result })
    }).catch(error => {
      if (controller.signal.aborted) return
      const message = reportError.current(error)
      if (!controller.signal.aborted) setResource({ key, error: message, reauth: error instanceof ApiError && error.status === 401 })
    })
    return () => controller.abort()
  }, [token, days, key])

  const featureEvents = data?.events.filter(event => featureLabels[event.type]) || []
  const maximum = Math.max(2, Math.ceil(Math.max(0, ...(data?.daily.map(day => numeric(day.pageViews)) || [])) / 2) * 2)
  const points = data?.daily.map((day, index, all) => ({ x: all.length === 1 ? (chartLeft + chartRight) / 2 : chartLeft + index / (all.length - 1) * (chartRight - chartLeft), y: 204 - numeric(day.pageViews) / maximum * 172, day })) || []
  const plot = points.map(point => `${point.x},${point.y}`).join(' ')
  const empty = data && data.summary.sessions === 0 && data.summary.pageViews === 0

  return <div className="admin-analytics admin-web-analytics">
    <div className="admin-analytics-toolbar"><label>{text('Khoảng thời gian', 'Date range')}<select value={days} onChange={event => setDays(Number(event.target.value) as AdminAnalyticsDays)}>{ranges.map(value => <option value={value} key={value}>{value === 1 ? text('Hôm nay', 'Today') : text(`${value} ngày gần đây`, `Last ${value} days`)}</option>)}</select></label><div className="admin-actions"><button type="button" className="secondary" disabled={loading} onClick={refresh}><RefreshCw size={15} aria-hidden="true" />{text('Tải lại', 'Refresh')}</button><button type="button" className="secondary" disabled={!data?.enabled || loading} onClick={() => data && downloadCsv(data)}><Download size={15} aria-hidden="true" />{text('Xuất CSV', 'Export CSV')}</button></div></div>
    <p className="admin-analytics-caption">{text('Dữ liệu Web · Khách truy cập ước tính theo trình duyệt.', 'Web traffic · Visitors are estimated browsers.')}</p>
    {loading && <p role="status">{text('Đang tải thống kê Web…', 'Loading Web analytics…')}</p>}
    {loaded?.error && <div className="admin-analytics-error" role="alert"><p>{loaded.error}</p><div className="admin-actions"><button type="button" className="secondary" onClick={refresh}>{text('Thử lại', 'Retry')}</button>{loaded.reauth && <button type="button" className="primary" onClick={onSignIn}>{text('Đăng nhập lại', 'Sign in again')}</button>}</div></div>}
    {data && !data.enabled && <div className="admin-analytics-empty" role="status"><strong>{text('Chưa bật thu thập thống kê', 'Analytics collection is disabled')}</strong><p>{text('Máy chủ chưa bật thu thập dữ liệu truy cập Web. Chưa thể dùng các số liệu này để đánh giá lượng truy cập.', 'Web analytics collection is not enabled on the server. Traffic cannot be evaluated from this report yet.')}</p></div>}
    {data?.enabled && <>
      <div className="admin-analytics-report-meta"><span>{date(data.from)} – {date(data.to)} · {data.timezone}</span><span>{text('Cập nhật: ', 'Updated: ')}<time dateTime={new Date(data.generatedAt).toISOString()}>{stamp(data.generatedAt)}</time></span></div>
      {empty && <p className="admin-analytics-empty" role="status">{text('Chưa ghi nhận truy cập trong khoảng thời gian đã chọn. Số 0 không đại diện cho lưu lượng trước khi bật thống kê.', 'No traffic has been collected in the selected range. Zero does not represent traffic before analytics was enabled.')}</p>}
      <div className="admin-analytics-metrics admin-analytics-overview-metrics">
        {[
          [text('Khách truy cập ước tính', 'Estimated visitors'), number(data.summary.visitors), text('Trình duyệt khác nhau trong cả khoảng thời gian.', 'Distinct browsers across the selected range.')],
          [text('Phiên truy cập', 'Sessions'), number(data.summary.sessions), text('Phiên có hoạt động trong khoảng thời gian.', 'Sessions with activity in the selected range.')],
          [text('Lượt xem trang', 'Page views'), number(data.summary.pageViews), text('Một trình duyệt có thể xem nhiều trang.', 'A browser can generate multiple page views.')],
          [text('Trình duyệt mới / quay lại', 'New / returning browsers'), `${number(data.summary.newVisitors)} / ${number(data.summary.returningVisitors)}`, text('Mới: lần đầu được ghi nhận trong kỳ. Quay lại: đã được ghi nhận trước kỳ và có hoạt động trong kỳ.', 'New: first recorded within this range. Returning: recorded before this range and active within it.')],
        ].map(([label, value, hint]) => <article className="admin-analytics-metric" key={label}><h3>{label}</h3><strong>{value}</strong><p title={hint}>{hint}</p></article>)}
      </div>
      <section className="admin-analytics-panel" aria-labelledby={`${chartId}-heading`}><h3 id={`${chartId}-heading`}>{text('Lượt xem trang theo ngày', 'Daily page views')}</h3><figure className="admin-analytics-chart">
        <svg viewBox="0 0 720 240" role="img" aria-labelledby={`${chartId}-title ${chartId}-description`}>
          <title id={`${chartId}-title`}>{text('Biểu đồ lượt xem trang theo ngày', 'Page views by day')}</title>
          <desc id={`${chartId}-description`}>{text('Giá trị chính xác cho từng ngày có trong bảng bên dưới biểu đồ.', 'Exact daily values are available in the table below the chart.')}</desc>
          {[0, 0.5, 1].map(ratio => <g key={ratio}>
            <line className="admin-analytics-chart-grid" x1={chartLeft} x2={chartRight} y1={204 - ratio * 172} y2={204 - ratio * 172} />
            <text className="admin-analytics-chart-label" x={chartLeft - 10} y={208 - ratio * 172} textAnchor="end">{chartNumber(Math.ceil(maximum * ratio))}</text>
          </g>)}
          {points.length > 1 && <polygon className="admin-analytics-chart-area" points={`${points[0].x},204 ${plot} ${points.at(-1)!.x},204`} />}
          <polyline className="admin-analytics-chart-line" points={plot} />
          {points.map(({ x, y, day }) => <circle key={day.date} className="admin-analytics-chart-dot" cx={x} cy={y} r={points.length > 31 ? 2 : 3}><title>{date(day.date)}: {number(day.pageViews)}</title></circle>)}
          {points[0] && <text className="admin-analytics-chart-label" x={chartLeft} y={230}>{date(points[0].day.date)}</text>}
          {points.length > 1 && <text className="admin-analytics-chart-label" x={chartRight} y={230} textAnchor="end">{date(points.at(-1)!.day.date)}</text>}
        </svg>
        <details><summary>{text('Xem bảng số liệu theo ngày', 'View daily data table')}</summary><div className="admin-analytics-table-wrap" role="region" aria-label={text('Số liệu theo ngày', 'Daily data')} tabIndex={0}><table className="admin-analytics-table admin-analytics-daily"><thead><tr><th scope="col">{text('Ngày', 'Date')}</th><th scope="col">{text('Trình duyệt', 'Browsers')}</th><th scope="col">{text('Phiên', 'Sessions')}</th><th scope="col">{text('Lượt xem', 'Page views')}</th><th scope="col">{text('Tương tác', 'Active time')}</th></tr></thead><tbody>{data.daily.map(day => <tr key={day.date}><td><time dateTime={day.date}>{date(day.date)}</time></td><td>{number(day.visitors)}</td><td>{number(day.sessions)}</td><td>{number(day.pageViews)}</td><td>{duration(day.activeMs)}</td></tr>)}</tbody></table></div></details>
      </figure></section>
      <div className="admin-analytics-columns">
        <ReportPanel title={text('Trang được xem nhiều', 'Most viewed pages')}>
          <p className="admin-analytics-method">{text('Gộp theo loại trang; không hiển thị mã sách, từ khóa tìm kiếm hay thông tin tài khoản.', 'Grouped by page type; no book IDs, search terms or account details are shown.')}</p>
          {data.topPages.length ? <div className="admin-analytics-table-wrap"><table className="admin-analytics-table"><thead><tr><th scope="col">{text('Trang', 'Page')}</th><th scope="col">{text('Trình duyệt', 'Browsers')}</th><th scope="col">{text('Lượt xem', 'Page views')}</th></tr></thead><tbody>{data.topPages.map(page => <tr key={page.page}><td>{pageLabels[page.page]?.[lang === 'vi' ? 0 : 1] || text('Trang khác', 'Other pages')}</td><td>{number(page.visitors)}</td><td>{number(page.pageViews)}</td></tr>)}</tbody></table></div> : <p>{text('Chưa có lượt xem trang.', 'No page views yet.')}</p>}
        </ReportPanel>
        <ReportPanel title={text('Hoạt động tính năng', 'Feature activity')}>
          <p className="admin-analytics-method">{text('Số lần ghi nhận thao tác, không phải số người hay tỷ lệ hoàn thành. Bắt đầu thanh toán không có nghĩa là đã trả tiền.', 'Recorded actions, not people or completion rates. Starting checkout does not mean a payment was made.')}</p>
          {featureEvents.length ? <div className="admin-analytics-table-wrap"><table className="admin-analytics-table"><thead><tr><th scope="col">{text('Thao tác', 'Action')}</th><th scope="col">{text('Số lần', 'Count')}</th></tr></thead><tbody>{featureEvents.map(event => <tr key={event.type}><td>{featureLabels[event.type][lang === 'vi' ? 0 : 1]}</td><td>{number(event.count)}</td></tr>)}</tbody></table></div> : <p>{text('Chưa ghi nhận thao tác tính năng.', 'No feature actions recorded yet.')}</p>}
        </ReportPanel>
      </div>
      {data.acquisition && <ReportPanel title={text('Nguồn truy cập, chiến dịch và thiết bị', 'Traffic sources, campaigns and devices')}>
        <AdminAcquisition data={data.acquisition} sessions={data.summary.sessions} lang={lang} />
      </ReportPanel>}
      <ReportPanel title={text('Thông tin báo cáo', 'Report information')}>
        <p className="admin-analytics-method">{text('Khách truy cập là ước tính theo trình duyệt, không phải số người hay tài khoản duy nhất. Chỉ thống kê Web; không bao gồm ứng dụng Android. Lịch sử sự kiện được lưu khoảng 90 ngày.', 'Visitors are estimated browsers, not unique people or accounts. Web traffic only; the Android app is not included. Event history is retained for approximately 90 days.')}</p>
        <p className="admin-analytics-method">{text('Múi giờ', 'Time zone')}: {data.timezone}. {data.trackingStartedAt == null ? text('Chưa ghi nhận lượt truy cập đầu tiên.', 'No visits have been collected yet.') : <>{text('Bắt đầu ghi nhận: ', 'Collection started: ')}<time dateTime={new Date(data.trackingStartedAt).toISOString()}>{stamp(data.trackingStartedAt)}</time>.</>} {text('Không có dữ liệu truy cập trước thời điểm bắt đầu thu thập.', 'Traffic before collection began is unavailable.')}</p>
        <p className="admin-analytics-method">{text('Khách truy cập và phiên được đếm riêng cho từng ngày; cộng các ngày có thể đếm lặp cùng một trình duyệt hoặc phiên.', 'Visitors and sessions are distinct within each day; adding daily counts can count the same browser or session more than once.')}</p>
        <p className="admin-analytics-method">{text('Thời gian tương tác tạm dừng khi tab bị ẩn, mất tiêu điểm hoặc không có thao tác trong 60 giây; không phải tổng thời gian mở trang. Chặn theo dõi, xóa dữ liệu trình duyệt và đổi thiết bị có thể ảnh hưởng kết quả.', 'Active time pauses when the tab is hidden, unfocused or has no interaction for 60 seconds; it is not total elapsed time. Tracking protection, clearing browser data and changing devices can affect these estimates.')}</p>
      </ReportPanel>
    </>}
  </div>
}
