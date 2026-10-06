import 'fake-indexeddb/auto'
import { expect, it } from 'vitest'
import { getCachedCatalog, getFile, getFiles, getOfflineBook, getPending, getRecords, removeFile, removeLocalDocument, removeOfflineBook, saveCachedCatalog, saveFile, saveOfflineBook, savePending, saveRecord } from './store'

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

it('removes a browser-backed cloud file without deleting its sync records', async () => {
  const id = `cloud-${crypto.randomUUID()}`
  const profile = 'ACCOUNT:CLOUD-FILE'
  await saveFile({ key: `${profile}:${id}`, profile, book: { id, title: 'Cloud import', author: '', source: 'cloud' }, data: new Blob(['cloud file']), addedAt: 1 })
  await saveRecord({ key: `${profile}:catalog_books:${id}`, profile, kind: 'catalog_books', id, version: 1, deleted: false, payload: { id } })

  await removeFile(profile, id)

  expect((await getFiles(profile)).some(file => file.book.id === id)).toBe(false)
  expect((await getRecords(profile)).some(record => record.id === id)).toBe(true)
})

it('reopens IndexedDB after the browser closes the cached connection', async () => {
  const beforeId = `before-close-${crypto.randomUUID()}`
  await saveFile({ key: `DEVICE_LOCAL:${beforeId}`, profile: 'DEVICE_LOCAL', book: { id: beforeId, title: 'Before close', author: '', source: 'local' }, data: new Blob(['before']), addedAt: 1 })

  await new Promise<void>((resolve, reject) => {
    const request = indexedDB.deleteDatabase('nocap-web-v1')
    request.onsuccess = () => resolve()
    request.onerror = () => reject(request.error)
    request.onblocked = () => reject(new Error('Cached IndexedDB connection was not released'))
  })

  const afterId = `after-close-${crypto.randomUUID()}`
  await saveFile({ key: `DEVICE_LOCAL:${afterId}`, profile: 'DEVICE_LOCAL', book: { id: afterId, title: 'After close', author: '', source: 'local' }, data: new Blob(['after']), addedAt: 2 })
  expect(await (await getFile('DEVICE_LOCAL', afterId))?.data.text()).toBe('after')
})
