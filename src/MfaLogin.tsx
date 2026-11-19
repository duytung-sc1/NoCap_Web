import { useEffect, useRef, useState, type FormEvent } from 'react'
import type { Lang } from './i18n'

type Props = { lang: Lang; busy: boolean; message: string; onSubmit: (code: string) => void; onBack: () => void }
export function MfaLogin({ lang, busy, message, onSubmit, onBack }: Props) {
  const vi = lang === 'vi', text = (v: string, e: string) => vi ? v : e
  const [recovery, setRecovery] = useState(false), [code, setCode] = useState('')
  const input = useRef<HTMLInputElement>(null)
  useEffect(() => { input.current?.focus() }, [recovery])
  function submit(event: FormEvent) { event.preventDefault(); if (busy) return; const value = code.trim(); setCode(''); onSubmit(value) }
  return <form onSubmit={submit} lang={lang}>
    <p>{recovery ? text('Dùng một mã khôi phục bạn đã cất khi bật xác minh hai bước. Mỗi mã chỉ dùng một lần.', 'Use one of the recovery codes saved when you enabled verification. Each code works once.') : text('Mở Google Authenticator trên điện thoại và nhập mã 6 số của NoCap.', 'Open Google Authenticator on your phone and enter the six-digit NoCap code.')}</p>
    <label>{recovery ? text('Mã khôi phục', 'Recovery code') : text('Mã Google Authenticator', 'Google Authenticator code')}<input ref={input} name="mfa-code" type="text" autoComplete="one-time-code" autoCapitalize="characters" spellCheck={false} inputMode={recovery ? 'text' : 'numeric'} pattern={recovery ? undefined : '[0-9]{6}'} maxLength={recovery ? 80 : 6} required disabled={busy} value={code} onChange={event => setCode(event.target.value)} /></label>
    {message && <p className="form-message" role="alert">{message}</p>}
    <button className="primary wide" type="submit" disabled={busy}>{busy ? text('Đang xác minh…', 'Verifying…') : text('Xác minh và đăng nhập', 'Verify and sign in')}</button>
    <div className="auth-links"><button type="button" disabled={busy} onClick={() => { setCode(''); setRecovery(value => !value) }}>{recovery ? text('Dùng mã Authenticator', 'Use Authenticator') : text('Dùng mã khôi phục', 'Use a recovery code')}</button><button type="button" disabled={busy} onClick={onBack}>{text('Quay lại đăng nhập', 'Back to sign-in')}</button></div>
  </form>
}
