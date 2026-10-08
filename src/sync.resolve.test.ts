import 'fake-indexeddb/auto'
import { beforeEach, expect, it, vi } from 'vitest'
import { getChanges, pushOperation } from './api'
import { getPending, getRecord, savePending, saveRecord } from './store'
import { profileFor, resolveConflict } from './sync'
import type { Session, SyncOperation } from './types'

vi.mock('./api', () => ({
  API_BASE: 'https://api.example.invalid',
  ApiError: class ApiError extends Error {},
  getUser: vi.fn(async () => ({ user: {} })),
  getChanges: vi.fn(),
  pushOperation: vi.fn(),
}))

beforeEach(() => vi.clearAllMocks())

async function conflict() {
  const session: Session = { token: 'test', expiresAt: Date.now() / 1000 + 600, user: { id: crypto.randomUUID(), email: 'test@example.invalid', emailVerified: true } }
  const profile = profileFor(session)
  const operation: SyncOperation = { kind: 'highlights', id: crypto.randomUUID(), opId: crypto.randomUUID(), baseVersion: 1, deleted: false, payload: { note: 'original local note' } }
  const key = `${profile}:highlights:${operation.id}`
  await saveRecord({ key, profile, kind: operation.kind, id: operation.id, version: 1, deleted: false, payload: { note: 'latest local note' } })
  await savePending({ key, profile, operation, attempted: true, conflicted: true })
  return { session, profile, operation, key }
}

it('uses the cloud version beyond the first page before clearing the conflict', async () => {
  const { session, profile, operation, key } = await conflict()
  vi.mocked(getChanges)
    .mockResolvedValueOnce({ changes: [], cursor: 100, hasMore: true })
    .mockResolvedValueOnce({ changes: [{ seq: 101, kind: operation.kind, id: operation.id, version: 3, deleted: 0, payload: { note: 'remote' } }], cursor: 101, hasMore: false })
  await resolveConflict(session, key, 'take_remote')
  expect(getChanges).toHaveBeenNthCalledWith(2, session.token, 100)
  expect((await getRecord(key))?.payload.note).toBe('remote')
  expect(await getPending(profile)).toEqual([])
})

it('keeps the local note and pending conflict if the cloud version cannot be found', async () => {
  const { session, profile, key } = await conflict()
  vi.mocked(getChanges).mockResolvedValueOnce({ changes: [], cursor: 0, hasMore: false })
  await expect(resolveConflict(session, key, 'take_remote')).rejects.toThrow('Chưa tìm thấy')
  expect((await getRecord(key))?.payload.note).toBe('latest local note')
  expect(await getPending(profile)).toHaveLength(1)
})

it('sends a new operation ID and the latest local edit against the cloud version', async () => {
  const { session, profile, operation, key } = await conflict()
  vi.mocked(getChanges).mockResolvedValueOnce({ changes: [{ seq: 1, kind: operation.kind, id: operation.id, version: 3, deleted: 0, payload: { note: 'remote' } }], cursor: 1, hasMore: false })
  vi.mocked(pushOperation).mockImplementationOnce(async (_token, op) => ({ receipts: [{ opId: op.opId, status: 'APPLIED', current: { version: 4, deleted: 0, payload: op.payload } }] }))
  await resolveConflict(session, key, 'keep_local')
  const sent = vi.mocked(pushOperation).mock.calls[0][1]
  expect(sent.opId).not.toBe(operation.opId)
  expect(sent.baseVersion).toBe(3)
  expect(sent.payload.note).toBe('latest local note')
  expect((await getRecord(key))?.version).toBe(4)
  expect(await getPending(profile)).toEqual([])
})

it('rejects a conflict owned by another profile', async () => {
  const { session, profile, key } = await conflict()
  await expect(resolveConflict({ ...session, user: { ...session.user, id: 'another' } }, key, 'take_remote')).rejects.toThrow('tài khoản')
  expect(getChanges).not.toHaveBeenCalled()
  expect(await getPending(profile)).toHaveLength(1)
})

it('explicitly recreates an observed cloud tombstone when choosing the local version', async () => {
  const { session, operation, key } = await conflict()
  vi.mocked(getChanges).mockResolvedValueOnce({ changes: [{ seq: 1, kind: operation.kind, id: operation.id, version: 5, deleted: 1, payload: {} }], cursor: 1, hasMore: false })
  vi.mocked(pushOperation).mockImplementationOnce(async (_token, op) => ({ receipts: [{ opId: op.opId, status: 'APPLIED', current: { version: 6, deleted: 0, payload: op.payload } }] }))
  await resolveConflict(session, key, 'keep_local')
  expect(vi.mocked(pushOperation).mock.calls[0][1]).toMatchObject({ baseVersion: 5, recreate: true, deleted: false })
})
