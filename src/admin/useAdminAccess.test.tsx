// @vitest-environment jsdom
import { act, cleanup, renderHook, waitFor } from '@testing-library/react'
import { afterEach, beforeEach, describe, expect, it, vi } from 'vitest'
import { ApiError } from '../api'
import type { AdminIdentity } from './api'
import { useAdminAccess } from './useAdminAccess'

const identity = vi.hoisted(() => vi.fn())
vi.mock('./api', () => ({ getAdminIdentity: identity }))
const admin: AdminIdentity = { id: 'admin-user', email: 'admin@example.test', photoUrl: null, adminExpiresAt: Date.now() + 3600000 }
type Props = { token?: string; userId?: string }
function pending() { let resolve!: (value: AdminIdentity) => void; const promise = new Promise<AdminIdentity>(done => { resolve = done }); return { promise, resolve } }
beforeEach(() => { identity.mockReset().mockRejectedValue(new ApiError(403, 'No admin access', 'ADMIN_REQUIRED')) })
afterEach(() => { cleanup(); vi.useRealTimers() })
describe('administrator access visibility', () => {
  it('does not verify a guest or grant access while verification is pending', async () => {
    const next = pending(); identity.mockReturnValue(next.promise)
    const { result, rerender } = renderHook(({ token, userId }: Props) => useAdminAccess(token, userId), { initialProps: {} as Props })
    expect(result.current.access).toBeNull(); expect(identity).not.toHaveBeenCalled()
    rerender({ token: 'admin-token', userId: admin.id })
    expect(result.current.access).toBeNull()
    act(() => next.resolve(admin))
    await waitFor(() => expect(result.current.access?.status).toBe('allowed'))
  })
  it.each([null, { ...admin, id: 'another-account' }, { ...admin, email: '' }, { ...admin, adminExpiresAt: undefined }])('never approves an invalid or different-account identity: %j', async value => {
    identity.mockResolvedValue(value)
    const { result } = renderHook(() => useAdminAccess('user-token', admin.id))
    await waitFor(() => expect(result.current.access?.status).toBe('denied'))
  })
  it('requires a fresh login when the identity reports an expired administrative capability', async () => {
    identity.mockResolvedValue({ ...admin, adminExpiresAt: Date.now() - 1 })
    const { result } = renderHook(() => useAdminAccess('admin-token', admin.id))
    await waitFor(() => expect(result.current.access?.status).toBe('reauth'))
  })
  it('offers reauthentication for an expired bearer session', async () => {
    identity.mockRejectedValue(new ApiError(401, 'Session expired', 'UNAUTHORIZED'))
    const { result } = renderHook(() => useAdminAccess('admin-token', admin.id))
    await waitFor(() => expect(result.current.access?.status).toBe('reauth'))
  })
  it('expires cached approval at its deadline even while a refresh is pending', async () => {
    vi.useFakeTimers()
    const expiresAt = Date.now() + 1000
    identity.mockResolvedValue({ ...admin, adminExpiresAt: expiresAt })
    const { result } = renderHook(() => useAdminAccess('admin-token', admin.id))
    await act(async () => { await Promise.resolve() })
    expect(result.current.access?.status).toBe('allowed')
    // Reloading identity must not cancel the independent capability deadline.
    const next = pending(); identity.mockReturnValue(next.promise)
    act(() => result.current.reload())
    await act(async () => { await vi.advanceTimersByTimeAsync(1001) })
    expect(result.current.access?.status).toBe('reauth')
    await act(async () => { next.resolve({ ...admin, adminExpiresAt: expiresAt }); await next.promise })
    expect(result.current.access?.status).toBe('reauth')
  })
  it('cancels the old capability deadline when a new session takes over and cleans up on unmount', async () => {
    vi.useFakeTimers()
    identity.mockResolvedValueOnce({ ...admin, adminExpiresAt: Date.now() + 1000 })
      .mockResolvedValueOnce({ ...admin, adminExpiresAt: Date.now() + 5000 })
    const { result, rerender, unmount } = renderHook(({ token, userId }: Props) => useAdminAccess(token, userId), { initialProps: { token: 'old-token', userId: admin.id } })
    await act(async () => { await Promise.resolve() })
    expect(result.current.access?.status).toBe('allowed')
    rerender({ token: 'new-token', userId: admin.id })
    await act(async () => { await Promise.resolve() })
    await act(async () => { await vi.advanceTimersByTimeAsync(1001) })
    expect(result.current.access?.status).toBe('allowed')
    unmount()
    expect(vi.getTimerCount()).toBe(0)
  })
  it('keeps the reauthentication prompt if a waiting identity refresh fails after expiry', async () => {
    vi.useFakeTimers()
    identity.mockResolvedValueOnce({ ...admin, adminExpiresAt: Date.now() + 1000 })
    const { result } = renderHook(() => useAdminAccess('admin-token', admin.id))
    await act(async () => { await Promise.resolve() })
    let reject!: (reason: Error) => void
    const next = new Promise<AdminIdentity>((_resolve, fail) => { reject = fail })
    identity.mockReturnValueOnce(next)
    act(() => result.current.reload())
    await act(async () => { await vi.advanceTimersByTimeAsync(1001) })
    expect(result.current.access?.status).toBe('reauth')
    await act(async () => { reject(new TypeError('Network failed')); await next.catch(() => {}) })
    expect(result.current.access?.status).toBe('reauth')
  })
  it('hides approved access immediately after an admin operation reports revocation', async () => {
    identity.mockResolvedValueOnce(admin)
    const { result } = renderHook(() => useAdminAccess('admin-token', admin.id))
    await waitFor(() => expect(result.current.access?.status).toBe('allowed'))
    const next = pending(); identity.mockReturnValue(next.promise)
    act(() => result.current.invalidate())
    expect(result.current.access).toBeNull()
    act(() => next.resolve({ ...admin, id: 'no-longer-approved' }))
    await waitFor(() => expect(result.current.access?.status).toBe('denied'))
  })
  it('does not reuse cached approval if an old token returns after logout', async () => {
    identity.mockResolvedValueOnce(admin)
    const { result, rerender } = renderHook(({ token, userId }: Props) => useAdminAccess(token, userId), { initialProps: { token: 'old-token', userId: admin.id } as Props })
    await waitFor(() => expect(result.current.access?.status).toBe('allowed'))
    rerender({})
    expect(result.current.access).toBeNull()
    const next = pending(); identity.mockReturnValue(next.promise)
    rerender({ token: 'old-token', userId: admin.id })
    expect(result.current.access).toBeNull()
    act(() => next.resolve(admin))
    await waitFor(() => expect(result.current.access?.status).toBe('allowed'))
  })
  it('discards late admin results after switching to a regular account', async () => {
    const old = pending(); identity.mockReturnValueOnce(old.promise)
    const { result, rerender } = renderHook(({ token, userId }: Props) => useAdminAccess(token, userId), { initialProps: { token: 'admin-token', userId: admin.id } as Props })
    const signal = identity.mock.calls[0][1] as AbortSignal
    rerender({ token: 'reader-token', userId: 'reader' })
    expect(signal.aborted).toBe(true); expect(result.current.access).toBeNull()
    await waitFor(() => expect(result.current.access?.status).toBe('denied'))
    await act(async () => { old.resolve(admin); await old.promise })
    expect(result.current.access?.status).toBe('denied')
  })
})
