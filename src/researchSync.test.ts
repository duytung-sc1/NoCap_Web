import 'fake-indexeddb/auto'
import { afterEach, describe, expect, it, vi } from 'vitest'
import { getChanges } from './api'
import { applyLocalMutations, applyRemoteChanges, getPending, getRecords, getSyncCursor, saveRecord, saveSyncCursor } from './store'
import { syncNow } from './sync'
import type { Session, SyncKind, SyncRecord } from './types'

afterEach(() => { vi.unstubAllGlobals(); vi.restoreAllMocks() })

const profile = () => `ACCOUNT:${crypto.randomUUID()}`
const record = (owner: string, kind: SyncKind, id: string = crypto.randomUUID(), payload: Record<string, unknown> = { id }): SyncRecord => ({
  key: `${owner}:${kind}:${id}`, profile: owner, kind, id, payload, version: 3, deleted: false,
})

async function metadata(key: string, value?: number): Promise<{ key: string; cursor: number } | undefined> {
  const request = indexedDB.open('nocap-web-v1', 2)
  const database = await new Promise<IDBDatabase>((resolve, reject) => {
    request.onsuccess = () => resolve(request.result)
    request.onerror = () => reject(request.error)
  })
  try {
    return await new Promise((resolve, reject) => {
      const transaction = database.transaction('metadata', value === undefined ? 'readonly' : 'readwrite')
      const store = transaction.objectStore('metadata')
      const operation = value === undefined ? store.get(key) : store.put({ key, cursor: value })
      let result: { key: string; cursor: number } | undefined
      operation.onsuccess = () => { if (value === undefined) result = operation.result }
      transaction.oncomplete = () => resolve(result)
      transaction.onerror = () => reject(transaction.error)
      transaction.onabort = () => reject(transaction.error || new Error('Metadata transaction aborted'))
    })
  } finally { database.close() }
}

