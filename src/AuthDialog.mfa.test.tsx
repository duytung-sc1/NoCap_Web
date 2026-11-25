// @vitest-environment jsdom
import { act, cleanup, fireEvent, render, screen } from '@testing-library/react'
import { afterEach, beforeEach, describe, expect, it, vi } from 'vitest'
import { AuthDialog } from './App'
import { ApiError } from './api'

const mocks = vi.hoisted(() => ({ login: vi.fn(), google: vi.fn(), success: vi.fn(), close: vi.fn(), initialize: vi.fn(), renderGoogle: vi.fn() }))
vi.mock('./api', async original => ({ ...await original<typeof import('./api')>(), login: mocks.login, loginWithGoogle: mocks.google }))
const account = { token: 'b'.repeat(64), expiresAt: 2100000000, privileged: true, user: { id: 'admin-fixture', email: 'admin@example.test', emailVerified: true } }
const required = () => new ApiError(401, 'factor required', 'MFA_REQUIRED')
beforeEach(() => {
  vi.clearAllMocks(); localStorage.clear(); sessionStorage.clear()
  mocks.login.mockReset().mockRejectedValueOnce(required()).mockResolvedValue(account)
  mocks.google.mockReset().mockRejectedValueOnce(required()).mockResolvedValue(account)
  vi.stubGlobal('google', { accounts: { id: { initialize: mocks.initialize, renderButton: mocks.renderGoogle } } })
})
afterEach(() => { cleanup(); vi.unstubAllGlobals(); vi.useRealTimers() })
function setup() { return render(<AuthDialog lang="vi" onClose={mocks.close} onSuccess={mocks.success} />) }
async function firstFactor() {
  fireEvent.change(screen.getByLabelText('Email'), { target: { value: 'admin@example.test' } })
  fireEvent.change(screen.getByLabelText('Mật khẩu'), { target: { value: 'Fixture-Password-Only!' } })
  fireEvent.submit(screen.getByLabelText('Mật khẩu').closest('form')!)
  await screen.findByRole('heading', { name: 'Xác minh hai bước' })
}
function submitCode(code: string, recovery = false) {
  if (recovery) fireEvent.click(screen.getByRole('button', { name: 'Dùng mã khôi phục' }))
  const input = screen.getByLabelText(recovery ? 'Mã khôi phục' : 'Mã Google Authenticator')
  fireEvent.change(input, { target: { value: code } }); fireEvent.submit(input.closest('form')!)
}

describe('administrator MFA sign-in', () => {
  it('does not authenticate or persist anything after password-only sign-in and retries with the second factor', async () => {
    setup(); await firstFactor()
    expect(mocks.success).not.toHaveBeenCalled()
    expect(screen.queryByLabelText('Mật khẩu')).toBeNull()
    expect([...Array(localStorage.length)].map((_, index) => localStorage.getItem(localStorage.key(index)!)).join('')).not.toContain('Fixture-Password-Only!')
    submitCode('123456')
    await act(async () => { await Promise.resolve() })
    expect(mocks.login).toHaveBeenLastCalledWith('admin@example.test', 'Fixture-Password-Only!', '123456')
    expect(mocks.success).toHaveBeenCalledWith(account, true)
  })

  it('requires the same second factor after Google sign-in and supports recovery codes', async () => {
    setup()
    await act(async () => { await mocks.initialize.mock.calls.at(-1)![0].callback({ credential: 'local.google.jwt' }) })
    expect(screen.getByRole('heading', { name: 'Xác minh hai bước' })).toBeTruthy()
    expect(mocks.success).not.toHaveBeenCalled()
    submitCode('11111111-22222222-33333333-44444444', true)
    await act(async () => { await Promise.resolve() })
    expect(mocks.google).toHaveBeenLastCalledWith('local.google.jwt', '11111111-22222222-33333333-44444444')
    expect(mocks.success).toHaveBeenCalledWith(account, true)
  })

  it('keeps an invalid-code error within the verification step without creating a session', async () => {
    mocks.login.mockReset().mockRejectedValueOnce(required()).mockRejectedValueOnce(new ApiError(401, 'bad factor', 'MFA_INVALID'))
    setup(); await firstFactor(); submitCode('123456')
    expect((await screen.findByRole('alert')).textContent).toContain('Mã không đúng')
    expect(mocks.success).not.toHaveBeenCalled()
    expect((screen.getByLabelText('Mã Google Authenticator') as HTMLInputElement).value).toBe('')
  })

  it('clears the password when returning to first-factor sign-in', async () => {
    setup(); await firstFactor()
    fireEvent.click(screen.getByRole('button', { name: 'Quay lại đăng nhập' }))
    expect((screen.getByLabelText('Mật khẩu') as HTMLInputElement).value).toBe('')
    expect(screen.queryByLabelText('Mã Google Authenticator')).toBeNull()
  })

  it('expires retained first-factor state after five minutes even if the locale changes', async () => {
    vi.useFakeTimers(); vi.setSystemTime(new Date('2026-10-31T10:00:00Z'))
    const view = setup()
    await act(async () => {
      fireEvent.change(screen.getByLabelText('Email'), { target: { value: 'admin@example.test' } })
      fireEvent.change(screen.getByLabelText('Mật khẩu'), { target: { value: 'Fixture-Password-Only!' } })
      fireEvent.submit(screen.getByLabelText('Mật khẩu').closest('form')!); await Promise.resolve()
    })
    await act(async () => { vi.advanceTimersByTime(240000) })
    view.rerender(<AuthDialog lang="en" onClose={mocks.close} onSuccess={mocks.success} />)
    await act(async () => { vi.advanceTimersByTime(60001) })
    expect(screen.queryByRole('heading', { name: 'Two-step verification' })).toBeNull()
    expect((screen.getByLabelText('Password') as HTMLInputElement).value).toBe('')
    expect(mocks.success).not.toHaveBeenCalled()
  })
})
