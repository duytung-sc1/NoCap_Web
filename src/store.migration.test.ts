import 'fake-indexeddb/auto'
import { openDB } from 'idb'
import { expect, it } from 'vitest'
import { getFiles, getOfflineBooks, saveOfflineBook } from './store'

it('upgrades an existing browser library without deleting imported files', async () => {
  const id = `web-${crypto.randomUUID()}`
  const old = await openDB('nocap-web-v1', 1, {
    upgrade(db) {
      db.createObjectStore('files', { keyPath: 'key' })
      db.createObjectStore('records', { keyPath: 'key' })
      db.createObjectStore('pending', { keyPath: 'key' })
    },
  })
  await old.put('files', { key: `DEVICE_LOCAL:${id}`, profile: 'DEVICE_LOCAL', book: { id, title: 'Old import' }, data: new Blob(['preserved']), addedAt: 1 })
  old.close()

  expect((await getFiles('DEVICE_LOCAL')).find(file => file.book.id === id)?.book.title).toBe('Old import')
  expect(await getOfflineBooks('DEVICE_LOCAL')).toEqual([])
  await saveOfflineBook('PUBLIC_OFFLINE', id, new Blob(['downloaded']))
  expect((await getOfflineBooks('PUBLIC_OFFLINE'))[0].bookId).toBe(id)
})
