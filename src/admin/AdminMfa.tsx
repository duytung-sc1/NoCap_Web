import { useCallback, useEffect, useRef, useState, type FormEvent } from 'react'
import type { Lang } from '../i18n'
import { adminRequest } from './api'
import { mfaError } from '../mfaErrors'
import './AdminMfa.css'

type Status = { enabled: boolean; configured: boolean; passwordSupported: boolean; recoveryCodesRemaining: number }
type Setup = { secret: string; uri: string; expiresAt: number; qr: string }
type Props = { token: string; lang: Lang; onFailure: (error: unknown) => string; onChanged: () => void }

export function AdminMfa({ token, lang, onFailure, onChanged }: Props) {
  const text = useCallback((v: string, e: string) => lang === 'vi' ? v : e, [lang])
  const [status, setStatus] = useState<Status | null>(null), [revision, setRevision] = useState(0)
  const [password, setPassword] = useState(''), [code, setCode] = useState(''), [setup, setSetup] = useState<Setup | null>(null)
  const [codes, setCodes] = useState<string[]>([]), [saved, setSaved] = useState(false), [disableConfirmed, setDisableConfirmed] = useState(false)
  const [busy, setBusy] = useState(false), [error, setError] = useState(''), [notice, setNotice] = useState('')
  const lifetime = useRef<AbortController | null>(null), pending = useRef(false), callbacks = useRef({ onFailure, onChanged })
  const failure = useCallback((reason: unknown) => { const fallback = callbacks.current.onFailure(reason); return mfaError(reason, lang) || fallback }, [lang])
  useEffect(() => { callbacks.current = { onFailure, onChanged } }, [onFailure, onChanged])
  useEffect(() => { const controller = new AbortController(); lifetime.current = controller; return () => controller.abort() }, [token])
  useEffect(() => {
    const controller = new AbortController()
    void adminRequest<Status>(token, 'security/mfa', controller.signal).then(value => { if (!controller.signal.aborted) setStatus(value) })
      .catch(reason => { if (!controller.signal.aborted) setError(failure(reason)) })
    return () => controller.abort()
  }, [token, lang, revision, failure])
  useEffect(() => {
    if (!setup) return
    const timer = window.setTimeout(() => {
      setSetup(null); setPassword(''); setCode('')
      setError(text('Mã thiết lập đã hết hạn. Hãy tạo mã QR mới.', 'Setup expired. Generate a new QR code.'))
    }, Math.max(0, setup.expiresAt - Date.now()))
    return () => window.clearTimeout(timer)
  }, [setup, text])

  async function act(action: 'setup' | 'confirm' | 'recovery-codes' | 'disable') {
    if (pending.current || !lifetime.current || (action === 'disable' && !disableConfirmed)) return
    const signal = lifetime.current.signal, secret = password, enteredCode = code
    pending.current = true; setBusy(true); setError(''); setNotice(''); setCode('')
    if (action !== 'setup') setPassword('')
    try {
      if (action === 'setup') {
        const result = await adminRequest<Omit<Setup, 'qr'>>(token, 'security/mfa/setup', signal, { password: secret })
        if (signal.aborted) return
        const qr = (await import('qrcode')).default
        const image = await qr.toDataURL(result.uri, { width: 240, margin: 2, errorCorrectionLevel: 'M' })
        if (!signal.aborted) setSetup({ ...result, qr: image })
      } else {
        const result = await adminRequest<{ recoveryCodes?: string[] }>(token, `security/mfa/${action}`, signal, { password: secret, code: enteredCode.trim() })
        if (signal.aborted) return
        setSetup(null); setCodes(result.recoveryCodes || []); setSaved(false); setDisableConfirmed(false)
        setNotice(action === 'disable' ? text('Đã tắt xác minh hai bước và đăng xuất các phiên khác.', 'Two-step verification disabled; other sessions signed out.') : text('Đã cập nhật xác minh hai bước. Hãy cất các mã khôi phục ở nơi riêng tư.', 'Two-step verification updated. Store your recovery codes privately.'))
        setRevision(value => value + 1); callbacks.current.onChanged()
      }
    } catch (reason) { if (!signal.aborted) { setPassword(''); setError(failure(reason)) } }
    finally { pending.current = false; if (!signal.aborted) setBusy(false) }
  }
  const submit = (event: FormEvent, action: 'setup' | 'confirm') => { event.preventDefault(); if (!status?.enabled) void act(action) }
  return <section className="admin-mfa" lang={lang} aria-label={text('Xác minh hai bước', 'Two-step verification')}>
    <h3 lang="en">Google Authenticator</h3>
    <p>{text('Mã 6 số từ ứng dụng trên điện thoại. Không cần SMS hay phí gửi mã.', 'Use a six-digit code from your phone app. No SMS or per-message fees.')}</p>
    {error && <p role="alert">{error}</p>}
    {notice && <p role="status">{notice}</p>}
    {!status && !error && <p role="status">{text('Đang kiểm tra…', 'Checking…')}</p>}
    {status && <p><strong>{status.enabled ? text('Đã bật xác minh hai bước', 'Two-step verification enabled') : text('Chưa bật xác minh hai bước', 'Two-step verification is off')}</strong>{status.enabled && ` · ${text(`Còn ${status.recoveryCodesRemaining} mã khôi phục`, `${status.recoveryCodesRemaining} recovery codes remaining`)}`}</p>}
    {status && !status.configured && <p>{text('Chức năng chưa sẵn sàng. Người vận hành cần hoàn tất cấu hình bảo mật trước khi bạn thiết lập.', 'This feature is not ready. The operator must finish the security configuration before setup.')}</p>}
    {status && !status.passwordSupported && <p>{text('Tài khoản chỉ dùng Google cần người vận hành hỗ trợ thiết lập mật khẩu NoCap trước.', 'A Google-only account needs operator assistance to set up a NoCap password first.')}</p>}
    {!!codes.length && <div className="admin-mfa-recovery" role="region" aria-label={text('Mã khôi phục mới', 'New recovery codes')}>
      <p>{text('Mỗi mã chỉ dùng một lần thay cho mã Authenticator khi đăng nhập. Các mã này chỉ được hiển thị lần này. Không gửi mã cho người khác.', 'Each code replaces an Authenticator code for one sign-in. These codes are shown only this time. Keep them private.')}</p>
      <ul>{codes.map(value => <li key={value} lang="en">{value}</li>)}</ul>
      <label className="admin-security-confirm"><input type="checkbox" checked={saved} onChange={event => setSaved(event.target.checked)} />{text('Tôi đã cất các mã khôi phục ở nơi an toàn.', 'I have stored my recovery codes safely.')}</label>
      <button type="button" className="secondary" disabled={!saved} onClick={() => { setCodes([]); setSaved(false) }}>{text('Đã lưu, ẩn mã', 'Saved, hide codes')}</button>
    </div>}
    {status?.configured && status.passwordSupported && !codes.length && <form className="admin-mfa-form" onSubmit={event => submit(event, setup ? 'confirm' : 'setup')}>
      {setup && <div className="admin-mfa-setup">
        <p>{text('Trong Google Authenticator, nhấn + rồi quét mã QR. Bạn cũng có thể chọn nhập khóa thiết lập và dùng khóa bên dưới.', 'In Google Authenticator, tap + and scan this QR code, or enter the setup key below.')}</p>
        <img className="admin-mfa-qr" src={setup.qr} width={240} height={240} alt={text('QR thiết lập Google Authenticator', 'Google Authenticator setup QR')} />
        <p>{text('Khóa thiết lập — không chia sẻ:', 'Setup key — keep private:')} <span className="admin-mfa-key" lang="en">{setup.secret}</span></p>
        <p>{text('Thiết lập có hiệu lực 10 phút. Chưa bật cho đến khi bạn xác nhận bằng mã 6 số. Các phiên khác sẽ được đăng xuất sau khi bật.', 'Setup is valid for 10 minutes. Verification remains off until you confirm with a six-digit code. Other sessions will be signed out when enabled.')}</p>
      </div>}
      <label>{text('Mật khẩu NoCap hiện tại', 'Current NoCap password')}<input type="password" autoComplete="current-password" required maxLength={256} value={password} disabled={busy} onChange={event => setPassword(event.target.value)} /></label>
      {(setup || status.enabled) && <label>{setup ? text('Mã 6 số trong Authenticator', 'Six-digit Authenticator code') : text('Mã Authenticator hoặc mã khôi phục', 'Authenticator or recovery code')}<input type="text" autoComplete="one-time-code" autoCapitalize="characters" spellCheck={false} inputMode={setup ? 'numeric' : 'text'} pattern={setup ? '[0-9]{6}' : undefined} required maxLength={setup ? 6 : 80} value={code} disabled={busy} onChange={event => setCode(event.target.value)} /></label>}
      {status.enabled ? <>
        <p>{text('Tạo lại mã sẽ vô hiệu hóa bộ mã cũ và đăng xuất các phiên khác. Cần mật khẩu và mã xác minh mới.', 'Regenerating codes invalidates the old set and signs out other sessions. Enter your password and a fresh verification code.')}</p>
        <button type="button" className="secondary" disabled={busy || !password || !code.trim()} onClick={() => void act('recovery-codes')}>{text('Tạo lại mã khôi phục', 'Regenerate recovery codes')}</button>
        <label className="admin-security-confirm"><input type="checkbox" checked={disableConfirmed} disabled={busy} onChange={event => setDisableConfirmed(event.target.checked)} />{text('Tôi muốn tắt xác minh hai bước cho tài khoản này.', 'I want to disable two-step verification for this account.')}</label>
        <button type="button" className="secondary" disabled={busy || !disableConfirmed || !password || !code.trim()} onClick={() => void act('disable')}>{text('Tắt xác minh hai bước', 'Disable two-step verification')}</button>
      </> : <div className="admin-actions"><button type="submit" className="primary" disabled={busy}>{busy ? text('Đang xử lý…', 'Processing…') : setup ? text('Xác nhận và bật', 'Confirm and enable') : text('Thiết lập Google Authenticator', 'Set up Google Authenticator')}</button>{setup && <button type="button" className="secondary" disabled={busy} onClick={() => { setSetup(null); setPassword(''); setCode('') }}>{text('Hủy thiết lập', 'Cancel setup')}</button>}</div>}
    </form>}
  </section>
}
