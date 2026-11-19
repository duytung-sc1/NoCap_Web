// @vitest-environment jsdom
import { useState } from 'react'
import { act, cleanup, fireEvent, render, screen } from '@testing-library/react'
import { afterEach, beforeEach, describe, expect, it, vi } from 'vitest'
import { EmailVerification } from './EmailVerification'
import { ApiError } from './api'
import type { Lang } from './i18n'
import type { Session } from './types'

const mocks = vi.hoisted(() => ({ send: vi.fn(), check: vi.fn(), change: vi.fn(), update: vi.fn(), expired: vi.fn() }))
vi.mock('./api', async original => ({ ...await original<typeof import('./api')>(), sendVerification: mocks.send, getUser: mocks.check, changeUnverifiedEmail: mocks.change }))
const initial: Session = { token: 'a'.repeat(64), expiresAt: 2100000000, user: { id: 'owner', email: 'minhanh@gmail.com', displayName: 'Minh Anh', emailVerified: false } }
function Harness({ lang = 'vi', value = initial }: { lang?: Lang; value?: Session }) {
  const [session, setSession] = useState(value)
  return <EmailVerification session={session} lang={lang} onUserUpdated={(token, user) => {
    mocks.update(token, user)
    if (token !== session.token || user.id !== session.user.id) return false
    setSession({ ...session, user }); return true
  }} onSessionExpired={mocks.expired} />
}
async function flush() { await act(async () => { await Promise.resolve(); await Promise.resolve() }) }
function deferred<T>() { let resolve!: (value: T) => void; const promise = new Promise<T>(done => { resolve = done }); return { promise, resolve } }
function edit(email = 'newaddress@gmail.com', confirm = email) {
  fireEvent.click(screen.getByRole('button', { name: 'Sửa email' }))
  fireEvent.change(screen.getByLabelText('Email mới'), { target: { value: email } })
  fireEvent.change(screen.getByLabelText('Nhập lại email mới'), { target: { value: confirm } })
  fireEvent.change(screen.getByLabelText('Mật khẩu NoCap hiện tại'), { target: { value: 'Current-Password-123!' } })
  fireEvent.submit(screen.getByRole('form', { name: 'Sửa email chưa xác minh' }))
}
beforeEach(() => {
  localStorage.clear()
  vi.clearAllMocks()
  mocks.send.mockReset().mockResolvedValue({ success: true, alreadyVerified: false, user: initial.user })
  mocks.check.mockReset().mockResolvedValue({ user: initial.user })
  mocks.change.mockReset().mockResolvedValue({ user: { ...initial.user, email: 'newaddress@gmail.com' }, emailSent: true })
  vi.spyOn(document, 'visibilityState', 'get').mockReturnValue('visible')
})
afterEach(() => { cleanup(); vi.restoreAllMocks(); vi.useRealTimers() })

