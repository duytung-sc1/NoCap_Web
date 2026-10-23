import { applyLocalMutations, type LocalMutation } from './store'
import { androidRecordId, broadcastSyncRequired } from './sync'
import type { SyncRecord } from './types'

export type LibraryFolder = {
  id: string
  name: string
  parentId: string | null
  createdAt: number
  updatedAt: number
}

export type LibraryFolderState = {
  folders: LibraryFolder[]
  folderById: Map<string, LibraryFolder>
  bookFolders: Map<string, string | null>
}

export type LibraryFolderErrorCode = 'INVALID_NAME' | 'INVALID_ID' | 'INVALID_BOOK_ID' | 'FOLDER_MISSING' | 'CYCLE' | 'TOO_MANY'
export class LibraryFolderError extends Error {
  code: LibraryFolderErrorCode
  constructor(code: LibraryFolderErrorCode) { super(code); this.name = 'LibraryFolderError'; this.code = code }
}

const uuid = /^[0-9a-f]{8}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{12}$/i
const isFolderId = (value: unknown): value is string => typeof value === 'string' && uuid.test(value)
const containsControl = (value: string) => [...value].some(character => character.charCodeAt(0) < 32 || character.charCodeAt(0) === 127)
const isBookId = (value: unknown): value is string => typeof value === 'string' && !!value.trim() && value.length <= 512 && !containsControl(value)
const timestamp = (value: unknown) => typeof value === 'number' && Number.isSafeInteger(value) && value >= 0 && value <= 8640000000000000 ? value : 0
const compare = (left: string, right: string) => left < right ? -1 : left > right ? 1 : 0
const folderEditTimestamp = (record: SyncRecord, now = Date.now()) => Math.max(now, timestamp(record.payload.created_at), timestamp(record.payload.updated_at))

function cleanName(name: string): string {
  if (typeof name !== 'string') throw new LibraryFolderError('INVALID_NAME')
  const result = name.trim().normalize('NFC')
  if (!result || result.length > 80 || containsControl(result)) throw new LibraryFolderError('INVALID_NAME')
  return result
}

function folderRecord(record: SyncRecord): LibraryFolder | null {
  if (record.deleted || record.kind !== 'library_folders' || !isFolderId(record.id) || record.payload.id !== record.id) return null
  const name = record.payload.name
  if (typeof name !== 'string') return null
  const trimmed = name.trim().normalize('NFC')
  if (!trimmed || trimmed.length > 80 || containsControl(trimmed)) return null
  return { id: record.id, name: trimmed, parentId: isFolderId(record.payload.parent_id) ? record.payload.parent_id : null,
    createdAt: timestamp(record.payload.created_at), updatedAt: timestamp(record.payload.updated_at) }
}

function locationBookId(record: SyncRecord): string | null {
  const bookId = record.payload.book_id
  return record.kind === 'book_folder_locations' && !record.deleted && isBookId(bookId) && record.payload.id === record.id &&
    record.id === androidRecordId('book_folder_locations', bookId) ? bookId : null
}

