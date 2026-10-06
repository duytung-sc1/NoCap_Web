import { describe, expect, it } from 'vitest'
import type { StealthRow } from './textExtractor'
import {
  buildDisplayEntries,
  displayIndexForSource,
  progressionFromRowIndex,
  rowIndexFromProgression,
  rowIndexFromLocator,
  sourceIndexForDisplay,
} from './navigation'

function row(index: number, text: string): StealthRow {
  return {
    index: index + 1,
    id: `REC-${index}`,
    category: 'TEST',
    text,
    status: 'Ready',
    variance: '0%',
    timestamp: '00:00:00',
  }
}

describe('stealth navigation', () => {
  it('maps the first and last rows to exact 0% and 100% progress', () => {
    expect(progressionFromRowIndex(0, 10)).toBe(0)
    expect(progressionFromRowIndex(9, 10)).toBe(1)
    expect(rowIndexFromProgression(0, 10)).toBe(0)
    expect(rowIndexFromProgression(1, 10)).toBe(9)
  })

  it('keeps search result navigation tied to the original book row', () => {
    const rows = [row(0, 'alpha'), row(1, 'beta'), row(2, 'alpha again')]
    const entries = buildDisplayEntries(rows, 'alpha', [], false)

    expect(entries.map(entry => entry.sourceIndex)).toEqual([0, 2])
    expect(displayIndexForSource(entries, 2)).toBe(1)
    expect(sourceIndexForDisplay(entries, 1, 0)).toBe(2)
  })

  it('does not expose a book row index while the panic dataset is visible', () => {
    const entries = buildDisplayEntries([row(0, 'book content')], '', [row(0, 'corporate data')], true)
    expect(entries[0].sourceIndex).toBeNull()
    expect(sourceIndexForDisplay(entries, 0, 7)).toBe(7)
  })

  it('restores an EPUB stealth session from the saved chapter href', () => {
    const rows = [
      { ...row(0, 'chapter one'), sourceHref: 'OEBPS/chapter-1.xhtml' },
      { ...row(1, 'chapter two'), sourceHref: 'OEBPS/chapter-2.xhtml' },
    ]
    const locator = JSON.stringify({ href: 'chapter-2.xhtml', progression: 0.1 })
    expect(rowIndexFromLocator(rows, locator, 0.1)).toBe(1)
  })
})
