// @vitest-environment jsdom
import { act, cleanup, fireEvent, render, screen } from '@testing-library/react'
import { afterEach, beforeEach, expect, it, vi } from 'vitest'
import { AdminSecurity } from './AdminSecurity'
import { ApiError } from '../api'

const mocks = vi.hoisted(() => ({ request: vi.fn(), failure: vi.fn() }))
vi.mock('./api', () => ({ adminRequest: mocks.request }))
const data = { sessions: [{ createdAt: 1790000000000, expiresAt: 1790003600000, current: true }, { createdAt: 1790000010000, expiresAt: 1790003610000, current: false }], truncated: false }
beforeEach(() => {
  vi.clearAllMocks()
  mocks.failure.mockReturnValue('Đăng nhập lại')
  mocks.request.mockImplementation(async (_token, _path, _signal, payload) => payload ? { revoked: 1 } : data)
})
afterEach(() => cleanup())
const setup = () => render(<AdminSecurity token="admin-token" lang="vi" onFailure={mocks.failure} />)

it('requires explicit confirmation before revoking only other sessions and refreshes the listing', async () => {
  setup(); await screen.findByText('Phiên này')
  const button = screen.getByRole('button', { name: 'Đăng xuất các phiên khác' }) as HTMLButtonElement
  expect(button.disabled).toBe(true)
  fireEvent.click(screen.getByRole('checkbox'))
  fireEvent.click(button)
  await screen.findByText(/Đã đăng xuất 1 phiên khác/)
  expect(mocks.request).toHaveBeenCalledWith('admin-token', 'security/revoke-others', expect.any(AbortSignal), {})
  expect((await screen.findByRole('checkbox') as HTMLInputElement).checked).toBe(false)
  expect(mocks.request.mock.calls.filter(row => row[1] === 'security')).toHaveLength(2)
})

it('surfaces the recent-login requirement without showing a false success message', async () => {
  setup(); await screen.findByText('Phiên này')
  const error = new ApiError(401, 'expired', 'RECENT_LOGIN_REQUIRED')
  mocks.request.mockRejectedValueOnce(error)
  fireEvent.click(screen.getByRole('checkbox'))
  fireEvent.click(screen.getByRole('button', { name: 'Đăng xuất các phiên khác' }))
  expect((await screen.findByRole('alert')).textContent).toBe('Đăng nhập lại')
  expect(mocks.failure).toHaveBeenCalledWith(error)
  expect(screen.queryByText(/Đã đăng xuất/)).toBeNull()
})

it('ignores an in-flight mutation after closing the panel and cannot duplicate its request', async () => {
  const view = setup(); await screen.findByText('Phiên này')
  let resolve!: (value: { revoked: number }) => void
  mocks.request.mockReturnValueOnce(new Promise(done => { resolve = done }))
  fireEvent.click(screen.getByRole('checkbox'))
  fireEvent.click(screen.getByRole('button', { name: 'Đăng xuất các phiên khác' }))
  expect((screen.getByRole('button', { name: 'Đang thu hồi…' }) as HTMLButtonElement).disabled).toBe(true)
  const signal = mocks.request.mock.calls.at(-1)![2] as AbortSignal
  view.unmount(); expect(signal.aborted).toBe(true)
  await act(async () => resolve({ revoked: 2 }))
  expect(mocks.request.mock.calls.filter(row => row[1] === 'security/revoke-others')).toHaveLength(1)
  expect(mocks.failure).not.toHaveBeenCalled()
})

it('uses English copy within its own language scope', async () => {
  const view = render(<AdminSecurity token="admin-token" lang="en" onFailure={mocks.failure} />)
  await screen.findByText('This session')
  expect(view.container.firstElementChild?.getAttribute('lang')).toBe('en')
  expect(screen.getByRole('button', { name: 'Sign out other sessions' })).toBeTruthy()
})