/** Records normally come from getRecords(profile). Pass profile when using a mixed input. */
export function getLibraryFolderState(records: SyncRecord[], profile?: string): LibraryFolderState {
  const scoped = profile === undefined ? records : records.filter(record => record.profile === profile)
  // Storage has one row per identity. Stable ordering also makes an imported,
  // repeated snapshot deterministic without depending on its array order.
  const ordered = [...scoped].sort((a, b) => compare(a.profile, b.profile) || compare(a.id, b.id) || b.version - a.version ||
    Number(b.deleted) - Number(a.deleted) || timestamp(b.payload.updated_at) - timestamp(a.payload.updated_at) ||
    compare(String(a.payload.name ?? ''), String(b.payload.name ?? '')) || compare(String(a.payload.parent_id ?? a.payload.folder_id ?? ''), String(b.payload.parent_id ?? b.payload.folder_id ?? '')))
  const seen = new Set<string>(), folderById = new Map<string, LibraryFolder>(), owners = new Map<string, string>()
  for (const record of ordered) {
    if (record.kind !== 'library_folders') continue
    if (seen.has(record.id)) continue
    seen.add(record.id)
    const folder = folderRecord(record)
    if (folder) { folderById.set(folder.id, folder); owners.set(folder.id, record.profile) }
  }
  for (const folder of folderById.values()) {
    if (folder.parentId && (!folderById.has(folder.parentId) || owners.get(folder.parentId) !== owners.get(folder.id))) folder.parentId = null
  }
  // Each node has at most one parent. Walk iteratively, cut the smallest ID in
  // each cycle, and mark each path complete. This remains O(n) on deep trees.
  const complete = new Set<string>()
  for (const id of folderById.keys()) {
    if (complete.has(id)) continue
    const path: string[] = [], positions = new Map<string, number>()
    let cursor: string | null = id
    while (cursor && !complete.has(cursor)) {
      const cycleAt = positions.get(cursor)
      if (cycleAt !== undefined) {
        let root = path[cycleAt]
        for (let index = cycleAt + 1; index < path.length; index++) if (compare(path[index], root) < 0) root = path[index]
        folderById.get(root)!.parentId = null
        break
      }
      positions.set(cursor, path.length); path.push(cursor)
      cursor = folderById.get(cursor)?.parentId ?? null
    }
    for (const visited of path) complete.add(visited)
  }
  const bookFolders = new Map<string, string | null>(), seenBooks = new Set<string>()
  for (const record of ordered) {
    if (record.kind !== 'book_folder_locations') continue
    // A newest tombstone must win over an older copy of the same row.
    const identity = `${record.profile}:${record.id}`
    if (seenBooks.has(identity)) continue
    seenBooks.add(identity)
    const bookId = locationBookId(record)
    if (!bookId || bookFolders.has(bookId)) continue
    const folderId = record.payload.folder_id
    bookFolders.set(bookId, isFolderId(folderId) && folderById.has(folderId) && owners.get(folderId) === record.profile ? folderId : null)
  }
  return { folders: [...folderById.values()], folderById, bookFolders }
}

/** Root-to-leaf breadcrumbs; unknown folders have no breadcrumb. */
export function folderPath(state: LibraryFolderState, id: string | null): LibraryFolder[] {
  const result: LibraryFolder[] = [], seen = new Set<string>()
  let cursor = id
  while (cursor && !seen.has(cursor)) {
    seen.add(cursor)
    const folder = state.folderById.get(cursor)
    if (!folder) break
    result.push(folder); cursor = folder.parentId
  }
  return result.reverse()
}

/** Strict descent: a folder is not its own descendant. */
export function isDescendant(state: LibraryFolderState, candidateId: string | null, ancestorId: string): boolean {
  if (!candidateId || candidateId === ancestorId) return false
  const seen = new Set<string>()
  let cursor = state.folderById.get(candidateId)?.parentId
  while (cursor && !seen.has(cursor)) {
    if (cursor === ancestorId) return true
    seen.add(cursor); cursor = state.folderById.get(cursor)?.parentId
  }
  return false
}

function requiredFolder(records: SyncRecord[], id: string): SyncRecord {
  if (!isFolderId(id)) throw new LibraryFolderError('INVALID_ID')
  const record = records.find(record => record.id === id && folderRecord(record))
  if (!record) throw new LibraryFolderError('FOLDER_MISSING')
  return record
}

function validateParent(records: SyncRecord[], parentId: string | null, movingId?: string) {
  if (parentId === null) return
  requiredFolder(records, parentId)
  const parents = new Map(records.flatMap(record => { const folder = folderRecord(record); return folder ? [[folder.id, folder.parentId] as const] : [] }))
  const seen = new Set<string>()
  let cursor: string | null = parentId
  while (cursor) {
    if (cursor === movingId || seen.has(cursor)) throw new LibraryFolderError('CYCLE')
    seen.add(cursor); cursor = parents.get(cursor) ?? null
  }
}

