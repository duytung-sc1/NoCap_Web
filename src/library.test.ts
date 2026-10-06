import { describe, expect, it } from 'vitest'
import { mergeBooksById } from './library'
import type { Book } from './types'

const book = (id: string, source: string, title = id): Book => ({ id, source, title, author: '' })

describe('mergeBooksById', () => {
  it('keeps one entry for a cloud import also stored in this browser', () => {
    const result = mergeBooksById(
      [book('public-1', 'catalog')],
      [book('web-1', 'cloud', 'Cloud metadata')],
      [book('web-1', 'cloud', 'Browser-backed copy')],
    )

    expect(result.map(item => item.id)).toEqual(['public-1', 'web-1'])
    expect(result[1].title).toBe('Browser-backed copy')
  })

  it('ignores malformed entries without an id', () => {
    expect(mergeBooksById([book('', 'local'), book('valid', 'local')])).toEqual([book('valid', 'local')])
  })
})
