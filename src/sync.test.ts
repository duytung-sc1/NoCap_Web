import { describe, expect, it } from 'vitest'
import { androidRecordId } from './sync'

describe('Android M14 sync identity', () => {
  it('uses a stable name UUID for the same public book', () => {
    const id = androidRecordId('reading_progress', 'gutenberg-11')
    // Generated independently with Java UUID.nameUUIDFromBytes (Android's API).
    expect(id).toBe('ab7c0250-390d-3ca1-9007-b86200d6c318')
    expect(id).toMatch(/^[0-9a-f]{8}-[0-9a-f]{4}-3[0-9a-f]{3}-[89ab][0-9a-f]{3}-[0-9a-f]{12}$/)
    expect(id).toBe(androidRecordId('reading_progress', 'gutenberg-11'))
    expect(id).not.toBe(androidRecordId('reading_progress', 'gutenberg-12'))
    expect(id).not.toBe(androidRecordId('bookmarks', 'gutenberg-11'))
  })
})
