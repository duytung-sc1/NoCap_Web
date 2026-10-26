# Library folders

Library folders organize a document's real location in the personal library. Each document has at most one folder; no location row, or a `folder_id` of `null`, means the library root. Existing collections remain independent, many-to-many labels and keep their existing sync records.

## Synced records

- `library_folders`: UUID record identity, with `{ id, name, parent_id, created_at, updated_at }`. The payload ID equals the record ID. Names are trimmed, NFC-normalized, contain no control characters, and have a maximum of 80 JavaScript string units. `parent_id` is another folder UUID or `null`; timestamps are Unix milliseconds.
- `book_folder_locations`: one record for each document that has been moved, with `{ id, book_id, folder_id, updated_at }`. Its identity is `androidRecordId('book_folder_locations', book_id)`. Book IDs remain the existing document identities, are nonempty, contain no control characters, and have a maximum length of 512. Moving again updates the same record, so existing sync compare-and-set versions detect concurrent moves.

Folder creation uses `crypto.randomUUID()`. Guest (`DEVICE_LOCAL`) mutations remain on the device and do not enter the account outbox. All account writes use the current account profile and the existing sync outbox.

## Tree projection and navigation

`getLibraryFolderState(records, profile?)` returns folders, a folder lookup, and document-to-folder locations. Call it with a profile-scoped snapshot from `getRecords(profile)`, or supply the profile explicitly for a mixed snapshot. It returns copied folder objects, leaving sync records unchanged. Missing or deleted parents display at the root. Invalid or missing location destinations also display at the root.

Imported or independently synchronized moves can produce a cycle. The projection cuts the parent edge of the lexicographically smallest folder UUID in each cycle. This is deterministic across input ordering and uses iterative traversal, including for very deep trees. Normalization changes the view only; it does not silently rewrite sync records. `folderPath` returns root-to-leaf breadcrumbs, and `isDescendant(state, candidateId, ancestorId)` tests strict descent.

## Mutations and preservation

`createLibraryFolder`, `renameLibraryFolder`, `moveLibraryFolder`, `deleteLibraryFolder`, and `moveLibraryBooks` validate relationships against the latest profile records inside `applyLocalMutations`. Moving to a deleted destination, moving a folder into itself or its descendants, and attaching to a cyclic raw parent chain are rejected. Bulk document moves accept at most 1,000 IDs and deduplicate repeated IDs.

Deleting a folder tombstones that folder alone. Its immediate child folders and directly contained documents move to its current normalized parent, or the library root. Deeper descendants keep their relationship with their own parent. Deletion and promotion commit atomically in one IndexedDB transaction. Source catalog records, file bytes, annotations, reading progress, and collection memberships are never changed by any folder operation.

Invalid inputs and stale destinations raise `LibraryFolderError` with a stable `code`; callers can localize those errors. A failed operation commits no partial records or outbox entries. A successful operation broadcasts the normal sync-required notification after its local transaction commits.

## Add documents from inside a folder

An opened folder offers **Add documents to folder**, including an action in its empty state. The selected-folder inspector in the Folder Map offers the same picker. The picker searches the entire personal library by title or author, excludes documents already in the destination, and supports selecting up to 1,000 documents. Documents assigned elsewhere are moved, not copied. The destination remains fixed while selecting; saving rechecks both that folder and the current library entries.

## Remove a public book from the personal library

Opening a public book adds it to the personal shelf once its reading position is saved, including a position of zero. Favorites, offline copies and explicit folder locations also count as shelf membership. The public catalogue itself is independent.

**Reset and remove from library** is available on a public book's shelf card and in its details. After confirmation, `resetPublicLibraryBook` atomically tombstones its reading progress, favorites and folder locations for the owning profile. The book stays in Explore. Notes, highlights, review cards, reading history, reader preferences, private documents and shared offline bytes remain intact. A reset-progress tombstone suppresses membership caused only by the shared offline cache; opening the book again, favoriting it or explicitly adding it to a folder can put it back on the shelf.

Completed progress must cross an acknowledged deletion before a new reading session is recreated. The outbox retains that deletion barrier even if the user starts reading immediately or a previous progress write is already in flight. Empty legacy progress tombstones are recognized by the canonical progress record ID. Old stealth checkpoints cannot restore the removed reading position.

## Backup and restore

Library backups include both folder record kinds, their hierarchy, and explicit root locations. Restoring into an account preserves existing live folder IDs. Folder identities that the target account has already observed deleted are never resurrected: live backup folders with those IDs receive fresh UUIDs. Restored parent and document-location references follow the new UUIDs, while the original deletion tombstones remain intact. Document IDs, deterministic location IDs, notes, reading progress, and source file bytes are preserved.

This remapping uses the latest target records inside the same IndexedDB transaction that writes the complete restore. A folder deleted while archive files are being decoded is therefore handled safely. The entire archive is validated and decoded before that write transaction starts; a malformed later file writes no earlier folder, document, or file. A previously tombstoned document location may be recreated using its existing deterministic ID and exact target version.
