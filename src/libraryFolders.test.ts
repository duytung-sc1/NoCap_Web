import { describe, expect, it } from 'vitest'
import { folderPath, getLibraryFolderState, isDescendant } from './libraryFolders'
import { androidRecordId } from './sync'
import type { SyncRecord } from './types'

const profile = 'ACCOUNT:folder-reader'
const ids = Array.from({ length: 6 }, (_, index) => `00000000-0000-4000-8000-${String(index + 1).padStart(12, '0')}`)
function folder(id: string, parentId: string | null = null, extra: Partial<SyncRecord> = {}): SyncRecord {
  return { key: `${profile}:library_folders:${id}`, profile, kind: 'library_folders', id, version: 1, deleted: false,
    payload: { id, name: `Folder ${id}`, parent_id: parentId, created_at: 1, updated_at: 2 }, ...extra }
}
function location(bookId: string, folderId: string | null, extra: Partial<SyncRecord> = {}): SyncRecord {
  const id = androidRecordId('book_folder_locations', bookId)
  return { key: `${profile}:book_folder_locations:${id}`, profile, kind: 'book_folder_locations', id, version: 1, deleted: false,
    payload: { id, book_id: bookId, folder_id: folderId, updated_at: 2 }, ...extra }
}

describe('library folder tree projection', () => {
  it('roots missing/deleted parents and locations without modifying stored records', () => {
    const records = [folder(ids[0], ids[1]), folder(ids[1], null, { deleted: true }), folder(ids[2], ids[3]),
      location('orphan-document', ids[1]), location('child-document', ids[2])]
    const before = structuredClone(records), state = getLibraryFolderState(records)
    expect(state.folders.map(item => [item.id, item.parentId])).toEqual([[ids[0], null], [ids[2], null]])
    expect(state.bookFolders.get('orphan-document')).toBeNull()
    expect(state.bookFolders.get('child-document')).toBe(ids[2])
    expect(records).toEqual(before)
  })

  it('deterministically cuts the smallest member of each cycle independent of input order', () => {
    const records = [folder(ids[0], ids[2]), folder(ids[1], ids[0]), folder(ids[2], ids[1]), folder(ids[3], ids[3]), folder(ids[4], ids[2])]
    const expected = [[ids[0], null], [ids[1], ids[0]], [ids[2], ids[1]], [ids[3], null], [ids[4], ids[2]]]
    for (const input of [records, [...records].reverse(), [...records.slice(2), ...records.slice(0, 2)]]) {
      const state = getLibraryFolderState(input)
      expect(state.folders.map(item => [item.id, item.parentId])).toEqual(expected)
      expect(folderPath(state, ids[4]).map(item => item.id)).toEqual([ids[0], ids[1], ids[2], ids[4]])
      expect(isDescendant(state, ids[4], ids[0])).toBe(true)
      expect(isDescendant(state, ids[0], ids[4])).toBe(false)
      expect(isDescendant(state, ids[0], ids[0])).toBe(false)
    }
  })

  it('handles deep imported trees iteratively', () => {
    const records = Array.from({ length: 12000 }, (_, index) => {
      const id = `00000000-0000-4000-8000-${String(index + 1).padStart(12, '0')}`
      const parent = index ? `00000000-0000-4000-8000-${String(index).padStart(12, '0')}` : null
      return folder(id, parent)
    })
    const state = getLibraryFolderState(records.reverse())
    expect(folderPath(state, records[0].id)).toHaveLength(12000)
    expect(isDescendant(state, records[0].id, records.at(-1)!.id)).toBe(true)
    expect(folderPath(state, 'unknown')).toEqual([])
    expect(folderPath(state, null)).toEqual([])
  })

  it('rejects invalid row identities and respects a newer tombstone in repeated snapshots', () => {
    const valid = folder(ids[0]), invalid = folder(ids[1], null, { payload: { id: ids[2], name: 'Invalid' } })
    const oldLocation = location('document', ids[0])
    const state = getLibraryFolderState([valid, invalid, oldLocation, { ...oldLocation, version: 2, deleted: true },
      { ...location('wrong-id', ids[0]), id: ids[3] }, { ...valid, version: 2, deleted: true }])
    expect(state.folders).toEqual([])
    expect(state.bookFolders.size).toBe(0)
  })

  it('can explicitly scope a mixed snapshot to its owning profile', () => {
    const first = folder(ids[0]), other = { ...folder(ids[1], ids[0]), profile: 'ACCOUNT:other' }
    const otherLocation = { ...location('other-book', ids[1]), profile: other.profile }
    const state = getLibraryFolderState([first, other, otherLocation], other.profile)
    expect(state.folders.map(item => item.id)).toEqual([ids[1]])
    expect(state.folderById.get(ids[1])?.parentId).toBeNull()
    expect(state.bookFolders.get('other-book')).toBe(ids[1])
  })
})
