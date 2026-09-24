import 'fake-indexeddb/auto'
import { expect, it } from 'vitest'
import { getCachedCatalog, getFiles, getOfflineBook, getPending, getRecords, removeLocalDocument, removeOfflineBook, saveCachedCatalog, saveFile, saveOfflineBook, savePending, saveRecord } from './store'

it('keeps Guest and two accounts separate and removes only a deleted local document', async () => {
  const documentId = `web-${crypto.randomUUID()}`
  const profiles = ['DEVICE_LOCAL', 'ACCOUNT:A', 'ACCOUNT:B']
  for (const profile of profiles) {
    await saveFile({ key: `${profile}:${documentId}`, profile, book: { id: documentId, title: profile, author: '', source: 'local' }, data: new Blob(['test']), addedAt: 1 })
    await saveRecord({ key: `${profile}:reading_progress:${documentId}`, profile, kind: 'reading_progress', id: documentId, version: 0, deleted: false, payload: { book_id: documentId } })
  }
  await savePending({ key: `ACCOUNT:A:reading_progress:${documentId}`, profile: 'ACCOUNT:A', attempted: false, operation: { opId: crypto.randomUUID(), kind: 'reading_progress', id: documentId, baseVersion: 0, deleted: false, payload: { book_id: documentId } } })

  await removeLocalDocument('ACCOUNT:A', documentId)

  expect((await getFiles('ACCOUNT:A')).some(file => file.book.id === documentId)).toBe(false)
  expect((await getRecords('ACCOUNT:A')).some(record => record.payload.book_id === documentId)).toBe(false)
  expect((await getPending('ACCOUNT:A')).length).toBe(0)
  expect((await getFiles('DEVICE_LOCAL')).some(file => file.book.id === documentId)).toBe(true)
  expect((await getFiles('ACCOUNT:B')).some(file => file.book.id === documentId)).toBe(true)
})

it('keeps downloaded books offline only for their owning profile', async () => {
  const id = `offline-${crypto.randomUUID()}`
  await saveOfflineBook('ACCOUNT:A', id, new Blob(['private test book']))
  expect(await (await getOfflineBook('ACCOUNT:A', id))?.data.text()).toBe('private test book')
  expect(await getOfflineBook('ACCOUNT:B', id)).toBeUndefined()
  expect(await getOfflineBook('DEVICE_LOCAL', id)).toBeUndefined()

  await removeOfflineBook('ACCOUNT:A', id)
  expect(await getOfflineBook('ACCOUNT:A', id)).toBeUndefined()
  await saveCachedCatalog([{ id, title: 'Public test book', author: '' }], [{ id: 'test', name: 'Test' }])
  expect((await getCachedCatalog())?.books[0].id).toBe(id)
})