describe('Web research sync compatibility', () => {
  it('opts into research changes explicitly, keeps the session out of the URL and bypasses caches', async () => {
    const fetch = vi.fn(async () => Response.json({ changes: [], cursor: 42, hasMore: false }))
    vi.stubGlobal('fetch', fetch)
    expect(await getChanges('private-test-session', 42)).toEqual({ changes: [], cursor: 42, hasMore: false })
    const [input, options] = fetch.mock.calls[0] as unknown as [RequestInfo | URL, RequestInit]
    const url = new URL(String(input))
    expect(url.pathname).toBe('/api/v1/sync/changes')
    expect([...url.searchParams.entries()]).toEqual([['cursor', '42'], ['limit', '100'], ['webResearch', '1']])
    expect(url.toString()).not.toContain('private-test-session')
    expect(new Headers(options.headers).get('Authorization')).toBe('Bearer private-test-session')
    expect(options.cache).toBe('no-store')
  })

  it('starts a new research cursor namespace without reusing or overwriting a legacy tab cursor', async () => {
    const owner = profile(), other = profile()
    await getSyncCursor(owner)
    await metadata(`sync-cursor:${owner}`, 900)
    expect(await getSyncCursor(owner)).toBe(0)
    await saveSyncCursor(owner, 40)
    await metadata(`sync-cursor:${owner}`, 9000)
    expect(await getSyncCursor(owner)).toBe(40)
    expect(await getSyncCursor(other)).toBe(0)
    expect(await metadata(`sync-cursor:research-v1:${owner}`)).toEqual({ key: `sync-cursor:research-v1:${owner}`, cursor: 40 })
    expect(await metadata(`sync-cursor:${owner}`)).toEqual({ key: `sync-cursor:${owner}`, cursor: 9000 })
    await applyRemoteChanges(owner, [], 8)
    expect(await getSyncCursor(owner)).toBe(40)
    await applyRemoteChanges(owner, [], 45)
    expect(await getSyncCursor(owner)).toBe(45)
  })

  it('replays new kinds from zero after upgrade and persists their records only under the authenticated account', async () => {
    const owner = profile(), other = profile()
    const userId = owner.slice('ACCOUNT:'.length)
    const session: Session = { token: 'research-replay-token', expiresAt: Date.now() / 1000 + 3600,
      user: { id: userId, email: 'research@example.test', emailVerified: true } }
    const kinds: SyncKind[] = ['knowledge_topics', 'topic_annotations', 'annotation_links', 'exam_plans', 'review_attempts', 'highlights']
    const changes = kinds.map((kind, index) => ({ seq: index + 1, kind, id: crypto.randomUUID(), version: 1, deleted: 0,
      payload: { id: crypto.randomUUID(), label: `Account-owned ${kind}` } }))
    const foreign = record(other, 'knowledge_topics', changes[0].id, { id: changes[0].id, name: 'Other account private topic' })
    await saveRecord(foreign)
    await getSyncCursor(owner)
    await metadata(`sync-cursor:${owner}`, 500)
    const requested: number[] = []
    vi.stubGlobal('fetch', vi.fn(async (input: RequestInfo | URL) => {
      const url = new URL(String(input))
      if (url.pathname === '/api/v1/auth/user') return Response.json({ user: session.user })
      if (url.pathname === '/api/v1/sync/changes') {
        expect(url.searchParams.get('webResearch')).toBe('1')
        const cursor = Number(url.searchParams.get('cursor'))
        requested.push(cursor)
        return Response.json({ changes: cursor === 0 ? changes : [], cursor: changes.length, hasMore: false })
      }
      throw new Error(`Unexpected test request: ${url.pathname}`)
    }))
    expect(await syncNow(session)).toEqual({ changes: 6, conflicts: 0 })
    expect(new Set((await getRecords(owner)).map(item => item.kind))).toEqual(new Set(kinds))
    expect((await getRecords(owner)).every(item => item.profile === owner && item.key.startsWith(`${owner}:`))).toBe(true)
    expect(await getRecords(other)).toEqual([foreign])
    expect(await getPending(owner)).toHaveLength(0)
    expect(await getSyncCursor(owner)).toBe(6)
    expect((await metadata(`sync-cursor:${owner}`))?.cursor).toBe(500)
    expect(await syncNow(session)).toEqual({ changes: 0, conflicts: 0 })
    expect(requested).toEqual([0, 6])
  })

  it('commits topic removal, membership tombstone and exam cleanup together without touching another profile', async () => {
    const owner = profile(), other = profile(), topicId = crypto.randomUUID(), membershipId = crypto.randomUUID(), planId = crypto.randomUUID()
    const topic = record(owner, 'knowledge_topics', topicId, { id: topicId, name: 'My topic', created_at: 1, updated_at: 1 })
    const membership = record(owner, 'topic_annotations', membershipId, { id: membershipId, topic_id: topicId, annotation_id: 'my-highlight', added_at: 1 })
    const plan = record(owner, 'exam_plans', planId, { id: planId, name: 'My exam', exam_date: '2026-12-20', topic_ids: [topicId], book_ids: [], created_at: 1, updated_at: 1 })
    const foreign = record(other, 'knowledge_topics', topicId, { id: topicId, name: 'Other private topic' })
    for (const item of [topic, membership, plan, foreign]) await saveRecord(item)
    await applyLocalMutations(owner, records => {
      expect(records).toHaveLength(3)
      expect(records.every(item => item.profile === owner)).toBe(true)
      return records.map(item => item.kind === 'exam_plans'
        ? { kind: item.kind, id: item.id, payload: { ...item.payload, topic_ids: [], updated_at: 2 } }
        : { kind: item.kind, id: item.id, payload: item.payload, deleted: true })
    })
    const saved = await getRecords(owner)
    expect(saved.find(item => item.kind === 'knowledge_topics')?.deleted).toBe(true)
    expect(saved.find(item => item.kind === 'topic_annotations')?.deleted).toBe(true)
    expect(saved.find(item => item.kind === 'exam_plans')).toMatchObject({ deleted: false, payload: { name: 'My exam', topic_ids: [], book_ids: [] } })
    const pending = await getPending(owner)
    expect(pending).toHaveLength(3)
    expect(pending.every(item => item.profile === owner && item.operation.baseVersion === 3)).toBe(true)
    expect(pending.filter(item => item.operation.deleted)).toHaveLength(2)
    expect(await getRecords(other)).toEqual([foreign])
    expect(await getPending(other)).toHaveLength(0)
  })

  it('rolls back every record and outbox write when one mutation in a batch fails to clone', async () => {
    const owner = profile(), other = profile()
    const original = record(owner, 'knowledge_topics', undefined, { name: 'Original topic' })
    const foreign = record(other, 'knowledge_topics', original.id, { name: 'Another account' })
    await saveRecord(original); await saveRecord(foreign)
    await expect(applyLocalMutations(owner, () => [
      { kind: original.kind, id: original.id, payload: { ...original.payload, name: 'Must roll back' } },
      { kind: 'review_attempts', id: crypto.randomUUID(), payload: { impossibleToStore: () => 'not data' } },
    ])).rejects.toThrow()
    expect(await getRecords(owner)).toEqual([original])
    expect(await getPending(owner)).toHaveLength(0)
    expect(await getRecords(other)).toEqual([foreign])
    expect(await getPending(other)).toHaveLength(0)
  })
})