const folderMutation = (record: SyncRecord, payload: Record<string, unknown>, deleted = false): LocalMutation => ({ kind: 'library_folders', id: record.id, payload, deleted })
const locationMutation = (bookId: string, folderId: string | null, now: number): LocalMutation => {
  const id = androidRecordId('book_folder_locations', bookId)
  return { kind: 'book_folder_locations', id, payload: { id, book_id: bookId, folder_id: folderId, updated_at: now } }
}

async function write(profile: string, build: (records: SyncRecord[]) => LocalMutation[]): Promise<void> {
  let changed = false
  await applyLocalMutations(profile, records => {
    const mutations = build(records.filter(record => record.profile === profile))
    changed = mutations.length > 0
    return mutations.map(mutation => ({ ...mutation, localOnly: profile === 'DEVICE_LOCAL' }))
  })
  if (changed) broadcastSyncRequired(profile)
}

export async function createLibraryFolder(profile: string, name: string, parentId: string | null = null): Promise<string> {
  const value = cleanName(name), id = crypto.randomUUID()
  await write(profile, records => {
    validateParent(records, parentId)
    const now = Date.now()
    return [{ kind: 'library_folders', id, payload: { id, name: value, parent_id: parentId, created_at: now, updated_at: now } }]
  })
  return id
}

export async function renameLibraryFolder(profile: string, id: string, name: string): Promise<void> {
  const value = cleanName(name)
  await write(profile, records => {
    const record = requiredFolder(records, id)
    return record.payload.name === value ? [] : [folderMutation(record, { ...record.payload, name: value, updated_at: folderEditTimestamp(record) })]
  })
}

export async function moveLibraryFolder(profile: string, id: string, targetParentId: string | null): Promise<void> {
  await write(profile, records => {
    const record = requiredFolder(records, id)
    validateParent(records, targetParentId, id)
    return record.payload.parent_id === targetParentId ? [] : [folderMutation(record, { ...record.payload, parent_id: targetParentId, updated_at: folderEditTimestamp(record) })]
  })
}

/** Delete only the folder: promote its children and documents to its parent. */
export async function deleteLibraryFolder(profile: string, id: string): Promise<void> {
  await write(profile, records => {
    const record = requiredFolder(records, id), state = getLibraryFolderState(records, profile)
    const parentId = state.folderById.get(id)!.parentId, now = Date.now(), changes: LocalMutation[] = []
    for (const child of records) {
      if (child.id !== id && folderRecord(child) && child.payload.parent_id === id) {
        // Corrupt cycle edges can point back to the promoted parent itself.
        changes.push(folderMutation(child, { ...child.payload, parent_id: child.id === parentId ? null : parentId, updated_at: folderEditTimestamp(child, now) }))
      }
      const bookId = locationBookId(child)
      if (bookId && child.payload.folder_id === id) changes.push(locationMutation(bookId, parentId, now))
    }
    changes.push(folderMutation(record, { ...record.payload, updated_at: folderEditTimestamp(record, now) }, true))
    return changes
  })
}

export async function moveLibraryBooks(profile: string, bookIds: string[], targetFolderId: string | null): Promise<void> {
  if (!Array.isArray(bookIds) || bookIds.length > 1000) throw new LibraryFolderError('TOO_MANY')
  if (bookIds.some(id => !isBookId(id))) throw new LibraryFolderError('INVALID_BOOK_ID')
  const requested = [...new Set(bookIds)]
  await write(profile, records => {
    validateParent(records, targetFolderId)
    const current = getLibraryFolderState(records, profile), now = Date.now()
    return requested.filter(bookId => (current.bookFolders.get(bookId) ?? null) !== targetFolderId)
      .map(bookId => locationMutation(bookId, targetFolderId, now))
  })
}
