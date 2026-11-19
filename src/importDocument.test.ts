import 'fake-indexeddb/auto'
import { describe, expect, it, vi } from 'vitest'
import { commitDocumentImport, type DocumentImportInput } from './importDocument'
import { createLibraryFolder, deleteLibraryFolder, getLibraryFolderState, renameLibraryFolder } from './libraryFolders'
import { getFile, getPending, getRecords, keyFor, type LibraryRestoreEntry } from './store'
import { androidRecordId } from './sync'
import type { Book } from './types'

function input(profile = `ACCOUNT:${crypto.randomUUID()}`): DocumentImportInput {
  const book: Book = { id: `web-${crypto.randomUUID()}`, title: 'Tài liệu mới', author: 'QA', format: 'TXT', source: profile === 'DEVICE_LOCAL' ? 'local' : 'cloud', fileUrl: `nocap-private:${'a'.repeat(64)}` }
  const id = androidRecordId('catalog_books', book.id)
  const records: LibraryRestoreEntry[] = profile === 'DEVICE_LOCAL' ? [] : [{
    record: {
      key: keyFor(profile, `catalog_books:${id}`), profile, kind: 'catalog_books', id, version: 0, deleted: false,
      payload: { id: book.id, title: book.title, file_url: book.fileUrl, format: book.format },
    },
    sync: true,
  }]
  return { profile, book, file: new File(['Private document bytes'], 'Tài liệu mới.txt', { type: 'text/plain' }), records, destinationId: null, isCurrent: () => true }
}

describe('atomic document import destinations', () => {
  it('saves account bytes, metadata and canonical folder membership with queued changes', async () => {
    const request = input()
    const parent = await createLibraryFolder(request.profile, 'Học tập')
    const child = await createLibraryFolder(request.profile, 'Tên ban đầu', parent)
    request.destinationId = child
    await renameLibraryFolder(request.profile, child, 'Luận văn')

    const result = await commitDocumentImport(request)
    const records = await getRecords(request.profile)
    const locationId = androidRecordId('book_folder_locations', request.book.id)
    expect(await (await getFile(request.profile, request.book.id))?.data.text()).toBe('Private document bytes')
    expect(getLibraryFolderState(records, request.profile).bookFolders.get(request.book.id)).toBe(child)
    expect(result).toMatchObject({ destinationId: child, folderNames: ['Học tập', 'Luận văn'], file: { profile: request.profile, book: request.book } })
    expect(result.records.map(entry => entry.record.kind)).toEqual(['catalog_books', 'book_folder_locations'])
    const pending = await getPending(request.profile)
    expect(pending.find(item => item.operation.kind === 'catalog_books')).toMatchObject({ needsBlobUpload: true })
    expect(pending.find(item => item.operation.id === locationId)?.operation.payload).toMatchObject({ id: locationId, book_id: request.book.id, folder_id: child })
  })

  it('keeps guest folder membership local and supports explicit root imports', async () => {
    const request = input('DEVICE_LOCAL')
    request.destinationId = await createLibraryFolder(request.profile, `Local ${crypto.randomUUID()}`)
    await commitDocumentImport(request)
    const locationId = androidRecordId('book_folder_locations', request.book.id)
    expect((await getRecords(request.profile)).find(record => record.id === locationId)?.payload.folder_id).toBe(request.destinationId)
    expect((await getPending(request.profile)).some(item => item.operation.id === locationId)).toBe(false)

    const root = input()
    const result = await commitDocumentImport(root)
    expect(result.folderNames).toEqual([])
    expect(result.records.map(entry => entry.record.kind)).toEqual(['catalog_books'])
    expect((await getRecords(root.profile)).some(record => record.kind === 'book_folder_locations')).toBe(false)
    expect(await getFile(root.profile, root.book.id)).toBeTruthy()
  })

  it.each(['deleted', 'wrong account', 'invalid'] as const)('rolls back every imported item when the destination is %s', async kind => {
    const request = input()
    request.destinationId = kind === 'invalid' ? 'invalid-folder-id' : await createLibraryFolder(kind === 'wrong account' ? `ACCOUNT:${crypto.randomUUID()}` : request.profile, 'Destination')
    if (kind === 'deleted') await deleteLibraryFolder(request.profile, request.destinationId)
    const recordsBefore = await getRecords(request.profile)
    const pendingBefore = await getPending(request.profile)

    await expect(commitDocumentImport(request)).rejects.toMatchObject({ code: 'FOLDER_MISSING' })
    expect(await getFile(request.profile, request.book.id)).toBeUndefined()
    expect(await getRecords(request.profile)).toEqual(recordsBefore)
    expect(await getPending(request.profile)).toEqual(pendingBefore)
  })

  it('rechecks ownership inside the transaction before writing bytes or metadata', async () => {
    const request = input()
    request.isCurrent = vi.fn().mockReturnValueOnce(true).mockReturnValue(false)
    await expect(commitDocumentImport(request)).rejects.toMatchObject({ name: 'AbortError' })
    expect(await getFile(request.profile, request.book.id)).toBeUndefined()
    expect(await getRecords(request.profile)).toEqual([])
    expect(await getPending(request.profile)).toEqual([])
  })

  it('rolls the file back if metadata cannot be written after the file put', async () => {
    const request = input()
    request.destinationId = await createLibraryFolder(request.profile, 'Destination')
    request.records[0].record.payload.unserializable = () => undefined
    const before = await getRecords(request.profile)
    const pendingBefore = await getPending(request.profile)

    await expect(commitDocumentImport(request)).rejects.toMatchObject({ name: 'DataCloneError' })
    expect(await getFile(request.profile, request.book.id)).toBeUndefined()
    expect(await getRecords(request.profile)).toEqual(before)
    expect(await getPending(request.profile)).toEqual(pendingBefore)
  })

  it('rejects records owned by another account before committing the import', async () => {
    const request = input()
    request.records[0].record.profile = `ACCOUNT:${crypto.randomUUID()}`
    await expect(commitDocumentImport(request)).rejects.toMatchObject({ name: 'AbortError' })
    expect(await getFile(request.profile, request.book.id)).toBeUndefined()
    expect(await getRecords(request.profile)).toEqual([])
  })
})
