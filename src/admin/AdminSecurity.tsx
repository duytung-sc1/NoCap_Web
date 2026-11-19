import { useEffect, useRef, useState } from 'react'
import type { Lang } from '../i18n'
import { adminRequest } from './api'
import { AdminMfa } from './AdminMfa'

type Security = { sessions: { createdAt: number; expiresAt: number; current: boolean }[]; truncated: boolean }
type Props = { token: string; lang: Lang; onFailure: (error: unknown) => string }

export function AdminSecurity({ token, lang, onFailure }: Props) {
  const text = (vi: string, en: string) => lang === 'vi' ? vi : en
  const [resource, setResource] = useState<{ key: string; data?: Security; error?: string } | null>(null), [mutationError, setError] = useState(''), [notice, setNotice] = useState('')
  const [revision, setRevision] = useState(0), [confirmed, setConfirmed] = useState(false), [busy, setBusy] = useState(false)
  const key = JSON.stringify([token, lang, revision])
  const data = resource?.key === key ? resource.data : undefined
  const error = mutationError || (resource?.key === key ? resource.error : '')
  const lifetime = useRef<AbortController | null>(null), pending = useRef(false), report = useRef(onFailure)
  useEffect(() => { report.current = onFailure }, [onFailure])
  useEffect(() => {
    const controller = new AbortController(); lifetime.current = controller
    return () => controller.abort()
  }, [token])
  useEffect(() => {
    const controller = new AbortController()
    void adminRequest<Security>(token, 'security', controller.signal).then(value => { if (!controller.signal.aborted) setResource({ key, data: value }) })
      .catch(reason => { if (!controller.signal.aborted) setResource({ key, error: report.current(reason) }) })
    return () => controller.abort()
  }, [token, key])
  async function revokeOthers() {
    if (pending.current || !confirmed || !lifetime.current) return
    const signal = lifetime.current.signal
    pending.current = true; setBusy(true); setError(''); setNotice('')
    try {
      const result = await adminRequest<{ revoked: number }>(token, 'security/revoke-others', signal, {})
      if (signal.aborted) return
      setNotice(text(`Đã đăng xuất ${result.revoked} phiên khác. Phiên hiện tại vẫn được giữ.`, `Signed out ${result.revoked} other sessions. Your current session is preserved.`))
      setConfirmed(false); setRevision(value => value + 1)
    } catch (reason) { if (!signal.aborted) setError(report.current(reason)) }
    finally { pending.current = false; if (!signal.aborted) setBusy(false) }
  }
  const date = (value: number) => new Date(value).toLocaleString(lang === 'vi' ? 'vi-VN' : 'en-US')
  return <div className="admin-security" lang={lang}>
    <p>{text('Phiên quản trị có hạn dùng tối đa một giờ. Thao tác sửa dữ liệu và thu hồi phiên cần lần đăng nhập trong vòng 15 phút gần nhất.', 'Administrator sessions last at most one hour. Data changes and session revocation require a sign-in within the last 15 minutes.')}</p>
    <p>{text('Đăng nhập admin chỉ được lưu trong phiên tab, kể cả khi chọn Ghi nhớ đăng nhập. Đăng nhập và đăng xuất quản trị được ghi vào Lịch sử thao tác.', 'Administrator sign-in is kept only in the tab session, including when Remember me is selected. Administrator sign-in and sign-out are recorded in the audit log.')}</p>
    <AdminMfa token={token} lang={lang} onFailure={onFailure} onChanged={() => setRevision(value => value + 1)} />
    {error && <p role="alert">{error}</p>}
    {notice && <p role="status">{notice}</p>}
    {!data && !error && <p role="status">{text('Đang kiểm tra phiên…', 'Checking sessions…')}</p>}
    {data && <>
      <h3>{text('Các phiên đăng nhập còn hạn', 'Unexpired sign-in sessions')}</h3>
      <p>{text('Đây là phiên đăng nhập, không phải số thiết bị hoặc người đang trực tuyến.', 'These are sign-in sessions, not device counts or people currently online.')}</p>
      {data.truncated && <p>{text('Đang hiển thị tối đa 100 phiên.', 'Showing up to 100 sessions.')}</p>}
      <div className="admin-table-wrap"><table><thead><tr><th>{text('Phiên', 'Session')}</th><th>{text('Đăng nhập', 'Signed in')}</th><th>{text('Hết hạn', 'Expires')}</th></tr></thead><tbody>{data.sessions.map((entry, index) => <tr key={`${entry.createdAt}:${index}`}><td>{entry.current ? text('Phiên này', 'This session') : text('Phiên khác', 'Other session')}</td><td>{date(entry.createdAt)}</td><td>{date(entry.expiresAt)}</td></tr>)}</tbody></table></div>
      <label className="admin-security-confirm"><input type="checkbox" checked={confirmed} disabled={busy} onChange={event => setConfirmed(event.target.checked)} />{text('Tôi muốn đăng xuất tất cả các phiên khác của chính tài khoản admin này.', 'Sign out all other sessions belonging to this administrator account.')}</label>
      <div className="admin-actions"><button type="button" className="primary" disabled={busy || !confirmed} onClick={() => void revokeOthers()}>{busy ? text('Đang thu hồi…', 'Revoking…') : text('Đăng xuất các phiên khác', 'Sign out other sessions')}</button><button type="button" className="secondary" disabled={busy} onClick={() => setRevision(value => value + 1)}>{text('Tải lại', 'Refresh')}</button></div>
    </>}
    {!data && error && <button type="button" className="secondary" onClick={() => setRevision(value => value + 1)}>{text('Thử lại', 'Retry')}</button>}
  </div>
}
