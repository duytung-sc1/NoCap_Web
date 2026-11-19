import { useEffect, useRef, useState, type FormEvent } from 'react'
import { CheckCircle2, Mail, RefreshCw } from 'lucide-react'
import { ApiError, changeUnverifiedEmail, getUser, sendVerification } from './api'
import type { Lang } from './i18n'
import type { Session, User } from './types'
import { readEmailReminderSkipped, saveEmailReminderSkipped } from './emailVerificationReminder'
import './EmailVerification.css'

type Props = {
  session: Session
  lang: Lang
  onUserUpdated: (token: string, user: User) => boolean
  onSessionExpired: (token: string) => void
}
const demoEmail = (email: string) => /@(?:[^@.]+\.)*(?:example\.(?:com|net|org)|invalid|example)$/i.test(email)

export function EmailVerification(props: Props) {
  return <Verification key={`${props.session.token}:${props.lang}`} {...props} />
}

function Verification({ session, lang, onUserUpdated, onSessionExpired }: Props) {
  const vi = lang === 'vi'
  const text = (vietnamese: string, english: string) => vi ? vietnamese : english
  const [busy, setBusy] = useState<'send' | 'check' | 'change' | null>(null)
  const [message, setMessage] = useState(''), [error, setError] = useState('')
  const [editing, setEditing] = useState(false)
  const reminderScope = JSON.stringify([session.user.id, session.user.email.trim().toLowerCase()])
  const [reminder, setReminder] = useState(() => ({ scope: reminderScope, skipped: readEmailReminderSkipped(session.user) }))
  const skipped = reminder.scope === reminderScope ? reminder.skipped : readEmailReminderSkipped(session.user)
  const reminderAction = useRef<HTMLButtonElement | null>(null), focusReminderAction = useRef(false)
  const [email, setEmail] = useState(''), [confirmation, setConfirmation] = useState(''), [password, setPassword] = useState('')
  const [cooldownUntil, setCooldownUntil] = useState(0), [clock, setClock] = useState(Date.now)
  const request = useRef<AbortController | null>(null), mounted = useRef(false)
  const callbacks = useRef({ onUserUpdated, onSessionExpired })
  useEffect(() => { callbacks.current = { onUserUpdated, onSessionExpired } }, [onUserUpdated, onSessionExpired])
  const remaining = Math.max(0, Math.ceil((cooldownUntil - clock) / 1000))
  const reserved = demoEmail(session.user.email)

  function skipReminder(value: boolean) {
    focusReminderAction.current = true
    saveEmailReminderSkipped(session.user, value)
    setReminder({ scope: reminderScope, skipped: value })
    setEditing(false); setPassword(''); setEmail(''); setConfirmation(''); setError(''); setMessage('')
  }

  useEffect(() => {
    if (focusReminderAction.current) { reminderAction.current?.focus(); focusReminderAction.current = false }
  }, [skipped])

  useEffect(() => {
    mounted.current = true
    return () => { mounted.current = false; request.current?.abort() }
  }, [])
  useEffect(() => {
    if (cooldownUntil <= Date.now()) return
    const timer = window.setInterval(() => { const now = Date.now(); setClock(now); if (now >= cooldownUntil) window.clearInterval(timer) }, 1000)
    return () => window.clearInterval(timer)
  }, [cooldownUntil])

  function start(kind: 'send' | 'check' | 'change') {
    if (request.current) return null
    const controller = new AbortController()
    request.current = controller
    setBusy(kind); setError(''); setMessage('')
    return controller
  }
  const active = (controller: AbortController) => mounted.current && !controller.signal.aborted && request.current === controller
  function finish(controller: AbortController) {
    if (request.current === controller) { request.current = null; if (mounted.current) setBusy(null) }
  }
  function cooldown() { const now = Date.now(); setClock(now); setCooldownUntil(now + 60000) }
  function showError(reason: unknown) {
    if (reason instanceof ApiError) {
      if (reason.status === 401 && reason.code !== 'INVALID_PASSWORD') callbacks.current.onSessionExpired(session.token)
      if (reason.status === 429) { cooldown(); return text('Bạn thao tác quá nhanh. Chờ trước khi gửi lại; tối đa 3 thư xác minh mỗi giờ.', 'Too many attempts. Wait before trying again; at most 3 verification emails per hour.') }
      const messages: Record<string, string> = {
        INVALID_PASSWORD: text('Mật khẩu hiện tại không đúng.', 'Your current password is incorrect.'),
        EMAIL_IN_USE: text('Không thể sử dụng địa chỉ email này. Hãy chọn địa chỉ khác.', 'This email address cannot be used. Choose another address.'),
        EMAIL_ALREADY_VERIFIED: text('Email đã được xác minh. Nhấn Kiểm tra trạng thái để cập nhật.', 'Your email is already verified. Check its status to update this page.'),
        PASSWORD_REQUIRED: text('Tài khoản này không có mật khẩu NoCap để xác nhận thay đổi.', 'This account has no NoCap password to confirm an email change.'),
        ACCOUNT_CHANGED: text('Thông tin tài khoản đã thay đổi. Nhấn Kiểm tra trạng thái.', 'Account details changed. Check the status again.'),
        EMAIL_UNAVAILABLE: text('Chưa gửi được thư xác minh. Kiểm tra địa chỉ hoặc thử lại sau.', 'The verification email could not be sent. Check the address or try again later.'),
        SAME_EMAIL: text('Hãy nhập địa chỉ email khác với địa chỉ hiện tại.', 'Enter a different email address.'),
      }
      if (reason.code && messages[reason.code]) return messages[reason.code]
      if (reason.status === 401) return text('Phiên đăng nhập đã hết hạn. Vui lòng đăng nhập lại.', 'Your session expired. Please sign in again.')
    }
    return text('Không hoàn tất được thao tác. Kiểm tra kết nối rồi thử lại.', 'Unable to complete this action. Check your connection and try again.')
  }
  function accept(user: User) {
    if (user.id !== session.user.id) return false
    return callbacks.current.onUserUpdated(session.token, user)
  }

  async function check(automatic = false) {
    const controller = start('check')
    if (!controller) return
    try {
      const result = await getUser(session.token, controller.signal)
      if (!active(controller) || !accept(result.user)) return
      if (result.user.emailVerified) {
        setMessage(text('Email đã xác minh. Bạn có thể tiếp tục sử dụng tài khoản.', 'Email verified. You can continue using your account.'))
        setEditing(false); setPassword('')
      } else if (!automatic) setMessage(text('Email vẫn chưa được xác minh. Mở liên kết trong thư và nhấn Xác nhận, rồi kiểm tra lại.', 'Your email is not verified yet. Open the email link, press Confirm, then check again.'))
    } catch (reason) { if (active(controller)) { const failure = showError(reason); if (!automatic) setError(failure) } }
    finally { finish(controller) }
  }

  const checkRef = useRef(check)
  useEffect(() => { checkRef.current = check })
  useEffect(() => {
    if (session.user.emailVerified) return
    let lastCheck = 0
    const returned = () => {
      if (document.visibilityState !== 'visible' || Date.now() - lastCheck < 5000) return
      lastCheck = Date.now()
      void checkRef.current(true)
    }
    window.addEventListener('focus', returned)
    document.addEventListener('visibilitychange', returned)
    return () => { window.removeEventListener('focus', returned); document.removeEventListener('visibilitychange', returned) }
  }, [session.token, session.user.emailVerified])

  async function send() {
    if (remaining > 0 || reserved) return
    const controller = start('send')
    if (!controller) return
    try {
      const result = await sendVerification(session.token, controller.signal)
      if (!active(controller) || !accept(result.user)) return
      if (result.alreadyVerified) setMessage(text('Email đã được xác minh.', 'Your email is already verified.'))
      else {
        cooldown()
        setMessage(text('Đã gửi thư xác minh. Kiểm tra hộp thư đến và thư rác; liên kết có hiệu lực 30 phút.', 'Verification email sent. Check your inbox and spam folder; the link is valid for 30 minutes.'))
      }
    } catch (reason) { if (active(controller)) setError(showError(reason)) }
    finally { finish(controller) }
  }

  async function change(event: FormEvent<HTMLFormElement>) {
    event.preventDefault()
    const address = email.trim().toLowerCase()
    if (address !== confirmation.trim().toLowerCase()) { setError(text('Hai địa chỉ email chưa khớp nhau.', 'The email addresses do not match.')); return }
    if (address === session.user.email.toLowerCase() || demoEmail(address)) { setError(text('Hãy dùng email thật mà bạn có thể mở hộp thư.', 'Use a real email address whose inbox you can access.')); return }
    const controller = start('change')
    if (!controller) return
    const currentPassword = password
    setPassword('')
    try {
      const result = await changeUnverifiedEmail(session.token, address, currentPassword, controller.signal)
      if (!active(controller) || !accept(result.user)) return
      setEditing(false); setEmail(''); setConfirmation('')
      if (result.emailSent) {
        cooldown()
        setMessage(text('Đã cập nhật email và gửi thư đến địa chỉ mới. Mở thư để xác minh; tài liệu và gói của bạn vẫn được giữ nguyên.', 'Email updated and verification sent to your new address. Open the email to verify it; your documents and plan are preserved.'))
      } else {
        setMessage(text('Địa chỉ email đã cập nhật, nhưng chưa gửi được thư xác minh.', 'Your email address was updated, but the verification email could not be sent.'))
        const failure = result.verificationError
        setError(showError(new ApiError(failure?.code === 'RATE_LIMITED' ? 429 : 503, '', failure?.code || 'EMAIL_UNAVAILABLE')))
      }
    } catch (reason) { if (active(controller)) setError(showError(reason)) }
    finally { finish(controller) }
  }

  return <section className={`email-verification ${session.user.emailVerified ? 'is-verified' : ''}`} lang={lang} aria-label={text('Xác minh email', 'Email verification')}>
    <div className="email-verification-heading">{session.user.emailVerified ? <CheckCircle2 size={17} aria-hidden="true" /> : <Mail size={17} aria-hidden="true" />}<strong>{text(session.user.emailVerified ? 'Email đã xác minh' : skipped ? 'Email chưa xác minh' : 'Xác minh địa chỉ email', session.user.emailVerified ? 'Email verified' : skipped ? 'Email not verified' : 'Verify your email address')}</strong></div>
    {!session.user.emailVerified && skipped && <>
      <p>{text('Đã bỏ qua lời nhắc trên trình duyệt này. Bạn vẫn có thể đăng nhập và đọc. Lưu tệp lên cloud cần xác minh email; nếu không mở được hộp thư, bạn không thể nhận thư đặt lại mật khẩu.', 'Reminder skipped on this browser. You can still sign in and read. Cloud file storage requires verification; without inbox access, you cannot receive password-reset emails.')}</p>
      <div className="email-verification-actions"><button ref={reminderAction} className="secondary" type="button" disabled={!!busy} onClick={() => skipReminder(false)}>{text('Xác minh email', 'Verify email')}</button></div>
    </>}
    {!session.user.emailVerified && !skipped && <>
      <p>{text('Email chưa xác minh. Bạn vẫn có thể đọc; một số chức năng lưu trữ trực tuyến cần xác minh email.', 'Your email is not verified. You can keep reading; some cloud features require email verification.')}</p>
      <p className="email-verification-help">{reserved ? text('Địa chỉ hiện tại là email mẫu, không có hộp thư nhận thư. Bạn có thể bỏ qua hoặc sửa thành địa chỉ nhận được thư.', 'This is a sample email address without a real inbox. You can skip or replace it with an address that can receive email.') : text('Không thấy thư? Kiểm tra Thư rác/Spam và địa chỉ email. Nếu nhập sai hoặc không mở được hộp thư, bạn có thể sửa email bên dưới.', 'No email? Check Spam and your email address. If the address is wrong or you cannot access its inbox, correct it below.')}</p>
      <p className="email-verification-help">{text('Không cần dùng email cá nhân chính. Bạn có thể dùng email bí danh nhận được thư, hoặc bỏ qua lúc này. Nếu không mở được hộp thư, bạn không thể nhận thư đặt lại mật khẩu. Bỏ qua không xác minh email hay mở khóa lưu tệp lên cloud.', 'You do not need your main personal email. Use an alias that receives mail, or skip for now. Without inbox access, you cannot receive password-reset emails. Skipping does not verify your email or unlock cloud file storage.')}</p>
      <div className="email-verification-actions">
        <button className="primary" type="button" disabled={!!busy || remaining > 0 || reserved} onClick={() => void send()}><Mail size={15} aria-hidden="true" />{busy === 'send' ? text('Đang gửi…', 'Sending…') : remaining > 0 ? text(`Gửi lại sau ${remaining}s`, `Resend in ${remaining}s`) : text('Gửi lại email xác minh', 'Resend verification email')}</button>
        <button className="secondary" type="button" disabled={!!busy} onClick={() => void check()}><RefreshCw size={15} aria-hidden="true" />{busy === 'check' ? text('Đang kiểm tra…', 'Checking…') : text('Kiểm tra trạng thái', 'Check verification status')}</button>
        <button className="secondary" type="button" disabled={!!busy} aria-expanded={editing} onClick={() => { setEditing(value => !value); setPassword(''); setError(''); setMessage('') }}>{text(editing ? 'Đóng sửa email' : 'Sửa email', editing ? 'Close email correction' : 'Correct email address')}</button>
        <button ref={reminderAction} className="secondary" type="button" disabled={!!busy} onClick={() => skipReminder(true)}>{text('Bỏ qua lúc này', 'Skip for now')}</button>
      </div>
      {editing && <form className="email-verification-form" aria-label={text('Sửa email chưa xác minh', 'Correct an unverified email')} onSubmit={event => void change(event)}>
        <p>{text('Nhập email bạn sở hữu và mật khẩu NoCap hiện tại. Địa chỉ mới vẫn cần xác minh; các phiên đăng nhập khác và liên kết cũ sẽ hết hiệu lực.', 'Enter an email address you own and your current NoCap password. The new address must still be verified; other sessions and old account links will be revoked.')}</p>
        <p className="email-verification-help">{text('Nếu không nhớ mật khẩu và không truy cập được hộp thư cũ, hãy liên hệ nhóm NoCap để được hỗ trợ.', 'If you have forgotten your password and cannot access the old inbox, contact the NoCap team for help.')}</p>
        <label>{text('Email mới', 'New email address')}<input type="email" name="new-email" autoComplete="email" autoCapitalize="none" spellCheck={false} required maxLength={254} value={email} disabled={!!busy} onChange={event => setEmail(event.target.value)} /></label>
        <label>{text('Nhập lại email mới', 'Confirm new email address')}<input type="email" name="confirm-email" autoComplete="off" autoCapitalize="none" spellCheck={false} required maxLength={254} value={confirmation} disabled={!!busy} onChange={event => setConfirmation(event.target.value)} /></label>
        <label>{text('Mật khẩu NoCap hiện tại', 'Current NoCap password')}<input type="password" name="current-password" autoComplete="current-password" required maxLength={256} value={password} disabled={!!busy} onChange={event => setPassword(event.target.value)} /></label>
        <button className="primary" type="submit" disabled={!!busy}>{busy === 'change' ? text('Đang cập nhật…', 'Updating…') : text('Lưu email và gửi xác minh', 'Save email and send verification')}</button>
      </form>}
    </>}
    {message && <p className="email-verification-message" role="status">{message}</p>}
    {error && <p className="email-verification-error" role="alert">{error}</p>}
  </section>
}
