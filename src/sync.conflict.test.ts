import 'fake-indexeddb/auto'
import { expect, it, vi } from 'vitest'
import { getPending, getRecords, savePending, saveRecord } from './store'
import { syncNow } from './sync'
import type { Session } from './types'

vi.mock('./api', () => ({
  ApiError: class ApiError extends Error {},
  getUser: vi.fn(async () => ({ user: {} })),
  pushOperation: vi.fn(async (_token: string, operation: { opId: string }) => ({
    receipts: [{ opId: operation.opId, status: 'CONFLICT', current: { version: 2, deleted: 0, payload: { note: 'server edit' } } }],
  })),
  getChanges: vi.fn(async () => ({
    changes: [{ seq: 1, kind: 'highlights', id: 'same-record', version: 2, deleted: 0, payload: { note: 'server edit' } }],
    cursor: 1,
    hasMore: false,
  })),
}))

it('retains a conflicting local note and does not replay its rejected operation', async () => {
  const { pushOperation } = await import('./api')
  const session: Session = { token: 'test-token', expiresAt: Date.now() / 1000 + 60, user: { id: `conflict-${crypto.randomUUID()}`, email: 'test@example.invalid', emailVerified: true } }
  const profile = `ACCOUNT:${session.user.id}`
  const key = `${profile}:highlights:same-record`
  const operation = { opId: crypto.randomUUID(), kind: 'highlights' as const, id: 'same-record', baseVersion: 1, deleted: false, payload: { note: 'my local edit' } }
  await saveRecord({ key, profile, kind: 'highlights', id: 'same-record', version: 1, deleted: false, payload: operation.payload })
  await savePending({ key, profile, operation, attempted: false })

  expect((await syncNow(session)).conflicts).toBe(1)
  expect((await getRecords(profile))[0].payload.note).toBe('my local edit')
  expect((await getPending(profile))[0].conflicted).toBe(true)

  await syncNow(session)
  expect((await getRecords(profile))[0].payload.note).toBe('my local edit')
  expect(vi.mocked(pushOperation)).toHaveBeenCalledTimes(1)
})
