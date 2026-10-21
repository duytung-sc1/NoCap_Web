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
afterEach(cleanup)
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