describe('email verification and correction', () => {
  it('sends mail, gives inbox/expiry instructions, and prevents repeated clicks during cooldown', async () => {
    vi.useFakeTimers(); vi.setSystemTime(new Date('2026-10-30T14:00:00Z'))
    render(<Harness />)
    fireEvent.click(screen.getByRole('button', { name: 'Gửi lại email xác minh' })); await flush()
    expect(mocks.send).toHaveBeenCalledTimes(1)
    expect(mocks.send.mock.calls[0][0]).toBe(initial.token)
    expect(screen.getByRole('status').textContent).toContain('30 phút')
    const button = screen.getByRole('button', { name: 'Gửi lại sau 60s' }) as HTMLButtonElement
    expect(button.disabled).toBe(true); fireEvent.click(button)
    expect(mocks.send).toHaveBeenCalledTimes(1)
    await act(async () => { vi.advanceTimersByTime(60000) })
    expect((screen.getByRole('button', { name: 'Gửi lại email xác minh' }) as HTMLButtonElement).disabled).toBe(false)
  })

  it('checks server state and removes the verification form only after confirmed verification', async () => {
    mocks.check.mockResolvedValue({ user: { ...initial.user, emailVerified: true } })
    render(<Harness />)
    fireEvent.click(screen.getByRole('button', { name: 'Kiểm tra trạng thái' })); await flush()
    expect(screen.getByText('Email đã xác minh')).toBeTruthy()
    expect(screen.queryByRole('button', { name: 'Gửi lại email xác minh' })).toBeNull()
    expect(mocks.update).toHaveBeenCalledWith(initial.token, expect.objectContaining({ emailVerified: true }))
  })

  it('keeps unverified accounts unverified and explains the confirmation step', async () => {
    render(<Harness />)
    fireEvent.click(screen.getByRole('button', { name: 'Kiểm tra trạng thái' })); await flush()
    expect(screen.getByRole('status').textContent).toContain('vẫn chưa được xác minh')
    expect(screen.getByRole('button', { name: 'Sửa email' })).toBeTruthy()
  })

  it('refreshes state when returning from the email tab and avoids duplicate focus checks', async () => {
    mocks.check.mockResolvedValue({ user: { ...initial.user, emailVerified: true } })
    render(<Harness />)
    fireEvent(window, new Event('focus')); fireEvent(document, new Event('visibilitychange')); await flush()
    expect(mocks.check).toHaveBeenCalledTimes(1)
    expect(screen.getByText('Email đã xác minh')).toBeTruthy()
  })

  it('never reports failed email delivery as sent', async () => {
    mocks.send.mockRejectedValue(new ApiError(503, 'unavailable', 'EMAIL_UNAVAILABLE'))
    render(<Harness />)
    fireEvent.click(screen.getByRole('button', { name: 'Gửi lại email xác minh' })); await flush()
    expect(screen.getByRole('alert').textContent).toContain('Chưa gửi được')
    expect(screen.queryByRole('status')).toBeNull()
    expect((screen.getByRole('button', { name: 'Gửi lại email xác minh' }) as HTMLButtonElement).disabled).toBe(false)
  })

  it('handles server rate limits and expired sessions without pretending verification succeeded', async () => {
    mocks.send.mockRejectedValueOnce(new ApiError(429, 'limited', 'RATE_LIMITED'))
    render(<Harness />)
    fireEvent.click(screen.getByRole('button', { name: 'Gửi lại email xác minh' })); await flush()
    expect(screen.getByRole('alert').textContent).toContain('3 thư')
    mocks.check.mockRejectedValue(new ApiError(401, 'expired', 'UNAUTHORIZED'))
    fireEvent.click(screen.getByRole('button', { name: 'Kiểm tra trạng thái' })); await flush()
    expect(mocks.expired).toHaveBeenCalledWith(initial.token)
  })

  it('explains sample emails and directs demo accounts to correct the address', () => {
    render(<Harness value={{ ...initial, user: { ...initial.user, email: 'minh.anh.demo.261030@example.com' } }} />)
    expect(screen.getByText(/Địa chỉ hiện tại là email mẫu/)).toBeTruthy()
    expect((screen.getByRole('button', { name: 'Gửi lại email xác minh' }) as HTMLButtonElement).disabled).toBe(true)
    expect(screen.getByRole('button', { name: 'Sửa email' })).toBeTruthy()
  })

  it('requires matching real email addresses before submitting a correction', async () => {
    render(<Harness />); edit('newaddress@gmail.com', 'typo@gmail.com'); await flush()
    expect(screen.getByRole('alert').textContent).toContain('chưa khớp')
    expect(mocks.change).not.toHaveBeenCalled()
  })

  it('saves a corrected email while preserving account identity and waiting for verification', async () => {
    render(<Harness />); edit(); await flush()
    expect(mocks.change).toHaveBeenCalledWith(initial.token, 'newaddress@gmail.com', 'Current-Password-123!', expect.any(AbortSignal))
    expect(mocks.update).toHaveBeenCalledWith(initial.token, expect.objectContaining({ id: 'owner', email: 'newaddress@gmail.com', emailVerified: false }))
    expect(screen.getByRole('status').textContent).toContain('Đã cập nhật email')
    expect(screen.queryByRole('form')).toBeNull()
    expect(screen.queryByText('Email đã xác minh')).toBeNull()
  })

  it('updates the saved address even if sending the new verification email fails', async () => {
    mocks.change.mockResolvedValue({ user: { ...initial.user, email: 'newaddress@gmail.com' }, emailSent: false, verificationError: { code: 'EMAIL_UNAVAILABLE' } })
    render(<Harness />); edit(); await flush()
    expect(mocks.update).toHaveBeenCalledWith(initial.token, expect.objectContaining({ email: 'newaddress@gmail.com' }))
    expect(screen.getByRole('status').textContent).toContain('chưa gửi được')
    expect(screen.getByRole('alert')).toBeTruthy()
    expect(screen.getByRole('button', { name: 'Gửi lại email xác minh' })).toBeTruthy()
  })

  it('does not log out a user who mistypes the current password and clears the password field', async () => {
    mocks.change.mockRejectedValue(new ApiError(401, 'incorrect', 'INVALID_PASSWORD'))
    render(<Harness />); edit(); await flush()
    expect(screen.getByRole('alert').textContent).toContain('Mật khẩu hiện tại không đúng')
    expect((screen.getByLabelText('Mật khẩu NoCap hiện tại') as HTMLInputElement).value).toBe('')
    expect(mocks.expired).not.toHaveBeenCalled()
  })

  it('ignores responses from the previous account after a token switch', async () => {
    const pending = deferred<{ user: typeof initial.user }>()
    mocks.check.mockReturnValue(pending.promise)
    const properties = { lang: 'vi' as const, onUserUpdated: mocks.update.mockReturnValue(true), onSessionExpired: mocks.expired }
    const view = render(<EmailVerification {...properties} session={initial} />)
    fireEvent.click(screen.getByRole('button', { name: 'Kiểm tra trạng thái' }))
    view.rerender(<EmailVerification {...properties} session={{ ...initial, token: 'b'.repeat(64), user: { ...initial.user, id: 'other' } }} />)
    pending.resolve({ user: { ...initial.user, emailVerified: true } }); await flush()
    expect(mocks.update).not.toHaveBeenCalled()
    expect(screen.queryByText('Email đã xác minh')).toBeNull()
  })

  it('uses English interface copy and an independent language scope', async () => {
    render(<Harness lang="en" />)
    const region = screen.getByRole('region', { name: 'Email verification' })
    expect(region.getAttribute('lang')).toBe('en')
    fireEvent.click(screen.getByRole('button', { name: 'Resend verification email' })); await flush()
    expect(screen.getByRole('status').textContent).toContain('Verification email sent')
    expect(screen.getByRole('button', { name: 'Correct email address' })).toBeTruthy()
  })

  it('does not render a previous Vietnamese status message through the English font after a locale switch', async () => {
    const properties = { session: initial, onUserUpdated: mocks.update.mockReturnValue(true), onSessionExpired: mocks.expired }
    const view = render(<EmailVerification {...properties} lang="vi" />)
    fireEvent.click(screen.getByRole('button', { name: 'Gửi lại email xác minh' })); await flush()
    expect(screen.getByRole('status').textContent).toContain('Đã gửi thư')
    view.rerender(<EmailVerification {...properties} lang="en" />)
    expect(screen.queryByRole('status')).toBeNull()
    expect(screen.getByRole('region', { name: 'Email verification' }).getAttribute('lang')).toBe('en')
  })

  it('skips the reminder without sending mail or granting verification and can reopen it', () => {
    render(<Harness />)
    fireEvent.click(screen.getByRole('button', { name: 'Bỏ qua lúc này' }))
    expect(screen.getByText('Email chưa xác minh')).toBeTruthy()
    expect(screen.getByText(/không thể nhận thư đặt lại mật khẩu/)).toBeTruthy()
    expect(screen.queryByRole('button', { name: 'Gửi lại email xác minh' })).toBeNull()
    expect(mocks.send).not.toHaveBeenCalled()
    expect(mocks.change).not.toHaveBeenCalled()
    expect(mocks.update).not.toHaveBeenCalled()
    expect(document.activeElement).toBe(screen.getByRole('button', { name: 'Xác minh email' }))
    fireEvent.click(screen.getByRole('button', { name: 'Xác minh email' }))
    expect(screen.getByRole('button', { name: 'Gửi lại email xác minh' })).toBeTruthy()
    expect(document.activeElement).toBe(screen.getByRole('button', { name: 'Bỏ qua lúc này' }))
  })

  it('remembers skipping across remounts and locales, but not across accounts or email changes', () => {
    const properties = { onUserUpdated: mocks.update, onSessionExpired: mocks.expired }
    const view = render(<EmailVerification {...properties} session={initial} lang="vi" />)
    fireEvent.click(screen.getByRole('button', { name: 'Bỏ qua lúc này' }))
    view.rerender(<EmailVerification {...properties} session={initial} lang="en" />)
    expect(screen.getByText('Email not verified')).toBeTruthy()
    expect(screen.getByRole('button', { name: 'Verify email' })).toBeTruthy()
    expect(screen.queryByText('Email chưa xác minh')).toBeNull()
    view.rerender(<EmailVerification {...properties} session={{ ...initial, user: { ...initial.user, email: 'changed@example.test' } }} lang="en" />)
    expect(screen.getByRole('button', { name: 'Skip for now' })).toBeTruthy()
    view.rerender(<EmailVerification {...properties} session={{ ...initial, token: 'b'.repeat(64), user: { ...initial.user, id: 'other' } }} lang="en" />)
    expect(screen.getByRole('button', { name: 'Skip for now' })).toBeTruthy()
    view.unmount()
    render(<Harness />)
    expect(screen.getByRole('button', { name: 'Xác minh email' })).toBeTruthy()
  })

  it('refreshes a skipped account from the server and only then displays verified status', async () => {
    render(<Harness />)
    fireEvent.click(screen.getByRole('button', { name: 'Bỏ qua lúc này' }))
    mocks.check.mockResolvedValue({ user: { ...initial.user, emailVerified: true } })
    fireEvent(window, new Event('focus')); await flush()
    expect(screen.getByText('Email đã xác minh')).toBeTruthy()
    expect(screen.queryByRole('button', { name: 'Xác minh email' })).toBeNull()
  })

  it('allows sample addresses to skip and works when preference storage is blocked', () => {
    vi.spyOn(Storage.prototype, 'getItem').mockImplementation(() => { throw new DOMException('Blocked', 'SecurityError') })
    vi.spyOn(Storage.prototype, 'setItem').mockImplementation(() => { throw new DOMException('Blocked', 'SecurityError') })
    render(<Harness value={{ ...initial, user: { ...initial.user, email: 'demo@example.com' } }} />)
    fireEvent.click(screen.getByRole('button', { name: 'Bỏ qua lúc này' }))
    expect(screen.getByRole('button', { name: 'Xác minh email' })).toBeTruthy()
    expect(mocks.update).not.toHaveBeenCalled()
  })

  it('does not skip during a pending action and clears sensitive correction fields when skipped', async () => {
    const pending = deferred<{ user: typeof initial.user }>()
    mocks.check.mockReturnValue(pending.promise)
    render(<Harness />)
    fireEvent.click(screen.getByRole('button', { name: 'Kiểm tra trạng thái' }))
    expect((screen.getByRole('button', { name: 'Bỏ qua lúc này' }) as HTMLButtonElement).disabled).toBe(true)
    pending.resolve({ user: initial.user }); await flush()
    fireEvent.click(screen.getByRole('button', { name: 'Sửa email' }))
    fireEvent.change(screen.getByLabelText('Mật khẩu NoCap hiện tại'), { target: { value: 'Private-Password' } })
    fireEvent.click(screen.getByRole('button', { name: 'Bỏ qua lúc này' }))
    fireEvent.click(screen.getByRole('button', { name: 'Xác minh email' }))
    fireEvent.click(screen.getByRole('button', { name: 'Sửa email' }))
    expect((screen.getByLabelText('Mật khẩu NoCap hiện tại') as HTMLInputElement).value).toBe('')
  })
})
