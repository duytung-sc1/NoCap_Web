// @vitest-environment jsdom
import { act, cleanup, fireEvent, render, screen, within } from '@testing-library/react'
import { afterEach, beforeEach, expect, it, vi } from 'vitest'
import { AdminMfa } from './AdminMfa'
import { ApiError } from '../api'

const mocks = vi.hoisted(() => ({ request: vi.fn(), qr: vi.fn(), failure: vi.fn(), changed: vi.fn() }))
vi.mock('./api', () => ({ adminRequest: mocks.request }))
vi.mock('qrcode', () => ({ default: { toDataURL: mocks.qr } }))
const status = { enabled: false, configured: true, passwordSupported: true, recoveryCodesRemaining: 0 }
const codes = ['AAAAAAAA-BBBBBBBB-CCCCCCCC-DDDDDDDD', '11111111-22222222-33333333-44444444']
beforeEach(() => {
  vi.clearAllMocks(); localStorage.clear()
  mocks.qr.mockResolvedValue('data:image/png;base64,Zml4dHVyZQ==')
  mocks.failure.mockReturnValue('Lỗi kiểm tra')
  mocks.request.mockImplementation(async (_token, path, _signal, payload) => {
    if (!payload) return status
    if (path.endsWith('/setup')) return { secret: 'LOCALTESTSETUPKEY', uri: 'otpauth://totp/NoCap:fixture?secret=LOCALTESTSETUPKEY', expiresAt: Date.now() + 600000 }
    return { success: true, recoveryCodes: codes }
  })
})
afterEach(() => { cleanup(); vi.useRealTimers() })
const setup = () => render(<AdminMfa token="admin-fixture" lang="vi" onFailure={mocks.failure} onChanged={mocks.changed} />)
async function begin() {
  await screen.findByText('Chưa bật xác minh hai bước')
  fireEvent.change(screen.getByLabelText('Mật khẩu NoCap hiện tại'), { target: { value: 'Fixture-Password' } })
  fireEvent.submit(screen.getByLabelText('Mật khẩu NoCap hiện tại').closest('form')!)
  await screen.findByAltText('QR thiết lập Google Authenticator')
}

it('generates QR locally and only enables after the owner supplies an OTP, then requires recovery-code acknowledgement', async () => {
  setup(); await begin()
  expect(mocks.qr).toHaveBeenCalledWith(expect.stringContaining('otpauth://'), expect.any(Object))
  expect(mocks.changed).not.toHaveBeenCalled()
  expect(localStorage.length).toBe(0)
  fireEvent.change(screen.getByLabelText('Mã 6 số trong Authenticator'), { target: { value: '123456' } })
  fireEvent.submit(screen.getByLabelText('Mã 6 số trong Authenticator').closest('form')!)
  const recovery = await screen.findByRole('region', { name: 'Mã khôi phục mới' })
  expect(mocks.request).toHaveBeenCalledWith('admin-fixture', 'security/mfa/confirm', expect.any(AbortSignal), { password: 'Fixture-Password', code: '123456' })
  expect(within(recovery).getByText(codes[0])).toBeTruthy()
  expect((within(recovery).getByRole('button', { name: 'Đã lưu, ẩn mã' }) as HTMLButtonElement).disabled).toBe(true)
  fireEvent.click(within(recovery).getByRole('checkbox'))
  fireEvent.click(within(recovery).getByRole('button', { name: 'Đã lưu, ẩn mã' }))
  expect(screen.queryByText(codes[0])).toBeNull()
  expect(mocks.changed).toHaveBeenCalledTimes(1)
})

it('does not expose setup controls without server configuration and explains Google-only account support', async () => {
  mocks.request.mockResolvedValue({ ...status, configured: false, passwordSupported: false })
  setup(); await screen.findByText('Chưa bật xác minh hai bước')
  expect(screen.queryByRole('button', { name: 'Thiết lập Google Authenticator' })).toBeNull()
  expect(screen.getByText(/Tài khoản chỉ dùng Google/)).toBeTruthy()
  expect(mocks.qr).not.toHaveBeenCalled()
})

it('keeps verification off after an invalid confirmation and clears the password', async () => {
  setup(); await begin()
  mocks.request.mockRejectedValueOnce(new ApiError(401, 'invalid', 'MFA_INVALID'))
  fireEvent.change(screen.getByLabelText('Mã 6 số trong Authenticator'), { target: { value: '111111' } })
  fireEvent.submit(screen.getByLabelText('Mã 6 số trong Authenticator').closest('form')!)
  expect((await screen.findByRole('alert')).textContent).toContain('Mã không đúng')
  expect((screen.getByLabelText('Mật khẩu NoCap hiện tại') as HTMLInputElement).value).toBe('')
  expect(mocks.changed).not.toHaveBeenCalled()
  expect(screen.queryByRole('region', { name: 'Mã khôi phục mới' })).toBeNull()
})

it('requires an explicit disable choice and a second factor before requesting removal', async () => {
  mocks.request.mockImplementation(async (_token, _path, _signal, payload) => payload ? { success: true } : { ...status, enabled: true, recoveryCodesRemaining: 10 })
  setup(); await screen.findByText('Đã bật xác minh hai bước')
  const button = screen.getByRole('button', { name: 'Tắt xác minh hai bước' }) as HTMLButtonElement
  expect(button.disabled).toBe(true)
  fireEvent.change(screen.getByLabelText('Mật khẩu NoCap hiện tại'), { target: { value: 'Fixture-Password' } })
  fireEvent.change(screen.getByLabelText('Mã Authenticator hoặc mã khôi phục'), { target: { value: '123456' } })
  expect(button.disabled).toBe(true)
  fireEvent.click(screen.getByRole('checkbox'))
  fireEvent.click(button)
  await screen.findByText('Đã tắt xác minh hai bước và đăng xuất các phiên khác.')
  expect(mocks.request).toHaveBeenCalledWith('admin-fixture', 'security/mfa/disable', expect.any(AbortSignal), { password: 'Fixture-Password', code: '123456' })
})

it('cancels an outstanding setup request when the panel closes', async () => {
  let resolve!: (value: object) => void
  const view = setup(); await screen.findByText('Chưa bật xác minh hai bước')
  mocks.request.mockReturnValueOnce(new Promise(done => { resolve = done }))
  fireEvent.change(screen.getByLabelText('Mật khẩu NoCap hiện tại'), { target: { value: 'Fixture-Password' } })
  fireEvent.submit(screen.getByLabelText('Mật khẩu NoCap hiện tại').closest('form')!)
  const signal = mocks.request.mock.calls.at(-1)![2] as AbortSignal
  view.unmount(); expect(signal.aborted).toBe(true)
  await act(async () => { resolve({ secret: 'stale-secret', uri: 'otpauth://stale', expiresAt: Date.now() + 600000 }) })
  expect(mocks.qr).not.toHaveBeenCalled()
  expect(mocks.changed).not.toHaveBeenCalled()
})
