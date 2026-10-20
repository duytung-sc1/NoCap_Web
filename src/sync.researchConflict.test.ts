import 'fake-indexeddb/auto'
import { beforeEach, describe, expect, it, vi } from 'vitest'
import { getChanges, pushOperation, uploadBlob } from './api'
import { getPending, getRecord, savePending, saveRecord } from './store'
import { canKeepLocalConflict, profileFor, resolveConflict, syncNow } from './sync'
import type { PendingOperation, Session, SyncKind, SyncRecord } from './types'

vi.mock('./api', () => ({
  API_BASE: 'https://api.example.invalid',
  ApiError: class ApiError extends Error {},
  getUser: vi.fn(async () => ({ user: {} })),
  getChanges: vi.fn(), pushOperation: vi.fn(), uploadBlob: vi.fn(),
}))

beforeEach(() => vi.clearAllMocks())

const researchKinds: SyncKind[] = ['knowledge_topics', 'topic_annotations', 'annotation_links', 'exam_plans', 'review_attempts']
async function fixture(kind: SyncKind = 'knowledge_topics', remoteDeleted?: boolean, deleted = false) {
  const session: Session = { token: 'research-conflict-session', expiresAt: Date.now() / 1000 + 600,
    user: { id: crypto.randomUUID(), email: 'research@example.test', emailVerified: true } }
  const profile = profileFor(session), id = crypto.randomUUID(), key = `${profile}:${kind}:${id}`
  const local: SyncRecord = { key, profile, kind, id, deleted, version: 1,
    payload: { id, name: 'Preserved local work', created_at: 1, updated_at: 2 } }
  const pending: PendingOperation = { key, profile, attempted: true, conflicted: true,
    ...(remoteDeleted === undefined ? {} : { remoteDeleted }),
    operation: { opId: crypto.randomUUID(), kind, id, baseVersion: 1, deleted, payload: local.payload } }
  const remote = { seq: 2, kind, id, version: 2, deleted: 1, payload: { id } }
  await saveRecord(local); await savePending(pending)
  vi.mocked(getChanges).mockResolvedValue({ changes: [remote], cursor: 2, hasMore: false })
  return { session, profile, key, local, pending, remote }
}

describe('Delete-wins research conflicts', () => {
  it('only disables keep-local for a known research tombstone over a live local operation', async () => {
    const { pending } = await fixture()
    expect(canKeepLocalConflict(pending)).toBe(true)
    expect(canKeepLocalConflict({ ...pending, remoteDeleted: false })).toBe(true)
    expect(canKeepLocalConflict({ ...pending, remoteDeleted: true })).toBe(false)
    expect(canKeepLocalConflict({ ...pending, remoteDeleted: true, operation: { ...pending.operation, deleted: true } })).toBe(true)
    expect(canKeepLocalConflict({ ...pending, remoteDeleted: true, operation: { ...pending.operation, kind: 'highlights' } })).toBe(true)
  })

  it('records a receipt tombstone without replacing the rejected local data', async () => {
    const { session, profile, pending, local, key, remote } = await fixture()
    await savePending({ ...pending, attempted: false, conflicted: false })
    vi.mocked(pushOperation).mockResolvedValueOnce({ receipts: [{ opId: pending.operation.opId, status: 'CONFLICT', current: remote }] })
    expect(await syncNow(session)).toMatchObject({ conflicts: 1 })
    const saved = (await getPending(profile))[0]
    expect(saved).toMatchObject({ conflicted: true, remoteDeleted: true })
    expect(saved.operation).toEqual(pending.operation)
    expect(canKeepLocalConflict(saved)).toBe(false)
    expect(await getRecord(key)).toEqual(local)
  })

  it.each(researchKinds)('discovers an older %s conflict tombstone before creating any replacement operation', async kind => {
    const { session, profile, key, local, pending } = await fixture(kind)
    await expect(resolveConflict(session, key, 'keep_local')).rejects.toThrow(/đã bị xóa.*deleted in the cloud/)
    const saved = (await getPending(profile))[0]
    expect(saved).toEqual({ ...pending, conflicted: true, remoteDeleted: true })
    expect(saved.operation).toEqual(pending.operation)
    expect(saved.operation.recreate).toBeUndefined()
    expect(await getRecord(key)).toEqual(local)
    expect(pushOperation).not.toHaveBeenCalled()
    expect(uploadBlob).not.toHaveBeenCalled()
  })

  it('allows the user to accept the cloud deletion after a blocked keep-local choice', async () => {
    const { session, profile, key, remote } = await fixture('exam_plans')
    await expect(resolveConflict(session, key, 'keep_local')).rejects.toThrow('Dùng bản cloud')
    await resolveConflict(session, key, 'take_remote')
    expect(await getRecord(key)).toMatchObject({ deleted: true, version: remote.version, payload: remote.payload })
    expect(await getPending(profile)).toEqual([])
    expect(pushOperation).not.toHaveBeenCalled()
  })

  it('accepts the authoritative tombstone when both devices deleted the same research item', async () => {
    const { session, profile, key, pending, remote } = await fixture('annotation_links', true, true)
    expect(canKeepLocalConflict(pending)).toBe(true)
    await resolveConflict(session, key, 'keep_local')
    expect(await getRecord(key)).toMatchObject({ deleted: true, version: remote.version, payload: remote.payload })
    expect(await getPending(profile)).toEqual([])
    expect(pushOperation).not.toHaveBeenCalled()
    expect(uploadBlob).not.toHaveBeenCalled()
  })
})
