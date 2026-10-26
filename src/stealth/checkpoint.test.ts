// @vitest-environment jsdom
import { beforeEach, describe, expect, it, vi } from 'vitest'
import { clearStealthCheckpoint, readStealthCheckpoint, saveStealthCheckpoint, stealthLocator } from './checkpoint'

beforeEach(() => { localStorage.clear(); vi.restoreAllMocks() })

describe('stealth reading checkpoints', () => {
  it('clears only the reset book in the current account', () => {
    saveStealthCheckpoint('a', 'book', { progression: 0.7 })
    saveStealthCheckpoint('b', 'book', { progression: 0.8 })
    saveStealthCheckpoint('a', 'other', { progression: 0.5 })
    clearStealthCheckpoint('a', 'book')
    expect(readStealthCheckpoint('a', 'book')).toBeUndefined()
    expect(readStealthCheckpoint('b', 'book')?.progression).toBe(0.8)
    expect(readStealthCheckpoint('a', 'other')?.progression).toBe(0.5)
  })
  it('survives a new read and keeps accounts and books separate', () => {
    const position = { progression: 0.45, rowIndex: 45, rowCount: 101, rowId: 'REC-45', sourceHref: 'chapter.xhtml', rowOffset: 12 }
    expect(saveStealthCheckpoint('ACCOUNT:a', 'book', position)).toBe(true)
    expect(readStealthCheckpoint('ACCOUNT:a', 'book')).toEqual({ ...position, updatedAt: expect.any(Number) })
    expect(readStealthCheckpoint('ACCOUNT:b', 'book')).toBeUndefined()
    expect(readStealthCheckpoint('ACCOUNT:a', 'other')).toBeUndefined()
    expect(JSON.parse(stealthLocator(position))).toMatchObject({ type: 'STEALTH', version: 2, rowIndex: 45, rowOffset: 12 })
  })

  it('handles unavailable local storage without interrupting reading', () => {
    vi.spyOn(Storage.prototype, 'setItem').mockImplementation(() => { throw new DOMException('Full', 'QuotaExceededError') })
    expect(saveStealthCheckpoint('a', 'b', { progression: 0.2 })).toBe(false)
    vi.spyOn(Storage.prototype, 'getItem').mockImplementation(() => '{bad-json')
    expect(readStealthCheckpoint('a', 'b')).toBeUndefined()
  })
})
