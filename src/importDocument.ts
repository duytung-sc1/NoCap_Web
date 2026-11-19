import { folderPath, getLibraryFolderState, LibraryFolderError } from './libraryFolders'
import { applyLibraryRestore, keyFor, type LibraryRestoreEntry } from './store'
import { androidRecordId } from './sync'
import type { Book, LocalFile } from './types'

export type DocumentImportInput = {
  profile: string
  book: Book
  file: File
  records: LibraryRestoreEntry[]
  destinationId: string | null
  isCurrent: () => boolean
}

export type CommittedDocumentImport = {
  file: LocalFile
  records: LibraryRestoreEntry[]
  destinationId: string | null
  folderNames: string[]
}

/** Save the document and its destination against one locked account snapshot. */
export async function commitDocumentImport({ profile, book, file, records, destinationId, isCurrent }: DocumentImportInput): Promise<CommittedDocumentImport> {
  if (!isCurrent()) throw new DOMException('The import account changed.', 'AbortError')
  const localFile: LocalFile = { key: keyFor(profile, book.id), profile, book, data: file, addedAt: Date.now() }
  let committedRecords = records
  let folderNames: string[] = []

  await applyLibraryRestore(profile, records, [localFile], [], (entries, current) => {
    if (!isCurrent() || entries.some(({ record }) => record.profile !== profile || record.key !== keyFor(profile, `${record.kind}:${record.id}`))) {
      throw new DOMException('The import account changed.', 'AbortError')
    }
    const folders = getLibraryFolderState(current, profile)
    if (destinationId !== null && !folders.folderById.has(destinationId)) throw new LibraryFolderError('FOLDER_MISSING')
    folderNames = folderPath(folders, destinationId).map(folder => folder.name)
    if (destinationId === null) return entries

    const id = androidRecordId('book_folder_locations', book.id)
    const key = keyFor(profile, `book_folder_locations:${id}`)
    committedRecords = [
      ...entries.filter(entry => entry.record.key !== key),
      {
        record: {
          key, profile, kind: 'book_folder_locations', id, version: 0, deleted: false,
          payload: { id, book_id: book.id, folder_id: destinationId, updated_at: Date.now() },
        },
        sync: profile.startsWith('ACCOUNT:'),
      },
    ]
    return committedRecords
  })

  return { file: localFile, records: committedRecords, destinationId, folderNames }
}
